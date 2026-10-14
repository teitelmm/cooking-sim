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
    this.buildScene();
  }

  spawn(id: string, pos: { x: number; y: number; z: number }, rot?: THREE.Quaternion): SpawnedItem {
    const item = spawnItem(this.physics, this.scene, itemDef(id), pos, rot);
    this.items.set(item.entry.body.handle, item);
    this.grab.pickables.push(item.view);
    this.spawnOrder.push(item.entry.body.handle);
    this.enforceItemCap();
    this.events.emit('spawn', { body: item.entry.body.handle, itemId: id });
    return item;
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
