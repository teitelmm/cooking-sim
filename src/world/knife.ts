import * as THREE from 'three';
import type { Game } from '../game';
import type { FoodItem, Plane } from '../sim/food';
import { insideFood } from '../sim/split';
import { assistCutPlane, cutResistance } from '../sim/cutting';

/** Blade edge sample points in the knife's local frame (edge is local +z after the blade-down pose). */
const EDGE = Array.from({ length: 18 }, (_, i) => new THREE.Vector3(0.02 + i * 0.01, 0, 0.0225));
/** Held pose: blade vertical, edge down, tip pointing away from you. */
const POSE = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

interface ActiveCut {
  food: number;
  /** Cut plane in the food item's body frame. */
  plane: Plane;
  progress: number;
  height: number;
  resistance: number;
}

/**
 * The chef's knife. Picking it up turns it blade-down. Touch the edge to food and push down (or saw along
 * the blade) to cut: progress depends on how far the edge travels relative to the food's height and how
 * tough it is. The other hand holds the food still while you cut, the blade drags a little in tough meat,
 * and vegetables get a magnetic assist so slices come out even. When the cut finishes the food splits.
 */
export class KnifeSystem {
  knife: number | null = null;
  active: ActiveCut | null = null;
  private cooldown = 0;
  cuts = 0;

  constructor(private readonly game: Game) {
    game.grab.onGrab.push((h, grab) => {
      if (game.items.get(h)?.def.id !== 'chef-knife') return;
      this.knife = h;
      grab.setHoldRotation(POSE);
    });
    game.events.on('release', (e) => {
      if (e.body === this.knife) {
        this.setSensor(false);
        this.knife = null;
        this.active = null;
      }
    });
    game.physics.preStep.push((dt) => this.step(dt));
  }

  private setSensor(on: boolean): void {
    const e = this.knife !== null ? this.game.physics.entries.get(this.knife) : undefined;
    if (!e) return;
    // Collider 0 is the blade; the handle stays solid.
    e.body.collider(0).setSensor(on);
  }

  private edgeWorld(q: THREE.Quaternion, t: THREE.Vector3): THREE.Vector3[] {
    return EDGE.map((p) => p.clone().applyQuaternion(q).add(t));
  }

  private foodLocal(h: number, w: THREE.Vector3): [number, number, number] | null {
    const e = this.game.physics.entries.get(h);
    if (!e) return null;
    const r = e.body.rotation();
    const t = e.body.translation();
    const c = (e.data.foodCenter as number[]) ?? [0, 0, 0];
    const l = w.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
    return [l.x - c[0], l.y - c[1], l.z - c[2]];
  }

  step(dt: number): void {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.knife === null) return;
    const ke = g.physics.entries.get(this.knife);
    if (!ke) {
      this.knife = null;
      return;
    }
    const kr = ke.body.rotation();
    const kt = ke.body.translation();
    const kq = new THREE.Quaternion(kr.x, kr.y, kr.z, kr.w);
    const pos = new THREE.Vector3(kt.x, kt.y, kt.z);
    const edge = this.edgeWorld(kq, pos);
    const normalW = new THREE.Vector3(0, 1, 0).applyQuaternion(kq);
    const bladeDir = new THREE.Vector3(1, 0, 0).applyQuaternion(kq);
    const v = ke.body.linvel();
    const vel = new THREE.Vector3(v.x, v.y, v.z);

    if (this.active) {
      const a = this.active;
      const fe = g.physics.entries.get(a.food);
      if (!fe) {
        this.finish(false);
        return;
      }
      // The other hand holds the food down.
      fe.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      fe.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Pressing down and sawing along the blade both advance the cut.
      const push = Math.max(0, -vel.y) + Math.abs(vel.dot(bladeDir)) * 0.35;
      a.progress += (push * dt) / (a.height * a.resistance);
      // Tough meat drags on the blade.
      const drag = 6 * a.resistance * ke.body.mass();
      ke.body.addForce({ x: -v.x * drag, y: -v.y * drag, z: -v.z * drag }, true);
      // Is any of the edge still in the food? Exiting below the food's middle = cut through; above = pulled out.
      const food = g.sim.foods.get(a.food)!;
      const anyInside = edge.some((p) => {
        const l = this.foodLocal(a.food, p.clone().add(new THREE.Vector3(0, -0.006, 0)));
        return l && insideFood(food, l);
      });
      if (a.progress >= 1) return this.finish(true);
      if (!anyInside) {
        const fp = fe.body.translation();
        const edgeY = Math.min(...edge.map((p) => p.y));
        return this.finish(edgeY < fp.y && a.progress > 0.2);
      }
      return;
    }

    if (this.cooldown > 0 || Math.abs(normalW.y) > 0.4) return; // blade must be roughly vertical
    // Edge touching (or within a few mm of) food?
    for (const [h, food] of g.sim.foods) {
      if (h === this.knife) continue;
      const hits = edge.filter((p) => {
        const l = this.foodLocal(h, p.clone().add(new THREE.Vector3(0, -0.006, 0)));
        return l && insideFood(food, l);
      });
      if (!hits.length) continue;
      this.start(h, food, hits[0], normalW);
      return;
    }
  }

  private start(h: number, food: FoodItem, at: THREE.Vector3, normalW: THREE.Vector3): void {
    const g = this.game;
    const e = g.physics.entries.get(h)!;
    const r = e.body.rotation();
    const fq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const inv = fq.clone().invert();
    const t = e.body.translation();
    const c = (e.data.foodCenter as [number, number, number]) ?? [0, 0, 0];
    const nL = normalW.clone().applyQuaternion(inv);
    const pL = at.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(inv);
    // Plane in the food grid frame → assist → back to the body frame.
    const dGrid = nL.dot(pL) - (nL.x * c[0] + nL.y * c[1] + nL.z * c[2]);
    const assisted = assistCutPlane(food, { n: [nL.x, nL.y, nL.z], d: dGrid });
    if (!assisted) return;
    const n = assisted.n;
    const plane: Plane = { n, d: assisted.d + n[0] * c[0] + n[1] * c[1] + n[2] * c[2] };
    // Height of the food along world-up.
    const m = new THREE.Matrix4().makeRotationFromQuaternion(fq).elements;
    const height = Math.abs(m[1]) * food.size[0] + Math.abs(m[5]) * food.size[1] + Math.abs(m[9]) * food.size[2];
    this.active = { food: h, plane, progress: 0, height: Math.max(height, 0.01), resistance: cutResistance(food) };
    this.setSensor(true);
  }

  private finish(cut: boolean): void {
    const a = this.active;
    this.active = null;
    this.setSensor(false);
    this.cooldown = 0.25;
    if (cut && a) {
      const pieces = this.game.cutFood(a.food, a.plane, 0.003);
      if (pieces.length) this.cuts++;
    }
  }
}
