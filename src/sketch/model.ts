import * as Y from 'yjs';
import type { Id } from '../model/types';
import type { Project } from '../store/project';
import type { Points } from './pencil';

/**
 * Bleistiftstriche über dem Szenentext (Scribble-Modus).
 *
 * Je Szene ein Y.Array `sketch:<id>` neben dem Szenentext `scene:<id>`. Jeder Strich hängt an
 * einem Absatz (oberste Ebene des Textes) und wandert mit ihm, wenn darüber geschrieben oder
 * gelöscht wird. Der Anker ist eine Yjs-RelativePosition auf diesen Absatz; die Punkte sind
 * CSS-Pixel relativ zur linken Seitenkante und zur Oberkante des Absatzes.
 *
 * Bewusst ungenau: Bricht der Absatz selbst anders um (breiteres Fenster, neue Wörter davor),
 * stimmt die Lage im Absatz nicht mehr wortgenau. Wortgenaue Anker wären deutlich teurer.
 */

/** Farben sind Rollen, keine Werte: Graphit muss im Dunkelmodus hell sein. */
export const SKETCH_COLORS = ['graphite', 'red', 'blue', 'green'] as const;
export type SketchColor = (typeof SKETCH_COLORS)[number];
export const SKETCH_COLOR_LABEL: Record<SketchColor, string> = { graphite: 'Graphit', red: 'Rot', blue: 'Blau', green: 'Grün' };

export interface Stroke {
  id: string;
  /** Y.relativePositionToJSON auf den Absatz. */
  anchor: unknown;
  color: SketchColor;
  /** Stiftbreite in CSS-Pixeln. */
  width: number;
  seed: number;
  pts: Points;
  /** Kurz nacheinander gezeichnete Striche bilden eine Zeichnung und werden gemeinsam verschoben. */
  group: string;
}

/** Form in der Sicherung: statt der Yjs-Position die Nummer des Absatzes. */
export interface StrokeJson extends Omit<Stroke, 'anchor'> {
  block: number;
}

/** Herkunft der Zeichen-Transaktionen, damit Rückgängig nur Striche erfasst. */
export const SKETCH_ORIGIN = Symbol('sketch');

export function sketchArray(project: Project, sceneId: Id): Y.Array<Stroke> {
  return project.doc.getArray<Stroke>(`sketch:${sceneId}`);
}

export function anchorAt(frag: Y.XmlFragment, block: number): unknown {
  const index = Math.max(0, Math.min(block, frag.length - 1));
  return Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(frag, index));
}

/** Absatznummer des Ankers, oder null, wenn er sich nicht mehr auflösen lässt. */
export function blockOf(frag: Y.XmlFragment, anchor: unknown): number | null {
  if (!frag.doc || !frag.length) return null;
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(anchor), frag.doc);
    if (!abs || abs.type !== frag) return null;
    // Ist der Absatz gelöscht, zeigt die Position auf den folgenden; am Ende auf den letzten.
    return Math.min(abs.index, frag.length - 1);
  } catch {
    return null;
  }
}

export function addStroke(project: Project, sceneId: Id, stroke: Stroke): void {
  project.doc.transact(() => sketchArray(project, sceneId).push([stroke]), SKETCH_ORIGIN);
}

export function removeStrokes(project: Project, sceneId: Id, ids: Set<string>): void {
  const arr = sketchArray(project, sceneId);
  project.doc.transact(() => {
    for (let i = arr.length - 1; i >= 0; i--) if (ids.has(arr.get(i).id)) arr.delete(i, 1);
  }, SKETCH_ORIGIN);
}

/**
 * Hängt Striche an einen neuen Absatz und verschiebt ihre Punkte um (dx, dy). Der Aufrufer
 * rechnet den Wechsel der Absatzoberkante in dy ein, damit die Punkte zum neuen Anker passen.
 */
export function moveStrokes(project: Project, sceneId: Id, moves: Map<string, { anchor: unknown; dx: number; dy: number }>): void {
  const arr = sketchArray(project, sceneId);
  project.doc.transact(() => {
    for (let i = 0; i < arr.length; i++) {
      const s = arr.get(i);
      const m = moves.get(s.id);
      if (!m) continue;
      const pts = s.pts.slice();
      for (let k = 0; k < pts.length; k += 3) {
        pts[k] = round1(pts[k]! + m.dx);
        pts[k + 1] = round1(pts[k + 1]! + m.dy);
      }
      arr.delete(i, 1);
      arr.insert(i, [{ ...s, anchor: m.anchor, pts }]);
    }
  }, SKETCH_ORIGIN);
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function sketchesToJson(project: Project, sceneId: Id): StrokeJson[] {
  const frag = project.sceneFragment(sceneId);
  const out: StrokeJson[] = [];
  for (const { anchor, ...rest } of sketchArray(project, sceneId).toArray()) {
    const block = blockOf(frag, anchor);
    if (block !== null) out.push({ ...rest, block });
  }
  return out;
}

/** Nach writeScene aufrufen, damit die Absätze schon existieren. */
export function writeSketches(project: Project, sceneId: Id, strokes: StrokeJson[]): void {
  const frag = project.sceneFragment(sceneId);
  const arr = sketchArray(project, sceneId);
  if (arr.length) arr.delete(0, arr.length);
  if (!frag.length) return;
  arr.push(strokes.map(({ block, ...rest }) => ({ ...rest, anchor: anchorAt(frag, block) })));
}
