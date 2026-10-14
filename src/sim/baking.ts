import type { FoodProps } from '../data/foods';
import { FoodItem } from './food';
import { cToF } from './units';

/**
 * Baking: ingredients, mixing, emergent dough/batter from ratios (no recipes), proofing and oven
 * behavior. Ratios are baker's percentages against flour.
 */
export type Ingredient =
  | 'flour'
  | 'sugar'
  | 'salt'
  | 'baking-powder'
  | 'baking-soda'
  | 'yeast'
  | 'butter'
  | 'egg'
  | 'milk'
  | 'water'
  | 'oil'
  | 'vanilla'
  | 'chocolate';

/** Composition (mass fractions) and bulk density (kg/L) of each ingredient. */
export const INGREDIENTS: Record<Ingredient, { water: number; fat: number; sugar: number; density: number; granular: boolean; color: number }> = {
  flour: { water: 0.12, fat: 0.01, sugar: 0, density: 0.53, granular: true, color: 0xf3eee2 },
  sugar: { water: 0, fat: 0, sugar: 1, density: 0.85, granular: true, color: 0xfafafa },
  salt: { water: 0, fat: 0, sugar: 0, density: 1.2, granular: true, color: 0xffffff },
  'baking-powder': { water: 0, fat: 0, sugar: 0, density: 0.9, granular: true, color: 0xf6f6f2 },
  'baking-soda': { water: 0, fat: 0, sugar: 0, density: 0.95, granular: true, color: 0xffffff },
  yeast: { water: 0.05, fat: 0, sugar: 0, density: 0.6, granular: true, color: 0xc8a165 },
  butter: { water: 0.16, fat: 0.81, sugar: 0, density: 0.91, granular: false, color: 0xf7e6a6 },
  egg: { water: 0.75, fat: 0.1, sugar: 0, density: 1.03, granular: false, color: 0xf2c94c },
  milk: { water: 0.87, fat: 0.035, sugar: 0.05, density: 1.03, granular: false, color: 0xfbfbf6 },
  water: { water: 1, fat: 0, sugar: 0, density: 1.0, granular: false, color: 0xbfd8e0 },
  oil: { water: 0, fat: 1, sugar: 0, density: 0.92, granular: false, color: 0xe0b040 },
  vanilla: { water: 0.6, fat: 0, sugar: 0.1, density: 0.88, granular: false, color: 0x5a3a1a },
  chocolate: { water: 0.01, fat: 0.3, sugar: 0.5, density: 0.65, granular: true, color: 0x3b2416 },
};

export type DoughType = 'none' | 'wet mix' | 'bread dough' | 'pizza dough' | 'cookie dough' | 'biscuit dough' | 'cake batter' | 'pancake batter' | 'crumbly mix' | 'paste';

export interface DoughAnalysis {
  type: DoughType;
  flour: number;
  /** Water from all sources ÷ flour. */
  hydration: number;
  /** Fat ÷ flour, sugar ÷ flour. */
  fat: number;
  sugar: number;
  /** Yeast ÷ flour, chemical leavener ÷ flour, egg ÷ flour. */
  yeast: number;
  chem: number;
  egg: number;
  /** Plain-English problems ("too wet", "no leavening", …). */
  notes: string[];
  totalKg: number;
}

export class Mixture {
  readonly kg: Partial<Record<Ingredient, number>> = {};
  /** Mixing strokes so far and how well combined (0..1). */
  strokes = 0;
  /** Gluten development 0..1 (kneading builds it; over-mixing a cake makes it tough). */
  gluten = 0;

  add(ing: Ingredient, kg: number): void {
    if (kg <= 0) return;
    this.kg[ing] = (this.kg[ing] ?? 0) + kg;
    // New stuff isn't mixed in yet.
    this.strokes *= Math.max(0, 1 - kg / Math.max(this.total, 1e-6));
  }

  get total(): number {
    return Object.values(this.kg).reduce((a, b) => a + (b ?? 0), 0);
  }

  /** Volume, L. */
  get liters(): number {
    let v = 0;
    for (const [k, m] of Object.entries(this.kg)) v += (m ?? 0) / INGREDIENTS[k as Ingredient].density;
    return v * (this.analyze().type === 'none' ? 1 : 0.8);
  }

  get mixQuality(): number {
    return 1 - Math.exp(-this.strokes / 25);
  }

