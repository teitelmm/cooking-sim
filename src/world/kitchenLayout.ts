/**
 * The kitchen as pure data. The same blocks build the render meshes and the static colliders, so the
 * layout can be stability-tested headless. Units: metres. x runs left→right along the counter,
 * y up, z toward the camera (counter front edge at z = +0.325, back wall at z = −0.35).
 */
import type { MaterialId } from '../data/materials';

export type Vec3 = [number, number, number];

export interface Block {
  /** Center and full size. */
  pos: Vec3;
  size: Vec3;
  material: MaterialId;
  color?: number;
  /** Top face is a support surface for items (tested for stability). */
  surface?: SurfaceKind;
  /** No collider (decor only). */
  visualOnly?: boolean;
  /** No mesh (invisible collider). */
  hidden?: boolean;
  /** Emissive glow color (burner rings, fridge light…). */
  emissive?: number;
  tag?: string;
  castShadow?: boolean;
}

/** 'all' = any item can rest here; 'cookware' = grates sized for pans only; 'grate' = fine grill grate. */
export type SurfaceKind = 'all' | 'cookware' | 'grate' | 'enclosed';

export interface Station {
  id: string;
  name: string;
  x0: number;
  x1: number;
}

export interface SpawnerSlot {
  itemId: string;
  /** Where the display copy sits (bottom-center of the item). */
  pos: Vec3;
  label: string;
}

/** Named volumes that later systems attach behavior to (heat sources, liquids). */
export interface Zone {
  id: string;
  kind: 'burner' | 'grill' | 'griddle' | 'oven' | 'fryer' | 'airFryer' | 'sousVide' | 'sink' | 'autoCutter';
  /** Center and full size of the active volume. */
  pos: Vec3;
  size: Vec3;
}

export interface PlacedItem {
  itemId: string;
  pos: Vec3;
}

export interface KitchenLayout {
  width: number;
  counterTop: number;
  blocks: Block[];
  stations: Station[];
  spawners: SpawnerSlot[];
  zones: Zone[];
  startItems: PlacedItem[];
  camera: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; start: Vec3 };
  /** World z range a held item may be moved within. */
  holdDepth: [number, number];
}

export const COUNTER_TOP = 0.9;
/** Grill grate bars (run along z): where they are decides where grill marks land. */
export const GRILL_BARS = { x0: 3.66, x1: 4.06, top: 0.91, width: 0.012, gap: 0.018 };
const TOP_T = 0.04; // counter slab thickness
const DEPTH = 0.65;
const FRONT = DEPTH / 2;
const BACK = -DEPTH / 2;
const WALL_Z = -0.35;

const blocks: Block[] = [];
const zones: Zone[] = [];
const spawners: SpawnerSlot[] = [];

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: MaterialId, extra: Partial<Block> = {}): Block {
  const b: Block = { pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], material, ...extra };
  blocks.push(b);
  return b;
}

interface Hole {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Depth of the well below the counter top. */
  depth: number;
  wallMaterial: MaterialId;
  wallColor?: number;
}

/** Base cabinet + counter top from x0..x1, optionally with a sunken well (sink, fryer). */
function counter(x0: number, x1: number, hole?: Hole, topMat: MaterialId = 'granite'): void {
  const top = COUNTER_TOP;
  const cabTop = hole ? top - hole.depth - 0.02 : top - TOP_T;
  box(x0 + 0.005, x1 - 0.005, 0.1, cabTop, BACK, FRONT - 0.02, 'wood', { color: 0x6b4f3a, tag: 'cabinet' });
  box(x0 + 0.03, x1 - 0.03, 0, 0.1, BACK, FRONT - 0.07, 'wood', { color: 0x2c221b, visualOnly: true });
  if (!hole) {
    box(x0, x1, top - TOP_T, top, BACK, FRONT, topMat, { surface: 'all', tag: 'counter-top' });
    return;
  }
  // Counter top around the hole.
  const s: Partial<Block> = { surface: 'all', tag: 'counter-top' };
  if (hole.x0 > x0) box(x0, hole.x0, top - TOP_T, top, BACK, FRONT, topMat, s);
  if (hole.x1 < x1) box(hole.x1, x1, top - TOP_T, top, BACK, FRONT, topMat, s);
  if (hole.z0 > BACK) box(hole.x0, hole.x1, top - TOP_T, top, BACK, hole.z0, topMat);
  if (hole.z1 < FRONT) box(hole.x0, hole.x1, top - TOP_T, top, hole.z1, FRONT, topMat);
  // Well walls + floor.
  const t = 0.012;
  const wy0 = top - hole.depth;
  const wm = hole.wallMaterial;
  const wc = { color: hole.wallColor };
  box(hole.x0, hole.x0 + t, wy0, top - 0.001, hole.z0, hole.z1, wm, wc);
  box(hole.x1 - t, hole.x1, wy0, top - 0.001, hole.z0, hole.z1, wm, wc);
  box(hole.x0, hole.x1, wy0, top - 0.001, hole.z0, hole.z0 + t, wm, wc);
  box(hole.x0, hole.x1, wy0, top - 0.001, hole.z1 - t, hole.z1, wm, wc);
  box(hole.x0, hole.x1, wy0 - 0.02, wy0, hole.z0, hole.z1, wm, { ...wc, surface: 'enclosed', tag: 'well-floor' });
}

