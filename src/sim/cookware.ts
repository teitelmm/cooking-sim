import { radiation, type Burner } from './appliances';
import { Contents } from './liquid';
import { ROOM_C } from './units';

export interface CookwareSpec {
  /** Body mass, kg, and specific heat, J/(kg·K). */
  mass: number;
  cp: number;
  /** Cooking surface area (base), m², and total outer area for losses, m². */
  baseArea: number;
  outerArea: number;
  emissivity: number;
  /** Lateral heat spreading, W/K: center-to-rim hot spot = flame power ÷ spread (tri-ply ≫ cast iron ≫ thin steel). */
  spread: number;
  /** Inner radius and wall height, m (containers that hold liquid). */
  innerRadius?: number;
  depth?: number;
  /** Nonstick: food doesn't stick, but the coating must stay under ~500 °F. */
  nonstick?: boolean;
}

/**
 * A pan/pot/sheet as one lumped thermal mass plus a flame-driven hot spot: the center runs hotter than
 * the rim by (flame power ÷ lateral spreading). Food draws heat from the whole body, so heavy cast iron
 * barely dips under a cold steak while thin stainless drops hard and recovers fast. Contents (water/oil)
 * are layered on by the liquid model.
 */
export class Cookware {
  /** Mean body temperature, °C. */
  T = ROOM_C;
  burner: Burner | null = null;
  /** Fraction of the burner's output this pan captures (pan size vs flame). */
  coupling = 1;
  /** Extra external heat input (W) — oven air, griddle — set by the bridge each tick. */
  externalW = 0;
  /** Ambient air temperature around the pan (oven cavity etc.). */
  ambientC = ROOM_C;
  ambientH = 10;
  /** Heat drawn by food/contents this step, J. */
  load = 0;
  /** Current center-minus-rim difference, °C. */
  hotSpot = 0;
  /** Liquid inside (pots, pans holding oil). */
  readonly contents: Contents | null;

  constructor(
    readonly id: string,
    readonly spec: CookwareSpec,
  ) {
    this.contents = spec.innerRadius && spec.depth ? new Contents(Math.PI * spec.innerRadius ** 2, spec.depth) : null;
  }

  get heatCapacity(): number {
    return this.spec.mass * this.spec.cp;
  }

  /** Hottest point (over the flame). */
  get center(): number {
    return this.T + this.hotSpot / 2;
  }

  /** Surface temperature at a radial position 0 (center) … 1 (edge). */
  surfaceAt(r: number): number {
    const t = Math.min(Math.max(r, 0), 1);
    return this.T + this.hotSpot * (0.5 - t);
  }

  step(dt: number): void {
    const flame = this.burner ? this.burner.deliveredW(this.coupling) : 0;
    const loss = this.spec.outerArea * this.ambientH * (this.T - this.ambientC) + radiation(this.spec.outerArea, this.spec.emissivity, this.T) - (this.ambientC > ROOM_C + 5 ? radiation(this.spec.outerArea, this.spec.emissivity, this.ambientC) : 0);
    this.T += ((flame + this.externalW - loss) * dt - this.load) / this.heatCapacity;
    this.load = 0;
    if (this.contents) {
      this.contents.flameExposed = !!this.burner && this.burner.spec.fuel === 'gas' && this.burner.power > 50;
      this.T -= this.contents.step(dt, this.T, this.heatCapacity) / this.heatCapacity;
    }
    // Hot spot relaxes toward flame/spread with the pan's lateral time constant.
    const target = flame / this.spec.spread;
    const tau = this.heatCapacity / (this.spec.spread * 8);
    this.hotSpot += (target - this.hotSpot) * (1 - Math.exp(-dt / tau));
  }
}

export const COOKWARE: Record<string, CookwareSpec> = {
  'cast-iron-pan': { mass: 2.7, cp: 460, baseArea: 0.045, outerArea: 0.13, emissivity: 0.75, spread: 28, innerRadius: 0.122, depth: 0.045 },
  'stainless-pan': { mass: 1.2, cp: 520, baseArea: 0.042, outerArea: 0.12, emissivity: 0.35, spread: 60, innerRadius: 0.118, depth: 0.045 },
  'nonstick-pan': { mass: 0.9, cp: 900, baseArea: 0.04, outerArea: 0.11, emissivity: 0.85, spread: 70, innerRadius: 0.115, depth: 0.04, nonstick: true },
  'saute-pan': { mass: 1.8, cp: 520, baseArea: 0.05, outerArea: 0.16, emissivity: 0.35, spread: 60, innerRadius: 0.13, depth: 0.07 },
  'stock-pot': { mass: 2.0, cp: 500, baseArea: 0.045, outerArea: 0.21, emissivity: 0.3, spread: 50, innerRadius: 0.114, depth: 0.2 },
  'oil-bottle': { mass: 0.05, cp: 1500, baseArea: 0.004, outerArea: 0.05, emissivity: 0.9, spread: 5, innerRadius: 0.033, depth: 0.2 },
  'wire-rack': { mass: 0.4, cp: 500, baseArea: 0.08, outerArea: 0.06, emissivity: 0.3, spread: 10 },
  'sheet-pan': { mass: 1.0, cp: 900, baseArea: 0.1, outerArea: 0.22, emissivity: 0.4, spread: 40 },
  'fry-basket': { mass: 0.5, cp: 500, baseArea: 0.05, outerArea: 0.15, emissivity: 0.3, spread: 10 },
  'air-fryer-basket': { mass: 0.7, cp: 900, baseArea: 0.06, outerArea: 0.16, emissivity: 0.9, spread: 30 },
  'mixing-bowl': { mass: 0.6, cp: 500, baseArea: 0.02, outerArea: 0.1, emissivity: 0.3, spread: 15, innerRadius: 0.1, depth: 0.1 },
};
