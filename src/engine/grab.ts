import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Weighted grabbing. The pointer drives a spring-damper toward a target point; the resulting force
 * (including the share needed to hold the item up against gravity) is capped at GRIP_MAX, so heavy
 * things lag, swing and sag while light things snap to the finger. A capped "wrist" torque holds the
 * item's orientation (and turns it when the player rotates), so a heavy pan held by its handle droops.
 * Only forces are used — the body is never teleported — so collisions still stop it at counters.
 */
export const GRAB = {
  /** Max hand force, N. ~7 kg static lift. */
  GRIP_MAX: 70,
  /** Max hand acceleration, m/s² (~6 g). Stops featherweight items from being slammed into surfaces. */
  ACCEL_MAX: 60,
  /** Spring natural frequency, rad/s. */
  OMEGA: 20,
  ZETA: 1.0,
  /** Max wrist torque, N·m. */
  WRIST_MAX: 3.0,
  WRIST_OMEGA: 12,
  /** Max release speed, m/s. */
  THROW_MAX: 6,
  /** Extra angular damping while held. */
  HELD_ANGULAR_DAMPING: 3,
  /** Rotation input speed limit, rad/s. */
  SPIN_RATE: 9,
};

const G = 9.81;
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export class GrabController {
  body: RAPIER.RigidBody | null = null;
  readonly localAnchor = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  /** Orientation the wrist tries to hold. */
  readonly targetRot = new THREE.Quaternion();
  /** Rotation input not yet applied (radians, world axes). */
  private pendingSpin = new THREE.Vector3();
  private savedAngularDamping = 0;
  /** Last applied force magnitude (N), for UI/tests. */
  lastForce = 0;
  /** True when the force cap is limiting the hand this step (item feels heavy). */
  saturated = false;

  begin(body: RAPIER.RigidBody, worldPoint: { x: number; y: number; z: number }): void {
    if (this.body) this.end();
    this.body = body;
    const t = body.translation();
    const r = body.rotation();
    const inv = tmpQ.set(r.x, r.y, r.z, r.w).invert();
    this.localAnchor.set(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z).applyQuaternion(inv);
    this.target.set(worldPoint.x, worldPoint.y, worldPoint.z);
    this.targetRot.set(r.x, r.y, r.z, r.w);
    this.pendingSpin.set(0, 0, 0);
    this.savedAngularDamping = body.angularDamping();
    body.setAngularDamping(this.savedAngularDamping + GRAB.HELD_ANGULAR_DAMPING);
    body.wakeUp();
  }

  setTarget(p: { x: number; y: number; z: number }): void {
    this.target.set(p.x, p.y, p.z);
  }

  /** Queue a rotation of the held item about world axes (radians). */
  rotate(axis: { x: number; y: number; z: number }, angle: number): void {
    this.pendingSpin.addScaledVector(tmpV.set(axis.x, axis.y, axis.z).normalize(), angle);
  }

  /** Set the held orientation directly (e.g. a knife snaps blade-down when picked up). */
  setHoldRotation(q: { x: number; y: number; z: number; w: number }): void {
    this.targetRot.set(q.x, q.y, q.z, q.w);
  }

  anchorWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.body!;
    const t = b.translation();
    const r = b.rotation();
    return out.copy(this.localAnchor).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)).add(tmpV.set(t.x, t.y, t.z));
  }

  /** Apply hand forces for one physics step. Call before world.step(). */
  step(dt: number): void {
    const b = this.body;
    if (!b || !b.isValid()) {
      this.body = null;
      return;
    }
    const m = b.mass();
    const anchor = this.anchorWorld(new THREE.Vector3());
    const va = b.velocityAtPoint(anchor);
    const w = GRAB.OMEGA;
    const force = new THREE.Vector3(
      m * (w * w * (this.target.x - anchor.x) - 2 * GRAB.ZETA * w * va.x),
      m * (w * w * (this.target.y - anchor.y) - 2 * GRAB.ZETA * w * va.y + G),
      m * (w * w * (this.target.z - anchor.z) - 2 * GRAB.ZETA * w * va.z),
    );
    const mag = force.length();
    const cap = Math.min(GRAB.GRIP_MAX, m * GRAB.ACCEL_MAX);
    this.saturated = mag > GRAB.GRIP_MAX;
    if (mag > cap) force.multiplyScalar(cap / mag);
    this.lastForce = Math.min(mag, cap);
    b.addForceAtPoint(force, anchor, true);

    // Feed queued rotation input into the wrist target at a bounded rate.
    const spinLen = this.pendingSpin.length();
    if (spinLen > 1e-6) {
      const step = Math.min(spinLen, GRAB.SPIN_RATE * dt);
      const axis = tmpV.copy(this.pendingSpin).divideScalar(spinLen);
      this.targetRot.premultiply(tmpQ.setFromAxisAngle(axis, step));
      this.pendingSpin.addScaledVector(axis, -step);
    }

    // Wrist: PD torque toward targetRot, scaled by inertia, capped.
    const r = b.rotation();
    const cur = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const err = this.targetRot.clone().multiply(cur.invert());
    if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
    const s = Math.sqrt(Math.max(1 - err.w * err.w, 0));
    const angle = 2 * Math.acos(Math.min(err.w, 1));
    const axis = s > 1e-6 ? new THREE.Vector3(err.x / s, err.y / s, err.z / s) : new THREE.Vector3();
    const inertia = b.principalInertia();
    const I = (inertia.x + inertia.y + inertia.z) / 3;
    const av = b.angvel();
    const ww = GRAB.WRIST_OMEGA;
    const torque = new THREE.Vector3(
      I * (ww * ww * axis.x * angle - 2 * ww * av.x),
      I * (ww * ww * axis.y * angle - 2 * ww * av.y),
      I * (ww * ww * axis.z * angle - 2 * ww * av.z),
    );
    const tm = torque.length();
    if (tm > GRAB.WRIST_MAX) torque.multiplyScalar(GRAB.WRIST_MAX / tm);
    b.addTorque(torque, true);
  }

  /** Release; the item keeps its momentum (a throw), clamped to THROW_MAX. Returns release speed. */
  end(): number {
    const b = this.body;
    this.body = null;
    if (!b || !b.isValid()) return 0;
    b.resetForces(true);
    b.resetTorques(true);
    b.setAngularDamping(this.savedAngularDamping);
    const v = b.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > GRAB.THROW_MAX) {
      const k = GRAB.THROW_MAX / speed;
      b.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
    return Math.min(speed, GRAB.THROW_MAX);
  }
}
