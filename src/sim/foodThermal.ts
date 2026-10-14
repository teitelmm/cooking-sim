import type { FoodProps } from '../data/foods';
import { waterHolding } from './doneness';
import { BOIL_C, KELVIN, LATENT, ROOM_C, SIGMA } from './units';

/**
 * Voxel heat-and-moisture model of one piece of food.
 *
 * Interior: explicit finite-difference conduction on a coarse grid (≈ 9–15 cells per axis), with water
 * content, peak temperature (protein changes are irreversible), free juice, collagen, starch and softening
 * per cell.
 *
 * Surface: every exposed voxel face carries a thin crust layer with its own water, surface temperature,
 * Maillard browning and char. Each face sees the environment of its local direction (contact with a pan,
 * convection from air/water/oil, radiation from coals or a broiler), so flipping the food changes which
 * face gets the heat. While the crust is wet the surface is pinned near 100 °C (steaming) and evaporation
 * eats the heat; once dry the surface climbs and browns — then chars if it stays very hot.
 */

/** Local face directions: +x, −x, +y, −y, +z, −z. */
export const DIRS: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const enum Dir {
  PX = 0,
  NX = 1,
  PY = 2,
  NY = 3,
  PZ = 4,
  NZ = 5,
}

export type Medium = 'air' | 'water' | 'oil' | 'bag';

/** What one face of the food is exposed to. Temperatures in °C, heat-transfer coefficients in W/(m²·K). */
export interface FaceEnv {
  medium: Medium;
  /** Surrounding fluid (air, water, oil) temperature and convective coefficient. */
  fluidT: number;
  fluidH: number;
  /** Hot surface in contact (pan, grill bars) and contact conductance, applied over `contactFrac` of the face. */
  contactT: number;
  contactH: number;
  contactFrac: number;
  /** Radiant source (coals, broiler element) temperature and view factor 0..1. */
  radT: number;
  radView: number;
}

/** Open air at T. Surroundings at the same temperature also exchange radiation (≈ as much as still-air convection). */
export function airEnv(T = ROOM_C, h = 8): FaceEnv {
  return { medium: 'air', fluidT: T, fluidH: h, contactT: T, contactH: 0, contactFrac: 0, radT: T, radView: 0.9 };
}

/** Inside an oven: hot air convection plus radiation from the walls (≈ as much heat again). */
export function ovenEnv(T: number, h: number = H.oven): FaceEnv {
  return { medium: 'air', fluidT: T, fluidH: h, contactT: T, contactH: 0, contactFrac: 0, radT: T, radView: 0.85 };
}

/** Typical heat-transfer coefficients, W/(m²·K). */
export const H = {
  stillAir: 8,
  oven: 15,
  convectionOven: 30,
  airFryer: 70,
  /** Circulated water bath through a vacuum bag. */
  sousVide: 350,
  simmer: 600,
  boil: 1200,
  /** Deep-fry oil (vigorous bubbling while the food steams). */
  fry: 450,
  /** Food lying on a hot pan (with a little fat). */
  panContact: 500,
  /** Food on grill bars (only the bar area touches). */
  grillContact: 600,
} as const;

/** Thickness of the surface crust layer that has to dry before browning starts, m. */
const CRUST_DEPTH = 0.001;
/** Conductivity of dried crust, W/(m·K). */
const K_CRUST = 0.18;
/** Real crusts rarely exceed a few millimetres. */
const MAX_CRUST = 0.0025;
/** Interior → crust moisture resupply, kg/(m²·s) at full water content. */
const REWET = 2.5e-4;
/** Absolute humidity of kitchen / oven air, kg/m³. */
const AIR_VAPOR = 0.01;
const EMISSIVITY = 0.9;
/** Protein squeeze time constant, s. */
const SQUEEZE_TAU = 40;
/** Share of the squeezed juice from surface cells that weeps out onto the surface. */
const WEEP = 0.6;
/** Share of interior squeeze that purges out to the surface. */
const PURGE = 0.5;
/** Evaporation–condensation boost to conductivity at 100 °C, and its e-folding scale (°C). */
export const VAPOR_K = 4;
export const VAPOR_K_SCALE = 25;

