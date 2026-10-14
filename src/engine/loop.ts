export const PHYSICS_DT = 1 / 120;
export const SIM_DT = 1 / 30;
/** Largest real frame time we will simulate; longer frames (tab switch, debugger) are dropped. */
export const MAX_FRAME_DT = 0.1;

export interface LoopCallbacks {
  /** Advance physics by exactly PHYSICS_DT real seconds. */
  physicsStep(dt: number): void;
  /** Advance the cooking simulation by exactly SIM_DT game seconds. */
  simStep(dt: number): void;
}

export interface TickResult {
  physicsSteps: number;
  simSteps: number;
  /** Interpolation factor (0..1) between the last two physics states. */
  alpha: number;
}

/**
 * Two independent fixed-timestep accumulators.
 * Physics always runs in real time so dragging feels the same at any time scale;
 * the cooking sim runs in game time (real time × timeScale) so slow cooks are playable.
 */
export class FixedLoop {
  timeScale = 1;
  paused = false;
  private physicsAcc = 0;
  private simAcc = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  tick(realDt: number): TickResult {
    const dt = Math.min(Math.max(realDt, 0), MAX_FRAME_DT);
    let physicsSteps = 0;
    let simSteps = 0;
    if (!this.paused) {
      this.physicsAcc += dt;
      while (this.physicsAcc >= PHYSICS_DT) {
        this.cb.physicsStep(PHYSICS_DT);
        this.physicsAcc -= PHYSICS_DT;
        physicsSteps++;
      }
      this.simAcc += dt * this.timeScale;
      while (this.simAcc >= SIM_DT) {
        this.cb.simStep(SIM_DT);
        this.simAcc -= SIM_DT;
        simSteps++;
      }
    }
    return { physicsSteps, simSteps, alpha: this.physicsAcc / PHYSICS_DT };
  }
}
