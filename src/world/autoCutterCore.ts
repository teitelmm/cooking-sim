import { FoodItem, type Plane } from '../sim/food';
import { splitFood } from '../sim/split';
import { clipConvex } from './convex';

type V3 = [number, number, number];

export interface CutMode {
  id: 'slices' | 'fries' | 'wedges' | 'dice';
  label: string;
  /** Piece thickness, m (wedges: number of wedges). */
  size: number;
}

export const CUT_MODES: CutMode[] = [
  { id: 'slices', label: 'SLICE 1/8"', size: 0.0032 * 2 }, // ¼" rounds: thin enough to read as slices, not a hundred bodies
  { id: 'fries', label: 'FRY 3/8"', size: 0.0095 },
  { id: 'wedges', label: 'WEDGE x8', size: 8 },
  { id: 'dice', label: 'DICE 3/4"', size: 0.019 },
];

/** Axis indices sorted longest → shortest. */
function axesBySize(size: V3): number[] {
  return [0, 1, 2].sort((a, b) => size[b] - size[a]);
}

/** Evenly spaced planes perpendicular to `axis`, `step` apart, centered on the food. */
function gridPlanes(axis: number, extent: number, step: number): Plane[] {
  const n = Math.floor(extent / step);
  if (n < 1) return [];
  const used = n * step;
  const start = -used / 2;
  const out: Plane[] = [];
  for (let i = 1; i < n; i++) {
    const nn: V3 = [0, 0, 0];
    nn[axis] = 1;
    out.push({ n: nn, d: start + i * step });
  }
  // Ends left over from centering become the end pieces (slightly bigger, like a real mandoline's heel).
  return out;
}

/** Precomputed cut planes (food-grid frame) for a mode and food size. */
export function planesFor(mode: CutMode, size: V3): Plane[] {
  const [long, mid, short] = axesBySize(size);
  switch (mode.id) {
    case 'slices':
      return gridPlanes(long, size[long], mode.size);
    case 'fries':
      return [...gridPlanes(mid, size[mid], mode.size), ...gridPlanes(short, size[short], mode.size)];
    case 'dice':
      return [...gridPlanes(long, size[long], mode.size), ...gridPlanes(mid, size[mid], mode.size), ...gridPlanes(short, size[short], mode.size)];
    case 'wedges': {
      // Planes through the long axis, evenly rotated: 4 planes → 8 wedges.
      const k = Math.max(1, Math.round(mode.size / 2));
      const out: Plane[] = [];
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI;
        const nn: V3 = [0, 0, 0];
        nn[mid] = Math.cos(a);
        nn[short] = Math.sin(a);
        out.push({ n: nn, d: 0 });
      }
      return out;
    }
  }
}

/** Scrap threshold per mode (fraction of the whole). */
export function minPieceFrac(mode: CutMode): number {
  return mode.id === 'wedges' ? 0.03 : 0.003;
}

export interface Piece {
  food: FoodItem;
  /** Convex hull in the piece's own grid frame. */
  hull: V3[];
}

/**
 * Cut a food (with its convex hull, both in the food-grid frame) by every plane: each existing piece the
 * plane crosses is split. Pieces keep their full sim state (temperatures, doneness, seasoning).
 */
export function cutIntoPieces(food: FoodItem, hull: V3[], planes: Plane[], maxPieces = 120, minMassFrac = 0.003): Piece[] {
  const minMass = food.thermal.mass() * minMassFrac;
  // Track hulls in the root frame; each piece's own frame is offset by (origin - root origin).
  const root = food.origin;
  let pieces: { food: FoodItem; hullRoot: V3[] }[] = [{ food, hullRoot: hull.map((p) => [p[0], p[1], p[2]] as V3) }];
  for (const pl of planes) {
    const next: typeof pieces = [];
    for (const pc of pieces) {
      if (next.length + pieces.length > maxPieces * 2) {
        next.push(pc);
        continue;
      }
      const off: V3 = [pc.food.origin[0] - root[0], pc.food.origin[1] - root[1], pc.food.origin[2] - root[2]];
      const local: Plane = { n: pl.n, d: pl.d - (pl.n[0] * off[0] + pl.n[1] * off[1] + pl.n[2] * off[2]) };
      const [a, b] = splitFood(pc.food, local);
      if (!a || !b) {
        next.push(pc);
        continue;
      }
      const ha = clipConvex(pc.hullRoot, pl.n, pl.d);
      const hb = clipConvex(pc.hullRoot, [-pl.n[0], -pl.n[1], -pl.n[2]], -pl.d);
      if (ha.length >= 4) next.push({ food: a, hullRoot: ha });
      if (hb.length >= 4) next.push({ food: b, hullRoot: hb });
    }
    pieces = next;
  }
  // Scraps (slivers where planes meet on the grid) fall away.
  pieces = pieces.filter((p) => p.food.thermal.mass() >= minMass);
  return pieces.slice(0, maxPieces).map((p) => {
    const off: V3 = [p.food.origin[0] - root[0], p.food.origin[1] - root[1], p.food.origin[2] - root[2]];
    return { food: p.food, hull: p.hullRoot.map((q) => [q[0] - off[0], q[1] - off[1], q[2] - off[2]] as V3) };
  });
}
