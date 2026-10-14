import { AIR_FRYER, BURNER, GRIDDLE, GRILL, OVEN, SOUS_VIDE, WATER_CP, type BurnerSpec } from '../data/appliances';
import { fToC, ROOM_C, SIGMA, KELVIN } from './units';

/**
 * Heat sources. All pure TypeScript and stepped in game time. Each exposes what food or cookware near it
 * experiences (temperatures, power delivered) plus a readout for its dial/display.
 */
export interface HeatSource {
  readonly id: string;
  readonly kind: string;
  step(dt: number): void;
  /** What the appliance's own display/dial shows, °C (NaN = no readout). */
  readoutC(): number;
  /** True when the heater/flame is currently firing (for visuals and sound). */
  firing(): boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** First-order approach of `x` toward `target` with time constant tau. */
const approach = (x: number, target: number, tau: number, dt: number) => x + (target - x) * (1 - Math.exp(-dt / Math.max(tau, 1e-6)));

// ---------------------------------------------------------------------------- burner

/** A stovetop burner. Knob 0 = off, 0.01–1 = low → high. Delivers watts to whatever cookware is on it. */
export class Burner implements HeatSource {
  readonly kind = 'burner';
  knob = 0;
  /** Current output (W), lags the knob by the spec's time constant. */
  power = 0;

  constructor(
    readonly id: string,
    readonly spec: BurnerSpec = BURNER,
  ) {}

  targetPower(): number {
    return this.knob <= 0.005 ? 0 : this.spec.minW + (this.spec.maxW - this.spec.minW) * this.knob;
  }

  step(dt: number): void {
    this.power = approach(this.power, this.targetPower(), this.spec.tau, dt);
  }

  /** Heat into a pan sitting on it (W). `coupling` < 1 for small pans on a big flame. */
  deliveredW(coupling = 1): number {
    return this.power * this.spec.efficiency * coupling;
  }

  readoutC(): number {
    return NaN;
  }

  firing(): boolean {
    return this.power > 20;
  }
}

// ---------------------------------------------------------------------------- flat-top griddle

/** Thermostatic steel flat-top. Heavy plate: slow to heat, barely drops under food. */
export class Griddle implements HeatSource {
  readonly kind = 'griddle';
  /** Setpoint °C; NaN = off. */
  setC = NaN;
  T = ROOM_C;
  heating = false;
  /** Heat drawn by food this step, J (set by the bridge). */
  load = 0;

  constructor(readonly id: string) {}

  setF(f: number | null): void {
    this.setC = f === null ? NaN : fToC(clamp(f, GRIDDLE.minF, GRIDDLE.maxF));
  }

  step(dt: number): void {
    const on = !Number.isNaN(this.setC);
    if (on) {
      if (this.T < this.setC - 4) this.heating = true;
      else if (this.T > this.setC + 4) this.heating = false;
    } else this.heating = false;
    const qin = this.heating ? GRIDDLE.heaterW * GRIDDLE.efficiency : 0;
    const qout = GRIDDLE.lossWPerK * (this.T - ROOM_C) + radiation(0.22, 0.6, this.T);
    this.T += ((qin - qout) * dt - this.load) / GRIDDLE.heatCapacity;
    this.load = 0;
  }

  readoutC(): number {
    return this.T;
  }

  firing(): boolean {
    return this.heating;
  }
}

/** Radiated power from area (m²) with emissivity at T (°C) to a room at ROOM_C, W. */
export function radiation(area: number, emissivity: number, Tc: number): number {
  const T = Tc + KELVIN;
  const Ta = ROOM_C + KELVIN;
  return emissivity * SIGMA * area * (T ** 4 - Ta ** 4);
}

// ---------------------------------------------------------------------------- grill

/** Gas grill with independent zones, a hood, and fat flare-ups. */
export class Grill implements HeatSource {
  readonly kind = 'grill';
  /** Knob per zone 0..1. */
  readonly knobs: number[] = Array(GRILL.zones).fill(0);
  readonly grateT: number[] = Array(GRILL.zones).fill(ROOM_C);
  readonly radiantT: number[] = Array(GRILL.zones).fill(ROOM_C);
  hoodT = ROOM_C;
  lidClosed = false;
  /** Fat waiting to ignite (kg) and remaining flare time (s). */
  fat = 0;
  flare = 0;
  load: number[] = Array(GRILL.zones).fill(0);

