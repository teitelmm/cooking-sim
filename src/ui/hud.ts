import type { FixedLoop } from '../engine/loop';

/**
 * Minimal HTML overlay: time controls, what you're holding (and how hot it is), alerts (burns, smoke,
 * fire, timer), and the "how did it turn out" card.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly held: HTMLDivElement;
  private readonly alert: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly mitt: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private alertUntil = 0;
  private flashUntil = 0;

  constructor(private readonly loop: FixedLoop) {
    const css = document.createElement('style');
    css.textContent = `
      #hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.35 system-ui, sans-serif; color: #f6efe6; }
      #hud .panel { position: absolute; background: rgba(24,18,14,0.72); border-radius: 10px; padding: 8px 10px; }
      #hud .time { top: 10px; right: 10px; display: flex; gap: 6px; pointer-events: auto; }
      #hud .time button { pointer-events: auto; border: 0; border-radius: 7px; padding: 6px 10px; background: #3a2e25; color: #f6efe6; font-weight: 600; cursor: pointer; }
      #hud .time button.on { background: #e28b3a; color: #1c130c; }
      #hud .held { bottom: 12px; left: 12px; min-width: 160px; display: none; }
      #hud .alert { top: 56px; left: 50%; transform: translateX(-50%); font-size: 15px; font-weight: 600; display: none; background: rgba(150,30,20,0.85); }
      #hud .mitt { top: 10px; right: 230px; }
      #hud .card { right: 12px; top: 56px; width: 270px; display: none; pointer-events: auto; }
      #hud .card h3 { margin: 0 0 6px; font-size: 15px; }
      #hud .card table { width: 100%; border-collapse: collapse; }
      #hud .card td { padding: 2px 0; }
      #hud .card td:last-child { text-align: right; font-weight: 600; }
      #hud .card .note { margin-top: 6px; color: #f2c38b; }
      #hud .card button { margin-top: 8px; border: 0; border-radius: 6px; padding: 4px 10px; background: #3a2e25; color: #f6efe6; cursor: pointer; }
      #hud .flash { position: fixed; inset: 0; background: rgba(255,40,10,0.28); display: none; }
    `;
    document.head.appendChild(css);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.flash = this.div('flash');
    const time = this.div('panel time');
    const buttons: [string, () => void][] = [
      ['⏸', () => (loop.paused = !loop.paused)],
      ['1×', () => ((loop.timeScale = 1), (loop.paused = false))],
      ['5×', () => ((loop.timeScale = 5), (loop.paused = false))],
      ['20×', () => ((loop.timeScale = 20), (loop.paused = false))],
    ];
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
        this.refreshTime();
      };
      time.appendChild(b);
    }
    this.held = this.div('panel held');
    this.alert = this.div('panel alert');
    this.mitt = this.div('panel mitt');
    this.card = this.div('panel card');
    document.body.appendChild(this.root);
    this.refreshTime();
  }

  private div(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    this.root.appendChild(d);
    return d;
  }

  private refreshTime(): void {
    const btns = this.root.querySelectorAll<HTMLButtonElement>('.time button');
    btns[0].classList.toggle('on', this.loop.paused);
    [1, 5, 20].forEach((s, i) => btns[i + 1].classList.toggle('on', !this.loop.paused && this.loop.timeScale === s));
  }

  setHeld(text: string | null): void {
    this.held.style.display = text ? 'block' : 'none';
    if (text) this.held.innerHTML = text;
  }

  setMitt(on: boolean): void {
    this.mitt.textContent = on ? '🧤 oven mitt on' : '✋ bare hands';
  }

  showAlert(text: string, seconds = 2.5, flash = false): void {
    this.alert.textContent = text;
    this.alert.style.display = 'block';
    this.alertUntil = performance.now() + seconds * 1000;
    if (flash) {
      this.flash.style.display = 'block';
      this.flashUntil = performance.now() + 250;
    }
  }

  /** Persistent alert (smoke alarm) — shown while active. */
  setAlarm(text: string | null): void {
    if (text) {
      this.alert.textContent = text;
      this.alert.style.display = 'block';
      this.alertUntil = performance.now() + 500;
    }
  }

  showCard(title: string, rows: [string, string][], notes: string[] = []): void {
    this.card.innerHTML = `<h3>${title}</h3><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>${notes
      .map((n) => `<div class="note">${n}</div>`)
      .join('')}<button>close</button>`;
    this.card.style.display = 'block';
    this.card.querySelector('button')!.onclick = () => (this.card.style.display = 'none');
  }

  get cardVisible(): boolean {
    return this.card.style.display === 'block';
  }

  get cardText(): string {
    return this.card.textContent ?? '';
  }

  frame(): void {
    const now = performance.now();
    if (now > this.alertUntil) this.alert.style.display = 'none';
    if (now > this.flashUntil) this.flash.style.display = 'none';
    this.refreshTime();
  }
}
