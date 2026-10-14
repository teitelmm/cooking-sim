import * as THREE from 'three';
import type { Game } from '../game';
import type { FoodItem } from '../sim/food';
import { CUT_MODES, cutIntoPieces, minPieceFrac, planesFor, type CutMode } from './autoCutterCore';
import { Display, makeKnob, setKnobAngle } from './controls';
import { inZone, zone } from './kitchenAppliances';
import { buildPartGeometry } from './shapes';
import { geometryPoints } from './convex';
import type { ItemDef } from '../data/items';

type V3 = [number, number, number];

/**
 * Mandoline/hopper auto-cutter. Drop a whole vegetable in the hopper, turn the dial to pick the cut
 * (⅛" slices, ⅜" fries, 8 wedges, ¾" dice), pull the lever down: it comes out the bottom as pieces into
 * the bowl underneath, each piece carrying its part of the vegetable's sim state.
 */
export class AutoCutter {
  modeIndex = 1;
  lever = 0;
  private fired = false;
  private readonly z = zone('auto-cutter');
  private readonly knob: THREE.Group;
  private readonly leverMesh: THREE.Group;
  private readonly display = new Display(0.11, 0.026, '#9cf0ff');
  lastPieces = 0;

  constructor(private readonly game: Game) {
    const front = this.z.pos[2] + this.z.size[2] / 2 + 0.007;
    this.knob = makeKnob(0.016);
    this.knob.position.set(this.z.pos[0] - 0.05, 1.075, front);
    game.scene.add(this.knob);
    game.appliances.controls.register(this.knob, {
      kind: 'knob',
      label: 'Cut style',
      get: () => this.modeIndex / (CUT_MODES.length - 1),
      set: (v) => (this.modeIndex = Math.round(v * (CUT_MODES.length - 1))),
      travel: 160,
    });
    this.display.mesh.position.set(this.z.pos[0] + 0.028, 1.075, front);
    game.scene.add(this.display.mesh);

    // Lever on the right side: drag it down to cut.
    this.leverMesh = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.14), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.3 }));
    arm.position.set(0, 0, 0.07);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 }));
    grip.position.set(0.02, 0, 0.14);
    this.leverMesh.add(arm, grip);
    this.leverMesh.position.set(this.z.pos[0] + this.z.size[0] / 2 + 0.01, 1.13, this.z.pos[2] - 0.03);
    game.scene.add(this.leverMesh);
    game.appliances.controls.register(this.leverMesh, {
      kind: 'hinge',
      label: 'Cutter lever',
      get: () => this.lever,
      set: (v) => (this.lever = v),
      openDir: 1,
      travel: 140,
    });
  }

  get mode(): CutMode {
    return CUT_MODES[this.modeIndex];
  }

  frame(): void {
    setKnobAngle(this.knob, this.modeIndex / (CUT_MODES.length - 1));
    this.display.show([this.mode.label]);
    if (this.game.appliances.controls.active?.label !== 'Cutter lever') this.lever = Math.max(0, this.lever - 0.08); // spring return
    this.leverMesh.rotation.x = this.lever * 1.1;
    if (this.lever > 0.85 && !this.fired) {
      this.fired = true;
      this.cut();
    }
    if (this.lever < 0.3) this.fired = false;
  }

  /** The food sitting in the hopper, if any. */
  inHopper(): number | null {
    const g = this.game;
    for (const [h] of g.sim.foods) {
      if (g.grab.heldHandle === h) continue;
      const e = g.physics.entries.get(h);
      if (e && inZone(this.z, e.body.translation(), 0.01)) return h;
    }
    return null;
  }

  /** Cut whatever is in the hopper with the current mode. Returns the number of pieces. */
  cut(): number {
    const g = this.game;
    const h = this.inHopper();
    if (h === null) return 0;
    const it = g.items.get(h)!;
    const food = it.entry.data.food as FoodItem;
    const center = it.entry.data.foodCenter as V3;
    const hull: V3[] = ((it.entry.data.hull as V3[] | undefined) ?? it.def.parts.flatMap((p) => geometryPoints(buildPartGeometry(p)))).map(
      (p) => [p[0] - center[0], p[1] - center[1], p[2] - center[2]] as V3,
    );
    const pieces = cutIntoPieces(food, hull, planesFor(this.mode, food.size), 120, minPieceFrac(this.mode));
    if (pieces.length < 2) return 0;
    const def = it.def;
    g.despawn(h);
    // Out the bottom into the bowl: stack them loosely in the space under the hopper.
    const bx = this.z.pos[0];
    const bz = this.z.pos[2] + 0.02;
    pieces.forEach((p, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5) % 5;
      const layer = Math.floor(i / 25);
      const pos = { x: bx - 0.05 + col * 0.025 + (Math.random() - 0.5) * 0.004, y: 0.94 + layer * 0.022 + (Math.random() - 0.5) * 0.004, z: bz - 0.05 + row * 0.025 };
      const pdef: ItemDef = { ...def, mass: Math.max(p.food.thermal.mass(), 0.001), parts: [{ kind: 'hull', points: p.hull }] };
      g.spawnDef(pdef, pos, undefined, { food: p.food, hull: p.hull });
    });
    this.lastPieces = pieces.length;
    return pieces.length;
  }
}
