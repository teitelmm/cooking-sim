import { describe, expect, it } from 'vitest';
import { FoodItem } from '../src/sim/food';
import { airEnv, Dir, H, ovenEnv, type FaceEnv } from '../src/sim/foodThermal';
import { cToF, fToC } from '../src/sim/units';

/** 1.5" ribeye: 20 × 3.81 × 13 cm. */
const STEAK: [number, number, number] = [0.2, 0.0381, 0.13];

function pan(panF: number, contactH: number = H.panContact): FaceEnv {
  return { medium: 'air', fluidT: 60, fluidH: 10, contactT: fToC(panF), contactH, contactFrac: 0.9, radT: 22, radView: 0 };
}

/** Put `down` face on a pan at panF; the other faces see warm air above the pan. */
function onPan(f: FoodItem, panF: number, down: Dir) {
  for (let d = 0; d < 6; d++) f.setEnv(d, airEnv(35, 10));
  f.setEnv(down, pan(panF));
}

function run(f: FoodItem, seconds: number) {
  for (let t = 0; t < seconds; t++) f.step(1);
}

function searToCore(f: FoodItem, panF: number, pullF: number, flipEvery = 60) {
  let side = Dir.NY;
  let t = 0;
  while (f.coreF < pullF && t < 3600) {
    onPan(f, panF, side);
    f.step(1);
    t++;
    if (t % flipEvery === 0) side = side === Dir.NY ? Dir.PY : Dir.NY;
  }
  return t;
}

describe('steak on a 450 °F pan', () => {
  it('chars only the face that never left the pan', () => {
    const flipped = new FoodItem('steak', STEAK);
    onPan(flipped, 450, Dir.NY);
    run(flipped, 180);
    onPan(flipped, 450, Dir.PY);
    run(flipped, 180);

    const never = new FoodItem('steak', STEAK);
    onPan(never, 450, Dir.NY);
    run(never, 360);

    const f = flipped.thermal;
    const n = never.thermal;
    // Flipped at 3 min: both sides are well browned, neither is burnt.
    expect(f.browning(Dir.NY)).toBeGreaterThan(1);
    expect(f.browning(Dir.PY)).toBeGreaterThan(1);
    expect(f.char(Dir.NY)).toBeLessThan(0.12);
    expect(f.char(Dir.PY)).toBeLessThan(0.12);
    // Never flipped: the bottom chars, the top stays raw-looking (no browning, no char).
    expect(n.char(Dir.NY)).toBeGreaterThan(0.2);
    expect(n.char(Dir.NY)).toBeGreaterThan(2.5 * f.char(Dir.NY));
    expect(n.char(Dir.PY)).toBeLessThan(0.005);
    expect(n.browning(Dir.PY)).toBeLessThan(0.05);
  });

  it('keeps the surface at boiling until the crust dries, then it climbs and browns', () => {
    const s = new FoodItem('steak', STEAK);
    onPan(s, 450, Dir.NY);
    run(s, 10);
    expect(cToF(s.thermal.surfaceTemp(Dir.NY))).toBeCloseTo(212, 0);
    expect(s.thermal.browning(Dir.NY)).toBe(0);
    run(s, 80);
    expect(cToF(s.thermal.surfaceTemp(Dir.NY))).toBeGreaterThan(300);
    expect(s.thermal.browning(Dir.NY)).toBeGreaterThan(0.5);
  });

  it('carries over: resting raises the core at least 5 °F', () => {
    const s = new FoodItem('steak', STEAK);
    searToCore(s, 450, 120);
    const pulled = s.coreF;
    s.rest();
    let peak = pulled;
    for (let i = 0; i < 900; i++) {
      s.step(1);
      peak = Math.max(peak, s.coreF);
    }
    expect(peak - pulled).toBeGreaterThanOrEqual(5);
    // …and then it cools again.
    expect(s.coreF).toBeLessThan(peak);
  });

  it('resting reduces the free juice that would run out when cut', () => {
    const s = new FoodItem('steak', STEAK);
    searToCore(s, 450, 125);
    const hot = s.thermal.freeJuice();
    s.rest();
    run(s, 600);
    expect(hot).toBeGreaterThan(0.002);
    expect(s.thermal.freeJuice()).toBeLessThan(hot * 0.6);
  });

  it('doneness follows the peak core temperature', () => {
    const rare = new FoodItem('steak', STEAK);
    searToCore(rare, 450, 105);
    rare.rest();
    run(rare, 600);
    const mr = new FoodItem('steak', STEAK);
    searToCore(mr, 450, 112);
    mr.rest();
    run(mr, 600);
    const order = ['raw', 'rare', 'medium-rare', 'medium', 'medium-well', 'well-done'];
    expect(order.indexOf(mr.doneness())).toBeGreaterThanOrEqual(order.indexOf(rare.doneness()));
    expect(['rare', 'medium-rare', 'medium']).toContain(rare.doneness());
  });
});

