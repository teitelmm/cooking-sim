import type { Game } from '../game';
import { KITCHEN } from '../world/kitchenLayout';
import { fToC } from '../sim/units';

/**
 * Stress scene for profiling: every station running with food on it, plus a crowd of props, so the
 * kitchen has 40+ rigid bodies and a dozen foods simulating at once.
 */
export function stressScene(game: Game): { bodies: number; foods: number } {
  const g = game;
  const top = KITCHEN.counterTop;
  const zone = (id: string) => KITCHEN.zones.find((z) => z.id === id)!;
  const a = g.appliances;
  // Pans with steaks on all four burners.
  const pans = ['cast-iron-pan', 'stainless-pan', 'nonstick-pan', 'saute-pan'];
  for (let i = 0; i < 4; i++) {
    const z = zone(`burner-${i}`);
    // Keep the starting skillet if it's already on its burner.
    const occupied = [...g.heat.cookware].some(([h]) => {
      const p = g.bodyPos(h);
      return Math.hypot(p.x - z.pos[0], p.z - z.pos[2]) < 0.08;
    });
    if (!occupied) g.spawn(pans[i], { x: z.pos[0], y: z.pos[1] + 0.03, z: z.pos[2] });
    g.spawn(i % 2 ? 'chicken-breast' : 'strip-steak', { x: z.pos[0], y: z.pos[1] + 0.09, z: z.pos[2] });
    a.burners[i].knob = 0.7;
  }
  // Grill: ribs and a steak.
  const gr = zone('grill');
  a.grill.knobs.fill(1);
  g.spawn('ribs', { x: gr.pos[0] - 0.08, y: gr.pos[1] + 0.08, z: gr.pos[2] - 0.1 });
  g.spawn('ribeye-1in', { x: gr.pos[0] + 0.08, y: gr.pos[1] + 0.08, z: gr.pos[2] + 0.12 });
  // Griddle: chicken thighs.
  const gd = zone('griddle');
  a.griddle.setC = fToC(400);
  for (let i = 0; i < 2; i++) g.spawn('chicken-thigh', { x: gd.pos[0] - 0.1 + i * 0.2, y: gd.pos[1] + 0.06, z: gd.pos[2] });
  // Oven: a whole chicken roasting.
  const ov = zone('oven');
  a.oven.mode = 'bake';
  a.oven.setC = fToC(425);
  g.spawn('whole-chicken', { x: ov.pos[0], y: ov.pos[1], z: ov.pos[2] });
  // Fryer and sous vide.
  a.fryer.on = true;
  const fr = zone('fryer');
  g.spawn('potato', { x: fr.pos[0], y: fr.pos[1] + 0.2, z: fr.pos[2] });
  a.sousVide.on = true;
  const sv = zone('sous-vide');
  g.spawn('egg', { x: sv.pos[0], y: sv.pos[1] + 0.1, z: sv.pos[2] });
  // A crowd of props on the prep and plating counters.
  const props = ['carrot', 'onion', 'bell-pepper', 'mushroom', 'garlic', 'broccoli', 'egg', 'plate', 'mixing-bowl', 'wooden-spoon', 'tongs', 'whisk'];
  let n = 0;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 9; i++) {
      const id = props[n++ % props.length];
      const x = (row < 2 ? 1.5 : 7.45) + i * (row < 2 ? 0.13 : 0.08);
      g.spawn(id, { x, y: top + 0.12 + row * 0.02, z: row === 1 ? 0.22 : -0.02 });
    }
  }
  return { bodies: g.physics.dynamicCount, foods: g.sim.foods.size };
}