/** Open-topped box sitting on a surface (bins, tubs). Floor top at y0 + t. */
function tub(cx: number, cz: number, w: number, d: number, h: number, y0: number, material: MaterialId, color?: number, t = 0.01): void {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const c = { color };
  box(x0, x1, y0, y0 + t, z0, z1, material, { ...c, surface: 'enclosed', tag: 'tub-floor' });
  box(x0, x0 + t, y0 + t, y0 + h, z0, z1, material, c);
  box(x1 - t, x1, y0 + t, y0 + h, z0, z1, material, c);
  box(x0 + t, x1 - t, y0 + t, y0 + h, z0, z0 + t, material, c);
  box(x0 + t, x1 - t, y0 + t, y0 + h, z1 - t, z1, material, c);
}

/** Parallel bars (grates). `along` = axis the bars run along. Top of bars at yTop. */
function bars(x0: number, x1: number, z0: number, z1: number, yTop: number, barW: number, gap: number, along: 'x' | 'z', material: MaterialId, surface: SurfaceKind, color?: number): void {
  const h = 0.012;
  if (along === 'z') {
    for (let x = x0 + barW / 2; x <= x1 - barW / 2 + 1e-6; x += barW + gap) box(x - barW / 2, x + barW / 2, yTop - h, yTop, z0, z1, material, { surface, color, tag: 'grate' });
  } else {
    for (let z = z0 + barW / 2; z <= z1 - barW / 2 + 1e-6; z += barW + gap) box(x0, x1, yTop - h, yTop, z - barW / 2, z + barW / 2, material, { surface, color, tag: 'grate' });
  }
}

// ---------------------------------------------------------------- room shell
const WIDTH = 8.2;
box(-0.5, WIDTH + 0.5, -0.05, 0, -1.5, 3, 'tile', { color: 0x6a5646, tag: 'floor' });
box(-0.5, WIDTH + 0.5, 0, 2.6, WALL_Z - 0.05, WALL_Z, 'tile', { color: 0xe6dccb, tag: 'wall' });
// Backsplash band (decor) and side walls.
box(-0.5, WIDTH + 0.5, COUNTER_TOP, 1.45, WALL_Z - 0.001, WALL_Z + 0.004, 'tile', { color: 0xf1ebe0, visualOnly: true, tag: 'backsplash' });
box(-0.55, -0.5, 0, 2.6, WALL_Z, FRONT + 0.4, 'tile', { color: 0xd8cdbb });
box(WIDTH + 0.5, WIDTH + 0.55, 0, 2.6, WALL_Z, FRONT + 0.4, 'tile', { color: 0xd8cdbb });

