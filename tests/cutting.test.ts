import { describe, expect, it } from 'vitest';
import { FoodItem, type Plane } from '../src/sim/food';
import { assistCutPlane, cutResistance } from '../src/sim/cutting';
import { splitFood } from '../src/sim/split';
import { panSear, rest, roast } from '../src/sim/recipes';

/** Deterministic pseudo-random in [-1, 1]. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

describe('knife assist', () => {
  it('sloppy cuts across a potato still give even 6 mm slices', () => {
    const r = rng(7);
    let piece: FoodItem = new FoodItem('potato', [0.116, 0.068, 0.08]);
    const slices: number[] = [];
    // Cut from the +x end toward −x, each stroke aimed ~6 mm in with ±2.5 mm and ±6° of slop.
    for (let i = 0; i < 6; i++) {
      const half = piece.size[0] / 2;
      const aim = half - 0.006 + r() * 0.0025;
      const ang = (r() * 6 * Math.PI) / 180;
      const n: [number, number, number] = [Math.cos(ang), 0, Math.sin(ang)];
      const plane = assistCutPlane(piece, { n, d: aim * n[0] } as Plane);
      expect(plane).not.toBeNull();
      const [keep, slice] = splitFood(piece, plane!);
      slices.push(slice!.size[0]);
      piece = keep!;
    }
    const mean = slices.reduce((a, b) => a + b, 0) / slices.length;
    const sd = Math.sqrt(slices.reduce((a, b) => a + (b - mean) ** 2, 0) / slices.length);
    expect(mean).toBeGreaterThan(0.0045);
    expect(mean).toBeLessThan(0.0085);
    expect(sd).toBeLessThan(0.0015);
  });

  it('meat only snaps the angle (cut position stays where you put it)', () => {
    const s = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    const p = assistCutPlane(s, { n: [0.995, 0, 0.0998], d: 0.0123 })!;
    expect(p.n).toEqual([1, 0, 0]);
    expect(p.d).toBeCloseTo(0.0123, 3);
  });

  it('a cut aimed right at the end makes a proper slice, not a sliver', () => {
    const s = new FoodItem('potato', [0.116, 0.068, 0.08]);
    const p = assistCutPlane(s, { n: [1, 0, 0], d: 0.0575 })!;
    expect(0.058 - p.d).toBeCloseTo(0.006, 4);
  });
});

describe('cut resistance', () => {
  it('raw steak is tougher than cooked; braised ribs and cooked potato are easy', () => {
    const raw = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    const cooked = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    panSear(cooked, { panF: 450, pullF: 125, flipEvery: 60 });
    rest(cooked, 480);
    expect(cutResistance(raw)).toBeGreaterThan(cutResistance(cooked) * 1.5);
    const ribs = new FoodItem('ribs', [0.3, 0.04, 0.14]);
    const rawRibs = cutResistance(ribs);
    roast(ribs, 275, 4 * 3600);
    expect(cutResistance(ribs)).toBeLessThan(rawRibs * 0.6);
    const potato = new FoodItem('potato', [0.116, 0.068, 0.08]);
    const rawP = cutResistance(potato);
    potato.setAllEnv({ medium: 'water', fluidT: 100, fluidH: 1200, contactT: 0, contactH: 0, contactFrac: 0, radT: 0, radView: 0 });
    for (let t = 0; t < 1800; t++) potato.step(1);
    expect(cutResistance(potato)).toBeLessThan(rawP * 0.5);
  });
});
