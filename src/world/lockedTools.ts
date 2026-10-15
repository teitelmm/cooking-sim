import * as THREE from 'three';

/**
 * Hand tools that are not physics-driven while held: grab one and it locks into its working pose and
 * follows the cursor exactly (no spring lag, no wobble, passes through things instead of shoving them).
 * The hotspot — the business end — sits under the cursor. Let go and it becomes a normal object again
 * and settles where you left it.
 */
export interface LockSpec {
  /** Tool-local point that tracks the cursor. */
  hotspot: THREE.Vector3;
  /** Working orientation (world). */
  pose: THREE.Quaternion;
  /** How far above the surface below the hotspot may go (m); the knife's edge may touch the board. */
  clearance: number;
}

const Z = new THREE.Vector3(0, 0, 1);
const tipDown = (angle: number) => new THREE.Quaternion().setFromAxisAngle(Z, -angle);

/** Knife: blade vertical, edge down, blade running front-to-back — you see it edge-on, as the cut line. */
export const KNIFE_POSE = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

export const LOCKED_TOOLS: Record<string, LockSpec> = {
  'chef-knife': { hotspot: new THREE.Vector3(0.1, 0, 0.0225), pose: KNIFE_POSE, clearance: 0.0005 },
  tongs: { hotspot: new THREE.Vector3(0.12, 0.005, 0), pose: tipDown(0.5), clearance: 0.004 },
  spatula: { hotspot: new THREE.Vector3(0.06, 0.002, 0), pose: tipDown(0.08), clearance: 0.002 },
  'probe-thermometer': { hotspot: new THREE.Vector3(0.13, 0.0125, 0), pose: tipDown(Math.PI / 2), clearance: 0.002 },
  'wooden-spoon': { hotspot: new THREE.Vector3(0.105, 0.006, 0), pose: tipDown(1.2), clearance: 0.004 },
  whisk: { hotspot: new THREE.Vector3(0.124, 0.03, 0), pose: tipDown(1.25), clearance: 0.004 },
};

export function lockSpec(itemId: string | undefined): LockSpec | null {
  return (itemId && LOCKED_TOOLS[itemId]) || null;
}
