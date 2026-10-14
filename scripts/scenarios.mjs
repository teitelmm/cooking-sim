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

scenarios.liquids = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    const tick = (n) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) g.physics.step();
        g.liquids.frame(1 / 30, []);
      }
      g.physics.sync();
    };
    const potH = [...g.items].find(([, it]) => it.def.id === 'stock-pot')[0];
    const pot = g.physics.entries.get(potH).body;
    // Fill at the sink.
    pot.setTranslation({ x: 7.0, y: 0.69, z: -0.11 }, true);
    tick(30);
    g.liquids.faucetOn = true;
    tick(30 * 28);
    g.liquids.faucetOn = false;
    tick(60);
    const filled = g.liquids.contentsOf(potH).water;
    // Onto the back-right burner, on high.
    pot.setTranslation({ x: 3.4, y: 0.96, z: -0.14 }, true);
    tick(60);
    g.appliances.burners[1].knob = 1;
    let t = 0;
    const c = g.liquids.contentsOf(potH);
    while (c.vigor < 0.6 && t < 3600) {
      g.fastForward(10, 0.5);
      t += 10;
    }
    tick(60);
    // Pour oil from the bottle into the stainless pan on the front-right burner.
    const pan = g.spawn('stainless-pan', { x: 3.4, y: 0.95, z: 0.15 });
    tick(30);
    const bottle = g.spawn('oil-bottle', { x: 3.4, y: 1.15, z: 0.12 });
    bottle.entry.body.setGravityScale(0, true);
    bottle.entry.body.setRotation({ x: 0.906, y: 0, z: 0, w: 0.423 }, true); // tipped ~130°
    bottle.entry.body.setTranslation({ x: 3.4, y: 1.12, z: -0.03 }, true);
    for (let i = 0; i < 60; i++) {
      bottle.entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bottle.entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      tick(1);
    }
    g.despawn(bottle.entry.body.handle);
    tick(60);
    const panC = g.liquids.contentsOf(pan.entry.body.handle);
    const oil = panC.oil;
    g.appliances.burners[3].knob = 1;
    let ts = 0;
    while (panC.smoke < 0.3 && ts < 1200) {
      g.fastForward(5, 0.5);
      ts += 5;
    }
    tick(90);
    return { filled, boilMin: t / 60, potF: (c.T * 9) / 5 + 32, oil, smokeAfterMin: ts / 60, oilF: (panC.T * 9) / 5 + 32, smoke: panC.smoke };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.filled > 2.0, `faucet filled the pot (${r.filled.toFixed(2)} kg)`);
  assert(r.boilMin > 8 && r.boilMin < 22, `rolling boil in a plausible time (${r.boilMin.toFixed(1)} min)`);
  assert(r.oil > 0.02, `oil poured into the pan (${(r.oil * 1000).toFixed(0)} g)`);
  assert(r.smoke >= 0.3 && r.oilF > 450, 'oil smokes past its smoke point');
  await game(() => window.__game.rig.focusOn({ x: 3.25, y: 1.42 }));
  await settle(page);
  await wait(1500);
  await shot('boil-and-smoke');
};

scenarios.probe_therm = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    g.appliances.burners[2].knob = 0.85;
    g.fastForward(300);
    const s = g.spawn('steak', { x: 3.0, y: 0.99, z: 0.15 });
    for (let i = 0; i < 120; i++) g.physics.step();
    g.fastForward(360);
    const sh = s.entry.body.handle;
    const sp = g.bodyPos(sh);
    // Hold the probe angled into the side of the steak.
    const p = g.spawn('probe-thermometer', { x: sp.x - 0.16, y: sp.y + 0.02, z: sp.z });
    const pb = p.entry.body;
    pb.setRotation({ x: 0, y: 0, z: -0.0998, w: 0.995 }, true);
    g.grab.heldHandle = pb.handle;
    let reading = null;
    for (let i = 0; i < 40 && reading === null; i++) {
      pb.setTranslation({ x: sp.x - 0.16 + i * 0.004, y: sp.y + 0.025, z: sp.z }, true);
      g.probes.frame();
      reading = g.probes.readF(sh);
    }
    g.grab.heldHandle = null;
    const core = g.sim.foods.get(sh).coreF;
    return { reading, core };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.reading !== null, 'probe stabbed into the steak');
  assert(Math.abs(r.reading - r.core) < 12, 'probe reads near the core temperature');
  await game(() => window.__game.rig.focusOn({ x: 3.05, y: 1.32 }));
  await settle(page);
  await wait(1500);
  await shot('probe');
};

