import { StrictMode, useEffect, useState } from 'react';
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

/**
 * Blendet den Startbildschirm aus index.html aus. Beim ersten Öffnen im Tab darf die kurze
 * Animation zu Ende laufen; beim Neuladen verschwindet er, sobald das Projekt bereit ist.
 */
const splashShownAt = performance.now();
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  let first = true;
  try {
    first = !sessionStorage.getItem('narratio:splash');
    sessionStorage.setItem('narratio:splash', '1');
  } catch {
    /* ohne sessionStorage: immer kurz */
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = Math.max(0, (first && !reduce ? 1400 : 250) - (performance.now() - splashShownAt));
  setTimeout(() => {
    el.classList.add('out');
    document.documentElement.classList.add('app-ready');
    setTimeout(() => el.remove(), 600);
  }, wait);
}

function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: Session | null = null;
    openSession()
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
  }, []);

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
