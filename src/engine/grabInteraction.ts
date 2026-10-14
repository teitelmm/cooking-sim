import * as THREE from 'three';
import { GrabController } from './grab';
import type { Interaction, Picker, PointerInfo } from './input';
import type { PhysicsWorld } from './physics';
import type { EventBus } from './events';
import { spawnerOf } from '../world/spawners';
import type { SpawnerSlot } from '../world/kitchenLayout';

/** Lift applied once the item starts moving, so it clears the surface it was resting on. */
export const LIFT_HEIGHT = 0.08;
/** A/D tilt speed while held, rad/s. */
export const ROLL_RATE = 2.2;
/** Pointer travel (m) before lift kicks in — a press-and-hold without moving doesn't hop the item. */
const LIFT_AFTER = 0.01;

export interface GrabOptions {
  /** Allowed hold depth (world z) range. */
  minZ: number;
  maxZ: number;
  minY: number;
}

/** Find the physics body handle for a picked mesh (walks up to the item's root group). */
export function bodyHandleOf(obj: THREE.Object3D | null): number | undefined {
  for (let o = obj; o; o = o.parent) {
    if (o.userData.bodyHandle !== undefined) return o.userData.bodyHandle as number;
  }
  return undefined;
}

/**
 * Bridges pointer input to the GrabController: picks dynamic items by raycast and drags them on a
 * vertical plane at the depth where they were grabbed (adjustable with alt/ctrl+wheel or W/S).
 */
export class GrabInteraction {
  readonly grab = new GrabController();
  readonly pickables: THREE.Object3D[] = [];
  /** Supply displays; pressing one calls `spawn` and hands you the new item. */
  readonly spawnerDisplays: THREE.Object3D[] = [];
  spawn: ((slot: SpawnerSlot) => number) | null = null;
  heldHandle: number | null = null;
  private depth = 0;
  private startPoint = new THREE.Vector3();
  private lifted = false;
  private raycaster = new THREE.Raycaster();
  private lastInfo: PointerInfo | null = null;
  /** Hooks that may adjust a just-started grab (e.g. knife snaps blade-down). */
  readonly onGrab: ((handle: number, grab: GrabController) => void)[] = [];
  /** A held = +1 (counterclockwise on screen), D = −1. */
  private rollDir = 0;
  private readonly rollKeys = new Set<string>();
  /** Axis pointing from the scene toward the viewer (set by the game from the camera). */
  viewAxis: () => THREE.Vector3 = () => new THREE.Vector3(0, 0, 1);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus,
    public opts: GrabOptions,
  ) {
    physics.preStep.push((dt) => this.grab.step(dt));
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'd') {
        this.rollKeys.add(k);
        this.updateRoll();
      }
      if (this.heldHandle === null) return;
      if (k === 'w') this.push(-0.04);
      if (k === 's') this.push(0.04);
    });
    window.addEventListener('keyup', (e) => {
      this.rollKeys.delete(e.key.toLowerCase());
      this.updateRoll();
    });
    window.addEventListener('blur', () => {
      this.rollKeys.clear();
      this.updateRoll();
    });
  }

  private updateRoll(): void {
    this.rollDir = (this.rollKeys.has('a') ? 1 : 0) - (this.rollKeys.has('d') ? 1 : 0);
  }

  /** Per frame: while A/D is held, tilt the held item about the view axis (as seen on screen). */
  frame(dt: number): void {
    if (this.heldHandle === null || !this.rollDir) return;
    this.grab.rotate(this.viewAxis(), this.rollDir * ROLL_RATE * dt);
  }

  readonly picker: Picker = (p) => {
    this.raycaster.ray.copy(p.ray);
    const hits = this.raycaster.intersectObjects([...this.pickables, ...this.spawnerDisplays], true);
    for (const h of hits) {
      const slot = spawnerOf(h.object);
      if (slot) {
        if (!this.spawn) continue;
        return this.start(this.spawn(slot), h.point, p);
      }
      const handle = bodyHandleOf(h.object);
      if (handle === undefined) continue;
      const entry = this.physics.entries.get(handle);
      if (!entry || !entry.body.isDynamic()) continue;
      return this.start(handle, h.point, p);
    }
    return null;
  };

  /** Start holding a body at a world point (also used by spawners to hand you a fresh item). */
  start(handle: number, point: THREE.Vector3, p: PointerInfo): Interaction {
    const entry = this.physics.entries.get(handle)!;
    this.heldHandle = handle;
    this.depth = THREE.MathUtils.clamp(point.z, this.opts.minZ, this.opts.maxZ);
    this.startPoint.copy(point);
    this.lifted = false;
    this.lastInfo = p;
    this.grab.begin(entry.body, point);
    for (const f of this.onGrab) f(handle, this.grab);
    this.events.emit('grab', { body: handle });
    return {
      move: (pi) => this.move(pi),
      end: () => this.end(),
      rotate: (dYaw, dPitch) => {
        if (dYaw) this.grab.rotate({ x: 0, y: 1, z: 0 }, dYaw);
        if (dPitch) this.grab.rotate({ x: 1, y: 0, z: 0 }, dPitch);
      },
      push: (dz) => this.push(dz),
    };
  }

  private targetFor(p: PointerInfo): THREE.Vector3 | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.depth);
    const hit = p.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    if (!this.lifted && hit.distanceTo(this.startPoint) > LIFT_AFTER) this.lifted = true;
    if (this.lifted) hit.y += LIFT_HEIGHT;
    hit.y = Math.max(hit.y, this.opts.minY);
    return hit;
  }

  move(p: PointerInfo): void {
    this.lastInfo = p;
    const t = this.targetFor(p);
    if (t) this.grab.setTarget(t);
  }

  /** Re-aim using the last pointer ray (call after the camera moves under a stationary finger). */
  refresh(ray?: THREE.Ray): void {
    if (this.heldHandle === null || !this.lastInfo) return;
    if (ray) this.lastInfo = { ...this.lastInfo, ray };
    this.move(this.lastInfo);
  }

  push(dz: number): void {
    this.depth = THREE.MathUtils.clamp(this.depth + dz, this.opts.minZ, this.opts.maxZ);
    this.refresh();
  }

  get lastPointer(): PointerInfo | null {
    return this.heldHandle === null ? null : this.lastInfo;
  }

  end(): void {
    const handle = this.heldHandle;
    this.heldHandle = null;
    const speed = this.grab.end();
    if (handle !== null) this.events.emit('release', { body: handle, speed });
  }
}
