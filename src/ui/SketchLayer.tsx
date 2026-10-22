import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import type { Id } from '../model/types';
import type { Project } from '../store/project';
import { newId } from '../store/project';
import { distanceToStroke, pressureFromSpeed, rasterizePencil, type Points } from '../sketch/pencil';
import {
  addStroke,
  anchorAt,
  blockOf,
  moveStrokes,
  removeStrokes,
  round1,
  sketchArray,
  SKETCH_COLOR_LABEL,
  SKETCH_COLORS,
  SKETCH_ORIGIN,
  type SketchColor,
  type Stroke,
} from '../sketch/model';

/**
 * Scribble-Modus: Strg halten, und die Maus wird zum Bleistift, der direkt über den Text zeichnet.
 *   Strg + Ziehen              zeichnen
 *   Strg + Rechts/Umschalt     radieren (ganze Striche)
 *   Strg + Alt + Ziehen        Zeichnung greifen und verschieben
 *   Strg + Z / Strg + Y        letzten Strich zurück / wieder, solange zuletzt gezeichnet wurde
 *
 * Jeder Strich ist ein eigenes kleines Canvas in der Seite. Der Browser scrollt sie mit; bei
 * Textänderungen werden nur ihre Positionen neu gesetzt, nicht neu gerastert.
 */

export interface SketchSettings {
  color: SketchColor;
  width: number;
  visible: boolean;
}

export const SKETCH_DEFAULTS: SketchSettings = { color: 'graphite', width: 4, visible: true };

type Mode = 'off' | 'draw' | 'pick';

/** Striche, die so kurz nacheinander entstehen, gehören zu einer Zeichnung. */
const GROUP_GAP_MS = 1800;

interface Entry {
  stroke: Stroke;
  canvas: HTMLCanvasElement;
  key: string;
  /** Rasterlage relativ zum Anker, in CSS-Pixeln. */
  rx: number;
  ry: number;
  /** Absatzoberkante im Ebenenbezug, zuletzt berechnet. */
  top: number;
}

