import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { NavProvider, useItem, useItems, useLocalSetting, useNav, usePeerCount, useProject, useSession, type View } from './state';
import { formatBytes } from '../store/storage';
import { Binder } from './Binder';
import { LoreView } from './LoreView';
import { WorldView } from './WorldView';
import { ExportView } from './ExportView';
import { AmbientPicker, ImmersionProvider } from './immersion';
import { Icon } from './icons';
import type { Id, Item } from '../model/types';
import { createItem } from './Binder';
import { Palette, type Command } from './Palette';
import { ToastProvider, useToast, withThemeTransition } from './motion';
import { backupFileName, createBackupZipWithMedia } from '../store/backup';
import { getOriginal } from '../store/blobs';
import { download } from './BackupPanel';

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

function useTheme() {
  const [theme, setTheme] = useLocalSetting<'system' | 'light' | 'dark'>('theme', 'system');
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toggle = useCallback(() => withThemeTransition(() => {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  }), [isDark, setTheme]);
  return { isDark, toggle };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Topbar({ view, onSearch, theme }: { view: View; onSearch: () => void; theme: { isDark: boolean; toggle: () => void } }) {
  const project = useProject();
  const items = useItems();
  const peers = usePeerCount();
  const { storage } = useSession();
  const { isDark, toggle } = theme;

  const path = view.kind === 'item' ? pathOf(items, view.id).join(' / ') : view.kind === 'world' ? 'Weltzustand' : view.kind === 'media' ? 'Medien' : 'Export';
  return (
    <header className="topbar">
      <span className="wordmark">narratio</span>
      <div className="crumbs">
        <span className="sep">|</span>
        <span className="project">{project.name}</span>
        <span className="path">{path}</span>
      </div>
      <span className="spacer" />
      <button type="button" className="search-btn" onClick={onSearch} aria-label="Schnellsuche" title="Springen und Befehle">
        <Icon name="search" size={13} /> <span className="sb-label">Suchen und springen</span> <kbd>{isMac ? '⌘' : 'Strg'} K</kbd>
      </button>
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
      <button type="button" className="icon-btn" aria-label={isDark ? 'Helles Design' : 'Dunkles Design'} onClick={toggle}>
        <Icon name={isDark ? 'sun' : 'moon'} />
      </button>
    </header>
  );
}

/** Jeder Ansichtswechsel blendet den Inhalt kurz ein. */
function Main({ view }: { view: View }) {
  const key = view.kind === 'item' ? view.id : view.kind;
  return (
    <div className="view-anim" key={key}>
      <MainContent view={view} />
    </div>
  );
}

function MainContent({ view }: { view: View }) {
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

function Shell({ view }: { view: View }) {
  const project = useProject();
  const items = useItems();
  const nav = useNav();
  const toast = useToast();
  const theme = useTheme();
  const { toggle } = theme;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useLocalSetting<Id[]>('recent', []);

  // Zuletzt geöffnete Einträge für die Schnellsuche merken
  useEffect(() => {
    if (view.kind !== 'item') return;
    if (recent[0] === view.id) return;
    setRecent([view.id, ...recent.filter((id) => id !== view.id)].slice(0, 12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeId = view.kind === 'item' ? view.id : null;
  const commands = useMemo<Command[]>(() => {
    const create = (type: Item['type'], init: Partial<Item> = {}) => () => nav.go({ kind: 'item', id: createItem(project, items, activeId, type, init) });
    return [
      { id: 'new-scene', title: 'Neue Szene', icon: 'scene', group: 'Befehle', keywords: 'anlegen erstellen kapitel', run: create('scene', { status: 'idea' }) },
      { id: 'new-dialog', title: 'Neuer Dialog', icon: 'dialog', group: 'Befehle', keywords: 'anlegen erstellen gespräch', run: create('dialog', { status: 'idea' }) },
      { id: 'new-character', title: 'Neue Figur', icon: 'lore', group: 'Befehle', keywords: 'lore anlegen person', run: create('lore', { loreKind: 'character', title: '' }) },
      { id: 'new-place', title: 'Neuer Ort', icon: 'lore', group: 'Befehle', keywords: 'lore anlegen', run: create('lore', { loreKind: 'place', title: '' }) },
      { id: 'world', title: 'Weltzustand', icon: 'world', group: 'Befehle', keywords: 'variablen spielstand', run: () => nav.go({ kind: 'world' }) },
      { id: 'media', title: 'Medien', icon: 'image', group: 'Befehle', keywords: 'bilder pdf galerie', run: () => nav.go({ kind: 'media' }) },
      { id: 'export', title: 'Prüfen und exportieren', icon: 'export', group: 'Befehle', keywords: 'unreal json fehler', run: () => nav.go({ kind: 'export' }) },
      {
        id: 'backup', title: 'Sicherung herunterladen', icon: 'export', group: 'Befehle', keywords: 'backup zip speichern',
        run: () => void createBackupZipWithMedia(project, getOriginal).then(({ zip, missing }) => {
          download(backupFileName(project), zip, 'application/zip');
          toast({ text: missing.length ? `Sicherung heruntergeladen, ${missing.length} Mediendatei(en) fehlen auf diesem Gerät.` : 'Sicherung heruntergeladen.' });
        }),
      },
      { id: 'theme', title: 'Helles oder dunkles Design', icon: 'moon', group: 'Befehle', keywords: 'dunkel hell theme farbe', run: toggle },
    ];
  }, [project, items, activeId, nav, toggle, toast]);

  return (
    <div className="app">
      <Topbar view={view} theme={theme} onSearch={() => setPaletteOpen(true)} />
      <SchemaBanner />
      <div className="body">
        <Binder />
        <main className="main">
          <Main view={view} />
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} recent={recent} />
    </div>
  );
}

export function App() {
  const [view, setView] = useLocalSetting<View>('view', { kind: 'item', id: 's_ankunft' });
  const nav = useMemo(() => ({ view, go: setView }), [view, setView]);

  return (
    <NavProvider value={nav}>
      <ToastProvider>
        <ImmersionProvider>
          <Shell view={view} />
        </ImmersionProvider>
      </ToastProvider>
    </NavProvider>
  );
}
