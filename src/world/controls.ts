import * as THREE from 'three';
import type { Interaction, Picker, PointerInfo } from '../engine/input';

/**
 * Appliance controls you operate by dragging: knobs (drag up/right to turn clockwise), buttons (tap),
 * and hinges (oven door, grill lid — drag along the swing). Picked before items so a knob behind a pan
 * handle still turns.
 */
export interface ControlSpec {
  kind: 'knob' | 'button' | 'hinge';
  label?: string;
  /** Knob/hinge value 0..1 getter/setter. */
  get?: () => number;
  set?: (v: number) => void;
  /** Button press. */
  press?: () => void;
  /** Pixels of drag for the full 0→1 range. */
  travel?: number;
  /** Hinges: which screen direction opens it (+1 = drag down opens). */
  openDir?: 1 | -1;
  /** Snap a knob to detents (e.g. 0 for "off"). */
  detents?: number[];
}

export class Controls {
  readonly meshes: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  /** Last interaction (for labels/hints). */
  active: ControlSpec | null = null;

  register(obj: THREE.Object3D, spec: ControlSpec): void {
    obj.userData.control = spec;
    this.meshes.push(obj);
  }

  readonly picker: Picker = (p) => {
    this.raycaster.ray.copy(p.ray);
    const hit = this.raycaster.intersectObjects(this.meshes, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.control) o = o.parent;
    if (!o) return null;
    const spec = o.userData.control as ControlSpec;
    return this.start(spec, p);
  };

  private start(spec: ControlSpec, p0: PointerInfo): Interaction {
    this.active = spec;
    if (spec.kind === 'button') {
      spec.press?.();
      return { move: () => {}, end: () => (this.active = null) };
    }
    const start = spec.get?.() ?? 0;
    const travel = spec.travel ?? 220;
    let moved = false;
    return {
      move: (p) => {
        const dx = p.px - p0.px;
        const dy = p.py - p0.py;
        if (Math.hypot(dx, dy) > 3) moved = true;
        const delta = spec.kind === 'hinge' ? (dy * (spec.openDir ?? 1)) / travel : (dx - dy) / travel;
        let v = Math.min(Math.max(start + delta, 0), 1);
        if (spec.detents) for (const d of spec.detents) if (Math.abs(v - d) < 0.025) v = d;
        spec.set?.(v);
      },
      end: () => {
        // A tap on a knob toggles it off / back to mid (handy on touch screens).
        if (!moved && spec.kind === 'knob') spec.set?.(start > 0.01 ? 0 : 0.5);
        if (!moved && spec.kind === 'hinge') spec.set?.(start > 0.5 ? 0 : 1);
        this.active = null;
      },
      rotate: (dYaw) => {
        if (spec.kind === 'knob') spec.set?.(Math.min(Math.max((spec.get?.() ?? 0) - dYaw * 0.1, 0), 1));
      },
    };
  }
}

/** A knob: dial cylinder with a pointer line, rotating with its value (0 → 1 = 0° → 270°). */
export function makeKnob(radius = 0.018, color = 0x1d1d1f): THREE.Group {
  const g = new THREE.Group();
  const dial = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, 0.02, 24).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 }),
  );
  const mark = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.18, radius * 0.9, 0.004), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0x222222 }));
  mark.position.set(0, radius * 0.45, 0.011);
  const spin = new THREE.Group();
  spin.add(dial, mark);
  g.add(spin);
  g.userData.spin = spin;
  return g;
}

export function setKnobAngle(knob: THREE.Group, v: number): void {
  const spin = knob.userData.spin as THREE.Group;
  // Off points straight up; full is 270° clockwise.
  spin.rotation.z = -v * Math.PI * 1.5;
}

/** Small emissive LCD-style display drawn on a canvas. */
export class Display {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private last = '';

  constructor(
    width: number,
    height: number,
    private readonly color = '#ff7a2a',
    bg = '#120c08',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = Math.round((256 * height) / width);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.bg = bg;
  }

  private bg: string;

  show(lines: string[]): void {
    const key = lines.join('|');
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas } = this;
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const n = lines.length;
    const lh = canvas.height / n;
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? this.color : '#d9c3a5';
      ctx.font = `${i === 0 ? 'bold ' : ''}${Math.floor(lh * (i === 0 ? 0.78 : 0.62))}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l, canvas.width / 2, lh * (i + 0.5));
    });
    this.tex.needsUpdate = true;
  }
}
