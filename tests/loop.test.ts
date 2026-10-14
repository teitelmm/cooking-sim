import { describe, expect, it } from 'vitest';
import { FixedLoop, MAX_FRAME_DT, PHYSICS_DT, SIM_DT } from '../src/engine/loop';

function run(fps: number, seconds: number, timeScale = 1) {
  let physics = 0;
  let sim = 0;
  const loop = new FixedLoop({ physicsStep: () => physics++, simStep: () => sim++ });
  loop.timeScale = timeScale;
  const frames = Math.round(fps * seconds);
  for (let i = 0; i < frames; i++) loop.tick(1 / fps);
  return { physics, sim };
}

describe('FixedLoop', () => {
  it.each([60, 144, 30])('runs 120 Hz physics and 30 Hz sim at %i fps', (fps) => {
    const { physics, sim } = run(fps, 2);
    expect(physics).toBeGreaterThanOrEqual(239);
    expect(physics).toBeLessThanOrEqual(240);
    expect(sim).toBeGreaterThanOrEqual(59);
    expect(sim).toBeLessThanOrEqual(60);
  });

  it('clamps huge frames to avoid the spiral of death', () => {
    let physics = 0;
    const loop = new FixedLoop({ physicsStep: () => physics++, simStep: () => {} });
    loop.tick(5);
    expect(physics).toBe(Math.floor(MAX_FRAME_DT / PHYSICS_DT + 1e-9));
  });

  it('time scale speeds up only the sim', () => {
    const { physics, sim } = run(60, 1, 20);
    expect(physics).toBeGreaterThanOrEqual(119);
    expect(physics).toBeLessThanOrEqual(120);
    expect(sim).toBeGreaterThanOrEqual(Math.floor(20 / SIM_DT) - 1);
  });

  it('pause stops both', () => {
    let n = 0;
    const loop = new FixedLoop({ physicsStep: () => n++, simStep: () => n++ });
    loop.paused = true;
    loop.tick(0.05);
    expect(n).toBe(0);
  });
});
