import * as THREE from 'three';
import { itemDef } from '../data/items';
import { MATERIALS } from '../data/materials';
import type { SpawnerSlot } from './kitchenLayout';
import { buildPartGeometry, partsBounds } from './shapes';

/** Max live dynamic items; the oldest un-held item is removed beyond this. */
export const MAX_LIVE_ITEMS = 160;

/** Position for spawning an item so its bottom rests at `slot.pos`. */
export function spawnPosition(slot: SpawnerSlot): { x: number; y: number; z: number } {
  const b = partsBounds(itemDef(slot.itemId).parts);
  return { x: slot.pos[0], y: slot.pos[1] - b.min.y + 0.003, z: slot.pos[2] };
}

/**
 * Infinite supply displays (fridge shelves, bins, pantry). Each slot shows a non-physical copy of its item;
 * pressing it spawns a real physics item there and puts it straight into your hand, so it reads as
 * "drag it out of the fridge".
 */
export function buildSpawnerDisplays(scene: THREE.Scene, slots: SpawnerSlot[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const slot of slots) {
    const def = itemDef(slot.itemId);
    const mat = MATERIALS[def.material];
    const g = new THREE.Group();
    for (const p of def.parts) {
      const m = new THREE.Mesh(
        buildPartGeometry(p),
        new THREE.MeshStandardMaterial({ color: p.color ?? def.color ?? mat.color, roughness: mat.roughness, metalness: mat.metalness }),
      );
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    const pos = spawnPosition(slot);
    g.position.set(pos.x, pos.y, pos.z);
    g.userData.spawner = slot;
    g.name = `spawner:${slot.itemId}`;
    scene.add(g);
    out.push(g);
  }
  return out;
}

export function spawnerOf(obj: THREE.Object3D | null): SpawnerSlot | undefined {
  for (let o = obj; o; o = o.parent) if (o.userData.spawner) return o.userData.spawner as SpawnerSlot;
  return undefined;
}
