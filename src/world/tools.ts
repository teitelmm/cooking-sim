import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { RAPIER } from '../engine/physics';
import type { Game } from '../game';
import type { FoodItem } from '../sim/food';
import type { Cookware } from '../sim/cookware';
import { cToF, ROOM_C } from '../sim/units';

/** Gripping tips of the tools, in the tool's own frame, with the reach radius. */
const TIPS: Record<string, { p: [number, number, number]; r: number }> = {
  tongs: { p: [0.12, 0.005, 0], r: 0.016 },
  // The spatula blade picks up what sits on it (slide it under, lift).
  spatula: { p: [0.06, 0.014, 0], r: 0.024 },
};

/** Natural hold angle, tip down (rad): tongs reach over a pan rim; a spatula stays nearly flat to slide under. */
const HOLD_TILT: Record<string, number> = { tongs: 0.4, spatula: 0.1 };

/** How much of the pan body's heat reaches what you grab: cast iron's handle is the pan; stainless stays cooler. */
const HANDLE_FRACTION: Record<string, number> = {
  'cast-iron-pan': 0.95,
  'sheet-pan': 1,
  'wire-rack': 1,
  'stainless-pan': 0.35,
  'saute-pan': 0.35,
  'nonstick-pan': 0.25,
  'stock-pot': 0.45,
  'fry-basket': 0.2,
  'air-fryer-basket': 0.2,
  'mixing-bowl': 0.8,
};
/** Collision groups: tools are their own membership bit, so food can be told to ignore them. */
const TOOL_BIT = 0x0002;
const TOOL_GROUPS = (TOOL_BIT << 16) | 0xffff;
const ALL_GROUPS = 0xffffffff;
const IGNORE_TOOLS = (((0xffff << 16) | (0xffff & ~TOOL_BIT)) >>> 0);

/** Above this, bare skin hurts (°C ≈ 140 °F). */
export const BURN_C = 60;

interface Grip {
  tool: number;
  food: number;
  joint: RAPIER_T.ImpulseJoint;
  /** Where the hand held the tool before it clamped food (local). */
  handAnchor: THREE.Vector3;
}

/**
 * Hand tools and hand safety.
 * - Tongs: touch food with the tips and they clamp onto it; carry it, rotate (shift+wheel / two-finger
 *   drag) to flip, release the tongs (or press Space) to let go.
 * - Spatula: slide the blade under food and it rides on it; lift and rotate to flip.
 * - Bare hands on hot cookware or hot food: "Ouch" and you drop it. The oven mitt (hanging by the range,
 *   or the M key) protects you.
 */
export class HandTools {
  grip: Grip | null = null;
  mitt = false;
  burns = 0;
  private heldFor = 0;
  /** Food you dropped from the tongs can't be re-gripped until the tip leaves it. */
  private justReleased: number | null = null;
  /** Food that ignores tool collisions until it is clear of the tool (it may overlap after a flip). */
  readonly ghosts = new Map<number, number>();
  readonly mittMesh: THREE.Group;

