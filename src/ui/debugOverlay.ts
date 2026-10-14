export interface DebugStats {
  bodies: number;
  cameraX: number;
  cameraY: number;
  timeScale: number;
  gameTime: number;
  held?: string;
}

export class DebugOverlay {
  fps = 0;
  private frames = 0;
  private acc = 0;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') el.classList.toggle('hidden');
    });
  }

  update(realDt: number, stats: DebugStats): void {
    this.frames++;
    this.acc += realDt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const mins = Math.floor(stats.gameTime / 60);
    const secs = Math.floor(stats.gameTime % 60).toString().padStart(2, '0');
    this.el.textContent =
      `FPS     ${this.fps.toFixed(0)}\n` +
      `bodies  ${stats.bodies}\n` +
      `camera  x ${stats.cameraX.toFixed(2)}  y ${stats.cameraY.toFixed(2)}\n` +
      `time    ${stats.timeScale}x  ${mins}:${secs}\n` +
      `held    ${stats.held ?? '-'}`;
  }
}