scenarios.knife = async ({ page, shot, game, wait, assert }) => {
  await game(() => window.__game.rig.focusOn({ x: 2.1, y: 1.36 }));
  await settle(page);
  const r = await game(() => {
    const g = window.__game;
    const find = (id) => [...g.items].find(([, it]) => it.def.id === id);
    const [kh, knife] = find('chef-knife');
    const [ph] = find('potato');
    for (let i = 0; i < 120; i++) g.physics.step();
    const pp = g.bodyPos(ph);
    // Pick the knife up (as if pressed on its handle).
    const kp = knife.entry.body.translation();
    const scr = g.toScreen(kp.x, kp.y, kp.z);
    const info = g.input.info(scr.x, scr.y);
    g.grab.start(kh, { x: kp.x, y: kp.y, z: kp.z, clone() { return this; } }, info);
    const target = (x, y, z) => g.grab.grab.setTarget({ x, y, z });
    const run = (n) => {
      for (let i = 0; i < n; i++) g.physics.step();
    };
    const zC = pp.z + 0.105;
    const startCuts = g.knife.cuts;
    const sizes = [];
    for (let s = 0, made = 0; made < 5 && s < 10; s++) {
      const before = g.knife.cuts;
      // Aim 6 mm in from the current +x end of the potato, a little sloppy.
      const pieces = [...g.items].filter(([, it]) => it.def.id === 'potato').map(([h]) => h);
      const big = pieces.reduce((a, b) => (g.sim.foods.get(a).thermal.mass() > g.sim.foods.get(b).thermal.mass() ? a : b));
      const bp = g.bodyPos(big);
      const half = g.sim.foods.get(big).size[0] / 2;
      const x = bp.x + half - 0.0065 + (s % 2 ? 0.0015 : -0.001);
      target(x, 1.06, zC);
      run(90);
      let maxP = 0;
      for (let k = 0; k < 60; k++) {
        target(x, 1.06 - (k / 60) * 0.13, zC);
        run(2);
        if (g.knife.active) maxP = Math.max(maxP, g.knife.active.progress);
      }
      run(30);
      const br = g.physics.entries.get(big)?.body.rotation();
      if (g.knife.cuts > before) made++;
      window.__strokes = (window.__strokes || []).concat([{ s, x: +x.toFixed(4), half: +half.toFixed(4), maxP: +maxP.toFixed(2), rot: br && [br.x, br.y, br.z, br.w].map((v) => +v.toFixed(2)), n: pieces.length }]);
      target(x, 1.06, zC);
      run(60);
    }
    for (const [h, it] of g.items) if (it.def.id === 'potato') sizes.push(g.sim.foods.get(h).size[0]);
    // Now a seared steak (clear the starting one off the board first).
    for (const [h, it] of [...g.items]) if (it.def.id === 'steak') g.despawn(h);
    const steak = g.spawn('steak', { x: 2.0, y: 0.97, z: 0.05 });
    run(60);
    const sf = g.sim.foods.get(steak.entry.body.handle);
    window.__debug.searFood?.(sf);
    const sp = g.bodyPos(steak.entry.body.handle);
    const pooled0 = g.juice.pooledMl;
    target(sp.x, 1.08, sp.z + 0.105);
    run(90);
    for (let k = 0; k < 80; k++) {
      target(sp.x, 1.08 - (k / 80) * 0.15, sp.z + 0.105);
      run(2);
    }
    run(60);
    for (let i = 0; i < 60; i++) g.juice.update(1 / 30);
    g.grab.end();
    const steakPieces = [...g.items].filter(([, it]) => it.def.id === 'steak').length;
    return { strokes: window.__strokes, cuts: g.knife.cuts - startCuts, sizes: sizes.sort().map((x) => +(x * 1000).toFixed(1)), steakPieces, juiceMl: g.juice.pooledMl - pooled0 };
  });
  console.log('     ' + JSON.stringify(r));
  const slices = r.sizes.filter((s) => s < 15);
  assert(slices.length >= 4, `knife sliced the potato (${slices.length} slices)`);
  const mean = slices.reduce((a, b) => a + b, 0) / slices.length;
  assert(slices.every((s) => Math.abs(s - mean) < 1.6), 'slices are even');
  assert(r.steakPieces === 2, 'knife cut the steak in two');
  await wait(1500);
  await shot('knife-cuts');
};

scenarios.autocutter = async ({ page, shot, game, wait, assert }) => {
  await game(() => window.__game.rig.focusOn({ x: 1.75, y: 1.4 }));
  await settle(page);
  const r = await game(() => {
    const g = window.__game;
    const ac = g.autoCutter;
    const run = (n) => {
      for (let i = 0; i < n; i++) g.physics.step();
      g.physics.sync();
    };
    const pull = (modeIndex) => {
      ac.modeIndex = modeIndex;
      g.spawn('potato', { x: ac.z.pos[0], y: 1.09, z: ac.z.pos[2] + 0.01 });
      run(60);
      ac.lever = 1;
      ac.frame();
      ac.lever = 0;
      ac.frame();
      run(240);
      return ac.lastPieces;
    };
    const fries = pull(1);
    const inBowl = [...g.items].filter(([, it]) => it.def.id === 'potato' && it.def.parts[0].kind === 'hull').filter(([h]) => {
      const p = g.bodyPos(h);
      return Math.hypot(p.x - 1.62, p.z - 0.04) < 0.13 && p.y < 1.0;
    }).length;
    const wedges = pull(2);
    return { fries, inBowl, wedges };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.fries > 20, 'fries mode makes lots of sticks');
  assert(r.inBowl > r.fries * 0.7, 'pieces land in the bowl');
  assert(r.wedges === 8, 'wedges mode makes 8 wedges');
  await wait(1500);
  await shot('auto-cutter');
};

scenarios.pasta = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    const run = (n, frameDt = 1 / 30) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) g.physics.step();
        g.liquids.frame(frameDt, []);
        g.pantry.frame(frameDt);
      }
      g.physics.sync();
    };
    const potH = [...g.items].find(([, it]) => it.def.id === 'stock-pot')[0];
    const c = g.liquids.contentsOf(potH);
    c.add('water', 3.0, 20);
    g.appliances.burners[1].knob = 1;
    let t = 0;
    while (c.vigor < 0.6 && t < 2400) {
      g.fastForward(10);
      t += 10;
    }
    // Salt the water, then tip the spaghetti box in.
    const pot = g.bodyPos(potH);
    for (let i = 0; i < 30; i++) g.pantry.emitGrain({ x: pot.x, y: pot.y + 0.3, z: pot.z, clone() { return { ...this, add(o) { this.x += o.x; this.y += o.y; this.z += o.z; return this; } }; } }, { x: 0, y: 0, z: 0, clone() { return { x: 0, y: 0, z: 0, add(o) { this.x += o.x; this.y += o.y; this.z += o.z; return this; } }; } }, 'salt', 0xffffff);
    const box = g.spawn('pasta-box', { x: pot.x, y: pot.y + 0.32, z: pot.z });
    box.entry.body.setGravityScale(0, true);
    box.entry.body.setRotation({ x: 0, y: 0, z: -0.6, w: 0.8 }, true); // tipped open-end down
    run(90);
    g.despawn(box.entry.body.handle);
    const batch = g.pantry.pasta.get(potH);
    const dry = batch ? batch.dryKg : 0;
    // Cook 9 minutes, stirring every 30 s.
    for (let s = 0; s < 18; s++) {
      batch.stir();
      g.fastForward(30);
    }
    const done = batch.doneness();
    run(30);
    return { boilMin: t / 60, dry, done, R: batch.R, clump: batch.clump, starch: c.starch, salted: g.pantry.salted.get(potH) ?? 0 };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.dry > 0.4, 'spaghetti went into the pot');
  assert(r.done === 'al dente', `al dente after 9 min stirred (${r.done})`);
  assert(r.clump < 0.2, 'stirred pasta did not clump');
  await game(() => window.__game.rig.focusOn({ x: 3.3, y: 1.45 }));
  await settle(page);
  await wait(1500);
  await shot('pasta-pot');
  // Drain into a colander in the sink.
  const d = await game(() => {
    const g = window.__game;
    const potH = [...g.items].find(([, it]) => it.def.id === 'stock-pot')[0];
    const col = g.spawn('colander', { x: 7.0, y: 0.69, z: -0.02 });
    const pot = g.physics.entries.get(potH).body;
    pot.setGravityScale(0, true);
    pot.setTranslation({ x: 7.0 - 0.12, y: 0.93, z: -0.02 }, true);
    pot.setRotation({ x: 0, y: 0, z: -0.643, w: 0.766 }, true); // ~80° tilt toward the colander
    for (let i = 0; i < 150; i++) {
      pot.setLinvel({ x: 0, y: 0, z: 0 }, true);
      pot.setAngvel({ x: 0, y: 0, z: 0 }, true);
      for (let k = 0; k < 4; k++) g.physics.step();
      g.liquids.frame(1 / 30, []);
      g.pantry.frame(1 / 30);
    }
    g.physics.sync();
    const inCol = g.pantry.pasta.get(col.entry.body.handle);
    return { colanderPasta: inCol ? inCol.dryKg : 0, waterLeft: g.liquids.contentsOf(potH).water };
  });
  console.log('     ' + JSON.stringify(d));
  assert(d.colanderPasta > 0.3, 'pasta drained into the colander');
  assert(d.waterLeft < 1.5, 'water poured out');
  await game(() => window.__game.rig.focusOn({ x: 7.0, y: 1.42 }));
  await settle(page);
  await wait(1500);
  await shot('pasta-drain');
};

