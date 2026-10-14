import * as THREE from 'three';
import { AirFryer, Burner, Griddle, Grill, Oven, SousVide, type OvenMode } from '../sim/appliances';
import { AIR_FRYER, GRIDDLE, OVEN, SOUS_VIDE } from '../data/appliances';
import { cToF, fToC } from '../sim/units';
import { RAPIER, type BodyEntry, type PhysicsWorld } from '../engine/physics';
import { COUNTER_TOP, KITCHEN, type Zone } from './kitchenLayout';
import { Controls, Display, makeKnob, setKnobAngle } from './controls';

const FRONT = 0.325;

export function zone(id: string): Zone {
  const z = KITCHEN.zones.find((q) => q.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
}

export function inZone(z: Zone, p: { x: number; y: number; z: number }, pad = 0): boolean {
  return (
    Math.abs(p.x - z.pos[0]) <= z.size[0] / 2 + pad && Math.abs(p.y - z.pos[1]) <= z.size[1] / 2 + pad && Math.abs(p.z - z.pos[2]) <= z.size[2] / 2 + pad
  );
}

/** A hinged kinematic panel (oven door, grill lid). */
class Hinge {
  open = 0;
  readonly pivot = new THREE.Group();
  entry: BodyEntry;
  constructor(
    physics: PhysicsWorld,
    scene: THREE.Scene,
    readonly hingePos: THREE.Vector3,
    /** Panel parts in hinge-local coords: [center, size]. */
    parts: [THREE.Vector3, THREE.Vector3][],
    readonly axis: THREE.Vector3,
    readonly maxAngle: number,
    material: THREE.Material,
  ) {
    this.pivot.position.copy(hingePos);
    for (const [c, s] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), material);
      m.position.copy(c);
      m.castShadow = m.receiveShadow = true;
      this.pivot.add(m);
    }
    scene.add(this.pivot);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hingePos.x, hingePos.y, hingePos.z);
    const cols = parts.map(([c, s]) => RAPIER.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setTranslation(c.x, c.y, c.z).setFriction(0.5));
    this.entry = physics.add(desc, cols, { tag: 'hinge', material: 'enamel' });
  }

  set(v: number): void {
    this.open = Math.min(Math.max(v, 0), 1);
  }

  /** Smoothly move the panel toward its target angle (call every frame). */
  update(): void {
    const q = new THREE.Quaternion().setFromAxisAngle(this.axis, this.open * this.maxAngle);
    this.pivot.quaternion.slerp(q, 0.35);
    this.entry.body.setNextKinematicRotation(this.pivot.quaternion);
  }
}

function glowMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0, roughness: 0.6, transparent: true, opacity: 0.95 });
}

/**
 * All the kitchen's heat sources: sim models + the physical controls you drag and the readouts you see.
 */
