import { Contents } from './liquid';
import { fToC, ROOM_C } from './units';
import type { HeatSource } from './appliances';

export const FRYER = {
  /** Oil well: 18 × 22 cm, 24 cm deep; filled with ~2.8 kg (3 L) of oil ≈ 7.7 cm deep. */
  area: 0.18 * 0.22,
  depth: 0.24,
  oilKg: 2.8,
  heaterW: 1800,
  hysteresisC: 2,
  minF: 250,
  maxF: 400,
};

/**
 * Countertop deep fryer: a thermostat-controlled heater in an oil well. Dropping cold, wet food in
 * pulls the oil temperature down (sensible heat + boiling off its surface water); the heater recovers it.
 */
export class DeepFryer implements HeatSource {
  readonly kind = 'fryer';
  readonly oil = new Contents(FRYER.area, FRYER.depth);
  setC = fToC(350);
  on = false;
  heating = false;

  constructor(readonly id: string) {
    this.oil.add('oil', FRYER.oilKg, ROOM_C);
  }

  step(dt: number): void {
    const o = this.oil;
    if (this.on && o.oil > 0.2) {
      if (o.T < this.setC - FRYER.hysteresisC) this.heating = true;
      else if (o.T > this.setC + FRYER.hysteresisC) this.heating = false;
    } else this.heating = false;
    // No pan: the element is immersed, so heat goes straight into the oil.
    o.step(dt, o.T, 1);
    if (o.heatCapacity > 0) o.T += ((this.heating ? FRYER.heaterW : 0) * dt) / o.heatCapacity;
  }

  readoutC(): number {
    return this.oil.T;
  }

  firing(): boolean {
    return this.heating;
  }
}
