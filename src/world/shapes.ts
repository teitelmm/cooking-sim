import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RAPIER } from '../engine/physics';

type Vec3 = [number, number, number];

/** One collision primitive. Used for both the Rapier collider and the default render mesh. */
export type ShapePart = (
  | { kind: 'box'; size: Vec3; round?: number }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'sphere'; radius: number; scale?: Vec3 }
  | { kind: 'capsule'; radius: number; length: number }
  /** Open tube wall (pan/pot sides). Collider = ring of boxes; mesh = lathe. */
  | { kind: 'ring'; radius: number; height: number; thickness: number; segments?: number }
  /** Convex hull of points (cut food pieces). */
  | { kind: 'hull'; points: [number, number, number][] }
) & {
  offset?: Vec3;
  /** Euler XYZ radians. */
  rot?: Vec3;
  /** Override color for this part (e.g. a handle). */
  color?: number;
  /** Mark as handle: grabbing here behaves like holding a handle (and later: heat-safe grip). */
  handle?: boolean;
};

export function partVolume(p: ShapePart): number {
  switch (p.kind) {
    case 'box':
      return p.size[0] * p.size[1] * p.size[2];
    case 'cylinder':
      return Math.PI * p.radius ** 2 * p.height;
    case 'sphere': {
      const s = p.scale ?? [1, 1, 1];
      return (4 / 3) * Math.PI * p.radius ** 3 * s[0] * s[1] * s[2];
    }
    case 'capsule':
      return Math.PI * p.radius ** 2 * p.length + (4 / 3) * Math.PI * p.radius ** 3;
    case 'ring':
      return 2 * Math.PI * p.radius * p.height * p.thickness;
    case 'hull':
      return hullVolume(p.points);
  }
}

/** Volume of the convex hull of points (tetrahedra fan from the centroid). */
export function hullVolume(points: [number, number, number][]): number {
  const g = new ConvexGeometry(points.map((q) => new THREE.Vector3(...q)));
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  for (const q of points) c.add(new THREE.Vector3(...q));
  c.divideScalar(points.length);
  let v = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).sub(c);
    b.fromBufferAttribute(pos, i + 1).sub(c);
    d.fromBufferAttribute(pos, i + 2).sub(c);
    v += Math.abs(a.dot(b.cross(d))) / 6;
  }
  g.dispose();
  return v;
}

const q = new THREE.Quaternion();
const e = new THREE.Euler();
function rotOf(rot?: Vec3): { x: number; y: number; z: number; w: number } {
  q.setFromEuler(e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Build Rapier collider descs; mass is split across parts by volume so the body totals `mass`. */
export function buildColliders(
  parts: ShapePart[],
  opts: { mass?: number; friction: number; restitution: number },
): RAPIER.ColliderDesc[] {
  const totalVol = parts.reduce((s, p) => s + partVolume(p), 0);
  const out: RAPIER.ColliderDesc[] = [];
  for (const p of parts) {
    const share = opts.mass !== undefined ? (opts.mass * partVolume(p)) / totalVol : undefined;
    const o = p.offset ?? [0, 0, 0];
    const descs: { d: RAPIER.ColliderDesc; o: Vec3; r: ReturnType<typeof rotOf> }[] = [];
    switch (p.kind) {
      case 'box': {
        const [hx, hy, hz] = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
        const r = p.round ? Math.min(p.round, hx, hy, hz) * 0.999 : 0;
        descs.push({
          d: r > 0 ? RAPIER.ColliderDesc.roundCuboid(hx - r, hy - r, hz - r, r) : RAPIER.ColliderDesc.cuboid(hx, hy, hz),
          o,
          r: rotOf(p.rot),
        });
        break;
      }
      case 'cylinder':
        descs.push({ d: RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius), o, r: rotOf(p.rot) });
        break;
      case 'sphere': {
        const s = p.scale ?? [1, 1, 1];
        if (s.every((v) => v === 1)) descs.push({ d: RAPIER.ColliderDesc.ball(p.radius), o, r: rotOf(p.rot) });
        else {
          // Ellipsoid as a convex hull of a scaled icosphere.
          const g = new THREE.IcosahedronGeometry(p.radius, 1);
          g.scale(s[0], s[1], s[2]);
          const pts = new Float32Array(g.attributes.position.array);
          descs.push({ d: RAPIER.ColliderDesc.convexHull(pts)!, o, r: rotOf(p.rot) });
        }
        break;
      }
      case 'capsule':
        descs.push({ d: RAPIER.ColliderDesc.capsule(p.length / 2, p.radius), o, r: rotOf(p.rot) });
        break;
      case 'hull': {
        const pts = new Float32Array(p.points.flat());
        const hd = RAPIER.ColliderDesc.convexHull(pts) ?? RAPIER.ColliderDesc.ball(0.005);
        descs.push({ d: hd, o, r: rotOf(p.rot) });
        break;
      }
      case 'ring': {
        const n = p.segments ?? 12;
        const segLen = 2 * (p.radius + p.thickness / 2) * Math.tan(Math.PI / n) * 1.02;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const local = new THREE.Vector3(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
          const partQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
          local.applyQuaternion(partQ);
          const segQ = partQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a));
          descs.push({
            d: RAPIER.ColliderDesc.cuboid(p.thickness / 2, p.height / 2, segLen / 2),
            o: [o[0] + local.x, o[1] + local.y, o[2] + local.z],
            r: { x: segQ.x, y: segQ.y, z: segQ.z, w: segQ.w },
          });
        }
        break;
      }
    }
    for (const { d, o: off, r } of descs) {
      d.setTranslation(off[0], off[1], off[2]).setRotation(r).setFriction(opts.friction).setRestitution(opts.restitution);
      if (share !== undefined) d.setMass(share / descs.length);
      out.push(d);
    }
  }
  return out;
}

