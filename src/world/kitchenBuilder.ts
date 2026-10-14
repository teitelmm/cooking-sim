import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RAPIER, type PhysicsWorld } from '../engine/physics';
import { MATERIALS, type MaterialId } from '../data/materials';
import type { Block, KitchenLayout } from './kitchenLayout';

/** All non-decor blocks as colliders on one fixed body. Headless-safe (used by tests). */
export function buildKitchenColliders(physics: PhysicsWorld, layout: KitchenLayout): void {
  // Group by material so impact events can report what was hit.
  const byMat = new Map<MaterialId, Block[]>();
  for (const b of layout.blocks) {
    if (b.visualOnly) continue;
    const list = byMat.get(b.material) ?? [];
    list.push(b);
    byMat.set(b.material, list);
  }
  for (const [mat, list] of byMat) {
    const m = MATERIALS[mat];
    const colliders = list.map((b) =>
      RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2)
        .setTranslation(b.pos[0], b.pos[1], b.pos[2])
        .setFriction(m.friction)
        .setRestitution(m.restitution),
    );
    physics.add(RAPIER.RigidBodyDesc.fixed(), colliders, { tag: `kitchen:${mat}`, material: mat });
  }
}

// ------------------------------------------------------------- procedural textures (browser only)

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function woodTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const y = Math.random() * 256;
        g.strokeStyle = `rgba(80,50,25,${0.05 + Math.random() * 0.12})`;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 40 + i) * 3);
        g.stroke();
      }
    },
    [2, 2],
  );
}

function tileTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(120,110,95,0.45)';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(0, i * 64);
        g.lineTo(256, i * 64);
        g.stroke();
      }
      for (let r = 0; r < 4; r++)
        for (let i = 0; i <= 2; i++) {
          const x = i * 128 + (r % 2) * 64;
          g.beginPath();
          g.moveTo(x, r * 64);
          g.lineTo(x, r * 64 + 64);
          g.stroke();
        }
    },
    [6, 6],
  );
}

function speckleTexture(): THREE.CanvasTexture {
  return canvasTex(
    256,
    256,
    (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2500; i++) {
        const v = 120 + Math.random() * 110;
        g.fillStyle = `rgba(${v},${v - 5},${v - 12},0.35)`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
      }
    },
    [3, 3],
  );
}

/** Kitchen meshes, merged per material/color/emissive so the whole room is a few dozen draw calls. */
export function buildKitchenVisuals(scene: THREE.Scene, layout: KitchenLayout): THREE.Group {
  const root = new THREE.Group();
  root.name = 'kitchen';
  const tex: Partial<Record<MaterialId, THREE.Texture>> = {};
  const wood = woodTexture();
  tex.wood = wood;
  tex.butcherBlock = wood;
  tex.tile = tileTexture();
  tex.granite = speckleTexture();

  const groups = new Map<string, { geoms: THREE.BufferGeometry[]; block: Block }>();
  for (const b of layout.blocks) {
    if (b.hidden) continue;
    const key = `${b.material}|${b.color ?? ''}|${b.emissive ?? ''}|${b.castShadow ?? true}`;
    const g = new THREE.BoxGeometry(...b.size);
    // World-scaled UVs so textures don't stretch on long counters.
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i));
      const ay = Math.abs(n.getY(i));
      const [su, sv] = ax > 0.5 ? [b.size[2], b.size[1]] : ay > 0.5 ? [b.size[0], b.size[2]] : [b.size[0], b.size[1]];
      uv.setXY(i, uv.getX(i) * su * 1.5, uv.getY(i) * sv * 1.5);
    }
    g.translate(...b.pos);
    const entry = groups.get(key) ?? { geoms: [], block: b };
    entry.geoms.push(g);
    groups.set(key, entry);
  }
  for (const { geoms, block } of groups.values()) {
    const m = MATERIALS[block.material];
    const mat = new THREE.MeshStandardMaterial({
      color: block.color ?? m.color,
      roughness: m.roughness,
      metalness: m.metalness,
      map: tex[block.material] ?? null,
      transparent: block.material === 'glass',
      opacity: block.material === 'glass' ? 0.35 : 1,
      emissive: block.emissive ?? 0,
      emissiveIntensity: block.emissive ? 1 : 0,
    });
    const mesh = new THREE.Mesh(mergeGeometries(geoms), mat);
    mesh.castShadow = block.castShadow ?? block.material !== 'glass';
    mesh.receiveShadow = true;
    mesh.userData.kitchen = true;
    root.add(mesh);
    for (const g of geoms) g.dispose();
  }
  scene.add(root);
  return root;
}

/**
 * Warm kitchen lighting. The key light and the under-cabinet fills follow the camera along X so shadow
 * resolution stays high and only a handful of lights are ever active.
 */
export class KitchenLights {
  readonly key: THREE.DirectionalLight;
  readonly fills: THREE.PointLight[] = [];
  private readonly target = new THREE.Object3D();

  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    if (renderer) {
      // Soft studio reflections so steel, enamel and glass read as metal/gloss instead of black.
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.45;
      pmrem.dispose();
    }
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x4a3628, 0.55));
    this.key = new THREE.DirectionalLight(0xffe0b8, 2.0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.01;
    Object.assign(this.key.shadow.camera, { left: -1.8, right: 1.8, top: 1.6, bottom: -1.2, near: 0.1, far: 6 });
    this.key.shadow.camera.updateProjectionMatrix();
    this.key.target = this.target;
    scene.add(this.key, this.target);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.PointLight(0xffc98a, 0.9, 2.2, 1.6);
      this.fills.push(p);
      scene.add(p);
    }
  }

  follow(x: number): void {
    this.target.position.set(x, 0.9, 0);
    this.key.position.set(x + 0.8, 3.0, 1.6);
    this.fills.forEach((p, i) => p.position.set(x + (i - 1) * 1.1, 1.85, -0.1));
  }
}
