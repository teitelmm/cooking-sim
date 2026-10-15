import * as THREE from 'three';
import type { Game } from '../game';
import type { FoodItem, Plane } from '../sim/food';
import { insideFood } from '../sim/split';
import { assistCutPlane } from '../sim/cutting';

/** Blade edge sample points in the knife's local frame (the edge is local +z; the blade runs along +x). */
const EDGE = Array.from({ length: 19 }, (_, i) => new THREE.Vector3(0.01 + i * 0.01, 0, 0.0225));

interface Target {
  food: number;
  /** Snapped cut plane in the food item's body frame. */
  plane: Plane;
  /** World-space food center height and top. */
  centerY: number;
  topY: number;
}

/**
 * The chef's knife, made easy. Picking it up locks it blade-down (see lockedTools). Hover it over food and
 * a guide shows exactly where it will cut — squared up to the food, and for vegetables snapped to an even
 * slice grid. Move down through the food and it's cut, instantly: no sawing, no resistance. Lift it out
 * and it's ready for the next slice.
 */
export class KnifeSystem {
  knife: number | null = null;
  cuts = 0;
  /** What the blade is over right now (null if nothing). */
  target: Target | null = null;
  /** Must lift the edge out of the food before the next chop. */
  private armed = true;
  private readonly guide: THREE.Mesh;

  constructor(private readonly game: Game) {
    game.grab.onGrab.push((h) => {
      if (game.items.get(h)?.def.id === 'chef-knife') {
        this.knife = h;
        this.armed = true;
      }
    });
    game.events.on('release', (e) => {
      if (e.body === this.knife) {
        this.knife = null;
        this.target = null;
      }
    });
    // A thin slab on the cut plane, drawn over the food so the cut line always shows.
    this.guide = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.guide.renderOrder = 4;
    this.guide.visible = false;
    game.scene.add(this.guide);
  }

  private foodFrame(h: number) {
    const e = this.game.physics.entries.get(h);
    if (!e) return null;
    const r = e.body.rotation();
    const t = e.body.translation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const c = (e.data.foodCenter as [number, number, number]) ?? [0, 0, 0];
    return { q, inv: q.clone().invert(), t: new THREE.Vector3(t.x, t.y, t.z), c };
  }

  /** World point → food grid frame. */
  private toFood(f: NonNullable<ReturnType<KnifeSystem['foodFrame']>>, w: THREE.Vector3): THREE.Vector3 {
    return w.clone().sub(f.t).applyQuaternion(f.inv).sub(new THREE.Vector3(...f.c));
  }

  /** Call every frame. */
  frame(): void {
    const g = this.game;
    this.target = null;
    if (this.knife === null || g.grab.heldHandle !== this.knife) {
      this.guide.visible = false;
      return;
    }
    const ke = g.physics.entries.get(this.knife);
    if (!ke) return;
    const kr = ke.body.rotation();
    const kt = ke.body.translation();
    const kq = new THREE.Quaternion(kr.x, kr.y, kr.z, kr.w);
    const kp = new THREE.Vector3(kt.x, kt.y, kt.z);
    const edge = EDGE.map((p) => p.clone().applyQuaternion(kq).add(kp));
    const normalW = new THREE.Vector3(0, 1, 0).applyQuaternion(kq);
    const edgeY = Math.min(...edge.map((p) => p.y));

    // Which food is under the blade? The edge, dropped to the food's middle height, must pass through it.
    let best: { h: number; food: FoodItem; f: NonNullable<ReturnType<KnifeSystem['foodFrame']>>; at: THREE.Vector3; centerY: number; topY: number } | null = null;
    for (const [h, food] of g.sim.foods) {
      const f = this.foodFrame(h);
      if (!f) continue;
      const cw = new THREE.Vector3(...f.c).applyQuaternion(f.q).add(f.t);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(f.q).elements;
      const halfY = (Math.abs(m[1]) * food.size[0] + Math.abs(m[5]) * food.size[1] + Math.abs(m[9]) * food.size[2]) / 2;
      const topY = cw.y + halfY;
      if (edgeY > topY + 0.12) continue; // too high above it to be aiming at it
      const at = edge.find((p) => {
        const l = this.toFood(f, new THREE.Vector3(p.x, cw.y, p.z));
        return insideFood(food, [l.x, l.y, l.z]);
      });
      if (!at) continue;
      if (!best || topY > best.topY) best = { h, food, f, at: new THREE.Vector3(at.x, cw.y, at.z), centerY: cw.y, topY };
    }
    if (!best) {
      this.armed = true;
      this.guide.visible = false;
      return;
    }
    // Snapped plane (food grid frame) → body frame for cutFood.
    const nL = normalW.clone().applyQuaternion(best.f.inv);
    const pL = this.toFood(best.f, best.at);
    const assisted = assistCutPlane(best.food, { n: [nL.x, nL.y, nL.z], d: nL.dot(pL) });
    if (!assisted) {
      this.guide.visible = false;
      return;
    }
    const c = best.f.c;
    const n = assisted.n;
    const plane: Plane = { n, d: assisted.d + n[0] * c[0] + n[1] * c[1] + n[2] * c[2] };
    this.target = { food: best.h, plane, centerY: best.centerY, topY: best.topY };
    this.showGuide(best.food, best.f, assisted);

    // Lifted clear of the top: ready for another chop.
    if (edgeY > best.topY + 0.004) this.armed = true;
    // Down through the middle: cut.
    if (this.armed && edgeY < best.centerY) {
      this.armed = false;
      const pieces = g.cutFood(best.h, plane, 0.003);
      if (pieces.length) this.cuts++;
      this.guide.visible = false;
    }
  }

  /** A thin glowing slab on the cut plane, covering the food's cross-section. */
  private showGuide(food: FoodItem, f: NonNullable<ReturnType<KnifeSystem['foodFrame']>>, p: Plane): void {
    const n = new THREE.Vector3(...p.n).normalize();
    // Plane point nearest the food center, and the food's extent across the plane.
    const center = n.clone().multiplyScalar(p.d);
    const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const a = u.clone().sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const b = n.clone().cross(a);
    const ext = (v: THREE.Vector3) => Math.abs(v.x) * food.size[0] + Math.abs(v.y) * food.size[1] + Math.abs(v.z) * food.size[2];
    const local = new THREE.Matrix4().makeBasis(b, a, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(local);
    const world = center.add(new THREE.Vector3(...f.c)).applyQuaternion(f.q).add(f.t);
    this.guide.position.copy(world);
    this.guide.quaternion.copy(f.q).multiply(q);
    this.guide.scale.set(ext(b) * 1.04, ext(a) * 1.04, 0.0025);
    this.guide.visible = true;
  }
}
