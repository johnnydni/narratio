/**
 * Bleistift auf Papier, als reine Rechnung ohne DOM (testbar, im Worker nutzbar).
 *
 * Modell: Das Papier hat eine Körnung (Höhen und Täler). Der Stift hinterlässt Graphit, wo die
 * Dichte unter ihm die Höhe des Korns übersteigt. Leichter Druck trifft nur die Spitzen, das
 * gibt den rissigen, gesprenkelten Strich; starker Druck füllt auch die Täler. Mehrfaches
 * Überstreichen derselben Stelle dunkelt nicht weiter nach (Maximum statt Summe), wie bei Graphit.
 *
 * Die Körnung hängt vom Seed des Strichs und von strichlokalen Koordinaten ab. Derselbe Strich
 * sieht deshalb nach dem Neuladen und an jeder Stelle der Seite gleich aus.
 */

/** Punkte als flache Liste: x, y, Druck (0–1), in CSS-Pixeln relativ zum Anker des Strichs. */
export type Points = number[];

export interface PencilRaster {
  /** Linke obere Ecke in CSS-Pixeln, im selben Bezug wie die Punkte. */
  x: number;
  y: number;
  /** Größe in Gerätepixeln. */
  width: number;
  height: number;
  scale: number;
  /** Deckkraft je Gerätepixel, 0–255. */
  alpha: Uint8ClampedArray;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Wertrauschen, 0–1, Zellgröße `cell` in CSS-Pixeln. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Papierkorn: feine Fasern plus gröbere Klumpen, wie bei Zeichenpapier. 0 = Tal, 1 = Spitze. */
export function paperGrain(x: number, y: number, seed: number): number {
  const fine = valueNoise(x, y, 1.1, seed);
  const mid = valueNoise(x, y, 2.6, seed + 17);
  const coarse = valueNoise(x, y, 7, seed + 31);
  const g = fine * 0.45 + mid * 0.35 + coarse * 0.2;
  // Die Mischung liegt eng um 0,5; spreizen, damit es echte Spitzen und Täler gibt.
  return Math.min(1, Math.max(0, (g - 0.5) * 2.4 + 0.5));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Rastert einen Strich. `width` ist die Stiftbreite in CSS-Pixeln bei vollem Druck.
 * Gibt null zurück, wenn es nichts zu zeichnen gibt.
 */
export function rasterizePencil(points: Points, width: number, seed: number, scale = 1): PencilRaster | null {
  const n = points.length / 3;
  if (n < 1) return null;
  const maxR = width * 0.62 + 1.5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const ox = Math.floor(minX - maxR);
  const oy = Math.floor(minY - maxR);
  const w = Math.ceil((maxX + maxR - ox) * scale);
  const h = Math.ceil((maxY + maxR - oy) * scale);
  const alpha = new Uint8ClampedArray(w * h);

  // Länge entlang des Strichs, für weiches Ansetzen und Abheben.
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    along.push(along[i - 1]! + Math.hypot(points[i * 3]! - points[i * 3 - 3]!, points[i * 3 + 1]! - points[i * 3 - 2]!));
  }
  const total = along[n - 1]!;
  const taper = Math.min(7, total / 3);

  // Körnung relativ zum ersten Punkt: Ein verschobener Strich behält sein Aussehen.
  const gx = points[0]!;
  const gy = points[1]!;
  const stamp = (cx: number, cy: number, pressure: number, dist: number) => {
    const ends = taper > 0 ? Math.min(1, (Math.min(dist, total - dist) + 1) / (taper + 1)) : 1;
    const p = pressure * (0.55 + 0.45 * ends);
    const r = (width / 2) * (0.5 + 0.5 * p) + 0.4;
    const x0 = Math.max(0, Math.floor((cx - r - 1 - ox) * scale));
    const x1 = Math.min(w - 1, Math.ceil((cx + r + 1 - ox) * scale));
    const y0 = Math.max(0, Math.floor((cy - r - 1 - oy) * scale));
    const y1 = Math.min(h - 1, Math.ceil((cy + r + 1 - oy) * scale));
    for (let py = y0; py <= y1; py++) {
      const y = oy + (py + 0.5) / scale;
      for (let px = x0; px <= x1; px++) {
        const x = ox + (px + 0.5) / scale;
        // Ränder ausfransen: Der Radius schwankt mit dem gröberen Korn.
        const wobble = 1 + 0.32 * (valueNoise(x - gx, y - gy, 3.2, seed + 7) - 0.5);
        const d = Math.hypot(x - cx, y - cy) / (r * wobble);
        if (d >= 1) continue;
        const density = p * (1 - smoothstep(0.15, 1, d)) * 1.05;
        const tooth = paperGrain(x - gx, y - gy, seed);
        const a = smoothstep(tooth - 0.06, tooth + 0.06, density) * (0.72 + 0.28 * valueNoise(x - gx, y - gy, 0.8, seed + 3));
        const v = a * 255;
        const k = py * w + px;
        if (v > alpha[k]!) alpha[k] = v;
      }
    }
  };

  // Stempel entlang der Strecken, dicht genug, dass keine Lücken entstehen.
  const step = Math.max(0.35, width * 0.18);
  stamp(points[0]!, points[1]!, points[2]!, 0);
  for (let i = 1; i < n; i++) {
    const ax = points[i * 3 - 3]!;
    const ay = points[i * 3 - 2]!;
    const ap = points[i * 3 - 1]!;
    const bx = points[i * 3]!;
    const by = points[i * 3 + 1]!;
    const bp = points[i * 3 + 2]!;
    const len = along[i]! - along[i - 1]!;
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      stamp(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t, along[i - 1]! + len * t);
    }
  }
  return { x: ox, y: oy, width: w, height: h, scale, alpha };
}

/**
 * Mit der Maus gibt es keinen Druck. Wir nehmen die Geschwindigkeit: schnelle Striche werden
 * leichter, langsame satter, wie bei einem echten Stift. `speed` in CSS-Pixeln pro Millisekunde.
 */
export function pressureFromSpeed(speed: number, previous: number | null): number {
  const target = Math.min(0.95, Math.max(0.42, 0.92 - speed * 0.16));
  return previous === null ? target : previous + (target - previous) * 0.25;
}

/** Abstand eines Punkts zum Strich, für den Radierer. */
export function distanceToStroke(points: Points, x: number, y: number): number {
  let best = Infinity;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    const bx = points[i * 3]!;
    const by = points[i * 3 + 1]!;
    if (i === 0) {
      best = Math.hypot(x - bx, y - by);
      continue;
    }
    const ax = points[i * 3 - 3]!;
    const ay = points[i * 3 - 2]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}
