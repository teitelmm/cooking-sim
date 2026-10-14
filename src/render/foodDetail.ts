import type { FoodProps } from '../data/foods';

/**
 * Procedural surface detail for raw food: muscle grain and marbling, chicken skin pores, potato skin,
 * carrot rings, onion paper, broccoli florets… Computed in the shader as a *solid* texture from the
 * food's own local position (metres), so it needs no UVs, survives deformation-free shrinking, and stays
 * continuous across knife cuts (pieces share the parent's frame via `food.origin` and its seed).
 *
 * The sim's voxel color still decides how cooked it looks; detail modulates it (luminance, a tint that
 * fades as the surface browns, bump and roughness), so a seared crust is still the sim's crust.
 */
export const PATTERN = {
  none: 0,
  beef: 1,
  pork: 2,
  poultry: 3,
  poultrySkin: 4,
  potato: 5,
  carrot: 6,
  onion: 7,
  pepper: 8,
  broccoli: 9,
  mushroom: 10,
  garlic: 11,
  herbs: 12,
  egg: 13,
  butter: 14,
  dough: 15,
} as const;

export interface FoodPattern {
  kind: number;
  /** Bump strength (derivative bump, unitless). */
  bump: number;
  /** Finest feature frequency, cycles/m: detail fades out when a pixel covers more than that. */
  freq: number;
}

const BY_ID: Record<string, number> = {
  steak: PATTERN.beef,
  'ribeye-1in': PATTERN.beef,
  'thick-ribeye': PATTERN.beef,
  'strip-steak': PATTERN.beef,
  'short-ribs': PATTERN.beef,
  ribs: PATTERN.pork,
  'chicken-breast': PATTERN.poultry,
  'chicken-thigh': PATTERN.poultrySkin,
  'whole-chicken': PATTERN.poultrySkin,
  potato: PATTERN.potato,
  carrot: PATTERN.carrot,
  onion: PATTERN.onion,
  'bell-pepper': PATTERN.pepper,
  broccoli: PATTERN.broccoli,
  mushroom: PATTERN.mushroom,
  garlic: PATTERN.garlic,
  herbs: PATTERN.herbs,
  egg: PATTERN.egg,
  butter: PATTERN.butter,
  dough: PATTERN.dough,
  batter: PATTERN.dough,
};

const BY_KIND: Partial<Record<FoodProps['kind'], number>> = {
  beef: PATTERN.beef,
  pork: PATTERN.pork,
  poultry: PATTERN.poultry,
  potato: PATTERN.potato,
  veg: PATTERN.onion,
  aromatic: PATTERN.garlic,
  egg: PATTERN.egg,
  dough: PATTERN.dough,
  fat: PATTERN.butter,
};

const PARAMS: Record<number, Omit<FoodPattern, 'kind'>> = {
  [PATTERN.none]: { bump: 0, freq: 100 },
  [PATTERN.beef]: { bump: 0.35, freq: 700 },
  [PATTERN.pork]: { bump: 0.3, freq: 600 },
  [PATTERN.poultry]: { bump: 0.25, freq: 450 },
  [PATTERN.poultrySkin]: { bump: 0.55, freq: 900 },
  [PATTERN.potato]: { bump: 0.6, freq: 500 },
  [PATTERN.carrot]: { bump: 0.45, freq: 900 },
  [PATTERN.onion]: { bump: 0.25, freq: 400 },
  [PATTERN.pepper]: { bump: 0.15, freq: 200 },
  [PATTERN.broccoli]: { bump: 0.9, freq: 700 },
  [PATTERN.mushroom]: { bump: 0.2, freq: 400 },
  [PATTERN.garlic]: { bump: 0.25, freq: 400 },
  [PATTERN.herbs]: { bump: 0.3, freq: 300 },
  [PATTERN.egg]: { bump: 0.12, freq: 500 },
  [PATTERN.butter]: { bump: 0.1, freq: 80 },
  [PATTERN.dough]: { bump: 0.35, freq: 300 },
};

export function patternFor(foodId: string, props: FoodProps): FoodPattern {
  const kind = BY_ID[foodId] ?? BY_KIND[props.kind] ?? PATTERN.none;
  return { kind, ...PARAMS[kind] };
}

