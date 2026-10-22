/**
 * Schreibmaschinen-Anschläge, einmal vorab per OfflineAudioContext gerendert.
 *
 * Statt bei jedem Tastendruck ein Dutzend Knoten aufzubauen, rechnet narratio beim Start eine
 * kleine Bank fertiger Klänge (mehrere Typenhebel, Leertaste, Rücktaste, Wagenrücklauf). Das
 * erlaubt aufwendigere Klangbildung – mehrere Schichten und ein Gehäusenachhall per Faltung –
 * und hält das Abspielen billig und latenzarm.
 *
 * Ein Anschlag besteht aus:
 *  1. Tastendruck: kurzer heller Klick der Tastenkappe
 *  2. Typenhebel trifft Walze: Knall, metallisches Klingen (unharmonische Teiltöne), dumpfer Schlag
 *  3. Schaltwerk: der Wagen rückt einen Schritt, ein feines Ratschen
 *  4. Rücklauf von Hebel und Taste: leiser Klick
 * Alles läuft durch einen kurzen, gefilterten Nachhall, der nach Blechgehäuse auf Holztisch klingt.
 */

export type KeyKind = 'char' | 'space' | 'back' | 'enter';

export interface TypewriterBank {
  char: AudioBuffer[];
  space: AudioBuffer[];
  back: AudioBuffer[];
  enter: AudioBuffer[];
}

/** Anzahl Varianten je Art. Jede Zeichentaste bekommt fest einen „eigenen“ Typenhebel. */
const VARIANTS: Record<KeyKind, number> = { char: 14, space: 3, back: 3, enter: 2 };
const LENGTH: Record<KeyKind, number> = { char: 0.42, space: 0.42, back: 0.38, enter: 1.9 };

/** Deterministischer Zufall, damit die Bank bei jedem Start gleich klingt. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, rand: () => number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return buf;
}

/** Kurzer Raumklang: Gehäuse und Tisch. Gefiltertes, abklingendes Rauschen mit frühen Reflexionen. */
function bodyImpulse(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * 0.16);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const w = rand() * 2 - 1;
    lp += 0.35 * (w - lp); // weicher Tiefpass: Holz statt Hall
    d[i] = lp * Math.exp(-t / 0.028);
  }
  // Frühe Reflexionen der Gehäusewände
  for (const [ms, g] of [[1.3, 0.5], [2.9, -0.35], [4.6, 0.25], [7.1, -0.15]] as const) {
    const i = Math.floor((ms / 1000) * ctx.sampleRate);
    if (i < len) d[i] = d[i]! + g;
  }
  d[0] = 1;
  return buf;
}

interface Voice {
  ctx: OfflineAudioContext;
  out: AudioNode;
  rand: () => number;
  noise: AudioBuffer;
}

const r = (v: Voice, a: number, b: number) => a + v.rand() * (b - a);

/** Gefiltertes Rauschen als kurzer Impuls. */
function burst(v: Voice, at: number, opts: { type: BiquadFilterType; freq: number; q: number; dur: number; gain: number; attack?: number }) {
  const { ctx } = v;
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.frequency.value = opts.freq;
  f.Q.value = opts.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(opts.gain, at + (opts.attack ?? 0.0006));
  g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
  src.connect(f).connect(g).connect(v.out);
  src.start(at, v.rand() * 0.5);
  src.stop(at + opts.dur + 0.02);
}

