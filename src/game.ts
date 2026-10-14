import * as THREE from 'three';
import { FixedLoop } from './engine/loop';
import { createRenderer, bindResize } from './engine/renderer';
import { PhysicsWorld, RAPIER } from './engine/physics';
import { EventBus } from './engine/events';
import { SimWorld } from './sim/simWorld';
import { DebugOverlay } from './ui/debugOverlay';
import { bindTimeScaleKeys } from './ui/timeScale';

export class Game {
  readonly events = new EventBus();
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  readonly renderer: THREE.WebGLRenderer;
  readonly physics = new PhysicsWorld(this.events);
  readonly sim = new SimWorld();
  readonly loop: FixedLoop;
  readonly overlay: DebugOverlay;
  ready = false;
  private last = performance.now();

  constructor(readonly container: HTMLElement, debugEl: HTMLElement) {
    this.renderer = createRenderer(container);
    this.overlay = new DebugOverlay(debugEl);
    this.loop = new FixedLoop({
      physicsStep: () => this.physics.step(),
      simStep: (dt) => this.sim.step(dt),
    });
    bindTimeScaleKeys(this.loop);
    bindResize(container, this.renderer, this.camera);
    this.buildScene();
  }

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x2a221c);
    this.camera.position.set(0, 1.45, 1.6);
    this.camera.lookAt(0, 0.95, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff1dd, 0x3a2c22, 0.6));
    const sun = new THREE.DirectionalLight(0xffe2bf, 2.2);
    sun.position.set(1.5, 3, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.physics.add(RAPIER.RigidBodyDesc.fixed(), [RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setTranslation(0, -0.05, 0)], {
      tag: 'floor',
    });

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xc8643c, roughness: 0.5 }),
    );
    box.castShadow = true;
    this.scene.add(box);
    this.physics.add(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.2, 0), [RAPIER.ColliderDesc.cuboid(0.15, 0.15, 0.15)], {
      tag: 'test-box',
      view: box,
    });
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

  update(realDt: number): void {
    this.loop.tick(realDt);
    this.physics.sync();
    this.renderer.render(this.scene, this.camera);
    this.overlay.update(realDt, {
      bodies: this.physics.dynamicCount,
      cameraX: this.camera.position.x,
      cameraY: this.camera.position.y,
      timeScale: this.loop.timeScale,
      gameTime: this.sim.gameTime,
    });
  }
}
