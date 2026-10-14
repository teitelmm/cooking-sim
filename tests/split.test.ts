import { describe, expect, it } from 'vitest';
import { FoodItem } from '../src/sim/food';
import { Dir } from '../src/sim/foodThermal';
import { onPan } from '../src/sim/recipes';
import { juiceReleased, splitFood } from '../src/sim/split';
import { cToF } from '../src/sim/units';

const STEAK: [number, number, number] = [0.14, 0.0381, 0.095];

function seared(): FoodItem {
  const s = new FoodItem('steak', STEAK);
  for (let t = 0; t < 600; t++) {
    const down = Math.floor(t / 60) % 2 === 0 ? Dir.NY : Dir.PY;
    onPan(s, 450, down);
    s.step(1);
  }
  return s;
}

describe('splitFood', () => {
  it('cuts a steak in half: masses add up, state is inherited, cut faces are fresh', () => {
    const s = seared();
    const [a, b] = splitFood(s, { n: [1, 0, 0], d: 0 });
    expect(a && b).toBeTruthy();
    const ma = a!.thermal.mass();
    const mb = b!.thermal.mass();
    expect(ma + mb).toBeCloseTo(s.thermal.mass(), 1);
    expect(Math.abs(ma - mb) / (ma + mb)).toBeLessThan(0.1);
    // Same doneness gradient: core peak matches the parent's within a degree or two.
    expect(Math.abs(cToF(a!.thermal.minPeak()) - cToF(s.thermal.minPeak()))).toBeLessThan(4);
    // Top and bottom keep their sear; the new cut face (+x on piece a) is unbrowned and wet.
    expect(a!.thermal.browning(Dir.NY)).toBeGreaterThan(0.8);
    expect(a!.thermal.browning(Dir.PX)).toBe(0);
    expect(a!.thermal.crustWater(Dir.PX)).toBeGreaterThan(0.5);
    // The original end (−x) is still the parent's −x surface state.
    expect(a!.thermal.browning(Dir.NX)).toBeCloseTo(s.thermal.browning(Dir.NX), 1);
    expect(a!.origin[0]).toBeLessThan(0);
    expect(b!.origin[0]).toBeGreaterThan(0);
  });

  it('a plane that misses returns one piece', () => {
    const s = new FoodItem('steak', STEAK);
    const [a, b] = splitFood(s, { n: [1, 0, 0], d: 0.5 });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('cutting a just-cooked steak releases more juice than a rested one, a dry one releases none', () => {
    const hot = seared();
    const rested = seared();
    rested.rest();
    for (let t = 0; t < 600; t++) rested.step(1);
    const raw = new FoodItem('steak', STEAK);
    const plane = { n: [1, 0, 0] as [number, number, number], d: 0 };
    expect(juiceReleased(hot, plane)).toBeGreaterThan(juiceReleased(rested, plane) * 1.5);
    expect(juiceReleased(raw, plane)).toBe(0);
  });

  it('pieces of an ellipsoid potato are voxel-shaped and can be cut again', () => {
    const p = new FoodItem('potato', [0.116, 0.068, 0.08]);
    const [a] = splitFood(p, { n: [1, 0, 0], d: 0 });
    const [q] = splitFood(a!, { n: [0, 0, 1], d: 0 });
    expect(q!.thermal.mass()).toBeGreaterThan(p.thermal.mass() * 0.15);
    expect(q!.thermal.mass()).toBeLessThan(p.thermal.mass() * 0.35);
    expect(q!.cuts.length).toBe(2);
  });
});
