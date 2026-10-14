import { describe, expect, it } from 'vitest';
import { CameraRig, type Bounds } from '../src/engine/cameraRig';

const bounds: Bounds = { minX: 0, maxX: 8, minY: 1.2, maxY: 1.8, minZ: 1.2, maxZ: 2.0 };
const make = () => new CameraRig(bounds, { x: 4, y: 1.5, z: 1.6 });

/** Simulate a drag of `dx` metres over `frames` 60 Hz frames, then release. */
function drag(rig: CameraRig, dx: number, frames = 10) {
  rig.beginDrag();
  for (let i = 0; i < frames; i++) {
    rig.panBy(dx / frames, 0);
    rig.update(1 / 60);
  }
  rig.endDrag();
}

describe('CameraRig', () => {
  it('dragging left moves the camera left', () => {
    const rig = make();
    rig.beginDrag();
    rig.panBy(-0.5, 0);
    expect(rig.x).toBeCloseTo(3.5);
  });

  it('clamps at every edge', () => {
    const rig = make();
    rig.panBy(-100, -100);
    expect(rig.x).toBe(bounds.minX);
    expect(rig.y).toBe(bounds.minY);
    rig.panBy(100, 100);
    expect(rig.x).toBe(bounds.maxX);
    expect(rig.y).toBe(bounds.maxY);
    rig.dolly(-10);
    expect(rig.z).toBe(bounds.minZ);
    rig.dolly(10);
    expect(rig.z).toBe(bounds.maxZ);
  });

  it('keeps gliding after release and decays to rest', () => {
    const rig = make();
    drag(rig, -1);
    const releasedX = rig.x;
    expect(rig.vx).toBeLessThan(0);
    rig.update(1 / 60);
    expect(rig.x).toBeLessThan(releasedX);
    for (let i = 0; i < 600; i++) rig.update(1 / 60);
    expect(rig.vx).toBe(0);
    expect(rig.moving).toBe(false);
    // Glide distance is bounded (≈ v / decay).
    expect(releasedX - rig.x).toBeLessThan(2);
  });

  it('inertia never carries the camera past bounds', () => {
    const rig = make();
    drag(rig, -3.9, 4); // fast flick toward minX
    for (let i = 0; i < 600; i++) {
      rig.update(1 / 60);
      expect(rig.x).toBeGreaterThanOrEqual(bounds.minX);
    }
    expect(rig.x).toBe(bounds.minX);
  });

  it('is frame-rate independent', () => {
    const a = make();
    const b = make();
    a.vx = b.vx = -1;
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    for (let i = 0; i < 144; i++) b.update(1 / 144);
    expect(a.x).toBeCloseTo(b.x, 2);
  });

  it('focusOn converges on the target', () => {
    const rig = make();
    rig.focusOn({ x: 6.5, y: 1.3 });
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    expect(rig.x).toBeCloseTo(6.5, 2);
    expect(rig.y).toBeCloseTo(1.3, 2);
  });

  it('never rotates: orientation is constant', () => {
    const rig = make();
    const rot: number[] = [];
    const cam = { position: { set: () => 0 }, rotation: { set: (x: number, y: number, z: number) => rot.push(x, y, z) } };
    rig.applyTo(cam);
    drag(rig, -2);
    rig.applyTo(cam);
    expect(rot.slice(0, 3)).toEqual(rot.slice(3, 6));
    expect(rot[1]).toBe(0);
    expect(rot[2]).toBe(0);
  });

  it('converts pixels to world units at a depth', () => {
    // 50° fov, 720 px tall, 1 m away → visible height 2·tan(25°) ≈ 0.933 m
    expect(CameraRig.worldPerPixel(50, 720, 1) * 720).toBeCloseTo(0.9326, 3);
  });
});
