import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

export function useLocalSetting<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`narratio:${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`narratio:${key}`, JSON.stringify(v));
      } catch {
        /* privater Modus: nur im Speicher */
      }
    },
    [key],
  );
  return [value, set];
}
