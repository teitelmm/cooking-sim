import { describe, expect, it } from 'vitest';
import { FoodItem } from '../src/sim/food';
import { panSear, rest } from '../src/sim/recipes';
import { crossSectionImage } from '../src/render/crossSection';
import { splitFood } from '../src/sim/split';

const STEAK: [number, number, number] = [0.14, 0.0381, 0.095];

function centerPixel(f: FoodItem) {
  const [, back] = splitFood(f, { n: [0, 0, 1], d: 0 });
  const img = crossSectionImage(back!, back!.cuts[0], 0xb03a3e);
  const x = img.width >> 1;
  const y = img.height >> 1;
  const o = (y * img.width + x) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2], a: img.data[o + 3], img };
}

describe('cross-section', () => {
  it('rare is red in the middle, well-done is gray-brown', () => {
    const rare = new FoodItem('steak', STEAK);
    panSear(rare, { panF: 450, pullF: 92, flipEvery: 60 });
    rest(rare, 480);
    const well = new FoodItem('steak', STEAK);
    panSear(well, { panF: 450, pullF: 157, flipEvery: 60 });
    rest(well, 480);
    const r = centerPixel(rare);
    const w = centerPixel(well);
    expect(r.a).toBe(255);
    // Redness = red channel dominance over green.
    expect(r.r - r.g).toBeGreaterThan(90);
    expect(w.r - w.g).toBeLessThan(45);
  });

  it('shows a dark crust band at the seared surface and is transparent outside the food', () => {
    const s = new FoodItem('steak', STEAK);
    panSear(s, { panF: 450, pullF: 115, flipEvery: 60 });
    const { img } = centerPixel(s);
    const x = img.width >> 1;
    const lum = (y: number) => {
      const o = (y * img.width + x) * 4;
      return img.data[o] + img.data[o + 1] + img.data[o + 2];
    };
    // Find the first opaque row from the bottom: the crust should be much darker than the middle.
    let y0 = 0;
    while (y0 < img.height && img.data[(y0 * img.width + x) * 4 + 3] === 0) y0++;
    expect(lum(y0)).toBeLessThan(lum(img.height >> 1) * 0.7);
  });
});