function cssColor(color: SketchColor): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--sketch-${color}`).trim() || '#2b2b2e';
}

function rgb(color: string): [number, number, number] {
  const c = document.createElement('canvas').getContext('2d')!;
  c.fillStyle = color;
  const hex = c.fillStyle as string;
  if (hex.startsWith('#')) return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const m = hex.match(/\d+/g) ?? ['43', '43', '46'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** Rastert einen Strich in ein Canvas. Gibt die Lage des Rasters relativ zum Anker zurück. */
function paint(canvas: HTMLCanvasElement, pts: Points, width: number, seed: number, color: [number, number, number]): { rx: number; ry: number } | null {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const r = rasterizePencil(pts, width, seed, scale);
  if (!r) return null;
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.style.width = `${r.width / scale}px`;
  canvas.style.height = `${r.height / scale}px`;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(r.width, r.height);
  for (let i = 0; i < r.alpha.length; i++) {
    const a = r.alpha[i]!;
    if (!a) continue;
    img.data[i * 4] = color[0];
    img.data[i * 4 + 1] = color[1];
    img.data[i * 4 + 2] = color[2];
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return { rx: r.x, ry: r.y };
}

function modeOf(e: { ctrlKey: boolean; altKey: boolean }): Mode {
  if (!e.ctrlKey) return 'off';
  return e.altKey ? 'pick' : 'draw';
}

function isMounted(editor: Editor): boolean {
  try {
    return !editor.isDestroyed && !!editor.view.dom;
  } catch {
    return false;
  }
}

/** Der Editor, sobald seine Ansicht im DOM hängt; vorher wirft editor.view. */
function useMountedEditor(editor: Editor | null): Editor | null {
  const [mounted, setMounted] = useState<Editor | null>(null);
  useEffect(() => {
    if (!editor) return setMounted(null);
    const check = () => setMounted(isMounted(editor) ? editor : null);
    check();
    editor.on('mount', check);
    editor.on('create', check);
    editor.on('unmount', check);
    return () => {
      editor.off('mount', check);
      editor.off('create', check);
      editor.off('unmount', check);
    };
  }, [editor]);
  return mounted;
}

export default function SketchLayer({ editor: anyEditor, project, sceneId, settings }: { editor: Editor | null; project: Project; sceneId: Id; settings: SketchSettings }) {
  const editor = useMountedEditor(anyEditor);
  const layerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('off');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const enabled = settings.visible && !!editor;

  // Strg/Alt verfolgen. Auch an der Maus, falls die Taste außerhalb des Fensters losgelassen wurde.
  useEffect(() => {
    if (!enabled) {
      setMode('off');
      return;
    }
    const sync = (e: KeyboardEvent | PointerEvent) => setMode(modeOf(e));
    const off = () => setMode('off');
    window.addEventListener('keydown', sync, true);
    window.addEventListener('keyup', sync, true);
    window.addEventListener('pointermove', sync, true);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', sync, true);
      window.removeEventListener('keyup', sync, true);
      window.removeEventListener('pointermove', sync, true);
      window.removeEventListener('blur', off);
    };
  }, [enabled]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!editor || !layer) return;
    const frag = project.sceneFragment(sceneId);
    const arr = sketchArray(project, sceneId);
    const entries = new Map<string, Entry>();
    const colors = new Map<SketchColor, [number, number, number]>();
    const colorOf = (c: SketchColor) => {
      let v = colors.get(c);
      if (!v) colors.set(c, (v = rgb(cssColor(c))));
      return v;
    };

    /* ---------- Lage der Absätze ---------- */

    const blockTops = (): number[] => {
      const base = layer.getBoundingClientRect().top;
      const tops: number[] = [];
      editor.state.doc.forEach((_node, offset) => {
        const dom = editor.view.nodeDOM(offset);
        tops.push(dom instanceof HTMLElement ? dom.getBoundingClientRect().top - base : tops[tops.length - 1] ?? 0);
      });
      return tops;
    };

    /** Absatz, in dessen Höhe y (Ebenenbezug) liegt: der letzte, der darüber beginnt. */
    const blockAt = (tops: number[], y: number): number => {
      let b = 0;
      for (let i = 0; i < tops.length; i++) if (tops[i]! <= y) b = i;
      return b;
    };

    /* ---------- Darstellen ---------- */

    let frame = 0;
    const layout = () => {
      frame = 0;
      const tops = blockTops();
      const seen = new Set<string>();
      for (const stroke of arr.toArray()) {
        seen.add(stroke.id);
        const block = blockOf(frag, stroke.anchor);
        let e = entries.get(stroke.id);
        const key = `${stroke.color}|${colorOf(stroke.color).join()}|${stroke.width}|${stroke.pts.length}|${stroke.pts[0]},${stroke.pts[1]}`;
        if (!e || e.key !== key) {
          const canvas = e?.canvas ?? document.createElement('canvas');
          canvas.className = 'sketch-stroke';
          const at = paint(canvas, stroke.pts, stroke.width, stroke.seed, colorOf(stroke.color));
          if (!at) continue;
          if (!e) layer.appendChild(canvas);
          e = { stroke, canvas, key, rx: at.rx, ry: at.ry, top: 0 };
          entries.set(stroke.id, e);
        }
        e.stroke = stroke;
        e.top = block === null ? 0 : tops[block] ?? 0;
        e.canvas.dataset.group = stroke.group;
        e.canvas.style.display = block === null ? 'none' : '';
        e.canvas.style.transform = `translate(${e.rx}px, ${e.top + e.ry}px)`;
      }
      for (const [id, e] of entries) {
        if (seen.has(id)) continue;
        e.canvas.remove();
        entries.delete(id);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };
    layout();

    const onStrokes = () => schedule();
    arr.observe(onStrokes);
    editor.on('update', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(layer);
    ro.observe(editor.view.dom);
    // Design gewechselt: Farben neu auflösen und alles neu rastern.
    const recolor = () => {
      colors.clear();
      schedule();
    };
    const mo = new MutationObserver(recolor);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', recolor);

    /* ---------- Rückgängig ---------- */

    const undo = new Y.UndoManager(arr, { trackedOrigins: new Set([SKETCH_ORIGIN]), captureTimeout: 0 });
    let lastSketch = 0;
    let lastText = 0;
    const onInput = () => (lastText = performance.now());
    editor.view.dom.addEventListener('beforeinput', onInput);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || lastSketch <= lastText) return;
      const k = e.key.toLowerCase();
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      const isUndo = k === 'z' && !e.shiftKey;
      if (isUndo && undo.undoStack.length) undo.undo();
      else if (isRedo && undo.redoStack.length) undo.redo();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);

    /* ---------- Zeichnen, Radieren, Verschieben ---------- */

    let lastGroup = '';
    let lastStrokeEnd = 0;
    let gesture:
      | { kind: 'draw'; id: string; pointer: number; block: number; top: number; pts: number[]; canvas: HTMLCanvasElement; seed: number; last: { x: number; y: number; t: number; p: number | null } }
      | { kind: 'erase'; pointer: number; doomed: Set<string> }
      | { kind: 'move'; pointer: number; group: string; x0: number; y0: number; dx: number; dy: number }
      | null = null;

    const local = (e: PointerEvent) => {
      const r = layer.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const hit = (x: number, y: number, slack: number): Entry | null => {
      let best: Entry | null = null;
      let bestD = Infinity;
      for (const e of entries.values()) {
        if (e.canvas.style.display === 'none') continue;
        const d = distanceToStroke(e.stroke.pts, x, y - e.top);
        if (d < e.stroke.width / 2 + slack && d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    };

    const groupCanvases = (group: string) => [...entries.values()].filter((e) => e.stroke.group === group);

    let hovered = '';
    const setHover = (group: string) => {
      if (group === hovered) return;
      for (const e of groupCanvases(hovered)) e.canvas.classList.remove('hover');
      hovered = group;
      layer.classList.toggle('has-hover', !!group);
      for (const e of groupCanvases(group)) e.canvas.classList.add('hover');
    };

    const redrawLive = () => {
      if (gesture?.kind !== 'draw') return;
      const s = settingsRef.current;
      const at = paint(gesture.canvas, gesture.pts, s.width, gesture.seed, colorOf(s.color));
      if (at) gesture.canvas.style.transform = `translate(${at.rx}px, ${gesture.top + at.ry}px)`;
    };
    let liveFrame = 0;
    const scheduleLive = () => {
      if (!liveFrame) liveFrame = requestAnimationFrame(() => {
        liveFrame = 0;
        redrawLive();
      });
    };

    const addPoint = (ev: PointerEvent) => {
      if (gesture?.kind !== 'draw') return;
      const { x, y } = local(ev);
      const ry = y - gesture.top;
      const last = gesture.last;
      const dist = Math.hypot(x - last.x, y - last.y);
      if (gesture.pts.length && dist < 0.8) return;
      let p: number;
      if (ev.pointerType === 'pen' && ev.pressure > 0) p = ev.pressure;
      else p = pressureFromSpeed(gesture.pts.length ? dist / Math.max(1, ev.timeStamp - last.t) : 0, last.p);
      gesture.last = { x, y, t: ev.timeStamp, p };
      gesture.pts.push(round1(x), round1(ry), Math.round(p * 100) / 100);
    };

    const onDown = (e: PointerEvent) => {
      const m = modeOf(e);
      if (m === 'off' || gesture) return;
      e.preventDefault();
      e.stopPropagation();
      layer.setPointerCapture(e.pointerId);
      const { x, y } = local(e);
      if (m === 'pick') {
        const target = hit(x, y, 8);
        if (!target) return;
        gesture = { kind: 'move', pointer: e.pointerId, group: target.stroke.group, x0: x, y0: y, dx: 0, dy: 0 };
        for (const g of groupCanvases(target.stroke.group)) g.canvas.classList.add('moving');
        return;
      }
      if (e.button === 2 || e.shiftKey) {
        gesture = { kind: 'erase', pointer: e.pointerId, doomed: new Set() };
        onMove(e);
        return;
      }
      const tops = blockTops();
      const block = blockAt(tops, y);
      const canvas = document.createElement('canvas');
      canvas.className = 'sketch-stroke live';
      layer.appendChild(canvas);
      gesture = { kind: 'draw', id: newId('k'), pointer: e.pointerId, block, top: tops[block] ?? 0, pts: [], canvas, seed: Math.floor(Math.random() * 1e6), last: { x, y, t: e.timeStamp, p: null } };
      addPoint(e);
      scheduleLive();
    };

    const onMove = (e: PointerEvent) => {
      if (!gesture) {
        if (modeOf(e) === 'pick') {
          const { x, y } = local(e);
          setHover(hit(x, y, 8)?.stroke.group ?? '');
        } else setHover('');
        return;
      }
      if (e.pointerId !== gesture.pointer) return;
      if (gesture.kind === 'draw') {
        for (const ev of e.getCoalescedEvents?.() ?? [e]) addPoint(ev);
        scheduleLive();
      } else if (gesture.kind === 'erase') {
        const { x, y } = local(e);
        const target = hit(x, y, 6);
        if (target && !gesture.doomed.has(target.stroke.id)) {
          gesture.doomed.add(target.stroke.id);
          target.canvas.classList.add('doomed');
        }
      } else {
        const { x, y } = local(e);
        gesture.dx = x - gesture.x0;
        gesture.dy = y - gesture.y0;
        for (const g of groupCanvases(gesture.group)) g.canvas.style.transform = `translate(${g.rx + gesture.dx}px, ${g.top + g.ry + gesture.dy}px)`;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!gesture || e.pointerId !== gesture.pointer) return;
      const g = gesture;
      gesture = null;
      if (g.kind === 'draw') {
        g.canvas.remove();
        if (!g.pts.length) return;
        const now = performance.now();
        const group = lastGroup && now - lastStrokeEnd < GROUP_GAP_MS ? lastGroup : newId('g');
        lastGroup = group;
        lastStrokeEnd = now;
        lastSketch = now;
        const s = settingsRef.current;
        addStroke(project, sceneId, { id: g.id, anchor: anchorAt(frag, g.block), color: s.color, width: s.width, seed: g.seed, pts: g.pts, group });
      } else if (g.kind === 'erase') {
        if (g.doomed.size) {
          lastSketch = performance.now();
          removeStrokes(project, sceneId, g.doomed);
        }
      } else {
        const members = groupCanvases(g.group);
        for (const m of members) m.canvas.classList.remove('moving');
        if (Math.abs(g.dx) < 1 && Math.abs(g.dy) < 1) {
          schedule();
          return;
        }
        // Neuer Anker: der Absatz unter der Oberkante der verschobenen Zeichnung.
        const tops = blockTops();
        const groupTop = Math.min(...members.map((m) => m.top + m.ry)) + g.dy;
        const block = blockAt(tops, groupTop);
        const anchor = anchorAt(frag, block);
        const moves = new Map<string, { anchor: unknown; dx: number; dy: number }>();
        for (const m of members) moves.set(m.stroke.id, { anchor, dx: g.dx, dy: m.top + g.dy - (tops[block] ?? 0) });
        lastSketch = performance.now();
        // Kein neuer Gruppenanschluss: Nach dem Verschieben beginnt die nächste Zeichnung neu.
        lastGroup = '';
        moveStrokes(project, sceneId, moves);
      }
    };

    const onContext = (e: MouseEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };

    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('pointercancel', onUp);
    layer.addEventListener('contextmenu', onContext);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(liveFrame);
      arr.unobserve(onStrokes);
      editor.off('update', schedule);
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener('change', recolor);
      undo.destroy();
      editor.view.dom.removeEventListener('beforeinput', onInput);
      window.removeEventListener('keydown', onKey, true);
      layer.removeEventListener('pointerdown', onDown);
      layer.removeEventListener('pointermove', onMove);
      layer.removeEventListener('pointerup', onUp);
      layer.removeEventListener('pointercancel', onUp);
      layer.removeEventListener('contextmenu', onContext);
      for (const e of entries.values()) e.canvas.remove();
    };
  }, [editor, project, sceneId]);

  return <div ref={layerRef} className="sketch-layer" data-mode={mode} hidden={!settings.visible} data-testid="sketch-layer" aria-hidden="true" />;
}

const WIDTHS: { w: number; label: string }[] = [
  { w: 2, label: 'Fein' },
  { w: 4, label: 'Mittel' },
  { w: 7, label: 'Kräftig' },
  { w: 12, label: 'Breit' },
];

/** Stift in der Werkzeugleiste: Farbe, Stärke, ein- und ausblenden. */
export function SketchTools({ settings, onChange }: { settings: SketchSettings; onChange: (s: SketchSettings) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 268)) });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`tool ${open ? 'on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Bleistift: Strg halten und ziehen. Strg+Alt verschiebt Zeichnungen."
        data-testid="sketch-tools"
      >
        <span className="sketch-dot" style={{ background: `var(--sketch-${settings.color})`, opacity: settings.visible ? 1 : 0.35 }} /> Stift
      </button>
      {open && pos && createPortal(
        <div ref={box} className="picker sketch-pop" role="dialog" aria-label="Bleistift" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
          <SketchOptions settings={settings} onChange={onChange} />
          <div className="sketch-help muted small">
            <div><kbd>Strg</kbd> + Ziehen: zeichnen</div>
            <div><kbd>Strg</kbd> + Rechtsklick oder <kbd>Umschalt</kbd>: radieren</div>
            <div><kbd>Strg</kbd> + <kbd>Alt</kbd> + Ziehen: verschieben</div>
            <div><kbd>Strg</kbd> + <kbd>Z</kbd>: letzten Strich zurück</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Farbe, Stärke und Sichtbarkeit; im Stift-Popover und im Einstellungsmenü. */
export function SketchOptions({ settings, onChange }: { settings: SketchSettings; onChange: (s: SketchSettings) => void }) {
  const set = (patch: Partial<SketchSettings>) => onChange({ ...settings, ...patch });
  return (
    <>
      <div className="sketch-row" role="radiogroup" aria-label="Farbe">
        {SKETCH_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={settings.color === c} className={`sketch-swatch ${settings.color === c ? 'on' : ''}`} title={SKETCH_COLOR_LABEL[c]} aria-label={SKETCH_COLOR_LABEL[c]} onClick={() => set({ color: c })}>
            <span style={{ background: `var(--sketch-${c})` }} />
          </button>
        ))}
      </div>
      <div className="sketch-row" role="radiogroup" aria-label="Stärke">
        {WIDTHS.map(({ w, label }) => (
          <button key={w} type="button" role="radio" aria-checked={settings.width === w} className={`sketch-width ${settings.width === w ? 'on' : ''}`} title={label} aria-label={label} onClick={() => set({ width: w })}>
            <span style={{ width: Math.max(3, w), height: Math.max(3, w), background: `var(--sketch-${settings.color})` }} />
          </button>
        ))}
      </div>
      <label className="sketch-check">
        <input type="checkbox" checked={settings.visible} onChange={(e) => set({ visible: e.target.checked })} /> Zeichnungen zeigen
      </label>
    </>
  );
}
