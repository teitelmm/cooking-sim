import * as THREE from 'three';
import { GrabController } from './grab';
import type { Interaction, Picker, PointerInfo } from './input';
import { RAPIER, type PhysicsWorld } from './physics';
import type { EventBus } from './events';
import { spawnerOf } from '../world/spawners';
import type { SpawnerSlot } from '../world/kitchenLayout';
import type { LockSpec } from '../world/lockedTools';

/** Locked tools ease to the cursor this fast (1/s): crisp, but not jittery. */
const LOCK_FOLLOW = 35;
const LOCK_TURN = 25;

interface LockedHold {
  handle: number;
  spec: LockSpec;
  /** Current and wanted orientation. */
  rot: THREE.Quaternion;
  wantRot: THREE.Quaternion;
  /** Where the hotspot is, and where the cursor wants it. */
  hot: THREE.Vector3;
  target: THREE.Vector3;
}

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
  /** Which items are locked tools (set by the game). */
  lockSpecFor: (handle: number) => LockSpec | null = () => null;
  /** Height of the surface below a point, ignoring food and the given bodies (set by the game). */
  floorAt: (x: number, y: number, z: number, exclude: number[]) => number = () => -Infinity;
  /** Extra lower bounds for a locked tool's hotspot (e.g. tongs keep held food above the pan floor). */
  readonly clampHooks: ((handle: number, hotspot: THREE.Vector3) => number)[] = [];
  private locked: LockedHold | null = null;
  /**
   * For locked tools: the depth of whatever useful thing is under the cursor (food first, then pans and
   * bowls), so hovering a tool over something on screen puts it right there. Set by the game.
   */
  depthHint: (ray: THREE.Ray, held: number) => number | null = () => null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus,
    public opts: GrabOptions,
  ) {
    physics.preStep.push((dt) => {
      if (this.locked) this.stepLocked(dt);
      else this.grab.step(dt);
    });
    if (typeof window === 'undefined') return; // headless (tests)
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
    this.rotateHeld(this.viewAxis(), this.rollDir * ROLL_RATE * dt);
  }

  /** Turn the held item about a world axis (wrist for physics items, the locked pose for tools). */
  rotateHeld(axis: { x: number; y: number; z: number }, angle: number): void {
    if (this.locked) this.locked.wantRot.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis.x, axis.y, axis.z).normalize(), angle));
    else this.grab.rotate(axis, angle);
  }

  /** True while holding a locked (non-physics) tool. */
  get isLocked(): boolean {
    return this.locked !== null;
  }

  /** Where the hand is aiming: the locked tool's hotspot target, or the physics grab target. */
  get target(): THREE.Vector3 {
    return this.locked ? this.locked.target : this.grab.target;
  }

  /** Aim the hand at a world point (scripts/tests; pointer moves do the same through `move`). */
  setTarget(p: { x: number; y: number; z: number }): void {
    if (this.locked) this.locked.target.set(p.x, p.y, p.z);
    else this.grab.setTarget(p);
  }

  /** Current hotspot of the held locked tool. */
  get hotspot(): THREE.Vector3 | null {
    return this.locked ? this.locked.hot.clone() : null;
  }

  private setSensors(body: RAPIER.RigidBody, on: boolean): void {
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(on);
  }

  private startLocked(handle: number, spec: LockSpec): void {
    const b = this.physics.entries.get(handle)!.body;
    const r = b.rotation();
    const t = b.translation();
    const rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const hot = spec.hotspot.clone().applyQuaternion(rot).add(new THREE.Vector3(t.x, t.y, t.z));
    // Bring the tool up to working height above where it lay.
    const target = hot.clone();
    target.y += 0.05;
    target.z = THREE.MathUtils.clamp(target.z, this.opts.minZ, this.opts.maxZ);
    this.depth = target.z;
    this.locked = { handle, spec, rot, wantRot: spec.pose.clone(), hot, target };
    b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.setSensors(b, true);
  }

  private stepLocked(dt: number): void {
    const L = this.locked!;
    const e = this.physics.entries.get(L.handle);
    if (!e) {
      this.locked = null;
      return;
    }
    const tgt = L.target.clone();
    // Never below the surface under it (food doesn't count: the knife goes into food, not the board).
    const from = Math.max(L.hot.y, tgt.y) + 0.02;
    let minY = Math.max(this.opts.minY, this.floorAt(tgt.x, from, tgt.z, [L.handle]) + L.spec.clearance);
    for (const h of this.clampHooks) minY = Math.max(minY, h(L.handle, tgt));
    tgt.y = Math.max(tgt.y, minY);
    L.hot.lerp(tgt, 1 - Math.exp(-dt * LOCK_FOLLOW));
    L.rot.slerp(L.wantRot, 1 - Math.exp(-dt * LOCK_TURN));
    const pos = L.hot.clone().sub(L.spec.hotspot.clone().applyQuaternion(L.rot));
    e.body.setNextKinematicTranslation(pos);
    e.body.setNextKinematicRotation(L.rot);
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
    const spec = this.lockSpecFor(handle);
    if (spec) this.startLocked(handle, spec);
    else this.grab.begin(entry.body, point);
    for (const f of this.onGrab) f(handle, this.grab);
    this.events.emit('grab', { body: handle });
    return {
      move: (pi) => this.move(pi),
      end: () => this.end(),
      rotate: (dYaw, dPitch) => {
        if (dYaw) this.rotateHeld({ x: 0, y: 1, z: 0 }, dYaw);
        if (dPitch) this.rotateHeld({ x: 1, y: 0, z: 0 }, dPitch);
      },
      push: (dz) => this.push(dz),
    };
  }

  private targetFor(p: PointerInfo): THREE.Vector3 | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.depth);
    const hit = p.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    if (this.locked) return hit; // the tool's business end goes right where you point
    if (!this.lifted && hit.distanceTo(this.startPoint) > LIFT_AFTER) this.lifted = true;
    if (this.lifted) hit.y += LIFT_HEIGHT;
    hit.y = Math.max(hit.y, this.opts.minY);
    return hit;
  }

  move(p: PointerInfo): void {
    this.lastInfo = p;
    if (this.locked) {
      const z = this.depthHint(p.ray, this.locked.handle);
      if (z !== null) this.depth = THREE.MathUtils.clamp(z, this.opts.minZ, this.opts.maxZ);
    }
    const t = this.targetFor(p);
    if (t) this.setTarget(t);
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
    let speed = 0;
    if (this.locked) {
      // Put it down: a normal object again, settling where you left it.
      const b = this.physics.entries.get(this.locked.handle)?.body;
      this.locked = null;
      if (b && b.isValid()) {
        b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.setSensors(b, false);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else speed = this.grab.end();
    if (handle !== null) this.events.emit('release', { body: handle, speed });
  }
}
