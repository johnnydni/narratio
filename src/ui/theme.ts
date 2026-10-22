import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLocalSetting } from './state';
import { withThemeTransition } from './motion';
import { applyAppearance, useAppearance, type ThemeMode } from './prefs';

export interface Theme {
  mode: ThemeMode;
  isDark: boolean;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      darkQuery?.addEventListener('change', cb);
      return () => darkQuery?.removeEventListener('change', cb);
    },
    () => !!darkQuery?.matches,
  );
}

/** Helles oder dunkles Design, gespeichert für alle Projekte. */
export function useTheme(): Theme {
  const [mode, setStored] = useLocalSetting<ThemeMode>('theme', 'system');
  const systemDark = useSystemDark();
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  const setMode = useCallback(
    (m: ThemeMode) =>
      withThemeTransition(() => {
        // Sofort setzen, damit der Farbübergang greift; der Effekt unten zieht nur nach.
        if (m === 'system') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', m);
        setStored(m);
      }),
    [setStored],
  );
  const toggle = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark, setMode]);
  return { mode, isDark, toggle, setMode };
}

/** Hält Design und Darstellung am Dokument aktuell; einmal ganz oben eingebunden. */
export function useApplyAppearance() {
  const [mode] = useLocalSetting<ThemeMode>('theme', 'system');
  const [appearance] = useAppearance();
  const key = JSON.stringify(appearance);
  useEffect(() => applyAppearance(mode, appearance), [mode, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
