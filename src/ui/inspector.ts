import type { FoodItem } from '../sim/food';
import type { BakeReport } from '../sim/baking';
import { cToF } from '../sim/units';

export interface InspectCard {
  title: string;
  rows: [string, string][];
  notes: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Browning index (0 … 1.6, 1 ≈ a full golden-brown crust) in words. */
export function browningLabel(b: number): string {
  if (b < 0.15) return 'pale';
  if (b < 0.45) return 'light golden';
  if (b < 0.85) return 'golden brown';
  if (b < 1.25) return 'deep brown';
  return 'dark mahogany';
}
const DONENESS_LABEL: Record<string, string> = {
  raw: 'Raw',
  rare: 'Rare',
  'medium-rare': 'Medium-rare',
  medium: 'Medium',
  'medium-well': 'Medium-well',
  'well-done': 'Well-done',
};

/**
 * Score-free "how did it turn out" card: what a cook would notice cutting into it — doneness by the peak
 * core temperature, crust and char, juiciness, plus food-specific notes (tender ribs, crisp fries, gummy
 * bread). Pure function of the sim state so it is testable.
 */
export function inspectFood(food: FoodItem, name: string, opts: { bake?: BakeReport; restedS?: number } = {}): InspectCard {
  const s = food.summary();
  const p = food.props;
  const t = food.thermal;
  const rows: [string, string][] = [];
  const notes: string[] = [];
  const charMax = Math.max(...s.char);
  const charMean = s.char.reduce((a, b) => a + b, 0) / 6;
  const brownMax = Math.max(...s.browning);

  if (p.protein && p.kind !== 'egg') {
    rows.push(['Doneness', `${DONENESS_LABEL[s.doneness]} (peak ${Math.round(s.peakCoreF)}°F)`]);
  }
  rows.push(['Internal temp', `${Math.round(s.coreF)}°F`]);
  rows.push(['Surface', `${Math.round(s.surfaceF)}°F`]);
  rows.push(['Crust', `${browningLabel(brownMax)} (best side)`]);
  rows.push(['Char', `${pct(charMean)} avg · ${pct(charMax)} worst side`]);
  if (p.protein || p.water > 0.5) rows.push(['Juiciness', `${pct(s.juiciness)} of its water`]);
  rows.push(['Cook loss', `${s.cookLossPct.toFixed(1)}% by weight`]);
  if (p.collagen && p.collagen > 0.5) rows.push(['Tenderness', pct(s.tenderness)]);
  if (p.starch && !opts.bake) rows.push(['Starch cooked', pct(s.gelatinized)]);
  if (p.softens) rows.push(['Softness', pct(s.softness)]);
  if (s.crispness > 0.05 && (p.starch || p.kind === 'poultry' || t.oilAbsorbed > 1e-4)) rows.push(['Crispness', pct(s.crispness)]);
  if (t.oilAbsorbed > 1e-4) rows.push(['Oil absorbed', `${((t.oilAbsorbed / t.mass()) * 100).toFixed(1)}%`]);
  const flavors = Object.entries(s.flavors).filter(([, v]) => v > 0);
  if (flavors.length) rows.push(['Seasoning', flavors.map(([k]) => k).join(', ')]);
  // Intact beef is safe once the outside is seared; the doneness row covers the inside.
  if (s.safety !== 'n/a' && p.kind !== 'beef') rows.push(['Food safety', s.safety === 'safe' ? `safe (reached ${p.safeTempF}°F)` : `not yet ${p.safeTempF}°F everywhere`]);

  if (opts.bake) {
    const b = opts.bake;
    rows.push(['Crumb', b.crumb]);
    rows.push(['Baked through', pct(b.baked)]);
    if (b.rise > 1) rows.push(['Rise', `${b.rise.toFixed(1)}×`]);
    if (b.gummyCenter) notes.push('The center is gummy — it needed longer, or a lower oven so the inside catches up.');
    if (b.burnt) notes.push('The crust burnt before the inside finished.');
  }

  // Observations.
  if (charMax > 0.5) notes.push('One side is blackened — it sat too long without flipping.');
  else if (charMax > 0.2) notes.push('Some bitter char on the hottest side.');
  if (p.protein && brownMax < 0.3 && cToF(t.corePeak()) > 110) notes.push('Pale outside: the surface never got hot or dry enough to brown.');
  if (p.protein && s.safety === 'unsafe' && p.kind === 'poultry') notes.push('Undercooked poultry — keep going until it reads 165°F at the thickest part.');
  if (p.protein && p.kind === 'beef' && s.doneness === 'well-done' && s.juiciness < 0.75) notes.push('Dry and gray all the way through.');
  if (p.collagen && p.collagen > 0.5 && s.tenderness < 0.5) notes.push('Still chewy: the connective tissue needs hours low-and-slow to melt.');
  if (s.spiceBurn > 0.3) notes.push('The spices scorched and taste acrid.');
  if (t.freeJuice() > 0.004 && (opts.restedS ?? 0) < 120 && p.protein) notes.push('Cut right away, a lot of juice will run out — rest it a few minutes first.');
  if (p.fat && cToF(t.corePeak()) > 120 && cToF(t.coreTemp()) > cToF(t.corePeak()) - 3 && cToF(t.surfaceTemp()) > cToF(t.coreTemp()) + 30)
    notes.push('Carryover: the inside will keep climbing a few degrees while it rests.');
  return { title: name, rows, notes };
}
