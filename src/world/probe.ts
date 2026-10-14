import * as THREE from 'three';
import type { FoodItem } from '../sim/food';
import { insideFood } from '../sim/split';
import { cToF } from '../sim/units';
import { Display } from './controls';
import type { Game } from '../game';
import { buildPartGeometry } from './shapes';
import { itemDef } from '../data/items';

/** Probe tip in the probe item's own frame. */
const TIP = new THREE.Vector3(0.13, 0.0125, 0);

interface Attached {
  food: number;
  /** Tip position in the food's grid frame (m). */
  tip: [number, number, number];
  mesh: THREE.Group;
  display: Display;
}

/**
 * Instant-read probe thermometer. Hold it and push the tip into food: it seats itself toward the center
 * along the direction you stabbed and reads the temperature exactly where the tip is (off-center
 * placement reads off-center temperatures, like the real thing). Tap the probe to pull it out.
 */
export class ProbeSystem {
  readonly attached: Attached[] = [];

  constructor(private readonly game: Game) {}

  /** Call every frame. */
  frame(): void {
    const g = this.game;
    const held = g.grab.heldHandle;
    if (held !== null && g.items.get(held)?.def.id === 'probe-thermometer') this.tryStab(held);
    for (const a of [...this.attached]) {
      const food = g.sim.foods.get(a.food);
      if (!food) {
        this.remove(a);
        continue;
      }
      const T = food.thermal.sample(food.thermal.T, a.tip[0], a.tip[1], a.tip[2]);
      a.display.show([`${Math.round(cToF(T))}°F`]);
      a.display.mesh.quaternion.copy(g.camera.quaternion);
      const wp = new THREE.Vector3();
      a.mesh.getWorldPosition(wp);
      a.display.mesh.position.copy(wp).add(new THREE.Vector3(0, 0.07, 0));
    }
  }

  /** Reading of the probe stuck in this food, °F (or null). */
  readF(foodHandle: number): number | null {
    const a = this.attached.find((q) => q.food === foodHandle);
    const food = this.game.sim.foods.get(foodHandle);
    if (!a || !food) return null;
    return cToF(food.thermal.sample(food.thermal.T, a.tip[0], a.tip[1], a.tip[2]));
  }

  private tryStab(probeHandle: number): void {
    const g = this.game;
    const pe = g.physics.entries.get(probeHandle)!;
    const pr = pe.body.rotation();
    const pt = pe.body.translation();
    const pq = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const tipW = TIP.clone().applyQuaternion(pq).add(new THREE.Vector3(pt.x, pt.y, pt.z));
    const dirW = new THREE.Vector3(1, 0, 0).applyQuaternion(pq);
    for (const [h, food] of g.sim.foods) {
      const e = g.physics.entries.get(h);
      if (!e) continue;
      const fr = e.body.rotation();
      const ft = e.body.translation();
      const fq = new THREE.Quaternion(fr.x, fr.y, fr.z, fr.w);
      const inv = fq.clone().invert();
      const center = (e.data.foodCenter as [number, number, number]) ?? [0, 0, 0];
      const toLocal = (w: THREE.Vector3) => w.clone().sub(new THREE.Vector3(ft.x, ft.y, ft.z)).applyQuaternion(inv).sub(new THREE.Vector3(...center));
      const tipL = toLocal(tipW);
      if (!insideFood(food, [tipL.x, tipL.y, tipL.z])) continue;
      // Seat it: slide along the stab direction to the point nearest the food's center (staying inside).
      const dirL = dirW.clone().applyQuaternion(inv);
      let depth = Math.min(Math.max(-tipL.dot(dirL), 0), 0.11);
      const seat = tipL.clone().addScaledVector(dirL, depth);
      while (depth > 0 && !insideFood(food, [seat.x, seat.y, seat.z])) {
        depth -= 0.002;
        seat.copy(tipL).addScaledVector(dirL, depth);
      }
      this.attach(h, food, seat, fq, pq, inv, center, probeHandle);
      return;
    }
  }

  private attach(
    foodHandle: number,
    _food: FoodItem,
    seatL: THREE.Vector3,
    _fq: THREE.Quaternion,
    pq: THREE.Quaternion,
    inv: THREE.Quaternion,
    center: [number, number, number],
    probeHandle: number,
  ): void {
    const g = this.game;
    g.grab.end();
    g.despawn(probeHandle);
    const def = itemDef('probe-thermometer');
    const mesh = new THREE.Group();
    for (const p of def.parts) {
      const m = new THREE.Mesh(buildPartGeometry(p), new THREE.MeshStandardMaterial({ color: p.color ?? 0xc4c8cc, roughness: 0.35, metalness: p.color ? 0.1 : 0.8 }));
      m.castShadow = true;
      mesh.add(m);
    }
    // Probe orientation relative to the food; position so its tip sits at the seat point.
    mesh.quaternion.copy(inv.clone().multiply(pq));
    const tipOffset = TIP.clone().applyQuaternion(mesh.quaternion);
    mesh.position.set(seatL.x + center[0], seatL.y + center[1], seatL.z + center[2]).sub(tipOffset);
    const item = g.items.get(foodHandle)!;
    item.view.add(mesh);
    const display = new Display(0.07, 0.03, '#ffe46a');
    g.scene.add(display.mesh);
    const a: Attached = { food: foodHandle, tip: [seatL.x, seatL.y, seatL.z], mesh, display };
    this.attached.push(a);
    g.appliances.controls.register(mesh, { kind: 'button', label: 'Probe', press: () => this.pull(a) });
  }

  /** Pull the probe out: it becomes a free item again just above the food. */
  pull(a: Attached): void {
    const g = this.game;
    const wp = new THREE.Vector3();
    a.mesh.getWorldPosition(wp);
    this.remove(a);
    g.spawn('probe-thermometer', { x: wp.x, y: wp.y + 0.06, z: wp.z + 0.05 });
  }

  private remove(a: Attached): void {
    a.mesh.parent?.remove(a.mesh);
    this.game.scene.remove(a.display.mesh);
    const i = this.attached.indexOf(a);
    if (i >= 0) this.attached.splice(i, 1);
    const ci = this.game.appliances.controls.meshes.indexOf(a.mesh);
    if (ci >= 0) this.game.appliances.controls.meshes.splice(ci, 1);
  }
}
