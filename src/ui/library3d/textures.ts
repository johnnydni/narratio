import * as THREE from 'three';

/**
 * Texturen für das 3D-Regal, alle zur Laufzeit auf einem Canvas gezeichnet: Buchrücken mit
 * Titel und Goldprägung, dazu eine Karte für Rauheit und Metall (Gold glänzt, Leder nicht),
 * eine Ledernarbung als Relief und der Seitenschnitt.
 */

const SCALE = 2; // Canvas-Pixel je CSS-Pixel, damit der Titel auch auf Retina-Displays scharf bleibt

export interface SpineArt {
  name: string;
  color: string;
  deco: number;
  /** Breite und Höhe des Rückens in CSS-Pixeln */
  w: number;
  h: number;
  dark: boolean;
  /** fester Zufall je Projekt, damit die Flecken im Leder bei jedem Besuch gleich liegen */
  seed: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/** Titel so kürzen, dass er auf die verfügbare Länge passt. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Bei langen Titeln zwei Zeilen, am Wortende getrennt. */
function twoLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  if (words.length < 2 || ctx.measureText(text).width <= max) return [fit(ctx, text, max)];
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = ctx.measureText(words.slice(0, i).join(' ')).width;
    const b = ctx.measureText(words.slice(i).join(' ')).width;
    if (Math.abs(a - b) < bestDiff) {
      bestDiff = Math.abs(a - b);
      best = i;
    }
  }
  return [fit(ctx, words.slice(0, best).join(' '), max), fit(ctx, words.slice(best).join(' '), max)];
}

/**
 * Zeichnet Farbe und Rauheit/Metall des Rückens in zwei Canvas gleicher Größe. Was golden ist,
 * landet in beiden: in der Farbkarte als Gold, in der zweiten als glatt und metallisch
 * (Grün = Rauheit, Blau = Metall, wie three.js es liest).
 */
export function spineTextures(art: SpineArt): { map: THREE.CanvasTexture; rm: THREE.CanvasTexture } {
  const W = Math.round(art.w * SCALE);
  const H = Math.round(art.h * SCALE);
  const rnd = rng(art.seed);
  const [cc, c] = canvas(W, H);
  const [rc, r] = canvas(W, H);

  // Leder: Grundfarbe, leicht fleckig, zu den Kanten hin dunkler (der Rücken ist gewölbt)
  c.fillStyle = art.color;
  c.fillRect(0, 0, W, H);
  const across = c.createLinearGradient(0, 0, W, 0);
  across.addColorStop(0, 'rgba(0,0,0,0.30)');
  across.addColorStop(0.18, 'rgba(255,255,255,0.06)');
  across.addColorStop(0.5, 'rgba(0,0,0,0)');
  across.addColorStop(0.85, 'rgba(0,0,0,0.10)');
  across.addColorStop(1, 'rgba(0,0,0,0.34)');
  c.fillStyle = across;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const rad = (20 + rnd() * 60) * SCALE;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const tone = rnd() < 0.5 ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${tone},${0.025 + rnd() * 0.03})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  // Abrieb an Kopf und Fuß
  const wear = c.createLinearGradient(0, 0, 0, H);
  wear.addColorStop(0, 'rgba(255,255,255,0.10)');
  wear.addColorStop(0.035, 'rgba(255,255,255,0)');
  wear.addColorStop(0.965, 'rgba(0,0,0,0)');
  wear.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = wear;
  c.fillRect(0, 0, W, H);

  r.fillStyle = 'rgb(0,205,0)'; // Leder: matt, nicht metallisch
  r.fillRect(0, 0, W, H);

  const gold = art.dark ? '#c9a868' : '#d8b878';
  const goldRM = 'rgb(0,85,255)';
  const both = (fn: (ctx: CanvasRenderingContext2D, colour: string) => void) => {
    fn(c, gold);
    fn(r, goldRM);
  };
  const line = (y: number, thick: number) =>
    both((ctx, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(0, Math.round(y * SCALE), W, Math.max(1, Math.round(thick * SCALE)));
    });

  // Bünde und Goldlinien je nach Zierde, wie im flachen Regal
  const bands = (top: number, dir: 1 | -1) => {
    if (art.deco === 0) {
      line(top, 1.2);
      line(top + dir * 8, 1.2);
    } else if (art.deco === 1) {
      line(top, 1.6);
    } else {
      line(top, 1);
      line(top + dir * 6, 2.4);
      line(top + dir * 13, 1);
    }
  };
  bands(14, 1);
  bands(art.h - 30, -1);

  // Monogramm im Kreis unten
  const my = art.h - 16 - 10 - 18;
  both((ctx, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.2 * SCALE;
    ctx.beginPath();
    ctx.arc(W / 2, my * SCALE, 10 * SCALE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = `500 ${12 * SCALE}px Literata, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(art.name.trim().charAt(0).toUpperCase() || '·', W / 2, (my + 0.5) * SCALE);
  });

  // Titel: von unten nach oben zu lesen, wie im flachen Regal
  const top = 40;
  const bottom = my - 18;
  const len = (bottom - top) * SCALE;
  const long = art.name.length > 13;
  const size = (long ? 12.5 : 14) * SCALE;
  c.save();
  c.translate(W / 2, ((top + bottom) / 2) * SCALE);
  c.rotate(-Math.PI / 2);
  c.font = `500 ${size}px Literata, Georgia, serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const lines = long ? twoLines(c, art.name, len) : [fit(c, art.name, len)];
  const lh = size * 1.18;
  const cream = art.dark ? '#ece2cc' : '#f5ecd9';
  lines.forEach((t, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillText(t, 0, y + SCALE);
    c.fillStyle = cream;
    c.fillText(t, 0, y);
  });
  c.restore();
  r.save();
  r.translate(W / 2, ((top + bottom) / 2) * SCALE);
  r.rotate(-Math.PI / 2);
  r.font = c.font;
  r.textAlign = 'center';
  r.textBaseline = 'middle';
  r.fillStyle = 'rgb(0,150,0)'; // Prägung: etwas glatter als das Leder
  lines.forEach((t, i) => r.fillText(t, 0, (i - (lines.length - 1) / 2) * lh));
  r.restore();

  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const rm = new THREE.CanvasTexture(rc);
  return { map, rm };
}

/** Ledernarbung als Graustufen-Relief, kachelbar. */
export function leatherTexture(): THREE.CanvasTexture {
  const N = 256;
  const [cv, c] = canvas(N, N);
  const img = c.createImageData(N, N);
  const base = new Float32Array(N * N).map(() => Math.random());
  // zweimal weichzeichnen (kachelbar), dann Kontrast: kleine Poren und Falten
  let a = base;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[((y + dy + N) % N) * N + ((x + dx + N) % N)]!;
        b[y * N + x] = s / 9;
      }
    a = b;
  }
  for (let i = 0; i < N * N; i++) {
    const v = Math.min(255, Math.max(0, (a[i]! - 0.5) * 4 * 255 + 128));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Seitenschnitt: viele feine Blätter, leicht ungleichmäßig. */
export function pagesTexture(dark: boolean): THREE.CanvasTexture {
  const W = 256;
  const [cv, c] = canvas(W, 4);
  const paper = dark ? [214, 202, 178] : [240, 231, 210];
  for (let x = 0; x < W; x++) {
    const f = 0.9 + Math.random() * 0.12 - (x % 3 === 0 ? 0.06 : 0);
    c.fillStyle = `rgb(${paper.map((v) => Math.round(v * f)).join(',')})`;
    c.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export { shade };
