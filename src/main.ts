import { initPhysics } from './engine/physics';
import { Game } from './game';
import { steakLineup } from './debug/lineup';
import { stressScene } from './debug/stress';
import { panSear } from './sim/recipes';
import type { FoodItem } from './sim/food';

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
  window.__debug = {
    steakLineup: () => steakLineup(game),
    stress: () => stressScene(game),
    /** Sear a food in the sim (debug): 450 °F pan to medium-rare, rested. */
    searFood: (f: never) => {
      panSear(f as unknown as FoodItem, { panF: 450, pullF: 115, flipEvery: 60 });
    },
  };
  game.start();
}

void boot();