// ---------------------------------------------------------------- 1. fridge + pantry (0 – 1.4)
{
  const x0 = 0;
  const x1 = 0.8;
  const t = 0.04;
  const h = 1.85;
  const fc = 0xdfe3e6;
  box(x0, x0 + t, 0, h, BACK, FRONT, 'steel', { color: fc, tag: 'fridge' });
  box(x1 - t, x1, 0, h, BACK, FRONT, 'steel', { color: fc, tag: 'fridge' });
  box(x0, x1, h - t, h, BACK, FRONT, 'steel', { color: fc, tag: 'fridge' });
  box(x0 + t, x1 - t, 0, 0.12, BACK, FRONT, 'steel', { color: fc, tag: 'fridge' });
  box(x0 + t, x1 - t, 0.12, h - t, BACK, BACK + 0.02, 'plastic', { color: 0xf4f7f8 });
  const shelfYs = [0.42, 0.8, 1.18, 1.52];
  for (const y of shelfYs) box(x0 + t, x1 - t, y - 0.012, y, BACK + 0.02, FRONT - 0.03, 'glass', { surface: 'all', tag: 'fridge-shelf', color: 0xdbeef3 });
  // Open door swung out to the left (decor).
  box(x0 - 0.06, x0 - 0.02, 0.02, h - 0.02, FRONT, FRONT + 0.62, 'steel', { color: fc, visualOnly: true });
  box(x0 + t + 0.01, x1 - t - 0.01, h - t - 0.012, h - t - 0.004, -0.05, 0.05, 'plastic', { color: 0xffffff, emissive: 0xdff6ff, visualOnly: true, castShadow: false });
  spawners.push({ itemId: 'steak', pos: [0.26, 0.8, 0.08], label: 'Steak' });
  spawners.push({ itemId: 'chicken-breast', pos: [0.56, 0.8, 0.08], label: 'Chicken breast' });
  spawners.push({ itemId: 'egg', pos: [0.24, 1.18, 0.1], label: 'Eggs' });
  spawners.push({ itemId: 'butter', pos: [0.55, 1.18, 0.08], label: 'Butter' });
  spawners.push({ itemId: 'ribs', pos: [0.24, 0.42, 0.06], label: 'Pork ribs' });
  spawners.push({ itemId: 'short-ribs', pos: [0.6, 0.42, 0.06], label: 'Short ribs' });
  spawners.push({ itemId: 'whole-chicken', pos: [0.24, 0.12, 0.08], label: 'Whole chicken' });
  spawners.push({ itemId: 'chicken-thigh', pos: [0.58, 0.12, 0.08], label: 'Chicken thighs' });
  spawners.push({ itemId: 'ribeye-1in', pos: [0.2, 0.8, -0.14], label: 'Ribeye 1"' });
  spawners.push({ itemId: 'thick-ribeye', pos: [0.42, 0.8, -0.14], label: 'Ribeye 2"' });
  spawners.push({ itemId: 'strip-steak', pos: [0.64, 0.8, -0.14], label: 'NY strip' });
  spawners.push({ itemId: 'milk', pos: [0.6, 1.52, 0.02], label: 'Milk' });
}
{
  // Pantry: base cabinet with veg bins, wall shelves above.
  const x0 = 0.8;
  const x1 = 1.4;
  counter(x0, x1, undefined, 'butcherBlock');
  const binY = COUNTER_TOP;
  tub(0.92, 0.1, 0.2, 0.26, 0.09, binY, 'wood', 0x8a6142);
  tub(1.13, 0.1, 0.2, 0.26, 0.09, binY, 'wood', 0x8a6142);
  tub(1.31, 0.1, 0.15, 0.26, 0.09, binY, 'wood', 0x8a6142);
  spawners.push({ itemId: 'potato', pos: [0.92, binY + 0.012, 0.1], label: 'Potatoes' });
  spawners.push({ itemId: 'onion', pos: [1.13, binY + 0.012, 0.1], label: 'Onions' });
  spawners.push({ itemId: 'carrot', pos: [1.31, binY + 0.012, 0.1], label: 'Carrots' });
  for (const y of [1.32, 1.68]) {
    box(x0, x1, y - 0.02, y, WALL_Z, WALL_Z + 0.3, 'wood', { surface: 'all', tag: 'pantry-shelf', color: 0x9a6b43 });
  }
  spawners.push({ itemId: 'flour-bag', pos: [0.92, 1.32, -0.2], label: 'Flour' });
  spawners.push({ itemId: 'sugar-bag', pos: [1.1, 1.32, -0.2], label: 'Sugar' });
  spawners.push({ itemId: 'pasta-box', pos: [1.27, 1.32, -0.2], label: 'Spaghetti' });
  spawners.push({ itemId: 'oil-bottle', pos: [0.92, 1.68, -0.2], label: 'Oil' });
  spawners.push({ itemId: 'salt-shaker', pos: [1.08, 1.68, -0.2], label: 'Salt' });
  spawners.push({ itemId: 'pepper-shaker', pos: [1.18, 1.68, -0.2], label: 'Pepper' });
  spawners.push({ itemId: 'paprika-shaker', pos: [1.28, 1.68, -0.2], label: 'Paprika' });
}

