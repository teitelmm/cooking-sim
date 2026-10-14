import type { FixedLoop } from '../engine/loop';

export const TIME_SCALES = [1, 5, 20] as const;

/** Keys 1/2/3 set the cooking-sim time scale; P toggles pause. Physics stays real-time. */
export function bindTimeScaleKeys(loop: FixedLoop): void {
  window.addEventListener('keydown', (e) => {
    const idx = ['1', '2', '3'].indexOf(e.key);
    if (idx >= 0) loop.timeScale = TIME_SCALES[idx];
    if (e.key === 'p' || e.key === 'P') loop.paused = !loop.paused;
  });
}
