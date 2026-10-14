// Each scenario receives { page, shot, game, wait, assert }.
export const scenarios = {
  async smoke({ shot, game, wait, assert }) {
    await wait(1500);
    const bodies = await game(() => window.__game.physics.dynamicCount);
    assert(bodies >= 1, 'scene has dynamic bodies');
    await shot('smoke');
  },
};

/** Drag with the mouse from (x0,y) to (x1,y) in `steps` moves. */
export async function mouseDrag(page, x0, y0, x1, y1, steps = 20, holdMs = 0) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

const camState = () => {
  const c = window.__game.camera;
  return { x: c.position.x, y: c.position.y, q: c.quaternion.toArray() };
};

scenarios.pan = async ({ page, shot, game, wait, assert }) => {
  await wait(800);
  const s0 = await game(camState);
  await shot('pan-0');
  // Drag left across empty space (upper area = wall, nothing grabbable).
  await mouseDrag(page, 900, 120, 400, 120, 20);
  await wait(1200);
  const s1 = await game(camState);
  await shot('pan-1');
  await mouseDrag(page, 900, 120, 300, 120, 20);
  await wait(1200);
  const s2 = await game(camState);
  await shot('pan-2');
  assert(s1.x < s0.x - 0.2, `camera moved left (${s0.x.toFixed(2)} → ${s1.x.toFixed(2)})`);
  assert(s2.x < s1.x - 0.2, `camera moved further left (${s1.x.toFixed(2)} → ${s2.x.toFixed(2)})`);
  const same = s0.q.every((v, i) => Math.abs(v - s2.q[i]) < 1e-9);
  assert(same, 'camera orientation unchanged');
};

scenarios.grab = async ({ page, shot, game, wait, assert }) => {
  await wait(1500);
  const s = await game(() => window.__game.screenOf('steak'));
  assert(s, 'steak on screen');
  const p0 = await game((h) => window.__game.bodyPos(h), s.handle);
  // Pick up the steak and carry it right and up; screenshot mid-drag.
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(s.x + i * 10, s.y - i * 6);
    await wait(16);
  }
  await wait(400);
  const held = await game(() => window.__game.grab.heldHandle);
  const p1 = await game((h) => window.__game.bodyPos(h), s.handle);
  await shot('grab');
  await page.mouse.up();
  await wait(1500);
  const p2 = await game((h) => window.__game.bodyPos(h), s.handle);
  assert(held === s.handle, 'steak is held');
  assert(p1.x > p0.x + 0.1 && p1.y > p0.y + 0.05, `steak moved while held (${JSON.stringify(p0)} → ${JSON.stringify(p1)})`);
  assert(p2.y < p1.y, 'steak falls after release');
  await shot('grab-released');
};

scenarios.kitchen = async ({ page, shot, game, wait, assert }) => {
  await wait(1000);
  const xs = [0.85, 2.4, 3.7, 5.2, 6.6, 7.35];
  for (let i = 0; i < xs.length; i++) {
    await game((x) => window.__game.rig.focusOn({ x, y: 1.5 }), xs[i]);
    await page.waitForFunction(() => !window.__game.rig.moving, null, { timeout: 30_000 });
    await wait(300);
    const x = await game(() => window.__game.rig.x);
    assert(Math.abs(x - xs[i]) < 0.05, `camera reached x=${xs[i]} (at ${x.toFixed(2)})`);
    await shot(`kitchen-pan-${i}`);
  }
  // Real drag across from right edge back left.
  const before = await game(() => window.__game.rig.x);
  await mouseDrag(page, 1000, 60, 200, 60, 25);
  await wait(800);
  const after = await game(() => window.__game.rig.x);
  assert(after < before - 0.5, 'background drag pans the kitchen');
  await wait(2000);
  const fps = await game(() => window.__game.overlay.fps);
  console.log(`     idle FPS (software renderer): ${fps.toFixed(1)}`);
};

scenarios.spawner = async ({ page, shot, game, wait, assert }) => {
  await game(() => window.__game.rig.focusOn({ x: 0.85, y: 1.45 }));
  await page.waitForFunction(() => !window.__game.rig.moving, null, { timeout: 30_000 });
  const n0 = await game(() => window.__game.items.size);
  const p = await game(() => {
    const g = window.__game;
    const d = g.grab.spawnerDisplays.find((o) => o.userData.spawner.itemId === 'steak');
    const v = d.position.clone().project(g.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(p.x + i * 15, p.y + i * 4);
    await wait(16);
  }
  await wait(500);
  await shot('spawner-drag');
  await page.mouse.up();
  await wait(800);
  const n1 = await game(() => window.__game.items.size);
  assert(n1 === n0 + 1, `dragging the fridge steak spawned one item (${n0} → ${n1})`);
};

scenarios.lineup = async ({ page, shot, game, wait, assert }) => {
  // Clear the prep counter's start items out of the way.
  await game(() => {
    const g = window.__game;
    for (const [h, it] of [...g.items]) if (['steak', 'potato', 'chef-knife', 'cutting-board'].includes(it.def.id)) g.despawn(h);
  });
  const res = await game(() => window.__debug.steakLineup());
  console.log('     ' + res.map((r) => `${r.label}: ${r.doneness} (peak ${r.peakCoreF.toFixed(0)}°F, char ${r.charBottom.toFixed(2)}, juice ${r.juiceMl.toFixed(1)} ml)`).join('\n     '));
  await game(() => window.__game.rig.focusOn({ x: 1.95, y: 1.36 }));
  await page.waitForFunction(() => !window.__game.rig.moving, null, { timeout: 30_000 });
  await game(() => window.__game.rig.dolly(-0.3));
  // Let the juice finish seeping (SwiftShader renders ~1 fps, so step the juice system directly).
  await game(() => {
    for (let i = 0; i < 80; i++) window.__game.juice.update(1 / 30);
  });
  await wait(2500);
  await shot('steak-lineup');
  const pooled = await game(() => window.__game.juice.pools.map((p) => +(p.volume * 1e6).toFixed(2)));
  console.log('     juice pools (ml): ' + pooled.join(', '));
  const order = ['raw', 'rare', 'medium-rare', 'medium', 'medium-well', 'well-done'];
  assert(order.indexOf(res[0].doneness) <= 2, `rare steak is rare-ish (${res[0].doneness})`);
  assert(['medium', 'medium-rare', 'medium-well'].includes(res[1].doneness), `medium steak (${res[1].doneness})`);
  assert(res[2].doneness === 'well-done', `well-done steak (${res[2].doneness})`);
  assert(res[3].charBottom > 0.3, 'flipped-too-late steak is charred on the bottom');
};

/** Ad-hoc debugging: PROBE='return window.__game.items.size' npm run shots -- probe */
scenarios.probe = async ({ game }) => {
  const body = process.env.PROBE;
  if (!body) return;
  const out = await game((src) => new Function(src)(), body);
  console.log('     probe: ' + JSON.stringify(out));
};
