import { ROOM_C } from './units';

export type PastaDoneness = 'dry' | 'crunchy' | 'firm' | 'al dente' | 'soft' | 'mushy';

/** Water absorbed per kg of dry pasta at full hydration, and the time constant at a rolling boil (s). */
const R_MAX = 2.0;
const TAU_BOIL = 600;

/**
 * A batch of dried pasta (spaghetti). It cooks by absorbing water: ~1.05–1.35× its dry weight is al dente
 * (≈ 8–11 min at a rolling boil), more is soft then mushy. Below a boil it absorbs much more slowly.
 * Not stirring in the first couple of minutes lets strands glue together into clumps (which cook unevenly);
 * it sheds starch into the water as it cooks.
 */
export class PastaBatch {
  /** Absorbed water / dry mass. */
  R = 0;
  T = ROOM_C;
  /** 0..1 how glued-together the strands are. */
  clump = 0;
  /** Seconds since last stirred. */
  sinceStir = 0;
  /** Seconds spent in hot water. */
  cookTime = 0;
  /** Starch released into the water so far, kg (read & cleared by the pot). */
  starchOut = 0;

  constructor(public dryKg: number) {}

  get kg(): number {
    return this.dryKg * (1 + this.R);
  }

  stir(): void {
    this.sinceStir = 0;
  }

  doneness(): PastaDoneness {
    const R = this.R * (1 - this.clump * 0.25); // clumps leave raw centers
    if (this.cookTime === 0) return 'dry';
    if (R < 0.85) return 'crunchy';
    if (R < 1.05) return 'firm';
    if (R < 1.35) return 'al dente';
    if (R < 1.6) return 'soft';
    return 'mushy';
  }

  /**
   * Step in water at waterC with boil vigor 0..1. Returns heat drawn from the water, J.
   */
  step(dt: number, waterC: number | null, vigor: number): number {
    this.sinceStir += dt;
    if (waterC === null) {
      // Draining/out of water: hot pasta keeps absorbing its surface water briefly, then sets.
      this.T += (ROOM_C - this.T) * (1 - Math.exp(-dt / 600));
      return 0;
    }
    const cp = 1800 + 4186 * this.R; // dry pasta + absorbed water, per dry kg
    const C = this.dryKg * cp;
    const hA = 80 * this.dryKg * 20; // strands have a huge surface area
    const k = 1 - Math.exp((-hA * dt) / C);
    const dT = (waterC - this.T) * k;
    this.T += dT;
    const heat = dT * C;
    if (this.T > 60) {
      this.cookTime += dt;
      const rate = Math.exp((this.T - 100) / 12) / TAU_BOIL;
      const clumpSlow = 1 - this.clump * 0.3;
      this.R += (R_MAX - this.R) * (1 - Math.exp(-rate * dt * clumpSlow));
      // Glue-up risk: early in cooking, when not moving (unstirred, or not a vigorous boil).
      if (this.cookTime < 180) {
        const still = this.sinceStir > 45 ? 1 : 0;
        const calm = vigor < 0.4 ? 1 : 0.3;
        this.clump = Math.min(1, this.clump + (dt / 140) * still * calm);
      }
      this.starchOut += this.dryKg * 2.5e-5 * dt * (1 + vigor);
    }
    return heat;
  }
}