  stir(strokes = 1): void {
    this.strokes += strokes;
    const a = this.analyze();
    if (a.flour > 0 && a.hydration > 0.3) this.gluten = Math.min(1, this.gluten + strokes * 0.006 * Math.min(a.hydration, 1));
  }

  analyze(): DoughAnalysis {
    const g = (i: Ingredient) => this.kg[i] ?? 0;
    const flour = g('flour');
    let water = 0;
    let fat = 0;
    let sugar = 0;
    for (const [k, m] of Object.entries(this.kg)) {
      const c = INGREDIENTS[k as Ingredient];
      if (k === 'flour') continue;
      water += (m ?? 0) * c.water;
      fat += (m ?? 0) * c.fat;
      sugar += (m ?? 0) * c.sugar;
    }
    const total = this.total;
    const notes: string[] = [];
    if (flour <= 0) return { type: total > 0 ? 'wet mix' : 'none', flour, hydration: 0, fat: 0, sugar: 0, yeast: 0, chem: 0, egg: 0, notes, totalKg: total };
    const hyd = water / flour;
    const f = fat / flour;
    const s = sugar / flour;
    const yeast = g('yeast') / flour;
    const chem = (g('baking-powder') + g('baking-soda') * 3) / flour;
    const egg = g('egg') / flour;
    let type: DoughType;
    if (hyd < 0.12 && f < 0.35) type = 'crumbly mix';
    else if (f >= 0.45 && s >= 0.45 && hyd < 0.6) type = 'cookie dough';
    else if (hyd >= 0.75 && s >= 0.45 && (f >= 0.2 || egg >= 0.3)) type = 'cake batter';
    else if (hyd >= 1.1) type = chem > 0.01 || egg > 0.2 ? 'pancake batter' : 'paste';
    else if (f >= 0.2 && f < 0.6 && hyd >= 0.4 && hyd < 0.75 && chem > 0.01) type = 'biscuit dough';
    else if (hyd >= 0.4 && hyd < 1.1 && yeast > 0.002) type = g('oil') / flour > 0.02 ? 'pizza dough' : 'bread dough';
    else if (hyd >= 0.4) type = 'paste';
    else type = 'crumbly mix';
    // Problems.
    if (type === 'bread dough' || type === 'pizza dough') {
      if (hyd > 0.85) notes.push('too wet — slack, sticky, will spread flat');
      else if (hyd < 0.55) notes.push('too dry — stiff, will bake dense');
      if (g('salt') / flour < 0.01) notes.push('needs salt');
      if (yeast > 0.04) notes.push('a lot of yeast — will over-proof fast');
    }
    if (type === 'cake batter' && chem < 0.01 && egg < 0.5) notes.push('no leavening — will be dense');
    if (type === 'cookie dough' && hyd < 0.12) notes.push('too dry — will crumble');
    if (type === 'paste') notes.push(yeast > 0 ? 'too wet to hold a shape' : 'no leavening — paste');
    if (type === 'crumbly mix') notes.push('not enough liquid');
    return { type, flour, hydration: hyd, fat: f, sugar: s, yeast, chem, egg, notes, totalKg: total };
  }
}

/** Thermal/chemical props for a dough or batter from its analysis (aeration lowers density and conductivity). */
export function doughProps(a: DoughAnalysis, rise = 1): FoodProps {
  const total = Math.max(a.flour * (1 + a.hydration + a.fat + a.sugar), 1e-6);
  const waterFrac = (a.flour * (0.12 + a.hydration * 0.88)) / total;
  return {
    kind: 'dough',
    k: 0.42 / Math.pow(rise, 0.7),
    rho: 1150 / rise,
    cp: 2800,
    water: Math.min(Math.max(waterFrac, 0.15), 0.8),
    starch: 1,
    sugar: Math.min(a.sugar, 1),
    fat: Math.min(a.fat / (1 + a.fat), 0.5),
    browning: 1 + Math.min(a.sugar, 1) * 0.8 + (a.egg > 0.1 ? 0.3 : 0),
    char: 1,
    surfaceWater: 0.01,
    shape: a.type.includes('batter') ? 'box' : 'ellipsoid',
  };
}

/** Yeast CO₂ production relative to its optimum (~95 °F); stalls cold, dies above ~140 °F. */
export function yeastActivity(Tc: number): number {
  if (Tc <= 2 || Tc >= 60) return 0;
  const f = Math.exp(-(((Tc - 35) / 11) ** 2));
  return Tc > 48 ? f * Math.max(0, (60 - Tc) / 12) : f;
}

