import * as THREE from 'three';
import type { PhysicsWorld } from '../engine/physics';
import type { Cookware } from '../sim/cookware';
import type { Contents, LiquidKind } from '../sim/liquid';
import { ROOM_C } from '../sim/units';
import type { WaterSystem, WaterVolume } from './water';
import type { Controls } from './controls';
import { zone, inZone } from './kitchenAppliances';

const MAX_DROPS = 900;
/** Faucet flow, kg/s (≈ 6 L/min). */
const FAUCET_FLOW = 0.1;
const FAUCET_SPOUT = new THREE.Vector3(7.0, 1.165, -0.11);

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  kind: LiquidKind;
  kg: number;
  T: number;
  /** Container it came from (can't land back in it for a moment). */
  from: number;
  age: number;
  alive: boolean;
}

interface Container {
  handle: number;
  pan: Cookware;
  c: Contents;
  surface: THREE.Mesh;
  volume: WaterVolume | null;
}

/** Soft round sprite texture for steam/smoke. */
function puffTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

interface Puff {
  s: THREE.Sprite;
  v: THREE.Vector3;
  life: number;
  max: number;
}

/**
 * Liquids you can see and pour: surfaces in pots and pans, tilting a container past its rim pours
 * drops that land in whatever's underneath (or splash), the sink faucet runs, boiling water bubbles
 * and steams, overheated oil smokes. Also floats things in pots (buoyancy) and detects lids.
 */
