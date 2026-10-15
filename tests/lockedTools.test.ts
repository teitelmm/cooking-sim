import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/engine/physics';
import { EventBus } from '../src/engine/events';
import { GrabInteraction } from '../src/engine/grabInteraction';
import { createItemBody } from '../src/world/itemFactory';
import { itemDef } from '../src/data/items';
import { lockSpec } from '../src/world/lockedTools';

beforeAll(async () => {
  await initPhysics();
});

const TOP = 0.9;

function setup(id: string) {
  const physics = new PhysicsWorld();
  physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(2, 0.02, 1).setTranslation(0, TOP - 0.02, 0)], { tag: 'counter' });
  const tool = createItemBody(physics, itemDef(id), { x: 0, y: TOP + 0.02, z: 0 }).body;
  for (let i = 0; i < 120; i++) physics.step();
  const grab = new GrabInteraction(physics, new EventBus(), { minZ: -0.3, maxZ: 0.3, minY: 0.02 });
  grab.lockSpecFor = (h) => (h === tool.handle ? lockSpec(id) : null);
  grab.floorAt = (x, y, z, exclude) => {
    const hit = physics.world.castRay(new RAPIER.Ray({ x, y: y + 0.02, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, undefined, undefined, (c) => {
      if (c.isSensor()) return false;
      const e = physics.bodyOfCollider(c.handle);
      return !(e && exclude.includes(e.body.handle));
    });
    return hit ? y + 0.02 - hit.timeOfImpact : 0;
  };
  const t = tool.translation();
  const info = { ndc: new THREE.Vector2(), px: 0, py: 0, shift: false, ray: new THREE.Ray() };
  grab.start(tool.handle, new THREE.Vector3(t.x, t.y, t.z), info);
  return { physics, grab, tool };
}

const angle = (a: { x: number; y: number; z: number; w: number }, b: THREE.Quaternion) => new THREE.Quaternion(a.x, a.y, a.z, a.w).angleTo(b);

describe('locked tools', () => {
  it('a held knife follows the cursor exactly, holds its pose and never goes below the counter', () => {
    const { physics, grab, tool } = setup('chef-knife');
    expect(grab.isLocked).toBe(true);
    const spec = lockSpec('chef-knife')!;
    grab.setTarget({ x: 0.3, y: TOP + 0.15, z: 0.05 });
    for (let i = 0; i < 120; i++) physics.step();
    expect(grab.hotspot!.distanceTo(new THREE.Vector3(0.3, TOP + 0.15, 0.05))).toBeLessThan(0.002);
    expect(angle(tool.rotation(), spec.pose)).toBeLessThan(0.01);
    // Sweep fast and stop: it doesn't overshoot or oscillate.
    let maxErr = 0;
    grab.setTarget({ x: -0.3, y: TOP + 0.1, z: 0 });
    for (let i = 0; i < 240; i++) {
      physics.step();
      if (i > 120) maxErr = Math.max(maxErr, grab.hotspot!.distanceTo(new THREE.Vector3(-0.3, TOP + 0.1, 0)));
    }
    expect(maxErr).toBeLessThan(0.002);
    // Drive it into the counter: the edge stops at the surface.
    grab.setTarget({ x: 0, y: TOP - 0.2, z: 0 });
    for (let i = 0; i < 120; i++) physics.step();
    expect(grab.hotspot!.y).toBeGreaterThan(TOP - 0.001);
  });

  it('let go, it is a normal object again and settles on the counter', () => {
    const { physics, grab, tool } = setup('tongs');
    grab.setTarget({ x: 0.1, y: TOP + 0.1, z: 0 });
    for (let i = 0; i < 60; i++) physics.step();
    grab.end();
    expect(tool.isDynamic()).toBe(true);
    expect(tool.collider(0).isSensor()).toBe(false);
    for (let i = 0; i < 240; i++) physics.step();
    expect(tool.translation().y).toBeGreaterThan(TOP - 0.005);
    expect(tool.translation().y).toBeLessThan(TOP + 0.06);
  });
});
