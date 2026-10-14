import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { FoodItem, Plane } from '../sim/food';
import { crossSectionImage, planeBasis } from './crossSection';
import { hex, surfaceColor, type RGB } from './foodColor';
import { FOOD_DETAIL_GLSL, grainOnCut, patternFor } from './foodDetail';
import { FRIDGE_C } from '../sim/units';

type V3 = [number, number, number];

/**
 * Renders a food from its sim state. The exterior samples a small 3D texture (one texel per voxel) that
 * holds the surface color — raw → cooked → golden → mahogany → char — and wetness (→ glossy sheen), so
 * gradients follow the thermal grid without needing dense meshes. Cut faces get "caps": textured
 * polygons showing the interior cross-section. The mesh also shrinks as the food loses water.
 */
export class FoodView {
  private readonly tex: THREE.Data3DTexture;
  private readonly texData: Uint8Array;
  readonly material: THREE.MeshStandardMaterial;
  private readonly caps: { mesh: THREE.Mesh; plane: Plane; tex: THREE.DataTexture }[] = [];
  private timer = 0;
  private realTimer = 1;
  private capTimer = 0;
  private readonly raw: RGB;
  /** Shared by the surface and the cut-face caps. */
  private readonly detailUniforms: Record<string, THREE.IUniform>;

