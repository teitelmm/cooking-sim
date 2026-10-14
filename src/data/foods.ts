/**
 * Thermal and chemical properties for each cookable food. Values are typical literature numbers
 * (thermal conductivity, density, specific heat, water content) so cook times come out true to life.
 */
export type FoodKind = 'beef' | 'pork' | 'poultry' | 'potato' | 'veg' | 'pasta' | 'dough' | 'egg' | 'fat' | 'aromatic';
export type FoodShape = 'box' | 'ellipsoid' | 'cylinderX';

export interface FoodProps {
  kind: FoodKind;
  /** Thermal conductivity, W/(m·K). */
  k: number;
  /** Density, kg/m³. */
  rho: number;
  /** Specific heat, J/(kg·K). */
  cp: number;
  /** Water mass fraction. */
  water: number;
  /** Muscle protein: water-holding drops as proteins denature (myosin ~50–60 °C, actin ~66–74 °C). */
  protein?: boolean;
  /** Relative connective-tissue content (ribs ≈ 1, tenderloin ≈ 0.1). */
  collagen?: number;
  /** Starch that gelatinizes with heat + water (potato, pasta, dough). */
  starch?: number;
  /** Surface sugars → caramelization (onion, carrot). */
  sugar?: number;
  /** Fat fraction (renders above ~55 °C, drips, feeds flare-ups). */
  fat?: number;
  /** Instant-safe internal temperature, °F (poultry 165, pork 145, ground 160). */
  safeTempF?: number;
  /** Browning / char rate multipliers (sugary foods brown & burn faster). */
  browning?: number;
  char?: number;
  /** Initial free surface water film, kg/m² (a wet, un-patted steak is higher). */
  surfaceWater?: number;
  /** Softening for veg (pectin breakdown) per unit time at temperature. */
  softens?: boolean;
  /** Hollow cavity (whole bird) as a fraction of the radius. */
  hollow?: number;
  /**
   * Tissue layout: normalized coords u, v, w in −1..1 (and size/local metres) → 0 lean, 1 fat, 2 bone, 3 skin.
   */
  tissue?: (u: number, v: number, w: number, size: [number, number, number], p: [number, number, number]) => number;
  shape: FoodShape;
}

const meat = { k: 0.45, rho: 1050, cp: 3500, protein: true } as const;

/** Fat cap along one long edge (+z), ~1 cm thick. */
const fatCapZ = (_u: number, _v: number, _w: number, size: [number, number, number], p: [number, number, number]) => (p[2] > size[2] / 2 - 0.009 ? 1 : 0);
/** Skin on top (≈ 2.5 mm), bone through the middle along x. */
const thigh = (_u: number, v: number, w: number, size: [number, number, number], p: [number, number, number]) =>
  p[1] > size[1] / 2 - 0.003 ? 3 : Math.abs(v) < 0.3 && Math.abs(w) < 0.18 ? 2 : 0;
/** Whole bird: skin shell; keel/back bones near the cavity. */
const bird = (u: number, v: number, w: number) => {
  const r = Math.sqrt(u * u + v * v + w * w);
  return r > 0.9 ? 3 : r < 0.62 && v < -0.2 ? 2 : 0;
};
/** Rack of ribs: bones run across (along z) every 3.5 cm in the lower part. */
const ribBones = (_u: number, v: number, _w: number, size: [number, number, number], p: [number, number, number]) => {
  const x = p[0] + size[0] / 2;
  const m = ((x % 0.035) + 0.035) % 0.035;
  return Math.abs(m - 0.0175) < 0.0055 && v < 0.15 && v > -0.75 ? 2 : p[1] > size[1] / 2 - 0.004 ? 1 : 0;
};
/** Bone-in short rib: flat bone along the bottom, fat seam above it. */
const shortRib = (_u: number, v: number) => (v < -0.62 ? 2 : v < -0.45 ? 1 : 0);

