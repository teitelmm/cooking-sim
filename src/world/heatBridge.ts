import * as THREE from 'three';
import { RAPIER, type BodyEntry, type PhysicsWorld } from '../engine/physics';
import { Cookware, COOKWARE } from '../sim/cookware';
import type { FoodItem } from '../sim/food';
import type { Contents } from '../sim/liquid';
import { airEnv, DIRS, H, type FaceEnv } from '../sim/foodThermal';
import { abovePanEnv } from '../sim/recipes';
import { ROOM_C } from '../sim/units';
import { GRILL_BARS, KITCHEN, type Zone } from './kitchenLayout';
import { inZone, zone, type KitchenAppliances } from './kitchenAppliances';

type Contact =
  | { kind: 'cookware'; pan: Cookware }
  | { kind: 'griddle' }
  | { kind: 'grill'; zone: number }
  | { kind: 'rack' }
  | { kind: 'flame'; burner: number }
  | { kind: 'cold' }
  | { kind: 'none' };

type Fluid = 'oven' | 'airFryer' | 'sousVide' | Contents | null;

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

/** How a food item (or cookware) is coupled to the kitchen's heat sources, decided from physics each tick. */
export class HeatBridge {
  readonly cookware = new Map<number, Cookware>();
  private lastContact = new Map<number, Contact>();
  private lastFluid = new Map<number, Fluid>();
  private lastDrip = new Map<number, number>();
  private readonly burnerZones = KITCHEN.zones.filter((z) => z.kind === 'burner');
  private readonly zOven = zone('oven');
  private readonly zAir = zone('air-fryer');
  private readonly zSous = zone('sous-vide');
  private readonly zGriddle = zone('griddle');
  private readonly zGrill = zone('grill');

