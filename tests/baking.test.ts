import { describe, expect, it } from 'vitest';
import { bakeReport, DoughState, doughProps, Mixture } from '../src/sim/baking';
import { FoodItem } from '../src/sim/food';
import { airEnv, Dir, ovenEnv } from '../src/sim/foodThermal';
import { cook } from '../src/sim/recipes';
import { cToF, fToC } from '../src/sim/units';

const bread = (waterG: number) => {
  const m = new Mixture();
  m.add('flour', 0.5);
  m.add('water', waterG / 1000);
  m.add('salt', 0.01);
  m.add('yeast', 0.007);
  m.stir(80);
  return m;
};

describe('mixing', () => {
  it('recognizes what you made from the ratios', () => {
    expect(bread(350).analyze().type).toBe('bread dough');
    expect(bread(350).analyze().hydration).toBeCloseTo(0.7 + 0.012 * 0.05 / 0.5, 1);
    const cookie = new Mixture();
    cookie.add('flour', 0.28);
    cookie.add('butter', 0.23);
    cookie.add('sugar', 0.3);
    cookie.add('egg', 0.1);
    cookie.add('baking-soda', 0.005);
    cookie.add('chocolate', 0.34);
    expect(cookie.analyze().type).toBe('cookie dough');
    const cake = new Mixture();
    cake.add('flour', 0.25);
    cake.add('sugar', 0.25);
    cake.add('butter', 0.11);
    cake.add('egg', 0.1);
    cake.add('milk', 0.24);
    cake.add('baking-powder', 0.01);
    expect(cake.analyze().type).toBe('cake batter');
    const pancake = new Mixture();
    pancake.add('flour', 0.19);
    pancake.add('milk', 0.36);
    pancake.add('egg', 0.05);
    pancake.add('baking-powder', 0.008);
    expect(pancake.analyze().type).toBe('pancake batter');
    expect(bread(480).analyze().notes.join()).toMatch(/too wet/);
    expect(bread(240).analyze().notes.join()).toMatch(/too dry/);
  });

  it('mixing quality rises with strokes; kneading builds gluten', () => {
    const m = bread(350);
    const q = m.mixQuality;
    expect(q).toBeGreaterThan(0.9);
    expect(m.gluten).toBeGreaterThan(0.3);
  });
});

function boule(m: Mixture, rise = 1): { food: FoodItem; dough: DoughState } {
  const a = m.analyze();
  const kg = a.totalKg;
  const vol = kg / doughProps(a).rho; // m³
  // A round loaf: wide ellipsoid; slack (wet) dough spreads flatter.
  const flat = a.hydration > 0.85 ? 0.42 : a.hydration < 0.55 ? 0.72 : 0.6;
  const r = Math.cbrt((3 * vol) / (4 * Math.PI * flat));
  const food = new FoodItem('dough', [2 * r, 2 * r * flat, 2 * r], { props: doughProps(a, rise), initialT: 24 });
  return { food, dough: new DoughState(a) };
}

describe('proofing and baking', () => {
  it('bread dough doubles in ~1–1.5 h at room temperature, barely moves in the fridge', () => {
    const warm = boule(bread(350));
    const cold = boule(bread(350));
    cold.food.thermal.T.fill(fToC(38));
    for (let t = 0; t < 90 * 60; t += 10) {
      warm.food.rest(fToC(78));
      warm.food.step(10);
      warm.dough.step(10, warm.food);
      cold.food.rest(fToC(38));
      cold.food.step(10);
      cold.dough.step(10, cold.food);
    }
    expect(warm.dough.rise).toBeGreaterThan(1.7);
    expect(warm.dough.rise).toBeLessThan(2.6);
    expect(cold.dough.rise).toBeLessThan(1.15);
  });

  const proofAndBake = (waterG: number) => {
    const m = bread(waterG);
    let { food, dough } = boule(m);
    for (let t = 0; t < 80 * 60; t += 10) {
      food.rest(fToC(78));
      food.step(10);
      dough.step(10, food);
    }
    // Into the oven at its risen size.
    const risen = boule(m, dough.rise);
    risen.dough.rise = dough.rise;
    food = risen.food;
    dough = risen.dough;
    for (let t = 0; t < 35 * 60; t += 2) {
      food.setAllEnv(ovenEnv(fToC(425)));
      food.setEnv(Dir.NY, { ...ovenEnv(fToC(425)), contactT: fToC(420), contactH: 200, contactFrac: 0.8 });
      food.step(2);
      dough.step(2, food);
    }
    food.setAllEnv(airEnv());
    cook(food, 600, 5);
    return bakeReport(food, dough);
  };

  it('a basic loaf rises and bakes at 425 °F to a set, open crumb with a brown crust', () => {
    const r = proofAndBake(350);
    expect(r.baked).toBeGreaterThan(0.9);
    expect(r.gummyCenter).toBe(false);
    expect(r.crumb).toBe('open');
    expect(r.crust).toBeGreaterThan(0.8);
    expect(r.burnt).toBe(false);
    expect(r.moistureLossPct).toBeGreaterThan(6);
    expect(r.moistureLossPct).toBeLessThan(18);
  });

  it('too-wet dough comes out flat and gummy; too-dry dough comes out dense', () => {
    const wet = proofAndBake(480);
    const dry = proofAndBake(250);
    expect(wet.crumb).toBe('gummy');
    expect(dry.crumb).toBe('dense');
    expect(dry.rise).toBeLessThan(proofAndBake(350).rise);
  });

  it('underbaked bread has a raw center', () => {
    const m = bread(350);
    const { food, dough } = boule(m, 2);
    for (let t = 0; t < 12 * 60; t += 2) {
      food.setAllEnv(ovenEnv(fToC(425)));
      food.step(2);
      dough.step(2, food);
    }
    expect(cToF(food.thermal.corePeak())).toBeLessThan(190);
    expect(bakeReport(food, dough).gummyCenter).toBe(true);
  });
});