function vaporDensity(Tc: number): number {
  const psat = 610.78 * Math.exp((17.27 * Tc) / (Tc + 237.3));
  return psat / (461.5 * (Tc + KELVIN));
}

const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Maillard browning rate, 1/s (1.0 = deep golden-brown crust). */
export function browningRate(Ts: number): number {
  if (Ts < 110) return 0;
  return 0.0064 * Math.exp((Ts - 150) / 18);
}

/**
 * Charring rate, 1/s (1.0 = black). Very temperature-sensitive: negligible below ~390 °F, real by
 * ~415 °F (213 °C) — a face that keeps sitting on the pan creeps up there; a flipped face doesn't.
 */
export function charRate(Ts: number): number {
  if (Ts < 185) return 0;
  return 2.8e-3 * Math.exp((Ts - 213) / 5);
}

export interface FoodThermalOptions {
  initialT?: number;
  /** Custom shape: is local point (m, grid-centered) inside the food? Used for cut pieces. */
  inside?: (x: number, y: number, z: number) => boolean;
  /** Override the stair-step surface correction (pieces inherit their parent's). */
  areaScale?: number;
  /** Override grid resolution. */
  dims?: [number, number, number];
}

export class FoodThermal {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly N: number;
  /** Cell sizes, m. */
  readonly d: [number, number, number];
  readonly cellMass: number;
  readonly mask: Uint8Array;
  readonly cellCount: number;

  /** Temperature °C. */
  readonly T: Float32Array;
  /** Water, kg per kg of initial cell mass. */
  readonly w: Float32Array;
  /** Peak temperature reached, °C (drives doneness/color — irreversible). */
  readonly peak: Float32Array;
  /** Free (mobile) juice, kg per kg cell mass — what runs out when cut. */
  readonly juice: Float32Array;
  /** Remaining collagen 1 → 0 (gelatinized = tender). */
  readonly collagen: Float32Array;
  /** Starch gelatinization 0 → 1. */
  readonly starch: Float32Array;
  /** Softening (pectin breakdown) 0 → 1. */
  readonly soft: Float32Array;
  /** Remaining solid fat, kg per kg. */
  readonly fat: Float32Array;

  // Exposed faces (cell, local direction) and their crust state.
  readonly faceCell: Int32Array;
  readonly faceDir: Uint8Array;
  readonly crust: Float32Array;
  readonly brown: Float32Array;
  readonly charred: Float32Array;
  readonly surfT: Float32Array;
  /** 1 where the face is a knife cut (not the food's original outside). */
  readonly isCut: Uint8Array;
  readonly faceCount: number;
  /** How many cells in from the extreme plane of its direction each face sits (0 = outermost). */
  readonly faceLayer: Uint8Array;
  /** Ratio of the true surface area to the voxel surface area (stair-step correction). */
  readonly areaScale: number;

  /** Environment seen by each local face direction. */
  readonly env: FaceEnv[] = DIRS.map(() => airEnv());
  time = 0;
  /** Water evaporated (kg), fat dripped (kg) — feeds flare-ups, pan fond, cook loss. */
  evaporated = 0;
  drippings = 0;
  readonly mass0: number;
  private acc = 0;
  readonly dtMax: number;
  private readonly Tn: Float32Array;
  private readonly kFactor: Float32Array;
  /** Number of exposed faces per cell. */
  private readonly surfaceFaces: Uint8Array;
  /** Wept juice per cell waiting to be spread onto its faces, kg per face. */
  private readonly weep: Float32Array;
  readonly w0: number;
  readonly crustMax: number;