scenarios.spices = async ({ game, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    const steak = [...g.items].find(([, it]) => it.def.id === 'steak');
    const sh = steak[0];
    for (let i = 0; i < 60; i++) g.physics.step();
    const p = g.bodyPos(sh);
    const shaker = g.spawn('pepper-shaker', { x: p.x, y: p.y + 0.25, z: p.z });
    const b = shaker.entry.body;
    b.setGravityScale(0, true);
    b.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); // upside down
    g.grab.heldHandle = b.handle;
    for (let i = 0; i < 60; i++) {
      b.setLinvel({ x: 0, y: i % 2 ? 0.6 : -0.6, z: 0 }, true); // shake up and down
      g.pantry.frame(1 / 30);
    }
    for (let i = 0; i < 60; i++) g.pantry.frame(1 / 30);
    g.grab.heldHandle = null;
    return g.pantry.flavorsOf(sh);
  });
  console.log('     ' + JSON.stringify(r));
  assert((r.pepper ?? 0) > 0.0002, 'shaking pepper over the steak seasons it');
};

scenarios.frying = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    const run = (n) => {
      for (let i = 0; i < n; i++) g.physics.step();
      g.physics.sync();
    };
    const fr = g.appliances.fryer;
    fr.on = true;
    fr.setC = ((350 - 32) * 5) / 9;
    g.fastForward(20 * 60);
    const hot = fr.oil.T;
    // Fries from the auto-cutter.
    const ac = g.autoCutter;
    ac.modeIndex = 1;
    g.spawn('potato', { x: ac.z.pos[0], y: 1.09, z: ac.z.pos[2] + 0.01 });
    run(60);
    ac.cut();
    run(120);
    const fries = [...g.items].filter(([, it]) => it.def.id === 'potato' && it.def.parts[0].kind === 'hull').map(([h]) => h);
    // Basket into the oil, fries into the basket.
    const basket = g.spawn('fry-basket', { x: 4.9, y: 0.68, z: -0.05 });
    run(60);
    fries.forEach((h, i) => {
      const b = g.physics.entries.get(h).body;
      b.setTranslation({ x: 4.82 + (i % 7) * 0.022, y: 0.7 + Math.floor(i / 21) * 0.02, z: -0.14 + (Math.floor(i / 7) % 3) * 0.04 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    run(120);
    let minT = fr.oil.T;
    for (let s = 0; s < 36; s++) {
      g.fastForward(5);
      minT = Math.min(minT, fr.oil.T);
      run(4);
    }
    const fs = fries.map((h) => g.sim.foods.get(h)).filter(Boolean);
    const avg = (fn) => fs.reduce((a, f) => a + fn(f), 0) / fs.length;
    const F = (c) => (c * 9) / 5 + 32;
    return { hotF: F(hot), minF: F(minT), nowF: F(fr.oil.T), browning: avg((f) => f.thermal.browning()), crisp: avg((f) => f.thermal.crispness()), basket: !!basket };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.hotF > 345, 'fryer preheated to 350');
  assert(r.hotF - r.minF > 5, `oil temp dipped when the fries went in (${(r.hotF - r.minF).toFixed(0)} °F)`);
  assert(r.browning > 0.2, 'fries are browning');
  await game(() => window.__game.rig.focusOn({ x: 4.9, y: 1.38 }));
  await settle(page);
  await wait(1500);
  await shot('deep-fryer');
  // Grease fire in a pan, then smother with a lid.
  const f = await game(() => {
    const g = window.__game;
    const pan = g.spawn('stainless-pan', { x: 3.4, y: 0.95, z: 0.15 });
    for (let i = 0; i < 60; i++) g.physics.step();
    const c = g.liquids.contentsOf(pan.entry.body.handle);
    c.add('oil', 0.12);
    g.appliances.burners[3].knob = 1;
    let t = 0;
    while (!c.onFire && t < 1800) {
      g.fastForward(5);
      t += 5;
    }
    for (let i = 0; i < 30; i++) g.liquids.frame(1 / 30, []);
    window.__firePan = pan.entry.body.handle;
    return { onFire: c.onFire, minutes: t / 60 };
  });
  console.log('     ' + JSON.stringify(f));
  assert(f.onFire, 'overheated oil on a gas flame catches fire');
  await game(() => window.__game.rig.focusOn({ x: 3.3, y: 1.42 }));
  await settle(page);
  await wait(1500);
  await shot('grease-fire');
  const out = await game(() => {
    const g = window.__game;
    const p = g.bodyPos(window.__firePan);
    const lid = g.spawn('pot-lid', { x: p.x, y: p.y + 0.05, z: p.z });
    for (let i = 0; i < 90; i++) g.physics.step();
    g.physics.sync();
    const lids = [{ handle: lid.entry.body.handle, pos: g.bodyPos(lid.entry.body.handle), up: { x: 0, y: 1, z: 0 } }];
    g.liquids.frame(1 / 30, lids);
    g.fastForward(2);
    return g.liquids.contentsOf(window.__firePan).onFire;
  });
  assert(out === false, 'a lid smothers the fire');
};

scenarios.bread = async ({ page, shot, game, wait, assert }) => {
  const r = await game(() => {
    const g = window.__game;
    const V = (x, y, z) => g.toScreen && { x, y, z, clone() { return V(this.x, this.y, this.z); }, add(o) { this.x += o.x; this.y += o.y; this.z += o.z; return this; }, multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; } };
    const frames = (n) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) g.physics.step();
        g.liquids.frame(1 / 30, []);
        g.pantry.frame(1 / 30);
        g.baking.frame(1 / 30);
      }
      g.physics.sync();
    };
    for (const [h, it] of [...g.items]) if (['steak', 'potato', 'chef-knife', 'cutting-board'].includes(it.def.id)) g.despawn(h);
    const bowl = g.spawn('mixing-bowl', { x: 2.1, y: 0.91, z: 0.08 });
    const bh = bowl.entry.body.handle;
    frames(30);
    // Tip the flour bag over the bowl until ~500 g is in.
    const flour = g.spawn('flour-bag', { x: 2.1, y: 1.2, z: 0.08 });
    flour.entry.body.setGravityScale(0, true);
    flour.entry.body.setRotation({ x: 0.924, y: 0, z: 0, w: 0.383 }, true); // tipped 135°
    let n = 0;
    while ((g.baking.mixtureOf(bh)?.kg.flour ?? 0) < 0.5 && n < 900) {
      flour.entry.body.setTranslation({ x: 2.1, y: 1.12, z: 0.04 }, true);
      flour.entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      frames(1);
      n++;
    }
    g.despawn(flour.entry.body.handle);
    // Yeast from the jar, a little salt, then 350 g water.
    const yeast = g.spawn('yeast-jar', { x: 2.1, y: 1.1, z: 0.08 });
    yeast.entry.body.setGravityScale(0, true);
    yeast.entry.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    n = 0;
    while ((g.baking.mixtureOf(bh)?.kg.yeast ?? 0) < 0.007 && n < 600) {
      yeast.entry.body.setTranslation({ x: 2.1, y: 1.08, z: 0.08 }, true);
      yeast.entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      frames(1);
      n++;
    }
    g.despawn(yeast.entry.body.handle);
    g.baking.emit(V(2.1, 1.05, 0.08), V(0, 0, 0), 'salt', 0.01, -1);
    for (let i = 0; i < 35; i++) g.liquids.emit(V(2.1, 1.05, 0.08), V(0, -0.2, 0), 'water', 0.01, 18, -1);
    frames(60);
    // Whisk: move the whisk around inside the bowl.
    const whisk = g.spawn('whisk', { x: 2.1, y: 1.0, z: 0.08 });
    g.grab.heldHandle = whisk.entry.body.handle;
    whisk.entry.body.setGravityScale(0, true);
    for (let i = 0; i < 240; i++) {
      const a = i * 0.5;
      whisk.entry.body.setTranslation({ x: 2.1 - 0.08 + Math.cos(a) * 0.05, y: 0.94, z: 0.08 + Math.sin(a) * 0.05 }, true);
      g.baking.frame(1 / 30);
    }
    g.grab.heldHandle = null;
    g.despawn(whisk.entry.body.handle);
    const m = g.baking.mixtureOf(bh);
    const a = m.analyze();
    // Tip the bowl to turn it out onto a sheet pan.
    const sheet = g.spawn('sheet-pan', { x: 2.45, y: 0.91, z: 0.05 });
    frames(30);
    const bb = bowl.entry.body;
    bb.setGravityScale(0, true);
    bb.setTranslation({ x: 2.45, y: 1.1, z: 0.05 }, true);
    bb.setRotation({ x: 0.924, y: 0, z: 0, w: 0.383 }, true);
    frames(10);
    g.despawn(bh);
    frames(90);
    const doughH = [...g.baking.doughs.keys()][0];
    if (doughH === undefined) return { fail: 'no dough', kg: m.kg, a, mix: m.mixQuality, strokes: m.strokes };
    const before = g.sim.foods.get(doughH)?.size.slice();
    // Proof 100 min at room temp.
    for (let i = 0; i < 20; i++) {
      g.fastForward(300);
      g.baking.frame(1 / 30);
      frames(10);
    }
    const dh = [...g.baking.doughs.keys()][0];
    const rise = g.baking.doughs.get(dh).rise;
    // Bake: oven to 425, sheet pan with the dough onto the rack.
    const o = g.appliances.oven;
    o.setF(425);
    o.setMode('bake');
    g.fastForward(16 * 60);
    const sb = sheet.entry.body;
    const dp = g.bodyPos(dh);
    const off = { x: dp.x - g.bodyPos(sheet.entry.body.handle).x, z: dp.z - g.bodyPos(sheet.entry.body.handle).z };
    sb.setTranslation({ x: 3.2, y: 0.53, z: -0.02 }, true);
    g.physics.entries.get(dh).body.setTranslation({ x: 3.2 + off.x, y: 0.6, z: -0.02 + off.z }, true);
    frames(60);
    for (let i = 0; i < 90; i++) {
      g.fastForward(30);
      g.baking.frame(1 / 30);
    }
    const final = [...g.baking.doughs.keys()][0];
    const food = g.sim.foods.get(final);
    const d = g.baking.doughs.get(final);
    const F = (c) => (c * 9) / 5 + 32;
    const report = { corePeakF: F(food.thermal.corePeak()), crust: food.thermal.browning(), char: food.thermal.char(), set: d.set };
    // Pull it out and cut it open to show the crumb.
    g.physics.entries.get(final).body.setTranslation({ x: 2.2, y: 1.0, z: 0.05 }, true);
    sb.setTranslation({ x: 2.2, y: 0.91, z: 0.05 }, true);
    frames(60);
    const pieces = g.cutFood(final, { n: [0, 0, 1], d: 0 }, 0.04);
    return { type: a.type, hydration: a.hydration, mix: m.mixQuality, before, rise, report, pieces: pieces.length };
  });
  console.log('     ' + JSON.stringify(r));
  assert(r.type === 'bread dough', `mixed a bread dough (${r.type})`);
  assert(r.rise > 1.45, `dough proofed (rise ${r.rise.toFixed(2)})`);
  assert(r.report.corePeakF > 195 && r.report.crust > 0.7 && r.report.set, 'loaf baked through with a brown crust');
  await game(() => window.__game.rig.focusOn({ x: 2.2, y: 1.32 }));
  await settle(page);
  await wait(1500);
  await shot('bread');
};

