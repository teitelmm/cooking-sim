import { FOODS, type FoodProps } from '../data/foods';
import { donenessOf, type Doneness } from './doneness';
import { FoodThermal, type FaceEnv, type FoodThermalOptions, airEnv } from './foodThermal';
import { cToF, fToC, FRIDGE_C } from './units';

/** Plane n·p = d (local coords); the inside of a piece is n·p ≤ d. */
export interface Plane {
  n: [number, number, number];
  d: number;
}

export type SafetyState = 'unsafe' | 'safe' | 'n/a';

export interface FoodSummary {
  id: string;
  coreF: number;
  surfaceF: number;
  peakCoreF: number;
  doneness: Doneness;
  /** Mean browning / char per local face (+x, −x, +y, −y, +z, −z). */
  browning: number[];
  char: number[];
  /** Remaining water vs raw, 0..1. */
  juiciness: number;
  cookLossPct: number;
  tenderness: number;
  gelatinized: number;
  softness: number;
  safety: SafetyState;
}

/** A cookable piece of food: thermal model + interpretation (doneness, safety, juiciness). */
export class FoodItem {
  readonly props: FoodProps;
  readonly thermal: FoodThermal;
  /** Time spent resting off heat since last cooked, s. */
  restTime = 0;
  /** This piece's center in the frame of the original whole food (pieces after cutting), m. */
  readonly origin: [number, number, number];
  /** Cut planes bounding this piece, in its local frame (n·p ≤ d is inside). */
  readonly cuts: Plane[];
  readonly size: [number, number, number];

  constructor(
    readonly id: string,
    size: [number, number, number],
    opts: FoodThermalOptions & { props?: FoodProps; origin?: [number, number, number]; cuts?: Plane[] } = {},
  ) {
    this.size = size;
    this.origin = opts.origin ?? [0, 0, 0];
    this.cuts = opts.cuts ?? [];
    const props = opts.props ?? FOODS[id];
    if (!props) throw new Error(`no food props for ${id}`);
    this.props = props;
    const initialT = opts.initialT ?? (props.protein || props.kind === 'fat' ? FRIDGE_C : undefined);
    this.thermal = new FoodThermal(props, size, { ...opts, initialT });
  }

  step(dt: number): void {
    this.thermal.step(dt);
    const hot = this.thermal.env.some((e) => e.contactFrac > 0 || e.fluidT > 60 || e.radView > 0);
    this.restTime = hot ? 0 : this.restTime + dt;
  }

  setEnv(dir: number, env: FaceEnv): void {
    this.thermal.env[dir] = env;
  }

  setAllEnv(env: FaceEnv): void {
    this.thermal.setAllEnv(env);
  }

  rest(T = 22): void {
    this.thermal.setAllEnv(airEnv(T));
  }

  get coreF(): number {
    return cToF(this.thermal.coreTemp());
  }

  /** Doneness from the peak core temperature (meat). */
  doneness(): Doneness {
    return donenessOf(this.thermal.corePeak());
  }

  /** Food-safety (feedback only): did every part of it reach the safe temperature? */
  safety(): SafetyState {
    if (!this.props.safeTempF) return 'n/a';
    return this.thermal.minPeak() >= fToC(this.props.safeTempF) ? 'safe' : 'unsafe';
  }

  summary(): FoodSummary {
    const t = this.thermal;
    const dirs = [0, 1, 2, 3, 4, 5];
    return {
      id: this.id,
      coreF: cToF(t.coreTemp()),
      surfaceF: cToF(t.surfaceTemp()),
      peakCoreF: cToF(t.corePeak()),
      doneness: this.doneness(),
      browning: dirs.map((d) => t.browning(d)),
      char: dirs.map((d) => t.char(d)),
      juiciness: t.juiciness(),
      cookLossPct: (1 - t.mass() / t.mass0) * 100,
      tenderness: this.props.collagen ? 1 - t.mean(t.collagen) / this.props.collagen : 1,
      gelatinized: t.mean(t.starch),
      softness: t.mean(t.soft),
      safety: this.safety(),
    };
  }
}
