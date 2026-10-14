export interface GameEvents {
  impact: { bodyA: number; bodyB: number; magnitude: number; materialA?: string; materialB?: string };
  grab: { body: number };
  release: { body: number; speed: number };
  spawn: { body: number; itemId: string };
  cut: { body: number; pieces: number[] };
}

type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used to decouple physics, sim, audio and UI. */
export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<GameEvents[K]>)(payload);
  }
}
