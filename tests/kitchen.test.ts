import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/engine/physics';
import { KITCHEN, type Block } from '../src/world/kitchenLayout';
import { buildKitchenColliders } from '../src/world/kitchenBuilder';
import { createItemBody } from '../src/world/itemFactory';
import { ITEMS, itemDef, type ItemDef } from '../src/data/items';
import { partsBounds } from '../src/world/shapes';
import { spawnPosition } from '../src/world/spawners';

beforeAll(async () => {
  await initPhysics();
});

/** Items that legitimately roll on flat surfaces (round produce, eggs): only checked for staying on. */
const ROLLERS = new Set(['rolling-pin', 'whisk', 'vanilla', 'yeast-jar', 'baking-powder', 'egg', 'onion', 'bell-pepper', 'garlic', 'potato', 'carrot', 'oil-bottle', 'mushroom']);
const surfaces = KITCHEN.blocks.filter((b) => b.surface);

function fits(def: ItemDef, s: Block): boolean {
  if (s.surface === 'cookware' && def.category !== 'cookware' && def.category !== 'dish') return false;
  const b = partsBounds(def.parts);
  const margin = 0.01;
  return b.max.x - b.min.x + margin < s.size[0] && b.max.z - b.min.z + margin < s.size[2];
}

/** True if the item's bounding box, resting at (x, top, z), overlaps no static geometry. */
function spaceFree(physics: PhysicsWorld, def: ItemDef, x: number, top: number, z: number): boolean {
  const b = partsBounds(def.parts);
  const he = { x: (b.max.x - b.min.x) / 2, y: (b.max.y - b.min.y) / 2, z: (b.max.z - b.min.z) / 2 };
  const c = { x: x + (b.max.x + b.min.x) / 2, y: top + 0.004 + he.y, z: z + (b.max.z + b.min.z) / 2 };
  return physics.world.intersectionWithShape(c, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cuboid(he.x, he.y - 0.002, he.z)) === null;
}

/** Grates are many bars: treat the span of bars with the same tag/height as one surface. */
function mergedSurfaces(): Block[] {
  const out: Block[] = [];
  const grates = new Map<string, Block[]>();
  for (const s of surfaces) {
    if (s.tag !== 'grate') {
      out.push(s);
      continue;
    }
    // Group bars by height and rough location (each grate is one cluster).
    const key = `${s.pos[1].toFixed(3)}|${Math.round(s.pos[0] / 0.3)}|${Math.round(s.pos[2] / 0.3)}`;
    const list = grates.get(key) ?? [];
    list.push(s);
    grates.set(key, list);
  }
  for (const list of grates.values()) {
    const x0 = Math.min(...list.map((b) => b.pos[0] - b.size[0] / 2));
    const x1 = Math.max(...list.map((b) => b.pos[0] + b.size[0] / 2));
    const z0 = Math.min(...list.map((b) => b.pos[2] - b.size[2] / 2));
    const z1 = Math.max(...list.map((b) => b.pos[2] + b.size[2] / 2));
    const s = list[0];
    out.push({ ...s, pos: [(x0 + x1) / 2, s.pos[1], (z0 + z1) / 2], size: [x1 - x0, s.size[1], z1 - z0] });
  }
  return out;
}

describe('kitchen layout', () => {
  it('spans 4+ screen widths and covers every station', () => {
    expect(KITCHEN.width).toBeGreaterThan(8);
    const ids = KITCHEN.stations.map((s) => s.id);
    for (const id of ['fridge', 'prep', 'range', 'grill', 'fryer', 'air-fryer', 'sous-vide', 'sink', 'plating']) expect(ids).toContain(id);
    const kinds = new Set(KITCHEN.zones.map((z) => z.kind));
    for (const k of ['burner', 'grill', 'griddle', 'oven', 'fryer', 'airFryer', 'sousVide', 'sink']) expect(kinds).toContain(k);
  });

  it('every spawner and start item references a real item', () => {
    for (const s of KITCHEN.spawners) expect(() => itemDef(s.itemId)).not.toThrow();
    for (const s of KITCHEN.startItems) expect(() => itemDef(s.itemId)).not.toThrow();
  });

  it('every item rests stably on every support surface it fits', () => {
    const tested = { pairs: 0 };
    const failures: string[] = [];
    const merged = mergedSurfaces();
    for (const def of ITEMS) {
      const physics = new PhysicsWorld();
      buildKitchenColliders(physics, KITCHEN);
      physics.step(); // populate the broad-phase so scene queries see the static colliders
      const b = partsBounds(def.parts);
      const placed: { s: Block; body: RAPIER.RigidBody; x: number; z: number; top: number }[] = [];
      for (const s of merged) {
        if (!fits(def, s)) continue;
        const top = s.pos[1] + s.size[1] / 2;
        const [x, z] = [s.pos[0], s.pos[2]];
        if (!spaceFree(physics, def, x, top, z)) continue;
        const body = createItemBody(physics, def, { x, y: top - b.min.y + 0.01, z }).body;
        placed.push({ s, body, x, z, top });
      }
      for (let i = 0; i < 120 * 4; i++) physics.step();
      for (const p of placed) {
        tested.pairs++;
        const t = p.body.translation();
        const v = p.body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        const where = `${def.id} on ${p.s.tag ?? p.s.surface}@${p.x.toFixed(2)},${p.top.toFixed(2)}`;
        const bottom = t.y + b.min.y - 0.02; // rotated items may sit lower than their AABB min — allow 2 cm
        if (bottom < p.top - 0.05) failures.push(`${where}: fell (y=${t.y.toFixed(3)})`);
        if (!p.body.isSleeping() && speed > (ROLLERS.has(def.id) ? 0.1 : 0.01)) failures.push(`${where}: still moving ${speed.toFixed(3)} m/s`);
        const drift = Math.hypot(t.x - p.x, t.z - p.z);
        if (!ROLLERS.has(def.id) && p.s.surface !== 'enclosed' && drift > 0.05) failures.push(`${where}: drifted ${drift.toFixed(3)} m`);
      }
    }
    expect(failures).toEqual([]);
    expect(tested.pairs).toBeGreaterThan(300);
  });

  it('start items and spawned items settle in place', () => {
    const physics = new PhysicsWorld();
    buildKitchenColliders(physics, KITCHEN);
    const bodies = KITCHEN.startItems.map((s) => ({ s, body: createItemBody(physics, itemDef(s.itemId), { x: s.pos[0], y: s.pos[1], z: s.pos[2] }) }));
    const spawned = KITCHEN.spawners.map((slot) => ({ slot, body: createItemBody(physics, itemDef(slot.itemId), spawnPosition(slot)) }));
    for (let i = 0; i < 120 * 4; i++) physics.step();
    for (const { s, body } of bodies) {
      const t = body.body.translation();
      expect(Math.hypot(t.x - s.pos[0], t.z - s.pos[2]), s.itemId).toBeLessThan(0.08);
      expect(t.y, s.itemId).toBeGreaterThan(s.pos[1] - 0.1);
    }
    for (const { slot, body } of spawned) {
      const t = body.body.translation();
      expect(t.y, slot.itemId).toBeGreaterThan(slot.pos[1] - 0.06);
    }
  });
});
