import { describe, expect, it } from 'vitest';
import { Burner } from '../src/sim/appliances';
import { Cookware, COOKWARE } from '../src/sim/cookware';
import { cToF } from '../src/sim/units';

const DT = 0.5;
function onBurner(id: string, knob: number) {
  const b = new Burner('b');
  b.knob = knob;
  const pan = new Cookware(id, COOKWARE[id]);
  pan.burner = b;
  const step = () => {
    b.step(DT);
    pan.step(DT);
  };
  return { b, pan, step, c: pan.contents! };
}

describe('liquids in cookware', () => {
  it('3 qt of water in a stock pot reaches a rolling boil on high in ~10–20 min', () => {
    const { step, c } = onBurner('stock-pot', 1);
    c.add('water', 2.8);
    let t = 0;
    let simmer = -1;
    while (c.vigor < 0.6 && t < 3600) {
      step();
      t += DT;
      if (simmer < 0 && c.vigor > 0.1) simmer = t;
    }
    expect(t / 60).toBeGreaterThan(9);
    expect(t / 60).toBeLessThan(20);
    expect(simmer).toBeGreaterThan(0);
    expect(cToF(c.T)).toBeCloseTo(212, 0);
    // It keeps boiling away.
    const w = c.water;
    for (let i = 0; i < 600 / DT; i++) step();
    expect(c.water).toBeLessThan(w - 0.1);
    expect(cToF(c.T)).toBeCloseTo(212, 0);
  });

  it('a lid gets it boiling sooner', () => {
    const time = (lid: boolean) => {
      const { step, c } = onBurner('stock-pot', 1);
      c.add('water', 2.8);
      c.lid = lid;
      let t = 0;
      while (c.vigor < 0.6 && t < 3600) {
        step();
        t += DT;
      }
      return t;
    };
    expect(time(true)).toBeLessThan(time(false) * 0.95);
  });

  it('covered, full, on high: it boils over', () => {
    const { step, c } = onBurner('stock-pot', 1);
    c.add('water', 6.0);
    c.lid = true;
    let over = false;
    for (let i = 0; i < 3600 / DT && !over; i++) {
      step();
      over = c.boilingOver;
    }
    expect(over).toBe(true);
    expect(c.spilled).toBeGreaterThan(0);
  });

  it('oil in a pan on high climbs past its smoke point and smokes', () => {
    const { step, c } = onBurner('stainless-pan', 1);
    c.add('oil', 0.03);
    let t = 0;
    while (c.smoke < 0.3 && t < 1800) {
      step();
      t += DT;
    }
    expect(c.smoke).toBeGreaterThan(0.3);
    expect(cToF(c.T)).toBeGreaterThan(450);
    expect(t / 60).toBeLessThan(8);
  });

  it('pouring mixes temperatures and removes oil first', () => {
    const { c } = onBurner('stock-pot', 0);
    c.add('water', 1, 20);
    c.add('water', 1, 80);
    expect(c.T).toBeCloseTo(50, 1);
    c.add('oil', 0.1, 50);
    const out = c.remove(0.05);
    expect(out.oil).toBeCloseTo(0.05, 5);
    expect(out.water).toBe(0);
  });
});
