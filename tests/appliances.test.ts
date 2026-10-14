import { describe, expect, it } from 'vitest';
import { AirFryer, Burner, Griddle, Grill, Oven, SousVide } from '../src/sim/appliances';
import { Cookware, COOKWARE } from '../src/sim/cookware';
import { cToF, fToC } from '../src/sim/units';
import { FoodItem } from '../src/sim/food';
import { H } from '../src/sim/foodThermal';

const DT = 0.5;
function until(step: () => void, cond: () => boolean, maxS = 7200): number {
  let t = 0;
  while (!cond() && t < maxS) {
    step();
    t += DT;
  }
  return t;
}

describe('oven', () => {
  it('preheats to 350 °F in 10–15 min, then cycles around the setpoint', () => {
    const o = new Oven('oven');
    o.setF(350);
    o.setMode('bake');
    const t = until(() => o.step(DT), () => o.preheated);
    expect(t / 60).toBeGreaterThan(10);
    expect(t / 60).toBeLessThan(15);
    let lo = Infinity;
    let hi = -Infinity;
    let cycles = 0;
    let was = o.heating;
    for (let i = 0; i < 3600 / DT; i++) {
      o.step(DT);
      if (i > 600 / DT) {
        lo = Math.min(lo, cToF(o.airT));
        hi = Math.max(hi, cToF(o.airT));
      }
      if (o.heating && !was) cycles++;
      was = o.heating;
    }
    expect(lo).toBeGreaterThan(330);
    expect(hi).toBeLessThan(370);
    expect(cycles).toBeGreaterThan(3); // thermostat clicks on and off
  });

  it('opening the door drops the air temperature fast; it recovers when closed', () => {
    const o = new Oven('oven');
    o.setF(400);
    o.setMode('bake');
    until(() => o.step(DT), () => o.preheated);
    for (let i = 0; i < 600 / DT; i++) o.step(DT);
    const hot = o.airT;
    o.doorOpen = true;
    for (let i = 0; i < 30 / DT; i++) o.step(DT);
    expect(cToF(hot) - cToF(o.airT)).toBeGreaterThan(50);
    o.doorOpen = false;
    const back = until(() => o.step(DT), () => o.airT > hot - 5);
    expect(back / 60).toBeLessThan(6);
  });

  it('convection fan couples heat faster', () => {
    const a = new Oven('a');
    const b = new Oven('b');
    for (const o of [a, b]) {
      o.setF(400);
      o.setMode('bake');
    }
    b.fan = true;
    for (let i = 0; i < 300 / DT; i++) {
      a.step(DT);
      b.step(DT);
    }
    expect(b.wallT).toBeGreaterThan(a.wallT);
  });
});

