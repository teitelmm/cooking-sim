import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FoodItem } from '../src/sim/food';
import { CUT_MODES, cutIntoPieces, minPieceFrac, planesFor } from '../src/world/autoCutterCore';

const SIZE: [number, number, number] = [0.116, 0.068, 0.08];

function potatoHull(): [number, number, number][] {
  const g = new THREE.SphereGeometry(0.04, 16, 10);
  g.scale(1.45, 0.85, 1);
  const pos = g.attributes.position;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  return pts;
}

function run(id: string) {
  const mode = CUT_MODES.find((m) => m.id === id)!;
  const potato = new FoodItem('potato', SIZE);
  const total = potato.thermal.mass();
  const pieces = cutIntoPieces(potato, potatoHull(), planesFor(mode, SIZE), 120, minPieceFrac(mode));
  const mass = pieces.reduce((s, p) => s + p.food.thermal.mass(), 0);
  return { pieces, total, mass };
}

describe('auto-cutter', () => {
  it('fries: 3/8" sticks running the length of the potato', () => {
    const { pieces, total, mass } = run('fries');
    expect(pieces.length).toBeGreaterThan(20);
    expect(pieces.length).toBeLessThan(80);
    expect(mass / total).toBeGreaterThan(0.85);
    // Inner sticks: two short sides ≈ 9.5 mm, long side ≫.
    const inner = pieces.filter((p) => p.food.size[0] > 0.07);
    expect(inner.length).toBeGreaterThan(8);
    for (const p of inner) {
      expect(p.food.size[1]).toBeLessThan(0.0125);
      expect(p.food.size[2]).toBeLessThan(0.0125);
    }
  });

  it('wedges: 8 long wedges', () => {
    const { pieces } = run('wedges');
    expect(pieces.length).toBe(8);
    for (const p of pieces) expect(p.food.size[0]).toBeGreaterThan(0.1);
  });

  it('slices and dice give different geometry', () => {
    const s = run('slices').pieces;
    const d = run('dice').pieces;
    expect(s.length).toBeGreaterThan(10);
    for (const p of s.filter((q) => q.food.size[1] > 0.04)) expect(p.food.size[0]).toBeLessThan(0.009);
    const cubes = d.filter((p) => p.food.size.every((x) => x < 0.022));
    expect(cubes.length).toBeGreaterThan(5);
  });
});
