/**
 * Cooking simulation root. Pure TypeScript: no Three.js or Rapier imports,
 * so it stays deterministic and testable headless. Food thermal models plug in here (Prompt 4).
 */
export class SimWorld {
  /** Game seconds elapsed (scaled by the loop's timeScale). */
  gameTime = 0;
  steps = 0;

  step(dt: number): void {
    this.gameTime += dt;
    this.steps++;
  }
}