export const FOODS: Record<string, FoodProps> = {
  steak: { ...meat, kind: 'beef', water: 0.72, collagen: 0.15, fat: 0.12, safeTempF: 130, surfaceWater: 0.04, shape: 'box', tissue: fatCapZ },
  'ribeye-1in': { ...meat, kind: 'beef', water: 0.72, collagen: 0.15, fat: 0.12, safeTempF: 130, surfaceWater: 0.04, shape: 'box', tissue: fatCapZ },
  'thick-ribeye': { ...meat, kind: 'beef', water: 0.72, collagen: 0.15, fat: 0.12, safeTempF: 130, surfaceWater: 0.04, shape: 'box', tissue: fatCapZ },
  'strip-steak': { ...meat, kind: 'beef', water: 0.73, collagen: 0.12, fat: 0.07, safeTempF: 130, surfaceWater: 0.04, shape: 'box', tissue: fatCapZ },
  'chicken-breast': { ...meat, k: 0.48, kind: 'poultry', water: 0.75, collagen: 0.05, fat: 0.03, safeTempF: 165, surfaceWater: 0.05, shape: 'box' },
  'chicken-thigh': { ...meat, k: 0.46, kind: 'poultry', water: 0.73, collagen: 0.3, fat: 0.1, safeTempF: 165, surfaceWater: 0.05, shape: 'box', tissue: thigh },
  'whole-chicken': {
    ...meat,
    k: 0.47,
    kind: 'poultry',
    water: 0.74,
    collagen: 0.2,
    fat: 0.08,
    safeTempF: 165,
    surfaceWater: 0.05,
    shape: 'ellipsoid',
    hollow: 0.45,
    tissue: bird,
  },
  ribs: { ...meat, k: 0.44, kind: 'pork', water: 0.6, collagen: 1.0, fat: 0.22, safeTempF: 145, surfaceWater: 0.03, shape: 'box', tissue: ribBones },
  'short-ribs': { ...meat, k: 0.44, kind: 'beef', water: 0.6, collagen: 1.0, fat: 0.25, safeTempF: 145, surfaceWater: 0.03, shape: 'box', tissue: shortRib },
  potato: { kind: 'potato', k: 0.55, rho: 1080, cp: 3600, water: 0.79, starch: 1, shape: 'ellipsoid', softens: true, surfaceWater: 0.02 },
  carrot: { kind: 'veg', k: 0.6, rho: 1040, cp: 3800, water: 0.88, sugar: 0.6, softens: true, browning: 1.4, char: 1.3, shape: 'cylinderX' },
  onion: { kind: 'veg', k: 0.55, rho: 960, cp: 3800, water: 0.89, sugar: 0.8, softens: true, browning: 1.6, char: 1.4, shape: 'ellipsoid' },
  'bell-pepper': { kind: 'veg', k: 0.55, rho: 900, cp: 3900, water: 0.92, sugar: 0.5, softens: true, browning: 1.2, shape: 'ellipsoid' },
  broccoli: { kind: 'veg', k: 0.5, rho: 700, cp: 3850, water: 0.89, sugar: 0.2, softens: true, char: 1.5, shape: 'ellipsoid' },
  mushroom: { kind: 'veg', k: 0.5, rho: 800, cp: 3900, water: 0.92, sugar: 0.1, softens: true, shape: 'ellipsoid' },
  garlic: { kind: 'aromatic', k: 0.5, rho: 1050, cp: 3300, water: 0.59, sugar: 1, softens: true, browning: 2.2, char: 3, shape: 'ellipsoid' },
  herbs: { kind: 'veg', k: 0.4, rho: 400, cp: 3800, water: 0.85, char: 2, shape: 'box' },
  egg: { kind: 'egg', k: 0.5, rho: 1030, cp: 3300, water: 0.75, protein: true, shape: 'ellipsoid' },
  butter: { kind: 'fat', k: 0.2, rho: 910, cp: 2400, water: 0.16, browning: 2, char: 2, shape: 'box' },
};

export function foodProps(id: string): FoodProps | undefined {
  return FOODS[id];
}