  constructor(
    readonly props: FoodProps,
    /** Full size along local x, y, z, m. */
    readonly size: [number, number, number],
    opts: FoodThermalOptions = {},
  ) {
    const dims = opts.dims ?? FoodThermal.gridFor(size);
    [this.nx, this.ny, this.nz] = dims;
    this.N = this.nx * this.ny * this.nz;
    this.d = [size[0] / this.nx, size[1] / this.ny, size[2] / this.nz];
    this.cellMass = props.rho * this.d[0] * this.d[1] * this.d[2];
    this.w0 = props.water;

    const N = this.N;
    this.mask = new Uint8Array(N);
    let count = 0;
    for (let k = 0; k < this.nz; k++)
      for (let j = 0; j < this.ny; j++)
        for (let i = 0; i < this.nx; i++) {
          const u = ((i + 0.5) / this.nx) * 2 - 1;
          const v = ((j + 0.5) / this.ny) * 2 - 1;
          const s = ((k + 0.5) / this.nz) * 2 - 1;
          let inside = true;
          if (opts.inside) inside = opts.inside(u * size[0] * 0.5, v * size[1] * 0.5, s * size[2] * 0.5);
          else if (props.shape === 'ellipsoid') inside = u * u + v * v + s * s <= 1.0001;
          else if (props.shape === 'cylinderX') inside = v * v + s * s <= 1.0001;
          if (inside) {
            this.mask[this.idx(i, j, k)] = 1;
            count++;
          }
        }
    if (count === 0) {
      this.mask[this.idx(this.nx >> 1, this.ny >> 1, this.nz >> 1)] = 1;
      count = 1;
    }
    this.cellCount = count;

    const T0 = opts.initialT ?? ROOM_C;
    this.T = new Float32Array(N).fill(T0);
    this.Tn = new Float32Array(N);
    this.kFactor = new Float32Array(N).fill(1);
    this.w = new Float32Array(N).fill(props.water);
    this.peak = new Float32Array(N).fill(T0);
    this.juice = new Float32Array(N);
    this.collagen = new Float32Array(N).fill(props.collagen ?? 0);
    this.starch = new Float32Array(N);
    this.soft = new Float32Array(N);
    this.fat = new Float32Array(N).fill(props.fat ?? 0);
    this.mass0 = count * this.cellMass;

    // Exposed faces.
    const cells: number[] = [];
    const dirs: number[] = [];
    let voxelArea = 0;
    for (let k = 0; k < this.nz; k++)
      for (let j = 0; j < this.ny; j++)
        for (let i = 0; i < this.nx; i++) {
          const c = this.idx(i, j, k);
          if (!this.mask[c]) continue;
          DIRS.forEach(([dx, dy, dz], dir) => {
            const ii = i + dx;
            const jj = j + dy;
            const kk = k + dz;
            const out = ii < 0 || jj < 0 || kk < 0 || ii >= this.nx || jj >= this.ny || kk >= this.nz || !this.mask[this.idx(ii, jj, kk)];
            if (out) {
              cells.push(c);
              dirs.push(dir);
              voxelArea += this.faceArea(dir);
            }
          });
        }
    this.faceCell = Int32Array.from(cells);
    this.faceDir = Uint8Array.from(dirs);
    this.faceCount = cells.length;
    this.faceLayer = new Uint8Array(this.faceCount);
    this.surfaceFaces = new Uint8Array(N);
    for (const c of cells) this.surfaceFaces[c]++;
    this.weep = new Float32Array(N);
    const ext = [this.nx - 1, 0, this.ny - 1, 0, this.nz - 1, 0];
    const minLayer = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
    const coord = (c: number, dir: number) => {
      const i = c % this.nx;
      const j = Math.floor(c / this.nx) % this.ny;
      const k = Math.floor(c / (this.nx * this.ny));
      const v = dir < 2 ? i : dir < 4 ? j : k;
      return Math.abs(ext[dir] - v);
    };
    for (let f = 0; f < this.faceCount; f++) minLayer[this.faceDir[f]] = Math.min(minLayer[this.faceDir[f]], coord(this.faceCell[f], this.faceDir[f]));
    for (let f = 0; f < this.faceCount; f++) this.faceLayer[f] = Math.min(255, coord(this.faceCell[f], this.faceDir[f]) - minLayer[this.faceDir[f]]);
    this.crustMax = CRUST_DEPTH * props.rho * props.water;
    this.crust = new Float32Array(this.faceCount).fill(this.crustMax + (props.surfaceWater ?? 0.02));
    this.brown = new Float32Array(this.faceCount);
    this.charred = new Float32Array(this.faceCount);
    this.surfT = new Float32Array(this.faceCount).fill(T0);
    this.isCut = new Uint8Array(this.faceCount);
    this.areaScale = opts.areaScale ?? FoodThermal.trueArea(props.shape, size) / voxelArea;

    const alpha = ((1 + VAPOR_K) * props.k) / (props.rho * props.cp);
    const [dx, dy, dz] = this.d;
    const minD = Math.min(dx, dy, dz);
    this.dtMax = Math.min(0.5, 0.4 / (2 * alpha * (1 / dx ** 2 + 1 / dy ** 2 + 1 / dz ** 2) + (4 * alpha) / minD ** 2));
  }

