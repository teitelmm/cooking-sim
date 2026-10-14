import * as THREE from 'three';
import type { Game } from '../game';
import { DoughState, doughProps, INGREDIENTS, Mixture, type Ingredient } from '../sim/baking';
import { FoodItem } from '../sim/food';
import { BOWL_GEOM } from './pantryActions';
import type { ItemDef } from '../data/items';

/** Items that hold a pourable ingredient: what, how much (kg), where the opening is (local), flow (kg/s). */
const SOURCES: Record<string, { ing: Ingredient; kg: number; mouth: [number, number, number]; flow: number }> = {
  'flour-bag': { ing: 'flour', kg: 2.27, mouth: [0, 0.11, 0], flow: 0.06 },
  'sugar-bag': { ing: 'sugar', kg: 1.8, mouth: [0, 0.18, 0], flow: 0.08 },
  'baking-powder': { ing: 'baking-powder', kg: 0.23, mouth: [0, 0.09, 0], flow: 0.01 },
  'baking-soda': { ing: 'baking-soda', kg: 0.45, mouth: [0, 0.12, 0], flow: 0.01 },
  'yeast-jar': { ing: 'yeast', kg: 0.11, mouth: [0, 0.085, 0], flow: 0.006 },
  vanilla: { ing: 'vanilla', kg: 0.06, mouth: [0, 0.1, 0], flow: 0.003 },
  'chocolate-chips': { ing: 'chocolate', kg: 0.34, mouth: [0, 0.18, 0], flow: 0.04 },
  milk: { ing: 'milk', kg: 0.95, mouth: [0, 0.19, 0], flow: 0.06 },
};

/** Measuring tools: capacity in liters. */
const MEASURES: Record<string, number> = { 'measuring-cup': 0.24, 'measuring-spoon': 0.015 };

interface Grain {
  p: THREE.Vector3;
  v: THREE.Vector3;
  ing: Ingredient;
  kg: number;
  from: number;
  age: number;
  alive: boolean;
}

/**
 * Baking in the kitchen: pour ingredients from bags/jars/cartons by tipping them, or scoop with the
 * measuring cup/tablespoon; crack eggs on the bowl rim; drop butter in; faucet water counts too. Stir
 * with the whisk or spoon. Tip the bowl to turn the dough out (or pour batter into a pan); dough proofs
 * on the counter; a rolling pin flattens it. Each bowl's contents are a Mixture that decides what it is.
 */
export class BakingSystem {
  readonly mixtures = new Map<number, Mixture>();
  readonly doughs = new Map<number, DoughState>();
  private readonly grains: Grain[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly surfaces = new Map<number, THREE.Mesh>();
  private readonly dummy = new THREE.Object3D();
  private butterTimers = new Map<number, number>();
  private lastTip = new Map<number, THREE.Vector3>();
  /** Rise the dough's body was last rebuilt at. */
  private builtRise = new Map<number, number>();

  constructor(private readonly game: Game) {
    this.inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0022, 4, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 800);
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    game.scene.add(this.inst);
    game.sim.systems.push({ step: (dt) => this.simStep(dt) });
    game.events.on('impact', (e) => this.onImpact(e.bodyA, e.bodyB, e.magnitude));
    game.events.on('spawn', (e) => {
      const src = SOURCES[e.itemId];
      if (src) game.physics.entries.get(e.body)!.data.ingredientKg = src.kg;
    });
    game.events.on('cut', (e) => {
      const parent = this.doughs.get(e.body);
      if (!parent) return;
      for (const p of e.pieces) {
        const d = new DoughState(parent.analysis);
        d.rise = parent.rise;
        d.set = parent.set;
        this.doughs.set(p, d);
        this.builtRise.set(p, parent.rise);
      }
    });
  }

