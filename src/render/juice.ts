import * as THREE from 'three';
import type { RGB } from './foodColor';

const MAX_DROPS = 600;
/** Pooled liquid film thickness on a flat board, m. */
const FILM = 0.0012;
/** Each drop represents this much juice, m³ (0.05 ml). */
const DROP_VOLUME = 5e-8;

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  color: RGB;
  floorY: number;
  alive: boolean;
}

interface Pool {
  mesh: THREE.Mesh;
  volume: number;
  center: THREE.Vector3;
  color: THREE.Color;
}

/**
 * Meat juices: drops ooze out of a fresh cut, run down and collect into a glossy pool on the surface
 * below. Volume released comes from the sim (free juice near the cut), color from how cooked the meat is.
 */
export class JuiceSystem {
  private readonly drops: Drop[] = [];
  readonly pools: Pool[] = [];
  private readonly inst: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private pending: { at: THREE.Vector3; dir: THREE.Vector3; count: number; color: RGB; floorY: number; spread: number }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    /** Height of the surface under (x, z) at or below y. */
    private readonly floorAt: (x: number, y: number, z: number) => number,
  ) {
    const g = new THREE.SphereGeometry(0.0022, 6, 4);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85 });
    this.inst = new THREE.InstancedMesh(g, m, MAX_DROPS);
    this.inst.count = 0;
    this.inst.frustumCulled = false;
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.inst);
  }

  /** Release `kg` of juice from a cut centered at `at` with outward normal `dir`. */
  emit(at: THREE.Vector3, dir: THREE.Vector3, kg: number, color: RGB, spread = 0.03): number {
    const volume = kg / 1030;
    const count = Math.min(Math.round(volume / DROP_VOLUME), 400);
    if (count <= 0) return 0;
    const floorY = this.floorAt(at.x, at.y, at.z);
    // Juice doesn't all come out at once — it seeps over ~1.5 s.
    this.pending.push({ at: at.clone(), dir: dir.clone().normalize(), count, color, floorY, spread });
    return volume;
  }

  update(dt: number): void {
    // Seep pending drops.
    for (const p of this.pending) {
      const n = Math.min(p.count, Math.ceil(dt * 160));
      for (let i = 0; i < n; i++) {
        const drop = this.drops.find((d) => !d.alive) ?? (this.drops.length < MAX_DROPS ? this.newDrop() : null);
        if (!drop) break;
        drop.alive = true;
        drop.p.set(p.at.x + (Math.random() - 0.5) * p.spread, p.at.y + (Math.random() - 0.5) * 0.015, p.at.z + (Math.random() - 0.5) * p.spread);
        drop.v.copy(p.dir).multiplyScalar(0.05 + Math.random() * 0.12).add(new THREE.Vector3((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05));
        drop.color = p.color;
        drop.floorY = p.floorY;
      }
      p.count -= n;
    }
    this.pending = this.pending.filter((p) => p.count > 0);

    let k = 0;
    const col = new THREE.Color();
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.v.y -= 9.81 * dt;
      d.v.multiplyScalar(Math.exp(-3 * dt)); // viscous, clings to the meat
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= d.floorY + 0.001) {
        d.alive = false;
        this.addToPool(new THREE.Vector3(d.p.x, d.floorY, d.p.z), DROP_VOLUME, d.color);
        continue;
      }
      this.dummy.position.copy(d.p);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.inst.setMatrixAt(k, this.dummy.matrix);
      this.inst.setColorAt(k, col.setRGB(d.color[0], d.color[1], d.color[2], THREE.SRGBColorSpace));
      k++;
    }
    this.inst.count = k;
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
  }

  private newDrop(): Drop {
    const d: Drop = { p: new THREE.Vector3(), v: new THREE.Vector3(), color: [1, 0, 0], floorY: 0, alive: false };
    this.drops.push(d);
    return d;
  }

  /** Spilled liquid (water, oil) forms a puddle like juice does. */
  puddle(at: THREE.Vector3, kg: number, color: RGB, density = 1000): void {
    this.addToPool(at, kg / density, color);
  }

  private addToPool(at: THREE.Vector3, volume: number, color: RGB): void {
    let pool = this.pools.find((p) => Math.abs(p.center.y - at.y) < 0.01 && p.center.distanceTo(at) < this.radius(p.volume) + 0.02);
    if (!pool) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      pool = { mesh, volume: 0, center: at.clone(), color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace) };
      this.pools.push(pool);
    }
    const total = pool.volume + volume;
    pool.center.lerp(at, volume / total);
    pool.color.lerp(new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace), volume / total);
    pool.volume = total;
    const r = this.radius(total);
    pool.mesh.scale.set(r * (1 + Math.sin(total * 1e7) * 0.08), r, 1);
    pool.mesh.position.set(pool.center.x, pool.center.y + 0.0012, pool.center.z);
    (pool.mesh.material as THREE.MeshStandardMaterial).color.copy(pool.color);
  }

  private radius(volume: number): number {
    return Math.sqrt(volume / (Math.PI * FILM));
  }

  /** Total juice pooled, ml. */
  get pooledMl(): number {
    return this.pools.reduce((s, p) => s + p.volume, 0) * 1e6;
  }

  clear(): void {
    for (const p of this.pools) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.pools.length = 0;
    for (const d of this.drops) d.alive = false;
    this.pending = [];
  }
}
