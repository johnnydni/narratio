import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createProject,
  discoverProjects,
  duplicateProject,
  listProjects,
  purgeProject,
  renameProject,
  restoreProject,
  subscribeLibrary,
  trashProject,
  withProjectDoc,
  type ProjectEntry,
} from '../store/library';
import { backupFileName, BackupError, createBackupZipWithMedia, readBackupContents } from '../store/backup';
import { getOriginal, setMediaProject } from '../store/blobs';
import { download } from './BackupPanel';
import { Icon } from './icons';
import { ToastProvider, useToast } from './motion';
import { useTheme } from './theme';
import { prefersReducedMotion } from './prefs';
import { MOD, SettingsDialog } from './SettingsDialog';
import { hash, shelfRows, spineHeight, spineWidth } from './books';

/**
 * Die Bibliothek: jedes Projekt ein Buch im Regal. Die Breite des Rückens wächst mit dem
 * geschriebenen Text, die Farbe bleibt dem Projekt treu. Ein Klick zieht das Buch ein Stück
 * heraus und zeigt, was drinsteht; ein Doppelklick (oder Enter) schlägt es auf.
 */

const nf = new Intl.NumberFormat('de-DE');
const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

function ago(iso?: string): string {
  if (!iso) return 'noch nie geöffnet';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return `zuletzt geöffnet ${rtf.format(Math.round(v), unit)}`;
    v /= n;
  }
  return '';
}

/** Kann dieses Gerät WebGL 2? Dann steht das Regal in 3D, sonst bleibt es flach. */
function webglOk(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

// Gleich mitladen, damit beim Ausblenden des Startbildschirms das Regal schon steht
const shelf3d = typeof document !== 'undefined' && webglOk() ? import('./library3d/Shelf3D') : null;
const Shelf3D = lazy(() => shelf3d!);

function useProjects(): ProjectEntry[] {
  const raw = useSyncExternalStore(subscribeLibrary, () => localStorage.getItem('narratio:library') ?? '[]');
  return useMemo(() => {
    void raw;
    return listProjects();
  }, [raw]);
}

function Book({ p, selected, opening, onSelect, onOpen }: { p: ProjectEntry; selected: boolean; opening: boolean; onSelect: () => void; onOpen: () => void }) {
  const h = hash(p.id);
  return (
    <button
      type="button"
      className={`book c${p.color % 8} deco${h % 3} ${p.name.length > 13 ? 'long' : ''} ${selected ? 'selected' : ''} ${opening ? 'opening' : ''}`}
      style={{ width: spineWidth(p), height: spineHeight(p) }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-pressed={selected}
      aria-label={p.name}
      data-testid="book"
    >
      <span className="book-band top" />
      <span className="book-title">{p.name}</span>
      <span className="book-band bottom" />
      <span className="book-mark">{p.name.trim().charAt(0).toUpperCase() || '·'}</span>
    </button>
  );
}

function Details({ p, onOpen, onClose }: { p: ProjectEntry; onOpen: () => void; onClose: () => void }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const s = p.stats;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' });
    }
    setBusy(null);
  };

  return (
    <div className="book-details" data-testid="book-details">
      <div className="bd-main">
        {renaming ? (
          <input
            className="bd-title-input"
            autoFocus
            defaultValue={p.name}
            aria-label="Titel des Projekts"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onBlur={(e) => {
              const v = e.currentTarget.value;
              setRenaming(false);
              if (v.trim() && v.trim() !== p.name) void run('rename', () => renameProject(p.id, v));
            }}
          />
        ) : (
          <h2 className="bd-title" onDoubleClick={() => setRenaming(true)} title="Doppelklick zum Umbenennen">{p.name}</h2>
        )}
        <p className="bd-meta">
          {s ? (
            <>
              <strong>{nf.format(s.words)}</strong> Wörter · {s.scenes} {s.scenes === 1 ? 'Szene' : 'Szenen'} · {s.dialogs} {s.dialogs === 1 ? 'Dialog' : 'Dialoge'} · {s.lore} Lore-Einträge
              {s.media ? ` · ${s.media} Medien` : ''}
            </>
          ) : (
            'Noch keine Kennzahlen'
          )}
        </p>
        <p className="bd-when">{ago(p.openedAt)}</p>
      </div>
      <div className="bd-actions">
        <button type="button" className="btn primary" onClick={onOpen}>Aufschlagen</button>
        <button type="button" className="btn" onClick={() => setRenaming(true)}>Umbenennen</button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void run('dup', async () => { await duplicateProject(p.id); toast({ text: `„${p.name}“ dupliziert.` }); })}>
          {busy === 'dup' ? 'Dupliziere …' : 'Duplizieren'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!!busy}
          onClick={() =>
            void run('zip', async () => {
              setMediaProject(p.id);
              const { zip, name, missing } = await withProjectDoc(p.id, async (proj) => {
                const r = await createBackupZipWithMedia(proj, getOriginal);
                return { ...r, name: backupFileName(proj) };
              });
              download(name, zip, 'application/zip');
              toast({ text: missing.length ? `Sicherung heruntergeladen; ${missing.length} Mediendatei(en) fehlen.` : 'Sicherung heruntergeladen.' });
            })
          }
        >
          {busy === 'zip' ? 'Sichere …' : 'Sicherung herunterladen'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            trashProject(p.id);
            onClose();
            toast({ text: `„${p.name}“ liegt im Papierkorb.`, action: { label: 'Rückgängig', run: () => restoreProject(p.id) } });
          }}
        >
          <Icon name="trash" size={13} /> In den Papierkorb
        </button>
      </div>
    </div>
  );
}

