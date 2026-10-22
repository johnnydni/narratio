import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useMediaUrl, useVisible } from './mediaHooks';
import type { MediaMeta } from '../model/types';
import { useItems, useMedia, useNav, useProject } from './state';
import { Icon } from './icons';
import { imageFor, importFile, purgeMedia, restoreMedia, trashMedia } from '../store/media';
import { formatBytes } from '../store/storage';
import { workerThumbnailer } from '../media/thumbnailer';
import { download } from './BackupPanel';
import { usePresence, useToast } from './motion';

type Tab = 'all' | 'image' | 'pdf' | 'trash';

function Tile({ meta, onOpen }: { meta: MediaMeta; onOpen: () => void }) {
  const [ref, visible] = useVisible<HTMLButtonElement>();
  const url = useMediaUrl(meta, 'm', visible);
  return (
    <button ref={ref} type="button" className="media-tile" onClick={onOpen} title={meta.name}>
      <span className="media-thumb" style={{ background: meta.color ?? 'var(--bg-sunken)' }}>
        {url && <img src={url} alt={meta.caption || meta.name} draggable={false} />}
      </span>
      <span className="media-name">{meta.name}</span>
    </button>
  );
}

function Viewer({ meta, onClose, onPrev, onNext, state }: { meta: MediaMeta; onClose: () => void; onPrev: () => void; onNext: () => void; state: 'open' | 'closing' }) {
  const project = useProject();
  const toast = useToast();
  const [zoom, setZoom] = useState(false);
  const preview = useMediaUrl(meta, 'l');
  const original = useMediaUrl(meta, 'original', zoom);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const items = useItems();
  const nav = useNav();
  // Abhängig von items, damit neue Zuordnungen sofort erscheinen; Szenentexte werden beim Öffnen gelesen.
  const uses = useMemo(() => project.mediaUses(meta.hash), [project, meta.hash, items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  useEffect(() => {
    setZoom(false);
    setConfirmPurge(false);
  }, [meta.hash]);

  const saveOriginal = async () => {
    const blob = await imageFor(meta, 'original');
    if (blob) download(meta.name, blob, meta.mime);
  };

  return (
    <div className="viewer" role="dialog" aria-label={meta.name} data-state={state}>
      <div className={`viewer-stage ${zoom ? 'zoomed' : ''}`} onClick={() => meta.kind === 'image' && setZoom(!zoom)} title={zoom ? 'Einpassen' : 'Originalgröße'}>
        {meta.kind !== 'image' ? (
          <span className="muted">{meta.kind === 'pdf' ? 'PDF' : 'Datei'}: {meta.name}</span>
        ) : (
          (zoom ? original ?? preview : preview) && <img src={zoom ? original ?? preview : preview} alt={meta.caption || meta.name} draggable={false} />
        )}
      </div>
      <aside className="viewer-side">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" className="icon-btn" aria-label="Vorheriges" onClick={onPrev} style={{ transform: 'scaleX(-1)' }}><Icon name="chevronRight" size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Nächstes" onClick={onNext}><Icon name="chevronRight" size={14} /></button>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={onClose}>Schließen</button>
        </div>
        <div className="field">
          <span className="label">Datei</span>
          <span className="small" style={{ wordBreak: 'break-all' }}>{meta.name}</span>
          <span className="muted small">
            {formatBytes(meta.size)}
            {meta.width ? ` · ${meta.width} × ${meta.height} px` : ''}
          </span>
        </div>
        <label className="field">
          <span className="label">Bildunterschrift</span>
          <textarea className="textarea" rows={2} value={meta.caption ?? ''} onChange={(e) => project.updateMedia(meta.hash, { caption: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span className="label">Quelle</span>
          <input className="input" value={meta.source ?? ''} placeholder="Urheber, Link, Fundort" onChange={(e) => project.updateMedia(meta.hash, { source: e.target.value || undefined })} />
        </label>
        <div className="field">
          <span className="label">Verwendet in</span>
          {uses.length === 0 && <span className="muted small">Noch nirgends.</span>}
          {uses.map((u) => (
            <button key={u.itemId} type="button" className="ref-row" onClick={() => { onClose(); nav.go({ kind: 'item', id: u.itemId }); }}>
              <span style={{ flex: 1 }}>{items.find((i) => i.id === u.itemId)?.title || 'Ohne Titel'}</span>
              <span className="muted small">{u.inText ? 'im Text' : 'zugeordnet'}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" onClick={() => void saveOriginal()}>Original speichern</button>
          {!meta.trashedAt ? (
            <button type="button" className="btn small" onClick={() => {
              trashMedia(project, meta.hash);
              onClose();
              toast({ text: `„${meta.name}“ liegt im Papierkorb.`, action: { label: 'Rückgängig', run: () => restoreMedia(project, meta.hash) } });
            }}><Icon name="trash" size={13} /> In den Papierkorb</button>
          ) : (
            <>
              <button type="button" className="btn small" onClick={() => restoreMedia(project, meta.hash)}>Wiederherstellen</button>
              {!confirmPurge ? (
                <button type="button" className="btn small" onClick={() => setConfirmPurge(true)}>Endgültig löschen …</button>
              ) : (
                <button type="button" className="btn small danger" onClick={() => void purgeMedia(project, meta.hash).then(onClose)}>
                  {uses.length ? `Wird an ${uses.length} Stellen verwendet. Trotzdem löschen` : 'Wirklich löschen'}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Medien (ME-01, ME-02, ME-07, ME-08): Import, Galerie, Ansicht. PDF-Betrachter folgt (ME-03). */
export default function MediaView() {
  const project = useProject();
  const media = useMedia();
  const [tab, setTab] = useState<Tab>('all');
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = useMemo(() => media.filter((m) => !m.trashedAt), [media]);
  const trashed = useMemo(() => media.filter((m) => m.trashedAt), [media]);
  const shown = tab === 'trash' ? trashed : live.filter((m) => tab === 'all' || m.kind === tab);
  const images = shown.filter((m) => m.kind === 'image');
  const others = shown.filter((m) => m.kind !== 'image');
  const open = media.find((m) => m.hash === openHash);
  // Beim Schließen bleibt das zuletzt gezeigte Medium stehen, bis die Ansicht ausgeblendet ist.
  const viewer = usePresence(!!open, 160);
  const lastOpen = useRef<MediaMeta | undefined>(undefined);
  if (open) lastOpen.current = open;
  const shownMeta = open ?? lastOpen.current;

  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      let added = 0;
      let dupes = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        setStatus(`Importiere ${i + 1} von ${files.length}: ${f.name}`);
        try {
          const { duplicate } = await importFile(project, f, f.name || `Eingefügt ${new Date().toLocaleString('de-DE')}.png`, workerThumbnailer);
          if (duplicate) dupes++;
          else added++;
        } catch {
          setStatus(`„${f.name}“ konnte nicht gespeichert werden.`);
          return;
        }
      }
      setStatus(`${added} ${added === 1 ? 'Datei' : 'Dateien'} importiert${dupes ? `, ${dupes} schon vorhanden` : ''}.`);
    },
    [project],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...e.dataTransfer.files]);
  };

  const onPaste = (e: ClipboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void importFiles(files);
    }
  };

  const step = (dir: 1 | -1) => {
    const list = shown;
    const i = list.findIndex((m) => m.hash === openHash);
    if (i < 0 || !list.length) return;
    setOpenHash(list[(i + dir + list.length) % list.length]!.hash);
  };

  const count = (k: Tab) => (k === 'all' ? live.length : k === 'trash' ? trashed.length : live.filter((m) => m.kind === k).length);
  const tabs: [Tab, string][] = [['all', 'Alle'], ['image', 'Bilder'], ['pdf', 'PDFs'], ['trash', 'Papierkorb']];

  return (
    <div
      className={`sheet media-view ${dragging ? 'dragging' : ''}`}
      tabIndex={-1}
      onPaste={onPaste}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="sheet-page">
        <div>
          <h1 className="h1">Medien</h1>
          <p className="lead">Bilder und PDFs ziehen, einfügen (Strg/Cmd+V) oder auswählen. Originale bleiben unverändert; dieselbe Datei wird nur einmal gespeichert.</p>
        </div>

        <div className="media-bar">
          <div className="tabs" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                {label} <span className="muted">{count(k)}</span>
              </button>
            ))}
          </div>
          <span className="spacer" />
          {status && <span className="muted small" data-testid="media-status">{status}</span>}
          <button type="button" className="btn small primary" onClick={() => fileRef.current?.click()}>
            <Icon name="plus" size={13} /> Dateien wählen …
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf"
            data-testid="media-file"
            onChange={(e) => {
              void importFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>

        {shown.length === 0 && (
          <div className="media-drop" onClick={() => tab !== 'trash' && fileRef.current?.click()}>
            {tab === 'trash' ? 'Der Papierkorb ist leer.' : 'Dateien hierher ziehen oder einfügen'}
          </div>
        )}

        {images.length > 0 && (
          <div className="media-grid" data-testid="media-grid">
            {images.map((m) => (
              <Tile key={m.hash} meta={m} onOpen={() => setOpenHash(m.hash)} />
            ))}
          </div>
        )}

        {others.length > 0 && (
          <div className="media-list">
            {others.map((m) => (
              <button
                key={m.hash}
                type="button"
                className="media-row"
                onClick={() =>
                  tab === 'trash'
                    ? setOpenHash(m.hash)
                    : void imageFor(m, 'original').then((b) => b && window.open(URL.createObjectURL(b), '_blank', 'noopener'))
                }
              >
                <span>{m.name}</span>
                <span className="muted small">{formatBytes(m.size)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {viewer.mounted && shownMeta && <Viewer meta={shownMeta} state={viewer.state} onClose={() => setOpenHash(null)} onPrev={() => step(-1)} onNext={() => step(1)} />}
    </div>
  );
}