// ---------------------------------------------------------------- 2. prep counter (1.4 – 2.8)
counter(1.4, 2.8);
{
  // Knife block + utensil shelf.
  box(2.62, 2.74, COUNTER_TOP, COUNTER_TOP + 0.16, -0.3, -0.18, 'wood', { color: 0x3b2a1e, tag: 'knife-block' });
  spawners.push({ itemId: 'chef-knife', pos: [2.68, COUNTER_TOP + 0.17, -0.24], label: "Chef's knife" });
  spawners.push({ itemId: 'herbs', pos: [1.48, COUNTER_TOP, -0.25], label: 'Herbs' });
  spawners.push({ itemId: 'bell-pepper', pos: [1.7, COUNTER_TOP, -0.22], label: 'Bell pepper' });
  spawners.push({ itemId: 'broccoli', pos: [1.85, COUNTER_TOP, -0.22], label: 'Broccoli' });
  spawners.push({ itemId: 'mushroom', pos: [1.98, COUNTER_TOP, -0.22], label: 'Mushroom' });
  spawners.push({ itemId: 'garlic', pos: [2.08, COUNTER_TOP, -0.24], label: 'Garlic' });
  spawners.push({ itemId: 'tongs', pos: [2.3, COUNTER_TOP, -0.26], label: 'Tongs' });
  spawners.push({ itemId: 'probe-thermometer', pos: [2.48, COUNTER_TOP, -0.27], label: 'Probe thermometer' });
  // Auto-cutter: wall-mounted steel hopper over a bowl (cutter blades in its floor).
  const ac = { x0: 1.53, x1: 1.71, z0: -0.04, z1: 0.12, floor: 1.02, top: 1.15 };
  box(ac.x0 - 0.01, ac.x1 + 0.01, COUNTER_TOP, ac.top, -0.105, -0.095, 'steel', { color: 0x9aa0a6, tag: 'cutter-mount' });
  box(ac.x0, ac.x1, ac.floor, ac.floor + 0.01, -0.095, ac.z1, 'steel', { color: 0x6d7378, tag: 'cutter-floor' });
  box(ac.x0, ac.x0 + 0.008, ac.floor, ac.top, -0.095, ac.z1, 'steel', { color: 0xb8bcc0 });
  box(ac.x1 - 0.008, ac.x1, ac.floor, ac.top, -0.095, ac.z1, 'steel', { color: 0xb8bcc0 });
  box(ac.x0, ac.x1, ac.floor, ac.top, ac.z1 - 0.008, ac.z1, 'steel', { color: 0xb8bcc0, tag: 'cutter-front' });
  zones.push({ id: 'auto-cutter', kind: 'autoCutter', pos: [(ac.x0 + ac.x1) / 2, (ac.floor + ac.top) / 2 + 0.01, (ac.z0 + ac.z1) / 2 - 0.02], size: [ac.x1 - ac.x0, ac.top - ac.floor, ac.z1 + 0.095] });

  // Spice rack above the prep counter.
  box(1.78, 2.2, 1.25, 1.265, WALL_Z, WALL_Z + 0.11, 'wood', { surface: 'all', tag: 'spice-rack', color: 0x8a6142 });
  spawners.push({ itemId: 'garlic-powder', pos: [1.83, 1.265, -0.295], label: 'Garlic powder' });
  spawners.push({ itemId: 'chili-flakes', pos: [1.9, 1.265, -0.295], label: 'Chili flakes' });
  spawners.push({ itemId: 'dried-herbs', pos: [1.97, 1.265, -0.295], label: 'Oregano' });
  spawners.push({ itemId: 'salt-shaker', pos: [2.04, 1.265, -0.295], label: 'Salt' });
  spawners.push({ itemId: 'pepper-shaker', pos: [2.11, 1.265, -0.295], label: 'Pepper' });
  spawners.push({ itemId: 'wooden-spoon', pos: [2.4, COUNTER_TOP, -0.18], label: 'Wooden spoon' });

  // Pot rack shelf above (cookware spawners).
  box(1.45, 2.75, 1.58, 1.6, WALL_Z, WALL_Z + 0.32, 'steel', { surface: 'all', tag: 'pot-shelf', color: 0x8d9296 });
  spawners.push({ itemId: 'cast-iron-pan', pos: [1.65, 1.6, -0.19], label: 'Cast-iron skillet' });
  spawners.push({ itemId: 'stainless-pan', pos: [2.0, 1.6, -0.19], label: 'Stainless skillet' });
  spawners.push({ itemId: 'stock-pot', pos: [2.4, 1.6, -0.19], label: 'Stock pot' });
  spawners.push({ itemId: 'mixing-bowl', pos: [2.65, 1.6, -0.19], label: 'Mixing bowl' });
}

