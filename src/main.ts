import { initPhysics } from './engine/physics';
import { Game } from './game';

declare global {
  interface Window {
    __game?: Game;
  }
}

async function boot(): Promise<void> {
  await initPhysics();
  const game = new Game(document.getElementById('app')!, document.getElementById('debug')!);
  window.__game = game;
  game.start();
}

void boot();
