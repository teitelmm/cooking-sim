// Playwright scenario runner: starts a Vite dev server, drives the game, writes screenshots/*.png.
// Usage: npm run shots [-- scenarioName ...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { scenarios } from './scenarios.mjs';

const OUT = 'screenshots';
const wanted = process.argv.slice(2);

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failures = 0;
await mkdir(OUT, { recursive: true });
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30_000 });
      const ctx = {
        page,
        shot: (file) => page.screenshot({ path: `${OUT}/${file}.png` }),
        game: (fn, arg) => page.evaluate(fn, arg),
        wait: (ms) => page.waitForTimeout(ms),
        assert(cond, msg) {
          if (!cond) throw new Error(`assert failed: ${msg}`);
        },
      };
      await run(ctx);
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}: ${err.message}`);
      for (const l of logs.slice(-20)) console.log('     ' + l);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