// ---------------------------------------------------------------- 3. range + oven (2.8 – 3.6)
{
  const x0 = 2.8;
  const x1 = 3.6;
  const cook = COUNTER_TOP + 0.01;
  // Oven body: hollow box below the cooktop. Interior y 0.14..0.74, x 2.86..3.54, z −0.3..0.29.
  box(x0, x1, 0, 0.12, BACK, FRONT, 'enamel', { color: 0x2d2f33 });
  box(x0, x0 + 0.06, 0.12, cook - 0.03, BACK, FRONT, 'enamel', { color: 0x2d2f33 });
  box(x1 - 0.06, x1, 0.12, cook - 0.03, BACK, FRONT, 'enamel', { color: 0x2d2f33 });
  box(x0 + 0.06, x1 - 0.06, 0.12, cook - 0.03, BACK, BACK + 0.025, 'enamel', { color: 0x1d1e21 });
  box(x0 + 0.06, x1 - 0.06, 0.74, cook - 0.03, BACK, FRONT, 'enamel', { color: 0x2d2f33 });
  box(x0 + 0.06, x1 - 0.06, 0.12, 0.14, BACK, FRONT - 0.03, 'enamel', { color: 0x1d1e21, surface: 'enclosed', tag: 'oven-floor' });
  // Oven racks (as thin grates so pans/sheets rest on them).
  for (const ry of [0.32, 0.52]) bars(x0 + 0.07, x1 - 0.07, BACK + 0.04, FRONT - 0.06, ry, 0.006, 0.03, 'x', 'steel', 'cookware', 0x9aa0a6);
  // Control panel + cooktop plate.
  box(x0, x1, cook - 0.03, cook, BACK, FRONT, 'enamel', { color: 0x1b1c1f, tag: 'cooktop' });
  box(x0, x1, cook, cook + 0.14, WALL_Z + 0.0, BACK + 0.06, 'enamel', { color: 0x2d2f33, tag: 'range-backguard' });
  // Shelf above the range for more pans.
  box(x0 + 0.02, x1 - 0.02, 1.6, 1.62, WALL_Z, WALL_Z + 0.3, 'steel', { surface: 'all', tag: 'range-shelf', color: 0x8d9296 });
  spawners.push({ itemId: 'nonstick-pan', pos: [2.98, 1.62, -0.2], label: 'Nonstick skillet' });
  spawners.push({ itemId: 'saute-pan', pos: [3.38, 1.62, -0.2], label: 'Sauté pan' });
  zones.push({ id: 'oven', kind: 'oven', pos: [3.2, 0.44, -0.005], size: [0.66, 0.6, 0.57] });
  // 4 burners: cast-iron grates (bars both ways) sized for cookware; glowing rings under.
  const burners: [number, number][] = [
    [3.0, -0.14],
    [3.4, -0.14],
    [3.0, 0.15],
    [3.4, 0.15],
  ];
  burners.forEach(([bx, bz], i) => {
    const r = 0.13;
    bars(bx - r, bx + r, bz - r, bz + r, cook + 0.035, 0.012, 0.075, 'z', 'castIron', 'cookware', 0x1a1a1a);
    box(bx - 0.05, bx + 0.05, cook, cook + 0.012, bz - 0.05, bz + 0.05, 'steel', { color: 0x3a3a3a, visualOnly: true, tag: `burner-cap-${i}` });
    zones.push({ id: `burner-${i}`, kind: 'burner', pos: [bx, cook + 0.035, bz], size: [0.26, 0.04, 0.26] });
  });
}

