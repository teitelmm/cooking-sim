import * as THREE from 'three';
import { RAPIER, type BodyEntry, type PhysicsWorld } from '../engine/physics';
import { MATERIALS } from '../data/materials';
import type { ItemDef } from '../data/items';
import { buildColliders, buildPartGeometry } from './shapes';

/** Soft-CCD look-ahead distance, m. */
export const SOFT_CCD = 0.03;

export interface SpawnedItem {
  entry: BodyEntry;
  view: THREE.Group;
  def: ItemDef;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function material(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  return m;
}

/** Physics body only (headless-safe). */
export function createItemBody(
  physics: PhysicsWorld,
  def: ItemDef,
  pos: { x: number; y: number; z: number },
  rot?: { x: number; y: number; z: number; w: number },
  view?: THREE.Object3D,
): BodyEntry {
  const mat = MATERIALS[def.material];
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setCcdEnabled(true)
    // Soft CCD: speculative look-ahead so items flung or pressed by the hand can't sink into thin surfaces.
    .setSoftCcdPrediction(SOFT_CCD)
    .setAngularDamping(def.angularDamping ?? 0.3)
    .setLinearDamping(def.linearDamping ?? 0.05);
  if (rot) desc.setRotation(rot);
  const colliders = buildColliders(def.parts, {
    mass: def.mass,
    friction: def.friction ?? mat.friction,
    restitution: def.restitution ?? mat.restitution,
  });
  return physics.add(desc, colliders, { tag: def.id, material: def.material, view, data: { def } });
}

/** Physics body + render group. */
export function spawnItem(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  def: ItemDef,
  pos: { x: number; y: number; z: number },
  rot?: { x: number; y: number; z: number; w: number },
): SpawnedItem {
  const mat = MATERIALS[def.material];
  const view = new THREE.Group();
  view.name = def.id;
  for (const p of def.parts) {
    const color = p.color ?? def.color ?? mat.color;
    const mesh = new THREE.Mesh(buildPartGeometry(p), material(color, mat.roughness, p.color !== undefined ? 0.2 : mat.metalness));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    view.add(mesh);
  }
  scene.add(view);
  const entry = createItemBody(physics, def, pos, rot, view);
  view.userData.bodyHandle = entry.body.handle;
  return { entry, view, def };
}

export function despawnItem(physics: PhysicsWorld, scene: THREE.Scene, handle: number): void {
  const e = physics.entries.get(handle);
  if (e?.view instanceof THREE.Object3D) scene.remove(e.view);
  physics.remove(handle);
}