/**
 * Rising and setting of a dough/batter piece: yeast proofs it by temperature and time, chemical leaveners
 * kick in when mixed and again when hot, the oven gives a last "spring", and once the crumb sets (~170 °F)
 * the volume is locked. Over-proofed dough collapses.
 */
export class DoughState {
  rise = 1;
  /** Peak rise reached (over-proof collapse drops below this). */
  peakRise = 1;
  set = false;
  private chemUsed = 0;

  constructor(readonly analysis: DoughAnalysis) {}

  /** Max sustainable rise before it collapses: gluten-strong, well-hydrated bread holds more gas. */
  get capacity(): number {
    const a = this.analysis;
    const hydrOk = a.hydration < 0.55 ? 0.45 + a.hydration : a.hydration > 0.85 ? 1.5 - (a.hydration - 0.85) * 2 : 1;
    return 1 + 1.6 * Math.max(0.2, hydrOk);
  }

  step(dt: number, food: FoodItem): void {
    const t = food.thermal;
    const coreC = t.coreTemp();
    if (this.set) return;
    const a = this.analysis;
    // Yeast: doubles in ~1–1.5 h at ~78 °F with ~1 % yeast.
    const yRate = a.yeast > 0 ? (yeastActivity(coreC) * Math.min(a.yeast / 0.012, 3)) / 3600 : 0;
    // A stiff (dry) dough resists the gas: it rises less.
    const stiff = Math.min(Math.max((a.hydration - 0.35) / 0.3, 0.2), 1);
    this.rise += yRate * dt * 1.6 * stiff * Math.max(0, 1 - (this.rise - 1) / (this.capacity * 1.4));
    // Chemical: a third reacts on mixing (taken at creation), the rest when warm (double-acting powder).
    if (a.chem > 0 && coreC > 45 && this.chemUsed < 1) {
      const d = Math.min(1 - this.chemUsed, dt / 300);
      this.chemUsed += d;
      this.rise += d * Math.min(a.chem / 0.035, 1.5) * 0.9;
    }
    // Oven spring: gas expands as it heats.
    if (coreC > 40 && coreC < 75) this.rise += dt * 0.00035 * Math.min(this.rise, 2) * stiff;
    if (this.rise > this.peakRise) this.peakRise = this.rise;
    // Over-proof: past capacity it can't hold the gas and slumps.
    if (this.rise > this.capacity) this.rise -= (this.rise - this.capacity) * Math.min(1, dt / 600);
    // Crumb sets (starch gelatinized + egg/gluten set) around 170 °F at the core.
    if (cToF(t.corePeak()) > 170) this.set = true;
  }
}

export interface BakeReport {
  /** 0..1 share of the crumb that reached ~200 °F (fully baked). */
  baked: number;
  gummyCenter: boolean;
  /** Water lost, % of dough weight. */
  moistureLossPct: number;
  crust: number;
  burnt: boolean;
  rise: number;
  crumb: 'raw' | 'gummy' | 'tender' | 'open' | 'dense' | 'dry';
}

/** How a baked piece turned out, from its thermal grid and rise. */
export function bakeReport(food: FoodItem, dough: DoughState): BakeReport {
  const t = food.thermal;
  let baked = 0;
  for (let c = 0; c < t.N; c++) if (t.mask[c] && cToF(t.peak[c]) >= 198) baked++;
  const share = baked / t.cellCount;
  const corePeakF = cToF(t.corePeak());
  const loss = (1 - t.mass() / t.mass0) * 100;
  const a = dough.analysis;
  // Crumb moisture (inner cells): a slack, over-hydrated dough holds too much water and stays gummy.
  let w = 0;
  let n = 0;
  for (let c = 0; c < t.N; c++) {
    if (!t.mask[c] || t.surfaceFaceCount(c) > 0) continue;
    w += t.w[c];
    n++;
  }
  const crumbWater = n ? w / n : t.mean(t.w);
  const gummy = corePeakF < 190 || (a.hydration > 0.85 && crumbWater > 0.4);
  let crumb: BakeReport['crumb'];
  if (corePeakF < 150) crumb = 'raw';
  else if (gummy) crumb = 'gummy';
  else if (loss > 18) crumb = 'dry';
  else if (dough.rise < 1.8 && a.yeast > 0) crumb = 'dense';
  else crumb = a.yeast > 0 ? 'open' : 'tender';
  return { baked: share, gummyCenter: gummy, moistureLossPct: loss, crust: t.browning(), burnt: t.char() > 0.35, rise: dough.rise, crumb };
}
