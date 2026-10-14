import * as THREE from 'three';
import { FixedLoop } from './engine/loop';
import { createRenderer, bindResize } from './engine/renderer';
import { PhysicsWorld } from './engine/physics';
import { EventBus } from './engine/events';
import { SimWorld } from './sim/simWorld';
import { DebugOverlay } from './ui/debugOverlay';
import { bindTimeScaleKeys } from './ui/timeScale';
import { CameraRig } from './engine/cameraRig';
import { PointerRouter } from './engine/input';
import { GrabInteraction } from './engine/grabInteraction';
import { Audio } from './engine/audio';
import { itemDef } from './data/items';
import { FOODS } from './data/foods';
import { FoodItem } from './sim/food';
import { partsBounds, buildPartGeometry } from './world/shapes';
import type { ItemDef } from './data/items';
import { FoodView } from './render/foodView';
import { JuiceSystem } from './render/juice';
import { juiceColor } from './render/foodColor';
import { juiceReleased, splitFood } from './sim/split';
import type { Plane } from './sim/food';
import { clipConvex, geometryPoints } from './world/convex';
import { RAPIER } from './engine/physics';
import { despawnItem, spawnItem, type SpawnedItem } from './world/itemFactory';
import { KITCHEN } from './world/kitchenLayout';
import { buildKitchenColliders, buildKitchenVisuals, KitchenLights } from './world/kitchenBuilder';
import { buildSpawnerDisplays, MAX_LIVE_ITEMS, spawnPosition } from './world/spawners';

/** Fraction of the screen width at each edge where a held item auto-pans the camera. */
const EDGE_PAN_ZONE = 0.08;
const EDGE_PAN_SPEED = 1.6; // m/s

export class Game {
  readonly events = new EventBus();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  readonly renderer: THREE.WebGLRenderer;
  readonly physics = new PhysicsWorld(this.events);
  readonly sim = new SimWorld();
  readonly loop: FixedLoop;
  readonly overlay: DebugOverlay;
  readonly rig = new CameraRig(KITCHEN.camera, { x: KITCHEN.camera.start[0], y: KITCHEN.camera.start[1], z: KITCHEN.camera.start[2] });
  lights!: KitchenLights;
  /** Spawn order, for the live-item cap. */
  private spawnOrder: number[] = [];
  readonly input: PointerRouter;
  readonly grab: GrabInteraction;
  readonly audio: Audio;
  readonly items = new Map<number, SpawnedItem>();
  readonly foodViews = new Map<number, FoodView>();
  readonly juice: JuiceSystem;
  private lastGameTime = 0;
  ready = false;
  private last = performance.now();

  constructor(
    readonly container: HTMLElement,
    debugEl: HTMLElement,
  ) {
    this.renderer = createRenderer(container);
    this.overlay = new DebugOverlay(debugEl);
    this.loop = new FixedLoop({
      physicsStep: () => this.physics.step(),
      simStep: (dt) => this.sim.step(dt),
    });
    bindTimeScaleKeys(this.loop);
    bindResize(container, this.renderer, this.camera);
    this.input = new PointerRouter(this.renderer.domElement, this.camera, this.rig);
    this.grab = new GrabInteraction(this.physics, this.events, { minZ: KITCHEN.holdDepth[0], maxZ: KITCHEN.holdDepth[1], minY: 0.02 });
    this.input.addPicker(this.grab.picker);
    this.audio = new Audio(this.events);
    this.juice = new JuiceSystem(this.scene, (x, y, z) => this.floorAt(x, y, z));
    this.buildScene();
  }

  spawn(id: string, pos: { x: number; y: number; z: number }, rot?: THREE.Quaternion): SpawnedItem {
    return this.spawnDef(itemDef(id), pos, rot);
  }

  /**
   * Spawn an item from a definition. Foods get a sim FoodItem (fresh, or the given one for cut pieces)
   * and a FoodView that renders its state.
   */
  spawnDef(
    def: ItemDef,
    pos: { x: number; y: number; z: number },
    rot?: { x: number; y: number; z: number; w: number },
    piece?: { food: FoodItem; hull: [number, number, number][] },
  ): SpawnedItem {
    const item = spawnItem(this.physics, this.scene, def, pos, rot);
    const h = item.entry.body.handle;
    this.items.set(h, item);
    this.grab.pickables.push(item.view);
    this.spawnOrder.push(h);
    if (FOODS[def.id]) {
      let food: FoodItem;
      let center: [number, number, number];
      if (piece) {
        food = piece.food;
        center = [0, 0, 0];
        item.entry.data.hull = piece.hull;
      } else {
        const b = partsBounds(def.parts);
        food = new FoodItem(def.id, [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]);
        center = [(b.max.x + b.min.x) / 2, (b.max.y + b.min.y) / 2, (b.max.z + b.min.z) / 2];
      }
      this.sim.addFood(h, food);
      item.entry.data.food = food;
      item.entry.data.foodCenter = center;
      this.foodViews.set(h, new FoodView(food, item.view, center, def.color ?? 0xaa5555, piece?.hull));
    }
    this.events.emit('spawn', { body: h, itemId: def.id });
    this.enforceItemCap();
    return item;
  }