  constructor(readonly id: string) {}

  step(dt: number): void {
    let hoodIn = 0;
    for (let z = 0; z < GRILL.zones; z++) {
      const k = this.knobs[z];
      const target = k > 0.005 ? 180 + (GRILL.radiantMaxC - 180) * k : ROOM_C;
      this.radiantT[z] = approach(this.radiantT[z], target, 70, dt);
      const P = k > 0.005 ? GRILL.zoneW * (0.15 + 0.85 * k) : 0;
      // Grate is heated by radiation from below and hot combustion gases; loses to air above.
      const qin = P * 0.5;
      const air = this.lidClosed ? this.hoodT : ROOM_C + 25;
      const qout = 6 * (this.grateT[z] - air) + radiation(0.08, 0.8, this.grateT[z]) * (this.lidClosed ? 0.3 : 1);
      this.grateT[z] += ((qin - qout) * dt - this.load[z]) / GRILL.grateHeatCapacity;
      this.load[z] = 0;
      hoodIn += P * 0.35;
    }
    // Hood air: heated when the lid is closed, dumps to room when open.
    const hoodLoss = this.lidClosed ? 7 * (this.hoodT - ROOM_C) : 120 * (this.hoodT - ROOM_C);
    this.hoodT += ((this.lidClosed ? hoodIn : hoodIn * 0.05) - hoodLoss) * dt / GRILL.hoodHeatCapacity;
    // Flare-ups: dripped fat ignites on the hot flame tamers.
    const hot = Math.max(...this.radiantT) > 300;
    if (hot && this.fat > GRILL.flareThresholdKg) {
      this.flare += this.fat * 1000 * GRILL.flareSecondsPerGram;
      this.fat = 0;
    }
    if (this.flare > 0) this.flare = Math.max(0, this.flare - dt * (this.lidClosed ? 2.5 : 1)); // closing the lid starves it
  }

  /** Feed fat dripping off food over zone z (kg). */
  addDrippings(kg: number): void {
    this.fat += kg;
  }

  get flaring(): boolean {
    return this.flare > 0;
  }

  readoutC(): number {
    return this.hoodT;
  }

  firing(): boolean {
    return this.knobs.some((k) => k > 0.005);
  }
}

// ---------------------------------------------------------------------------- oven

export type OvenMode = 'off' | 'bake' | 'broil';

/** Two-node oven (cavity air + walls/racks) with thermostat cycling, bake/broil and convection fan. */
export class Oven implements HeatSource {
  readonly kind = 'oven';
  mode: OvenMode = 'off';
  setC = fToC(350);
  fan = false;
  doorOpen = false;
  airT = ROOM_C;
  wallT = ROOM_C;
  heating = false;
  /** Broil element glow temperature, °C. */
  elementT = ROOM_C;
  /** Has the oven reached its setpoint since it was turned on? (the "preheated" beep). */
  preheated = false;
  load = 0;
  /** Seconds since mode/setpoint last changed. */
  sinceChange = 0;

  constructor(readonly id: string) {}

  setF(f: number): void {
    this.setC = fToC(clamp(f, OVEN.minF, OVEN.maxF));
    this.preheated = false;
    this.sinceChange = 0;
  }

  setMode(m: OvenMode): void {
    if (m !== this.mode) {
      this.mode = m;
      this.preheated = false;
      this.sinceChange = 0;
    }
  }

