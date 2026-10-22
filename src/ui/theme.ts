import { useCallback, useEffect } from 'react';
import { useLocalSetting } from './state';
import { withThemeTransition } from './motion';

export interface Theme {
  isDark: boolean;
  toggle: () => void;
}

/** Helles oder dunkles Design, gespeichert für alle Projekte. */
export function useTheme(): Theme {
  const [theme, setTheme] = useLocalSetting<'system' | 'light' | 'dark'>('theme', 'system');
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toggle = useCallback(
    () =>
      withThemeTransition(() => {
        const next = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        setTheme(next);
      }),
    [isDark, setTheme],
  );
  return { isDark, toggle };
}
