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
  /** Current loop intensities 0..1 (readable without audio, for tests/UI). */
  readonly levels = { sizzle: 0, boil: 0, alarm: false };
  private loops: { sizzle: GainNode; crackle: GainNode; boil: GainNode } | null = null;
  private nextAlarmBeep = 0;
  private nextBubble = 0;

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
    events.on('cut', () => this.chop());
  }

  private noiseLoop(filter: BiquadFilterType, freq: number, q = 0.7): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    return g;
  }

  /**
   * Continuous kitchen sounds. Sizzle ∝ moisture flashing off hot surfaces (evaporation × surface heat),
   * boil ∝ how vigorously pots are bubbling; the smoke alarm beeps in its classic triple pattern.
   */
  setLevels(sizzle: number, boil: number, alarm: boolean): void {
    this.levels.sizzle = sizzle;
    this.levels.boil = boil;
    this.levels.alarm = alarm;
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (!this.loops) this.loops = { sizzle: this.noiseLoop('highpass', 3200), crackle: this.noiseLoop('bandpass', 6500, 2), boil: this.noiseLoop('lowpass', 420) };
    const now = ctx.currentTime;
    this.loops.sizzle.gain.setTargetAtTime(sizzle * 0.35, now, 0.15);
    // Fat crackle: random spikes on top of the hiss.
    this.loops.crackle.gain.setTargetAtTime(sizzle * (Math.random() < 0.3 ? 0.6 : 0.08), now, 0.01);
    this.loops.boil.gain.setTargetAtTime(boil * 0.5, now, 0.3);
    if (boil > 0.05 && now > this.nextBubble) {
      this.nextBubble = now + (0.05 + Math.random() * 0.25) / boil;
      this.blip(180 + Math.random() * 320, 0.05, boil * 0.12);
    }
    if (alarm && now > this.nextAlarmBeep) {
      // T3 pattern: three 0.5 s beeps, then a pause.
      for (let i = 0; i < 3; i++) this.blip(3100, 0.35, 0.18, now + i * 0.5, 'square');
      this.nextAlarmBeep = now + 2.4;
    }
  }

  private blip(freq: number, dur: number, vol: number, at?: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (type === 'sine') osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Knife through food onto the board: a short wet slice and a wooden knock. */
  chop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 0.3, 0.1);
    this.blip(190, 0.07, 0.3, now + 0.05);
  }

  /** Hand on hot metal. */
  hiss(): void {
    this.blip(900, 0.15, 0.2);
    this.impact(-1, -2, 120, 'steel', 'steel');
  }

  /** Kitchen timer done. */
  ring(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < 6; i++) this.blip(2200, 0.12, 0.15, ctx.currentTime + i * 0.18, 'triangle');
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
