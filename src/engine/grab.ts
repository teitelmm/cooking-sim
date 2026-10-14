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
  /** Hand speed limit, m/s: past it the hand stops pushing further along its motion (no slamming). */
  HAND_SPEED: 2.5,
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
  /** Added to the target (world): lets the anchor move on the body without the item jumping. */
  readonly targetOffset = new THREE.Vector3();
  /** Orientation the wrist tries to hold. */
  readonly targetRot = new THREE.Quaternion();
  /** Rotation input not yet applied (radians, world axes). */
  private pendingSpin = new THREE.Vector3();
  private savedAngularDamping = 0;
  /** Last applied force magnitude (N), for UI/tests. */
  lastForce = 0;
  lastTorque = 0;
  /** True when the force cap is limiting the hand this step (item feels heavy). */
  saturated = false;
  /** Bodies jointed to the held one (food in tongs): their weight and inertia load the hand too. */
  readonly attached: RAPIER.RigidBody[] = [];

  begin(body: RAPIER.RigidBody, worldPoint: { x: number; y: number; z: number }): void {
    if (this.body) this.end();
    this.body = body;
    const t = body.translation();
    const r = body.rotation();
    const inv = tmpQ.set(r.x, r.y, r.z, r.w).invert();
    this.localAnchor.set(worldPoint.x - t.x, worldPoint.y - t.y, worldPoint.z - t.z).applyQuaternion(inv);
    this.target.set(worldPoint.x, worldPoint.y, worldPoint.z);
    this.targetOffset.set(0, 0, 0);
    this.attached.length = 0;
    this.targetRot.set(r.x, r.y, r.z, r.w);
    this.pendingSpin.set(0, 0, 0);
    body.userData = { ...((body.userData as object) ?? {}), held: true };
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

  /** Move the hand's grip point on the body (local coords) without moving the item. */
  moveAnchor(local: { x: number; y: number; z: number }): void {
    if (!this.body) return;
    const before = this.anchorWorld(new THREE.Vector3());
    this.localAnchor.set(local.x, local.y, local.z);
    this.targetOffset.add(this.anchorWorld(new THREE.Vector3()).sub(before));
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
    const extra = this.attached.filter((a) => a.isValid());
    const m = b.mass() + extra.reduce((s, a) => s + a.mass(), 0);
    const anchor = this.anchorWorld(new THREE.Vector3());
    const va = b.velocityAtPoint(anchor);
    const w = GRAB.OMEGA;
    const tg = tmpV.copy(this.target).add(this.targetOffset);
    const force = new THREE.Vector3(
      m * (w * w * (tg.x - anchor.x) - 2 * GRAB.ZETA * w * va.x),
      m * (w * w * (tg.y - anchor.y) - 2 * GRAB.ZETA * w * va.y + G),
      m * (w * w * (tg.z - anchor.z) - 2 * GRAB.ZETA * w * va.z),
    );
    const speed = Math.hypot(va.x, va.y, va.z);
    if (speed > GRAB.HAND_SPEED) {
      // Remove the component that would accelerate it further (gravity support stays).
      const along = (force.x * va.x + force.y * va.y + force.z * va.z) / speed - (va.y / speed) * m * G;
      if (along > 0) force.addScaledVector(new THREE.Vector3(va.x, va.y, va.z), -along / speed);
    }
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
    // PD in angular acceleration, mapped through the full world inertia tensor so long thin items (a knife
    // has ~60× less inertia about its blade axis) get the right torque on every axis.
    const av = b.angvel();
    const ww = GRAB.WRIST_OMEGA;
    const alpha = new THREE.Vector3(ww * ww * axis.x * angle - 2 * ww * av.x, ww * ww * axis.y * angle - 2 * ww * av.y, ww * ww * axis.z * angle - 2 * ww * av.z);
    // Inertia of the held assembly (tool + clamped food) about its combined center of mass:
    // Σ I_i + m_i(|r|²E − r rᵀ) (parallel-axis theorem).
    const bodies = [b, ...extra];
    const cm = new THREE.Vector3();
    for (const x of bodies) {
      const c = x.worldCom();
      cm.addScaledVector(tmpV.set(c.x, c.y, c.z), x.mass() / m);
    }
    const Iw = { m11: 0, m12: 0, m13: 0, m21: 0, m22: 0, m23: 0, m31: 0, m32: 0, m33: 0 };
    for (const x of bodies) {
      // Read the world COM first: the inertia getter's result may live in scratch memory a later call reuses.
      const c = x.worldCom();
      const I0 = x.effectiveAngularInertia();
      const I = { m11: I0.m11, m12: I0.m12, m13: I0.m13, m21: I0.m21, m22: I0.m22, m23: I0.m23, m31: I0.m31, m32: I0.m32, m33: I0.m33 };
      const rx = c.x - cm.x;
      const ry = c.y - cm.y;
      const rz = c.z - cm.z;
      const mi = bodies.length > 1 ? x.mass() : 0;
      const r2 = rx * rx + ry * ry + rz * rz;
      Iw.m11 += I.m11 + mi * (r2 - rx * rx);
      Iw.m22 += I.m22 + mi * (r2 - ry * ry);
      Iw.m33 += I.m33 + mi * (r2 - rz * rz);
      Iw.m12 += I.m12 - mi * rx * ry;
      Iw.m21 += I.m21 - mi * rx * ry;
      Iw.m13 += I.m13 - mi * rx * rz;
      Iw.m31 += I.m31 - mi * rx * rz;
      Iw.m23 += I.m23 - mi * ry * rz;
      Iw.m32 += I.m32 - mi * ry * rz;
    }
    const torque = new THREE.Vector3(
      Iw.m11 * alpha.x + Iw.m12 * alpha.y + Iw.m13 * alpha.z,
      Iw.m21 * alpha.x + Iw.m22 * alpha.y + Iw.m23 * alpha.z,
      Iw.m31 * alpha.x + Iw.m32 * alpha.y + Iw.m33 * alpha.z,
    );
    // The wrist also resists gravity's twist about the grip (the weight hangs off the hand at the COM).
    // Capped with the rest, so a heavy pan held at the end of its handle still droops.
    const lever = cm.sub(anchor);
    torque.add(lever.cross(new THREE.Vector3(0, m * G, 0)));
    const tm = torque.length();
    if (tm > GRAB.WRIST_MAX) torque.multiplyScalar(GRAB.WRIST_MAX / tm);
    this.lastTorque = Math.min(tm, GRAB.WRIST_MAX);
    b.addTorque(torque, true);
  }

  /** Release; the item keeps its momentum (a throw), clamped to THROW_MAX. Returns release speed. */
  end(): number {
    const b = this.body;
    this.body = null;
    if (!b || !b.isValid()) return 0;
    b.userData = { ...((b.userData as object) ?? {}), held: false };
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