/** Gedämpfter Sinus: ein Teilton des metallischen Klingens. */
function ring(v: Voice, at: number, freq: number, dur: number, gain: number) {
  const { ctx } = v;
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.0008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(v.out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** Tiefer Schlag mit fallender Tonhöhe (Walze, Tisch). */
function thud(v: Voice, at: number, freq: number, dur: number, gain: number) {
  const { ctx } = v;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(freq * 1.8, at);
  o.frequency.exponentialRampToValueAtTime(freq, at + dur * 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(v.out);
  o.start(at);
  o.stop(at + dur + 0.02);
  burst(v, at, { type: 'lowpass', freq: 700, q: 0.7, dur: dur * 0.6, gain: gain * 0.6 });
}

/** Feines Ratschen des Schaltwerks. */
function escapement(v: Voice, at: number, gain: number) {
  burst(v, at, { type: 'bandpass', freq: r(v, 5200, 6800), q: 3, dur: 0.006, gain });
  ring(v, at, r(v, 3100, 3500), 0.018, gain * 0.25);
}

function keyClick(v: Voice, at: number, gain: number) {
  burst(v, at, { type: 'highpass', freq: r(v, 3500, 4500), q: 0.7, dur: 0.005, gain });
  burst(v, at + 0.001, { type: 'bandpass', freq: r(v, 1100, 1500), q: 1.2, dur: 0.012, gain: gain * 0.5 });
}

function typebar(v: Voice, at: number, intensity: number) {
  // Knall des Typenkopfs auf Farbband und Papier
  burst(v, at, { type: 'bandpass', freq: r(v, 2800, 4200), q: 1.4, dur: r(v, 0.014, 0.022), gain: 0.95 * intensity });
  burst(v, at, { type: 'highpass', freq: 6000, q: 0.5, dur: 0.004, gain: 0.5 * intensity });
  // Metallisches Klingen des Hebels: unharmonische Teiltöne wie bei einem Stab
  const f0 = r(v, 1250, 2100);
  const partials: [number, number, number][] = [[1, 0.22, 0.055], [2.76, 0.13, 0.035], [5.4, 0.07, 0.022], [8.93, 0.035, 0.014]];
  for (const [ratio, gain, dur] of partials) ring(v, at + 0.0005, f0 * ratio * r(v, 0.99, 1.01), dur * r(v, 0.8, 1.25), gain * intensity);
  // Gummiwalze und Tisch
  thud(v, at + 0.0015, r(v, 115, 165), r(v, 0.045, 0.065), 0.55 * intensity);
}

function renderKind(v: Voice, kind: KeyKind) {
  const t = 0.005;
  if (kind === 'char') {
    keyClick(v, t, r(v, 0.12, 0.2));
    const hit = t + r(v, 0.011, 0.019); // Weg des Typenhebels
    typebar(v, hit, r(v, 0.85, 1));
    escapement(v, hit + r(v, 0.024, 0.034), r(v, 0.1, 0.16));
    keyClick(v, hit + r(v, 0.075, 0.1), r(v, 0.04, 0.07)); // Rücklauf
  } else if (kind === 'space') {
    // Breite Leiste, kein Typenhebel: dumpfer, länger
    burst(v, t, { type: 'bandpass', freq: r(v, 900, 1300), q: 0.9, dur: 0.03, gain: 0.45 });
    keyClick(v, t, 0.1);
    thud(v, t + 0.004, r(v, 85, 105), 0.09, 0.7);
    escapement(v, t + r(v, 0.02, 0.028), 0.18);
    burst(v, t + r(v, 0.09, 0.12), { type: 'bandpass', freq: 1600, q: 1, dur: 0.02, gain: 0.08 });
  } else if (kind === 'back') {
    // Wagen einen Schritt zurück: zwei kurze Klacks, eher hölzern
    keyClick(v, t, 0.12);
    burst(v, t + 0.012, { type: 'bandpass', freq: r(v, 1800, 2400), q: 2, dur: 0.018, gain: 0.4 });
    thud(v, t + 0.013, 140, 0.04, 0.3);
    escapement(v, t + 0.045, 0.14);
  } else {
    // Wagenrücklauf: Glocke, Hebel, Zeilenschaltung (Ratschen), Gleiten, Anschlag
    const bell = t;
    ring(v, bell, 2093, 1.4, 0.16);
    ring(v, bell, 2093 * 2.76, 0.6, 0.05);
    ring(v, bell, 2093 * 5.4, 0.25, 0.02);
    const lever = t + 0.09;
    keyClick(v, lever, 0.2);
    for (let i = 0; i < 3; i++) escapement(v, lever + 0.02 + i * r(v, 0.024, 0.03), 0.22);
    const slideStart = lever + 0.12;
    const slideDur = r(v, 0.32, 0.4);
    const { ctx } = v;
    const src = ctx.createBufferSource();
    src.buffer = v.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.3;
    f.frequency.setValueAtTime(500, slideStart);
    f.frequency.linearRampToValueAtTime(1500, slideStart + slideDur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, slideStart);
    g.gain.linearRampToValueAtTime(0.18, slideStart + 0.05);
    g.gain.linearRampToValueAtTime(0.26, slideStart + slideDur * 0.8);
    g.gain.linearRampToValueAtTime(0, slideStart + slideDur);
    src.connect(f).connect(g).connect(v.out);
    src.start(slideStart);
    src.stop(slideStart + slideDur + 0.02);
    // Rattern der Zahnstange während des Gleitens
    for (let x = 0.03; x < slideDur - 0.02; x += r(v, 0.018, 0.026)) burst(v, slideStart + x, { type: 'bandpass', freq: r(v, 3500, 4500), q: 4, dur: 0.004, gain: 0.05 });
    const stop = slideStart + slideDur;
    burst(v, stop, { type: 'bandpass', freq: 2600, q: 1.2, dur: 0.02, gain: 0.6 });
    thud(v, stop + 0.001, 75, 0.14, 0.75);
    ring(v, stop, r(v, 900, 1100), 0.08, 0.08);
  }
}

async function renderOne(kind: KeyKind, seed: number, sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * LENGTH[kind]), sampleRate);
  const rand = rng(seed);
  const dry = ctx.createGain();
  dry.gain.value = 1;
  const body = ctx.createConvolver();
  body.normalize = true;
  body.buffer = bodyImpulse(ctx, rng(seed * 7 + 3));
  const wet = ctx.createGain();
  wet.gain.value = 0.32;
  const sum = ctx.createGain();
  dry.connect(sum);
  dry.connect(body).connect(wet).connect(sum);
  // Etwas Tiefen weg, damit es auf Laptop-Lautsprechern nicht dröhnt
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 55;
  sum.connect(hp).connect(ctx.destination);
  renderKind({ ctx, out: dry, rand, noise: noiseBuffer(ctx, 1, rng(seed * 13 + 1)) }, kind);
  const buf = await ctx.startRendering();
  // Auf einheitliche Spitze normalisieren, Rest sanft ausblenden
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const target = kind === 'enter' ? 0.8 : 0.9;
  const k = peak > 0 ? target / peak : 1;
  const fade = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < d.length; i++) {
    const tail = i > d.length - fade ? (d.length - i) / fade : 1;
    d[i] = d[i]! * k * tail;
  }
  return buf;
}

