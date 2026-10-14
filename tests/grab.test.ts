import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/engine/physics';
import { GrabController, GRAB } from '../src/engine/grab';
import { createItemBody, SOFT_CCD } from '../src/world/itemFactory';
import { itemDef, ITEMS } from '../src/data/items';

const COUNTER_TOP = 0.9;

function world() {
  const physics = new PhysicsWorld();
  // Deliberately thin counter (2 cm) — worst case for tunneling.
  physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(2, 0.01, 1).setTranslation(0, COUNTER_TOP - 0.01, 0)], {
    tag: 'counter',
  });
  physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(5, 0.05, 5).setTranslation(0, -0.05, 0)], { tag: 'floor' });
  return physics;
}

function boxBody(physics: PhysicsWorld, mass: number, y = COUNTER_TOP + 0.03) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y, 0).setCcdEnabled(true).setSoftCcdPrediction(SOFT_CCD);
  return physics.add(desc, [RAPIER.ColliderDesc.cuboid(0.05, 0.03, 0.05).setMass(mass)], { tag: 'box' }).body;
}

/** Seconds until the grab anchor is within `tol` of the target (or Infinity). */
function timeToReach(mass: number, tol = 0.02) {
  const physics = world();
  const body = boxBody(physics, mass);
  const grab = new GrabController();
  physics.preStep.push((dt) => grab.step(dt));
  const t = body.translation();
  grab.begin(body, t);
  grab.setTarget({ x: 0.4, y: COUNTER_TOP + 0.3, z: 0 });
  for (let i = 0; i < 120 * 5; i++) {
    physics.step();
    if (grab.anchorWorld().distanceTo(grab.target) < tol) return i / 120;
  }
  return Infinity;
}

beforeAll(async () => {
  await initPhysics();
});

describe('GrabController', () => {
  it('heavier body reaches the target slower under the same force cap', () => {
    const light = timeToReach(0.3);
    const heavy = timeToReach(3);
    const pot = timeToReach(6);
    expect(light).toBeLessThan(0.4);
    expect(heavy).toBeGreaterThan(light * 1.2);
    expect(pot).toBeGreaterThan(light * 3);
    expect(Number.isFinite(pot)).toBe(true); // a 6 kg pot is still liftable
  });

  it('cannot push a held item through the counter', () => {
    for (const mass of [0.03, 0.45, 2.7]) {
      const physics = world();
      const body = boxBody(physics, mass, COUNTER_TOP + 0.2);
      const grab = new GrabController();
      physics.preStep.push((dt) => grab.step(dt));
      grab.begin(body, body.translation());
      // Yank the target 30 cm below the counter top and hold it there for 2 s.
      grab.setTarget({ x: 0.1, y: COUNTER_TOP - 0.3, z: 0 });
      let minY = Infinity;
      for (let i = 0; i < 240; i++) {
        physics.step();
        minY = Math.min(minY, body.translation().y);
      }
      expect(minY).toBeGreaterThan(COUNTER_TOP + 0.03 - 0.01);
      const v = body.linvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.5);
    }
  });

  it('keeps momentum on release (throw) and lands', () => {
    const physics = world();
    const body = boxBody(physics, 0.45, COUNTER_TOP + 0.2);
    const grab = new GrabController();
    physics.preStep.push((dt) => grab.step(dt));
    grab.begin(body, body.translation());
    for (let i = 0; i < 30; i++) {
      grab.setTarget({ x: (i / 30) * 0.6, y: COUNTER_TOP + 0.4, z: 0 });
      physics.step();
    }
    const speed = grab.end();
    expect(speed).toBeGreaterThan(1);
    expect(speed).toBeLessThanOrEqual(GRAB.THROW_MAX);
    const vx = body.linvel().x;
    expect(vx).toBeGreaterThan(0.5);
    for (let i = 0; i < 120 * 4; i++) physics.step();
    expect(body.translation().x).toBeGreaterThan(0.6);
    const v = body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.05);
  });

  it('rotation input flips a held steak', () => {
    const physics = world();
    const steak = createItemBody(physics, itemDef('steak'), { x: 0, y: COUNTER_TOP + 0.2, z: 0 }).body;
    const grab = new GrabController();
    physics.preStep.push((dt) => grab.step(dt));
    grab.begin(steak, steak.translation());
    grab.rotate({ x: 1, y: 0, z: 0 }, Math.PI);
    for (let i = 0; i < 240; i++) physics.step();
    const r = steak.rotation();
    // Local +Y now points down: rotated ~180° about X.
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    expect(upY).toBeLessThan(-0.9);
  });

  it('item masses come from data', () => {
    const physics = world();
    for (const def of ITEMS) {
      const b = createItemBody(physics, def, { x: 0, y: 2, z: 0 }).body;
      expect(b.mass()).toBeCloseTo(def.mass, 2);
    }
  });
});
