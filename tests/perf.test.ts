import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld } from '../src/engine/physics';
import { KITCHEN } from '../src/world/kitchenLayout';
import { buildKitchenColliders } from '../src/world/kitchenBuilder';
import { createItemBody } from '../src/world/itemFactory';
import { itemDef } from '../src/data/items';

beforeAll(async () => {
  await initPhysics();
});

function crowd(n: number) {
  const physics = new PhysicsWorld();
  buildKitchenColliders(physics, KITCHEN);
  const ids = ['carrot', 'onion', 'plate', 'mixing-bowl', 'strip-steak', 'cast-iron-pan', 'tongs', 'whisk', 'egg', 'potato', 'stainless-pan', 'wooden-spoon'];
  for (let i = 0; i < n; i++) createItemBody(physics, itemDef(ids[i % ids.length]), { x: 1.5 + (i % 24) * 0.11, y: 1.05 + Math.floor(i / 24) * 0.15, z: 0.05 });
  return physics;
}

const awake = (physics: PhysicsWorld) => [...physics.entries.values()].filter((e) => e.body.isDynamic() && !e.body.isSleeping()).length;

describe('physics performance', () => {
  it('48 items settle and fall asleep; a sleeping kitchen costs almost nothing to step', () => {
    const physics = crowd(48);
    for (let i = 0; i < 120 * 8; i++) physics.step();
    expect(awake(physics)).toBeLessThan(5);
    const t = performance.now();
    for (let i = 0; i < 240; i++) physics.step();
    const ms = (performance.now() - t) / 240;
    expect(ms).toBeLessThan(1);
  });

});