  /**
   * Cut a food item with a plane given in the item's local frame (n·p = d). The food's sim state is split
   * cell-by-cell, both pieces become new physics bodies (convex hulls), and juice runs out of the cut.
   * Returns the new body handles.
   */
  cutFood(handle: number, plane: Plane, separation = 0.004): number[] {
    const it = this.items.get(handle);
    const food = it?.entry.data.food as FoodItem | undefined;
    if (!it || !food) return [];
    const len = Math.hypot(...plane.n);
    const n: [number, number, number] = [plane.n[0] / len, plane.n[1] / len, plane.n[2] / len];
    const d = plane.d / len;
    const center = it.entry.data.foodCenter as [number, number, number];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const foodPlane: Plane = { n, d: d - dot(n, center) };
    const [A, B] = splitFood(food, foodPlane);
    if (!A || !B) return [];

    const pts = (it.entry.data.hull as [number, number, number][] | undefined) ?? it.def.parts.flatMap((p) => geometryPoints(buildPartGeometry(p)));
    const body = it.entry.body;
    const t = body.translation();
    const r = body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const lv = body.linvel();
    const av = body.angvel();
    const nWorld = new THREE.Vector3(...n).applyQuaternion(q);

    // Juice: how much runs out depends on free juice near the cut (rested meat releases less).
    const juiceKg = juiceReleased(food, foodPlane);
    const cutCenterLocal = new THREE.Vector3(center[0] + n[0] * foodPlane.d, center[1] + n[1] * foodPlane.d, center[2] + n[2] * foodPlane.d);
    const cutWorld = cutCenterLocal.clone().applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    const peakAtCut = food.thermal.sample(food.thermal.peak, n[0] * foodPlane.d, n[1] * foodPlane.d, n[2] * foodPlane.d);

    this.despawn(handle);
    const out: number[] = [];
    ([
      [A, 1],
      [B, -1],
    ] as const).forEach(([P, sign]) => {
      const clipped = clipConvex(pts, [n[0] * sign, n[1] * sign, n[2] * sign], d * sign);
      if (clipped.length < 4) return;
      const rel = [P.origin[0] - food.origin[0], P.origin[1] - food.origin[1], P.origin[2] - food.origin[2]];
      const pc = new THREE.Vector3(center[0] + rel[0], center[1] + rel[1], center[2] + rel[2]);
      const hull = clipped.map((p) => [p[0] - pc.x, p[1] - pc.y, p[2] - pc.z] as [number, number, number]);
      const world = pc.clone().applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z)).addScaledVector(nWorld, (-sign * separation) / 2);
      const def: ItemDef = { ...it.def, mass: Math.max(P.thermal.mass(), 0.002), parts: [{ kind: 'hull', points: hull }] };
      const piece = this.spawnDef(def, world, q, { food: P, hull });
      piece.entry.body.setLinvel({ x: lv.x - nWorld.x * sign * 0.03, y: lv.y, z: lv.z - nWorld.z * sign * 0.03 }, true);
      piece.entry.body.setAngvel(av, true);
      out.push(piece.entry.body.handle);
    });
    if (juiceKg > 0) this.juice.emit(cutWorld, new THREE.Vector3(0, -1, 0).addScaledVector(nWorld, 0.3), juiceKg, juiceColor(food.props, peakAtCut));
    this.events.emit('cut', { body: handle, pieces: out });
    return out;
  }

  /** Height of the first surface below (x, y, z), ignoring food items. */
  floorAt(x: number, y: number, z: number): number {
    const hit = this.physics.world.castRay(new RAPIER.Ray({ x, y: y + 0.02, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, undefined, undefined, (c) => {
      const e = this.physics.bodyOfCollider(c.handle);
      return !(e && e.data.food);
    });
    return hit ? y + 0.02 - hit.timeOfImpact : 0;
  }

  private buildScene(): void {
    const L = KITCHEN;
    this.scene.background = new THREE.Color(0x2a221c);
    this.scene.fog = new THREE.Fog(0x2a221c, 4, 9);
    this.lights = new KitchenLights(this.scene, this.renderer);
    buildKitchenColliders(this.physics, L);
    buildKitchenVisuals(this.scene, L);
    this.grab.spawnerDisplays.push(...buildSpawnerDisplays(this.scene, L.spawners));
    this.grab.spawn = (slot) => this.spawn(slot.itemId, spawnPosition(slot)).entry.body.handle;
    for (const it of L.startItems) this.spawn(it.itemId, { x: it.pos[0], y: it.pos[1], z: it.pos[2] });
    this.rig.applyTo(this.camera);
  }

  get counterTop(): number {
    return KITCHEN.counterTop;
  }

  /** Station the camera is centered on. */
  get station(): string {
    const x = this.rig.x;
    return KITCHEN.stations.find((s) => x >= s.x0 && x < s.x1)?.name ?? '';
  }

  start(): void {
    const frame = (now: number) => {
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.update(dt);
      requestAnimationFrame(frame);
    };
    this.last = performance.now();
    requestAnimationFrame(frame);
    this.ready = true;
  }

  despawn(handle: number): void {
    const it = this.items.get(handle);
    if (!it) return;
    if (this.grab.heldHandle === handle) this.grab.end();
    despawnItem(this.physics, this.scene, handle);
    this.sim.removeFood(handle);
    this.foodViews.get(handle)?.dispose();
    this.foodViews.delete(handle);
    this.items.delete(handle);
    const i = this.grab.pickables.indexOf(it.view);
    if (i >= 0) this.grab.pickables.splice(i, 1);
    this.spawnOrder = this.spawnOrder.filter((h) => h !== handle);
  }

  private enforceItemCap(): void {
    while (this.items.size > MAX_LIVE_ITEMS) {
      const oldest = this.spawnOrder.find((h) => h !== this.grab.heldHandle);
      if (oldest === undefined) return;
      this.despawn(oldest);
    }
  }

  private edgePan(dt: number): void {
    const p = this.grab.lastPointer;
    if (!p) return;
    const x = p.ndc.x * 0.5 + 0.5;
    let dir = 0;
    if (x < EDGE_PAN_ZONE) dir = -(1 - x / EDGE_PAN_ZONE);
    else if (x > 1 - EDGE_PAN_ZONE) dir = (x - (1 - EDGE_PAN_ZONE)) / EDGE_PAN_ZONE;
    if (!dir) return;
    this.rig.panBy(dir * EDGE_PAN_SPEED * dt, 0);
    this.rig.applyTo(this.camera);
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(p.ndc, this.camera);
    this.grab.refresh(ray.ray.clone());
  }

  update(realDt: number): void {
    const dt = Math.min(realDt, 0.1);
    this.rig.update(dt);
    this.edgePan(dt);
    this.rig.applyTo(this.camera);
    this.lights.follow(this.rig.x);
    this.loop.tick(realDt);
    this.physics.sync();
    const gdt = this.sim.gameTime - this.lastGameTime;
    this.lastGameTime = this.sim.gameTime;
    for (const v of this.foodViews.values()) v.update(gdt);
    this.juice.update(dt);
    this.renderer.render(this.scene, this.camera);
    const held = this.grab.heldHandle !== null ? this.items.get(this.grab.heldHandle) : undefined;
    this.overlay.update(realDt, {
      bodies: this.physics.dynamicCount,
      cameraX: this.camera.position.x,
      cameraY: this.camera.position.y,
      timeScale: this.loop.timeScale,
      gameTime: this.sim.gameTime,
      station: this.station,
      held: held ? `${held.def.name}${this.grab.grab.saturated ? ' (heavy!)' : ''}` : undefined,
    });
  }

  // ---- Test/debug helpers (used by Playwright scenarios) ----

  /** Screen position (CSS px) of the first item with this id. */
  screenOf(id: string): { x: number; y: number; handle: number } | null {
    for (const it of this.items.values()) {
      if (it.def.id !== id) continue;
      const t = it.entry.body.translation();
      const v = new THREE.Vector3(t.x, t.y, t.z).project(this.camera);
      const r = this.renderer.domElement.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, handle: it.entry.body.handle };
    }
    return null;
  }

  bodyPos(handle: number): { x: number; y: number; z: number } {
    const t = this.physics.entries.get(handle)!.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
}