/**
 * End-to-end playthrough: knob up by mouse, steak into the hot pan, sear, flip with the tongs, burn your
 * hand on the skillet, put on the mitt, sear side two, tongs it to the board, set the timer and rest,
 * slice it with the knife (cross-section + juice), plate it and read the "how did it turn out" card.
 * Hand motions go through the real grab/tool code (scripted targets, like a very steady hand).
 */
scenarios.playthrough = async ({ page, shot, game, wait, assert }) => {
  const F = (c) => (c * 9) / 5 + 32;
  await game(() => window.__game.rig.focusOn({ x: 3.0, y: 1.38 }));
  await settle(page);
  // Burner under the skillet to ~70 % by dragging its knob.
  const knob = await game(() => window.__game.toScreen(2.92, 0.81, 0.337));
  await mouseDrag(page, knob.x, knob.y, knob.x + 80, knob.y - 80, 12);
  const knobVal = await game(() => window.__game.appliances.burners[2].knob);
  assert(knobVal > 0.5 && knobVal < 0.9, `burner set to medium-high (${knobVal.toFixed(2)})`);
  await game(() => window.__game.fastForward(360));

  // Shared scripted-hand helpers, installed once on window.
  await game(() => {
    const g = window.__game;
    const H = {};
    H.run = (n) => {
      for (let i = 0; i < n; i++) g.physics.step();
      g.physics.sync();
    };
    H.find = (id) => [...g.items].filter(([, it]) => it.def.id === id).map(([h]) => h);
    H.pt = (p) => ({ ...p, clone() {
      return this;
    } });
    H.pick = (h, off = [0, 0, 0]) => {
      const p = g.bodyPos(h);
      const at = { x: p.x + off[0], y: p.y + off[1], z: p.z + off[2] };
      const s = g.toScreen(at.x, at.y, at.z);
      g.grab.start(h, H.pt(at), g.input.info(s.x, s.y));
      return g.grab.heldHandle === h;
    };
    /** Glide the hand's target to (x, y, z) over n steps (2 physics steps each), ticking the tools. */
    H.glide = (x, y, z, n = 60, until) => {
      const a = g.grab.grab.target.clone();
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        g.grab.grab.setTarget({ x: a.x + (x - a.x) * t, y: a.y + (y - a.y) * t, z: a.z + (z - a.z) * t });
        H.run(2);
        g.tools.frame(1 / 60);
        if (until && until()) return true;
      }
      return false;
    };
    /** Move the hand so the gripped food ends up at (x, y, z). */
    H.carry = (food, x, y, z, n = 80) => {
      for (let pass = 0; pass < 3; pass++) {
        const fp = g.bodyPos(food);
        const tg = g.grab.grab.target;
        H.glide(tg.x + x - fp.x, tg.y + y - fp.y, tg.z + z - fp.z, pass ? 20 : n);
        H.run(30);
      }
    };
    H.drop = () => {
      g.grab.end();
      g.tools.frame(1 / 60);
      H.run(120);
    };
    H.pan = () => [...g.heat.cookware].find(([, c]) => c.id === 'cast-iron-pan')[0];
    H.steak = () => H.find('steak').reduce((a, b) => (g.sim.foods.get(a).thermal.mass() > g.sim.foods.get(b).thermal.mass() ? a : b));
    /** Use the tongs: lower the tips onto the food until they clamp it. */
    H.tongsOnto = (food) => {
      const fp = g.bodyPos(food);
      for (const old of H.find('tongs')) g.despawn(old);
      // Tongs in hand, held up and to the side of the food.
      const t = g.spawn('tongs', { x: fp.x - 0.2, y: fp.y + 0.25, z: fp.z }).entry.body.handle;
      H.run(1);
      H.pick(t, [-0.09, 0, 0]);
      H.glide(fp.x - 0.29, fp.y + 0.25, fp.z, 30);
      // Held tip-down at ~0.4 rad: the tips sit (0.19, −0.08) m from the handle.
      const top = fp.y + g.sim.foods.get(food).size[1] / 2;
      const ax = fp.x - 0.02 - 0.193;
      H.glide(ax, top + 0.082 + 0.08, fp.z, 50);
      H.run(60);
      const got = H.glide(ax, top + 0.082 - 0.02, fp.z, 60, () => g.tools.grip?.food === food);
      return got;
    };
    window.__H = H;
  });

  // A splash of oil: carry the bottle over the skillet and tip it.
  const oiled = await game(() => {
    const g = window.__game;
    const H = window.__H;
    const pan = g.bodyPos(H.pan());
    const b = g.spawn('oil-bottle', { x: pan.x + 0.35, y: 0.95, z: pan.z }).entry.body.handle;
    H.run(60);
    H.pick(b, [0, 0.08, 0]);
    H.glide(pan.x + 0.35, 1.25, pan.z, 40);
    H.glide(pan.x + 0.12, 1.25, pan.z, 40);
    g.grab.grab.rotate({ x: 0, y: 0, z: 1 }, 2.2); // spout swings over toward the pan (−x)
    const c = g.liquids.contentsOf(H.pan());
    for (let i = 0; i < 400 && c.oil < 0.012; i++) {
      H.run(2);
      g.liquids.frame(1 / 60, []);
    }
    g.grab.grab.rotate({ x: 0, y: 0, z: 1 }, -2.2);
    for (let i = 0; i < 90; i++) {
      H.run(2);
      g.liquids.frame(1 / 60, []);
    }
    // Set it back down out of the way.
    H.glide(pan.x + 0.45, 1.2, pan.z - 0.1, 50);
    H.glide(pan.x + 0.45, 1.0, pan.z - 0.1, 40);
    H.drop();
    return { oilG: c.oil * 1000, bottle: g.bodyPos(b) };
  });
  console.log('     oiled: ' + JSON.stringify(oiled));
  assert(oiled.oilG > 5, `oil poured into the skillet (${oiled.oilG.toFixed(1)} g)`);

  // Steak from the board into the skillet (it's cold — bare hands are fine).
  const placed = await game(() => {
    const g = window.__game;
    const H = window.__H;
    const s = H.steak();
    const pan = g.bodyPos(H.pan());
    const ok = H.pick(s);
    H.glide(g.bodyPos(s).x, 1.12, g.bodyPos(s).z, 40);
    H.glide(pan.x, 1.12, pan.z, 90);
    H.glide(pan.x, 0.99, pan.z, 40);
    H.drop();
    const p = g.bodyPos(s);
    return { ok, dist: Math.hypot(p.x - pan.x, p.z - pan.z), y: p.y, panF: (g.heat.cookware.get(H.pan()).T * 9) / 5 + 32 };
  });
  console.log('     placed: ' + JSON.stringify(placed));
  assert(placed.ok && placed.dist < 0.08, 'steak carried into the skillet');
  assert(placed.panF > 400, `skillet preheated (${placed.panF.toFixed(0)}°F)`);
  await wait(2500);
  const sizzle = await game(() => window.__game.audio.levels.sizzle);
  console.log(`     sizzle level: ${sizzle.toFixed(2)}`);
  assert(sizzle > 0.1, 'steak sizzles in the hot pan');
  await shot('play-1-sear');
  await game(() => window.__game.fastForward(180));

  // Grab the skillet barehanded: ouch.
  const burn = await game(() => {
    const g = window.__game;
    const H = window.__H;
    const before = g.tools.burns;
    H.pick(H.pan(), [0.2, 0.02, 0]);
    return { burned: g.tools.burns - before, held: g.grab.heldHandle };
  });
  assert(burn.burned === 1 && burn.held === null, 'grabbing the hot skillet barehanded burns and drops it');
  await shot('play-2-ouch');
  // Put on the mitt by tapping it on its hook.
  const mitt = await game(() => window.__game.toScreen(2.62, 1.28, -0.32));
  await page.mouse.click(mitt.x, mitt.y);
  assert(await game(() => window.__game.tools.mitt), 'tapping the oven mitt puts it on');

  // Flip with the tongs every 3 minutes (four sides' worth of 3 min = 12 min).
  const flipOnce = () => game(() => {
    const g = window.__game;
    const H = window.__H;
    const s = H.steak();
    const r0 = g.physics.entries.get(s).body.rotation();
    const gripped = H.tongsOnto(s);
    const fp = g.bodyPos(s);
    const pan0 = g.bodyPos(H.pan());
    H.carry(s, pan0.x, fp.y + 0.14, pan0.z, 50);
    g.grab.grab.rotate({ x: 1, y: 0, z: 0 }, Math.PI);
    H.run(160);
    H.carry(s, pan0.x, fp.y + 0.14, pan0.z, 30);
    H.carry(s, pan0.x, fp.y + 0.075, pan0.z, 40);
    H.drop();
    H.run(120);
    const r = g.physics.entries.get(s).body.rotation();
    // World y of the steak's local up axis.
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    const pan = g.bodyPos(H.pan());
    const p = g.bodyPos(s);
    return { gripped, upY, upY0: 1 - 2 * (r0.x * r0.x + r0.z * r0.z), dist: Math.hypot(p.x - pan.x, p.z - pan.z) };
  });
  const flip = await flipOnce();
  console.log('     flip: ' + JSON.stringify(flip));
  assert(flip.gripped, 'tongs clamp onto the steak');
  assert(flip.upY0 * flip.upY < -0.7, 'steak flipped over');
  assert(flip.dist < 0.1, 'steak landed back in the skillet');
  await shot('play-3-flipped');
  // Thick steak: crust is set, so turn the burner down to medium-low and keep flipping while it cooks through.
  const knob2 = await game(() => window.__game.toScreen(2.92, 0.81, 0.337));
  await mouseDrag(page, knob2.x, knob2.y, knob2.x - 40, knob2.y + 40, 10);
  const knobLow = await game(() => window.__game.appliances.burners[2].knob);
  assert(knobLow < knobVal - 0.2, `burner turned down by dragging (${knobLow.toFixed(2)})`);
  for (let i = 0; i < 2; i++) {
    await game(() => window.__game.fastForward(180));
    const f2 = await flipOnce();
    assert(f2.gripped && f2.dist < 0.1, `flip ${i + 2} landed in the skillet`);
  }
  await game(() => window.__game.fastForward(180));

  // Off the heat: tongs it to the cutting board, set the timer for 5 minutes, rest.
  const rest = await game(() => {
    const g = window.__game;
    const H = window.__H;
    g.appliances.burners[2].knob = 0;
    const s = H.steak();
    const food = g.sim.foods.get(s);
    const sum = food.summary();
    const gripped = H.tongsOnto(s);
    H.carry(s, g.bodyPos(s).x, 1.12, g.bodyPos(s).z, 40);
    H.carry(s, 2.0, 1.12, 0.05, 120);
    H.carry(s, 2.0, 0.97, 0.05, 40);
    g.grab.end();
    g.tools.frame(1 / 60);
    H.run(120);
    const p = g.bodyPos(s);
    return { gripped, x: p.x, z: p.z, browning: sum.browning.map((b) => +b.toFixed(2)), coreF: sum.coreF };
  });
  console.log('     to board: ' + JSON.stringify(rest));
  assert(rest.gripped && Math.abs(rest.x - 2.0) < 0.12 && Math.abs(rest.z - 0.05) < 0.1, 'tongs carried the steak to the board');
  assert(rest.browning[2] > 0.5 && rest.browning[3] > 0.5, 'both sides seared');
  await game(() => window.__game.rig.focusOn({ x: 2.25, y: 1.36 }));
  await settle(page);
  const plus5 = await game(() => window.__game.toScreen(2.36 - 0.023, 1.315, -0.32));
  await page.mouse.click(plus5.x, plus5.y);
  const timer = await game(() => window.__game.feedback.timer.remaining);
  assert(timer > 290 && timer <= 300, `kitchen timer set to 5:00 (${timer.toFixed(0)} s)`);
  await game(() => window.__game.fastForward(305));
  assert(await game(() => window.__game.feedback.timer.ringing), 'timer rings after the rest');

  // Slice it with the knife.
  const cut = await game(() => {
    const g = window.__game;
    const H = window.__H;
    const s = H.steak();
    const peakF = (g.sim.foods.get(s).thermal.corePeak() * 9) / 5 + 32;
    let [k] = H.find('chef-knife');
    if (k === undefined) k = g.spawn('chef-knife', { x: 2.3, y: 0.95, z: 0.2 }).entry.body.handle;
    H.run(30);
    H.pick(k);
    const sp = g.bodyPos(s);
    const pooled0 = g.juice.pooledMl;
    g.grab.grab.setTarget({ x: sp.x, y: 1.08, z: sp.z + 0.105 });
    H.run(90);
    H.glide(sp.x, 1.08 - 0.15, sp.z + 0.105, 80);
    H.run(60);
    for (let i = 0; i < 60; i++) g.juice.update(1 / 30);
    // Lift the knife clear and set it down behind the board.
    H.glide(sp.x, 1.12, sp.z + 0.105, 40);
    H.glide(sp.x + 0.15, 1.12, -0.15, 60);
    H.glide(sp.x + 0.15, 0.99, -0.15, 40);
    g.grab.end();
    H.run(60);
    return { pieces: H.find('steak').length, juiceMl: g.juice.pooledMl - pooled0, peakF };
  });
  console.log('     cut: ' + JSON.stringify(cut));
  assert(cut.pieces === 2, 'knife sliced the steak');
  assert(cut.juiceMl > 0, `juice ran onto the board (${cut.juiceMl.toFixed(1)} ml)`);
  await wait(1500);
  await shot('play-4-cross-section');

  // Plate a piece and read the card.
  const plated = await game(() => {
    const g = window.__game;
    const H = window.__H;
    // A plate set out on the prep counter.
    const pl = g.spawn('plate', { x: 2.47, y: 0.93, z: 0.14 }).entry.body.handle;
    H.run(60);
    const s = H.steak();
    const s0 = g.bodyPos(s);
    const gripped = H.tongsOnto(s);
    H.carry(s, g.bodyPos(s).x, 1.1, g.bodyPos(s).z, 30);
    const pp = g.bodyPos(pl);
    H.carry(s, pp.x, 1.1, pp.z, 80);
    const s1 = g.bodyPos(s);
    H.carry(s, pp.x, pp.y + 0.04, pp.z, 40);
    H.drop();
    H.run(120);
    const p = g.bodyPos(s);
    return { gripped, s0, s1, pp, dist: Math.hypot(p.x - pp.x, p.z - pp.z) };
  });
  console.log('     plated: ' + JSON.stringify(plated));
  await page.waitForFunction(() => document.querySelector('#hud .card')?.style.display === 'block', null, { timeout: 20_000 }).catch(() => {});
  const card = await game(() => window.__game.hud.cardText);
  console.log('     card: ' + card.replace(/\s+/g, ' ').slice(0, 300));
  assert(/Doneness/.test(card) && /Char/.test(card) && /Juiciness/.test(card) && /Internal temp/.test(card), 'inspector card shows doneness, char, juiciness, internal temp');
  assert(/rare|Medium/i.test(card), 'steak came out pink in the middle');
  assert(!/blackened/.test(card), 'flipping regularly kept it from burning');
  await shot('play-5-plated');
  console.log(`     peak core ${F(((cut.peakF - 32) * 5) / 9).toFixed(0)}°F`);
};