export class LiquidSystem {
  private readonly containers = new Map<number, Container>();
  private readonly drops: Drop[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly puffs: Puff[] = [];
  private readonly puffTex = puffTexture();
  faucetOn = false;
  private readonly sink = zone('sink');
  /** Splash callback (puddles). */
  onSplash: ((at: THREE.Vector3, kg: number, kind: LiquidKind) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly water: WaterSystem,
    controls: Controls,
    faucet: THREE.Object3D,
  ) {
    this.inst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.0035, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.7 }),
      MAX_DROPS,
    );
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    scene.add(this.inst);
    controls.register(faucet, { kind: 'button', press: () => (this.faucetOn = !this.faucetOn), label: 'Faucet' });
  }

  /** Start tracking a container's contents (pots, pans, bowls, bottles). */
  track(handle: number, pan: Cookware): void {
    if (!pan.contents || this.containers.has(handle)) return;
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(pan.spec.innerRadius!, 32).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8fb8cc, roughness: 0.04, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    surface.visible = false;
    surface.renderOrder = 1;
    this.scene.add(surface);
    const c = pan.contents;
    const r = pan.spec.innerRadius!;
    const holder = { floor: 0 };
    const volume: WaterVolume | null =
      pan.id === 'oil-bottle'
        ? null
        : this.water.add({
            id: `pot-${handle}`,
            cx: 0,
            cz: 0,
            hx: r * 0.8,
            hz: r * 0.8,
            floorY: 0,
            baseLevel: (): number => holder.floor + c.level,
            density: 1000,
            ignore: handle,
            follow: (w) => {
              const e = this.physics.entries.get(handle);
              if (!e || c.kg < 0.01) return false;
              const t = e.body.translation();
              const up = this.upOf(handle);
              if (up.y < 0.9) return false;
              w.cx = t.x;
              w.cz = t.z;
              w.floorY = t.y + 0.005;
              holder.floor = w.floorY;
              w.density = c.kind === 'oil' ? 920 : 1000;
              return true;
            },
          });
    this.containers.set(handle, { handle, pan, c, surface, volume });
  }

  untrack(handle: number): void {
    const k = this.containers.get(handle);
    if (!k) return;
    this.scene.remove(k.surface);
    if (k.volume) this.water.remove(k.volume);
    this.containers.delete(handle);
  }

  contentsOf(handle: number): Contents | null {
    return this.containers.get(handle)?.c ?? null;
  }

  /** All tracked containers (for the heat bridge: food immersed in a pot). */
  get all(): Container[] {
    return [...this.containers.values()];
  }

  private upOf(handle: number): THREE.Vector3 {
    const r = this.physics.entries.get(handle)!.body.rotation();
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  }

  /** World position of a container-local point. */
  private worldOf(handle: number, local: THREE.Vector3): THREE.Vector3 {
    const b = this.physics.entries.get(handle)!.body;
    const r = b.rotation();
    const t = b.translation();
    return local.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).add(new THREE.Vector3(t.x, t.y, t.z));
  }

  /** Is a world point inside this container's liquid-holding volume (upright approx)? */
  holds(k: Container, p: THREE.Vector3, pad = 0): boolean {
    const e = this.physics.entries.get(k.handle);
    if (!e) return false;
    const t = e.body.translation();
    const r = k.pan.spec.innerRadius!;
    return Math.hypot(p.x - t.x, p.z - t.z) < r + pad && p.y > t.y - 0.01 && p.y < t.y + k.pan.spec.depth! + 0.02;
  }

  frame(dt: number, lids: { handle: number; pos: THREE.Vector3; up: THREE.Vector3 }[]): void {
    for (const k of this.containers.values()) {
      const e = this.physics.entries.get(k.handle);
      if (!e) continue;
      const t = e.body.translation();
      const up = this.upOf(k.handle);
      const depth = k.pan.spec.depth!;
      const r = k.pan.spec.innerRadius!;

      // Lid: a lid sitting flat on the rim.
      const rimTop = t.y + depth;
      k.c.lid = lids.some((l) => l.up.y > 0.95 && Math.hypot(l.pos.x - t.x, l.pos.z - t.z) < 0.035 && Math.abs(l.pos.y - rimTop) < 0.03);

      // Pouring: the liquid surface (kept level) rises above the lowest point of the tilted rim.
      if (k.c.kg > 1e-4 && up.y < 0.995) {
        // Lowest rim point: world-down expressed in the container's frame, projected on its rim plane.
        const rl = new THREE.Vector3(0, -1, 0).applyQuaternion(this.inverseRot(k.handle));
        const dir2 = new THREE.Vector2(rl.x, rl.z);
        if (dir2.lengthSq() < 1e-6) dir2.set(1, 0);
        dir2.normalize();
        const isBottle = k.pan.id === 'oil-bottle';
        const lipLocal = isBottle ? new THREE.Vector3(0, 0.24, 0) : new THREE.Vector3(dir2.x * r, depth, dir2.y * r);
        const lip = this.worldOf(k.handle, lipLocal);
        const level = Math.min(k.c.level, depth);
        // Tilted, the level surface piles up toward the low side by about half the rim offset.
        const surfaceY = t.y + level * Math.max(up.y, 0);
        const excess = isBottle ? (up.y < -0.1 ? 0.02 : 0) : surfaceY + r * Math.sqrt(Math.max(0, 1 - up.y * up.y)) * 0.5 - lip.y;
        if (excess > 0) {
          const rate = isBottle ? 0.035 * Math.min(-up.y * 1.5, 1) : Math.min(2.5, 40 * excess ** 1.5 * (r / 0.12));
          const kg = Math.min(rate * dt, k.c.kg);
          const out = k.c.remove(kg);
          const T = k.c.T;
          const vel = lip.clone().sub(new THREE.Vector3(t.x, lip.y, t.z)).normalize().multiplyScalar(0.25);
          if (out.oil > 0) this.emit(lip, vel, 'oil', out.oil, T, k.handle);
          if (out.water > 0) this.emit(lip, vel, 'water', out.water, T, k.handle);
        }
      }

      // Surface visual.
      const show = k.c.kg > 1e-4 && k.c.level > 0.0008 && up.y > 0.5 && k.pan.id !== 'oil-bottle';
      k.surface.visible = show;
      if (show) {
        const lvl = Math.min(k.c.level, depth) + 0.002;
        const base = this.worldOf(k.handle, new THREE.Vector3(0, 0, 0));
        k.surface.position.set(base.x, base.y + lvl * up.y + (k.c.vigor > 0 ? Math.sin(performance.now() / 60) * 0.0008 * k.c.vigor : 0), base.z);
        const m = k.surface.material as THREE.MeshStandardMaterial;
        const oil = k.c.kind === 'oil';
        m.color.setHex(oil ? 0xd9a531 : k.c.starch > 0.002 ? 0xd8d9cf : 0x8fb8cc);
        m.opacity = oil ? 0.75 : 0.5;
        const s = Math.min(1, 0.55 + 0.45 * Math.min(lvl / depth, 1));
        k.surface.scale.set(s, 1, s);
      }

      // Steam, bubbles, smoke.
      const surf = new THREE.Vector3(t.x, t.y + Math.min(k.c.level, depth) + 0.01, t.z);
      if (k.c.vigor > 0.05 && !k.c.lid && Math.random() < k.c.vigor * dt * 25) this.puff(surf, r, 0xffffff, 1.8);
      if (k.c.vigor > 0.05 && k.c.lid && Math.random() < k.c.vigor * dt * 6) this.puff(new THREE.Vector3(t.x + r, rimTop, t.z), 0.02, 0xffffff, 1.4);
      if (k.c.smoke > 0 && Math.random() < k.c.smoke * dt * 30) this.puff(surf, r, 0x8a8a8a, 2.6);
      if (k.c.splatter > 0.2 && Math.random() < k.c.splatter * dt * 10) {
        this.puff(surf, r, 0xffffff, 0.8);
        this.emit(surf, new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.9 + Math.random(), (Math.random() - 0.5) * 0.8), 'oil', 0.0004, k.c.T, k.handle);
      }
      if (k.c.spillOil > 0) {
        const m = Math.min(k.c.spillOil, k.c.oil, 0.08 * dt);
        k.c.spillOil -= m;
        k.c.oil -= m;
        this.emit(new THREE.Vector3(t.x + r * 0.95, rimTop, t.z), new THREE.Vector3(0.15, 0, 0), 'oil', m, k.c.T, k.handle);
        if (k.c.oil <= 0) k.c.spillOil = 0;
      }
      this.updateFire(k, surf, r, dt);
      if (k.c.boilingOver && Math.random() < dt * 20) this.emit(new THREE.Vector3(t.x + r, rimTop, t.z), new THREE.Vector3(0.1, 0, 0), 'water', 0.002, 100, k.handle);
    }

    // Faucet.
    if (this.faucetOn) {
      const n = Math.max(1, Math.round(dt * 60));
      for (let i = 0; i < n; i++)
        this.emit(FAUCET_SPOUT.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.01, 0, (Math.random() - 0.5) * 0.01)), new THREE.Vector3(0, -0.3, 0), 'water', (FAUCET_FLOW * dt) / n, 18, -1);
    }

    this.updateDrops(dt);
    this.updatePuffs(dt);
  }

  private inverseRot(handle: number): THREE.Quaternion {
    const r = this.physics.entries.get(handle)!.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
  }

  emit(at: THREE.Vector3, v: THREE.Vector3, kind: LiquidKind, kg: number, T: number, from: number): void {
    // Merge into fewer, heavier drops when the flow is big.
    const n = Math.min(8, Math.max(1, Math.ceil(kg / 0.004)));
    for (let i = 0; i < n; i++) {
      let d = this.drops.find((q) => !q.alive);
      if (!d) {
        if (this.drops.length >= MAX_DROPS) return;
        d = { p: new THREE.Vector3(), v: new THREE.Vector3(), kind, kg: 0, T: ROOM_C, from, age: 0, alive: false };
        this.drops.push(d);
      }
      d.alive = true;
      d.p.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.006, 0, (Math.random() - 0.5) * 0.006));
      d.v.copy(v).add(new THREE.Vector3((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04));
      d.kind = kind;
      d.kg = kg / n;
      d.T = T;
      d.from = from;
      d.age = 0;
    }
  }

  private updateDrops(dt: number): void {
    let k = 0;
    const col = new THREE.Color();
    const conts = [...this.containers.values()];
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.age += dt;
      d.v.y -= 9.81 * dt;
      d.p.addScaledVector(d.v, dt);
      // Landed in a container?
      let landed = false;
      for (const c of conts) {
        if (c.handle === d.from && d.age < 0.4) continue;
        if (c.pan.id === 'oil-bottle') continue;
        const t = this.physics.entries.get(c.handle)?.body.translation();
        if (!t) continue;
        if (this.upOf(c.handle).y < 0.8) continue;
        const surfaceY = t.y + Math.min(c.c.level, c.pan.spec.depth!);
        if (Math.hypot(d.p.x - t.x, d.p.z - t.z) < c.pan.spec.innerRadius! && d.p.y <= surfaceY + 0.012 && d.p.y > t.y - 0.02) {
          c.c.add(d.kind, d.kg, d.T);
          landed = true;
          break;
        }
      }
      if (!landed && d.p.y < 1.4) {
        const floor = this.floorBelow(d.p);
        if (d.p.y <= floor + 0.002) {
          landed = true;
          if (!inZone(this.sink, d.p, 0.02)) this.onSplash?.(new THREE.Vector3(d.p.x, floor, d.p.z), d.kg, d.kind);
        }
      }
      if (landed || d.age > 5) {
        d.alive = false;
        continue;
      }
      if (k < MAX_DROPS) {
        this.dummy.position.copy(d.p);
        this.dummy.updateMatrix();
        this.inst.setMatrixAt(k, this.dummy.matrix);
        this.inst.setColorAt(k, col.setHex(d.kind === 'oil' ? 0xe0b040 : 0xb7d6e6));
        k++;
      }
    }
    this.inst.count = k;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
  }

  /** Surface height below a point (cached coarse lookup via physics ray). */
  floorAt: (x: number, y: number, z: number) => number = () => 0;
  private floorBelow(p: THREE.Vector3): number {
    return this.floorAt(p.x, p.y, p.z);
  }

  /** Public puff emitter (fryer bubbles etc.). */
  puffAt(at: THREE.Vector3, spread: number, color: number, life: number): void {
    this.puff(at, spread, color, life);
  }

  private puff(at: THREE.Vector3, spread: number, color: number, life: number): void {
    let p = this.puffs.find((q) => q.life <= 0);
    if (!p) {
      if (this.puffs.length > 160) return;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      this.scene.add(s);
      p = { s, v: new THREE.Vector3(), life: 0, max: 1 };
      this.puffs.push(p);
    }
    p.s.position.set(at.x + (Math.random() - 0.5) * spread, at.y, at.z + (Math.random() - 0.5) * spread);
    (p.s.material as THREE.SpriteMaterial).color.setHex(color);
    p.v.set((Math.random() - 0.5) * 0.03, 0.12 + Math.random() * 0.1, (Math.random() - 0.5) * 0.03);
    p.life = p.max = life * (0.7 + Math.random() * 0.6);
    p.s.visible = true;
  }

  private updatePuffs(dt: number): void {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.s.position.addScaledVector(p.v, dt);
      const a = Math.max(p.life / p.max, 0);
      const size = 0.04 + (1 - a) * 0.14;
      p.s.scale.set(size, size, size);
      (p.s.material as THREE.SpriteMaterial).opacity = a * 0.35;
      if (p.life <= 0) p.s.visible = false;
    }
  }

  private readonly fires = new Map<number, { group: THREE.Group; light: THREE.PointLight }>();
  private updateFire(k: Container, surf: THREE.Vector3, r: number, dt: number): void {
    let f = this.fires.get(k.handle);
    if (!k.c.onFire) {
      if (f) {
        this.scene.remove(f.group);
        this.fires.delete(k.handle);
      }
      return;
    }
    if (!f) {
      const group = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 8), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff7a1a : 0xffc04a, transparent: true, opacity: 0.85, toneMapped: false }));
        group.add(cone);
      }
      const light = new THREE.PointLight(0xff8a30, 3, 2.5, 1.5);
      group.add(light);
      this.scene.add(group);
      f = { group, light };
      this.fires.set(k.handle, f);
    }
    const now = performance.now() / 1000;
    f.group.position.copy(surf);
    f.group.children.forEach((c, i) => {
      if (!(c instanceof THREE.Mesh)) return;
      const a = (i / 9) * Math.PI * 2;
      c.position.set(Math.cos(a) * r * 0.5, 0.08 + Math.abs(Math.sin(now * 11 + i)) * 0.05, Math.sin(a) * r * 0.5);
      c.scale.set(1, 0.7 + Math.abs(Math.sin(now * 13 + i * 1.7)) * 0.9, 1);
    });
    f.light.intensity = 2.5 + Math.sin(now * 20) * 0.8;
    if (Math.random() < dt * 30) this.puff(surf.clone().add(new THREE.Vector3(0, 0.2, 0)), r, 0x2a2a2a, 3);
  }

  /** Any burning pots (fire alarm). */
  get fireCount(): number {
    return this.fires.size;
  }

  /** Any smoking oil in the kitchen (smoke alarm). */
  get smokeLevel(): number {
    let s = 0;
    for (const k of this.containers.values()) s += k.c.smoke;
    return s;
  }
}