export class KitchenAppliances {
  readonly burners: Burner[] = [0, 1, 2, 3].map((i) => new Burner(`burner-${i}`));
  readonly griddle = new Griddle('griddle');
  readonly grill = new Grill('grill');
  readonly oven = new Oven('oven');
  readonly airFryer = new AirFryer('air-fryer');
  readonly sousVide = new SousVide('sous-vide');
  readonly controls = new Controls();
  readonly ovenDoor: Hinge;
  readonly grillLid: Hinge;
  private readonly knobs: { knob: THREE.Group; get: () => number }[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly displays: { d: Display; text: () => string[] }[] = [];
  private readonly ovenGlow: THREE.Mesh[] = [];
  private readonly coalGlow: THREE.Mesh[] = [];
  private readonly flareFlames: THREE.Mesh[] = [];
  private readonly afLight: THREE.Mesh;
  private readonly svLight: THREE.Mesh;
  readonly sousVideWater: THREE.Mesh;
  /** Displaced water surface (set by the game's water system). */
  sousVideVolume: { level: number } | null = null;
  /** Griddle knob position 0..1 (0 = off). */
  griddleKnob = 0;
  /** Air fryer knobs 0..1. */
  afTempKnob = (fToC(380) - fToC(AIR_FRYER.minF)) / (fToC(AIR_FRYER.maxF) - fToC(AIR_FRYER.minF));
  /** When the air fryer timer ends (ding) — game hooks a sound. */
  onDing: (() => void) | null = null;
  private flicker = 0;

  constructor(
    physics: PhysicsWorld,
    readonly scene: THREE.Scene,
  ) {
    this.airFryer.onDone = () => this.onDing?.();

    // ---- range: burner knobs + flames
    const knobXs = [2.92, 3.08, 3.32, 3.48];
    const order = [2, 0, 1, 3]; // front-left, back-left, back-right, front-right (labels on the panel)
    knobXs.forEach((x, i) => {
      const b = this.burners[order[i]];
      this.addKnob(new THREE.Vector3(x, 0.81, FRONT + 0.012), () => b.knob, (v) => (b.knob = v), `Burner ${order[i] + 1}`, [0]);
    });
    KITCHEN.zones
      .filter((z) => z.kind === 'burner')
      .forEach((z) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 28).rotateX(Math.PI / 2), glowMat(0x3a7bff));
        ring.position.set(z.pos[0], COUNTER_TOP + 0.024, z.pos[2]);
        this.scene.add(ring);
        this.flames.push(ring);
      });

    // ---- oven: door, elements, control panel
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2d2f33, roughness: 0.35, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75 });
    this.ovenDoor = new Hinge(
      physics,
      scene,
      new THREE.Vector3(3.2, 0.135, FRONT + 0.02),
      [
        [new THREE.Vector3(0, 0.31, 0), new THREE.Vector3(0.68, 0.62, 0.035)],
        [new THREE.Vector3(0, 0.56, 0.035), new THREE.Vector3(0.5, 0.02, 0.02)],
      ],
      new THREE.Vector3(1, 0, 0),
      Math.PI * 0.47,
      doorMat,
    );
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), glassMat);
    glass.position.set(0, 0.33, 0.0185);
    this.ovenDoor.pivot.add(glass);
    this.controls.register(this.ovenDoor.pivot, { kind: 'hinge', get: () => this.ovenDoor.open, set: (v) => this.ovenDoor.set(v), openDir: 1, travel: 260, label: 'Oven door' });
    for (const y of [0.165, 0.71]) {
      const el = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.008, 0.008), glowMat(0xff3a10));
      el.position.set(3.2, y, -0.05);
      scene.add(el);
      this.ovenGlow.push(el);
    }
    const panelZ = -0.262;
    const ovenDisp = new Display(0.14, 0.06);
    ovenDisp.mesh.position.set(3.2, 0.985, panelZ);
    scene.add(ovenDisp.mesh);
    this.displays.push({
      d: ovenDisp,
      text: () => {
        const o = this.oven;
        if (o.mode === 'off') return [`${Math.round(cToF(o.airT))}°`, 'OFF'];
        const status = o.mode === 'broil' ? 'BROIL' : o.preheated ? `BAKE ${Math.round(cToF(o.setC))}` : `PRE ${Math.round(cToF(o.setC))}`;
        return [`${Math.round(cToF(o.airT))}°F`, `${status}${o.fan ? ' FAN' : ''}`];
      },
    });
    this.addButton(new THREE.Vector3(2.98, 0.985, panelZ), '−', () => this.oven.setF(Math.round(cToF(this.oven.setC) / 25) * 25 - 25));
    this.addButton(new THREE.Vector3(3.06, 0.985, panelZ), '+', () => this.oven.setF(Math.round(cToF(this.oven.setC) / 25) * 25 + 25));
    this.addButton(new THREE.Vector3(3.36, 0.985, panelZ), 'MODE', () => {
      const modes: OvenMode[] = ['off', 'bake', 'broil'];
      this.oven.setMode(modes[(modes.indexOf(this.oven.mode) + 1) % 3]);
    });
    this.addButton(new THREE.Vector3(3.47, 0.985, panelZ), 'FAN', () => (this.oven.fan = !this.oven.fan));

    // ---- grill: zone knobs, coals glow, lid, hood thermometer
    [3.76, 3.96].forEach((x, z) => this.addKnob(new THREE.Vector3(x, 0.83, FRONT + 0.012), () => this.grill.knobs[z], (v) => (this.grill.knobs[z] = v), `Grill ${z ? 'right' : 'left'}`, [0]));
    [3.76, 3.96].forEach((x) => {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.48).rotateX(-Math.PI / 2), glowMat(0xff4a12));
      c.position.set(x, COUNTER_TOP - 0.125, 0);
      scene.add(c);
      this.coalGlow.push(c);
    });
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8, toneMapped: false }));
      f.visible = false;
      scene.add(f);
      this.flareFlames.push(f);
    }
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.3, metalness: 0.7 });
    this.grillLid = new Hinge(
      physics,
      scene,
      new THREE.Vector3(3.86, COUNTER_TOP + 0.02, -0.26),
      [
        [new THREE.Vector3(0, 0.15, 0.275), new THREE.Vector3(0.42, 0.012, 0.55)],
        [new THREE.Vector3(0, 0.075, 0.545), new THREE.Vector3(0.42, 0.15, 0.012)],
        [new THREE.Vector3(-0.205, 0.075, 0.275), new THREE.Vector3(0.012, 0.15, 0.55)],
        [new THREE.Vector3(0.205, 0.075, 0.275), new THREE.Vector3(0.012, 0.15, 0.55)],
      ],
      new THREE.Vector3(1, 0, 0),
      -Math.PI * 0.42,
      lidMat,
    );
    this.grillLid.set(1); // starts open
    this.grillLid.pivot.quaternion.setFromAxisAngle(this.grillLid.axis, this.grillLid.maxAngle);
    this.controls.register(this.grillLid.pivot, { kind: 'hinge', get: () => this.grillLid.open, set: (v) => this.grillLid.set(v), openDir: -1, travel: 240, label: 'Grill lid' });
    const hood = new Display(0.08, 0.04, '#ffd27a');
    hood.mesh.position.set(0, 0.09, 0.552);
    this.grillLid.pivot.add(hood.mesh);
    this.displays.push({ d: hood, text: () => [`${Math.round(cToF(this.grill.hoodT))}°F`] });

    // ---- griddle knob + dial readout
    this.addKnob(new THREE.Vector3(4.34, 0.83, FRONT + 0.012), () => this.griddleKnob, (v) => this.setGriddleKnob(v), 'Flat-top', [0]);
    const gd = new Display(0.13, 0.035, '#ffb35a');
    gd.mesh.position.set(4.48, 0.83, FRONT + 0.004);
    scene.add(gd.mesh);
    this.displays.push({ d: gd, text: () => [Number.isNaN(this.griddle.setC) ? `${Math.round(cToF(this.griddle.T))}° off` : `${Math.round(cToF(this.griddle.T))}°/${Math.round(cToF(this.griddle.setC))}`] });

    // ---- air fryer: display, temp + time knobs, power light
    const af = new Display(0.13, 0.055, '#5affb0');
    af.mesh.position.set(5.5, 1.2, 0.063);
    scene.add(af.mesh);
    this.displays.push({
      d: af,
      text: () => {
        const a = this.airFryer;
        const m = Math.floor(a.timer / 60);
        const s = Math.floor(a.timer % 60).toString().padStart(2, '0');
        return [`${Math.round(cToF(a.setC))}°F`, a.timer > 0 ? `${m}:${s}${a.basketIn ? '' : ' OPEN'}` : 'set time'];
      },
    });
    this.addKnob(new THREE.Vector3(5.4, 1.13, 0.068), () => this.afTempKnob, (v) => {
      this.afTempKnob = v;
      this.airFryer.setC = fToC(AIR_FRYER.minF + (AIR_FRYER.maxF - AIR_FRYER.minF) * v);
    }, 'Air fryer temp');
    this.addKnob(new THREE.Vector3(5.6, 1.13, 0.068), () => this.airFryer.timer / (AIR_FRYER.maxMinutes * 60), (v) => (this.airFryer.timer = Math.round(v * AIR_FRYER.maxMinutes) * 60), 'Air fryer timer', [0]);
    this.afLight = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12), glowMat(0x5affb0));
    this.afLight.position.set(5.65, 1.2, 0.064);
    scene.add(this.afLight);

    // ---- sous vide: water, circulator display, knob, power button
    const svz = zone('sous-vide');
    this.sousVideWater = new THREE.Mesh(
      new THREE.PlaneGeometry(svz.size[0] + 0.01, svz.size[2] + 0.01).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.sousVideWater.position.set(svz.pos[0], this.sousVideLevel, svz.pos[2]);
    this.sousVideWater.renderOrder = 1;
    scene.add(this.sousVideWater);
    const sv = new Display(0.055, 0.035, '#7ad7ff');
    sv.mesh.position.set(6.35, 1.21, -0.0985);
    scene.add(sv.mesh);
    this.displays.push({ d: sv, text: () => [`${cToF(this.sousVide.T).toFixed(1)}°`, `set ${cToF(this.sousVide.setC).toFixed(0)}${this.sousVide.on ? '' : ' off'}`] });
    this.addKnob(new THREE.Vector3(6.35, 1.155, -0.096), () => (cToF(this.sousVide.setC) - SOUS_VIDE.minF) / (SOUS_VIDE.maxF - SOUS_VIDE.minF), (v) => (this.sousVide.setC = fToC(Math.round(SOUS_VIDE.minF + (SOUS_VIDE.maxF - SOUS_VIDE.minF) * v))), 'Sous vide temp', undefined, 0.012);
    this.addButton(new THREE.Vector3(6.35, 1.115, -0.097), '⏻', () => (this.sousVide.on = !this.sousVide.on), 0.02);
    this.svLight = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), glowMat(0x7ad7ff));
    this.svLight.position.set(6.335, 1.235, -0.0975);
    scene.add(this.svLight);
  }

  /** Sous vide water surface height. */
  get sousVideLevel(): number {
    return COUNTER_TOP + 0.008 + 0.18 * (this.sousVide.waterKg / SOUS_VIDE.waterKg);
  }

  setGriddleKnob(v: number): void {
    this.griddleKnob = v;
    this.griddle.setF(v <= 0.005 ? null : GRIDDLE.minF + (GRIDDLE.maxF - GRIDDLE.minF) * v);
  }

  private addKnob(pos: THREE.Vector3, get: () => number, set: (v: number) => void, label: string, detents?: number[], radius = 0.018): void {
    const k = makeKnob(radius);
    k.position.copy(pos);
    this.scene.add(k);
    this.controls.register(k, { kind: 'knob', get, set, label, detents });
    this.knobs.push({ knob: k, get });
  }

  private addButton(pos: THREE.Vector3, label: string, press: () => void, w = 0.065): void {
    const d = new Display(w, 0.03, '#e8e2d8', '#2a2a2e');
    d.show([label]);
    d.mesh.position.copy(pos);
    this.scene.add(d.mesh);
    this.controls.register(d.mesh, { kind: 'button', press, label });
  }

  /** Sim systems (game time). */
  step(dt: number): void {
    for (const b of this.burners) b.step(dt);
    this.griddle.step(dt);
    this.grill.lidClosed = this.grillLid.open < 0.15;
    this.grill.step(dt);
    this.oven.doorOpen = this.ovenDoor.open > 0.08;
    this.oven.step(dt);
    this.airFryer.step(dt);
    this.sousVide.step(dt);
  }

  /** Visuals (real time). */
  frame(dt: number): void {
    this.flicker += dt;
    this.ovenDoor.update();
    this.grillLid.update();
    for (const { knob, get } of this.knobs) setKnobAngle(knob, get());
    this.burners.forEach((b, i) => {
      const f = this.flames[i];
      const m = f.material as THREE.MeshStandardMaterial;
      const p = b.power / b.spec.maxW;
      m.emissiveIntensity = p > 0.01 ? 0.6 + 2.5 * p + Math.sin(this.flicker * 40 + i) * 0.15 : 0;
      f.scale.setScalar(0.7 + 0.5 * p);
    });
    for (const g of this.ovenGlow) (g.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.max(0, (this.oven.elementT - 300) / 300) * 2.2;
    this.coalGlow.forEach((c, z) => ((c.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.max(0, (this.grill.radiantT[z] - 200) / 450) * 2.5));
    this.flareFlames.forEach((f, i) => {
      f.visible = this.grill.flaring;
      if (f.visible) {
        f.position.set(3.7 + (i / 5) * 0.32 + Math.sin(this.flicker * 9 + i) * 0.02, COUNTER_TOP + 0.05 + Math.abs(Math.sin(this.flicker * 13 + i * 2)) * 0.05, -0.15 + ((i * 37) % 30) / 100);
        f.scale.set(1, 0.6 + Math.abs(Math.sin(this.flicker * 17 + i)), 1);
      }
    });
    (this.afLight.material as THREE.MeshStandardMaterial).emissiveIntensity = this.airFryer.heating ? 2 : this.airFryer.running ? 0.6 : 0;
    (this.svLight.material as THREE.MeshStandardMaterial).emissiveIntensity = this.sousVide.on ? (this.sousVide.firing() ? 2 : 0.7) : 0;
    this.sousVideWater.position.y = this.sousVideVolume?.level ?? this.sousVideLevel;
    for (const { d, text } of this.displays) d.show(text());
  }

  /** For tests/debug. */
  get ovenSpec() {
    return OVEN;
  }
}