/** Rendert die ganze Bank. Braucht keinen Nutzerklick, läuft also schon beim Start im Hintergrund. */
export async function renderTypewriterBank(sampleRate = 44100): Promise<TypewriterBank> {
  const bank: TypewriterBank = { char: [], space: [], back: [], enter: [] };
  let seed = 1;
  for (const kind of Object.keys(VARIANTS) as KeyKind[]) {
    for (let i = 0; i < VARIANTS[kind]; i++) bank[kind].push(await renderOne(kind, seed++ * 7919, sampleRate));
  }
  return bank;
}

/** Tastaturlage (QWERTZ) für die Stereoposition: links liegende Tasten klingen leicht links. */
const ROWS = ['1234567890ß', 'qwertzuiopü', 'asdfghjklöä', '<yxcvbnm,.-'];

export function keyPan(char: string): number {
  const c = char.toLowerCase();
  for (const row of ROWS) {
    const i = row.indexOf(c);
    if (i >= 0) return (i / (row.length - 1) - 0.5) * 0.5;
  }
  return 0;
}

/** Jede Taste hat ihren festen Typenhebel; gleiche Buchstaben klingen gleich, wie an der echten Maschine. */
export function keyVariant(char: string, count: number): number {
  let h = 0;
  for (let i = 0; i < char.length; i++) h = (h * 31 + char.toLowerCase().charCodeAt(i)) >>> 0;
  return h % count;
}
