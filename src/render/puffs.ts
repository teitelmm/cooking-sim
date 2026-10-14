import * as THREE from 'three';

/**
 * Pooled steam/smoke puffs: one THREE.Points draw call for every puff in the kitchen. Each particle has
 * its own color, alpha and size (billboarded, perspective-scaled); dead particles are recycled.
 */
export class PuffPool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private next = 0;
  private live = 0;

  constructor(
    scene: THREE.Scene,
    tex: THREE.Texture,
    readonly capacity = 384,
  ) {
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          if (t.a * vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  /** Puffs alive right now. */
  get count(): number {
    return this.live;
  }

  emit(at: THREE.Vector3, spread: number, color: number, life: number): void {
    // Find a free slot (ring scan from the last one used); if all are busy, recycle the oldest-ish.
    let i = -1;
    for (let k = 0; k < this.capacity; k++) {
      const j = (this.next + k) % this.capacity;
      if (this.life[j] <= 0) {
        i = j;
        break;
      }
    }
    if (i < 0) i = this.next;
    this.next = (i + 1) % this.capacity;
    const c = new THREE.Color(color);
    this.pos.set([at.x + (Math.random() - 0.5) * spread, at.y, at.z + (Math.random() - 0.5) * spread], i * 3);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.03, 0.12 + Math.random() * 0.1, (Math.random() - 0.5) * 0.03], i * 3);
    this.life[i] = this.max[i] = life * (0.7 + Math.random() * 0.6);
  }

  update(dt: number): void {
    let live = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const a = Math.max(this.life[i] / this.max[i], 0);
      this.size[i] = 0.04 + (1 - a) * 0.14;
      this.alpha[i] = a * 0.35;
    }
    this.live = live;
    const g = this.points.geometry;
    for (const n of ['position', 'alpha', 'size', 'color']) g.getAttribute(n).needsUpdate = true;
    this.points.visible = live > 0;
  }
}