  constructor(
    readonly food: FoodItem,
    /** The physics body's render group (its local frame = body frame). */
    readonly group: THREE.Group,
    /** Food grid center in the body frame. */
    readonly center: V3,
    rawColor: number,
    hullPoints?: V3[],
  ) {
    const t = food.thermal;
    this.raw = hex(rawColor);
    this.texData = new Uint8Array(t.N * 4);
    this.tex = new THREE.Data3DTexture(this.texData, t.nx, t.ny, t.nz);
    this.tex.format = THREE.RGBAFormat;
    this.tex.type = THREE.UnsignedByteType;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = this.tex.wrapR = THREE.ClampToEdgeWrapping;
    this.tex.unpackAlignment = 1;

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
    const pattern = patternFor(food.id, food.props);
    // Reference raw surface color (same sRGB space as the voxel texture), to tell how cooked a spot looks.
    // Raw look of the tissue most of the outside is (lean, fat, skin…).
    const t0 = food.thermal;
    const tissueCount = new Map<number, number>();
    for (let f = 0; f < t0.faceCount; f++) {
      const tis = t0.tissue[t0.faceCell[f]];
      tissueCount.set(tis, (tissueCount.get(tis) ?? 0) + 1);
    }
    const mainTissue = [...tissueCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const rawSurf = surfaceColor(food.props, this.raw, FRIDGE_C, 0, 0, 1, 0, 0, mainTissue);
    this.detailUniforms = {
      uPattern: { value: pattern.kind },
      uBump: { value: pattern.bump },
      uDetailFreq: { value: pattern.freq },
      uSeed: { value: food.seed },
      uOrigin: { value: new THREE.Vector3(food.origin[0] - center[0], food.origin[1] - center[1], food.origin[2] - center[2]) },
      uRaw: { value: new THREE.Vector3(...rawSurf.map((v) => v ** 2.2)) },
    };
    const uniforms = {
      ...this.detailUniforms,
      uSurf: { value: this.tex },
      uMin: { value: new THREE.Vector3(center[0] - food.size[0] / 2, center[1] - food.size[1] / 2, center[2] - food.size[2] / 2) },
      uSize: { value: new THREE.Vector3(...food.size) },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFoodPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoodPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
precision highp sampler3D;
uniform sampler3D uSurf;
uniform vec3 uMin;
uniform vec3 uSize;
varying vec3 vFoodPos;
vec4 foodSample;
float fdHeight;
float fdRoughAdd;
${FOOD_DETAIL_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
foodSample = texture(uSurf, clamp((vFoodPos - uMin) / uSize, 0.0, 1.0));
vec3 fdBase = pow(foodSample.rgb, vec3(2.2));
vec3 fdP = vFoodPos + uOrigin;
float fdLum; vec3 fdTint; float fdTintAmt; float fdH; float fdRough;
fdFw = max(length(dFdx(fdP)), length(dFdy(fdP)));
fdLean = smoothstep(0.02, 0.12, fdBase.r - max(fdBase.g, fdBase.b));
foodDetail(fdP, fdLum, fdTint, fdTintAmt, fdH, fdRough);
// 1 = still looks raw, 0 = browned/cooked: raw-only touches (marbling, flour, skin tint) fade with it.
float fdRaw = clamp(1.0 - length(fdBase - uRaw) / 0.25, 0.0, 1.0);
// A browned crust gets its own fine, craggy texture.
float fdCrust = (fd_fbm(fdP * 220.0 + 11.0) - 0.47) * fl(220.0);
// Only dark, browned surfaces count as crust (a white fat cap that isn't the lean's raw color isn't cooked).
float fdBrowned = (1.0 - fdRaw) * smoothstep(0.3, 0.06, dot(fdBase, vec3(0.2126, 0.7152, 0.0722)));
float fdL = mix(1.0, fdLum, 0.45 + 0.55 * fdRaw) * (1.0 + 0.5 * fdCrust * fdBrowned);
diffuseColor.rgb *= fdBase * fdL;
vec3 fdTintCol = mix(pow(fdTint, vec3(2.2)), fdBase * 1.7 + vec3(0.03, 0.015, 0.0), 1.0 - fdRaw);
diffuseColor.rgb = mix(diffuseColor.rgb, fdTintCol, clamp(fdTintAmt * (0.35 + 0.65 * fdRaw), 0.0, 1.0));
fdHeight = fdH * (0.5 + 0.5 * fdRaw) + fdBrowned * 0.9 * fdCrust;
fdRoughAdd = fdRough * fdRaw;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(mix(0.82, 0.28, foodSample.a) + fdRoughAdd, 0.06, 1.0);')
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = fd_perturb(-vViewPosition, normal, vec2(dFdx(fdHeight), dFdy(fdHeight)) * uBump, faceDirection);',
        );
    };
    this.material.customProgramCacheKey = () => 'food-surface';

    // Replace the item's default materials.
    if (hullPoints) {
      group.clear();
      const m = new THREE.Mesh(hullGeometry(hullPoints), this.material);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    } else {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = this.material;
      });
    }
    for (const plane of food.cuts) this.addCap(plane, hullPoints);
    this.refresh();
  }

  /** Recompute the surface texture from the sim. */
  refresh(): void {
    const t = this.food.thermal;
    const props = this.food.props;
    const N = t.N;
    const acc = new Float32Array(N * 4);
    const cnt = new Uint16Array(N);
    for (let f = 0; f < t.faceCount; f++) {
      if (t.isCut[f]) continue;
      const c = t.faceCell[f];
      const col = surfaceColor(props, this.raw, t.peak[c], t.brown[f], t.charred[f], t.w[c] / t.w0c[c], t.starch[c], t.soft[c], t.tissue[c], t.spiceBurn[f], t.spice[f]);
      const wet = Math.min(t.crust[f] / (t.crustMax || 1), 1) * (props.protein ? 0.9 : 0.6) + (t.fat[c] < (props.fat ?? 0) * 0.7 ? 0.25 : 0);
      acc[c * 4] += col[0];
      acc[c * 4 + 1] += col[1];
      acc[c * 4 + 2] += col[2];
      acc[c * 4 + 3] += Math.min(wet, 1);
      cnt[c]++;
    }
    // Dilate surface colors inward so linear filtering never pulls in unset texels.
    const filled = new Uint8Array(N);
    for (let c = 0; c < N; c++) if (cnt[c]) {
      for (let k = 0; k < 4; k++) acc[c * 4 + k] /= cnt[c];
      filled[c] = 1;
    }
    const nx = t.nx;
    const ny = t.ny;
    const nz = t.nz;
    for (let pass = 0; pass < Math.max(nx, ny, nz); pass++) {
      let changed = false;
      for (let c = 0; c < N; c++) {
        if (filled[c]) continue;
        const i = c % nx;
        const j = Math.floor(c / nx) % ny;
        const k = Math.floor(c / (nx * ny));
        const nbs = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1, k > 0 ? c - nx * ny : -1, k < nz - 1 ? c + nx * ny : -1];
        let n = 0;
        const s = [0, 0, 0, 0];
        for (const nb of nbs) {
          if (nb < 0 || filled[nb] !== 1) continue;
          for (let q = 0; q < 4; q++) s[q] += acc[nb * 4 + q];
          n++;
        }
        if (n) {
          for (let q = 0; q < 4; q++) acc[c * 4 + q] = s[q] / n;
          filled[c] = 2;
          changed = true;
        }
      }
      for (let c = 0; c < N; c++) if (filled[c] === 2) filled[c] = 1;
      if (!changed) break;
    }
    for (let c = 0; c < N; c++) {
      for (let q = 0; q < 3; q++) this.texData[c * 4 + q] = Math.round(Math.min(Math.max(acc[c * 4 + q], 0), 1) * 255);
      this.texData[c * 4 + 3] = Math.round(Math.min(Math.max(acc[c * 4 + 3], 0), 1) * 255);
    }
    this.tex.needsUpdate = true;

    // Shrink with moisture loss: meat contracts across the grain and plumps a little in thickness.
    const loss = Math.min(Math.max(1 - t.mass() / t.mass0, 0), 0.4);
    const sxz = 1 - (props.protein ? 0.55 : 0.35) * loss;
    const sy = 1 + (props.protein ? 0.12 : -0.15) * loss;
    for (const child of this.group.children) {
      child.scale.set(sxz, sy, sxz);
      child.position.set(this.center[0] * (1 - sxz), this.center[1] * (1 - sy), this.center[2] * (1 - sxz));
    }
  }

  private addCap(plane: Plane, hullPoints?: V3[]): void {
    if (!hullPoints) return;
    const len = Math.hypot(...plane.n);
    const n: V3 = [plane.n[0] / len, plane.n[1] / len, plane.n[2] / len];
    const d = plane.d / len;
    // Hull vertices lying on the plane (in body frame = food frame for pieces).
    const on = hullPoints.filter((p) => Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d) < 1e-4);
    if (on.length < 3) return;
    const basis = planeBasis(this.food, plane);
    const uv = on.map((p) => {
      const rel: V3 = [p[0] - basis.origin[0], p[1] - basis.origin[1], p[2] - basis.origin[2]];
      return [rel[0] * basis.u[0] + rel[1] * basis.u[1] + rel[2] * basis.u[2], rel[0] * basis.v[0] + rel[1] * basis.v[1] + rel[2] * basis.v[2]];
    });
    const cu = uv.reduce((s, q) => s + q[0], 0) / uv.length;
    const cv = uv.reduce((s, q) => s + q[1], 0) / uv.length;
    const order = uv.map((q, i) => ({ i, a: Math.atan2(q[1] - cv, q[0] - cu) })).sort((a, b) => a.a - b.a);
    const pos: number[] = [];
    const uvs: number[] = [];
    const lift = 0.0003;
    const vtx = (i: number) => {
      const p = on[i];
      pos.push(p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift);
      uvs.push((uv[i][0] - basis.uMin) / (basis.uMax - basis.uMin), (uv[i][1] - basis.vMin) / (basis.vMax - basis.vMin));
    };
    for (let k = 1; k < order.length - 1; k++) {
      vtx(order[0].i);
      vtx(order[k].i);
      vtx(order[k + 1].i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    // Make sure triangles face outward (along +n).
    const nrm = g.attributes.normal;
    if (nrm.count && nrm.getX(0) * n[0] + nrm.getY(0) * n[1] + nrm.getZ(0) * n[2] < 0) {
      const p = g.attributes.position.array as Float32Array;
      const u = g.attributes.uv.array as Float32Array;
      for (let t = 0; t < p.length; t += 9) for (let q = 0; q < 3; q++) [p[t + 3 + q], p[t + 6 + q]] = [p[t + 6 + q], p[t + 3 + q]];
      for (let t = 0; t < u.length; t += 6) for (let q = 0; q < 2; q++) [u[t + 2 + q], u[t + 4 + q]] = [u[t + 4 + q], u[t + 2 + q]];
      g.computeVertexNormals();
    }
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0, alphaTest: 0.5, transparent: false });
    if (grainOnCut(this.detailUniforms.uPattern.value as number)) {
      // Muscle fibers show on the cut face too (cut across the grain: fiber ends; along it: lines).
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.detailUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vFoodPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoodPos = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vFoodPos;\n${FOOD_DETAIL_GLSL}`)
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
{
  vec3 fdP = vFoodPos + uOrigin;
  float fdLum; vec3 fdTint; float fdTintAmt; float fdH; float fdRough;
  fdFw = max(length(dFdx(fdP)), length(dFdy(fdP)));
  fdLean = 1.0;
  foodDetail(fdP, fdLum, fdTint, fdTintAmt, fdH, fdRough);
  diffuseColor.rgb *= mix(1.0, fdLum, 0.6);
}`,
          );
      };
      mat.customProgramCacheKey = () => 'food-cap-grain';
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.caps.push({ mesh, plane, tex });
    this.renderCap(this.caps[this.caps.length - 1]);
  }

  private renderCap(cap: { mesh: THREE.Mesh; plane: Plane; tex: THREE.DataTexture }): void {
    const img = crossSectionImage(this.food, cap.plane, rgbToHex(this.raw));
    const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer.slice(0)), img.width, img.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const mat = cap.mesh.material as THREE.MeshStandardMaterial;
    cap.tex.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
    cap.tex = tex;
    // Fresh cuts glisten with juice; dry well-done meat is matte.
    mat.roughness = 0.75 - 0.45 * Math.min(this.food.thermal.freeJuice() / Math.max(this.food.thermal.mass() * 0.004, 1e-6), 1);
  }

  /**
   * Refresh the surface texture every ~0.5 game-s, but no more than ~6×/s of real time (fast-forward) and
   * not at all while off screen (it catches up the moment it comes back into view).
   */
  update(gameDt: number, realDt = 1, visible = true): void {
    this.timer += gameDt;
    this.capTimer += gameDt;
    this.realTimer += realDt;
    if (!visible || this.realTimer < 0.16) return;
    if (this.timer > 0.5) {
      this.timer = 0;
      this.realTimer = 0;
      this.refresh();
    }
    if (this.caps.length && this.capTimer > 4) {
      this.capTimer = 0;
      for (const c of this.caps) this.renderCap(c);
    }
  }

  dispose(): void {
    this.tex.dispose();
    this.material.dispose();
    for (const c of this.caps) c.tex.dispose();
  }
}

function rgbToHex(c: RGB): number {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

function hullGeometry(points: V3[]): THREE.BufferGeometry {
  return new ConvexGeometry(points.map((p) => new THREE.Vector3(...p)));
}
