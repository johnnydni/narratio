import type { ProjectEntry } from '../store/library';

/** Maße und Anordnung der Bücher im Regal, gemeinsam für das flache und das 3D-Regal. */

/** Kleiner, fester Zufall je Projekt: Höhe und Zierde des Buchs bleiben bei jedem Besuch gleich. */
export function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function spineWidth(p: ProjectEntry): number {
  const words = p.stats?.words ?? 0;
  return Math.round(46 + Math.min(44, Math.log10(1 + words) * 10));
}

export function spineHeight(p: ProjectEntry): number {
  return 206 + (hash(p.id) % 5) * 9;
}

/** Rückenfarben, wie `.c0` bis `.c7` in styles.css. */
export const SPINE_COLORS = ['#1f5c52', '#7a2e2e', '#2c3e63', '#8a6a2a', '#4b3a5e', '#3d5a3a', '#6b4a3a', '#2f4f5f'];

export const GAP = 6;
export const BOOKEND = 34;
export const NEW_SLOT = 64;
export const SHELF_PAD_X = 24;

/** Bücher auf Bretter verteilen: so viele, wie samt Buchstütze nebeneinander passen. */
export function shelfRows(books: ProjectEntry[], width: number): ProjectEntry[][] {
  const avail = width - 2 * SHELF_PAD_X - BOOKEND;
  const out: ProjectEntry[][] = [[]];
  let used = 0;
  for (const b of books) {
    const w = spineWidth(b) + GAP;
    if (used + w > avail && out[out.length - 1]!.length) {
      out.push([]);
      used = 0;
    }
    out[out.length - 1]!.push(b);
    used += w;
  }
  if (used + NEW_SLOT > avail && out[out.length - 1]!.length) out.push([]);
  return out;
}