  /** Odd cell counts so there is a true center cell; ~9 cells through the thinnest dimension. */
  static gridFor(size: [number, number, number]): [number, number, number] {
    const minDim = Math.min(...size);
    const cell = Math.max(minDim / 9, 0.003);
    return size.map((s) => {
      let n = Math.round(s / cell);
      n = Math.min(Math.max(n, 5), 15);
      if (n % 2 === 0) n += 1;
      return n;
    }) as [number, number, number];
  }

  static trueArea(shape: FoodProps['shape'], size: [number, number, number]): number {
    const [a, b, c] = size.map((s) => s / 2);
    if (shape === 'box') return 2 * (size[0] * size[1] + size[1] * size[2] + size[0] * size[2]);
    if (shape === 'cylinderX') {
      const r = (b + c) / 2;
      return 2 * Math.PI * r * size[0] + 2 * Math.PI * r * r;
    }
    const p = 1.6075; // Knud Thomsen ellipsoid approximation
    return 4 * Math.PI * (((a * b) ** p + (a * c) ** p + (b * c) ** p) / 3) ** (1 / p);
  }

  /** Cell containing local point (grid-centered metres), or −1 if outside the grid. */
  cellAt(x: number, y: number, z: number): number {
    const i = Math.floor((x / this.size[0] + 0.5) * this.nx);
    const j = Math.floor((y / this.size[1] + 0.5) * this.ny);
    const k = Math.floor((z / this.size[2] + 0.5) * this.nz);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return this.idx(i, j, k);
  }

  /** Center of cell c in local coordinates. */
  cellCenter(c: number): [number, number, number] {
    const i = c % this.nx;
    const j = Math.floor(c / this.nx) % this.ny;
    const k = Math.floor(c / (this.nx * this.ny));
    return [((i + 0.5) / this.nx - 0.5) * this.size[0], ((j + 0.5) / this.ny - 0.5) * this.size[1], ((k + 0.5) / this.nz - 0.5) * this.size[2]];
  }