/**
 * Stress scene: every station cooking, 40+ bodies. Reports smoothed CPU cost per frame by phase at 1× and
 * 20× (SwiftShader GPU emulation makes FPS/render time unrepresentative here; CPU budget is what we check).
 */
scenarios.stress = async ({ page, shot, game, wait, assert }) => {
  await wait(800);
  const info = await game(() => window.__debug.stress());
  console.log('     stress scene: ' + JSON.stringify(info));
  assert(info.bodies >= 40, `40+ rigid bodies (${info.bodies})`);
  const measure = async (scale, label) => {
    await game((s) => {
      window.__game.loop.timeScale = s;
    }, scale);
    await wait(6000);
    const p = await game(() => ({ ...window.__game.perf, fps: window.__game.overlay.fps, awake: [...window.__game.physics.entries.values()].filter((e) => e.body.isDynamic() && !e.body.isSleeping()).length }));
    const r = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(2)]));
    console.log(`     ${label}: ` + JSON.stringify(r));
    return r;
  };
  await game(() => window.__game.rig.focusOn({ x: 3.6, y: 1.4 }));
  await settle(page);
  const r1 = await measure(1, '1x');
  const r20 = await measure(20, '20x');
  await shot('stress');
  const cpu1 = r1.physics + r1.sim + r1.other;
  const cpu20 = r20.physics + r20.sim + r20.other;
  console.log(`     CPU per frame (excl. render): 1x ${cpu1.toFixed(1)} ms, 20x ${cpu20.toFixed(1)} ms`);
  assert(cpu1 < 8, 'CPU work fits a 60 FPS budget at 1×');
  assert(cpu20 < 16, 'CPU work fits a 60 FPS budget at 20× (sim time-scaled)');
};

