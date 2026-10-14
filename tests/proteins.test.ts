import { describe, expect, it } from 'vitest';
import { FoodItem } from '../src/sim/food';
import { Dir, H, ovenEnv, Tissue } from '../src/sim/foodThermal';
import { foilEnv } from '../src/world/heatBridge';
import { panSear, rest, roast, onPan, cook } from '../src/sim/recipes';
import { cToF, fToC } from '../src/sim/units';
import { splitFood } from '../src/sim/split';
import { crossSectionImage } from '../src/render/crossSection';

const ribeye = (inches: number) => new FoodItem(inches === 1 ? 'ribeye-1in' : inches === 2 ? 'thick-ribeye' : 'steak', [0.14, inches * 0.0254, 0.095]);

describe('steaks', () => {
  it('a 2" ribeye takes well over twice as long as a 1" to reach 120 °F', () => {
    const t1 = panSear(ribeye(1), { panF: 450, pullF: 120, flipEvery: 60 });
    const t2 = panSear(ribeye(2), { panF: 450, pullF: 120, flipEvery: 60 });
    expect(t2).toBeGreaterThan(t1 * 2.2);
    expect(t1 / 60).toBeGreaterThan(4);
    expect(t1 / 60).toBeLessThan(12);
  });

  it('the fat cap renders and drips while searing, and browns', () => {
    const s = ribeye(1.5);
    const t = s.thermal;
    const fatCells = [...t.tissue.keys()].filter((c) => t.mask[c] && t.tissue[c] === Tissue.Fat);
    expect(fatCells.length).toBeGreaterThan(10);
    const fat0 = fatCells.reduce((a, c) => a + t.fat[c], 0);
    // Render the cap: stand the steak on its fat edge (+z down) for 3 minutes, then sear flat.
    onPan(s, 450, Dir.PZ);
    cook(s, 180);
    panSear(s, { panF: 450, seconds: 300, flipEvery: 60 });
    const fat1 = fatCells.reduce((a, c) => a + t.fat[c], 0);
    expect(fat1).toBeLessThan(fat0 * 0.85);
    expect(t.drippings).toBeGreaterThan(0.001);
    expect(t.browning(Dir.PZ)).toBeGreaterThan(0.5);
  });

  it('salting 45 min ahead (dry brine) browns faster than salting right before', () => {
    const timeToBrown = (brineMin: number) => {
      const s = ribeye(1.5);
      s.thermal.season('salt', 0.008);
      s.rest(4); // in the fridge
      cook(s, brineMin * 60, 5);
      let t = 0;
      while (s.thermal.browning(Dir.NY) < 0.5 && t < 600) {
        onPan(s, 450, Dir.NY);
        s.step(1);
        t++;
      }
      return t;
    };
    expect(timeToBrown(45)).toBeLessThan(timeToBrown(0) - 5);
  });

  it('pepper scorches on a ripping-hot sear but not in a moderate oven', () => {
    const hot = ribeye(1.5);
    hot.thermal.season('spice', 0.004);
    panSear(hot, { panF: 525, seconds: 480, flipEvery: 120 });
    const gentle = ribeye(1.5);
    gentle.thermal.season('spice', 0.004);
    roast(gentle, 325, 1800);
    expect(hot.thermal.faceMean(hot.thermal.spiceBurn, Dir.NY)).toBeGreaterThan(0.3);
    expect(gentle.thermal.faceMean(gentle.thermal.spiceBurn)).toBeLessThan(0.05);
  });
});

describe('bone and connective tissue', () => {
  it('meat next to the bone cooks slower (bone insulates)', () => {
    const r = new FoodItem('short-ribs', [0.12, 0.05, 0.07]);
    roast(r, 300, 25 * 60);
    const t = r.thermal;
    const i = t.nx >> 1;
    const k = t.nz >> 1;
    // First lean cell above the bone/fat vs the same depth below the top surface.
    let jb = 0;
    while (t.tissue[t.idx(i, jb, k)] !== Tissue.Lean) jb++;
    const depth = jb;
    const jt = t.ny - 1 - (depth - 1);
    expect(t.T[t.idx(i, jb, k)]).toBeLessThan(t.T[t.idx(i, jt, k)] - 1);
  });

  it('ribs low-and-slow at 275 °F go fall-off-the-bone in hours; foil wrapping gets there sooner with less bark', () => {
    const unwrapped = new FoodItem('ribs', [0.3, 0.04, 0.14]);
    const wrapped = new FoodItem('ribs', [0.3, 0.04, 0.14]);
    const foil = (f: FoodItem): void => f.setAllEnv(foilEnv(ovenEnv(fToC(275))));
    roast(unwrapped, 275, 2 * 3600);
    roast(wrapped, 275, 2 * 3600);
    // 3-2-1 style: wrap after 2 h.
    let tu = 0;
    let tw = 0;
    while (unwrapped.summary().tenderness < 0.9 && tu < 8 * 3600) {
      unwrapped.setAllEnv(ovenEnv(fToC(275)));
      cook(unwrapped, 60, 2);
      tu += 60;
    }
    while (wrapped.summary().tenderness < 0.9 && tw < 8 * 3600) {
      foil(wrapped);
      cook(wrapped, 60, 2);
      tw += 60;
    }
    expect((2 * 3600 + tu) / 3600).toBeGreaterThan(2.5);
    expect((2 * 3600 + tu) / 3600).toBeLessThan(7.5);
    expect(tw).toBeLessThan(tu);
    expect(wrapped.thermal.browning()).toBeLessThan(unwrapped.thermal.browning());
    expect(cToF(unwrapped.thermal.coreTemp())).toBeGreaterThan(185);
  });
});

describe('chicken', () => {
  const cookTo = (pullF: number) => {
    const c = new FoodItem('chicken-breast', [0.18, 0.03, 0.09]);
    c.setAllEnv(ovenEnv(fToC(400), H.convectionOven));
    while (c.coreF < pullF) c.step(1);
    rest(c, 300);
    return c;
  };

  it('undercooked chicken is unsafe and pink inside; done chicken is safe and white', () => {
    const under = cookTo(135);
    const done = cookTo(160);
    expect(under.safety()).toBe('unsafe');
    expect(done.safety()).toBe('safe');
    const center = (f: FoodItem) => {
      const [, b] = splitFood(f, { n: [1, 0, 0], d: 0 });
      const img = crossSectionImage(b!, b!.cuts[0], 0xe8b4a8);
      const o = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
      return [img.data[o], img.data[o + 1], img.data[o + 2]];
    };
    const u = center(under);
    const d = center(done);
    // Raw-ish chicken is pinker (red ≫ green); cooked is near-white (channels close together).
    expect(u[0] - u[1]).toBeGreaterThan(d[0] - d[1] + 15);
  });

  it('a thigh with skin crisps golden on top; whole chickens are hollow with bones', () => {
    const th = new FoodItem('chicken-thigh', [0.1, 0.03, 0.07]);
    expect([...th.thermal.tissue].filter((x) => x === Tissue.Skin).length).toBeGreaterThan(10);
    th.setAllEnv(ovenEnv(fToC(425), H.convectionOven));
    cook(th, 35 * 60);
    expect(th.thermal.browning(Dir.PY)).toBeGreaterThan(0.6);
    expect(th.safety()).toBe('safe');
    const bird = new FoodItem('whole-chicken', [0.2, 0.12, 0.15]);
    const t = bird.thermal;
    expect(t.mask[t.centerIndex]).toBe(0);
    expect(bird.thermal.mass()).toBeGreaterThan(1.3);
    expect(bird.thermal.mass()).toBeLessThan(2.2);
  });
});
