import * as THREE from 'three';
import { FixedLoop } from './engine/loop';
import { createRenderer, bindResize } from './engine/renderer';
import { PhysicsWorld, RAPIER } from './engine/physics';
import { EventBus } from './engine/events';
import { SimWorld } from './sim/simWorld';
import { DebugOverlay } from './ui/debugOverlay';
import { bindTimeScaleKeys } from './ui/timeScale';
import { CameraRig } from './engine/cameraRig';
import { PointerRouter } from './engine/input';
import { GrabInteraction } from './engine/grabInteraction';
import { Audio } from './engine/audio';
import { itemDef } from './data/items';
import { spawnItem, type SpawnedItem } from './world/itemFactory';

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
  readonly rig = new CameraRig({ minX: -3, maxX: 3, minY: 1.25, maxY: 1.75, minZ: 1.25, maxZ: 2.05 }, { x: 0, y: 1.45, z: 1.65 });
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
    this.grab = new GrabInteraction(this.physics, this.events, { minZ: -0.25, maxZ: 0.35, minY: 0.02 });
    this.input.addPicker(this.grab.picker);
    this.audio = new Audio(this.events);
    this.buildScene();
  }

  spawn(id: string, pos: { x: number; y: number; z: number }, rot?: THREE.Quaternion): SpawnedItem {
    const item = spawnItem(this.physics, this.scene, itemDef(id), pos, rot);
    this.items.set(item.entry.body.handle, item);
    this.grab.pickables.push(item.view);
    this.events.emit('spawn', { body: item.entry.body.handle, itemId: id });
    return item;
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x2a221c);
    this.rig.applyTo(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xfff1dd, 0x3a2c22, 0.6));
    const sun = new THREE.DirectionalLight(0xffe2bf, 2.2);
    sun.position.set(1.5, 3, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    this.scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setTranslation(0, -0.05, 0)], { tag: 'floor' });

    // Temporary test counter (replaced by the kitchen in Prompt 3).
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 0.9, 0.65), new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.4 }));
    counter.position.set(0, 0.45, 0);
    counter.receiveShadow = true;
    counter.castShadow = true;
    this.scene.add(counter);
    this.physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(3, 0.45, 0.325).setTranslation(0, 0.45, 0).setFriction(0.55)], {
      tag: 'counter',
      material: 'granite',
    });

    const y = 0.95;
    this.spawn('cutting-board', { x: -0.1, y, z: 0 });
    this.spawn('steak', { x: -0.15, y: y + 0.05, z: 0 });
    this.spawn('potato', { x: 0.1, y: y + 0.06, z: 0.05 });
    this.spawn('herbs', { x: 0.35, y, z: 0.05 });
    this.spawn('cast-iron-pan', { x: 0.75, y, z: 0 });
    this.spawn('stainless-pan', { x: -0.8, y, z: 0 });
    this.spawn('stock-pot', { x: 1.4, y, z: -0.05 });
    this.spawn('chef-knife', { x: -0.1, y: y + 0.03, z: 0.2 });
    this.spawn('flour-bag', { x: -1.4, y: y + 0.12, z: -0.1 });
    this.spawn('egg', { x: 0.3, y: y + 0.03, z: 0.22 });
    this.spawn('carrot', { x: -0.45, y: y + 0.02, z: 0.2 });
    this.spawn('onion', { x: 0.5, y: y + 0.05, z: 0.18 });
    this.spawn('chicken-breast', { x: -1.0, y: y + 0.03, z: 0.18 });
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
