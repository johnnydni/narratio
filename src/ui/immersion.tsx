import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audio, SCAPES, type ScapeId } from '../audio/engine';
import { useLocalSetting } from './state';
import { Icon } from './icons';

/**
 * Eintauchen beim Schreiben: Wer zügig schreibt, dem blendet narratio langsam die Oberfläche
 * aus und die gewählte Klangwelt ein. Eine Mausbewegung oder Esc holt alles zurück.
 */

export interface ImmersionSettings {
  scape: ScapeId | null;
  ambientVolume: number;
  keys: boolean;
  keysVolume: number;
  auto: boolean;
}

const DEFAULTS: ImmersionSettings = { scape: 'rain', ambientVolume: 0.45, keys: true, keysVolume: 0.5, auto: true };

interface Ctx {
  settings: ImmersionSettings;
  update(patch: Partial<ImmersionSettings>): void;
  immersed: boolean;
  previewing: boolean;
  togglePreview(): void;
  /** Vom Editor bei jedem Tastendruck aufgerufen. */
  onWritingKey(e: KeyboardEvent): void;
}

const ImmersionContext = createContext<Ctx | null>(null);

export function useImmersion(): Ctx {
  const c = useContext(ImmersionContext);
  if (!c) throw new Error('Kein ImmersionProvider');
  return c;
}

/** So viele Anschläge innerhalb des Fensters zählen als "im Schreibfluss". */
const KEYS_TO_IMMERSE = 14;
const WINDOW_MS = 9000;

export function ImmersionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useLocalSetting<ImmersionSettings>('immersion', DEFAULTS);
  const [immersed, setImmersed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const stamps = useRef<number[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const immersedRef = useRef(false);
  immersedRef.current = immersed;

  const update = useCallback((patch: Partial<ImmersionSettings>) => setSettings({ ...settingsRef.current, ...patch }), [setSettings]);

  useEffect(() => audio.setScape(settings.scape), [settings.scape]);
  useEffect(() => audio.setAmbientVolume(settings.ambientVolume), [settings.ambientVolume]);
  useEffect(() => audio.setKeysVolume(settings.keysVolume), [settings.keysVolume]);

  const leave = useCallback(() => {
    if (!immersedRef.current) return;
    setImmersed(false);
    stamps.current = [];
    if (!previewingRef.current) audio.fadeAmbient(false, 2.5);
  }, []);
  const previewingRef = useRef(false);
  previewingRef.current = previewing;

  const onWritingKey = useCallback((e: KeyboardEvent) => {
    const s = settingsRef.current;
    if (e.key === 'Escape') {
      leave();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const kind =
      e.key === 'Enter' ? 'enter' : e.key === ' ' ? 'space' : e.key === 'Backspace' || e.key === 'Delete' ? 'back' : e.key.length === 1 ? 'char' : null;
    if (!kind) return;
    if (s.keys) audio.key(kind, s.keysVolume);
    if (!s.auto || immersedRef.current) return;
    const now = performance.now();
    stamps.current = stamps.current.filter((t) => now - t < WINDOW_MS);
    stamps.current.push(now);
    if (stamps.current.length >= KEYS_TO_IMMERSE) {
      setImmersed(true);
      if (s.scape) audio.fadeAmbient(true, 4);
    }
  }, [leave]);

  // Mausbewegung (nicht nur Zittern) beendet das Eintauchen
  useEffect(() => {
    if (!immersed) return;
    let dist = 0;
    let last: { x: number; y: number } | null = null;
    const onMove = (e: MouseEvent) => {
      if (last) dist += Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      if (dist > 60) leave();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') leave(); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [immersed, leave]);

  useEffect(() => {
    document.documentElement.classList.toggle('immersed', immersed);
  }, [immersed]);

  const togglePreview = useCallback(() => {
    setPreviewing((p) => {
      const next = !p;
      if (next && settingsRef.current.scape) audio.fadeAmbient(true, 1.5);
      if (!next && !immersedRef.current) audio.fadeAmbient(false, 1.5);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update, immersed, previewing, togglePreview, onWritingKey }), [settings, update, immersed, previewing, togglePreview, onWritingKey]);
  return <ImmersionContext.Provider value={value}>{children}</ImmersionContext.Provider>;
}

/** Klangwahl in der Kopfleiste. */
export function AmbientPicker() {
  const { settings, update, previewing, togglePreview } = useImmersion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="ambient" ref={ref}>
      <button type="button" className="icon-btn" aria-label="Klang beim Schreiben" aria-expanded={open} aria-pressed={previewing} onClick={() => setOpen(!open)}>
        <Icon name="headphones" />
      </button>
      {open && (
        <div className="ambient-pop" role="dialog" aria-label="Klang beim Schreiben">
          <div className="toggle-row">
            <span style={{ fontWeight: 600 }}>Klang beim Schreiben</span>
            <button type="button" className={`btn small ${previewing ? 'primary' : ''}`} onClick={togglePreview} disabled={!settings.scape}>
              {previewing ? 'Anhören beenden' : 'Anhören'}
            </button>
          </div>
          <div className="scapes">
            {SCAPES.map((s) => (
              <button key={s.id} type="button" className={`scape ${settings.scape === s.id ? 'on' : ''}`} aria-pressed={settings.scape === s.id} onClick={() => update({ scape: s.id })}>
                <span className="name">{s.name}</span>
                <span className="muted small">{s.hint}</span>
              </button>
            ))}
            <button type="button" className={`scape ${settings.scape === null ? 'on' : ''}`} aria-pressed={settings.scape === null} onClick={() => update({ scape: null })}>
              <span className="name">Stille</span>
              <span className="muted small">Keine Klangwelt</span>
            </button>
          </div>
          <label className="field">
            <span className="label">Lautstärke Klangwelt</span>
            <input className="range" type="range" min={0} max={1} step={0.01} value={settings.ambientVolume} onChange={(e) => update({ ambientVolume: Number(e.target.value) })} />
          </label>
          <label className="toggle-row">
            <span>Schreibmaschine</span>
            <input className="switch" type="checkbox" checked={settings.keys} onChange={(e) => update({ keys: e.target.checked })} />
          </label>
          {settings.keys && (
            <label className="field">
              <span className="label">Lautstärke Anschläge</span>
              <input className="range" type="range" min={0} max={1} step={0.01} value={settings.keysVolume} onChange={(e) => update({ keysVolume: Number(e.target.value) })} />
            </label>
          )}
          <label className="toggle-row">
            <span>Beim Schreiben eintauchen<br /><span className="muted small">Oberfläche blendet aus, Klang setzt ein</span></span>
            <input className="switch" type="checkbox" checked={settings.auto} onChange={(e) => update({ auto: e.target.checked })} />
          </label>
          <span className="muted small">Mausbewegung oder Esc holt die Oberfläche zurück.</span>
        </div>
      )}
    </div>
  );
}
