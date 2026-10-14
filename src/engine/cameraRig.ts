/**
 * Translation-only camera rig. The camera always looks forward (−Z, with a fixed downward pitch);
 * dragging slides it around the kitchen. There is deliberately no yaw/roll state, so the view can never rotate.
 * Pure math (no Three.js) so it is unit-testable.
 */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** +1: drag left → camera moves left (the view follows your finger's direction). Flip to −1 for "grab the world". */
export const PAN_SIGN = 1;
/** Inertia decay rate (1/s). exp(−5/60) ≈ 0.92 per 60 Hz frame. */
export const INERTIA_DECAY = 5;
/** Fixed downward pitch (radians) so the counter top is in view. */
export const PITCH = -0.45;
/** Below this speed (m/s) inertia stops. */
const REST_SPEED = 0.005;
/** Focus glide stiffness (critically damped). */
const FOCUS_OMEGA = 6;

export class CameraRig {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  readonly pitch = PITCH;
  dragging = false;
  private pendX = 0;
  private pendY = 0;
  private focus: { x: number; y: number } | null = null;

  constructor(
    public bounds: Bounds,
    start: { x: number; y: number; z: number },
  ) {
    this.x = start.x;
    this.y = start.y;
    this.z = start.z;
    this.clamp();
  }

  beginDrag(): void {
    this.dragging = true;
    this.focus = null;
    this.vx = this.vy = 0;
    this.pendX = this.pendY = 0;
  }

  endDrag(): void {
    this.dragging = false;
  }

  /** Move by a world-space delta (already converted from pixels). Applied immediately. */
  panBy(dx: number, dy: number): void {
    const px = this.x;
    const py = this.y;
    this.x += PAN_SIGN * dx;
    this.y += PAN_SIGN * dy;
    this.clamp();
    this.pendX += this.x - px;
    this.pendY += this.y - py;
  }

  /** Forward/back dolly, clamped to bounds.minZ..maxZ. */
  dolly(dz: number): void {
    this.z += dz;
    this.clamp();
  }

  /** Glide (critically damped) so `point` is centered horizontally/vertically. */
  focusOn(point: { x: number; y: number }): void {
    this.focus = { x: point.x, y: point.y };
    this.vx = this.vy = 0;
  }

  get moving(): boolean {
    return this.dragging || this.focus !== null || Math.hypot(this.vx, this.vy) > REST_SPEED;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    if (this.dragging) {
      // Smoothed velocity estimate from what the finger did this frame; used for inertia on release.
      const ix = this.pendX / dt;
      const iy = this.pendY / dt;
      this.vx += (ix - this.vx) * 0.5;
      this.vy += (iy - this.vy) * 0.5;
      this.pendX = this.pendY = 0;
      return;
    }
    if (this.focus) {
      const k = 1 - Math.exp(-FOCUS_OMEGA * dt);
      this.x += (this.focus.x - this.x) * k;
      this.y += (this.focus.y - this.y) * k;
      this.clamp();
      if (Math.hypot(this.focus.x - this.x, this.focus.y - this.y) < 1e-3) this.focus = null;
      return;
    }
    if (Math.hypot(this.vx, this.vy) < REST_SPEED) {
      this.vx = this.vy = 0;
      return;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const decay = Math.exp(-INERTIA_DECAY * dt);
    this.vx *= decay;
    this.vy *= decay;
    this.clamp();
  }

  private clamp(): void {
    const b = this.bounds;
    const cx = Math.min(Math.max(this.x, b.minX), b.maxX);
    const cy = Math.min(Math.max(this.y, b.minY), b.maxY);
    if (cx !== this.x) this.vx = 0;
    if (cy !== this.y) this.vy = 0;
    this.x = cx;
    this.y = cy;
    this.z = Math.min(Math.max(this.z, b.minZ), b.maxZ);
  }

  /** World units per screen pixel at a plane `depth` metres in front of the camera. */
  static worldPerPixel(fovDeg: number, viewportHeightPx: number, depth: number): number {
    return (2 * depth * Math.tan(((fovDeg * Math.PI) / 180) / 2)) / viewportHeightPx;
  }

  applyTo(camera: { position: { set(x: number, y: number, z: number): unknown }; rotation: { set(x: number, y: number, z: number): unknown } }): void {
    camera.position.set(this.x, this.y, this.z);
    camera.rotation.set(this.pitch, 0, 0);
  }
}
