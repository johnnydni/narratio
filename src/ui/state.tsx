import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { Session } from '../store/session';
import type { Project } from '../store/project';
import type { Id } from '../model/types';

/* ---------------- Projekt-Kontext ---------------- */

const SessionContext = createContext<Session | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('Keine Sitzung');
  return s;
}

export function useProject(): Project {
  return useSession().project;
}

/**
 * Beobachtet einen Yjs-Typ (inklusive Unterstruktur) und berechnet daraus einen Wert neu,
 * sobald er sich ändert. Bewusst granular: Tippen im Szenentext löst keine Neuberechnung
 * der Lore- oder Binder-Ansichten aus (Tipp-Budget unter 50 ms).
 */
export function useObserved<T>(types: (Y.AbstractType<unknown> | undefined)[], compute: () => T, deps: unknown[] = []): T {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const active = types.filter((t): t is Y.AbstractType<unknown> => !!t);
    active.forEach((t) => t.observeDeep(bump));
    return () => active.forEach((t) => t.unobserveDeep(bump));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, types);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(compute, [version, ...types, ...deps]);
}

export function useItems() {
  const p = useProject();
  return useObserved([p.items as unknown as Y.AbstractType<unknown>], () => p.listItems());
}

export function useItem(id: Id | null) {
  const p = useProject();
  return useObserved([p.items as unknown as Y.AbstractType<unknown>], () => (id ? p.getItem(id) : undefined), [id]);
}

export function useWorld() {
  const p = useProject();
  return useObserved([p.worldVars as unknown as Y.AbstractType<unknown>, p.profiles as unknown as Y.AbstractType<unknown>], () => ({
    vars: p.listWorldVars(),
    profiles: p.listProfiles(),
  }));
}

export function useMedia() {
  const p = useProject();
  return useObserved([p.media as unknown as Y.AbstractType<unknown>], () => p.listMedia());
}

export function usePeerCount(): number {
  const { sync } = useSession();
  return useSyncExternalStore(
    (cb) => sync.onPeersChange(cb),
    () => sync.peerCount,
  );
}

/* ---------------- Navigation ---------------- */

export type View =
  | { kind: 'item'; id: Id }
  | { kind: 'world' }
  | { kind: 'media' }
  | { kind: 'export' };

export interface Nav {
  view: View;
  go(view: View): void;
}

const NavContext = createContext<Nav | null>(null);
export const NavProvider = NavContext.Provider;

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('Keine Navigation');
  return n;
}

/* ---------------- Lokale Einstellungen (pro Gerät) ---------------- */

/*
 * Ein gemeinsamer Speicher für alle Einstellungen: Ändert das Einstellungsmenü den Klang, merkt es
 * die Kopfleiste sofort. Jedes Fenster liest einen Schlüssel einmal und hält ihn dann selbst;
 * nur echte Geräte-Einstellungen ziehen in anderen Fenstern nach. Die geöffnete Ansicht oder
 * eingeklappte Ordner bleiben je Fenster, sonst würden zwei Fenster einander hinterherspringen.
 * Ohne localStorage (privater Modus) bleiben die Werte für diese Sitzung im Speicher.
 */
const SHARED_ACROSS_WINDOWS = new Set(['theme', 'appearance', 'writing', 'immersion', 'sketch', 'focusMode'].map((k) => `narratio:${k}`));
const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

function readRaw(key: string): string | null {
  if (!cache.has(key)) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* privater Modus */
    }
    cache.set(key, raw);
  }
  return cache.get(key) ?? null;
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribeKey(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || !SHARED_ACROSS_WINDOWS.has(e.key)) return;
    cache.set(e.key, e.newValue);
    notify(e.key);
  });
}

/** Liest eine Einstellung außerhalb von React (Startbildschirm, Audio). */
export function readLocalSetting<T>(key: string, fallback: T): T {
  const raw = readRaw(`narratio:${key}`);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocalSetting<T>(key: string, v: T) {
  const full = `narratio:${key}`;
  const raw = JSON.stringify(v);
  cache.set(full, raw);
  try {
    localStorage.setItem(full, raw);
  } catch {
    /* privater Modus: nur im Speicher */
  }
  notify(full);
}

export function useLocalSetting<T>(key: string, initial: T | (() => T)): [T, (v: T) => void] {
  const full = `narratio:${key}`;
  const raw = useSyncExternalStore(
    useCallback((fn: () => void) => subscribeKey(full, fn), [full]),
    () => readRaw(full),
  );
  // Der Startwert wird nur gebraucht, solange nichts gespeichert ist; useMemo hält ihn stabil.
  const initRef = useRef(initial);
  initRef.current = initial;
  const value = useMemo<T>(() => {
    const init = () => (typeof initRef.current === 'function' ? (initRef.current as () => T)() : initRef.current);
    if (raw === null) return init();
    try {
      return JSON.parse(raw) as T;
    } catch {
      return init();
    }
  }, [raw]);
  const set = useCallback((v: T) => writeLocalSetting(key, v), [key]);
  return [value, set];
}

/**
 * Wie useLocalSetting, aber je Projekt (zuletzt geöffnete Ansicht, eingeklappte Ordner …).
 * Das erste Projekt behält die alten Schlüssel, damit nichts verloren geht.
 */
export function useProjectSetting<T>(key: string, initial: T | (() => T)): [T, (v: T) => void] {
  const id = useSession().project.id;
  return useLocalSetting<T>(id === 'default' ? key : `${id}:${key}`, initial);
}
