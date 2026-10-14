import * as THREE from 'three';
import type { Game } from '../game';
import { PastaBatch } from '../sim/pasta';
import type { FoodItem } from '../sim/food';
import { DIRS } from '../sim/foodThermal';

/** Containers that can hold solids like pasta: inner radius and depth (m) from the body origin. */
export const BOWL_GEOM: Record<string, { r: number; depth: number }> = {
  'stock-pot': { r: 0.114, depth: 0.2 },
  'saute-pan': { r: 0.13, depth: 0.07 },
  'stainless-pan': { r: 0.118, depth: 0.045 },
  'cast-iron-pan': { r: 0.122, depth: 0.045 },
  'nonstick-pan': { r: 0.115, depth: 0.04 },
  'mixing-bowl': { r: 0.1, depth: 0.1 },
  colander: { r: 0.1, depth: 0.09 },
  plate: { r: 0.11, depth: 0.02 },
  'measuring-cup': { r: 0.04, depth: 0.06 },
  'measuring-spoon': { r: 0.022, depth: 0.012 },
  'cake-pan': { r: 0.112, depth: 0.05 },
  'loaf-pan': { r: 0.06, depth: 0.07 },
  'sheet-pan': { r: 0.13, depth: 0.022 },
};

const SHAKERS: Record<string, { kind: string; color: number }> = {
  'salt-shaker': { kind: 'salt', color: 0xffffff },
  'pepper-shaker': { kind: 'pepper', color: 0x2a2420 },
  'paprika-shaker': { kind: 'paprika', color: 0xb8331c },
  'garlic-powder': { kind: 'garlic-powder', color: 0xe8dcc0 },
  'chili-flakes': { kind: 'chili-flakes', color: 0xc0391b },
  'dried-herbs': { kind: 'dried-herbs', color: 0x5d6b2e },
};

/** Each spice particle carries this much seasoning, kg (0.01 g — a couple of seconds of shaking ≈ 2 g). */
const GRAIN_KG = 1e-5;

interface Grain {
  p: THREE.Vector3;
  v: THREE.Vector3;
  kind: string;
  color: number;
  alive: boolean;
}

/**
 * Pantry interactions:
 * - Pasta: tip the spaghetti box over a pot to drop it in; stir with the spoon or tongs (or it clumps);
 *   tip the pot over a colander to drain — water runs through, the pasta stays.
 * - Spices: hold a shaker tipped over food and shake (or flick) it; grains fly out, land and season the
 *   face they hit. Salt in the pasta water seasons the pasta.
 */