  /** Trilinear sample of a per-cell field at a local point (ignores cells outside the food). */
  sample(arr: Float32Array, x: number, y: number, z: number): number {
    const fx = (x / this.size[0] + 0.5) * this.nx - 0.5;
    const fy = (y / this.size[1] + 0.5) * this.ny - 0.5;
    const fz = (z / this.size[2] + 0.5) * this.nz - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const k0 = Math.floor(fz);
    let sum = 0;
    let wsum = 0;
    for (let dk = 0; dk < 2; dk++)
      for (let dj = 0; dj < 2; dj++)
        for (let di = 0; di < 2; di++) {
          const i = Math.min(Math.max(i0 + di, 0), this.nx - 1);
          const j = Math.min(Math.max(j0 + dj, 0), this.ny - 1);
          const k = Math.min(Math.max(k0 + dk, 0), this.nz - 1);
          const c = this.idx(i, j, k);
          if (!this.mask[c]) continue;
          const w = (di ? fx - i0 : 1 - (fx - i0)) * (dj ? fy - j0 : 1 - (fy - j0)) * (dk ? fz - k0 : 1 - (fz - k0));
          sum += arr[c] * w;
          wsum += w;
        }
    if (wsum > 1e-6) return sum / wsum;
    const c = this.cellAt(x, y, z);
    return c >= 0 ? arr[c] : 0;
  }

  idx(i: number, j: number, k: number): number {
    return i + this.nx * (j + this.ny * k);
  }

  faceArea(dir: number): number {
    const [dx, dy, dz] = this.d;
    return dir < 2 ? dy * dz : dir < 4 ? dx * dz : dx * dy;
  }

  /** Advance by dt game seconds (internally sub-stepped for stability). */
  step(dt: number): void {
    this.acc += dt;
    const h = this.dtMax;
    while (this.acc >= h) {
      this.substep(h);
      this.acc -= h;
      this.time += h;
    }
  }

  private substep(dt: number): void {
    const { nx, ny, nz, T, Tn, mask, props } = this;
    const [dx, dy, dz] = this.d;
    const alpha = props.k / (props.rho * props.cp);
    const cx = alpha / (dx * dx);
    const cy = alpha / (dy * dy);
    const cz = alpha / (dz * dz);
    const sx = 1;
    const sy = nx;
    const sz = nx * ny;

    // Effective conductivity multiplier per cell. Moist food conducts much better near boiling: water
    // evaporates on the hot side and condenses on the cool side (a "heat pipe"), so heat moves inward faster.
    const kf = this.kFactor;
    for (let c = 0; c < this.N; c++) {
      if (!mask[c]) continue;
      const moist = Math.min(this.w[c] / (this.w0 || 1), 1);
      kf[c] = 1 + VAPOR_K * moist * Math.exp((Math.min(T[c], BOIL_C) - BOIL_C) / VAPOR_K_SCALE);
    }

    // 1. Interior conduction (insulated where the neighbor is outside the food; surfaces handled below).
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = i + nx * (j + ny * k);
          if (!mask[c]) continue;
          const t = T[c];
          const kc = kf[c];
          let lap = 0;
          if (i > 0 && mask[c - sx]) lap += cx * (kc + kf[c - sx]) * (T[c - sx] - t);
          if (i < nx - 1 && mask[c + sx]) lap += cx * (kc + kf[c + sx]) * (T[c + sx] - t);
          if (j > 0 && mask[c - sy]) lap += cy * (kc + kf[c - sy]) * (T[c - sy] - t);
          if (j < ny - 1 && mask[c + sy]) lap += cy * (kc + kf[c + sy]) * (T[c + sy] - t);
          if (k > 0 && mask[c - sz]) lap += cz * (kc + kf[c - sz]) * (T[c - sz] - t);
          if (k < nz - 1 && mask[c + sz]) lap += cz * (kc + kf[c + sz]) * (T[c + sz] - t);
          Tn[c] = t + 0.5 * lap * dt;
        }