  private pose(h: number): { p: THREE.Vector3; q: THREE.Quaternion } | null {
    const e = this.game.physics.entries.get(h);
    if (!e) return null;
    const t = e.body.translation();
    const r = e.body.rotation();
    return { p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
  }

  mixtureOf(h: number, create = false): Mixture | null {
    let m = this.mixtures.get(h) ?? null;
    if (!m && create) {
      m = new Mixture();
      this.mixtures.set(h, m);
    }
    return m;
  }

  private simStep(dt: number): void {
    for (const [h, d] of this.doughs) {
      const f = this.game.sim.foods.get(h);
      if (!f) {
        this.doughs.delete(h);
        continue;
      }
      d.step(dt, f);
    }
  }

  frame(dt: number): void {
    const g = this.game;
    for (const [h, it] of g.items) {
      const ps = this.pose(h);
      if (!ps) continue;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      // Pour from a bag/jar/carton.
      const src = SOURCES[it.def.id];
      if (src && up.y < 0.15) {
        const left = (it.entry.data.ingredientKg as number) ?? 0;
        if (left > 0) {
          const kg = Math.min(left, src.flow * dt * Math.min(1, (0.15 - up.y) * 2));
          it.entry.data.ingredientKg = left - kg;
          const mouth = new THREE.Vector3(...src.mouth).applyQuaternion(ps.q).add(ps.p);
          this.emit(mouth, up.clone().multiplyScalar(0.2), src.ing, kg, h);
        }
      }
      // Pour out of a measuring cup / spoon.
      if (MEASURES[it.def.id] !== undefined && up.y < 0.3) {
        const m = this.mixtures.get(h);
        if (m && m.total > 0) {
          const kg = Math.min(m.total, 0.15 * dt);
          const lip = new THREE.Vector3(0, BOWL_GEOM[it.def.id].depth, 0).applyQuaternion(ps.q).add(ps.p);
          this.pourOut(m, kg, lip, h);
        }
      }
      // Butter sitting in a bowl melts into the mix.
      if (it.def.id === 'butter' && g.grab.heldHandle !== h) {
        const into = g.pantry.containerBelow(ps.p.clone().add(new THREE.Vector3(0, -0.01, 0)), h);
        const t = into !== null && this.isMixContainer(into) ? (this.butterTimers.get(h) ?? 0) + dt : 0;
        this.butterTimers.set(h, t);
        if (t > 0.6 && into !== null) {
          this.mixtureOf(into, true)!.add('butter', it.def.mass);
          g.despawn(h);
        }
      }
    }
    this.scoop();
    this.stir(dt);
    this.absorbLiquids();
    this.turnOut();
    this.updateGrains(dt);
    this.updateSurfaces();
    this.updateDoughBodies();
    this.rolling(dt);
  }

  private isMixContainer(h: number): boolean {
    const id = this.game.items.get(h)?.def.id ?? '';
    return id === 'mixing-bowl' || id in MEASURES || id === 'loaf-pan' || id === 'cake-pan';
  }

  /** Dip a held measuring cup/spoon into an ingredient bag to fill it level. */
  private scoop(): void {
    const g = this.game;
    const h = g.grab.heldHandle;
    if (h === null) return;
    const id = g.items.get(h)?.def.id;
    if (!id || MEASURES[id] === undefined) return;
    const ps = this.pose(h)!;
    for (const [sh, it] of g.items) {
      const src = SOURCES[it.def.id];
      if (!src || !INGREDIENTS[src.ing].granular) continue;
      const sp = this.pose(sh)!;
      const local = ps.p.clone().sub(sp.p).applyQuaternion(sp.q.clone().invert());
      if (Math.abs(local.x) < 0.07 && local.y > 0 && local.y < src.mouth[1] + 0.02 && Math.abs(local.z) < 0.05) {
        const m = this.mixtureOf(h, true)!;
        const cap = MEASURES[id] * INGREDIENTS[src.ing].density;
        const need = Math.max(0, cap - m.total);
        const left = (it.entry.data.ingredientKg as number) ?? 0;
        const kg = Math.min(need, left);
        if (kg > 0) {
          m.add(src.ing, kg);
          it.entry.data.ingredientKg = left - kg;
        }
      }
    }
  }

  /** Whisk/spoon moving through a mix: count strokes by distance travelled inside it. */
  private stir(_dt: number): void {
    const g = this.game;
    const h = g.grab.heldHandle;
    const id = h !== null ? g.items.get(h)?.def.id : undefined;
    if (h === null || (id !== 'whisk' && id !== 'wooden-spoon')) return;
    const ps = this.pose(h)!;
    const tip = new THREE.Vector3(id === 'whisk' ? 0.08 : 0.08, 0.01, 0).applyQuaternion(ps.q).add(ps.p);
    const last = this.lastTip.get(h) ?? tip.clone();
    const moved = tip.distanceTo(last);
    this.lastTip.set(h, tip.clone());
    for (const [ch, m] of this.mixtures) {
      const cp = this.pose(ch);
      const geo = BOWL_GEOM[g.items.get(ch)?.def.id ?? ''];
      if (!cp || !geo) continue;
      if (Math.hypot(tip.x - cp.p.x, tip.z - cp.p.z) < geo.r && tip.y > cp.p.y - 0.01 && tip.y < cp.p.y + geo.depth + 0.02) {
        m.stir((moved / 0.06) * (id === 'whisk' ? 1.3 : 1));
      }
    }
  }

  /** Water or oil that landed in a bowl with dry ingredients becomes part of the mix. */
  private absorbLiquids(): void {
    const g = this.game;
    for (const k of g.liquids.all) {
      if (g.items.get(k.handle)?.def.id !== 'mixing-bowl') continue;
      const m = this.mixtures.get(k.handle);
      if (!m && k.c.kg < 0.001) continue;
      const mm = m ?? this.mixtureOf(k.handle, true)!;
      if (k.c.water > 0) {
        mm.add('water', k.c.water);
        k.c.water = 0;
      }
      if (k.c.oil > 0) {
        mm.add('oil', k.c.oil);
        k.c.oil = 0;
      }
    }
  }

  private onImpact(a: number, b: number, magnitude: number): void {
    const g = this.game;
    if (magnitude < 10) return;
    for (const h of [a, b]) {
      if (g.items.get(h)?.def.id !== 'egg') continue;
      const ps = this.pose(h);
      if (!ps) continue;
      // Cracked on something: the egg goes into whatever bowl is under it.
      const into = g.pantry.containerBelow(ps.p.clone().add(new THREE.Vector3(0, -0.05, 0)), h) ?? g.pantry.containerBelow(ps.p.clone().add(new THREE.Vector3(0, 0.15, 0)), h);
      g.despawn(h);
      if (into !== null && this.isMixContainer(into)) this.mixtureOf(into, true)!.add('egg', 0.05);
      else g.juice.puddle(ps.p.clone(), 0.05, [0.95, 0.8, 0.3], 1030);
    }
  }

  private pourOut(m: Mixture, kg: number, at: THREE.Vector3, from: number): void {
    const total = m.total;
    for (const [ing, amt] of Object.entries(m.kg)) {
      const part = ((amt ?? 0) / total) * kg;
      if (part <= 0) continue;
      m.kg[ing as Ingredient] = (amt ?? 0) - part;
      this.emit(at, new THREE.Vector3(0, -0.2, 0), ing as Ingredient, part, from);
    }
  }

  emit(at: THREE.Vector3, v: THREE.Vector3, ing: Ingredient, kg: number, from: number): void {
    const n = Math.min(6, Math.max(1, Math.ceil(kg / 0.003)));
    for (let i = 0; i < n; i++) {
      let gr = this.grains.find((q) => !q.alive);
      if (!gr) {
        if (this.grains.length >= 800) return;
        gr = { p: new THREE.Vector3(), v: new THREE.Vector3(), ing, kg: 0, from, age: 0, alive: false };
        this.grains.push(gr);
      }
      gr.alive = true;
      gr.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02));
      gr.v.copy(v).add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1));
      gr.ing = ing;
      gr.kg = kg / n;
      gr.from = from;
      gr.age = 0;
    }
  }

  private updateGrains(dt: number): void {
    const g = this.game;
    let k = 0;
    const col = new THREE.Color();
    for (const gr of this.grains) {
      if (!gr.alive) continue;
      gr.age += dt;
      gr.v.y -= 9.81 * dt;
      gr.p.addScaledVector(gr.v, dt);
      if (gr.age > 0.08) {
        const into = g.pantry.containerBelow(gr.p, gr.age < 0.5 ? gr.from : undefined);
        if (into !== null) {
          const cp = this.pose(into)!;
          const geo = BOWL_GEOM[g.items.get(into)!.def.id];
          if (gr.p.y < cp.p.y + geo.depth * 0.9 && this.isMixContainer(into)) {
            this.mixtureOf(into, true)!.add(gr.ing, gr.kg);
            gr.alive = false;
            continue;
          }
        }
      }
      if (gr.p.y < 0.5 || gr.age > 4 || gr.p.y < g.floorAt(gr.p.x, gr.p.y, gr.p.z)) {
        gr.alive = false;
        continue;
      }
      if (k < 800) {
        this.dummy.position.copy(gr.p);
        this.dummy.updateMatrix();
        this.inst.setMatrixAt(k, this.dummy.matrix);
        this.inst.setColorAt(k, col.setHex(INGREDIENTS[gr.ing].color));
        k++;
      }
    }
    this.inst.count = k;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
  }

  /** Visible fill in bowls/cups: height from volume, colour from what's in it. */
  private updateSurfaces(): void {
    const g = this.game;
    for (const [h, mesh] of this.surfaces) {
      if (!this.mixtures.has(h) || !g.items.has(h)) {
        g.scene.remove(mesh);
        this.surfaces.delete(h);
      }
    }
    for (const [h, m] of this.mixtures) {
      const it = g.items.get(h);
      const geo = it ? BOWL_GEOM[it.def.id] : undefined;
      const ps = this.pose(h);
      if (!geo || !ps) continue;
      let mesh = this.surfaces.get(h);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.85, 1, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
        mesh.castShadow = true;
        g.scene.add(mesh);
        this.surfaces.set(h, mesh);
      }
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      const area = Math.PI * geo.r * geo.r;
      const height = Math.min(geo.depth, (m.liters / 1000) / area);
      mesh.visible = m.total > 0.001 && up.y > 0.6 && height > 0.001;
      if (!mesh.visible) continue;
      mesh.scale.set(geo.r * 0.92, height, geo.r * 0.92);
      mesh.position.set(ps.p.x, ps.p.y + 0.004 + height / 2, ps.p.z);
      // Colour: weighted mix of ingredients (well mixed → uniform; just-poured flour reads white).
      const c = new THREE.Color(0, 0, 0);
      for (const [ing, amt] of Object.entries(m.kg)) c.add(new THREE.Color(INGREDIENTS[ing as Ingredient].color).multiplyScalar((amt ?? 0) / m.total));
      const a = m.analyze();
      if (a.type.includes('dough') || a.type.includes('batter')) c.lerp(new THREE.Color(0xe8d2a0), 0.4 * m.mixQuality);
      (mesh.material as THREE.MeshStandardMaterial).color.copy(c);
      (mesh.material as THREE.MeshStandardMaterial).roughness = a.type.includes('batter') ? 0.35 : 0.85;
    }
  }

  /** Tip a bowl of dough to turn it out; batter pours into a cake or loaf pan underneath. */
  private turnOut(): void {
    const g = this.game;
    for (const [h, m] of [...this.mixtures]) {
      const it = g.items.get(h);
      if (!it || it.def.id !== 'mixing-bowl') continue;
      const ps = this.pose(h)!;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ps.q);
      if (up.y > 0.35) continue;
      const a = m.analyze();
      const doughy = a.type === 'bread dough' || a.type === 'pizza dough' || a.type === 'cookie dough' || a.type === 'biscuit dough';
      const batter = a.type === 'cake batter' || a.type === 'pancake batter';
      if (!(doughy || batter) || m.mixQuality < 0.4) continue;
      const below = new THREE.Vector3(ps.p.x, ps.p.y - 0.02, ps.p.z).add(up.clone().multiplyScalar(-0.05));
      const pan = g.pantry.containerBelow(below.clone().add(new THREE.Vector3(0, 0.02, 0)), h);
      const panId = pan !== null ? g.items.get(pan)!.def.id : null;
      this.mixtures.delete(h);
      if (batter) {
        if (pan === null || (panId !== 'cake-pan' && panId !== 'loaf-pan' && panId !== 'sheet-pan')) {
          g.juice.puddle(below, a.totalKg * 0.3, [0.93, 0.85, 0.6], 1100);
          continue;
        }
        this.spawnBatter(pan, m);
      } else {
        const floor = g.floorAt(below.x, below.y, below.z);
        this.spawnDough(m, new THREE.Vector3(below.x, floor + 0.05, below.z));
      }
    }
  }

  /** Spawn a dough lump (proofs over time). */
  spawnDough(m: Mixture, at: THREE.Vector3, rise = 1, shape?: [number, number, number]): number {
    const a = m.analyze();
    const props = doughProps(a, rise);
    const vol = a.totalKg / props.rho;
    const flat = a.hydration > 0.85 ? 0.42 : a.hydration < 0.55 ? 0.72 : 0.6;
    const r = Math.cbrt((3 * vol) / (4 * Math.PI * flat));
    const size: [number, number, number] = shape ?? [2 * r, 2 * r * flat, 2 * r];
    const food = new FoodItem('dough', size, { props, initialT: 24 });
    const def: ItemDef = {
      id: 'dough',
      name: a.type,
      category: 'pantry',
      mass: a.totalKg,
      material: 'produce',
      parts: [{ kind: 'sphere', radius: 0.5, scale: size }],
      color: 0xead9b0,
      angularDamping: 2,
      linearDamping: 0.5,
    };
    const hull = sphereHull(size);
    const item = this.game.spawnDef(def, { x: at.x, y: at.y + size[1] / 2, z: at.z }, undefined, { food, hull });
    const h = item.entry.body.handle;
    const d = new DoughState(a);
    d.rise = rise;
    this.doughs.set(h, d);
    this.builtRise.set(h, rise);
    item.entry.data.doughName = a.type;
    return h;
  }

  /** Fill a pan with batter: a slab the shape of the pan's inside. */
  private spawnBatter(pan: number, m: Mixture): number {
    const g = this.game;
    const a = m.analyze();
    const geo = BOWL_GEOM[g.items.get(pan)!.def.id];
    const ps = this.pose(pan)!;
    const props = { ...doughProps(a), shape: 'box' as const };
    const area = g.items.get(pan)!.def.id === 'loaf-pan' ? 0.23 * 0.12 : Math.PI * geo.r * geo.r * 0.79;
    const depth = Math.min(geo.depth * 0.95, a.totalKg / props.rho / area);
    const side = g.items.get(pan)!.def.id === 'loaf-pan' ? ([0.23, depth, 0.12] as [number, number, number]) : ([geo.r * 1.75, depth, geo.r * 1.75] as [number, number, number]);
    const food = new FoodItem('batter', side, { props, initialT: 22 });
    const def: ItemDef = {
      id: 'batter',
      name: a.type,
      category: 'pantry',
      mass: a.totalKg,
      material: 'produce',
      parts: [{ kind: 'box', size: side }],
      color: 0xf0dca0,
      angularDamping: 3,
      linearDamping: 1,
    };
    const hull = boxHull(side);
    const item = g.spawnDef(def, { x: ps.p.x, y: ps.p.y + 0.006 + depth / 2, z: ps.p.z }, undefined, { food, hull });
    const h = item.entry.body.handle;
    this.doughs.set(h, new DoughState(a));
    this.builtRise.set(h, 1);
    return h;
  }

  /**
   * As dough proofs (or springs in the oven before it sets), its body grows. Rebuilt every ~15 % of rise:
   * a new grid at the bigger, lighter size, carrying over temperature and peak.
   */
  private updateDoughBodies(): void {
    const g = this.game;
    for (const [h, d] of [...this.doughs]) {
      const built = this.builtRise.get(h) ?? 1;
      if (d.set || Math.abs(d.rise / built - 1) < 0.15) continue;
      const it = g.items.get(h);
      const old = g.sim.foods.get(h);
      if (!it || !old || g.grab.heldHandle === h) continue;
      const ps = this.pose(h)!;
      const k = Math.cbrt(d.rise / built);
      // Rise is mostly upward when it's resting on something.
      const size: [number, number, number] = [old.size[0] * Math.pow(k, 0.75), old.size[1] * Math.pow(k, 1.5), old.size[2] * Math.pow(k, 0.75)];
      const props = { ...doughProps(d.analysis, d.rise), shape: old.props.shape };
      const food = new FoodItem(it.def.id, size, { props, initialT: old.thermal.mean(old.thermal.T) });
      const peak = old.thermal.mean(old.thermal.peak);
      food.thermal.peak.fill(peak);
      const def: ItemDef = { ...it.def, parts: [old.props.shape === 'box' ? { kind: 'box', size } : { kind: 'sphere', radius: 0.5, scale: size }] };
      const hull = old.props.shape === 'box' ? boxHull(size) : sphereHull(size);
      g.despawn(h);
      const item = g.spawnDef(def, { x: ps.p.x, y: ps.p.y + (size[1] - old.size[1]) / 2, z: ps.p.z }, ps.q, { food, hull });
      const nh = item.entry.body.handle;
      this.doughs.delete(h);
      this.doughs.set(nh, d);
      this.builtRise.delete(h);
      this.builtRise.set(nh, d.rise);
    }
  }

  /** Rolling pin pressed and rolled over raw dough flattens it. */
  private rolling(dt: number): void {
    const g = this.game;
    const h = g.grab.heldHandle;
    if (h === null || g.items.get(h)?.def.id !== 'rolling-pin') return;
    const ps = this.pose(h)!;
    const v = g.physics.entries.get(h)!.body.linvel();
    if (Math.hypot(v.x, v.z) < 0.1) return;
    for (const [dh, d] of [...this.doughs]) {
      const f = g.sim.foods.get(dh);
      const dp = this.pose(dh);
      if (!f || !dp || d.set || f.thermal.corePeak() > 45) continue;
      const top = dp.p.y + f.size[1] / 2;
      if (Math.hypot(ps.p.x - dp.p.x, ps.p.z - dp.p.z) > Math.max(f.size[0], f.size[2]) / 2 || ps.p.y - 0.025 > top + 0.004) continue;
      const thin = Math.max(0.005, f.size[1] * (1 - 0.6 * dt));
      if (thin >= f.size[1] - 1e-4) continue;
      const spread = Math.sqrt(f.size[1] / thin);
      const it = g.items.get(dh)!;
      const size: [number, number, number] = [f.size[0] * spread, thin, f.size[2] * spread];
      const food = new FoodItem(it.def.id, size, { props: { ...f.props, shape: 'box' }, initialT: f.thermal.coreTemp() });
      const def: ItemDef = { ...it.def, parts: [{ kind: 'box', size, round: Math.min(0.004, thin / 3) }] };
      g.despawn(dh);
      const item = g.spawnDef(def, { x: dp.p.x, y: dp.p.y - (f.size[1] - thin) / 2, z: dp.p.z }, undefined, { food, hull: boxHull(size) });
      this.doughs.delete(dh);
      this.doughs.set(item.entry.body.handle, d);
      this.builtRise.set(item.entry.body.handle, d.rise);
    }
  }
}

function sphereHull(size: [number, number, number]): [number, number, number][] {
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  g.scale(...size);
  const out: [number, number, number][] = [];
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  return out;
}

function boxHull(size: [number, number, number]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let c = 0; c < 8; c++) out.push([(c & 1 ? 0.5 : -0.5) * size[0], (c & 2 ? 0.5 : -0.5) * size[1], (c & 4 ? 0.5 : -0.5) * size[2]]);
  return out;
}
