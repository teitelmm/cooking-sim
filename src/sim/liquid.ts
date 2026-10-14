import { BOIL_C, fToC, KELVIN, LATENT, ROOM_C } from './units';

export type LiquidKind = 'water' | 'oil';

export const LIQUIDS = {
  water: { cp: 4186, rho: 1000 },
  /** Refined vegetable/canola oil: smoke ~450 °F, flash ~600 °F. */
  oil: { cp: 2000, rho: 920, smokeC: fToC(450), flashC: fToC(600) },
} as const;

/** Heat-transfer coefficient pan → liquid, W/(m²·K): nucleate boiling is very effective. */
function panToLiquidH(kind: LiquidKind, T: number, panT: number): number {
  if (kind === 'oil') return 280;
  if (panT > BOIL_C + 3 && T > BOIL_C - 1) return 4000; // nucleate boiling
  return 900;
}

function vaporDensity(Tc: number): number {
  const psat = 610.78 * Math.exp((17.27 * Tc) / (Tc + 237.3));
  return psat / (461.5 * (Tc + KELVIN));
}

/** Implicit (unconditionally stable) heat exchange between two lumped bodies. Returns J moved a → b. */
export function exchange(Ta: number, Ca: number, Tb: number, Cb: number, hA: number, dt: number): number {
  if (Ca <= 0 || Cb <= 0 || hA <= 0) return 0;
  const Teq = (Ca * Ta + Cb * Tb) / (Ca + Cb);
  const k = Math.exp(-hA * dt * (1 / Ca + 1 / Cb));
  const TaNew = Teq + (Ta - Teq) * k;
  return (Ta - TaNew) * Ca;
}

/**
 * What's inside a pot or pan: water and/or oil at one (well-mixed) temperature.
 * Water pins at 212 °F and boils off; covered and very full it boils over. Oil climbs past its smoke
 * point (smokes) toward its flash point (can catch fire).
 */
export class Contents {
  water = 0;
  oil = 0;
  /** Dissolved starch (pasta water), kg — makes it foam and boil over more easily. */
  starch = 0;
  T = ROOM_C;
  lid = false;
  /** 0 = still, ~0.3 = simmer, 1 = rolling boil. */
  vigor = 0;
  /** Smoke production 0..1 (oil past its smoke point). */
  smoke = 0;
  /** Oil hot enough to ignite if exposed to flame. */
  atFlashPoint = false;
  boilingOver = false;
  /** Water lost to boil-over since last read, kg. */
  spilled = 0;
  /** Steam produced per second, kg/s (for visuals). */
  steamRate = 0;
  /** Heat drawn by food sitting in the liquid this step, J. */
  load = 0;

  constructor(
    /** Inner floor area, m², and inner wall height, m. */
    readonly area: number,
    readonly depth: number,
  ) {}

  get kg(): number {
    return this.water + this.oil;
  }

  get heatCapacity(): number {
    return this.water * LIQUIDS.water.cp + this.oil * LIQUIDS.oil.cp;
  }

  /** Volume, m³. */
  get volume(): number {
    return this.water / LIQUIDS.water.rho + this.oil / LIQUIDS.oil.rho;
  }

  /** Liquid height in the upright container, m. */
  get level(): number {
    return this.area > 0 ? this.volume / this.area : 0;
  }

  get fill(): number {
    return this.depth > 0 ? this.level / this.depth : 0;
  }

  /** Dominant liquid (for food env and visuals). */
  get kind(): LiquidKind | null {
    if (this.kg < 1e-4) return null;
    return this.oil > this.water ? 'oil' : 'water';
  }

  /** Mix in liquid at temperature T. */
  add(kind: LiquidKind, kg: number, T: number = ROOM_C): void {
    if (kg <= 0) return;
    const C0 = this.heatCapacity;
    const C1 = kg * LIQUIDS[kind].cp;
    if (kind === 'water') this.water += kg;
    else this.oil += kg;
    this.T = C0 + C1 > 0 ? (this.T * C0 + T * C1) / (C0 + C1) : T;
  }

  /** Remove kg proportionally from what's there (pouring out). Returns what came out per kind. */
  remove(kg: number): { water: number; oil: number } {
    const total = this.kg;
    if (total <= 0) return { water: 0, oil: 0 };
    const f = Math.min(kg / total, 1);
    // Oil floats on water, so it pours out first.
    const oil = Math.min(this.oil, kg);
    const water = Math.min(this.water, Math.max(0, kg - oil));
    this.oil -= oil;
    this.water -= water;
    this.starch *= 1 - f;
    return { water, oil };
  }

  /**
   * Exchange heat with the pan (°C, heat capacity J/K) and the room. Returns J taken from the pan.
   */
  step(dt: number, panT: number, panC: number): number {
    const C = this.heatCapacity;
    this.steamRate = 0;
    if (C <= 0) {
      this.vigor = this.smoke = 0;
      this.boilingOver = false;
      return 0;
    }
    const kind = this.kind!;
    const wetted = this.area * (1 + Math.min(this.fill, 1) * 1.2);
    const hA = panToLiquidH(kind, this.T, panT) * wetted;
    const fromPan = exchange(panT, panC, this.T, C, hA, dt);
    let E = fromPan - this.load;
    this.load = 0;

    // Losses from the free surface: convection + evaporation (a lid traps most of it).
    const lidF = this.lid ? 0.12 : 1;
    E -= 10 * this.area * (this.T - ROOM_C) * dt * lidF;
    if (this.water > 0 && this.T < BOIL_C) {
      const hm = 10 / 1200;
      const evap = Math.max(0, hm * (vaporDensity(this.T) - 0.01)) * this.area * lidF * (1 + 2 * this.vigor);
      const m = Math.min(evap * dt, this.water);
      this.water -= m;
      E -= m * LATENT;
      this.steamRate = evap;
    }

    let T = this.T + E / C;
    this.vigor = 0;
    if (this.water > 1e-4 && T > BOIL_C) {
      // Boiling: water pins at 212 °F, the excess becomes steam.
      const excess = (T - BOIL_C) * this.heatCapacity;
      const boiled = Math.min(excess / LATENT, this.water);
      this.water -= boiled;
      T = BOIL_C;
      const power = excess / Math.max(dt, 1e-6);
      this.steamRate = boiled / Math.max(dt, 1e-6);
      this.vigor = Math.min(power / (this.area * 30000), 1);
    } else if (this.water > 1e-4 && T > BOIL_C - 8) {
      this.vigor = ((T - (BOIL_C - 8)) / 8) * 0.25; // first bubbles / simmer
    }
    this.T = T;

    // Boil-over: covered, rolling, nearly full (starchy water foams much sooner).
    const foam = 1 + this.starch * 400;
    this.boilingOver = this.water > 0 && this.vigor > 0.5 && this.fill * (this.lid ? 1.35 : 1) * foam > 0.9;
    if (this.boilingOver) {
      const m = Math.min(this.water, 0.015 * dt * this.vigor);
      this.water -= m;
      this.spilled += m;
    }

    // Oil: smoke past the smoke point, flash point danger.
    if (this.oil > 1e-4 && this.water < this.oil * 0.05) {
      this.smoke = Math.min(Math.max((this.T - LIQUIDS.oil.smokeC) / 25, 0), 1);
      this.atFlashPoint = this.T >= LIQUIDS.oil.flashC;
    } else {
      this.smoke = 0;
      this.atFlashPoint = false;
    }
    return fromPan;
  }
}