describe('sous vide', () => {
  it('a 131 °F bath for 2 h brings the steak to a uniform 131 °F', () => {
    const s = new FoodItem('steak', STEAK);
    s.setAllEnv({ medium: 'bag', fluidT: fToC(131), fluidH: H.sousVide, contactT: 0, contactH: 0, contactFrac: 0, radT: 0, radView: 0 });
    run(s, 7200);
    expect(Math.abs(s.coreF - 131)).toBeLessThan(0.75);
    expect(cToF(s.thermal.maxTemp()) - cToF(s.thermal.minTemp())).toBeLessThan(0.75);
    expect(s.doneness()).toBe('medium-rare');
    // Wet bath: no browning, no char.
    expect(s.thermal.browning()).toBe(0);
    expect(s.thermal.char()).toBe(0);
  });
});

describe('overcooking is irreversible', () => {
  it('quick sear then a long time in a low oven: looks fine outside, well-done inside, even after cooling', () => {
    const s = new FoodItem('steak', STEAK);
    onPan(s, 450, Dir.NY);
    run(s, 60);
    onPan(s, 450, Dir.PY);
    run(s, 60);
    s.setAllEnv(ovenEnv(fToC(275)));
    run(s, 75 * 60);
    expect(cToF(s.thermal.corePeak())).toBeGreaterThan(158);
    expect(s.doneness()).toBe('well-done');
    // Outside still looks fine: browned, not burnt.
    expect(s.thermal.browning(Dir.NY)).toBeGreaterThan(0.5);
    expect(s.thermal.char()).toBeLessThan(0.05);
    // Cool it right down: still well-done, still dry.
    s.rest();
    run(s, 45 * 60);
    expect(s.coreF).toBeLessThan(cToF(s.thermal.corePeak()) - 30);
    expect(s.doneness()).toBe('well-done');
    expect(s.thermal.juiciness()).toBeLessThan(0.8);
  });
});

describe('safety, collagen, starch', () => {
  it('chicken is unsafe until every part has reached 165 °F', () => {
    const c = new FoodItem('chicken-breast', [0.18, 0.03, 0.09]);
    expect(c.safety()).toBe('unsafe');
    c.setAllEnv(ovenEnv(fToC(400), H.convectionOven));
    let t = 0;
    while (cToF(c.thermal.minPeak()) < 165 && t < 7200) {
      c.step(1);
      t++;
    }
    expect(c.safety()).toBe('safe');
    expect(t / 60).toBeGreaterThan(12);
    expect(t / 60).toBeLessThan(40);
  });

  it('ribs turn tender only after hours at low heat', () => {
    const ribs = new FoodItem('ribs', [0.3, 0.04, 0.14]);
    ribs.setAllEnv(ovenEnv(fToC(250)));
    run(ribs, 3600);
    const oneHour = ribs.summary().tenderness;
    run(ribs, 3 * 3600);
    const fourHours = ribs.summary().tenderness;
    expect(oneHour).toBeLessThan(0.4);
    expect(fourHours).toBeGreaterThan(0.7);
  });

  it('boiled potato chunks gelatinize and soften in ~15 min', () => {
    const p = new FoodItem('potato', [0.035, 0.035, 0.035]);
    p.setAllEnv({ medium: 'water', fluidT: 100, fluidH: H.boil, contactT: 0, contactH: 0, contactFrac: 0, radT: 0, radView: 0 });
    run(p, 5 * 60);
    const early = p.summary();
    run(p, 12 * 60);
    const done = p.summary();
    expect(early.gelatinized).toBeLessThan(0.8);
    expect(done.gelatinized).toBeGreaterThan(0.95);
    expect(done.softness).toBeGreaterThan(0.9);
  });
});
