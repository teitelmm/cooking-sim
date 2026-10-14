import * as THREE from 'three';
import type { Game } from '../game';
import { Display } from './controls';
import { cToF } from '../sim/units';
import { inspectFood } from '../ui/inspector';
import { bakeReport } from '../sim/baking';

const fmt = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Wall-mounted kitchen timer counting in game time: +1 min, +5 min, start/stop, reset. Rings at zero. */
export class KitchenTimer {
  remaining = 0;
  running = false;
  ringing = false;
  readonly display = new Display(0.16, 0.07, '#7cff7a', '#0d140d');

  constructor(private readonly game: Game) {
    const at = new THREE.Vector3(2.36, 1.36, -0.338);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8e3d8, roughness: 0.6 }));
    housing.position.copy(at);
    game.scene.add(housing);
    this.display.mesh.position.copy(at).add(new THREE.Vector3(0, 0.03, 0.0105));
    game.scene.add(this.display.mesh);
    const buttons: [string, number, () => void][] = [
      ['+1m', -0.07, () => this.add(60)],
      ['+5m', -0.023, () => this.add(300)],
      ['▶/❚❚', 0.023, () => this.toggle()],
      ['reset', 0.07, () => this.reset()],
    ];
    for (const [label, dx, fn] of buttons) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.03, 0.012), new THREE.MeshStandardMaterial({ color: label === 'reset' ? 0xc0392b : 0x34495e, roughness: 0.5 }));
      b.position.copy(at).add(new THREE.Vector3(dx, -0.045, 0.012));
      game.scene.add(b);
      game.appliances.controls.register(b, { kind: 'button', label: `Timer ${label}`, press: fn });
    }
    this.show();
  }

  add(s: number): void {
    this.remaining += s;
    this.running = true;
    this.ringing = false;
    this.show();
  }

  toggle(): void {
    if (this.ringing) return this.reset();
    if (this.remaining > 0) this.running = !this.running;
    this.show();
  }

  reset(): void {
    this.remaining = 0;
    this.running = this.ringing = false;
    this.show();
  }

  /** Advance by game seconds. */
  step(gdt: number): void {
    if (!this.running) return;
    this.remaining -= gdt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.running = false;
      this.ringing = true;
      this.game.audio.ring();
      this.game.hud.showAlert('⏰ Timer!', 4);
    }
    this.show();
  }

  private show(): void {
    this.display.show([this.ringing ? 'DING!' : fmt(this.remaining), this.running ? 'running' : this.remaining > 0 ? 'paused' : 'timer']);
  }
}

/**
 * Smoke in the room (arbitrary units; the alarm trips at 1): fed by oil past its smoke point, grease fires
 * and food scorching (surfaces > ~400 °F), cleared by ventilation over a few minutes. Hazes the air.
 */
export class SmokeSystem {
  level = 0;
  alarm = false;
  private source = 0;
  private sample = 0;
  private readonly baseFog: THREE.Fog;

  constructor(private readonly game: Game) {
    this.baseFog = (game.scene.fog as THREE.Fog).clone();
  }

  /** Smoke production right now (units/s of game time ×100). */
  private measure(): number {
    const g = this.game;
    let s = g.liquids.smokeLevel + g.liquids.fireCount * 4;
    for (const f of g.sim.foods.values()) {
      for (let d = 0; d < 6; d++) s += Math.max(0, f.thermal.surfaceTemp(d) - 205) / 40;
    }
    return s;
  }

  step(gdt: number, dt: number): void {
    this.sample -= dt;
    if (this.sample <= 0) {
      this.source = this.measure();
      this.sample = 0.25;
    }
    // dS/dt = production − ventilation (τ ≈ 4 min).
    this.level += gdt * (this.source * 0.01 - this.level / 240);
    this.level = Math.max(0, this.level);
    if (this.level > 1) this.alarm = true;
    else if (this.level < 0.6) this.alarm = false;
    const fog = this.game.scene.fog as THREE.Fog;
    const h = Math.min(this.level / 2, 1);
    fog.near = this.baseFog.near * (1 - h * 0.85);
    fog.far = this.baseFog.far * (1 - h * 0.5);
    fog.color.copy(this.baseFog.color).lerp(new THREE.Color(0x8a8580), h * 0.7);
  }
}

/**
 * Glue for the feedback layer: timer, smoke alarm, continuous audio levels, the held-item readout,
 * control labels on hover, and the plating inspector card.
 */
export class Feedback {
  readonly timer: KitchenTimer;
  readonly smoke: SmokeSystem;
  private lastEvap = new Map<number, number>();
  private plateTimers = new Map<number, number>();
  private inspected = new Set<number>();
  private hover: string | null = null;
  lastCard: string | null = null;