  step(dt: number): void {
    this.sinceChange += dt;
    if (this.mode === 'bake') {
      if (this.airT < this.setC - OVEN.hysteresisC) this.heating = true;
      else if (this.airT > this.setC + OVEN.hysteresisC) this.heating = false;
      if (!this.preheated && this.airT >= this.setC - 2) this.preheated = true;
    } else this.heating = this.mode === 'broil';
    const P = this.heating ? (this.mode === 'broil' ? OVEN.broilW : OVEN.bakeW) : 0;
    this.elementT = approach(this.elementT, this.mode === 'broil' ? OVEN.broilElementC : this.heating ? 600 : ROOM_C, 25, dt);
    const couple = OVEN.airWallWPerK * (this.fan ? 2 : 1);
    const toAir = P * (this.mode === 'broil' ? 0.25 : 0.3);
    const toWall = P - toAir;
    const airWall = couple * (this.airT - this.wallT);
    const airLoss = this.doorOpen ? OVEN.doorOpenAirLossWPerK * (this.airT - ROOM_C) : 0.8 * (this.airT - ROOM_C);
    const wallLoss = OVEN.wallLossWPerK * (this.wallT - ROOM_C) * (this.doorOpen ? 2.5 : 1);
    this.airT += ((toAir - airWall - airLoss) * dt - this.load * 0.6) / OVEN.airHeatCapacity;
    this.wallT += ((toWall + airWall - wallLoss) * dt - this.load * 0.4) / OVEN.wallHeatCapacity;
    this.load = 0;
  }

  readoutC(): number {
    return this.airT;
  }

  firing(): boolean {
    return this.heating;
  }
}

// ---------------------------------------------------------------------------- air fryer

export class AirFryer implements HeatSource {
  readonly kind = 'airFryer';
  setC = fToC(380);
  /** Remaining timer, s (0 = off). */
  timer = 0;
  T = ROOM_C;
  heating = false;
  /** Basket slid in (safety switch). */
  basketIn = true;
  load = 0;
  /** Fires once when the timer runs out. */
  onDone: (() => void) | null = null;

  constructor(readonly id: string) {}

  get running(): boolean {
    return this.timer > 0 && this.basketIn;
  }

  step(dt: number): void {
    if (this.running) {
      this.timer = Math.max(0, this.timer - dt);
      if (this.timer === 0) this.onDone?.();
      if (this.T < this.setC - AIR_FRYER.hysteresisC) this.heating = true;
      else if (this.T > this.setC + AIR_FRYER.hysteresisC) this.heating = false;
    } else this.heating = false;
    const qin = this.heating ? AIR_FRYER.heaterW : 0;
    const loss = AIR_FRYER.lossWPerK * (this.T - ROOM_C) * (this.basketIn ? 1 : 12);
    this.T += ((qin - loss) * dt - this.load) / AIR_FRYER.heatCapacity;
    this.load = 0;
  }

  readoutC(): number {
    return this.T;
  }

  firing(): boolean {
    return this.heating;
  }
}

// ---------------------------------------------------------------------------- sous vide

/** Immersion circulator in a water tub. Holds the bath within ~0.1 °C of setpoint. */
export class SousVide implements HeatSource {
  readonly kind = 'sousVide';
  setC = fToC(131);
  on = false;
  T = ROOM_C;
  waterKg = SOUS_VIDE.waterKg;
  power = 0;
  load = 0;
  private integral = 0;

  constructor(readonly id: string) {}

  step(dt: number): void {
    if (this.on && this.waterKg > 0.5) {
      // PI control, saturated at the heater rating.
      const err = this.setC - this.T;
      // Anti-windup: only integrate near the setpoint.
      if (Math.abs(err) < 1) this.integral = clamp(this.integral + err * dt, -40, 120);
      this.power = clamp(err * 1600 + this.integral * 3, 0, SOUS_VIDE.heaterW);
    } else this.power = 0;
    const loss = (SOUS_VIDE.lossWPerK + SOUS_VIDE.evapWPerK * Math.max(0, (this.T - ROOM_C) / 20)) * (this.T - ROOM_C);
    this.T += ((this.power - loss) * dt - this.load) / (this.waterKg * WATER_CP);
    this.load = 0;
  }

  readoutC(): number {
    return this.T;
  }

  firing(): boolean {
    return this.power > 10;
  }
}
