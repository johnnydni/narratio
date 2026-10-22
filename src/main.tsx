import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Schriften lokal gebündelt: offline verfügbar, keine Anfrage an Dritte.
import '@fontsource-variable/inter';
import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-500.css';
import '@fontsource/literata/latin-400-italic.css';
import './ui/styles.css';
import { openSession, type Session } from './store/session';
import { SessionProvider } from './ui/state';
import { App } from './ui/App';
import { applyAppearance, prefersReducedMotion, readAppearance, type ThemeMode } from './ui/prefs';
import { useApplyAppearance } from './ui/theme';
import { readLocalSetting } from './ui/state';

// Darstellung setzen, bevor etwas gezeichnet wird.
applyAppearance(readLocalSetting<ThemeMode>('theme', 'system'), readAppearance());

const Library = lazy(() => import('./ui/Library'));

/**
 * Blendet den Startbildschirm aus index.html aus. Beim ersten Öffnen im Tab läuft die Animation
 * ganz durch, beim Neuladen etwas kürzer. Ein Klick oder eine Taste überspringt ihn. In den
 * Einstellungen lässt er sich auf immer kurz stellen oder abschalten (dann blendet index.html ihn
 * gar nicht erst ein).
 */
const splashShownAt = performance.now();
let splashGone = false;
function hideSplash(immediately = false) {
  const el = document.getElementById('splash');
  if (!el || splashGone) return;
  let first = true;
  try {
    first = !sessionStorage.getItem('narratio:splash');
    sessionStorage.setItem('narratio:splash', '1');
  } catch {
    /* ohne sessionStorage: wie beim ersten Mal */
  }
  const { splash } = readAppearance();
  if (splash === 'short') first = false;
  const reduce = prefersReducedMotion();
  const wait = immediately || splash === 'off' ? 0 : Math.max(0, (reduce ? 300 : first ? 2600 : 1300) - (performance.now() - splashShownAt));
  const go = () => {
    if (splashGone) return;
    splashGone = true;
    el.classList.add('out');
    document.documentElement.classList.add('app-ready');
    setTimeout(() => el.remove(), 700);
  };
  const timer = setTimeout(go, wait);
  const skip = () => {
    clearTimeout(timer);
    go();
  };
  el.addEventListener('click', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
}

type Route = { kind: 'library' } | { kind: 'project'; id: string };

function readRoute(): Route {
  const m = /^#\/p\/([\w-]+)/.exec(location.hash);
  return m ? { kind: 'project', id: m[1]! } : { kind: 'library' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function ProjectRoot({ id }: { id: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: Session | null = null;
    setSession(null);
    openSession(id)
      .then((s) => {
        opened = s;
        if (alive) setSession(s);
        else s.destroy();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      opened?.destroy();
    };
  }, [id]);

  useEffect(() => {
    if (session || error) hideSplash();
  }, [session, error]);

  if (error) return <div className="loading">Projekt konnte nicht geöffnet werden: {error}</div>;
  if (!session) return null;
  return (
    <SessionProvider value={session}>
      <App />
    </SessionProvider>
  );
}

function Root() {
  const route = useRoute();
  useApplyAppearance();
  if (route.kind === 'project') return <ProjectRoot key={route.id} id={route.id} />;
  return (
    <Suspense fallback={null}>
      <Library onReady={() => hideSplash()} />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