  constructor(private readonly game: Game) {
    game.events.on('grab', (e) => this.checkBurn(e.body));
    game.events.on('spawn', (e) => {
      if (!TIPS[e.itemId]) return;
      const b = game.physics.entries.get(e.body)!.body;
      for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(TOOL_GROUPS);
    });
    game.grab.onGrab.push((h, grab) => {
      const tilt = HOLD_TILT[game.items.get(h)?.def.id ?? ''];
      if (tilt === undefined) return;
      // Keep the heading, level it, then tip the business end down.
      const r = game.physics.entries.get(h)!.body.rotation();
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      const yaw = Math.atan2(-dir.z, dir.x);
      const flat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const q = new THREE.Quaternion().setFromAxisAngle(flat.clone().cross(new THREE.Vector3(0, 1, 0)), -tilt).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      grab.setHoldRotation(q);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && this.grip) {
        e.preventDefault();
        this.release();
      }
      if (e.key === 'm' || e.key === 'M') this.toggleMitt();
    });
    // Oven mitt hanging on a hook by the range: tap to put it on / take it off.
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.025), cloth);
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.024), cloth);
    thumb.position.set(0.07, 0.02, 0);
    thumb.rotation.z = -0.5;
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: 0xe9e1d2, roughness: 0.9 }));
    cuff.position.y = 0.09;
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8 }));
    hook.position.set(0, 0.12, -0.012);
    g.add(body, thumb, cuff, hook);
    g.position.set(2.62, 1.28, -0.33);
    game.scene.add(g);
    this.mittMesh = g;
    game.appliances.controls.register(g, { kind: 'button', label: 'Oven mitt', press: () => this.toggleMitt() });
  }

  toggleMitt(): void {
    this.mitt = !this.mitt;
    this.mittMesh.visible = !this.mitt;
    this.game.hud.setMitt(this.mitt);
  }

  /** Temperature your hand feels grabbing this body, °C (null = not hot-capable). */
  touchTemp(handle: number): number | null {
    const g = this.game;
    const it = g.items.get(handle);
    if (!it) return null;
    const pan = it.entry.data.cookware as Cookware | undefined;
    if (pan) return ROOM_C + (pan.T - ROOM_C) * (HANDLE_FRACTION[pan.id] ?? 0.5);
    const food = it.entry.data.food as FoodItem | undefined;
    if (food) return food.thermal.surfaceTemp();
    return null;
  }

  private checkBurn(handle: number): void {
    const g = this.game;
    const it = g.items.get(handle);
    if (!it || this.mitt || TIPS[it.def.id]) return;
    const T = this.touchTemp(handle);
    if (T === null || T < BURN_C) return;
    this.burns++;
    g.hud.showAlert(`Ouch! The ${it.def.name.toLowerCase()} is ${Math.round(cToF(T))}°F — use the oven mitt (M)${it.entry.data.food ? ' or tongs' : ''}`, 3, true);
    g.audio.hiss();
    g.grab.end();
  }

  release(): void {
    const gr = this.grip;
    if (!gr) return;
    this.grip = null;
    const w = this.game.physics.world;
    if (gr.joint.isValid()) w.removeImpulseJoint(gr.joint, true);
    const gc = this.game.grab.grab;
    const i = gc.attached.findIndex((b) => b.handle === gr.food);
    if (i >= 0) gc.attached.splice(i, 1);
    if (gc.body?.handle === gr.tool) gc.moveAnchor(gr.handAnchor);
    this.justReleased = gr.food;
    this.ghosts.set(gr.food, gr.tool);
  }

  private setFoodGroups(food: number, groups: number): void {
    const b = this.game.physics.entries.get(food)?.body;
    if (!b) return;
    for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(groups);
  }

  /** Restore tool collisions for released food once it no longer overlaps the tool. */
  private updateGhosts(): void {
    const g = this.game;
    for (const [food, tool] of [...this.ghosts]) {
      const fb = g.physics.entries.get(food)?.body;
      const tb = g.physics.entries.get(tool)?.body;
      if (!fb) {
        this.ghosts.delete(food);
        continue;
      }
      let overlap = false;
      if (tb) {
        for (let i = 0; i < fb.numColliders() && !overlap; i++) {
          for (let j = 0; j < tb.numColliders() && !overlap; j++) {
            const a = fb.collider(i);
            const c = tb.collider(j);
            if (a.contactCollider(c, 0.003)) overlap = true;
          }
        }
      }
      if (!overlap) {
        this.setFoodGroups(food, ALL_GROUPS);
        this.ghosts.delete(food);
      }
    }
  }

  frame(dt: number): void {
    const g = this.game;
    if (this.ghosts.size) this.updateGhosts();
    const held = g.grab.heldHandle;
    const tool = held !== null ? g.items.get(held) : undefined;
    const tip = tool ? TIPS[tool.def.id] : undefined;
    if (this.grip && (this.grip.tool !== held || !g.physics.entries.has(this.grip.food))) this.release();
    if (!tip || !tool) {
      this.heldFor = 0;
      this.justReleased = null;
      return;
    }
    this.heldFor += dt;
    if (this.grip || this.heldFor < 0.15) return;
    const b = tool.entry.body;
    const r = b.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const t = b.translation();
    const p = new THREE.Vector3(...tip.p).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    let found: number | null = null;
    g.physics.world.intersectionsWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(tip.r), (c) => {
      const e = g.physics.bodyOfCollider(c.handle);
      if (e && e.data.food && e.body.handle !== held) {
        found = e.body.handle;
        return false;
      }
      return true;
    });
    if (found === null) {
      this.justReleased = null;
      return;
    }
    if (found === this.justReleased) return;
    this.attach(held!, found);
  }

  /** Clamp a food onto the held tool with a fixed joint at their current relative pose. */
  attach(toolHandle: number, foodHandle: number): void {
    const g = this.game;
    const tb = g.physics.entries.get(toolHandle)!.body;
    const fb = g.physics.entries.get(foodHandle)!.body;
    const tq = new THREE.Quaternion().copy(tb.rotation() as THREE.Quaternion);
    const fq = new THREE.Quaternion().copy(fb.rotation() as THREE.Quaternion);
    const tt = tb.translation();
    const ft = fb.translation();
    const inv = tq.clone().invert();
    const anchor = new THREE.Vector3(ft.x - tt.x, ft.y - tt.y, ft.z - tt.z).applyQuaternion(inv);
    const frame = inv.multiply(fq);
    const data = RAPIER.JointData.fixed(anchor, frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const joint = g.physics.world.createImpulseJoint(data, tb, fb, true);
    joint.setContactsEnabled(false);
    this.ghosts.delete(foodHandle);
    this.setFoodGroups(foodHandle, IGNORE_TOOLS);
    const gc = g.grab.grab;
    this.grip = { tool: toolHandle, food: foodHandle, joint, handAnchor: gc.localAnchor.clone() };
    gc.attached.push(fb);
    // Steady a load on the end of a stick the way a cook does: the hand's effort goes in at the tips.
    const tip = TIPS[g.items.get(toolHandle)!.def.id];
    if (tip) gc.moveAnchor({ x: tip.p[0], y: tip.p[1], z: tip.p[2] });
  }
}
