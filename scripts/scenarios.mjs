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