export class PantryActions {
  readonly pasta = new Map<number, PastaBatch>();
  readonly salted = new Map<number, number>();
  private readonly views = new Map<number, { sticks: THREE.InstancedMesh; nest: THREE.Mesh }>();
  private readonly grains: Grain[] = [];
  private readonly grainMesh: THREE.InstancedMesh;
  private readonly lastVel = new Map<number, THREE.Vector3>();
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly game: Game) {
    this.grainMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0016, 4, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), 600);
    this.grainMesh.count = 0;
    this.grainMesh.frustumCulled = false;
    game.scene.add(this.grainMesh);
    game.sim.systems.push({ step: (dt) => this.simStep(dt) });
  }

  private pose(h: number): { p: THREE.Vector3; q: THREE.Quaternion } | null {
    const e = this.game.physics.entries.get(h);
    if (!e) return null;
    const t = e.body.translation();
    const r = e.body.rotation();
    return { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
  }

  /** Container (by handle) whose opening is under a world point. */
  containerBelow(pt: THREE.Vector3, exclude?: number): number | null {
    let best: number | null = null;
    let bestY = -Infinity;
    for (const [h, it] of this.game.items) {
      if (h === exclude) continue;
      const g = BOWL_GEOM[it.def.id];
      if (!g) continue;
      const ps = this.pose(h);
      if (!ps) continue;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      if (up.y < 0.8) continue;
      if (Math.hypot(pt.x - ps.p.x, pt.z - ps.p.z) > g.r) continue;
      if (pt.y < ps.p.y - 0.01 || pt.y > ps.p.y + g.depth + 0.4) continue;
      if (ps.p.y > bestY) {
        bestY = ps.p.y;
        best = h;
      }
    }
    return best;
  }

  /** Pasta cooks in whatever water its container holds. */
  private simStep(dt: number): void {
    for (const [h, batch] of this.pasta) {
      const c = this.game.liquids.contentsOf(h);
      const g = BOWL_GEOM[this.game.items.get(h)?.def.id ?? ''];
      const inWater = c && c.water > batch.dryKg * 2 && g && c.level > 0.03;
      const heat = batch.step(dt, inWater ? c!.T : null, inWater ? c!.vigor : 0);
      if (inWater) {
        c!.load += heat;
        c!.starch += batch.starchOut;
      }
      batch.starchOut = 0;
    }
  }

  frame(dt: number): void {
    const g = this.game;
    // Pasta box: tipped so its open end points down over a container.
    for (const [h, it] of g.items) {
      if (it.def.id !== 'pasta-box') continue;
      const left = (it.entry.data.pastaKg as number | undefined) ?? 0.45;
      if (left <= 0) continue;
      const ps = this.pose(h)!;
      const end = new THREE.Vector3(0.13, 0.02, 0).applyQuaternion(ps.q).add(ps.p);
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(ps.q);
      if (dir.y > -0.5) continue;
      const into = this.containerBelow(end, h);
      if (into === null) continue;
      const kg = Math.min(left, 0.25 * dt);
      it.entry.data.pastaKg = left - kg;
      this.addPasta(into, kg);
    }
    // Stirring: spoon or tongs moving inside a container with pasta.
    for (const h of [g.grab.heldHandle]) {
      if (h === null) continue;
      const id = g.items.get(h)?.def.id;
      if (id !== 'wooden-spoon' && id !== 'tongs') continue;
      const ps = this.pose(h)!;
      const tip = new THREE.Vector3(id === 'tongs' ? 0.12 : 0.08, 0, 0).applyQuaternion(ps.q).add(ps.p);
      const v = g.physics.entries.get(h)!.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 0.12) continue;
      for (const [ch, batch] of this.pasta) {
        const cp = this.pose(ch);
        const geo = BOWL_GEOM[g.items.get(ch)?.def.id ?? ''];
        if (cp && geo && Math.hypot(tip.x - cp.p.x, tip.z - cp.p.z) < geo.r && tip.y > cp.p.y && tip.y < cp.p.y + geo.depth + 0.02) batch.stir();
      }
    }
    // Draining / plating: tip a container of pasta over another.
    for (const [h, batch] of [...this.pasta]) {
      const ps = this.pose(h);
      const geo = BOWL_GEOM[g.items.get(h)?.def.id ?? ''];
      if (!ps || !geo) {
        this.pasta.delete(h);
        continue;
      }
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      if (up.y > 0.45) continue;
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(ps.q.clone().invert());
      const rim = new THREE.Vector3(down.x, 0, down.z).normalize().multiplyScalar(geo.r);
      rim.y = geo.depth;
      const lip = rim.applyQuaternion(ps.q).add(ps.p);
      const into = this.containerBelow(new THREE.Vector3(lip.x, lip.y - 0.02, lip.z), h);
      if (into === null) continue;
      const kg = Math.min(batch.dryKg, 0.15 * dt);
      batch.dryKg -= kg;
      const moved = new PastaBatch(kg);
      moved.R = batch.R;
      moved.T = batch.T;
      moved.clump = batch.clump;
      moved.cookTime = batch.cookTime;
      this.addPasta(into, kg, moved);
      if (batch.dryKg < 0.002) this.pasta.delete(h);
    }
    this.updateViews();
    this.updateShakers(dt);
  }

  addPasta(container: number, kg: number, from?: PastaBatch): void {
    const b = this.pasta.get(container);
    if (!b) {
      const nb = from ?? new PastaBatch(kg);
      if (from) nb.dryKg = kg;
      this.pasta.set(container, nb);
      return;
    }
    const total = b.dryKg + kg;
    if (from) {
      b.R = (b.R * b.dryKg + from.R * kg) / total;
      b.cookTime = Math.max(b.cookTime, from.cookTime);
      b.clump = Math.max(b.clump, from.clump);
    }
    b.dryKg = total;
  }

  private updateViews(): void {
    const g = this.game;
    for (const [h, v] of this.views) {
      if (!this.pasta.has(h)) {
        g.scene.remove(v.sticks, v.nest);
        this.views.delete(h);
      }
    }
    for (const [h, batch] of this.pasta) {
      const geo = BOWL_GEOM[g.items.get(h)?.def.id ?? ''];
      const ps = this.pose(h);
      if (!geo || !ps) continue;
      let v = this.views.get(h);
      if (!v) {
        const sticks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0011, 0.0011, 0.25, 4), new THREE.MeshStandardMaterial({ color: 0xe9c66b, roughness: 0.6 }), 40);
        const nest = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.08, 120, 6, 7, 11), new THREE.MeshStandardMaterial({ color: 0xf1d98f, roughness: 0.45 }));
        g.scene.add(sticks, nest);
        v = { sticks, nest };
        this.views.set(h, v);
      }
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      const limp = batch.R > 0.45;
      v.sticks.visible = !limp && up.y > 0.5;
      v.nest.visible = limp && up.y > 0.5;
      const n = Math.min(40, Math.ceil(batch.dryKg / 0.012));
      if (v.sticks.visible) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          this.dummy.position.set(ps.p.x + Math.cos(a) * geo.r * 0.25, ps.p.y + 0.12, ps.p.z + Math.sin(a) * geo.r * 0.25);
          // Dry spaghetti fans out against the pot rim; softening strands start to slump.
          this.dummy.rotation.set(Math.sin(a) * 0.4 * (1 + batch.R), 0, -Math.cos(a) * 0.4 * (1 + batch.R));
          this.dummy.updateMatrix();
          v.sticks.setMatrixAt(i, this.dummy.matrix);
        }
        v.sticks.count = n;
        v.sticks.instanceMatrix.needsUpdate = true;
      }
      if (v.nest.visible) {
        const s = geo.r * 0.55 * Math.min(1, 0.5 + batch.kg / 1.2);
        v.nest.scale.set(s, s * 0.35, s);
        v.nest.position.set(ps.p.x, ps.p.y + 0.01 + s * 0.3, ps.p.z);
        const m = v.nest.material as THREE.MeshStandardMaterial;
        const d = batch.doneness();
        m.color.setHex(d === 'mushy' ? 0xf6ead0 : d === 'soft' ? 0xf3e1a8 : 0xefd48a);
      }
    }
  }

  private updateShakers(dt: number): void {
    const g = this.game;
    const h = g.grab.heldHandle;
    const id = h !== null ? g.items.get(h)?.def.id : undefined;
    if (h !== null && id && SHAKERS[id]) {
      const b = g.physics.entries.get(h)!.body;
      const v = b.linvel();
      const vel = new THREE.Vector3(v.x, v.y, v.z);
      const last = this.lastVel.get(h) ?? vel.clone();
      const accel = vel.clone().sub(last).length() / Math.max(dt, 1e-3);
      this.lastVel.set(h, vel);
      const ps = this.pose(h)!;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      // Tipped and shaken, or a hard flick.
      const shake = (up.y < 0.5 && accel > 6) || accel > 30;
      if (shake) {
        const cap = new THREE.Vector3(0, 0.095, 0).applyQuaternion(ps.q).add(ps.p);
        const n = Math.min(12, Math.ceil(accel / 8));
        const spec = SHAKERS[id];
        for (let i = 0; i < n; i++) this.emitGrain(cap, up.clone().multiplyScalar(0.4).add(vel.clone().multiplyScalar(0.5)), spec.kind, spec.color);
      }
    }
    // Grains fall and season what they land on.
    let k = 0;
    const col = new THREE.Color();
    for (const gr of this.grains) {
      if (!gr.alive) continue;
      gr.v.y -= 9.81 * dt;
      gr.p.addScaledVector(gr.v, dt);
      if (gr.p.y < 0.6) {
        gr.alive = false;
        continue;
      }
      const hit = this.landing(gr.p);
      if (hit) {
        gr.alive = false;
        this.season(hit, gr.kind);
        continue;
      }
      if (k < 600) {
        this.dummy.position.copy(gr.p);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.grainMesh.setMatrixAt(k, this.dummy.matrix);
        this.grainMesh.setColorAt(k, col.setHex(gr.color));
        k++;
      }
    }
    this.grainMesh.count = k;
    this.grainMesh.instanceMatrix.needsUpdate = true;
    if (this.grainMesh.instanceColor) this.grainMesh.instanceColor.needsUpdate = true;
  }

  emitGrain(at: THREE.Vector3, v: THREE.Vector3, kind: string, color: number): void {
    let gr = this.grains.find((q) => !q.alive);
    if (!gr) {
      if (this.grains.length >= 600) return;
      gr = { p: new THREE.Vector3(), v: new THREE.Vector3(), kind, color, alive: false };
      this.grains.push(gr);
    }
    gr.alive = true;
    gr.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.01, 0, (Math.random() - 0.5) * 0.01));
    gr.v.copy(v).add(new THREE.Vector3((Math.random() - 0.5) * 0.25, -Math.random() * 0.2, (Math.random() - 0.5) * 0.25));
    gr.kind = kind;
    gr.color = color;
  }

  /** What a grain at p has just landed on: a food (handle + world point) or a container's water. */
  private landing(p: THREE.Vector3): { food?: number; container?: number } | null {
    const g = this.game;
    for (const [h, food] of g.sim.foods) {
      const ps = this.pose(h);
      if (!ps) continue;
      const c = (g.physics.entries.get(h)!.data.foodCenter as number[]) ?? [0, 0, 0];
      const l = p.clone().sub(ps.p).applyQuaternion(ps.q.clone().invert()).sub(new THREE.Vector3(c[0], c[1], c[2]));
      const s = food.size;
      if (Math.abs(l.x) < s[0] / 2 && Math.abs(l.y) < s[1] / 2 + 0.002 && Math.abs(l.z) < s[2] / 2) return { food: h };
    }
    for (const k of g.liquids.all) {
      const t = this.pose(k.handle);
      if (!t || k.c.water < 0.05) continue;
      if (g.liquids.holds(k, p) && p.y < t.p.y + Math.min(k.c.level, k.pan.spec.depth!)) return { container: k.handle };
    }
    return null;
  }

  private season(hit: { food?: number; container?: number }, kind: string): void {
    const g = this.game;
    if (hit.container !== undefined) {
      if (kind === 'salt') this.salted.set(hit.container, (this.salted.get(hit.container) ?? 0) + GRAIN_KG);
      return;
    }
    const h = hit.food!;
    const food = g.sim.foods.get(h) as FoodItem;
    const ps = this.pose(h)!;
    // It lands on the face that's facing up.
    let best = 2;
    let bd = -Infinity;
    DIRS.forEach((d, i) => {
      const w = new THREE.Vector3(...d).applyQuaternion(ps.q);
      if (w.y > bd) {
        bd = w.y;
        best = i;
      }
    });
    food.season(kind, GRAIN_KG, [best]);
  }

  /** Total seasoning on a food by kind (kg). */
  flavorsOf(h: number): Record<string, number> {
    return { ...(this.game.sim.foods.get(h)?.flavors ?? {}) };
  }
}