/** Raw food close-up (procedural surface detail), then a few cooked to check sear/char still read. */
scenarios.foods = async ({ page, shot, game, wait, assert }) => {
  const shaderErrors = [];
  page.on('console', (m) => {
    if (/Shader Error|ERROR: 0:|Program Info Log/i.test(m.text())) shaderErrors.push(m.text().slice(0, 400));
  });
  await wait(800);
  const ids = ['steak', 'chicken-breast', 'chicken-thigh', 'potato', 'carrot', 'onion', 'bell-pepper', 'broccoli', 'mushroom', 'garlic', 'egg', 'herbs', 'butter', 'ribs'];
  await game((list) => {
    const g = window.__game;
    for (const [h, it] of [...g.items]) if (g.sim.foods.has(h) || it.def.id === 'cutting-board') g.despawn(h);
    list.forEach((id, i) => {
      const row = i < 7 ? 0 : 1;
      g.spawn(id, { x: 1.97 + (i % 7) * 0.13, y: 0.97, z: row ? -0.06 : 0.14 });
    });
    for (let i = 0; i < 240; i++) g.physics.step();
    g.physics.sync();
    g.rig.focusOn({ x: 2.36, y: 1.3 });
  }, ids);
  await settle(page);
  await wait(2500);
  await shot('foods-raw');
  // Zoomed in (narrow FOV) to inspect the detail up close.
  const zoom = async (fov, name, at) => {
    await game(
      ([f, a]) => {
        const g = window.__game;
        g.camera.fov = f;
        g.camera.updateProjectionMatrix();
        if (a) g.rig.focusOn(a);
      },
      [fov, at],
    );
    if (at) await settle(page);
    await wait(2500);
    await shot(name);
  };
  await zoom(16, 'foods-raw-zoom-a', { x: 2.12, y: 1.48 });
  await zoom(16, 'foods-raw-zoom-b', { x: 2.6, y: 1.48 });
  await zoom(50, 'foods-reset', { x: 2.36, y: 1.3 });
  // Sear the steak and potato; char a carrot.
  await game(() => {
    const g = window.__game;
    const find = (id) => [...g.items].find(([, it]) => it.def.id === id)[0];
    window.__debug.searFood(g.sim.foods.get(find('steak')));
    window.__debug.searFood(g.sim.foods.get(find('potato')));
    for (const v of g.foodViews.values()) v.update(10);
  });
  await wait(2500);
  await shot('foods-seared');
  await zoom(16, 'foods-seared-zoom', { x: 2.2, y: 1.48 });
  await zoom(50, 'foods-reset', { x: 2.36, y: 1.3 });
  assert(shaderErrors.length === 0, 'food shaders compile: ' + shaderErrors.join(' | '));
};

