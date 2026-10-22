import { readLocalSetting, useLocalSetting } from './state';

/**
 * Geräteweite Einstellungen, die das Einstellungsmenü bündelt. Jede Gruppe liegt unter einem
 * eigenen Schlüssel; gespeicherte Werte werden mit den Vorgaben gemischt, damit neue Felder
 * ohne Migration dazukommen können.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Appearance {
  /** Schriftgröße des Szenentexts in px. */
  textSize: number;
  /** Breite der Textspalte in px. */
  lineWidth: number;
  font: 'serif' | 'sans';
  motion: 'system' | 'reduce';
  splash: 'full' | 'short' | 'off';
}

export const APPEARANCE_DEFAULTS: Appearance = { textSize: 18, lineWidth: 680, font: 'serif', motion: 'system', splash: 'full' };

export interface WritingPrefs {
  spellcheck: boolean;
  /** Wortziel für Szenen ohne eigenes Feld „Wortziel“. */
  wordGoal: number;
}

export const WRITING_DEFAULTS: WritingPrefs = { spellcheck: true, wordGoal: 600 };

function usePrefGroup<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const [stored, setStored] = useLocalSetting<Partial<T>>(key, {});
  const value = { ...defaults, ...stored };
  return [value, (patch) => setStored({ ...stored, ...patch })];
}

export function useAppearance() {
  return usePrefGroup<Appearance>('appearance', APPEARANCE_DEFAULTS);
}

export function useWritingPrefs() {
  return usePrefGroup<WritingPrefs>('writing', WRITING_DEFAULTS);
}

export function readAppearance(): Appearance {
  return { ...APPEARANCE_DEFAULTS, ...readLocalSetting<Partial<Appearance>>('appearance', {}) };
}

/** Bewegung reduziert: Systemvorgabe oder eigene Wahl. */
export function prefersReducedMotion(): boolean {
  return document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Setzt Design und Darstellung auf das Dokument; die Stile lesen nur Variablen und Attribute. */
export function applyAppearance(theme: ThemeMode, a: Appearance) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.setProperty('--editor-size', `${a.textSize}px`);
  root.style.setProperty('--page-width', `${a.lineWidth}px`);
  root.style.setProperty('--editor-font', a.font === 'sans' ? 'var(--sans)' : 'var(--serif)');
  if (a.motion === 'reduce') root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}
