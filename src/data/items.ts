import type { ShapePart } from '../world/shapes';
import type { MaterialId } from './materials';

export type ItemCategory = 'protein' | 'produce' | 'pantry' | 'cookware' | 'tool' | 'dish';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** Total mass, kg. */
  mass: number;
  material: MaterialId;
  parts: ShapePart[];
  color?: number;
  /** Overrides of the material's physics response. */
  friction?: number;
  restitution?: number;
  /** Extra angular damping so light, flat things don't spin forever. */
  angularDamping?: number;
  linearDamping?: number;
}

const r = (deg: number) => (deg * Math.PI) / 180;

/** Pan body: base disc + ring wall + handle on +X. */
function panParts(radius: number, wall: number, baseT: number, handleColor: number): ShapePart[] {
  return [
    { kind: 'cylinder', radius, height: baseT, offset: [0, baseT / 2, 0] },
    { kind: 'ring', radius: radius - 0.003, height: wall, thickness: 0.006, segments: 14, offset: [0, baseT + wall / 2, 0] },
    { kind: 'box', size: [0.17, 0.018, 0.028], offset: [radius + 0.085, baseT + wall * 0.7, 0], rot: [0, 0, r(12)], color: handleColor, handle: true },
  ];
}

/** Open rectangular tray/basket: floor + 4 walls (+ optional handle on +Z). */
function trayParts(w: number, d: number, h: number, t: number, handle?: { len: number; color?: number }): ShapePart[] {
  const parts: ShapePart[] = [
    { kind: 'box', size: [w, t, d], offset: [0, t / 2, 0] },
    { kind: 'box', size: [t, h, d], offset: [-w / 2 + t / 2, h / 2, 0] },
    { kind: 'box', size: [t, h, d], offset: [w / 2 - t / 2, h / 2, 0] },
    { kind: 'box', size: [w - 2 * t, h, t], offset: [0, h / 2, -d / 2 + t / 2] },
    { kind: 'box', size: [w - 2 * t, h, t], offset: [0, h / 2, d / 2 - t / 2] },
  ];
  if (handle) parts.push({ kind: 'box', size: [0.04, 0.02, handle.len], offset: [0, h * 0.7, d / 2 + handle.len / 2], color: handle.color, handle: true });
  return parts;
}

/** Round bowl: base disc + ring wall. */
function bowlParts(radius: number, height: number): ShapePart[] {
  return [
    { kind: 'cylinder', radius: radius * 0.7, height: 0.008, offset: [0, 0.004, 0] },
    { kind: 'ring', radius: radius * 0.85, height: height, thickness: 0.006, segments: 14, offset: [0, height / 2, 0] },
  ];
}

function shaker(id: string, name: string, color: number, capColor: number): ItemDef {
  return {
    id,
    name,
    category: 'pantry',
    mass: 0.15,
    material: 'glass',
    parts: [
      { kind: 'cylinder', radius: 0.022, height: 0.08, offset: [0, 0.04, 0], color },
      { kind: 'cylinder', radius: 0.023, height: 0.015, offset: [0, 0.0875, 0], color: capColor },
    ],
  };
}

