import type { FoodItem, Plane } from './food';
import { Tissue } from './foodThermal';

type V3 = [number, number, number];

/** How hard a food is to cut through (1 = a cooked steak). Raw meat is tough; braised/rested meat and cooked veg are easy. */
export function cutResistance(food: FoodItem): number {
  const t = food.thermal;
  const p = food.props;
  if (p.protein) {
    let lean = 0;
    let peakSum = 0;
    let bone = 0;
    for (let c = 0; c < t.N; c++) {
      if (!t.mask[c]) continue;
      if (t.tissue[c] === Tissue.Bone) bone++;
      else {
        lean++;
        peakSum += t.peak[c];
      }
    }
    const peak = lean ? peakSum / lean : 20;
    // Raw muscle is springy and tough; denatured is firmer but slices cleanly; over-cooked gets tough again.
    let r = peak < 45 ? 2.4 : peak < 60 ? 1.6 : peak < 75 ? 1.0 : 1.3;
    const coll = p.collagen ? t.mean(t.collagen) / p.collagen : 1;
    if (p.collagen && p.collagen > 0.5) r *= 0.4 + 0.6 * coll; // braised/low-and-slow falls apart
    if (food.restTime > 300) r *= 0.85; // rested meat is more tender and loses less juice
    if (bone > t.cellCount * 0.05) r *= 1.3;
    return r;
  }
  // Produce: firm raw, soft when cooked.
  const base = p.kind === 'potato' ? 1.0 : p.sugar && p.sugar > 0.5 ? 1.2 : 0.7;
  return base * (1 - 0.7 * t.mean(t.soft));
}

export interface AssistOptions {
  /** Snap the blade to the food's axes within this angle, degrees. */
  snapAngleDeg: number;
  /** Snap the cut position to a grid of this thickness, m (0 = free). */
  sliceThickness: number;
  /** Don't make pieces thinner than this, m. */
  minPiece: number;
}

export function assistFor(food: FoodItem): AssistOptions {
  if (food.props.protein) return { snapAngleDeg: 8, sliceThickness: 0, minPiece: 0.004 };
  // Veg: forgiving — strong angle snap and an even slice grid.
  return { snapAngleDeg: 14, sliceThickness: 0.006, minPiece: 0.003 };
}

/**
 * Turn a sloppy blade plane (food-local) into the intended cut: snap the blade square to the food when it's
 * close, and for vegetables snap its position onto an even grid measured from the food's current end so
 * repeated cuts produce even slices. Returns null when the cut would make a sliver.
 */
export function assistCutPlane(food: FoodItem, plane: Plane, opts: AssistOptions = assistFor(food)): Plane | null {
  const len = Math.hypot(...plane.n);
  let n: V3 = [plane.n[0] / len, plane.n[1] / len, plane.n[2] / len];
  let d = plane.d / len;
  // Angle snap to the nearest local axis.
  let axis = 0;
  for (let a = 1; a < 3; a++) if (Math.abs(n[a]) > Math.abs(n[axis])) axis = a;
  const cos = Math.abs(n[axis]);
  const snapped = cos >= Math.cos((opts.snapAngleDeg * Math.PI) / 180);
  if (snapped) {
    const sign = Math.sign(n[axis]) || 1;
    // Keep the plane through the same point on the blade's center line.
    const p0: V3 = [n[0] * d, n[1] * d, n[2] * d];
    n = [0, 0, 0];
    n[axis] = sign;
    d = p0[axis] * sign;
  }
  const half = food.size[axis] / 2;
  if (snapped && opts.sliceThickness > 0) {
    // Measure the slice grid from the end the blade is nearer — that's the slice coming off.
    const coord = d * n[axis];
    const T = opts.sliceThickness;
    // Anything within ~1.6 slices of the end is meant as one slice.
    const slices = (fromEnd: number) => (fromEnd < 1.6 * T ? 1 : Math.round(fromEnd / T));
    const snappedCoord = coord >= 0 ? half - slices(half - coord) * T : -half + slices(coord + half) * T;
    d = snappedCoord * n[axis];
  }
  // Reject slivers.
  if (snapped) {
    const coord = d * n[axis];
    if (coord - -half < opts.minPiece || half - coord < opts.minPiece) return null;
  }
  return { n, d };
}
