import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

type V3 = [number, number, number];

/**
 * Clip a convex point cloud by the half-space n·p ≤ d. Returns the kept vertices plus the points where
 * hull edges cross the plane — whose convex hull is exactly the clipped solid.
 */
export function clipConvex(points: V3[], n: V3, d: number): V3[] {
  const hull = new ConvexHull().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const side = (p: THREE.Vector3) => n[0] * p.x + n[1] * p.y + n[2] * p.z - d;
  const out: V3[] = [];
  const seen = new Set<string>();
  const add = (p: THREE.Vector3) => {
    const key = `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([p.x, p.y, p.z]);
  };
  for (const v of hull.vertices) if (side(v.point) <= 1e-9) add(v.point);
  for (const face of hull.faces) {
    let e = face.edge;
    do {
      const a = e.tail()!.point;
      const b = e.head().point;
      const sa = side(a);
      const sb = side(b);
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) add(a.clone().lerp(b, sa / (sa - sb)));
      e = e.next;
    } while (e !== face.edge);
  }
  return out;
}

/** Vertices of a geometry (deduplicated), in its local frame. */
export function geometryPoints(g: THREE.BufferGeometry): V3[] {
  const pos = g.attributes.position;
  const out: V3[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y, z]);
  }
  return out;
}
