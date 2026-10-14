import { cToF, fToC } from './units';

/** Steak doneness by the peak core temperature reached (°F): protein changes are irreversible. */
export type Doneness = 'raw' | 'rare' | 'medium-rare' | 'medium' | 'medium-well' | 'well-done';

/** Lower bounds, °F. Rare ~120–125, medium-rare 130–135, medium 140–145, medium-well 150–155, well ≥ 160. */
export const DONENESS_F: [Doneness, number][] = [
  ['well-done', 158],
  ['medium-well', 148],
  ['medium', 138],
  ['medium-rare', 128],
  ['rare', 115],
  ['raw', -Infinity],
];

export function donenessOf(peakC: number): Doneness {
  const f = cToF(peakC);
  for (const [d, lo] of DONENESS_F) if (f >= lo) return d;
  return 'raw';
}

/**
 * Fraction of the original water a muscle cell can still hold after reaching `peakC`.
 * Myosin denatures ~50–60 °C (120–140 °F): modest loss. Actin ~66–74 °C (150–165 °F): big squeeze.
 * A well-done steak ends ~25–30 % lighter, mostly water.
 */
export function waterHolding(peakC: number): number {
  const s = (x: number, lo: number, hi: number) => Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return 1 - 0.02 * smooth(s(peakC, 40, 49)) - 0.08 * smooth(s(peakC, 49, 60)) - 0.16 * smooth(s(peakC, 64, 75)) - 0.07 * smooth(s(peakC, 75, 90));
}

/** Fraction of myoglobin denatured (red → pink → gray-brown), from peak temperature. */
export function myoglobinDenatured(peakC: number): number {
  // Starts ~ 55 °C (130 °F), mostly done by ~ 75 °C (167 °F).
  const t = Math.min(Math.max((peakC - fToC(118)) / (fToC(166) - fToC(118)), 0), 1);
  return t * t * (3 - 2 * t);
}
