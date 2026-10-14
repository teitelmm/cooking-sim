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

const settle = (page) => page.waitForFunction(() => !window.__game.rig.moving, null, { timeout: 30_000 });

scenarios.appliances = async ({ page, shot, game, wait, assert }) => {
  // --- Range: drag the front-left burner knob (under the cast-iron pan) to high.
  await game(() => window.__game.rig.focusOn({ x: 3.2, y: 1.38 }));
  await settle(page);
  const pan = await game(() => {
    const g = window.__game;
    const [h] = [...g.heat.cookware].find(([, c]) => c.id === 'cast-iron-pan');
    return { h, T: g.heat.cookware.get(h).T };
  });
  const knob = await game(() => window.__game.toScreen(2.92, 0.81, 0.337));
  await mouseDrag(page, knob.x, knob.y, knob.x + 160, knob.y - 160, 15);
  const knobVal = await game(() => window.__game.appliances.burners[2].knob);
  assert(knobVal > 0.9, `burner knob turned up by dragging (${knobVal.toFixed(2)})`);
  await game(() => window.__game.fastForward(240));
  const panT = await game((h) => window.__game.heat.cookware.get(h).T, pan.h);
  const F = (c) => (c * 9) / 5 + 32;
  console.log(`     cast iron: ${F(pan.T).toFixed(0)}°F → ${F(panT).toFixed(0)}°F after 4 min on high`);
  assert(F(panT) > F(pan.T) + 200, 'pan heats on the burner');
  // --- Oven: MODE (→ bake), then wait for preheat.
  const mode = await game(() => window.__game.toScreen(3.36, 0.985, -0.262));
  await page.mouse.click(mode.x, mode.y);
  const ovenMode = await game(() => window.__game.appliances.oven.mode);
  assert(ovenMode === 'bake', `MODE button switches the oven to bake (${ovenMode})`);
  await game(() => window.__game.fastForward(14 * 60));
  const oven = await game(() => ({ pre: window.__game.appliances.oven.preheated, T: window.__game.appliances.oven.airT }));
  console.log(`     oven after 14 min: ${F(oven.T).toFixed(0)}°F preheated=${oven.pre}`);
  assert(oven.pre, 'oven preheats within ~14 min');
  await wait(1500);
  await shot('range-hot');

  // --- Grill: steak on the hot left zone, then flip it to show grill marks.
  await game(() => {
    const g = window.__game;
    g.appliances.grill.knobs[0] = 1;
    g.fastForward(600);
    const s = g.spawn('steak', { x: 3.76, y: 0.95, z: 0.0 });
    g.physics.step();
    for (let i = 0; i < 120; i++) g.physics.step();
    window.__grillSteak = s.entry.body.handle;
    g.fastForward(150, 0.5);
  });
  const marks = await game(() => {
    const g = window.__game;
    const f = g.sim.foods.get(window.__grillSteak).thermal;
    const b = [];
    for (let i = 0; i < f.faceCount; i++) if (f.faceDir[i] === 3) b.push(f.brown[i] + f.charred[i] * 2);
    const mean = b.reduce((x, y) => x + y, 0) / b.length;
    const varc = b.reduce((x, y) => x + (y - mean) ** 2, 0) / b.length;
    return { mean, sd: Math.sqrt(varc), max: Math.max(...b), min: Math.min(...b) };
  });
  console.log(`     grill marks: browning+char mean ${marks.mean.toFixed(2)} min ${marks.min.toFixed(2)} max ${marks.max.toFixed(2)}`);
  assert(marks.max - marks.min > 0.5, 'grill bars leave distinct marks');
  await game(() => {
    const g = window.__game;
    const e = g.physics.entries.get(window.__grillSteak);
    e.body.setTranslation({ x: 4.3, y: 0.99, z: 0.05 }, true);
    e.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    for (let i = 0; i < 60; i++) g.physics.step();
    g.physics.sync();
    g.rig.focusOn({ x: 4.05, y: 1.32 });
  });
  await settle(page);
  await wait(1500);
  await shot('grill-marks');

  // --- Sous vide and air fryer readouts.
  await game(() => {
    const g = window.__game;
    g.appliances.sousVide.on = true;
    g.appliances.airFryer.timer = 10 * 60;
    g.fastForward(20 * 60);
    g.rig.focusOn({ x: 5.85, y: 1.4 });
  });
  await settle(page);
  await wait(1500);
  const sv = await game(() => window.__game.appliances.sousVide.T);
  console.log(`     sous vide after 20 min: ${F(sv).toFixed(1)}°F`);
  assert(Math.abs(F(sv) - 131) < 1, 'sous vide holds 131 °F');
  await shot('airfryer-sousvide');
};

scenarios.sousvide = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    g.appliances.sousVide.on = true;
    g.fastForward(25 * 60);
    const bag = g.spawn('vacuum-bag', { x: 5.95, y: 0.91, z: 0.18 });
    const s = g.spawn('steak', { x: 5.95, y: 0.95, z: 0.18 });
    for (let i = 0; i < 60; i++) {
      g.physics.step();
      g.updateBagging(1 / 30);
    }
    const sh = s.entry.body.handle;
    const bagged = !!g.physics.entries.get(sh).data.bagged;
    const bagGone = !g.items.has(bag.entry.body.handle);
    const level0 = g.appliances.sousVideVolume.level;
    // Drop it into the bath.
    g.physics.entries.get(sh).body.setTranslation({ x: 6.2, y: 1.06, z: 0.0 }, true);
    for (let i = 0; i < 360; i++) g.physics.step();
    g.physics.sync();
    const y = g.bodyPos(sh).y;
    const level1 = g.appliances.sousVideVolume.level;
    g.fastForward(2 * 3600, 1);
    const f = g.sim.foods.get(sh);
    return { bagged, bagGone, y, rise: (level1 - level0) * 1000, coreF: f.coreF, browning: f.thermal.browning(), medium: f.thermal.env[2].medium };
  });
  console.log(`     ${JSON.stringify(r)}`);
  assert(r.bagged && r.bagGone, 'steak dropped on the bag gets vacuum sealed');
  assert(r.y < 0.95, `bagged steak sinks in the bath (y=${r.y.toFixed(3)})`);
  assert(r.rise > 1, `water level rises when it goes in (${r.rise.toFixed(1)} mm)`);
  assert(r.medium === 'bag' && Math.abs(r.coreF - 131) < 1.5, `cooks to 131 °F in the bag (${r.coreF.toFixed(1)})`);
  assert(r.browning === 0, 'no browning in the bag');
  await game(() => window.__game.rig.focusOn({ x: 6.15, y: 1.36 }));
  await settle(page);
  await wait(1500);
  await shot('sous-vide-bath');
};
