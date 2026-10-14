import type { FoodItem } from './food';
import { Dir, H, ovenEnv, type FaceEnv } from './foodThermal';
import { fToC } from './units';

/** Face env for lying on a pan at panF with a film of fat. */
export function panContact(panF: number, contactH: number = H.panContact): FaceEnv {
  return { medium: 'air', fluidT: 60, fluidH: 10, contactT: fToC(panF), contactH, contactFrac: 0.9, radT: 22, radView: 0 };
}

/**
 * Faces not touching the pan: hot air rising off the pan (hotter near the pan) plus radiation from the pan
 * surface. Side faces see much more of the pan than the top does.
 */
export function abovePanEnv(panC: number, side: boolean): FaceEnv {
  // Sides: hot fat spitting up the edges + air rising off the pan + the pan's glow. Top: warm air only.
  const airT = side ? 22 + (panC - 22) * 0.5 : 22 + (panC - 22) * 0.12;
  return { medium: 'air', fluidT: airT, fluidH: side ? 22 : 9, contactT: airT, contactH: 0, contactFrac: 0, radT: panC, radView: side ? 0.3 : 0.05 };
}

/** `down` face on the pan, the rest above it. */
export function onPan(f: FoodItem, panF: number, down: Dir = Dir.NY): void {
  const panC = fToC(panF);
  for (let d = 0; d < 6; d++) f.setEnv(d, abovePanEnv(panC, (d >> 1) !== 1));
  f.setEnv(down, panContact(panF));
}

export function cook(f: FoodItem, seconds: number, dt = 1): void {
  for (let t = 0; t < seconds; t += dt) f.step(dt);
}

/** Pan-sear flipping every `flipEvery` s until the core hits pullF (or maxSeconds). Returns seconds cooked. */
export function panSear(f: FoodItem, opts: { panF: number; pullF?: number; seconds?: number; flipEvery?: number; firstSide?: Dir }): number {
  let side = opts.firstSide ?? Dir.NY;
  const max = opts.seconds ?? 3600;
  let t = 0;
  while (t < max && (opts.pullF === undefined || f.coreF < opts.pullF)) {
    onPan(f, opts.panF, side);
    f.step(1);
    t++;
    if (opts.flipEvery && t % opts.flipEvery === 0) side = side === Dir.NY ? Dir.PY : Dir.NY;
  }
  return t;
}

export function roast(f: FoodItem, ovenF: number, seconds: number, convection = false): void {
  f.setAllEnv(ovenEnv(fToC(ovenF), convection ? H.convectionOven : H.oven));
  cook(f, seconds);
}

export function rest(f: FoodItem, seconds: number): void {
  f.rest();
  cook(f, seconds);
}
