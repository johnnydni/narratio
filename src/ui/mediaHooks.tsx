import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { MediaMeta } from '../model/types';
import { imageFor, importFile } from '../store/media';
import type { ThumbSize } from '../store/blobs';
import { workerThumbnailer } from '../media/thumbnailer';
import type { Project } from '../store/project';
import { useMedia } from './state';

/** Lädt ein Bild aus dem Blob-Speicher als Objekt-URL, erst wenn es sichtbar wird. */
export function useMediaUrl(meta: MediaMeta | undefined, size: ThumbSize | 'original', visible = true): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!meta || !visible) return;
    let alive = true;
    let created: string | undefined;
    void imageFor(meta, size, workerThumbnailer).then((blob) => {
      if (!alive || !blob) return;
      created = URL.createObjectURL(blob);
      setUrl(created);
    });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(undefined);
    };
  }, [meta?.hash, size, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

export function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible];
}

/** Kleines Vorschaubild mit Platzhalterfarbe. */
export function MediaThumb({ meta, size = 's', className = 'thumb' }: { meta: MediaMeta; size?: ThumbSize; className?: string }) {
  const [ref, visible] = useVisible<HTMLSpanElement>();
  const url = useMediaUrl(meta, size, visible);
  return (
    <span ref={ref} className={className} style={{ background: meta.color ?? 'var(--bg-sunken)' }}>
      {url && meta.kind === 'image' && <img src={url} alt={meta.caption || meta.name} draggable={false} />}
      {meta.kind !== 'image' && <span className="thumb-label">{meta.kind === 'pdf' ? 'PDF' : 'Datei'}</span>}
    </span>
  );
}

/** Bilddateien aus einem Drop- oder Einfüge-Ereignis importieren; liefert die Hashes. */
export async function importImages(project: Project, files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const { meta } = await importFile(project, f, f.name || `Eingefügt ${new Date().toLocaleString('de-DE')}.png`, workerThumbnailer);
    out.push(meta.hash);
  }
  return out;
}

/**
 * Auswahl eines Mediums aus der Bibliothek oder per Datei. Schließt nach der Wahl.
 * `kind` schränkt auf Bilder ein (für den Szenentext).
 */
/**
 * Auswahl aus der Medienbibliothek. Mit `anchor` schwebt sie fest unter diesem Element über
 * allem (für Leisten, die überlaufende Inhalte abschneiden), sonst sitzt sie im Fluss bzw. per CSS.
 */
export function MediaPicker({ project, onPick, onClose, imagesOnly = false, anchor }: { project: Project; onPick: (hash: string) => void; onClose: () => void; imagesOnly?: boolean; anchor?: HTMLElement | null }) {
  const media = useMedia().filter((m) => !m.trashedAt && (!imagesOnly || m.kind === 'image'));
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fixed, setFixed] = useState<CSSProperties | undefined>();

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      setFixed({ position: 'fixed', top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 308)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Klick auf den Auslöser schaltet selbst um; sonst würde er hier schließen und gleich wieder öffnen.
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && !anchor?.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose, anchor]);

  const box = (
    <div ref={boxRef} className="picker" role="dialog" aria-label="Medium wählen" style={fixed}>
      <div className="picker-grid">
        {media.length === 0 && <span className="muted small">Noch keine Medien. Wähle eine Datei.</span>}
        {media.map((m) => (
          <button key={m.hash} type="button" className="picker-item" title={m.name} onClick={() => { onPick(m.hash); onClose(); }}>
            <MediaThumb meta={m} />
          </button>
        ))}
      </div>
      <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Datei wählen …</button>
      <input
        ref={fileRef}
        type="file"
        hidden
        data-testid="picker-file"
        accept={imagesOnly ? 'image/*' : 'image/*,application/pdf'}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const { meta } = await importFile(project, f, f.name, workerThumbnailer);
          onPick(meta.hash);
          onClose();
        }}
      />
    </div>
  );
  return anchor ? createPortal(box, document.body) : box;
}
