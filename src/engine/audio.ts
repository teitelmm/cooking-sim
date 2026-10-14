import { MATERIALS, type MaterialId } from '../data/materials';
import type { EventBus } from './events';

/**
 * Tiny synthesized sound layer. Impacts: a filtered noise burst (thud) plus a decaying sine (ring)
 * whose pitch and ringiness come from the material table. Unlocked on the first user gesture.
 */
export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPair = new Map<string, number>();

  constructor(events: EventBus) {
    const unlock = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    events.on('impact', (e) => this.impact(e.bodyA, e.bodyB, e.magnitude, e.materialA, e.materialB));
  }

  impact(a: number, b: number, magnitude: number, matA?: string, matB?: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const now = ctx.currentTime;
    if (now - (this.lastPair.get(key) ?? -1) < 0.08) return;
    this.lastPair.set(key, now);
    const vol = Math.min(magnitude / 250, 1) ** 0.7 * 0.5;
    if (vol < 0.02) return;
    const mats = [matA, matB].map((m) => MATERIALS[(m as MaterialId) ?? 'wood'] ?? MATERIALS.wood);
    // The ringier material dominates the tone (a pan clanks, a steak just thuds).
    const tone = mats[0].ring >= mats[1].ring ? mats[0] : mats[1];

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = tone.pitch;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now, Math.random() * 0.3, 0.1);

    if (tone.ring > 0.2) {
      const osc = ctx.createOscillator();
      osc.frequency.value = tone.pitch * (1.6 + Math.random() * 0.2);
      const og = ctx.createGain();
      const decay = 0.1 + tone.ring * 0.5;
      og.gain.setValueAtTime(vol * tone.ring * 0.4, now);
      og.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(og).connect(this.master);
      osc.start(now);
      osc.stop(now + decay);
    }
  }
}
