import { lazy, Suspense, useEffect, useMemo } from 'react';
import { NavProvider, useItem, useItems, useLocalSetting, usePeerCount, useProject, useSession, type View } from './state';
import { formatBytes } from '../store/storage';
import { Binder } from './Binder';
import { LoreView } from './LoreView';
import { WorldView } from './WorldView';
import { ExportView } from './ExportView';
import { AmbientPicker, ImmersionProvider } from './immersion';
import { Icon } from './icons';
import type { Item } from '../model/types';

// Editor und Graph sind die größten Pakete; sie laden erst, wenn sie gebraucht werden.
const SceneView = lazy(() => import('./SceneView'));
const DialogView = lazy(() => import('./DialogView'));
const MediaView = lazy(() => import('./MediaView'));

function pathOf(items: Item[], id: string): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur) {
    out.unshift(cur.title || 'Ohne Titel');
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

function Topbar({ view }: { view: View }) {
  const project = useProject();
  const items = useItems();
  const peers = usePeerCount();
  const { storage } = useSession();
  const [theme, setTheme] = useLocalSetting<'system' | 'light' | 'dark'>('theme', 'system');

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const path = view.kind === 'item' ? pathOf(items, view.id).join(' / ') : view.kind === 'world' ? 'Weltzustand' : view.kind === 'media' ? 'Medien' : 'Export';
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="topbar">
      <span className="wordmark">narratio</span>
      <div className="crumbs">
        <span className="sep">|</span>
        <span className="project">{project.name}</span>
        <span className="path">{path}</span>
      </div>
      <span className="spacer" />
      <div className="sync" title="Alle Änderungen liegen sofort lokal. Weitere Fenster werden live abgeglichen.">
        <span className="dot" />
        <span data-testid="sync-status">{peers > 0 ? `Lokal gespeichert · ${peers + 1} Fenster verbunden` : 'Lokal gespeichert'}</span>
      </div>
      {storage.persisted === false && (
        <span
          className="warn-text small"
          data-testid="storage-warning"
          title={`Der Browser hat dauerhaften Speicher abgelehnt und darf die Daten bei Platzmangel räumen (belegt: ${formatBytes(storage.usage)}). Abhilfe: Seite als App installieren oder ein Lesezeichen setzen, und regelmäßig sichern (Export → Sicherung).`}
        >
          Speicher nicht dauerhaft
        </span>
      )}
      <AmbientPicker />
      <button type="button" className="icon-btn" aria-label={isDark ? 'Helles Design' : 'Dunkles Design'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
        <Icon name={isDark ? 'sun' : 'moon'} />
      </button>
    </header>
  );
}

function Main({ view }: { view: View }) {
  const item = useItem(view.kind === 'item' ? view.id : null);
  if (view.kind === 'world') return <WorldView />;
  if (view.kind === 'export') return <ExportView />;
  if (view.kind === 'media') return <Suspense fallback={<div className="empty-state">Lädt …</div>}><MediaView /></Suspense>;
  if (!item) return <div className="empty-state">Wähle links eine Szene, einen Dialog oder einen Lore-Eintrag.</div>;
  return (
    <Suspense fallback={<div className="empty-state">Lädt …</div>}>
      {item.type === 'scene' && <SceneView key={item.id} item={item} />}
      {item.type === 'dialog' && <DialogView key={item.id} item={item} />}
      {item.type === 'lore' && <LoreView key={item.id} item={item} />}
      {item.type === 'folder' && <div className="empty-state">Ordner „{item.title}“. Wähle eine Szene oder lege eine neue an.</div>}
    </Suspense>
  );
}

function SchemaBanner() {
  const { migration } = useSession();
  if (!migration.tooNew) return null;
  return (
    <div className="banner" role="alert" data-testid="schema-banner">
      Dieses Projekt wurde mit einer neueren narratio-Version gespeichert (Schema {migration.from}). Bitte die Seite neu laden, damit die aktuelle Version startet. Bis dahin besser nichts ändern; automatische Sicherungen sind pausiert.
    </div>
  );
}

export function App() {
  const [view, setView] = useLocalSetting<View>('view', { kind: 'item', id: 's_ankunft' });
  const nav = useMemo(() => ({ view, go: setView }), [view, setView]);

  return (
    <NavProvider value={nav}>
      <ImmersionProvider>
        <div className="app">
          <Topbar view={view} />
          <SchemaBanner />
          <div className="body">
            <Binder />
            <main className="main">
              <Main view={view} />
            </main>
          </div>
        </div>
      </ImmersionProvider>
    </NavProvider>
  );
}
