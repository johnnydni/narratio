import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavProvider, useItem, useItems, useLocalSetting, useNav, usePeerCount, useProject, useProjectSetting, useSession, type View } from './state';
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
import { ToastProvider, useToast } from './motion';
import { backupFileName, createBackupZipWithMedia } from '../store/backup';
import { getOriginal } from '../store/blobs';
import { download } from './BackupPanel';
import { recordProject } from '../store/library';
import { useTheme, type Theme } from './theme';
import { SettingsDialog } from './SettingsDialog';

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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface Layout {
  left: boolean;
  right: boolean;
}

const mod = isMac ? '⌘' : 'Strg';

function Topbar({ view, onSearch, onSettings, theme, layout, setLayout }: { view: View; onSearch: () => void; onSettings: () => void; theme: Theme; layout: Layout; setLayout: (l: Layout) => void }) {
  const project = useProject();
  const items = useItems();
  const peers = usePeerCount();
  const { storage } = useSession();
  const { isDark, toggle } = theme;

  const path = view.kind === 'item' ? pathOf(items, view.id).join(' / ') : view.kind === 'world' ? 'Weltzustand' : view.kind === 'media' ? 'Medien' : 'Export';
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Linke Leiste" aria-pressed={layout.left} title={`Linke Leiste ein- oder ausblenden (${mod}+Alt+B)`} onClick={() => setLayout({ ...layout, left: !layout.left })}>
        <Icon name="sidebar" />
      </button>
      <a className="wordmark" href="#/" title="Zur Bibliothek">narratio</a>
      <div className="crumbs">
        <span className="sep">|</span>
        <span className="project">{project.name}</span>
        <span className="path">{path}</span>
      </div>
      <span className="spacer" />
      <button type="button" className="search-btn" onClick={onSearch} aria-label="Schnellsuche" title="Springen und Befehle">
        <Icon name="search" size={13} /> <span className="sb-label">Suchen und springen</span> <kbd>{mod} K</kbd>
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
      <button type="button" className="icon-btn" aria-label="Einstellungen" title={`Einstellungen (${mod}+,)`} onClick={onSettings}>
        <Icon name="settings" />
      </button>
      <button type="button" className="icon-btn" aria-label="Rechte Leiste" aria-pressed={layout.right} title={`Rechte Leiste ein- oder ausblenden (${mod}+Alt+I)`} onClick={() => setLayout({ ...layout, right: !layout.right })}>
        <Icon name="sidebarRight" />
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recent, setRecent] = useProjectSetting<Id[]>('recent', []);
  const [layout, setLayout] = useLocalSetting<Layout>('layout', { left: true, right: true });
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Kennzahlen für die Bibliothek nachführen, ohne beim Tippen zu rechnen
  useEffect(() => {
    const t = setTimeout(() => recordProject(project, false), 3000);
    return () => clearTimeout(t);
  }, [project, items]);
  useEffect(() => () => recordProject(project, false), [project]);

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
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        setPaletteOpen(false);
        setSettingsOpen((o) => !o);
      }
      // Alt verändert e.key je nach Tastatur; deshalb die Taste selbst prüfen.
      if ((e.metaKey || e.ctrlKey) && e.altKey && (e.code === 'KeyB' || e.code === 'KeyI')) {
        e.preventDefault();
        const l = layoutRef.current;
        setLayout(e.code === 'KeyB' ? { ...l, left: !l.left } : { ...l, right: !l.right });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setLayout]);

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
      { id: 'settings', title: 'Einstellungen', hint: `${mod}+,`, icon: 'settings', group: 'Befehle', keywords: 'optionen schrift textgröße klang sicherung tastenkürzel', run: () => setSettingsOpen(true) },
      { id: 'left', title: 'Linke Leiste ein- oder ausblenden', hint: `${mod}+Alt+B`, icon: 'sidebar', group: 'Befehle', keywords: 'binder seitenleiste einklappen', run: () => setLayout({ ...layoutRef.current, left: !layoutRef.current.left }) },
      { id: 'right', title: 'Rechte Leiste ein- oder ausblenden', hint: `${mod}+Alt+I`, icon: 'sidebarRight', group: 'Befehle', keywords: 'inspector details seitenleiste einklappen', run: () => setLayout({ ...layoutRef.current, right: !layoutRef.current.right }) },
      { id: 'library', title: 'Zur Bibliothek', icon: 'library', group: 'Befehle', keywords: 'projekte wechseln start', run: () => { location.hash = '#/'; } },
    ];
  }, [project, items, activeId, nav, toggle, toast, setLayout]);

  return (
    <div className={`app ${layout.left ? '' : 'left-hidden'} ${layout.right ? '' : 'right-hidden'}`}>
      <Topbar view={view} theme={theme} layout={layout} setLayout={setLayout} onSearch={() => setPaletteOpen(true)} onSettings={() => setSettingsOpen(true)} />
      <SchemaBanner />
      <div className="body">
        <Binder />
        <main className="main">
          <Main view={view} />
        </main>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} recent={recent} />
      <SettingsDialog open={settingsOpen} onClose={closeSettings} inProject />
    </div>
  );
}

export function App() {
  const project = useProject();
  const [view, setView] = useProjectSetting<View>('view', () => {
    // Neues Projekt: mit der ersten Szene beginnen
    const first = project.listItems().filter((i) => i.type === 'scene').sort((a, b) => a.order - b.order)[0];
    return first ? { kind: 'item', id: first.id } : { kind: 'world' };
  });
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