describe('stovetop', () => {
  it('turning the burner up heats a cast-iron pan faster and hotter', () => {
    const run = (knob: number) => {
      const b = new Burner('b');
      b.knob = knob;
      const pan = new Cookware('ci', COOKWARE['cast-iron-pan']);
      pan.burner = b;
      for (let i = 0; i < 480 / DT; i++) {
        b.step(DT);
        pan.step(DT);
      }
      return cToF(pan.T);
    };
    const low = run(0.2);
    const med = run(0.5);
    const high = run(1);
    expect(med).toBeGreaterThan(low + 60);
    expect(high).toBeGreaterThan(med + 60);
    expect(high).toBeGreaterThan(450); // ripping hot after 8 min on high
    expect(low).toBeLessThan(400);
  });

  it('a cold steak drops a thin stainless pan more than cast iron', () => {
    const drop = (id: string) => {
      const pan = new Cookware(id, COOKWARE[id]);
      pan.T = fToC(450);
      // Hold the pan at equilibrium at 450 °F (heat in = losses), then add the steak.
      pan.step(0);
      const probe = new Cookware(id, COOKWARE[id]);
      probe.T = pan.T;
      probe.step(1);
      pan.externalW = (pan.T - probe.T) * probe.heatCapacity;
      const steak = new FoodItem('steak', [0.14, 0.0381, 0.095]);
      const before = pan.T;
      let min = before;
      for (let i = 0; i < 60 / DT; i++) {
        steak.setEnv(3, { medium: 'air', fluidT: 60, fluidH: 10, contactT: pan.T, contactH: H.panContact, contactFrac: 0.9, radT: 22, radView: 0 });
        steak.step(DT);
        pan.load += steak.thermal.contactHeat;
        steak.thermal.contactHeat = 0;
        pan.step(DT);
        min = Math.min(min, pan.T);
      }
      return cToF(before) - cToF(min);
    };
    const ci = drop('cast-iron-pan');
    const ss = drop('stainless-pan');
    expect(ss).toBeGreaterThan(ci * 1.6);
    expect(ci).toBeGreaterThan(10);
  });

  it('cast iron holds heat after the burner is turned off', () => {
    const cool = (id: string) => {
      const b = new Burner('b');
      b.knob = 1;
      const pan = new Cookware(id, COOKWARE[id]);
      pan.burner = b;
      until(
        () => {
          b.step(DT);
          pan.step(DT);
        },
        () => cToF(pan.T) >= 450,
      );
      b.knob = 0;
      for (let i = 0; i < 300 / DT; i++) {
        b.step(DT);
        pan.step(DT);
      }
      return cToF(pan.T);
    };
    expect(cool('cast-iron-pan')).toBeGreaterThan(cool('stainless-pan') + 20);
  });
});

describe('griddle, grill, air fryer, sous vide', () => {
  it('griddle heats to its setpoint and holds it', () => {
    const g = new Griddle('g');
    g.setF(375);
    const t = until(() => g.step(DT), () => cToF(g.T) >= 370);
    expect(t / 60).toBeGreaterThan(5);
    expect(t / 60).toBeLessThan(20);
    for (let i = 0; i < 1200 / DT; i++) g.step(DT);
    expect(Math.abs(cToF(g.T) - 375)).toBeLessThan(12);
  });

  it('grill: hot zone vs cool zone, lid traps heat, fat flares up', () => {
    const g = new Grill('grill');
    g.knobs[0] = 1;
    g.knobs[1] = 0.2;
    for (let i = 0; i < 600 / DT; i++) g.step(DT);
    expect(cToF(g.grateT[0])).toBeGreaterThan(cToF(g.grateT[1]) + 150);
    expect(cToF(g.grateT[0])).toBeGreaterThan(500);
    const open = g.hoodT;
    g.lidClosed = true;
    for (let i = 0; i < 600 / DT; i++) g.step(DT);
    expect(cToF(g.hoodT)).toBeGreaterThan(cToF(open) + 250);
    g.lidClosed = false;
    g.addDrippings(0.01);
    g.step(DT);
    expect(g.flaring).toBe(true);
  });

  it('air fryer preheats in a few minutes and shuts off when the timer runs out', () => {
    const a = new AirFryer('af');
    a.setC = fToC(400);
    a.timer = 15 * 60;
    let done = false;
    a.onDone = () => (done = true);
    const t = until(() => a.step(DT), () => cToF(a.T) >= 395);
    expect(t / 60).toBeLessThan(5);
    for (let i = 0; i < 900 / DT; i++) a.step(DT);
    expect(done).toBe(true);
    expect(a.heating).toBe(false);
  });

  it('sous vide reaches 131 °F in ~15–25 min and holds within 0.3 °F', () => {
    const s = new SousVide('sv');
    s.setC = fToC(131);
    s.on = true;
    const t = until(() => s.step(DT), () => cToF(s.T) >= 130.8);
    expect(t / 60).toBeGreaterThan(10);
    expect(t / 60).toBeLessThan(25);
    let maxErr = 0;
    for (let i = 0; i < 3600 / DT; i++) {
      s.step(DT);
      if (i > 300 / DT) maxErr = Math.max(maxErr, Math.abs(cToF(s.T) - 131));
    }
    expect(maxErr).toBeLessThan(0.3);
  });
});