export function buildPartGeometry(p: ShapePart): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (p.kind) {
    case 'box':
      g = p.round ? roundedBox(p.size, p.round) : new THREE.BoxGeometry(...p.size);
      break;
    case 'cylinder':
      g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32);
      break;
    case 'sphere':
      g = new THREE.SphereGeometry(p.radius, 24, 16);
      if (p.scale) g.scale(...p.scale);
      break;
    case 'capsule':
      g = new THREE.CapsuleGeometry(p.radius, p.length, 8, 16);
      break;
    case 'hull':
      g = new ConvexGeometry(p.points.map((q) => new THREE.Vector3(...q)));
      break;
    case 'ring': {
      const r0 = p.radius - p.thickness / 2;
      const r1 = p.radius + p.thickness / 2;
      const h = p.height / 2;
      const pts = [new THREE.Vector2(r0, -h), new THREE.Vector2(r1, -h), new THREE.Vector2(r1, h), new THREE.Vector2(r0, h), new THREE.Vector2(r0, -h)];
      g = new THREE.LatheGeometry(pts, 40);
      break;
    }
  }
  if (p.rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rot)));
  if (p.offset) g.translate(...p.offset);
  return g;
}

/** Box with chamfered-looking edges via a smoothed, slightly bulged subdivided cube. */
function roundedBox(size: Vec3, radius: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2], 6, 4, 6);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const inner = [0, 1, 2].map((k) => Math.max(-half[k] + radius, Math.min(half[k] - radius, v.getComponent(k))));
    const d = new THREE.Vector3(v.x - inner[0], v.y - inner[1], v.z - inner[2]);
    if (d.lengthSq() > 0) d.setLength(radius);
    pos.setXYZ(i, inner[0] + d.x, inner[1] + d.y, inner[2] + d.z);
  }
  g.computeVertexNormals();
  return g;
}

const boundsCache = new Map<ShapePart[], THREE.Box3>();
/** Local-space AABB of an item's parts (cached). */
export function partsBounds(parts: ShapePart[]): THREE.Box3 {
  let b = boundsCache.get(parts);
  if (!b) {
    b = new THREE.Box3();
    for (const p of parts) {
      const g = buildPartGeometry(p);
      g.computeBoundingBox();
      b.union(g.boundingBox!);
      g.dispose();
    }
    boundsCache.set(parts, b);
  }
  return b;
}
