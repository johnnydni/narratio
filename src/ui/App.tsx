import { lazy, Suspense, useEffect, useMemo } from 'react';
import { NavProvider, useItem, useItems, useLocalSetting, usePeerCount, useProject, type View } from './state';
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
  const [theme, setTheme] = useLocalSetting<'system' | 'light' | 'dark'>('theme', 'system');

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const path = view.kind === 'item' ? pathOf(items, view.id).join(' / ') : view.kind === 'world' ? 'Weltzustand' : 'Export';
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

export function App() {
  const [view, setView] = useLocalSetting<View>('view', { kind: 'item', id: 's_ankunft' });
  const nav = useMemo(() => ({ view, go: setView }), [view, setView]);

  return (
    <NavProvider value={nav}>
      <ImmersionProvider>
        <div className="app">
          <Topbar view={view} />
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
