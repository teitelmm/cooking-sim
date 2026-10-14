import { FoodItem } from './food';

/**
 * Cooking simulation root. Pure TypeScript: no Three.js or Rapier imports, so it stays deterministic
 * and testable headless. The game bridge (world/heatBridge) sets each food's per-face environment
 * from where it sits physically; this class just advances everything in game time.
 */
export class SimWorld {
  /** Game seconds elapsed (scaled by the loop's timeScale). */
  gameTime = 0;
  steps = 0;
  /** Foods keyed by physics body handle. */
  readonly foods = new Map<number, FoodItem>();
  /** Systems stepped before foods each tick (appliances, cookware, liquids). */
  readonly systems: { step(dt: number): void }[] = [];

  addFood(handle: number, food: FoodItem): void {
    this.foods.set(handle, food);
  }

  removeFood(handle: number): void {
    this.foods.delete(handle);
  }

  step(dt: number): void {
    this.gameTime += dt;
    this.steps++;
    for (const s of this.systems) s.step(dt);
    for (const f of this.foods.values()) f.step(dt);
  }
}
