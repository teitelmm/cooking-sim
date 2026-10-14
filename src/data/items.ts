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

export const ITEMS: ItemDef[] = [
  {
    id: 'steak',
    name: 'Ribeye steak (1.5")',
    category: 'protein',
    mass: 0.45,
    material: 'meat',
    parts: [{ kind: 'box', size: [0.2, 0.038, 0.13], round: 0.012 }],
    color: 0xb03a3e,
    angularDamping: 0.6,
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
];

export const ITEM_BY_ID = new Map(ITEMS.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID.get(id);
  if (!d) throw new Error(`unknown item ${id}`);
  return d;
}
