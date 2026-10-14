import { describe, expect, it } from 'vitest';
import { FoodItem } from '../src/sim/food';
import { PastaBatch } from '../src/sim/pasta';
import { Dir, H, ovenEnv, type FaceEnv } from '../src/sim/foodThermal';
import { onPan, cook } from '../src/sim/recipes';
import { fToC } from '../src/sim/units';

describe('pasta', () => {
  const boil = (stir: boolean, waterC = 100, vigor = 1) => {
    const p = new PastaBatch(0.45);
    const times: Record<string, number> = {};
    for (let t = 0; t <= 25 * 60; t += 5) {
      if (stir && t % 30 === 0) p.stir();
      p.step(5, waterC, vigor);
      const d = p.doneness();
      if (times[d] === undefined) times[d] = t;
    }
    return { p, times };
  };

  it('is al dente between 8 and 11 minutes at a rolling boil, mushy if you forget it', () => {
    const { times } = boil(true);
    expect(times['al dente'] / 60).toBeGreaterThan(7);
    expect(times['al dente'] / 60).toBeLessThan(9.5);
    expect(times['soft'] / 60).toBeGreaterThan(10);
    expect(times['soft'] / 60).toBeLessThan(13);
    expect(times['mushy'] / 60).toBeLessThan(20);
  });

  it('barely-simmering water cooks it much slower', () => {
    const { times } = boil(true, 85, 0.1);
    expect(times['al dente'] ?? Infinity).toBeGreaterThan(14 * 60);
  });

  it('not stirring early makes it clump; it sheds starch', () => {
    const still = boil(false, 100, 0.3).p;
    const stirred = boil(true, 100, 0.3).p;
    expect(still.clump).toBeGreaterThan(0.6);
    expect(stirred.clump).toBeLessThan(0.1);
    expect(stirred.starchOut).toBeGreaterThan(0.005);
  });
});

describe('potatoes', () => {
  const cube = () => new FoodItem('potato', [0.025, 0.025, 0.025], { inside: () => true });

  it('roasted at 425 °F, chunks gelatinize and get crisp edges', () => {
    const p = cube();
    for (let t = 0; t < 40 * 60; t += 2) {
      const env = ovenEnv(fToC(425));
      p.setAllEnv(env);
      const panC = fToC(410);
      p.setEnv(Dir.NY, { ...env, contactT: panC, contactH: 400, contactFrac: 0.9 } as FaceEnv);
      p.step(2);
    }
    expect(p.thermal.mean(p.thermal.starch)).toBeGreaterThan(0.95);
    expect(p.thermal.crispness(Dir.NY)).toBeGreaterThan(0.6);
    expect(p.thermal.crispness()).toBeGreaterThan(0.35);
  });

  it('boiled potatoes are tender but not crisp', () => {
    const p = cube();
    p.setAllEnv({ medium: 'water', fluidT: 100, fluidH: H.boil, contactT: 100, contactH: 0, contactFrac: 0, radT: 100, radView: 0 });
    cook(p, 15 * 60, 2);
    expect(p.thermal.mean(p.thermal.soft)).toBeGreaterThan(0.8);
    expect(p.thermal.crispness()).toBeLessThan(0.05);
  });
});

describe('aromatics and veg', () => {
  const garlicSlice = () => new FoodItem('garlic', [0.02, 0.003, 0.015], { inside: () => true });

  it('garlic turns golden in a medium pan but burns when the pan is too hot', () => {
    const medium = garlicSlice();
    const hot = garlicSlice();
    for (let t = 0; t < 180; t++) {
      onPan(medium, 300, Dir.NY);
      medium.step(1);
      if (t < 120) {
        onPan(hot, 450, Dir.NY);
        hot.step(1);
      }
    }
    expect(medium.thermal.browning(Dir.NY)).toBeGreaterThan(0.3);
    expect(medium.thermal.char(Dir.NY)).toBeLessThan(0.15);
    expect(hot.thermal.char(Dir.NY)).toBeGreaterThan(0.4);
  });

  it('onions caramelize low and slow without burning', () => {
    const onion = new FoodItem('onion', [0.04, 0.006, 0.02], { inside: () => true });
    for (let t = 0; t < 25 * 60; t++) {
      onPan(onion, t % 120 < 60 ? 290 : 290, t % 90 < 45 ? Dir.NY : Dir.PY); // stirring = flipping often
      onion.step(1);
    }
    expect(onion.thermal.browning()).toBeGreaterThan(0.6);
    expect(onion.thermal.char()).toBeLessThan(0.15);
    expect(onion.thermal.mean(onion.thermal.soft)).toBeGreaterThan(0.8);
  });

  it('carrots boil tender in about 10 minutes', () => {
    const c = new FoodItem('carrot', [0.05, 0.022, 0.022]);
    c.setAllEnv({ medium: 'water', fluidT: 100, fluidH: H.boil, contactT: 100, contactH: 0, contactFrac: 0, radT: 100, radView: 0 });
    cook(c, 5 * 60, 2);
    const five = c.thermal.mean(c.thermal.soft);
    cook(c, 6 * 60, 2);
    expect(five).toBeLessThan(0.85);
    expect(c.thermal.mean(c.thermal.soft)).toBeGreaterThan(0.85);
  });

  it('garlic powder scorches at a lower temperature than black pepper', () => {
    const a = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    const b = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    a.season('pepper', 0.0005);
    b.season('garlic-powder', 0.0005);
    for (let t = 0; t < 300; t++) {
      onPan(a, 410, Dir.NY);
      onPan(b, 410, Dir.NY);
      a.step(1);
      b.step(1);
    }
    expect(b.summary().spiceBurn).toBeGreaterThan(a.summary().spiceBurn * 1.5);
  });
});