/** True for patterns whose fibers also show on a cut face (meat grain). */
export function grainOnCut(kind: number): boolean {
  return kind === PATTERN.beef || kind === PATTERN.pork || kind === PATTERN.poultry || kind === PATTERN.poultrySkin;
}

/** Uniform declarations + noise + pattern function. `p` is food-local position in metres. */
export const FOOD_DETAIL_GLSL = /* glsl */ `
uniform int uPattern;
uniform float uBump;
uniform float uDetailFreq;
uniform float uSeed;
uniform vec3 uOrigin;
uniform vec3 uRaw;

float fd_hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fd_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(fd_hash(i), fd_hash(i + vec3(1, 0, 0)), f.x), mix(fd_hash(i + vec3(0, 1, 0)), fd_hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(fd_hash(i + vec3(0, 0, 1)), fd_hash(i + vec3(1, 0, 1)), f.x), mix(fd_hash(i + vec3(0, 1, 1)), fd_hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// ~0..0.94, mean ~0.47.
float fd_fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * fd_noise(p);
    p = p * 2.03 + vec3(17.1, 3.7, 9.3);
    a *= 0.5;
  }
  return s;
}
// Thin bright lines along the iso-contours of an fbm field (veins, streaks).
float fd_vein(vec3 p, float lo, float hi) {
  return smoothstep(lo, hi, 1.0 - abs(fd_fbm(p) * 2.0 - 0.94));
}
// Distance to the nearest random feature point (cells of size 1), 8-cell variant.
float fd_worley(vec3 p) {
  vec3 b = floor(p - 0.5);
  float d = 8.0;
  for (int z = 0; z <= 1; z++)
    for (int y = 0; y <= 1; y++)
      for (int x = 0; x <= 1; x++) {
        vec3 c = b + vec3(float(x), float(y), float(z));
        vec3 o = vec3(fd_hash(c), fd_hash(c + 31.17), fd_hash(c + 73.31));
        d = min(d, length(c + o - p));
      }
  return d;
}

// Metres covered by one pixel (set before calling foodDetail); a feature of frequency f (cycles/m)
// fades out once a pixel spans ~half a cycle, so nothing shimmers at a distance.
float fdFw;
// 1 on red lean muscle, 0 on fat/skin/crust (set by the caller from the voxel color).
float fdLean;
float fl(float f) { return 1.0 - smoothstep(0.25, 0.55, f * fdFw); }

/**
 * lum: color multiplier (~1, terms are centered so distance doesn't shift brightness); tint/tintAmt:
 * raw-only overlay (fat, flour, skin color); h: height for bump; rough: roughness offset.
 */
void foodDetail(vec3 p, out float lum, out vec3 tint, out float tintAmt, out float h, out float rough) {
  lum = 1.0; tint = vec3(1.0); tintAmt = 0.0; h = 0.0; rough = 0.0;
  // Centered coordinates for radial patterns; the seed shifts noise lookups by up to ~0.4 m (small enough
  // to keep float precision at the finest frequencies).
  vec3 pc = p;
  p += fract(uSeed * vec3(0.1031, 0.11369, 0.13787)) * 0.4;
  if (uPattern == 1 || uPattern == 2) {
    // Muscle: fibers along x gathered into bundles, a fine web of marbling. Fat (cap, seams) stays smooth
    // and waxy — only the lean gets fiber texture.
    bool beef = uPattern == 1;
    float g1 = fd_noise(vec3(p.x * 35.0, p.y * 650.0, p.z * 650.0)) - 0.5;
    float g2 = fd_noise(vec3(p.x * 10.0, p.y * 200.0, p.z * 200.0)) - 0.5;
    float bundles = fd_fbm(p * vec3(20.0, 70.0, 70.0)) - 0.47;
    float seams = fd_vein(p * vec3(12.0, 40.0, 40.0) + 1.7, 0.93, 0.995) * fl(120.0);
    float web = fd_vein(p * vec3(35.0, 55.0, 50.0) + 3.1, beef ? 0.88 : 0.93, 0.99) * smoothstep(0.35, 0.65, fd_noise(p * 25.0 + 7.0)) * fl(200.0);
    float flecks = (1.0 - smoothstep(0.04, 0.12, fd_worley(p * 160.0 + 5.0))) * step(0.62, fd_noise(p * 50.0)) * fl(320.0);
    float marb = clamp(web + (beef ? 0.6 * flecks : 0.0), 0.0, 1.0) * fdLean;
    float waxy = (fd_fbm(p * 60.0) - 0.47) * (1.0 - fdLean);
    lum = 1.0 + fdLean * (0.25 * g1 * fl(650.0) + 0.3 * g2 * fl(200.0) + 0.5 * bundles * fl(70.0) - 0.15 * seams) + 0.08 * waxy;
    tint = beef ? vec3(0.92, 0.82, 0.76) : vec3(0.93, 0.84, 0.78);
    tintAmt = marb * (beef ? 0.7 : 0.45);
    h = fdLean * (0.5 * g1 * fl(650.0) + 0.6 * bundles - 0.5 * seams) - 0.15 * marb + 0.15 * waxy;
    rough = -0.06;
  } else if (uPattern == 3) {
    float g = fd_noise(vec3(p.x * 25.0, p.y * 350.0, p.z * 350.0)) - 0.5;
    float f = fd_fbm(p * 50.0) - 0.47;
    lum = 1.0 + 0.16 * g * fl(350.0) + 0.16 * f * fl(50.0);
    tint = vec3(0.93, 0.7, 0.68);
    tintAmt = 0.18 * smoothstep(0.45, 0.7, fd_fbm(p * 30.0 + 5.0));
    h = 0.5 * g * fl(350.0) + 0.3 * f;
    rough = -0.1;
  } else if (uPattern == 4) {
    // Chicken skin: feather follicles (goosebumps), wrinkles, yellow fat showing through.
    float pore = (smoothstep(0.08, 0.45, fd_worley(p * 450.0)) - 0.6) * fl(450.0);
    float wr = fd_fbm(p * vec3(110.0, 50.0, 110.0)) - 0.47;
    lum = 1.0 + 0.16 * pore + 0.18 * wr * fl(110.0);
    tint = vec3(0.95, 0.82, 0.5);
    tintAmt = 0.4 * smoothstep(0.42, 0.7, fd_fbm(p * 35.0 + 2.0));
    h = 0.7 * pore + 0.7 * wr;
  } else if (uPattern == 5) {
    // Russet potato: mottled, netted skin, dark specks, a few eyes.
    float mott = fd_fbm(p * 110.0) - 0.47;
    float net = fd_vein(p * 140.0 + 9.0, 0.86, 0.98) * fl(280.0);
    float speck = (1.0 - smoothstep(0.08, 0.18, fd_worley(p * 220.0))) * step(0.5, fd_noise(p * 80.0)) * fl(250.0);
    float eye = (1.0 - smoothstep(0.05, 0.11, fd_worley(p * 45.0))) * step(0.6, fd_noise(p * 18.0 + 4.0));
    lum = 1.0 + 0.5 * mott * fl(110.0) - 0.22 * net - 0.45 * speck - 0.5 * eye;
    tint = vec3(0.45, 0.29, 0.16);
    tintAmt = 0.35 * smoothstep(0.4, 0.72, fd_fbm(p * 28.0 + 1.0));
    h = 0.9 * mott + 0.4 * (fd_fbm(p * 35.0) - 0.47) - 0.3 * net - 1.0 * eye;
    rough = 0.12;
  } else if (uPattern == 6) {
    // Carrot: growth rings around the long (x) axis, lengthwise streaks.
    float warp = fd_fbm(p * 50.0) * 5.0;
    float ring = (smoothstep(0.75, 1.0, sin(p.x * 700.0 + warp)) - 0.12) * fl(110.0);
    float streak = (fd_noise(vec3(p.x * 40.0, p.y * 400.0, p.z * 400.0)) - 0.5) * fl(400.0);
    lum = 1.0 - 0.25 * ring + 0.18 * streak;
    tint = vec3(0.78, 0.36, 0.1);
    tintAmt = 0.25 * smoothstep(0.5, 0.8, fd_fbm(p * 30.0 + 6.0));
    h = -0.8 * ring + 0.35 * streak;
  } else if (uPattern == 7 || uPattern == 11) {
    // Onion / garlic: dry papery skin with streaks running pole to pole (around the y axis).
    vec2 dir = normalize(pc.xz + vec2(1e-5));
    bool garlic = uPattern == 11;
    float r = length(pc.xz);
    // Streaks a few mm apart around the bulb (noise sampled on a circle of radius k: k/r cycles per metre).
    float k = garlic ? 7.0 : 12.0;
    float s = (fd_noise(vec3(dir * k, pc.y * (garlic ? 25.0 : 18.0) + uSeed)) - 0.5) * fl(k / max(r, 0.004));
    float big = fd_fbm(p * 45.0) - 0.47;
    lum = 1.0 + 0.32 * s + 0.2 * big * fl(45.0);
    tint = garlic ? vec3(0.84, 0.66, 0.74) : vec3(0.8, 0.5, 0.24);
    tintAmt = (garlic ? 0.3 : 0.35) * smoothstep(0.5, 0.8, fd_fbm(vec3(dir * 6.0, pc.y * 20.0 + uSeed) + 3.0));
    h = 0.5 * s + 0.3 * big;
    rough = 0.05;
  } else if (uPattern == 8) {
    // Bell pepper: smooth and glassy, faint mottling.
    lum = 1.0 + 0.12 * (fd_fbm(p * 25.0) - 0.47);
    h = 0.25 * (fd_fbm(p * 120.0) - 0.47) * fl(120.0);
    rough = -0.45;
  } else if (uPattern == 9) {
    // Broccoli: florets (bumps) with dark crevices, grouped into larger heads.
    float d = fd_worley(p * 260.0);
    float D = fd_worley(p * 60.0);
    float crev = (smoothstep(0.25, 0.6, d) - 0.45) * fl(260.0);
    float gap = smoothstep(0.35, 0.7, D);
    float bud = (fd_noise(p * 900.0) - 0.5) * fl(900.0);
    lum = 1.0 - 0.5 * crev - 0.35 * gap + 0.15 * bud;
    tint = vec3(0.08, 0.2, 0.06);
    tintAmt = 0.4 * gap;
    h = -crev - 0.7 * D + 0.3 * bud;
    rough = 0.15;
  } else if (uPattern == 10) {
    float speck = (1.0 - smoothstep(0.06, 0.15, fd_worley(p * 200.0))) * fl(220.0);
    lum = 1.0 + 0.14 * (fd_fbm(p * 120.0) - 0.47) * fl(120.0) - 0.15 * speck;
    tint = vec3(0.55, 0.42, 0.3);
    tintAmt = 0.25 * smoothstep(0.5, 0.75, fd_fbm(p * 30.0));
    h = 0.3 * (fd_fbm(p * 120.0) - 0.47);
  } else if (uPattern == 12) {
    float vein = fd_vein(p * 60.0, 0.88, 0.99) * fl(150.0);
    lum = 1.0 + 0.28 * (fd_fbm(p * 80.0) - 0.47) + 0.2 * vein;
    h = 0.45 * vein + 0.15 * (fd_fbm(p * 150.0) - 0.47);
  } else if (uPattern == 13) {
    float speck = (1.0 - smoothstep(0.05, 0.12, fd_worley(p * 180.0))) * step(0.6, fd_noise(p * 60.0)) * fl(200.0);
    lum = 1.0 + 0.08 * (fd_fbm(p * 120.0) - 0.47) - 0.14 * speck;
    h = 0.2 * (fd_fbm(p * 250.0) - 0.47) * fl(250.0);
    rough = 0.05;
  } else if (uPattern == 14) {
    lum = 1.0 + 0.08 * (fd_fbm(p * vec3(15.0, 45.0, 15.0)) - 0.47);
    h = 0.15 * (fd_fbm(p * 60.0) - 0.47);
    rough = -0.12;
  } else if (uPattern == 15) {
    // Dough: flour dusting, soft dimples.
    float dust = smoothstep(0.5, 0.75, fd_fbm(p * 60.0));
    lum = 1.0 + 0.1 * (fd_fbm(p * 140.0) - 0.47) * fl(140.0);
    tint = vec3(0.97, 0.95, 0.91);
    tintAmt = 0.6 * dust;
    h = 0.4 * (fd_fbm(p * 45.0) - 0.47) + 0.15 * (fd_fbm(p * 200.0) - 0.47) * fl(200.0);
    rough = 0.1;
  }
}

// three.js' perturbNormalArb (only compiled in with a bump map), for our procedural height.
vec3 fd_perturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
