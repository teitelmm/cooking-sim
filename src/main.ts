import { initPhysics } from './engine/physics';
import { Game } from './game';
import { steakLineup } from './debug/lineup';

declare global {
  interface Window {
    __game?: Game;
    __debug?: Record<string, (...args: never[]) => unknown>;
  }
}

async function boot(): Promise<void> {
  await initPhysics();
  const game = new Game(document.getElementById('app')!, document.getElementById('debug')!);
  window.__game = game;
  window.__debug = { steakLineup: () => steakLineup(game) };
  game.start();
}

void boot();