// ---------------------------------------------------------------- 4. grill + flat-top (3.6 – 4.6)
{
  counter(3.6, 4.6, { x0: 3.64, x1: 4.08, z0: -0.27, z1: 0.27, depth: 0.16, wallMaterial: 'steel', wallColor: 0x2a2a2a });
  // Grill grate just below counter height over the firebox.
  bars(GRILL_BARS.x0, GRILL_BARS.x1, -0.25, 0.25, GRILL_BARS.top, GRILL_BARS.width, GRILL_BARS.gap, 'z', 'castIron', 'grate', 0x222222);
  box(3.66, 4.06, COUNTER_TOP - 0.15, COUNTER_TOP - 0.13, -0.25, 0.25, 'castIron', { color: 0x3d1d10, emissive: 0x000000, visualOnly: true, tag: 'grill-coals' });
  zones.push({ id: 'grill', kind: 'grill', pos: [3.86, COUNTER_TOP + 0.04, 0], size: [0.4, 0.06, 0.5] });
  // Flat-top griddle plate.
  box(4.12, 4.56, COUNTER_TOP, COUNTER_TOP + 0.03, -0.26, 0.26, 'steel', { color: 0x4a4c4f, surface: 'all', tag: 'griddle' });
  zones.push({ id: 'griddle', kind: 'griddle', pos: [4.34, COUNTER_TOP + 0.05, 0], size: [0.44, 0.04, 0.52] });
}

// ---------------------------------------------------------------- 5. deep fryer (4.6 – 5.2)
{
  counter(4.6, 5.2, { x0: 4.74, x1: 5.06, z0: -0.2, z1: 0.14, depth: 0.26, wallMaterial: 'steel', wallColor: 0x9ea3a8 });
  box(4.66, 5.14, COUNTER_TOP, COUNTER_TOP + 0.12, WALL_Z, -0.24, 'steel', { color: 0x8e9398, tag: 'fryer-back' });
  zones.push({ id: 'fryer', kind: 'fryer', pos: [4.9, COUNTER_TOP - 0.13, -0.03], size: [0.3, 0.24, 0.32] });
  spawners.push({ itemId: 'fry-basket', pos: [4.9, COUNTER_TOP + 0.12, -0.3], label: 'Fry basket' });
}

// ---------------------------------------------------------------- 6. air fryer (5.2 – 5.8)
{
  counter(5.2, 5.8);
  // Body: shell with an open-front basket bay; the basket item sits inside.
  const cx = 5.5;
  const y0 = COUNTER_TOP;
  const c = 0x1f1f22;
  box(cx - 0.17, cx + 0.17, y0, y0 + 0.02, -0.3, 0.06, 'plastic', { color: c, surface: 'enclosed', tag: 'airfryer-floor' });
  box(cx - 0.17, cx - 0.15, y0 + 0.02, y0 + 0.36, -0.3, 0.06, 'plastic', { color: c });
  box(cx + 0.15, cx + 0.17, y0 + 0.02, y0 + 0.36, -0.3, 0.06, 'plastic', { color: c });
  box(cx - 0.15, cx + 0.15, y0 + 0.02, y0 + 0.36, -0.3, -0.28, 'plastic', { color: c });
  box(cx - 0.17, cx + 0.17, y0 + 0.2, y0 + 0.36, -0.28, 0.06, 'plastic', { color: c, surface: 'all', tag: 'airfryer-top' });
  zones.push({ id: 'air-fryer', kind: 'airFryer', pos: [cx, y0 + 0.1, -0.11], size: [0.3, 0.16, 0.34] });
  spawners.push({ itemId: 'air-fryer-basket', pos: [cx, y0 + 0.022, -0.1], label: 'Air-fryer basket' });
}

// ---------------------------------------------------------------- 7. sous vide (5.8 – 6.6)
{
  counter(5.8, 6.6);
  tub(6.2, 0.0, 0.46, 0.34, 0.24, COUNTER_TOP, 'glass', 0xbfd8e0, 0.008);
  // Circulator clamped to the back wall of the tub (decor; becomes interactive in Prompt 6).
  box(6.32, 6.38, COUNTER_TOP + 0.04, COUNTER_TOP + 0.36, -0.16, -0.1, 'plastic', { color: 0x1a1a1a, visualOnly: true, tag: 'circulator' });
  zones.push({ id: 'sous-vide', kind: 'sousVide', pos: [6.2, COUNTER_TOP + 0.11, 0.0], size: [0.44, 0.2, 0.32] });
  spawners.push({ itemId: 'vacuum-bag', pos: [5.92, COUNTER_TOP, 0.18], label: 'Vacuum bag' });
  spawners.push({ itemId: 'foil-sheet', pos: [5.62, COUNTER_TOP, 0.2], label: 'Foil' });
}

