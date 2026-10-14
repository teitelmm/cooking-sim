import type { FoodItem, Plane } from '../sim/food';
import { fatColor, hex, interiorColor, marbling, mix, surfaceColor, type RGB } from './foodColor';
import { insideFood } from '../sim/split';

type V3 = [number, number, number];

export interface PlaneBasis {
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
  /** Extent along u and v covering the food, m. */
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

const DIRV: V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Orthonormal basis on the plane, sized to the food's bounds. */
export function planeBasis(food: FoodItem, plane: Plane): PlaneBasis {
  const n = norm(plane.n);
  const d = plane.d / Math.hypot(...plane.n);
  const origin: V3 = [n[0] * d, n[1] * d, n[2] * d];
  // Prefer v = local up projected on the plane so cross-sections read "thickness vertical".
  let up: V3 = [0, 1, 0];
  if (Math.abs(dot(up, n)) > 0.9) up = [0, 0, -1];
  const u = norm(cross(up, n));
  const v = norm(cross(n, u));
  const [sx, sy, sz] = food.size.map((s) => s / 2);
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let c = 0; c < 8; c++) {
    const p: V3 = [c & 1 ? sx : -sx, c & 2 ? sy : -sy, c & 4 ? sz : -sz];
    const rel: V3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    const pu = dot(rel, u);
    const pv = dot(rel, v);
    uMin = Math.min(uMin, pu);
    uMax = Math.max(uMax, pu);
    vMin = Math.min(vMin, pv);
    vMax = Math.max(vMax, pv);
  }
  return { origin, u, v, n, uMin, uMax, vMin, vMax };
}

export interface CrossSectionImage {
  width: number;
  height: number;
  /** RGBA8, row 0 = vMin. Alpha 0 outside the food. */
  data: Uint8ClampedArray;
  basis: PlaneBasis;
}

/** Distance (m) from a point to the food's original (uncut) outside along the six axes, capped. */
function distanceToSkin(food: FoodItem, p: V3, maxD: number, step: number): { d: number; dir: number } {
  const dirs: V3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let best = { d: maxD, dir: -1 };
  dirs.forEach((dv, dir) => {
    for (let s = step; s <= maxD; s += step) {
      const q: V3 = [p[0] + dv[0] * s, p[1] + dv[1] * s, p[2] + dv[2] * s];
      // Leaving through a cut plane isn't "skin".
      if (food.cuts.some((pl) => dot(pl.n, q) > pl.d + 1e-6)) break;
      const c = food.thermal.cellAt(q[0], q[1], q[2]);
      if (c < 0 || !food.thermal.mask[c]) {
        if (s < best.d) best = { d: s, dir };
        break;
      }
    }
  });
  return best;
}

/**
 * Render what you see when you cut the food along `plane`: the interior doneness gradient sampled from
 * the thermal grid (peak temperature → myoglobin color), the browned/charred crust band where the cut
 * meets the outside, and fat marbling. Pure function (no DOM), returns RGBA pixels.
 */
export function crossSectionImage(food: FoodItem, plane: Plane, rawColor: number, pxPerMeter = 2400): CrossSectionImage {
  const b = planeBasis(food, plane);
  const width = Math.max(8, Math.min(256, Math.round((b.uMax - b.uMin) * pxPerMeter)));
  const height = Math.max(8, Math.min(256, Math.round((b.vMax - b.vMin) * pxPerMeter)));
  const data = new Uint8ClampedArray(width * height * 4);
  const t = food.thermal;
  const raw = hex(rawColor);
  const fat = food.props.fat ?? 0;
  const crustBand = 0.0016;
  const step = 0.0003;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pu = b.uMin + ((x + 0.5) / width) * (b.uMax - b.uMin);
      const pv = b.vMin + ((y + 0.5) / height) * (b.vMax - b.vMin);
      const p: V3 = [b.origin[0] + b.u[0] * pu + b.v[0] * pv, b.origin[1] + b.u[1] * pu + b.v[1] * pv, b.origin[2] + b.u[2] * pu + b.v[2] * pv];
      const o = (y * width + x) * 4;
      if (!insideFood(food, p)) {
        data[o + 3] = 0;
        continue;
      }
      const peak = t.sample(t.peak, p[0], p[1], p[2]);
      const w = t.sample(t.w, p[0], p[1], p[2]) / t.w0;
      const gel = t.sample(t.starch, p[0], p[1], p[2]);
      const soft = t.sample(t.soft, p[0], p[1], p[2]);
      const cell = t.cellAt(p[0], p[1], p[2]);
      const tissue = cell >= 0 ? t.tissue[cell] : 0;
      let c: RGB = interiorColor(food.props, peak, w, gel, soft, raw, tissue);
      if (fat > 0 && tissue === 0) {
        const g: V3 = [p[0] + food.origin[0], p[1] + food.origin[1], p[2] + food.origin[2]];
        const m = marbling(g[0], g[1], g[2], fat);
        if (m > 0) c = mix(c, fatColor(peak), m * 0.9);
      }
      // Crust band near the original outside.
      const skin = distanceToSkin(food, p, crustBand * 2.5, step);
      if (skin.dir >= 0) {
        const dv = DIRV[skin.dir];
        const back = skin.d - step * 0.5;
        const cell = t.cellAt(p[0] + dv[0] * back, p[1] + dv[1] * back, p[2] + dv[2] * back);
        let fIdx = cell >= 0 ? t.faceOf(cell, skin.dir) : -1;
        if (fIdx < 0) fIdx = nearestFace(food, p, skin.dir);
        if (fIdx >= 0) {
          const brown = t.brown[fIdx];
          const char = t.charred[fIdx];
          const band = crustBand * Math.min(1, 0.35 + brown * 0.6 + char);
          if (skin.d <= band) {
            const sc = surfaceColor(food.props, raw, peak, brown, char, w, gel, soft, tissue, t.spiceBurn[fIdx], t.spice[fIdx]);
            c = mix(c, sc, 1 - skin.d / (band * 1.2));
          }
        }
      }
      data[o] = c[0] * 255;
      data[o + 1] = c[1] * 255;
      data[o + 2] = c[2] * 255;
      data[o + 3] = 255;
    }
  }
  return { width, height, data, basis: b };
}

function nearestFace(food: FoodItem, p: V3, dir: number): number {
  const t = food.thermal;
  let best = -1;
  let bd = Infinity;
  for (let f = 0; f < t.faceCount; f++) {
    if (t.faceDir[f] !== dir) continue;
    const cc = t.cellCenter(t.faceCell[f]);
    const d = (cc[0] - p[0]) ** 2 + (cc[1] - p[1]) ** 2 + (cc[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}
