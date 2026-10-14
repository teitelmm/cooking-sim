import type { FoodKind, FoodProps } from '../data/foods';
import { cToF } from '../sim/units';

/** Linear RGB triple 0..1 (sRGB-encoded hex in, converted once). */
export type RGB = [number, number, number];

export function hex(h: number): RGB {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.min(Math.max(t, 0), 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Piecewise-linear gradient over (key, color) stops. */
function ramp(stops: [number, number][], x: number): RGB {
  if (x <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [k0, c0] = stops[i - 1];
      const [k1, c1] = stops[i];
      return mix(hex(c0), hex(c1), (x - k0) / (k1 - k0));
    }
  }
  return hex(stops[stops.length - 1][1]);
}

/**
 * Beef interior color by the peak temperature a spot reached (°F): myoglobin goes from purple-red (raw)
 * through bright red (rare), rosy pink (medium-rare), pink (medium), tan-pink (medium-well) to gray-brown.
 */
const BEEF: [number, number][] = [
  [80, 0x8c1c2b],
  [112, 0xa3222f],
  [122, 0xb93440],
  [131, 0xc2434e],
  [138, 0xd27c79],
  [146, 0xc69a8d],
  [154, 0xae8d7c],
  [162, 0x987a69],
  [185, 0x86685a],
  [212, 0x72594b],
];
const PORK: [number, number][] = [
  [80, 0xd99a9a],
  [125, 0xe0a7a2],
  [140, 0xe8c3b6],
  [150, 0xeed7ca],
  [165, 0xe9d8c8],
  [200, 0xd6bea6],
];
const POULTRY: [number, number][] = [
  [80, 0xe9b3a5],
  [130, 0xeebdaf],
  [145, 0xf0d0c4],
  [158, 0xf3e3d6],
  [165, 0xf4eadf],
  [190, 0xe9d9c3],
];

/** Interior color of the food at a spot: by kind, peak temperature (°C), water fraction and starch/softness. */
export function interiorColor(props: FoodProps, peakC: number, waterFrac: number, gel: number, soft: number, raw: RGB): RGB {
  const f = cToF(peakC);
  let c: RGB;
  switch (props.kind as FoodKind) {
    case 'beef':
      c = ramp(BEEF, f);
      break;
    case 'pork':
      c = ramp(PORK, f);
      break;
    case 'poultry':
      c = ramp(POULTRY, f);
      break;
    case 'potato':
      // Waxy translucent cream → opaque fluffy pale yellow when gelatinized.
      c = mix(hex(0xeedfb0), hex(0xf6ebc3), gel);
      break;
    case 'egg':
      c = mix(hex(0xf2c94c), hex(0xf6e7a8), Math.min(Math.max((f - 140) / 30, 0), 1));
      break;
    default:
      c = mix(raw, mix(raw, hex(0xc9a36a), 0.25), soft);
  }
  // Drier meat looks duller and a touch darker.
  if (props.protein) c = mix(c, mix(c, hex(0x5a4236), 0.5), (1 - waterFrac) * 0.6);
  return c;
}

/** Visible fat (marbling / fat cap): opaque white raw → translucent golden when rendered. */
export function fatColor(peakC: number): RGB {
  return mix(hex(0xf3e9d8), hex(0xe7c98d), Math.min(Math.max((peakC - 45) / 40, 0), 1));
}

/**
 * Exterior surface color: the raw surface color, gone gray/opaque where the surface itself cooked,
 * then Maillard browning (golden → deep mahogany) and finally char (black).
 */
export function surfaceColor(props: FoodProps, raw: RGB, surfacePeakC: number, brown: number, char: number, waterFrac: number, gel: number, soft: number): RGB {
  let c = props.protein || props.starch ? interiorColor(props, surfacePeakC, waterFrac, gel, soft, raw) : mix(raw, interiorColor(props, surfacePeakC, waterFrac, gel, soft, raw), 0.7);
  if (props.kind === 'potato' && gel < 0.5) c = mix(raw, c, gel * 2); // skin stays skin-colored until cooked
  if (props.kind === 'potato') c = mix(raw, c, 0.5);
  const sugar = props.sugar ?? 0;
  const golden = sugar > 0.3 ? hex(0xc58a3a) : props.kind === 'potato' ? hex(0xd9a650) : hex(0xa66a35);
  const brownC = sugar > 0.3 ? hex(0x7a4a1c) : hex(0x6a3a1c);
  const deep = hex(0x47250f);
  if (brown > 0) {
    c = mix(c, golden, Math.min(brown / 0.5, 1));
    if (brown > 0.5) c = mix(c, brownC, Math.min((brown - 0.5) / 0.5, 1));
    if (brown > 1) c = mix(c, deep, Math.min((brown - 1) / 0.6, 1) * 0.8);
  }
  if (char > 0) c = mix(c, hex(0x17110d), Math.min(char * 1.15, 1));
  return c;
}

/** Juice color by how cooked the meat it came from is: red → pink-brown → clear golden. */
export function juiceColor(props: FoodProps, peakC: number): RGB {
  const f = cToF(peakC);
  if (props.kind === 'poultry') return mix(hex(0xd9a48c), hex(0xd8c08a), Math.min(Math.max((f - 140) / 25, 0), 1));
  return ramp(
    [
      [110, 0x8e1420],
      [130, 0xa3202a],
      [142, 0x9a3a2e],
      [155, 0x8f5a36],
      [170, 0xa77f45],
    ],
    f,
  );
}

/** Deterministic value noise in [0, 1] (for marbling). */
export function noise3(x: number, y: number, z: number): number {
  const h = (ix: number, iy: number, iz: number) => {
    let n = ix * 374761393 + iy * 668265263 + iz * 2147483647;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf);
  const v = s(yf);
  const w = s(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Marbling mask 0..1 at a point in the whole steak's frame (m): thin wandering fat streaks. */
export function marbling(x: number, y: number, z: number, amount: number): number {
  if (amount <= 0) return 0;
  const n = noise3(x * 90, y * 140, z * 90) * 0.65 + noise3(x * 260, y * 260, z * 260) * 0.35;
  const streak = Math.abs(n - 0.5) * 2; // 0 on the "veins"
  const width = 0.025 + amount * 0.22;
  return streak < width ? 1 - streak / width : 0;
}