function NewBook({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (demo: boolean) => {
    setBusy(true);
    const id = await createProject(demo ? { kind: 'demo' } : { kind: 'empty', name: name || 'Neues Projekt' });
    setBusy(false);
    setOpen(false);
    setName('');
    onCreated(id);
  };
  return (
    <div className="new-book-wrap">
      <button type="button" className="new-book" style={{ height: 206 }} onClick={() => setOpen(!open)} aria-label="Neues Buch" aria-expanded={open}>
        <Icon name="plus" size={18} />
      </button>
      {open && (
        <form
          className="new-book-pop"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
        >
          <span className="label">Neues Buch</span>
          <input className="input" autoFocus placeholder="Titel, z. B. „Die Salzkrone“" value={name} onChange={(e) => setName(e.target.value)} aria-label="Titel des neuen Projekts" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="btn primary small" disabled={busy}>Anlegen</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => void create(true)}>oder Beispiel „Aschenstadt“</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Shelf({ books, render, tail }: { books: ProjectEntry[]; render: (p: ProjectEntry) => React.ReactNode; tail: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => shelfRows(books, width), [books, width]);

  return (
    <div className="shelf" ref={ref}>
      {rows.map((row, i) => (
        <div className="shelf-row" key={i} style={{ animationDelay: `${i * 80}ms` }}>
          <div className="shelf-books">
            {row.map((b, j) => (
              <div className="book-slot" key={b.id} style={{ animationDelay: `${120 + i * 80 + j * 40}ms` }}>
                {render(b)}
              </div>
            ))}
            {i === rows.length - 1 && tail}
            <span className="bookend" aria-hidden="true" />
          </div>
          <div className="plank" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

function LibraryInner({ onReady }: { onReady: () => void }) {
  const projects = useProjects();
  const theme = useTheme();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [flat, setFlat] = useState(!shelf3d);
  const fallBack = useCallback(() => setFlat(true), []);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([discoverProjects(), shelf3d?.catch(() => setFlat(true))])
      .catch(() => undefined)
      .finally(() => {
        setReady(true);
        onReady();
      });
  }, [onReady]);

  const books = useMemo(
    () => projects.filter((p) => !p.trashedAt).sort((a, b) => (b.openedAt ?? b.createdAt).localeCompare(a.openedAt ?? a.createdAt)),
    [projects],
  );
  const trashed = projects.filter((p) => p.trashedAt);
  const current = books.find((b) => b.id === selected);

  const open = useCallback((id: string) => {
    setSelected(id);
    setOpening(id);
    const reduce = prefersReducedMotion();
    setTimeout(() => { location.hash = `#/p/${id}`; }, reduce ? 0 : flat ? 420 : 640);
  }, [flat]);

  // Pfeiltasten wandern durchs Regal, Enter schlägt auf
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (!books.length) return;
      const i = books.findIndex((b) => b.id === selected);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = i < 0 ? 0 : (i + (e.key === 'ArrowRight' ? 1 : -1) + books.length) % books.length;
        setSelected(books[next]!.id);
      } else if (e.key === 'Enter' && current) open(current.id);
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [books, selected, current, open]);

  const importZip = async (f: File) => {
    try {
      const contents = readBackupContents(new Uint8Array(await f.arrayBuffer()));
      const id = await createProject({ kind: 'backup', contents });
      setSelected(id);
      toast({ text: `„${f.name}“ steht jetzt im Regal.` });
    } catch (e) {
      toast({ text: e instanceof BackupError ? `${e.message}.` : 'Die Sicherung ließ sich nicht öffnen.' });
    }
  };

  const totalWords = books.reduce((n, b) => n + (b.stats?.words ?? 0), 0);

  return (
    <div className={`library ${ready ? 'ready' : ''}`}>
      <header className="lib-top">
        <span className="wordmark">narratio</span>
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>Sicherung öffnen …</button>
        <input ref={fileRef} type="file" accept=".zip" hidden data-testid="library-import" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importZip(f); }} />
        <button type="button" className="icon-btn" aria-label={theme.isDark ? 'Helles Design' : 'Dunkles Design'} onClick={theme.toggle}>
          <Icon name={theme.isDark ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="icon-btn" aria-label="Einstellungen" title={`Einstellungen (${MOD}+,)`} onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" />
        </button>
      </header>
      <SettingsDialog open={settingsOpen} onClose={closeSettings} inProject={false} />

      <main className="lib-main">
        <div className="lib-head">
          <h1 className="lib-title">Deine Bibliothek</h1>
          <p className="lib-sub">
            {books.length === 0 ? 'Noch leer. Stell dein erstes Buch ins Regal.' : `${books.length} ${books.length === 1 ? 'Buch' : 'Bücher'} · ${nf.format(totalWords)} Wörter geschrieben`}
          </p>
        </div>

        {ready &&
          (flat ? (
            <Shelf
              books={books}
              render={(p) => (
                <Book
                  p={p}
                  selected={selected === p.id}
                  opening={opening === p.id}
                  onSelect={() => setSelected(selected === p.id ? null : p.id)}
                  onOpen={() => open(p.id)}
                />
              )}
              tail={<NewBook onCreated={(id) => setSelected(id)} />}
            />
          ) : (
            <Suspense fallback={null}>
              <Shelf3D
                books={books}
                selected={selected}
                opening={opening}
                onSelect={(id) => setSelected(selected === id ? null : id)}
                onOpen={open}
                tail={<NewBook onCreated={(id) => setSelected(id)} />}
                dark={theme.isDark}
                onLamp={theme.toggle}
                onFail={fallBack}
              />
            </Suspense>
          ))}

        <div className="lib-detail-area">
          {current ? (
            <Details key={current.id} p={current} onOpen={() => open(current.id)} onClose={() => setSelected(null)} />
          ) : (
            ready && books.length > 0 && <p className="lib-hint">Wähle ein Buch, um es herauszuziehen. Doppelklick oder Enter schlägt es auf; die Pfeiltasten wandern durchs Regal.</p>
          )}
        </div>

        {trashed.length > 0 && (
          <section className="lib-trash">
            <button type="button" className="btn ghost small" onClick={() => setShowTrash(!showTrash)} aria-expanded={showTrash}>
              <Icon name="trash" size={13} /> Papierkorb ({trashed.length})
            </button>
            {showTrash && (
              <div className="trash-list">
                {trashed.map((p) => (
                  <div key={p.id} className="trash-row">
                    <span className={`trash-spine c${p.color % 8}`} />
                    <span className="trash-name">{p.name}</span>
                    <button type="button" className="btn small" onClick={() => restoreProject(p.id)}>Zurück ins Regal</button>
                    {confirmPurge === p.id ? (
                      <button type="button" className="btn small danger" onClick={() => void purgeProject(p.id).then(() => toast({ text: `„${p.name}“ wurde endgültig gelöscht.` }))}>
                        Wirklich löschen, samt Medien und Sicherungen
                      </button>
                    ) : (
                      <button type="button" className="btn small ghost" onClick={() => setConfirmPurge(p.id)}>Endgültig löschen …</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function Library({ onReady }: { onReady: () => void }) {
  return (
    <ToastProvider>
      <LibraryInner onReady={onReady} />
    </ToastProvider>
  );
}