    // 2. Surface exchange per exposed face.
    const rc = props.rho * props.cp;
    const G0 = 2 * props.k; // conductance = k / (d/2)
    const scale = this.areaScale;
    for (let f = 0; f < this.faceCount; f++) {
      const c = this.faceCell[f];
      const dir = this.faceDir[f];
      const env = this.env[dir];
      if (this.weep[c] > 0) this.crust[f] += this.weep[c] / (this.faceArea(dir) * this.areaScale);
      const dn = this.d[dir >> 1];
      const area = this.faceArea(dir) * scale;
      // Dehydrated crust insulates: the dried layer (crust film + dehydrated tissue) adds series resistance.
      const dryFrac = 1 - Math.min(this.crust[f] / this.crustMax, 1);
      const dehydrated = Math.min(Math.max(1 - this.w[c] / this.w0 - 0.3, 0), 1);
      const dryDepth = Math.min(CRUST_DEPTH * dryFrac + dn * dehydrated, MAX_CRUST);
      const G = 1 / (dn / G0 + dryDepth / K_CRUST);
      const Tc = T[c];
      // Only faces on the outermost layer in this direction can touch a flat surface (a potato touches
      // the pan with its underside, not its whole lower half).
      const cf = this.faceLayer[f] === 0 ? env.contactFrac : this.faceLayer[f] === 1 ? env.contactFrac * 0.35 : 0;
      const hc = env.contactH * cf;
      const hv = env.fluidH * (1 - cf);
      let hr = 0;
      if (env.radView > 0) {
        const Tr = env.radT + KELVIN;
        const Tsk = this.surfT[f] + KELVIN;
        hr = EMISSIVITY * SIGMA * (Tr * Tr + Tsk * Tsk) * (Tr + Tsk) * env.radView;
      }
      const Hs = hc + hv + hr;
      const Te = Hs > 0 ? (hc * env.contactT + hv * env.fluidT + hr * env.radT) / Hs : Tc;
      let Ts = (Hs * Te + G * Tc) / (Hs + G);
      let q: number; // W/m² into the cell
      let evap = 0; // kg/(m²·s)
      // A trace of resupplied moisture can't hold the surface at boiling: below ~5 % of a full crust the
      // evaporation front has receded into the meat and the surface behaves as dry.
      const wet = this.crust[f] > 0.05 * this.crustMax;

      if (env.medium === 'water' || env.medium === 'bag') {
        // Submerged: surface stays wet, no evaporation, can't brown.
        q = G * (Ts - Tc);
        this.crust[f] = Math.max(this.crust[f], this.crustMax);
      } else if (wet && Ts > BOIL_C) {
        // Steaming: surface pinned at boiling, excess heat boils off crust water.
        Ts = BOIL_C;
        const qin = Hs * (Te - BOIL_C);
        q = G * (BOIL_C - Tc);
        evap = Math.max(0, qin - q) / LATENT;
      } else {
        // Evaporation limited by both mass transfer (air only) and what water the crust actually has.
        // Above boiling a dry face flashes off whatever trickles up. Every gram evaporated takes its latent heat.
        const supply = this.crust[f] / dt;
        const hm = env.medium === 'air' ? (env.fluidH * (1 - cf)) / 1200 : 0;
        for (let it = 0; it < 3; it++) {
          const demand = Ts >= BOIL_C ? supply : hm * (vaporDensity(Ts) - AIR_VAPOR);
          evap = Math.min(Math.max(demand, 0), supply);
          Ts = (Hs * Te + G * Tc - evap * LATENT) / (Hs + G);
        }
        q = G * (Ts - Tc);
      }

      if (evap > 0) {
        const m = Math.min(evap * dt, this.crust[f]);
        this.crust[f] -= m;
        const kg = m * area;
        this.w[c] = Math.max(0, this.w[c] - kg / this.cellMass);
        this.evaporated += kg;
      }
      // Interior moisture slowly re-wets the crust (diffusion to the surface).
      if (env.medium !== 'water' && env.medium !== 'bag' && this.crust[f] < this.crustMax && this.w[c] > 0.2 * this.w0) {
        const add = REWET * (this.w[c] / this.w0) * (1 - this.crust[f] / this.crustMax) * dt;
        this.crust[f] += add;
      }

      Tn[c] += (q * scale * dt) / (rc * dn);
      this.surfT[f] = Ts;

      if (!wet || Ts > BOIL_C) {
        const dryness = wet ? 0.3 : 1;
        this.brown[f] = Math.min(1.6, this.brown[f] + browningRate(Ts) * (props.browning ?? 1) * dryness * dt);
        this.charred[f] = Math.min(1, this.charred[f] + charRate(Ts) * (props.char ?? 1) * dt);
      }
    }

