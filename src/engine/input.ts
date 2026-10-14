import * as THREE from 'three';
import { CameraRig } from './cameraRig';

export interface PointerInfo {
  /** Normalized device coords (−1..1). */
  ndc: THREE.Vector2;
  /** Client pixel coords. */
  px: number;
  py: number;
  shift: boolean;
  /** World ray from the camera through the pointer. */
  ray: THREE.Ray;
}

/** Something under the pointer that wants the drag (a held item, a knob, a spawner…). */
export interface Interaction {
  move(p: PointerInfo): void;
  end(p: PointerInfo): void;
  /** Mouse wheel / two-finger gestures while this interaction is active. */
  rotate?(dYaw: number, dPitch: number): void;
}

export type Picker = (p: PointerInfo) => Interaction | null;

/** Distance from camera to the counter plane used to make background pans track the finger 1:1. */
export const PAN_DEPTH = 1.35;
/** Pixels of movement before a background press counts as a pan (lets taps go to UI). */
const PAN_SLOP = 3;

/**
 * Routes pointer input: pointer-down on an object → that object's Interaction; on empty space → camera pan.
 * Two pointers on empty space → pinch dolly; two pointers while holding → twist/flip the held item.
 */
export class PointerRouter {
  private pickers: Picker[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private active: Interaction | null = null;
  private panning = false;
  private pinchDist = 0;
  private pinchAngle = 0;
  private pinchMidY = 0;
  private downAt = { x: 0, y: 0 };
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly el: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly rig: CameraRig,
  ) {
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Pickers are tried in registration order; the first non-null Interaction wins. */
  addPicker(p: Picker): void {
    this.pickers.push(p);
  }

  get holding(): boolean {
    return this.active !== null;
  }

  info(clientX: number, clientY: number, shift = false): PointerInfo {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    return { ndc, px: clientX, py: clientY, shift, ray: this.raycaster.ray.clone() };
  }

  private worldPerPixel(): number {
    return CameraRig.worldPerPixel(this.camera.fov, this.el.clientHeight, PAN_DEPTH);
  }

  private onDown(e: PointerEvent): void {
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.startPinch();
      if (this.panning) {
        this.panning = false;
        this.rig.endDrag();
      }
      return;
    }
    if (this.pointers.size > 2) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const p = this.info(e.clientX, e.clientY, e.shiftKey);
    for (const pick of this.pickers) {
      const it = pick(p);
      if (it) {
        this.active = it;
        return;
      }
    }
    this.panning = true;
    this.rig.beginDrag();
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.pointers.size === 2) {
      this.updatePinch();
      return;
    }
    if (this.active) {
      this.active.move(this.info(e.clientX, e.clientY, e.shiftKey));
      return;
    }
    if (this.panning) {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < PAN_SLOP) return;
      const k = this.worldPerPixel();
      // Screen y grows downward; dragging up moves the camera up.
      this.rig.panBy(dx * k, -dy * k);
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    if (this.active) {
      this.active.end(this.info(e.clientX, e.clientY, e.shiftKey));
      this.active = null;
    }
    if (this.panning) {
      this.panning = false;
      this.rig.endDrag();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const d = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120;
    if (this.active?.rotate) {
      if (e.shiftKey) this.active.rotate(0, d * 0.35);
      else this.active.rotate(d * 0.35, 0);
      return;
    }
    this.rig.dolly(d * 0.08);
  }

  private pinchState() {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      midY: (a.y + b.y) / 2,
    };
  }

  private startPinch(): void {
    const s = this.pinchState();
    this.pinchDist = s.dist;
    this.pinchAngle = s.angle;
    this.pinchMidY = s.midY;
  }

  private updatePinch(): void {
    const s = this.pinchState();
    if (this.active?.rotate) {
      let dAng = s.angle - this.pinchAngle;
      if (dAng > Math.PI) dAng -= 2 * Math.PI;
      if (dAng < -Math.PI) dAng += 2 * Math.PI;
      // Twist = spin about view axis; two-finger vertical drag = flip about X.
      this.active.rotate(-dAng, (s.midY - this.pinchMidY) * 0.01);
    } else {
      this.rig.dolly(-(s.dist - this.pinchDist) * 0.002);
    }
    this.pinchDist = s.dist;
    this.pinchAngle = s.angle;
    this.pinchMidY = s.midY;
  }
}
