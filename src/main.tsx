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

  if (error) return <div className="loading">Projekt konnte nicht geöffnet werden: {error}</div>;
  if (!session) return <div className="loading">narratio</div>;
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
