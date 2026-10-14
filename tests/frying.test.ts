import { describe, expect, it } from 'vitest';
import { DeepFryer } from '../src/sim/fryer';
import { FoodItem } from '../src/sim/food';
import { H, type FaceEnv } from '../src/sim/foodThermal';
import { cToF, fToC } from '../src/sim/units';
import { Burner } from '../src/sim/appliances';
import { Cookware, COOKWARE } from '../src/sim/cookware';
import { rest } from '../src/sim/recipes';

const DT = 0.5;
/** A batch of 3/8" fries: model one representative stick, count how many make the batch. */
const fry = () => new FoodItem('potato', [0.0095, 0.0095, 0.09], { inside: () => true });

function inOil(f: FoodItem, oilC: number): void {
  const wet = f.thermal.crustWater() > f.thermal.crustMax * 0.2;
  const env: FaceEnv = { medium: 'oil', fluidT: oilC, fluidH: wet ? H.fry : 260, contactT: oilC, contactH: 0, contactFrac: 0, radT: oilC, radView: 0 };
  f.setAllEnv(env);
}

function preheated(setF: number): DeepFryer {
  const d = new DeepFryer('f');
  d.setC = fToC(setF);
  d.on = true;
  for (let t = 0; t < 30 * 60 && cToF(d.oil.T) < setF - 2; t += DT) d.step(DT);
  return d;
}

/** Fry a batch of `n` sticks in the fryer for `seconds`, coupling heat both ways. */
function fryBatch(d: DeepFryer, sticks: FoodItem[], n: number, seconds: number): number {
  let minT = d.oil.T;
  for (let t = 0; t < seconds; t += DT) {
    for (const s of sticks) {
      inOil(s, d.oil.T);
      s.step(DT);
      d.oil.load += s.thermal.fluidHeat * (n / sticks.length);
      s.thermal.fluidHeat = 0;
    }
    d.step(DT);
    minT = Math.min(minT, d.oil.T);
  }
  return minT;
}

describe('deep fryer', () => {
  it('preheats to 350 °F, dips when a cold batch goes in, and recovers', () => {
    const d = preheated(350);
    const before = cToF(d.oil.T);
    const stick = fry();
    const n = Math.round(0.45 / stick.thermal.mass()); // 1 lb of fries
    const minF = cToF(fryBatch(d, [stick], n, 60));
    expect(before - minF).toBeGreaterThan(20);
    // Recovers (with the fries still in, cooking) within a few minutes.
    let t = 0;
    while (cToF(d.oil.T) < 345 && t < 900) {
      fryBatch(d, [stick], n, 10);
      t += 10;
    }
    expect(t).toBeLessThan(600);
  });

  it('double-fried fries (325 °F blanch, rest, 375 °F) are crisper than a single fry to the same color', () => {
    const single = fry();
    const d1 = preheated(375);
    let t = 0;
    while (single.thermal.browning() < 0.9 && t < 900) {
      fryBatch(d1, [single], 40, 5);
      t += 5;
    }
    const blanched = fry();
    const d2 = preheated(325);
    fryBatch(d2, [blanched], 40, 300);
    rest(blanched, 900);
    const d3 = preheated(375);
    t = 0;
    while (blanched.thermal.browning() < 0.9 && t < 900) {
      fryBatch(d3, [blanched], 40, 5);
      t += 5;
    }
    expect(blanched.thermal.crispness()).toBeGreaterThan(single.thermal.crispness() * 1.2);
    expect(blanched.thermal.mean(blanched.thermal.starch)).toBeGreaterThan(0.95);
    // Fries soak up some oil (roughly 5–15 % by weight).
    const frac = blanched.thermal.oilAbsorbed / blanched.thermal.mass();
    expect(frac).toBeGreaterThan(0.03);
    expect(frac).toBeLessThan(0.2);
  });

  it('crisp fries go soft if they sit around', () => {
    const f = fry();
    const d = preheated(375);
    fryBatch(d, [f], 40, 240);
    const hot = f.thermal.crispness();
    rest(f, 20 * 60);
    expect(f.thermal.crispness()).toBeLessThan(hot * 0.85);
  });
});

describe('oil in a pot', () => {
  it('overheated over a gas flame it catches fire; a lid smothers it', () => {
    const b = new Burner('b');
    b.knob = 1;
    const pot = new Cookware('stock-pot', COOKWARE['stock-pot']);
    pot.burner = b;
    pot.contents!.add('oil', 0.6);
    let t = 0;
    while (!pot.contents!.onFire && t < 3600) {
      b.step(DT);
      pot.step(DT);
      t += DT;
    }
    expect(pot.contents!.onFire).toBe(true);
    expect(cToF(pot.contents!.T)).toBeGreaterThan(590);
    pot.contents!.lid = true;
    b.step(DT);
    pot.step(DT);
    expect(pot.contents!.onFire).toBe(false);
  });

  it('water into hot oil spatters violently (and erupts a nearly full pot)', () => {
    const pot = new Cookware('stock-pot', COOKWARE['stock-pot']);
    pot.contents!.add('oil', 5.5, fToC(360));
    pot.contents!.add('water', 0.05);
    expect(pot.contents!.splatter).toBeGreaterThan(5 - 1e-9);
    expect(pot.contents!.spillOil).toBeGreaterThan(0.1);
    expect(pot.contents!.water).toBe(0);
  });
});
