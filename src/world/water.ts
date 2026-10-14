import type { PhysicsWorld } from '../engine/physics';

export interface WaterVolume {
  id: string;
  /** Horizontal extent (center, half sizes) and floor height. */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  floorY: number;
  /** Still-water surface height before displacement, m (≤ floorY = empty). */
  baseLevel: () => number;
  /** Fluid density, kg/m³ (water 1000, oil 920). */
  density: number;
  /** Current surface height including what's been displaced. */
  level: number;
}

const G = 9.81;

/**
 * Buoyancy and displacement for items in liquid (sous-vide tub, sink, pots of water or oil).
 * Each body is treated as its bounding volume: the submerged fraction is from its depth below the
 * surface; the surface rises by the displaced volume ÷ tub area. Linear and angular drag keep things calm.
 */
export class WaterSystem {
  readonly volumes: WaterVolume[] = [];

  constructor(private readonly physics: PhysicsWorld) {
    physics.preStep.push(() => this.apply());
  }

  add(v: Omit<WaterVolume, 'level'>): WaterVolume {
    const w: WaterVolume = { ...v, level: v.baseLevel() };
    this.volumes.push(w);
    return w;
  }

  /** Volume of the body that's below the surface, m³ (0 if not in this volume). */
  private submerged(w: WaterVolume, y: number, halfH: number, vol: number): number {
    if (w.baseLevel() <= w.floorY + 0.002) return 0;
    const bottom = y - halfH;
    const f = Math.min(Math.max((w.level - bottom) / (2 * halfH), 0), 1);
    return vol * f;
  }

  private apply(): void {
    for (const w of this.volumes) {
      let displaced = 0;
      const base = w.baseLevel();
      for (const e of this.physics.entries.values()) {
        if (!e.body.isDynamic()) continue;
        const vol = e.data.volume as number | undefined;
        const halfH = e.data.halfHeight as number | undefined;
        if (!vol || !halfH) continue;
        const p = e.body.translation();
        if (Math.abs(p.x - w.cx) > w.hx || Math.abs(p.z - w.cz) > w.hz || p.y < w.floorY - 0.05) continue;
        const sub = this.submerged(w, p.y, halfH, vol);
        if (sub <= 0) continue;
        displaced += sub;
        e.body.addForce({ x: 0, y: w.density * G * sub, z: 0 }, true);
        const v = e.body.linvel();
        const k = (sub / vol) * 6 * e.body.mass();
        e.body.addForce({ x: -v.x * k, y: -v.y * k, z: -v.z * k }, true);
        const av = e.body.angvel();
        const ka = (sub / vol) * 0.02 * e.body.mass();
        e.body.addTorque({ x: -av.x * ka, y: -av.y * ka, z: -av.z * ka }, true);
      }
      w.level = base + displaced / (4 * w.hx * w.hz);
    }
  }
}