/** A/D tilt the held item counterclockwise / clockwise as seen on screen. */
scenarios.tilt = async ({ page, game, wait, assert }) => {
  await wait(1200);
  const s = await game(() => window.__game.screenOf('steak'));
  assert(s, 'steak on screen');
  // Pick it up and hold it still in the air.
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x, s.y - 60, { steps: 6 });
  await wait(1500);
  /** Roll angle on screen (counterclockwise +) of the item's local +x: of the hand's target, or the body. */
  const roll = (target) =>
    game((useTarget) => {
      const g = window.__game;
      const r = useTarget ? g.grab.grab.targetRot : g.physics.entries.get(g.grab.heldHandle).body.rotation();
      const q = g.camera.quaternion.clone().set(r.x, r.y, r.z, r.w);
      const v = g.camera.up.clone().set(1, 0, 0).applyQuaternion(q).applyQuaternion(g.camera.quaternion.clone().invert());
      return Math.atan2(v.y, v.x);
    }, target);
  const t0 = await roll(true);
  const b0 = await roll(false);
  await page.keyboard.down('a');
  await wait(3000);
  await page.keyboard.up('a');
  const t1 = await roll(true);
  await wait(1500);
  const b1 = await roll(false);
  await page.keyboard.down('d');
  await wait(3000);
  await page.keyboard.up('d');
  const t2 = await roll(true);
  await page.mouse.up();
  console.log(`     hand roll: ${t0.toFixed(2)} → A ${t1.toFixed(2)} → D ${t2.toFixed(2)}; steak ${b0.toFixed(2)} → ${b1.toFixed(2)}`);
  assert(t1 - t0 > 0.3, 'A tilts the held item counterclockwise on screen');
  assert(t1 - t2 > 0.3, 'D tilts it back clockwise');
  assert(b1 - b0 > 0.15, 'the steak itself follows the hand');
};
