import { describe, expect, it } from 'vitest';
import { FOODS } from '../src/data/foods';
import { PATTERN, patternFor } from '../src/render/foodDetail';
import { FoodItem } from '../src/sim/food';
import { splitFood } from '../src/sim/split';

describe('raw food surface detail', () => {
  it('every food has a surface pattern with sane parameters', () => {
    for (const [id, props] of Object.entries(FOODS)) {
      const p = patternFor(id, props);
      expect(p.kind, id).not.toBe(PATTERN.none);
      expect(p.bump, id).toBeGreaterThan(0);
      expect(p.bump, id).toBeLessThan(2);
      expect(p.freq, id).toBeGreaterThan(10);
    }
  });

  it('pieces cut from a food keep its look seed (marbling lines up across the cut)', () => {
    const steak = new FoodItem('steak', [0.14, 0.0381, 0.095]);
    const [a, b] = splitFood(steak, { n: [1, 0, 0], d: 0 });
    expect(a!.seed).toBe(steak.seed);
    expect(b!.seed).toBe(steak.seed);
  });
});
