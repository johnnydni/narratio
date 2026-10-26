import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectEntry } from '../../store/library';
import { BOOKEND, GAP, hash, NEW_SLOT, SHELF_PAD_X, shelfRows, SPINE_COLORS, spineHeight, spineWidth } from '../books';
import { prefersReducedMotion } from '../prefs';
import { clickSound, LAMP_WIDTH } from './lamp';
import { LibraryScene, shelfHeight, type ScreenRect, type ShelfSpec } from './scene';

/**
 * Das Regal in 3D. Gezeichnet wird mit WebGL; bedient wird über echte, unsichtbare Knöpfe,
 * die jedes Bild auf den Rücken ihres Buchs gelegt werden. Damit bleiben Tab-Reihenfolge,
 * Screenreader, Doppelklick und die Tests dieselben wie beim flachen Regal.
 */

interface Props {
  books: ProjectEntry[];
  selected: string | null;
  opening: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  tail: React.ReactNode;
  dark: boolean;
  /** Knopf an der Lampe: schaltet das Design um */
  onLamp: () => void;
  /** WebGL fehlt oder ist abgestürzt: zurück zum flachen Regal */
  onFail: () => void;
}

export default function Shelf3D({ books, selected, opening, onSelect, onOpen, tail, dark, onLamp, onFail }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<LibraryScene | null>(null);
  const btnRefs = useRef(new Map<string, HTMLButtonElement>());
  const slotRef = useRef<HTMLDivElement>(null);
  const lampRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => shelfRows(books, width || 1000, LAMP_WIDTH), [books, width]);
  const height = shelfHeight(rows.length);

  const spec = useMemo<ShelfSpec>(() => {
    const out: ShelfSpec = { width, rows: rows.length, books: [], bookends: [], slot: null, lamp: { x: SHELF_PAD_X + 96, row: 0 } };
    rows.forEach((row, r) => {
      // im obersten Fach steht links die Lampe, die Bücher folgen rechts davon
      let x = SHELF_PAD_X + (r === 0 ? LAMP_WIDTH : 0);
      for (const p of row) {
        const h = hash(p.id);
        out.books.push({ id: p.id, name: p.name, color: SPINE_COLORS[p.color % 8]!, deco: h % 3, seed: h, w: spineWidth(p), h: spineHeight(p), x, row: r });
        x += spineWidth(p) + GAP;
      }
      if (r === rows.length - 1) {
        out.slot = { x: x + 8, row: r, w: NEW_SLOT - 8, h: 206 };
        x += NEW_SLOT;
      }
      out.bookends.push(Math.min(x, width - SHELF_PAD_X - BOOKEND + 4));
    });
    return out;
  }, [rows, width]);

  // Szene anlegen und wieder abbauen
  useEffect(() => {
    const canvas = canvasRef.current!;
    let scene: LibraryScene;
    try {
      scene = new LibraryScene(canvas);
    } catch {
      onFail();
      return;
    }
    sceneRef.current = scene;
    scene.setReducedMotion(prefersReducedMotion());
    scene.onFrame = (rects: Map<string, ScreenRect>, slot: ScreenRect | null, lamp: ScreenRect | null) => {
      const l = lampRef.current;
      if (l && lamp) {
        // der Knopf ist klein: Trefferfläche mindestens 36 px, um seine Mitte
        const w = Math.max(36, lamp.w);
        const h = Math.max(36, lamp.h);
        l.style.transform = `translate(${lamp.x + lamp.w / 2 - w / 2}px, ${lamp.y + lamp.h / 2 - h / 2}px)`;
        l.style.width = `${w}px`;
        l.style.height = `${h}px`;
      }
      for (const [id, r] of rects) {
        const b = btnRefs.current.get(id);
        if (!b) continue;
        b.style.transform = `translate(${r.x}px, ${r.y}px)`;
        b.style.width = `${r.w}px`;
        b.style.height = `${r.h}px`;
      }
      const s = slotRef.current;
      if (s && slot) s.style.transform = `translate(${slot.x}px, ${slot.y}px)`;
    };
    const lost = (e: Event) => {
      e.preventDefault();
      onFail();
    };
    canvas.addEventListener('webglcontextlost', lost);
    const move = (e: PointerEvent) => scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    window.addEventListener('pointermove', move);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => scene.setReducedMotion(prefersReducedMotion());
    motion.addEventListener('change', onMotion);
    // Literata kommt eventuell erst nach dem ersten Bild: dann die Titel neu setzen
    let alive = true;
    void document.fonts?.load('500 28px Literata').then(() => alive && scene.redrawSpines());
    return () => {
      alive = false;
      canvas.removeEventListener('webglcontextlost', lost);
      window.removeEventListener('pointermove', move);
      motion.removeEventListener('change', onMotion);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [onFail]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !width) return;
    s.resize(width, height);
    s.setShelf(spec);
  }, [spec, width, height]);

  useEffect(() => sceneRef.current?.setTheme(dark), [dark]);
  useEffect(() => sceneRef.current?.setState({ hovered, selected, opening }), [hovered, selected, opening]);

  return (
    <div className="shelf3d" ref={wrapRef} style={{ height }}>
      <canvas ref={canvasRef} className="shelf3d-canvas" style={{ width: '100%', height }} aria-hidden="true" />
      <div className="shelf3d-hits">
        {books.map((p) => (
          <button
            key={p.id}
            ref={(el) => {
              if (el) btnRefs.current.set(p.id, el);
              else btnRefs.current.delete(p.id);
            }}
            type="button"
            className={`book3d-hit ${selected === p.id ? 'selected' : ''} ${opening === p.id ? 'opening' : ''}`}
            onClick={() => onSelect(p.id)}
            onDoubleClick={() => onOpen(p.id)}
            onPointerEnter={() => setHovered(p.id)}
            onPointerLeave={() => setHovered((h) => (h === p.id ? null : h))}
            onFocus={() => setHovered(p.id)}
            onBlur={() => setHovered((h) => (h === p.id ? null : h))}
            aria-pressed={selected === p.id}
            aria-label={p.name}
            title={p.name}
            data-testid="book"
          />
        ))}
        <button
          ref={lampRef}
          type="button"
          className="lamp3d-hit"
          aria-pressed={dark}
          aria-label="Schreibtischlampe"
          title={dark ? 'Lampe ausschalten: helles Design' : 'Lampe einschalten: dunkles Design'}
          data-testid="lamp-switch"
          onClick={() => {
            sceneRef.current?.pressLamp();
            clickSound(!dark);
            onLamp();
          }}
        />
        <div className="shelf3d-slot" ref={slotRef}>
          {tail}
        </div>
      </div>
    </div>
  );
}
