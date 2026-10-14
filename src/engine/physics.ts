import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_DT } from './loop';
import type { EventBus } from './events';

export { RAPIER };

let initPromise: Promise<void> | null = null;
/** Rapier's WASM is inlined (compat build) so this works in the browser and in Vitest. */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

/** Minimal interface the physics layer needs from a render object (keeps this file Three-free). */
export interface Syncable {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

export interface BodyEntry {
  body: RAPIER.RigidBody;
  view?: Syncable;
  /** Data id (item def id) for dynamic items, or a static-surface tag. */
  tag: string;
  material?: string;
  /** Free-form per-body data owned by higher layers (food state, cookware state…). */
  data: Record<string, unknown>;
}

/** Contact-force magnitude (N) above which an impact event fires. */
export const IMPACT_THRESHOLD = 4;

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly entries = new Map<number, BodyEntry>();
  private readonly queue: RAPIER.EventQueue;
  private readonly colliderBody = new Map<number, number>();

  constructor(private readonly events?: EventBus) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.world.integrationParameters.numSolverIterations = 8;
    this.queue = new RAPIER.EventQueue(true);
  }

  add(
    bodyDesc: RAPIER.RigidBodyDesc,
    colliders: RAPIER.ColliderDesc[],
    opts: { tag: string; material?: string; view?: Syncable; data?: Record<string, unknown> },
  ): BodyEntry {
    const body = this.world.createRigidBody(bodyDesc);
    for (const cd of colliders) {
      if (body.isDynamic()) {
        cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
        cd.setContactForceEventThreshold(IMPACT_THRESHOLD);
      }
      const c = this.world.createCollider(cd, body);
      this.colliderBody.set(c.handle, body.handle);
    }
    const entry: BodyEntry = { body, view: opts.view, tag: opts.tag, material: opts.material, data: opts.data ?? {} };
    this.entries.set(body.handle, entry);
    this.syncEntry(entry);
    return entry;
  }

  remove(handle: number): void {
    const entry = this.entries.get(handle);
    if (!entry) return;
    for (let i = 0; i < entry.body.numColliders(); i++) this.colliderBody.delete(entry.body.collider(i).handle);
    this.world.removeRigidBody(entry.body);
    this.entries.delete(handle);
  }

  bodyOfCollider(colliderHandle: number): BodyEntry | undefined {
    const h = this.colliderBody.get(colliderHandle);
    return h === undefined ? undefined : this.entries.get(h);
  }

  get dynamicCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.body.isDynamic()) n++;
    return n;
  }

  step(): void {
    this.world.step(this.queue);
    if (!this.events) return;
    this.queue.drainContactForceEvents((ev) => {
      const a = this.bodyOfCollider(ev.collider1());
      const b = this.bodyOfCollider(ev.collider2());
      if (!a || !b) return;
      this.events!.emit('impact', {
        bodyA: a.body.handle,
        bodyB: b.body.handle,
        magnitude: ev.maxForceMagnitude(),
        materialA: a.material,
        materialB: b.material,
      });
    });
  }

  /** Copy body transforms onto their render objects. */
  sync(): void {
    for (const e of this.entries.values()) {
      if (!e.body.isFixed()) this.syncEntry(e);
    }
  }

  private syncEntry(e: BodyEntry): void {
    if (!e.view) return;
    const t = e.body.translation();
    const r = e.body.rotation();
    e.view.position.set(t.x, t.y, t.z);
    e.view.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