export const ITEMS: ItemDef[] = [
  {
    id: 'steak',
    name: 'Ribeye steak (1.5")',
    category: 'protein',
    mass: 0.53,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.14, 0.0381, 0.095], round: 0.01 }],
    color: 0xb03a3e,
    angularDamping: 0.6,
  },
  {
    id: 'ribeye-1in',
    name: 'Ribeye steak (1")',
    category: 'protein',
    mass: 0.36,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.14, 0.0254, 0.095], round: 0.008 }],
    color: 0xb03a3e,
    angularDamping: 0.6,
  },
  {
    id: 'thick-ribeye',
    name: 'Ribeye steak (2")',
    category: 'protein',
    mass: 0.71,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.14, 0.0508, 0.095], round: 0.012 }],
    color: 0xb03a3e,
    angularDamping: 0.6,
  },
  {
    id: 'strip-steak',
    name: 'NY strip (1.25")',
    category: 'protein',
    mass: 0.4,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.16, 0.0318, 0.075], round: 0.008 }],
    color: 0xb2343c,
    angularDamping: 0.6,
  },
  {
    id: 'chicken-thigh',
    name: 'Chicken thigh (bone-in, skin-on)',
    category: 'protein',
    mass: 0.22,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.1, 0.03, 0.07], round: 0.01 }],
    color: 0xe8c0a8,
    angularDamping: 0.6,
  },
  {
    id: 'whole-chicken',
    name: 'Whole chicken (4 lb)',
    category: 'protein',
    mass: 1.8,
    material: 'meat',
    parts: [{ kind: 'sphere', radius: 0.1, scale: [1, 0.6, 0.75] }],
    color: 0xf0d0b8,
    angularDamping: 0.8,
  },
  {
    id: 'short-ribs',
    name: 'Beef short rib (bone-in)',
    category: 'protein',
    mass: 0.42,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.12, 0.05, 0.07], round: 0.008 }],
    color: 0xa8333a,
    angularDamping: 0.7,
  },
  {
    id: 'foil-sheet',
    name: 'Aluminum foil',
    category: 'tool',
    mass: 0.008,
    material: 'steel',
    parts: [{ kind: 'box', size: [0.36, 0.002, 0.28] }],
    color: 0xd9dde0,
    angularDamping: 2,
    linearDamping: 1,
  },
  {
    id: 'chicken-breast',
    name: 'Chicken breast',
    category: 'protein',
    mass: 0.25,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.18, 0.03, 0.09], round: 0.012 }],
    color: 0xe8b4a8,
    angularDamping: 0.6,
  },
  {
    id: 'potato',
    name: 'Russet potato',
    category: 'produce',
    mass: 0.22,
    material: 'produce',
    parts: [{ kind: 'sphere', radius: 0.04, scale: [1.45, 0.85, 1] }],
    color: 0xb08a58,
  },
  {
    id: 'carrot',
    name: 'Carrot',
    category: 'produce',
    mass: 0.07,
    material: 'produce',
    parts: [{ kind: 'capsule', radius: 0.014, length: 0.15, rot: [0, 0, r(90)] }],
    color: 0xe57a22,
  },
  {
    id: 'onion',
    name: 'Yellow onion',
    category: 'produce',
    mass: 0.18,
    material: 'produce',
    parts: [{ kind: 'sphere', radius: 0.038, scale: [1, 0.9, 1] }],
    color: 0xc79a55,
  },
  {
    id: 'herbs',
    name: 'Parsley bunch',
    category: 'produce',
    mass: 0.03,
    material: 'leafy',
    parts: [{ kind: 'box', size: [0.14, 0.02, 0.05], round: 0.008 }],
    color: 0x3f8a35,
    angularDamping: 2,
    linearDamping: 0.6,
  },
  {
    id: 'egg',
    name: 'Egg',
    category: 'pantry',
    mass: 0.06,
    material: 'ceramic',
    parts: [{ kind: 'sphere', radius: 0.021, scale: [1, 1.25, 1] }],
    color: 0xf2e4cf,
    restitution: 0.1,
  },
  {
    id: 'flour-bag',
    name: 'Flour (5 lb)',
    category: 'pantry',
    mass: 2.27,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.14, 0.22, 0.09], round: 0.01 }],
    color: 0xece2cc,
  },
  {
    id: 'cast-iron-pan',
    name: 'Cast-iron skillet',
    category: 'cookware',
    mass: 2.7,
    material: 'castIron',
    parts: panParts(0.13, 0.045, 0.012, 0x2b2b2d),
  },
  {
    id: 'stainless-pan',
    name: 'Stainless skillet',
    category: 'cookware',
    mass: 1.2,
    material: 'steel',
    parts: panParts(0.125, 0.045, 0.006, 0xb8bcc0),
  },
  {
    id: 'nonstick-pan',
    name: 'Nonstick skillet',
    category: 'cookware',
    mass: 0.9,
    material: 'plastic',
    parts: panParts(0.12, 0.04, 0.005, 0x1a1a1a),
    color: 0x2c2c30,
  },
  {
    id: 'saute-pan',
    name: 'Sauté pan',
    category: 'cookware',
    mass: 1.8,
    material: 'steel',
    parts: panParts(0.135, 0.07, 0.006, 0xb8bcc0),
  },
  {
    id: 'pot-lid',
    name: 'Pot lid',
    category: 'cookware',
    mass: 0.6,
    material: 'steel',
    parts: [
      { kind: 'cylinder', radius: 0.125, height: 0.006, offset: [0, 0.003, 0] },
      { kind: 'cylinder', radius: 0.015, height: 0.02, offset: [0, 0.016, 0], color: 0x1a1a1a, handle: true },
    ],
  },
  {
    id: 'wire-rack',
    name: 'Wire rack',
    category: 'cookware',
    mass: 0.4,
    material: 'steel',
    parts: [
      { kind: 'box', size: [0.38, 0.004, 0.25], offset: [0, 0.018, 0] },
      { kind: 'box', size: [0.01, 0.016, 0.24], offset: [-0.18, 0.008, 0] },
      { kind: 'box', size: [0.01, 0.016, 0.24], offset: [0.18, 0.008, 0] },
    ],
    color: 0xc8ccd0,
  },
  {
    id: 'stock-pot',
    name: 'Stock pot',
    category: 'cookware',
    mass: 2.0,
    material: 'steel',
    parts: [
      { kind: 'cylinder', radius: 0.12, height: 0.008, offset: [0, 0.004, 0] },
      { kind: 'ring', radius: 0.117, height: 0.2, thickness: 0.006, segments: 16, offset: [0, 0.108, 0] },
      { kind: 'box', size: [0.05, 0.015, 0.03], offset: [0.142, 0.18, 0], handle: true },
      { kind: 'box', size: [0.05, 0.015, 0.03], offset: [-0.142, 0.18, 0], handle: true },
    ],
  },
  {
    id: 'cutting-board',
    name: 'Cutting board',
    category: 'tool',
    mass: 1.5,
    material: 'butcherBlock',
    parts: [{ kind: 'box', size: [0.42, 0.025, 0.28], round: 0.006 }],
  },
  {
    id: 'chef-knife',
    name: "Chef's knife",
    category: 'tool',
    mass: 0.22,
    material: 'steel',
    parts: [
      { kind: 'box', size: [0.2, 0.003, 0.045], offset: [0.1, 0, 0] },
      { kind: 'box', size: [0.12, 0.02, 0.024], offset: [-0.06, 0.004, 0.006], color: 0x2a1d14, handle: true },
    ],
    angularDamping: 1.5,
  },
  {
    id: 'ribs',
    name: 'Pork spare ribs (half rack)',
    category: 'protein',
    mass: 1.1,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.3, 0.04, 0.14], round: 0.012 }],
    color: 0xc06a68,
    angularDamping: 0.8,
  },
  {
    id: 'butter',
    name: 'Butter (stick)',
    category: 'pantry',
    mass: 0.113,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.12, 0.032, 0.032], round: 0.003 }],
    color: 0xf7e6a6,
  },
  {
    id: 'milk',
    name: 'Milk (1 qt)',
    category: 'pantry',
    mass: 1.0,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.07, 0.19, 0.07], round: 0.004, offset: [0, 0.095, 0] }],
    color: 0xf4f6f8,
  },
  {
    id: 'sugar-bag',
    name: 'Sugar (4 lb)',
    category: 'pantry',
    mass: 1.8,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.13, 0.18, 0.08], round: 0.01, offset: [0, 0.09, 0] }],
    color: 0xd8e4ef,
  },
  {
    id: 'pasta-box',
    name: 'Spaghetti (1 lb)',
    category: 'pantry',
    mass: 0.45,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.26, 0.04, 0.06], offset: [0, 0.02, 0] }],
    color: 0x2f5fa8,
  },
  {
    id: 'oil-bottle',
    name: 'Vegetable oil',
    category: 'pantry',
    mass: 0.9,
    material: 'plastic',
    parts: [
      { kind: 'cylinder', radius: 0.035, height: 0.2, offset: [0, 0.1, 0], color: 0xe8c25a },
      { kind: 'cylinder', radius: 0.013, height: 0.04, offset: [0, 0.22, 0], color: 0xd23a2a },
    ],
  },
  shaker('salt-shaker', 'Salt', 0xf4f4f4, 0xb8bcc0),
  shaker('pepper-shaker', 'Black pepper', 0x3a3430, 0xb8bcc0),
  shaker('paprika-shaker', 'Paprika', 0xb8331c, 0xb8bcc0),
  shaker('garlic-powder', 'Garlic powder', 0xe8dcc0, 0x7a5a3a),
  shaker('chili-flakes', 'Chili flakes', 0xc0391b, 0x7a5a3a),
  shaker('dried-herbs', 'Dried oregano', 0x6b7a3a, 0x7a5a3a),
  {
    id: 'baking-powder',
    name: 'Baking powder',
    category: 'pantry',
    mass: 0.25,
    material: 'paper',
    parts: [{ kind: 'cylinder', radius: 0.032, height: 0.09, offset: [0, 0.045, 0] }],
    color: 0xc0392b,
  },
  {
    id: 'baking-soda',
    name: 'Baking soda',
    category: 'pantry',
    mass: 0.47,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.09, 0.12, 0.05], offset: [0, 0.06, 0] }],
    color: 0xe8a33a,
  },
  {
    id: 'yeast-jar',
    name: 'Instant yeast',
    category: 'pantry',
    mass: 0.15,
    material: 'glass',
    parts: [
      { kind: 'cylinder', radius: 0.03, height: 0.07, offset: [0, 0.035, 0], color: 0xc8a165 },
      { kind: 'cylinder', radius: 0.031, height: 0.015, offset: [0, 0.0775, 0], color: 0xd4a017 },
    ],
  },
  {
    id: 'vanilla',
    name: 'Vanilla extract',
    category: 'pantry',
    mass: 0.09,
    material: 'glass',
    parts: [
      { kind: 'cylinder', radius: 0.018, height: 0.08, offset: [0, 0.04, 0], color: 0x3a2412 },
      { kind: 'cylinder', radius: 0.01, height: 0.02, offset: [0, 0.09, 0], color: 0x111111 },
    ],
  },
  {
    id: 'chocolate-chips',
    name: 'Chocolate chips',
    category: 'pantry',
    mass: 0.34,
    material: 'paper',
    parts: [{ kind: 'box', size: [0.13, 0.18, 0.05], round: 0.01, offset: [0, 0.09, 0] }],
    color: 0x6b3a1e,
  },
  {
    id: 'measuring-cup',
    name: 'Measuring cup (1 cup)',
    category: 'tool',
    mass: 0.08,
    material: 'steel',
    parts: [
      { kind: 'cylinder', radius: 0.035, height: 0.004, offset: [0, 0.002, 0] },
      { kind: 'ring', radius: 0.042, height: 0.06, thickness: 0.003, segments: 12, offset: [0, 0.03, 0] },
      { kind: 'box', size: [0.1, 0.006, 0.02], offset: [0.09, 0.055, 0], handle: true },
    ],
  },
  {
    id: 'measuring-spoon',
    name: 'Tablespoon',
    category: 'tool',
    mass: 0.02,
    material: 'steel',
    parts: [
      { kind: 'sphere', radius: 0.02, scale: [1.2, 0.4, 1], offset: [0, 0.006, 0] },
      { kind: 'box', size: [0.1, 0.004, 0.012], offset: [0.07, 0.01, 0], handle: true },
    ],
    angularDamping: 1.5,
  },
  {
    id: 'whisk',
    name: 'Whisk',
    category: 'tool',
    mass: 0.12,
    material: 'steel',
    parts: [
      { kind: 'cylinder', radius: 0.012, height: 0.12, offset: [-0.06, 0.012, 0], rot: [0, 0, Math.PI / 2], color: 0x222222, handle: true },
      { kind: 'sphere', radius: 0.03, scale: [2.2, 1, 1], offset: [0.06, 0.03, 0], color: 0xd8dadc },
    ],
    angularDamping: 1.5,
  },
  {
    id: 'rolling-pin',
    name: 'Rolling pin',
    category: 'tool',
    mass: 0.6,
    material: 'wood',
    parts: [{ kind: 'cylinder', radius: 0.025, height: 0.42, offset: [0, 0.025, 0], rot: [Math.PI / 2, 0, 0] }],
    color: 0xd2a877,
    angularDamping: 1,
  },
  {
    id: 'loaf-pan',
    name: 'Loaf pan',
    category: 'cookware',
    mass: 0.5,
    material: 'steel',
    parts: trayParts(0.24, 0.13, 0.07, 0.003),
    color: 0x6d7276,
  },
  {
    id: 'cake-pan',
    name: 'Cake pan (9")',
    category: 'cookware',
    mass: 0.45,
    material: 'steel',
    parts: [
      { kind: 'cylinder', radius: 0.115, height: 0.004, offset: [0, 0.002, 0] },
      { kind: 'ring', radius: 0.115, height: 0.05, thickness: 0.003, segments: 16, offset: [0, 0.025, 0] },
    ],
    color: 0x9aa0a6,
  },
  {
    id: 'spatula',
    name: 'Fish spatula',
    category: 'tool',
    mass: 0.09,
    material: 'steel',
    parts: [
      { kind: 'box', size: [0.09, 0.002, 0.075], offset: [0.06, 0.002, 0] },
      { kind: 'box', size: [0.15, 0.012, 0.022], offset: [-0.06, 0.012, 0], color: 0x2a1d14, handle: true },
    ],
    angularDamping: 1.5,
  },
  {
    id: 'wooden-spoon',
    name: 'Wooden spoon',
    category: 'tool',
    mass: 0.05,
    material: 'wood',
    parts: [
      { kind: 'box', size: [0.2, 0.008, 0.016], offset: [-0.04, 0.004, 0], handle: true },
      { kind: 'sphere', radius: 0.022, scale: [1.3, 0.35, 1], offset: [0.08, 0.006, 0] },
    ],
    color: 0xc79a66,
    angularDamping: 1.5,
  },
  {
    id: 'bell-pepper',
    name: 'Bell pepper',
    category: 'produce',
    mass: 0.17,
    material: 'produce',
    parts: [{ kind: 'sphere', radius: 0.04, scale: [1, 1.1, 1], offset: [0, 0.044, 0] }],
    color: 0xd52a1e,
  },
  {
    id: 'broccoli',
    name: 'Broccoli',
    category: 'produce',
    mass: 0.15,
    material: 'leafy',
    parts: [
      { kind: 'sphere', radius: 0.045, scale: [1, 0.75, 1], offset: [0, 0.07, 0] },
      { kind: 'cylinder', radius: 0.014, height: 0.06, offset: [0, 0.03, 0], color: 0x8fb36a },
    ],
    color: 0x2f6b2a,
  },
  {
    id: 'mushroom',
    name: 'Cremini mushroom',
    category: 'produce',
    mass: 0.02,
    material: 'produce',
    parts: [
      { kind: 'sphere', radius: 0.022, scale: [1, 0.6, 1], offset: [0, 0.022, 0] },
      { kind: 'cylinder', radius: 0.008, height: 0.018, offset: [0, 0.009, 0], color: 0xe7dccb },
    ],
    color: 0x8a6748,
  },
  {
    id: 'garlic',
    name: 'Garlic bulb',
    category: 'produce',
    mass: 0.05,
    material: 'produce',
    parts: [{ kind: 'sphere', radius: 0.025, scale: [1, 0.85, 1], offset: [0, 0.021, 0] }],
    color: 0xf1eadb,
  },
  {
    id: 'mixing-bowl',
    name: 'Mixing bowl',
    category: 'cookware',
    mass: 0.6,
    material: 'steel',
    parts: bowlParts(0.12, 0.1),
  },
  {
    id: 'colander',
    name: 'Colander',
    category: 'cookware',
    mass: 0.4,
    material: 'steel',
    parts: bowlParts(0.12, 0.09),
    color: 0xd8dadc,
  },
  {
    id: 'plate',
    name: 'Dinner plate',
    category: 'dish',
    mass: 0.5,
    material: 'ceramic',
    parts: [
      { kind: 'cylinder', radius: 0.11, height: 0.01, offset: [0, 0.005, 0] },
      { kind: 'ring', radius: 0.125, height: 0.018, thickness: 0.012, segments: 16, offset: [0, 0.012, 0] },
    ],
  },
  {
    id: 'sheet-pan',
    name: 'Sheet pan',
    category: 'cookware',
    mass: 1.0,
    material: 'steel',
    parts: trayParts(0.4, 0.27, 0.022, 0.004),
    color: 0xb9bcbf,
  },
  {
    id: 'fry-basket',
    name: 'Fry basket',
    category: 'cookware',
    mass: 0.5,
    material: 'steel',
    parts: trayParts(0.24, 0.22, 0.12, 0.004, { len: 0.22, color: 0x1a1a1a }),
    color: 0xc9ccd0,
  },
  {
    id: 'air-fryer-basket',
    name: 'Air-fryer basket',
    category: 'cookware',
    mass: 0.7,
    material: 'plastic',
    parts: trayParts(0.26, 0.26, 0.13, 0.006, { len: 0.1, color: 0x111111 }),
    color: 0x2a2a2e,
  },
  {
    id: 'vacuum-bag',
    name: 'Vacuum bag',
    category: 'tool',
    mass: 0.01,
    material: 'plastic',
    parts: [{ kind: 'box', size: [0.24, 0.004, 0.18] }],
    color: 0xdfe8ec,
    angularDamping: 2,
    linearDamping: 1,
  },
  {
    id: 'probe-thermometer',
    name: 'Probe thermometer',
    category: 'tool',
    mass: 0.06,
    material: 'steel',
    parts: [
      { kind: 'box', size: [0.13, 0.005, 0.005], offset: [0.065, 0.0125, 0] },
      { kind: 'box', size: [0.06, 0.025, 0.035], offset: [-0.03, 0.0125, 0], color: 0xe0b324, handle: true },
    ],
    angularDamping: 1.5,
  },
  {
    id: 'tongs',
    name: 'Tongs',
    category: 'tool',
    mass: 0.12,
    material: 'steel',
    parts: [
      { kind: 'box', size: [0.24, 0.01, 0.026], offset: [0, 0.005, 0] },
      { kind: 'box', size: [0.08, 0.016, 0.03], offset: [-0.09, 0.008, 0], color: 0x222222, handle: true },
    ],
    angularDamping: 1.5,
  },
];

export const ITEM_BY_ID = new Map(ITEMS.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}