// ---------------------------------------------------------------- 8. sink (6.6 – 7.4)
{
  counter(6.6, 7.4, { x0: 6.72, x1: 7.28, z0: -0.22, z1: 0.2, depth: 0.22, wallMaterial: 'steel', wallColor: 0xb4b9be });
  box(6.98, 7.02, COUNTER_TOP, COUNTER_TOP + 0.32, -0.3, -0.26, 'steel', { color: 0xc4c8cc, tag: 'faucet' });
  box(6.98, 7.02, COUNTER_TOP + 0.28, COUNTER_TOP + 0.32, -0.26, -0.1, 'steel', { color: 0xc4c8cc, visualOnly: true });
  zones.push({ id: 'sink', kind: 'sink', pos: [7.0, COUNTER_TOP - 0.11, -0.01], size: [0.54, 0.2, 0.4] });
}

// ---------------------------------------------------------------- 9. plating (7.4 – 8.2)
{
  counter(7.4, 8.2, undefined, 'wood');
  box(7.45, 8.15, 1.38, 1.4, WALL_Z, WALL_Z + 0.26, 'wood', { surface: 'all', tag: 'plate-shelf', color: 0x9a6b43 });
  spawners.push({ itemId: 'plate', pos: [7.62, 1.4, -0.22], label: 'Plate' });
  spawners.push({ itemId: 'colander', pos: [7.92, 1.4, -0.22], label: 'Colander' });
  spawners.push({ itemId: 'sheet-pan', pos: [7.86, COUNTER_TOP, -0.15], label: 'Sheet pan' });
  spawners.push({ itemId: 'wire-rack', pos: [7.86, COUNTER_TOP + 0.025, -0.15], label: 'Wire rack' });
  spawners.push({ itemId: 'pot-lid', pos: [7.95, COUNTER_TOP, 0.17], label: 'Pot lid' });
}

// Upper cabinets (decor) to frame the view.
box(0.8, WIDTH, 1.98, 2.4, WALL_Z, WALL_Z + 0.34, 'wood', { color: 0x6b4f3a, visualOnly: true, tag: 'upper-cabinet' });
box(0.8, WIDTH, 1.97, 1.98, WALL_Z, WALL_Z + 0.34, 'plastic', { color: 0xfff2d8, emissive: 0x3a2e1e, visualOnly: true, castShadow: false });

export const KITCHEN: KitchenLayout = {
  width: WIDTH,
  counterTop: COUNTER_TOP,
  blocks,
  stations: [
    { id: 'fridge', name: 'Fridge & pantry', x0: 0, x1: 1.4 },
    { id: 'prep', name: 'Prep counter', x0: 1.4, x1: 2.8 },
    { id: 'range', name: 'Range & oven', x0: 2.8, x1: 3.6 },
    { id: 'grill', name: 'Grill & flat-top', x0: 3.6, x1: 4.6 },
    { id: 'fryer', name: 'Deep fryer', x0: 4.6, x1: 5.2 },
    { id: 'air-fryer', name: 'Air fryer', x0: 5.2, x1: 5.8 },
    { id: 'sous-vide', name: 'Sous vide', x0: 5.8, x1: 6.6 },
    { id: 'sink', name: 'Sink', x0: 6.6, x1: 7.4 },
    { id: 'plating', name: 'Plating', x0: 7.4, x1: 8.2 },
  ],
  spawners,
  zones,
  startItems: [
    { itemId: 'cutting-board', pos: [2.05, COUNTER_TOP + 0.02, 0.05] },
    { itemId: 'steak', pos: [1.98, COUNTER_TOP + 0.07, 0.05] },
    { itemId: 'potato', pos: [2.18, COUNTER_TOP + 0.08, 0.06] },
    { itemId: 'chef-knife', pos: [2.05, COUNTER_TOP + 0.04, 0.24] },
    { itemId: 'mixing-bowl', pos: [1.62, COUNTER_TOP + 0.01, 0.04] },
    { itemId: 'cast-iron-pan', pos: [3.0, COUNTER_TOP + 0.06, 0.15] },
    { itemId: 'stock-pot', pos: [3.4, COUNTER_TOP + 0.06, -0.14] },
    { itemId: 'plate', pos: [7.55, COUNTER_TOP + 0.02, 0.15] },
  ],
  camera: { minX: 0.85, maxX: WIDTH - 0.85, minY: 1.3, maxY: 1.85, minZ: 0.95, maxZ: 1.45, start: [2.1, 1.5, 1.15] },
  holdDepth: [-0.3, 0.32],
};
