import * as THREE from 'three';
import type { Game } from '../game';
import { FoodItem } from '../sim/food';
import { Dir } from '../sim/foodThermal';
import { panSear, rest } from '../sim/recipes';
import { itemDef } from '../data/items';
import { buildPartGeometry, partsBounds } from '../world/shapes';
import { geometryPoints } from '../world/convex';

export interface LineupResult {
  label: string;
  doneness: string;
  peakCoreF: number;
  charBottom: number;
  juiceMl: number;
}

/**
 * Cook four steaks in the sim (rare, medium, well-done, and one left too long before flipping), place them
 * on the prep counter and cut each in half so the cross-sections face the camera.
 */
export function steakLineup(game: Game): LineupResult[] {
  const def = itemDef('steak');
  const b = partsBounds(def.parts);
  const size: [number, number, number] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  const recipes: { label: string; cook: (f: FoodItem) => void }[] = [
    { label: 'Rare', cook: (f) => (panSear(f, { panF: 450, pullF: 90, flipEvery: 60 }), rest(f, 480)) },
    { label: 'Medium', cook: (f) => (panSear(f, { panF: 450, pullF: 121, flipEvery: 60 }), rest(f, 480)) },
    { label: 'Well-done', cook: (f) => (panSear(f, { panF: 450, pullF: 157, flipEvery: 60 }), rest(f, 480)) },
    {
      label: 'Flipped too late',
      cook: (f) => {
        panSear(f, { panF: 450, seconds: 720, firstSide: Dir.NY });
        panSear(f, { panF: 450, seconds: 720, firstSide: Dir.PY });
        rest(f, 300);
      },
    },
  ];
  const hull = def.parts.flatMap((p) => geometryPoints(buildPartGeometry(p)));
  const out: LineupResult[] = [];
  const y = game.counterTop + 0.03;
  recipes.forEach((r, i) => {
    const food = new FoodItem('steak', size);
    r.cook(food);
    const x = 1.62 + i * 0.22;
    const pooled0 = game.juice.pooledMl;
    const item = game.spawnDef(def, { x, y, z: 0.04 }, undefined, { food, hull });
    // Cut across: plane z = 0 in the steak's frame. Keep the back half (cut face toward the camera).
    const pieces = game.cutFood(item.entry.body.handle, { n: [0, 0, 1], d: 0 }, 0.05);
    const front = pieces.find((h) => game.bodyPos(h).z > 0.04);
    if (front !== undefined) {
      const e = game.physics.entries.get(front)!;
      e.body.setTranslation({ x, y: y + 0.01, z: 0.24 }, true);
      e.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), true);
    }
    const s = food.summary();
    out.push({ label: r.label, doneness: s.doneness, peakCoreF: s.peakCoreF, charBottom: s.char[Dir.NY], juiceMl: game.juice.pooledMl - pooled0 });
  });
  return out;
}