    this.weep.fill(0);

    // 3. Per-cell chemistry.
    let purge = 0;
    const w0 = this.w0;
    const L = LATENT;
    for (let c = 0; c < this.N; c++) {
      if (!mask[c]) continue;
      let t = Tn[c];
      // Interior water boils off above 100 °C (keeps the cell pinned while it has water).
      if (t > BOIL_C && this.w[c] > 0.05 * w0) {
        const dw = Math.min(((t - BOIL_C) * props.cp) / L, this.w[c] - 0.05 * w0);
        this.w[c] -= dw;
        this.evaporated += dw * this.cellMass;
        t = BOIL_C + (((t - BOIL_C) * props.cp - dw * L) / props.cp);
      }
      T[c] = t;
      if (t > this.peak[c]) this.peak[c] = t;

      if (props.protein) {
        const target = w0 * waterHolding(this.peak[c]);
        if (this.w[c] > target) {
          const out = ((this.w[c] - target) * dt) / SQUEEZE_TAU;
          this.w[c] -= out;
          const n = this.surfaceFaces[c];
          if (n > 0) {
            // Surface cells weep part of what they squeeze onto the surface (the steak "sweats"):
            // it keeps the face wet and evaporates off — strong cooling while resting.
            const toSurface = out * WEEP;
            this.juice[c] += out - toSurface;
            this.weep[c] += (toSurface * this.cellMass) / n;
          } else {
            // Interior purge: part of the squeezed juice migrates out to the surface (the steak "sweats").
            this.juice[c] += out * (1 - PURGE);
            purge += out * PURGE * this.cellMass;
          }
        }
        // Free juice thickens / redistributes as the meat rests below ~140 °F.
        if (t < 66) {
          this.juice[c] *= Math.exp(-dt / (t < 60 ? 400 : 900));
        } else {
          // Hot, tightly contracted meat can't hold it: it drains out (drips into the pan / evaporates).
          const drained = this.juice[c] * (1 - Math.exp(-dt / 120));
          this.juice[c] -= drained;
          purge += drained * this.cellMass * 0.5;
        }
      }
      if (this.collagen[c] > 0 && t > 55) {
        // Collagen → gelatin: hours at 160–200 °F (ribs: tender ≈ 195–203 °F internal).
        const k = 2.3e-5 * Math.exp((t - 70) / 8);
        this.collagen[c] *= Math.exp(-k * dt);
      }
      if (props.starch && t > 58 && this.w[c] > 0.4 * w0) {
        const k = 6.8e-4 * Math.exp((t - 80) / 6);
        this.starch[c] += (1 - this.starch[c]) * (1 - Math.exp(-k * dt));
      }
      if (props.softens && t > 60) {
        const k = (1 / 420) * Math.exp((t - 92) / 8);
        this.soft[c] += (1 - this.soft[c]) * (1 - Math.exp(-k * dt));
      }
      if (this.fat[c] > 0 && t > 50) {
        const r = (smooth01((t - 50) / 40) / 900) * dt;
        const melted = this.fat[c] * r;
        this.fat[c] -= melted;
        this.drippings += melted * this.cellMass * 0.5;
      }
    }
    if (purge > 0) this.spreadPurge(purge);
  }

  /**
   * Spread purged juice (kg) onto the surface. Lying on something, it beads up on the face opposite the
   * contact (juice pooling on top of a steak) and runs off the sides; free-standing, it covers all faces.
   */
  private spreadPurge(kg: number): void {
    let contactDir = -1;
    for (let d = 0; d < 6; d++) if (this.env[d].contactFrac > 0) contactDir = d;
    const target = contactDir >= 0 ? contactDir ^ 1 : -1;
    let area = 0;
    for (let f = 0; f < this.faceCount; f++) if (target < 0 || this.faceDir[f] === target) area += this.faceArea(this.faceDir[f]);
    if (area <= 0) return;
    const perM2 = kg / (area * this.areaScale);
    for (let f = 0; f < this.faceCount; f++) {
      const dir = this.faceDir[f];
      if ((target < 0 || dir === target) && this.env[dir].medium !== 'water') this.crust[f] += perM2;
    }
  }

  // ------------------------------------------------------------------ queries

  get centerIndex(): number {
    return this.idx(this.nx >> 1, this.ny >> 1, this.nz >> 1);
  }

  /** Core (geometric center) temperature, °C — what a probe in the middle reads. */
  coreTemp(): number {
    return this.T[this.centerIndex];
  }

  /** Peak temperature reached at the core, °C. */
  corePeak(): number {
    return this.peak[this.centerIndex];
  }

  /** Coldest current temperature anywhere inside (for safety checks), °C. */
  minTemp(): number {
    let m = Infinity;
    for (let c = 0; c < this.N; c++) if (this.mask[c] && this.T[c] < m) m = this.T[c];
    return m;
  }

  maxTemp(): number {
    let m = -Infinity;
    for (let c = 0; c < this.N; c++) if (this.mask[c] && this.T[c] > m) m = this.T[c];
    return m;
  }

  /** Lowest peak temperature anywhere — the least-cooked spot ever got this hot. */
  minPeak(): number {
    let m = Infinity;
    for (let c = 0; c < this.N; c++) if (this.mask[c] && this.peak[c] < m) m = this.peak[c];
    return m;
  }

  private faceStat(arr: Float32Array, dir?: number): number {
    let s = 0;
    let n = 0;
    for (let f = 0; f < this.faceCount; f++) {
      if (dir !== undefined && this.faceDir[f] !== dir) continue;
      s += arr[f];
      n++;
    }
    return n ? s / n : 0;
  }

  browning(dir?: number): number {
    return this.faceStat(this.brown, dir);
  }

  char(dir?: number): number {
    return this.faceStat(this.charred, dir);
  }

  surfaceTemp(dir?: number): number {
    return this.faceStat(this.surfT, dir);
  }

  crustWater(dir?: number): number {
    return this.faceStat(this.crust, dir);
  }

  /** Face index for (cell, dir), or −1. */
  faceOf(c: number, dir: number): number {
    if (!this.faceIndex) {
      this.faceIndex = new Map();
      for (let f = 0; f < this.faceCount; f++) this.faceIndex.set(this.faceCell[f] * 6 + this.faceDir[f], f);
    }
    return this.faceIndex.get(c * 6 + dir) ?? -1;
  }
  private faceIndex: Map<number, number> | null = null;

  /** Mean of a per-cell field over the food. */
  mean(arr: Float32Array): number {
    let s = 0;
    for (let c = 0; c < this.N; c++) if (this.mask[c]) s += arr[c];
    return s / this.cellCount;
  }

  /** Remaining water as a fraction of the original (1 = raw-juicy, ~0.7 = dry well-done). */
  juiciness(): number {
    return this.mean(this.w) / this.w0;
  }

  /** Total current mass, kg. */
  mass(): number {
    let water = 0;
    for (let c = 0; c < this.N; c++) if (this.mask[c]) water += this.w0 - this.w[c];
    return this.mass0 - water * this.cellMass;
  }

  /** Free juice currently held, kg — the most that could run out if cut everywhere. */
  freeJuice(): number {
    let s = 0;
    for (let c = 0; c < this.N; c++) if (this.mask[c]) s += this.juice[c];
    return s * this.cellMass;
  }

  /** Set the same environment on all six faces. */
  setAllEnv(e: FaceEnv): void {
    for (let i = 0; i < 6; i++) this.env[i] = { ...e };
  }
}
