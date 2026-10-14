import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/engine/physics';
import { GrabController } from '../src/engine/grab';
import { createItemBody } from '../src/world/itemFactory';
import { itemDef } from '../src/data/items';

beforeAll(async () => {
  await initPhysics();
});

/** Tongs clamped onto a steak (fixed joint), hand moved to the tips — as HandTools does. */
function rig() {
  const physics = new PhysicsWorld();
  physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(5, 0.05, 5).setTranslation(0, -0.05, 0)], { tag: 'floor' });
  const tongs = createItemBody(physics, itemDef('tongs'), { x: 0, y: 1, z: 0 }).body;
  const steak = createItemBody(physics, itemDef('steak'), { x: 0.19, y: 0.98, z: 0 }).body;
  const grab = new GrabController();
  physics.preStep.push((dt) => grab.step(dt));
  grab.begin(tongs, { x: -0.09, y: 1, z: 0 });
  const joint = physics.world.createImpulseJoint(RAPIER.JointData.fixed({ x: 0.19, y: -0.02, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), tongs, steak, true);
  joint.setContactsEnabled(false);
  grab.attached.push(steak);
  grab.moveAnchor({ x: 0.12, y: 0.005, z: 0 });
  return { physics, tongs, steak, grab };
}

describe('tongs carrying food', () => {
  it('holds a steak steady and carries it across the counter without oscillating', () => {
    const { physics, steak, grab } = rig();
    for (let i = 0; i < 120; i++) physics.step();
    const start = grab.target.clone();
    let maxV = 0;
    for (let i = 0; i < 240; i++) {
      const t = Math.min(i / 120, 1);
      grab.setTarget(start.clone().add(new THREE.Vector3(-1 * t, 0.1 * t, 0)));
      physics.step();
    }
    for (let i = 0; i < 240; i++) {
      physics.step();
      const v = steak.linvel();
      if (i > 120) maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z));
    }
    const p = steak.translation();
    expect(maxV).toBeLessThan(0.05);
    expect(Math.abs(p.x - (0.19 - 1))).toBeLessThan(0.06);
  });
});