  constructor(private readonly game: Game) {
    this.timer = new KitchenTimer(game);
    this.smoke = new SmokeSystem(game);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'i' || e.key === 'I') this.inspectNearest();
    });
    const el = game.renderer.domElement;
    let pending = false;
    el.addEventListener('pointermove', (e) => {
      if (pending || e.buttons) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this.hover = this.controlAt(e.clientX, e.clientY);
      });
    });
  }

  private controlAt(x: number, y: number): string | null {
    const g = this.game;
    const p = g.input.info(x, y);
    const rc = new THREE.Raycaster();
    rc.ray.copy(p.ray);
    const hit = rc.intersectObjects(g.appliances.controls.meshes, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.control) o = o.parent;
    const spec = o?.userData.control as { label?: string; kind: string; get?: () => number } | undefined;
    if (!spec?.label) return null;
    return spec.kind === 'knob' && spec.get ? `${spec.label}: ${Math.round(spec.get() * 100)}%` : spec.label;
  }

  frame(dt: number, gdt: number): void {
    const g = this.game;
    this.timer.step(gdt);
    this.smoke.step(gdt, dt);
    if (this.smoke.alarm) g.hud.setAlarm('🚨 Smoke alarm! Turn the heat down and let it air out');
    if (g.liquids.fireCount > 0) g.hud.setAlarm('🔥 Grease fire! Cover it with a lid — never water');

    // Sizzle ∝ surface moisture × how hot the surface it meets is, over every face touching a pan,
    // grate or hot oil (a dry crust still crackles a little from rendering fat).
    let sizzle = 0;
    for (const [h, f] of g.sim.foods) {
      const th = f.thermal;
      this.lastEvap.set(h, th.evaporated);
      for (let d = 0; d < 6; d++) {
        const e = th.env[d];
        const touch = e.medium === 'oil' ? 1 : e.contactFrac;
        if (touch < 0.05) continue;
        const T = e.medium === 'oil' ? e.fluidT : e.contactT;
        const wet = 0.25 + 0.75 * Math.min(th.crustWater(d) / Math.max(th.crustMax, 1e-9), 1);
        sizzle += touch * wet * Math.min(Math.max((T - 100) / 150, 0), 1.5);
      }
    }
    for (const h of this.lastEvap.keys()) if (!g.sim.foods.has(h)) this.lastEvap.delete(h);
    let boil = 0;
    for (const k of g.liquids.all) boil = Math.max(boil, k.c.water > 0.05 ? k.c.vigor : 0);
    boil = Math.max(boil, g.appliances.fryer.oil.vigor);
    const paused = g.loop.paused || gdt <= 0;
    g.audio.setLevels(paused ? 0 : Math.min(sizzle, 1), paused ? 0 : boil, this.smoke.alarm);

    this.updateHeld();
    this.updatePlates(dt);
  }

  private updateHeld(): void {
    const g = this.game;
    const h = g.grab.heldHandle;
    const it = h !== null ? g.items.get(h) : undefined;
    if (!it) {
      g.hud.setHeld(this.hover);
      return;
    }
    const lines = [`<b>${it.def.name}</b>${g.grab.grab.saturated ? ' (heavy!)' : ''}`];
    const T = g.tools.touchTemp(h!);
    const food = g.sim.foods.get(h!);
    if (food) lines.push(`surface ${Math.round(cToF(food.thermal.surfaceTemp()))}°F`);
    else if (T !== null) lines.push(`${Math.round(cToF(T))}°F to the touch`);
    const gripped = g.tools.grip ? g.items.get(g.tools.grip.food) : undefined;
    if (gripped) lines.push(`holding ${gripped.def.name.toLowerCase()} — rotate to flip, Space to let go`);
    lines.push('<span style="opacity:.7">A/D tilt · wheel spin · Shift+wheel flip · W/S depth</span>');
    g.hud.setHeld(lines.join('<br>'));
  }

  /** Food resting on a plate for a second gets a "how did it turn out" card. */
  private updatePlates(dt: number): void {
    const g = this.game;
    const plates = [...g.items.values()].filter((i) => i.def.id === 'plate').map((i) => i.entry.body.translation());
    for (const [h] of g.sim.foods) {
      const e = g.physics.entries.get(h);
      if (!e || g.grab.heldHandle === h || (g.tools.grip && g.tools.grip.food === h)) continue;
      const p = e.body.translation();
      const v = e.body.linvel();
      const on = plates.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.12 && p.y > q.y && p.y - q.y < 0.08) && Math.hypot(v.x, v.y, v.z) < 0.05;
      if (!on) {
        this.plateTimers.delete(h);
        this.inspected.delete(h);
        continue;
      }
      const t = (this.plateTimers.get(h) ?? 0) + dt;
      this.plateTimers.set(h, t);
      if (t > 1 && !this.inspected.has(h)) {
        this.inspected.add(h);
        this.inspect(h);
      }
    }
  }

  inspect(handle: number): void {
    const g = this.game;
    const food = g.sim.foods.get(handle);
    const it = g.items.get(handle);
    if (!food || !it) return;
    const dough = g.baking.doughs.get(handle);
    const name = (it.entry.data.doughName as string | undefined) ?? it.def.name;
    const card = inspectFood(food, name, { bake: dough ? bakeReport(food, dough) : undefined });
    g.hud.showCard(card.title, card.rows, card.notes);
    this.lastCard = card.title;
  }

  /** I key: inspect what you're holding, or the food nearest the middle of the screen. */
  inspectNearest(): void {
    const g = this.game;
    const held = g.grab.heldHandle;
    if (held !== null && g.sim.foods.has(held)) return this.inspect(held);
    let best: number | null = null;
    let bd = Infinity;
    for (const [h] of g.sim.foods) {
      const t = g.physics.entries.get(h)?.body.translation();
      if (!t) continue;
      const v = new THREE.Vector3(t.x, t.y, t.z).project(g.camera);
      const d = Math.hypot(v.x, v.y);
      if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best !== null) this.inspect(best);
  }
}
