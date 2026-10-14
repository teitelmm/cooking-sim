import { FoodItem, type Plane } from './food';
import { FoodThermal } from './foodThermal';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Is a point (food-local, m) inside the food's material? Uses the grid mask plus its cut planes. */
export function insideFood(food: FoodItem, p: V3): boolean {
  const c = food.thermal.cellAt(p[0], p[1], p[2]);
  if (c < 0 || !food.thermal.mask[c]) return false;
  for (const pl of food.cuts) if (dot(pl.n, p) > pl.d + 1e-9) return false;
  return true;
}

/**
 * Cut a food along a plane (food-local: n·p = d). Returns the two pieces (either may be null if the
 * plane misses). Each piece is re-gridded at its own resolution and inherits every cell's state
 * (temperature, peak, water, juice, collagen…) by sampling the parent, so a cut steak keeps its exact
 * doneness gradient. Faces that were the parent's outside keep their crust/browning/char; faces on the
 * new cut start fresh and wet with juice.
 */
export function splitFood(food: FoodItem, plane: Plane): [FoodItem | null, FoodItem | null] {
  const len = Math.hypot(...plane.n);
  const n: V3 = [plane.n[0] / len, plane.n[1] / len, plane.n[2] / len];
  const d = plane.d / len;
  return [piece(food, n, d), piece(food, [-n[0], -n[1], -n[2]], -d)];
}