  /** Liquid (in a pot/pan) a world point is submerged in, if any. Set by the game. */
  liquidAt: ((p: THREE.Vector3) => Contents | null) | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly appl: KitchenAppliances,
    /** Food items keyed by body handle. */
    private readonly foods: Map<number, FoodItem>,
  ) {}

  registerCookware(handle: number, itemId: string): Cookware | null {
    const spec = COOKWARE[itemId];
    if (!spec) return null;
    const c = new Cookware(itemId, spec);
    this.cookware.set(handle, c);
    const e = this.physics.entries.get(handle);
    if (e) e.data.cookware = c;
    return c;
  }

  unregister(handle: number): void {
    this.cookware.delete(handle);
    this.lastContact.delete(handle);
    this.lastFluid.delete(handle);
    this.lastDrip.delete(handle);
  }

  step(dt: number): void {
    const a = this.appl;
    // 1. Hand last tick's food heat draw back to whatever supplied it.
    for (const [h, food] of this.foods) {
      const t = food.thermal;
      const c = this.lastContact.get(h);
      if (c && t.contactHeat > 0) {
        if (c.kind === 'cookware') c.pan.load += t.contactHeat;
        else if (c.kind === 'griddle') a.griddle.load += t.contactHeat;
        else if (c.kind === 'grill') a.grill.load[c.zone] += t.contactHeat;
        else if (c.kind === 'rack') a.oven.load += t.contactHeat;
      }
      const fl = this.lastFluid.get(h);
      if (fl && t.fluidHeat > 0) {
        if (typeof fl === 'string') a[fl].load += t.fluidHeat;
        else fl.load += t.fluidHeat;
      }
      t.contactHeat = 0;
      t.fluidHeat = 0;
    }

    // 2. Appliances.
    a.airFryer.basketIn = [...this.cookware].some(([h, c]) => c.id === 'air-fryer-basket' && this.bodyIn(h, this.zAir, 0.04));
    a.step(dt);

    // 3. Cookware: what is it sitting on / in?
    for (const [h, pan] of this.cookware) {
      const e = this.physics.entries.get(h);
      if (!e) continue;
      const p = e.body.translation();
      pan.burner = null;
      pan.externalW = 0;
      pan.ambientC = ROOM_C;
      pan.ambientH = 10;
      const bi = this.burnerZones.findIndex((z) => Math.abs(p.x - z.pos[0]) < 0.11 && Math.abs(p.z - z.pos[2]) < 0.11 && Math.abs(p.y - z.pos[1]) < 0.05);
      if (bi >= 0) {
        pan.burner = a.burners[bi];
        pan.coupling = Math.min(1, pan.spec.baseArea / 0.045);
      } else if (inZone(this.zOven, p) && !a.oven.doorOpen) {
        pan.ambientC = a.oven.airT;
        pan.ambientH = a.oven.fan ? H.convectionOven : H.oven;
        pan.externalW = 0.85 * 5.67e-8 * pan.spec.outerArea * ((a.oven.wallT + 273) ** 4 - (pan.T + 273) ** 4) * 0.5;
      } else if (inZone(this.zAir, p, 0.03) && a.airFryer.basketIn) {
        pan.ambientC = a.airFryer.T;
        pan.ambientH = a.airFryer.running ? H.airFryer : 12;
      } else if (inZone(this.zGriddle, p, 0.02)) {
        const w = 250 * pan.spec.baseArea * (a.griddle.T - pan.T);
        pan.externalW = w;
        a.griddle.load += w * dt;
      } else if (inZone(this.zGrill, p, 0.03)) {
        const z = p.x < this.zGrill.pos[0] ? 0 : 1;
        const w = 120 * pan.spec.baseArea * (a.grill.grateT[z] - pan.T) + 0.8 * 5.67e-8 * pan.spec.baseArea * ((a.grill.radiantT[z] + 273) ** 4 - (pan.T + 273) ** 4) * 0.5;
        pan.externalW = w;
        a.grill.load[z] += Math.max(0, w) * dt * 0.3;
      }
      pan.step(dt);
    }

    // 4. Food environments.
    for (const [h, food] of this.foods) {
      const e = this.physics.entries.get(h);
      if (!e) continue;
      this.assignFood(h, e, food);
    }
  }

  private bodyIn(h: number, z: Zone, pad = 0): boolean {
    const e = this.physics.entries.get(h);
    return !!e && inZone(z, e.body.translation(), pad);
  }

  /** Which local face direction points most along a world direction. */
  private localDirAlong(q: THREE.Quaternion, world: THREE.Vector3): number {
    let best = 0;
    let bd = -Infinity;
    DIRS.forEach((d, i) => {
      const v = tmpV.set(d[0], d[1], d[2]).applyQuaternion(q);
      const s = v.dot(world);
      if (s > bd) {
        bd = s;
        best = i;
      }
    });
    return best;
  }

  private assignFood(h: number, e: BodyEntry, food: FoodItem): void {
    const a = this.appl;
    const t = food.thermal;
    const p = e.body.translation();
    const r = e.body.rotation();
    const q = tmpQ.set(r.x, r.y, r.z, r.w).clone();
    const down = this.localDirAlong(q, new THREE.Vector3(0, -1, 0));
    const up = down ^ 1;
    const center = (e.data.foodCenter as number[]) ?? [0, 0, 0];
    const world = new THREE.Vector3(p.x, p.y, p.z);
    const centerW = new THREE.Vector3(...center).applyQuaternion(q).add(world);

    // Immersed / enclosed first.
    let fluid: Fluid = null;
    let contact: Contact = { kind: 'none' };
    const envs: FaceEnv[] = [];
    const liquid = this.liquidAt?.(centerW) ?? null;
    if (liquid) {
      // In a pot of water (simmering/boiling) or a pan/pot of oil (frying).
      fluid = liquid;
      const oil = liquid.kind === 'oil';
      const wet = t.crustWater() > t.crustMax * 0.2;
      const h = oil ? (wet ? H.fry : 220) : liquid.vigor > 0.5 ? H.boil : liquid.vigor > 0.1 ? H.simmer : 300;
      const env: FaceEnv = { medium: oil ? 'oil' : e.data.bagged ? 'bag' : 'water', fluidT: liquid.T, fluidH: h, contactT: liquid.T, contactH: 0, contactFrac: 0, radT: liquid.T, radView: 0 };
      for (let d = 0; d < 6; d++) envs.push(env);
    } else if (inZone(this.zSous, centerW) && centerW.y < (a.sousVideVolume?.level ?? a.sousVideLevel)) {
      fluid = 'sousVide';
      const bagged = !!e.data.bagged;
      const env: FaceEnv = { medium: bagged ? 'bag' : 'water', fluidT: a.sousVide.T, fluidH: bagged ? H.sousVide : 500, contactT: a.sousVide.T, contactH: 0, contactFrac: 0, radT: a.sousVide.T, radView: 0 };
      for (let d = 0; d < 6; d++) envs.push(env);
    } else {
      contact = this.support(e, food, q, centerW);
      const inOven = inZone(this.zOven, centerW) && !a.oven.doorOpen;
      const inAir = inZone(this.zAir, centerW, 0.03) && a.airFryer.basketIn;
      let baseAir: FaceEnv;
      if (inOven) {
        fluid = 'oven';
        baseAir = { medium: 'air', fluidT: a.oven.airT, fluidH: a.oven.fan ? H.convectionOven : H.oven, contactT: a.oven.airT, contactH: 0, contactFrac: 0, radT: a.oven.wallT, radView: 0.85 };
      } else if (inAir) {
        fluid = 'airFryer';
        baseAir = { medium: 'air', fluidT: a.airFryer.T, fluidH: a.airFryer.running ? H.airFryer : 12, contactT: a.airFryer.T, contactH: 0, contactFrac: 0, radT: a.airFryer.T, radView: 0.6 };
      } else baseAir = airEnv();
      for (let d = 0; d < 6; d++) envs.push({ ...baseAir });

      // Above a hot surface: the pan/griddle/grill heats the faces around the food too.
      const surfT = this.contactTemp(contact, centerW);
      if (!inOven && !inAir && surfT !== null) {
        for (let d = 0; d < 6; d++) if (d !== down) envs[d] = abovePanEnv(surfT, d !== up);
      }
      if (contact.kind === 'grill') {
        const g = a.grill;
        const hood: FaceEnv = g.lidClosed
          ? { medium: 'air', fluidT: g.hoodT, fluidH: 15, contactT: g.hoodT, contactH: 0, contactFrac: 0, radT: g.hoodT, radView: 0.7 }
          : airEnv(32, 10);
        for (let d = 0; d < 6; d++) if (d !== down) envs[d] = { ...hood };
      }
      if (inOven && a.oven.mode === 'broil') envs[up] = { ...envs[up], radT: a.oven.elementT, radView: 0.45 };

      // The face resting on something.
      const dEnv = envs[down];
      if (surfT !== null) {
        const oiled = contact.kind === 'cookware' && (contact.pan.contents?.oil ?? 0) > 0.003;
        const ch =
          contact.kind === 'grill'
            ? H.grillContact
            : contact.kind === 'rack'
              ? 180
              : contact.kind === 'flame'
                ? 60
                : contact.kind === 'cold'
                  ? 40
                  : contact.kind === 'cookware' && !oiled
                    ? 300 // a dry pan makes patchy contact
                    : H.panContact;
        envs[down] = { ...dEnv, contactT: surfT, contactH: ch, contactFrac: contact.kind === 'cold' ? 0.6 : 0.9 };
        if (contact.kind === 'grill') {
          const z = contact.zone;
          // Through the grate the food sees the flame tamers (partly blocked by bars); flare-ups lick it.
          const flare = a.grill.flaring ? 800 : 0;
          envs[down].radT = Math.max(a.grill.radiantT[z], flare);
          envs[down].radView = flare ? 0.4 : 0.22;
          envs[down].fluidT = 40 + (a.grill.radiantT[z] - 22) * 0.3;
          envs[down].fluidH = 12;
        }
        if (contact.kind === 'flame') {
          const b = a.burners[contact.burner];
          envs[down].radT = 400 + 700 * (b.power / b.spec.maxW);
          envs[down].radView = b.power > 20 ? 0.6 : 0;
        }
      }
    }
    for (let d = 0; d < 6; d++) food.setEnv(d, envs[d]);

    // Grill marks: only faces over a bar touch the grate.
    t.contactWeight.fill(1);
    if (contact.kind === 'grill') {
      const per = GRILL_BARS.width + GRILL_BARS.gap;
      for (let f = 0; f < t.faceCount; f++) {
        if (t.faceDir[f] !== down) continue;
        const cc = t.cellCenter(t.faceCell[f]);
        const wp = new THREE.Vector3(cc[0] + center[0], cc[1] + center[1], cc[2] + center[2]).applyQuaternion(q).add(world);
        const u = (((wp.x - GRILL_BARS.x0) % per) + per) % per;
        t.contactWeight[f] = u < GRILL_BARS.width + 0.002 ? 1 : 0.06;
      }
    }

    // Fat dripping onto the flame tamers feeds flare-ups.
    const drip = t.drippings - (this.lastDrip.get(h) ?? t.drippings);
    this.lastDrip.set(h, t.drippings);
    if (contact.kind === 'grill' && drip > 0) a.grill.addDrippings(drip);

    this.lastContact.set(h, contact);
    this.lastFluid.set(h, fluid);
  }

  /** What the food rests on, by short ray casts down from under it. */
  private support(e: BodyEntry, food: FoodItem, q: THREE.Quaternion, centerW: THREE.Vector3): Contact {
    const s = food.size;
    // Half-extent along world Y of the rotated food box.
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const hy = Math.abs(m[1]) * s[0] * 0.5 + Math.abs(m[5]) * s[1] * 0.5 + Math.abs(m[9]) * s[2] * 0.5;
    const offs = [
      [0, 0],
      [0.3, 0.3],
      [-0.3, 0.3],
      [0.3, -0.3],
      [-0.3, -0.3],
    ];
    let best: { toi: number; collider: RAPIER.Collider; point: THREE.Vector3 } | null = null;
    for (const [ox, oz] of offs) {
      const o = { x: centerW.x + ox * s[0] * 0.5, y: centerW.y, z: centerW.z + oz * s[2] * 0.5 };
      const hit = this.physics.world.castRay(new RAPIER.Ray(o, { x: 0, y: -1, z: 0 }), hy + 0.012, true, undefined, undefined, undefined, e.body);
      if (hit && (!best || hit.timeOfImpact < best.toi)) {
        const c = hit.collider;
        best = { toi: hit.timeOfImpact, collider: c, point: new THREE.Vector3(o.x, o.y - hit.timeOfImpact, o.z) };
      }
    }
    if (!best) return { kind: 'none' };
    const other = this.physics.bodyOfCollider(best.collider.handle);
    if (other?.data.cookware) return { kind: 'cookware', pan: other.data.cookware as Cookware };
    const pt = best.point;
    if (inZone(this.zGriddle, pt, 0.02)) return { kind: 'griddle' };
    if (inZone(this.zGrill, pt, 0.03)) return { kind: 'grill', zone: pt.x < this.zGrill.pos[0] ? 0 : 1 };
    if (inZone(this.zOven, pt)) return { kind: 'rack' };
    const bi = this.burnerZones.findIndex((z) => inZone(z, pt, 0.02));
    if (bi >= 0) return { kind: 'flame', burner: bi };
    return { kind: 'cold' };
  }

  private contactTemp(c: Contact, at: THREE.Vector3): number | null {
    const a = this.appl;
    switch (c.kind) {
      case 'cookware': {
        const pe = [...this.cookware].find(([, v]) => v === c.pan);
        const pp = pe ? this.physics.entries.get(pe[0])?.body.translation() : null;
        const rr = pp ? Math.hypot(at.x - pp.x, at.z - pp.z) / 0.12 : 0.5;
        return c.pan.surfaceAt(rr);
      }
      case 'griddle':
        return a.griddle.T;
      case 'grill':
        return a.grill.grateT[c.zone];
      case 'rack':
        return a.oven.wallT;
      case 'flame':
        return ROOM_C + 60 * (a.burners[c.burner].power / a.burners[c.burner].spec.maxW);
      case 'cold':
        return ROOM_C;
      default:
        return null;
    }
  }
}
