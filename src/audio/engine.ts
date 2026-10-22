/**
 * Klang für das Schreiben: Ambient-Klangwelten und Schreibmaschinen-Anschläge, vollständig
 * im Browser per Web Audio erzeugt. Keine Dateien, keine Lizenzen, offline, sofort geladen.
 *
 * Aufbau:  Quelle → Klangwelt-Bus (Ein- und Ausblenden) ┐
 *          Anschläge → Schreibmaschinen-Bus ─────────────┴→ Master → Ausgabe
 */

import { keyPan, keyVariant, renderTypewriterBank, type KeyKind, type TypewriterBank } from './typewriter';

export type ScapeId = 'rain' | 'fire' | 'wind' | 'drone' | 'night';

export const SCAPES: { id: ScapeId; name: string; hint: string }[] = [
  { id: 'rain', name: 'Regen', hint: 'Gleichmäßig, mit Tropfen' },
  { id: 'fire', name: 'Kaminfeuer', hint: 'Warm, knisternd' },
  { id: 'wind', name: 'Wind', hint: 'Weit, in Wellen' },
  { id: 'drone', name: 'Klangteppich', hint: 'Ruhige Akkorde' },
  { id: 'night', name: 'Nacht', hint: 'Grillen, ferner Wind' },
];

type Stop = () => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientBus!: GainNode;
  private keysBus!: GainNode;
  private noise: Record<'white' | 'pink' | 'brown', AudioBuffer> | null = null;
  private stopScape: Stop | null = null;
  private current: ScapeId | null = null;
  private ambientLevel = 0.5;
  private ambientOn = false;

  /** Muss aus einer Nutzeraktion heraus aufgerufen werden (Browser-Autoplay-Regeln). */
  private ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 0;
    this.ambientBus.connect(this.master);
    this.keysBus = ctx.createGain();
    this.keysBus.gain.value = 0.5;
    this.keysBus.connect(this.master);
    this.noise = { white: this.makeNoise('white'), pink: this.makeNoise('pink'), brown: this.makeNoise('brown') };
    return ctx;
  }

  private makeNoise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'pink') {
          // Paul Kellet, geglättete Näherung
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      // Weicher Übergang am Schleifenende
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        d[len - fade + i] = d[len - fade + i]! * (1 - t) + d[i]! * t;
      }
    }
    return buf;
  }

  private loop(kind: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise![kind];
    src.loop = true;
    src.loopStart = Math.random() * 3;
    return src;
  }

  /* ---------------- Klangwelten ---------------- */

  private build(id: ScapeId): Stop {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.connect(this.ambientBus);
    const nodes: AudioScheduledSourceNode[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = (n: AudioScheduledSourceNode) => { n.start(); nodes.push(n); };

    const every = (minMs: number, maxMs: number, fn: () => void) => {
      const tick = () => {
        fn();
        timers.push(setTimeout(tick, minMs + Math.random() * (maxMs - minMs)));
      };
      timers.push(setTimeout(tick, minMs));
    };

    const blip = (freq: number, q: number, dur: number, gain: number, kind: 'white' | 'pink' = 'white', pan = 0) => {
      const t = ctx.currentTime;
      const src = this.loop(kind);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      src.connect(f).connect(g).connect(p).connect(out);
      src.start(t); src.stop(t + dur + 0.05);
    };

    if (id === 'rain') {
      const bed = this.loop('pink');
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = 0.55;
      bed.connect(hp).connect(lp).connect(g).connect(out); start(bed);
      const low = this.loop('brown');
      const lg = ctx.createGain(); lg.gain.value = 0.25;
      low.connect(lg).connect(out); start(low);
      every(40, 160, () => blip(2500 + Math.random() * 3500, 8, 0.03 + Math.random() * 0.04, 0.12 + Math.random() * 0.2, 'white', Math.random() * 1.6 - 0.8));
    }

    if (id === 'fire') {
      const bed = this.loop('brown');
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ctx.createGain(); g.gain.value = 0.7;
      bed.connect(lp).connect(g).connect(out); start(bed);
      const hiss = this.loop('pink');
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6;
      const hg = ctx.createGain(); hg.gain.value = 0.06;
      hiss.connect(bp).connect(hg).connect(out); start(hiss);
      every(60, 420, () => {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          timers.push(setTimeout(() => blip(1200 + Math.random() * 5000, 3, 0.01 + Math.random() * 0.03, 0.2 + Math.random() * 0.5, 'white', Math.random() * 1.2 - 0.6), i * 25));
        }
      });
      every(2500, 7000, () => blip(180 + Math.random() * 120, 2, 0.35, 0.35, 'pink'));
    }

    if (id === 'wind' || id === 'night') {
      const bed = this.loop('pink');
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = id === 'wind' ? 0.8 : 0.25;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 300;
      lfo.connect(lfoAmt).connect(bp.frequency);
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.045;
      const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = id === 'wind' ? 0.35 : 0.1;
      lfo2.connect(lfo2Amt).connect(g.gain);
      bed.connect(bp).connect(g).connect(out);
      start(bed); start(lfo); start(lfo2);
    }

    if (id === 'night') {
      // Grillen: kurze, amplitudenmodulierte Sinus-Zirpen um 4,5 kHz
      every(900, 2600, () => {
        const t = ctx.currentTime;
        const pan = Math.random() * 1.6 - 0.8;
        const freq = 4300 + Math.random() * 600;
        const chirps = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < chirps; i++) {
          const o = ctx.createOscillator(); o.frequency.value = freq;
          const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
          const s = t + i * 0.13;
          g.gain.setValueAtTime(0, s);
          g.gain.linearRampToValueAtTime(0.035, s + 0.01);
          g.gain.linearRampToValueAtTime(0, s + 0.07);
          o.connect(g).connect(p).connect(out);
          o.start(s); o.stop(s + 0.1);
        }
      });
    }

    if (id === 'drone') {
      // Langsame Folge offener Akkorde (Moll-Färbung), weich gefiltert
      const chords = [
        [110, 164.81, 220, 261.63],
        [98, 146.83, 196, 233.08],
        [87.31, 130.81, 174.61, 220],
        [103.83, 155.56, 207.65, 246.94],
      ];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03;
      const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 350;
      lfo.connect(lfoAmt).connect(lp.frequency); start(lfo);
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.6;
      const fb = ctx.createGain(); fb.gain.value = 0.35;
      delay.connect(fb).connect(delay);
      lp.connect(out); lp.connect(delay); delay.connect(out);
      const voices = chords[0]!.map((f, i) => {
        const o = ctx.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 12;
        const g = ctx.createGain(); g.gain.value = 0.11;
        o.connect(g).connect(lp); start(o);
        return o;
      });
      let step = 0;
      every(9000, 9001, () => {
        step = (step + 1) % chords.length;
        const t = ctx.currentTime;
        voices.forEach((o, i) => o.frequency.setTargetAtTime(chords[step]![i]!, t, 2.5));
      });
      const air = this.loop('pink');
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      const ag = ctx.createGain(); ag.gain.value = 0.03;
      air.connect(hp).connect(ag).connect(out); start(air);
    }

    return () => {
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(0, t, 0.4);
      timers.forEach(clearTimeout);
      setTimeout(() => {
        nodes.forEach((n) => { try { n.stop(); } catch { /* bereits gestoppt */ } });
        out.disconnect();
      }, 2000);
    };
  }

  /** Wählt eine Klangwelt (null = Stille). Wechsel blendet über. */
  setScape(id: ScapeId | null): void {
    if (id === this.current) return;
    this.current = id;
    if (!this.ctx) return; // wird beim ersten Abspielen gebaut
    this.stopScape?.();
    this.stopScape = id ? this.build(id) : null;
  }

  setAmbientVolume(v: number): void {
    this.ambientLevel = v;
    if (this.ctx && this.ambientOn) this.ambientBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  /** Blendet die Klangwelt langsam ein oder aus. */
  fadeAmbient(on: boolean, seconds = 3): void {
    this.ambientOn = on;
    if (on) {
      this.ensure();
      if (!this.stopScape && this.current) this.stopScape = this.build(this.current);
    }
    if (!this.ctx) return;
    this.ambientBus.gain.setTargetAtTime(on ? this.ambientLevel : 0, this.ctx.currentTime, seconds / 3);
  }

  setKeysVolume(v: number): void {
    if (this.ctx) this.keysBus.gain.value = v;
  }

  /* ---------------- Schreibmaschine ---------------- */

  private bank: TypewriterBank | null = null;
  private bankLoading: Promise<void> | null = null;
  private lastKey = 0;

  /** Rendert die Anschläge im Hintergrund vor; braucht keinen Nutzerklick. */
  preloadKeys(): Promise<void> {
    this.bankLoading ??= renderTypewriterBank()
      .then((b) => { this.bank = b; })
      .catch(() => { /* ohne Web Audio bleibt es still */ });
    return this.bankLoading;
  }

  /**
   * Ein Anschlag aus der vorgerechneten Bank. Gleiche Taste, gleicher Typenhebel; dazu kleine
   * Schwankungen in Tonhöhe und Lautstärke. Schnelles Tippen klingt etwas leichter, wie bei
   * einer echten Maschine, auf der man in Fahrt ist.
   */
  key(kind: KeyKind, volume = 0.5, char = ''): void {
    const ctx = this.ensure();
    this.keysBus.gain.value = volume;
    if (!this.bank) {
      void this.preloadKeys();
      return;
    }
    const list = this.bank[kind];
    const idx = kind === 'char' && char ? keyVariant(char, list.length) : Math.floor(Math.random() * list.length);
    const now = performance.now();
    const gap = now - this.lastKey;
    this.lastKey = now;
    const flow = gap < 90 ? 0.8 : gap < 160 ? 0.9 : 1;

    const src = ctx.createBufferSource();
    src.buffer = list[idx]!;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.05;
    const g = ctx.createGain();
    g.gain.value = flow * (0.85 + Math.random() * 0.25);
    const p = ctx.createStereoPanner();
    p.pan.value = kind === 'char' ? keyPan(char) + (Math.random() - 0.5) * 0.06 : 0;
    src.connect(g).connect(p).connect(this.keysBus);
    src.start(ctx.currentTime + 0.001);
  }
}

export const audio = new AudioEngine();