function piece(parent: FoodItem, n: V3, d: number): FoodItem | null {
  const pt = parent.thermal;
  // Bounds of the kept region from the parent's cells (clipped to the plane along each axis).
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const half: V3 = [pt.d[0] / 2, pt.d[1] / 2, pt.d[2] / 2];
  let any = false;
  for (let c = 0; c < pt.N; c++) {
    if (!pt.mask[c]) continue;
    const cc = pt.cellCenter(c);
    // Corners of the cell that are on the kept side.
    for (let corner = 0; corner < 8; corner++) {
      const p: V3 = [cc[0] + (corner & 1 ? half[0] : -half[0]), cc[1] + (corner & 2 ? half[1] : -half[1]), cc[2] + (corner & 4 ? half[2] : -half[2])];
      if (dot(n, p) > d) continue;
      if (!parent.cuts.every((pl) => dot(pl.n, p) <= pl.d + 1e-9)) continue;
      // Part of this cell is kept: include the whole cell, the plane clip below trims it.
      any = true;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], cc[a] - half[a]);
        hi[a] = Math.max(hi[a], cc[a] + half[a]);
      }
      break;
    }
  }
  if (!any) return null;
  // Clip the bounds by the plane itself where it is axis-aligned enough.
  for (let a = 0; a < 3; a++) {
    if (Math.abs(n[a]) > 0.999) {
      const v = d / n[a];
      if (n[a] > 0) hi[a] = Math.min(hi[a], v);
      else lo[a] = Math.max(lo[a], v);
    }
  }
  const size: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  if (size.some((s) => s < 1e-4)) return null;
  const center: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  // Express the planes in the piece's local frame (translation only).
  const toLocal = (pl: Plane): Plane => ({ n: pl.n, d: pl.d - dot(pl.n, center) });
  const cuts = [...parent.cuts.map(toLocal), toLocal({ n, d })];
  const insideParent = (x: number, y: number, z: number) => {
    const p: V3 = [x + center[0], y + center[1], z + center[2]];
    return insideFood(parent, p) && dot(n, p) <= d + 1e-9;
  };

  const child = new FoodItem(parent.id, size, {
    props: parent.props,
    initialT: 20,
    inside: insideParent,
    areaScale: pt.areaScale,
    origin: [parent.origin[0] + center[0], parent.origin[1] + center[1], parent.origin[2] + center[2]],
    cuts,
    seed: parent.seed,
  });
  const ct = child.thermal;
  if (ct.cellCount === 0) return null;

  // Copy cell state (nearest parent cell inside the food).
  const fields: (keyof FoodThermal & ('T' | 'w' | 'peak' | 'juice' | 'collagen' | 'starch' | 'soft' | 'fat'))[] = ['T', 'w', 'peak', 'juice', 'collagen', 'starch', 'soft', 'fat'];
  for (let c = 0; c < ct.N; c++) {
    if (!ct.mask[c]) continue;
    const cc = ct.cellCenter(c);
    const p: V3 = [cc[0] + center[0], cc[1] + center[1], cc[2] + center[2]];
    let pc = pt.cellAt(p[0], p[1], p[2]);
    if (pc < 0 || !pt.mask[pc]) pc = nearestMasked(pt, p);
    for (const f of fields) (ct[f] as Float32Array)[c] = (pt[f] as Float32Array)[pc];
    ct.tissue[c] = pt.tissue[pc];
    ct.w0c[c] = pt.w0c[pc];
    ct.capRel[c] = pt.capRel[pc];
  }

  // Faces: inherit the parent's surface where this face lies on it; otherwise it's a fresh cut.
  const parentFace = new Map<number, number>();
  for (let f = 0; f < pt.faceCount; f++) parentFace.set(pt.faceCell[f] * 6 + pt.faceDir[f], f);
  const DIRV: V3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (let f = 0; f < ct.faceCount; f++) {
    const c = ct.faceCell[f];
    const dir = ct.faceDir[f];
    const cc = ct.cellCenter(c);
    const dv = DIRV[dir];
    const a = dir >> 1;
    // Face center in parent coords, then just outside it.
    const p: V3 = [cc[0] + center[0], cc[1] + center[1], cc[2] + center[2]];
    p[a] += dv[a] * ct.d[a] * 0.5;
    const outside: V3 = [p[0] + dv[0] * pt.d[0] * 0.5, p[1] + dv[1] * pt.d[1] * 0.5, p[2] + dv[2] * pt.d[2] * 0.5];
    // Only faces pointing along the cut normal can be part of the cut surface.
    const onCut = Math.abs(dot(n, dv)) > 0.7 && Math.abs(dot(n, p) - d) < ct.d[a] * 0.75;
    const parentOutside = !insideFood(parent, outside);
    if (parentOutside && !onCut) {
      // Find the parent face for the parent cell just inside.
      const inside: V3 = [p[0] - dv[0] * pt.d[0] * 0.5, p[1] - dv[1] * pt.d[1] * 0.5, p[2] - dv[2] * pt.d[2] * 0.5];
      let pc = pt.cellAt(inside[0], inside[1], inside[2]);
      if (pc < 0 || !pt.mask[pc]) pc = nearestMasked(pt, inside);
      const pf = parentFace.get(pc * 6 + dir);
      if (pf !== undefined) {
        ct.crust[f] = pt.crust[pf];
        ct.brown[f] = pt.brown[pf];
        ct.charred[f] = pt.charred[pf];
        ct.surfT[f] = pt.surfT[pf];
        ct.isCut[f] = pt.isCut[pf];
        ct.salt[f] = pt.salt[pf];
        ct.saltAge[f] = pt.saltAge[pf];
        ct.spice[f] = pt.spice[pf];
        ct.spiceBurn[f] = pt.spiceBurn[pf];
        ct.fryCrust[f] = pt.fryCrust[pf];
        ct.fryMax[f] = pt.fryMax[pf];
        continue;
      }
    }
    // Fresh cut face: wet with juice, unbrowned.
    ct.isCut[f] = 1;
    ct.crust[f] = ct.crustMax;
    ct.brown[f] = 0;
    ct.charred[f] = 0;
    ct.surfT[f] = ct.T[c];
  }
  child.restTime = parent.restTime;
  ct.spiceSens = pt.spiceSens;
  const share = ct.mass() / Math.max(pt.mass(), 1e-9);
  for (const [k, v] of Object.entries(parent.flavors)) child.flavors[k] = v * share;
  return child;
}

function nearestMasked(t: FoodThermal, p: V3): number {
  let best = -1;
  let bd = Infinity;
  for (let c = 0; c < t.N; c++) {
    if (!t.mask[c]) continue;
    const cc = t.cellCenter(c);
    const dd = (cc[0] - p[0]) ** 2 + (cc[1] - p[1]) ** 2 + (cc[2] - p[2]) ** 2;
    if (dd < bd) {
      bd = dd;
      best = c;
    }
  }
  return best;
}

/**
 * Juice that runs out when cutting through this plane, kg: the free juice in the cells along the cut
 * plus a share of the piece's mobile juice (proportional to how much cut surface was opened).
 */
export function juiceReleased(food: FoodItem, plane: Plane): number {
  const t = food.thermal;
  const len = Math.hypot(...plane.n);
  let near = 0;
  for (let c = 0; c < t.N; c++) {
    if (!t.mask[c]) continue;
    const cc = t.cellCenter(c);
    const dist = Math.abs(dot(plane.n, cc) / len - plane.d / len);
    const reach = Math.max(...t.d) * 1.5;
    if (dist < reach) near += t.juice[c] * (1 - dist / reach);
  }
  return near * t.cellMass * 3;
}
