import { mediaKindOf, type MediaMeta } from '../model/types';
import type { Project } from './project';
import { THUMB_SIZES, deleteBlobs, getOriginal, getThumb, hashBytes, putOriginal, putThumb, type ThumbSize } from './blobs';

/** Ergebnis der Bildanalyse: Maße, Platzhalterfarbe und die drei Vorschaubilder. */
export interface ImageInfo {
  width: number;
  height: number;
  color: string;
  thumbs: Partial<Record<ThumbSize, Blob>>;
}

/** Erzeugt Vorschaubilder; im Browser per Worker, in Tests ersetzbar. */
export type Thumbnailer = (image: Blob) => Promise<ImageInfo>;

/** Bekannte Endungen für Dateien ohne MIME-Typ (z. B. beim Einfügen aus manchen Programmen). */
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf',
};

export function guessMime(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

/** Raster-Bilder, aus denen der Browser Vorschaubilder rechnen kann. SVG bleibt selbst Vorschau. */
export function canThumbnail(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}

/**
 * Importiert eine Datei: Hash bilden, Original speichern (falls neu), Vorschaubilder erzeugen,
 * Metadaten ins Projekt. Dieselbe Datei zweimal ergibt einen Eintrag (ME-08).
 */
export async function importFile(project: Project, file: File | Blob, name: string, thumbnailer?: Thumbnailer): Promise<{ meta: MediaMeta; duplicate: boolean }> {
  const mime = guessMime({ name, type: file.type });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await hashBytes(bytes);
  const existing = project.getMedia(hash);
  if (existing && !existing.trashedAt) return { meta: existing, duplicate: true };

  if (!(await getOriginal(hash))) await putOriginal(hash, new Blob([bytes], { type: mime }));

  const meta: MediaMeta = { hash, kind: mediaKindOf(mime), name, mime, size: bytes.byteLength, addedAt: new Date().toISOString() };
  if (thumbnailer && canThumbnail(mime)) {
    try {
      const info = await thumbnailer(new Blob([bytes], { type: mime }));
      Object.assign(meta, { width: info.width, height: info.height, color: info.color });
      for (const [size, blob] of Object.entries(info.thumbs)) if (blob) await putThumb(hash, size as ThumbSize, blob);
    } catch {
      // Ein Bild, das der Browser nicht dekodieren kann, wird trotzdem aufbewahrt, nur ohne Vorschau.
    }
  }
  return { meta: project.addMedia(meta), duplicate: !!existing };
}

/**
 * Liefert das Bild für eine Anzeigegröße. Fehlt das Vorschaubild (z. B. nach dem
 * Wiederherstellen einer Sicherung), wird es aus dem Original nachgerechnet.
 */
export async function imageFor(meta: MediaMeta, size: ThumbSize | 'original', thumbnailer?: Thumbnailer): Promise<Blob | undefined> {
  if (size === 'original' || !canThumbnail(meta.mime)) return getOriginal(meta.hash);
  const thumb = await getThumb(meta.hash, size);
  if (thumb) return thumb;
  const original = await getOriginal(meta.hash);
  if (!original || !thumbnailer) return original;
  try {
    const info = await thumbnailer(original);
    for (const [s, blob] of Object.entries(info.thumbs)) if (blob) await putThumb(meta.hash, s as ThumbSize, blob);
    return info.thumbs[size] ?? original;
  } catch {
    return original;
  }
}

/** Endgültig löschen: Metadaten und Dateien. Vorher sollte das Medium im Papierkorb gelegen haben. */
export async function purgeMedia(project: Project, hash: string): Promise<void> {
  project.removeMedia(hash);
  await deleteBlobs(hash);
}

export function trashMedia(project: Project, hash: string): void {
  project.updateMedia(hash, { trashedAt: new Date().toISOString() });
}

export function restoreMedia(project: Project, hash: string): void {
  project.updateMedia(hash, { trashedAt: undefined });
}

export { THUMB_SIZES };

/**
 * Legt die Dateien einer eingelesenen Sicherung in den Blob-Speicher. Jede Datei wird gegen
 * ihren Hash geprüft; eine veränderte Datei wird nicht übernommen.
 */
export async function storeBackupMedia(files: Map<string, Uint8Array>, metas: MediaMeta[]): Promise<{ stored: number; corrupt: string[] }> {
  const byHash = new Map(metas.map((m) => [m.hash, m]));
  let stored = 0;
  const corrupt: string[] = [];
  for (const [hash, bytes] of files) {
    const meta = byHash.get(hash);
    const copy = new Uint8Array(bytes);
    if ((await hashBytes(copy)) !== hash) {
      corrupt.push(meta?.name ?? hash);
      continue;
    }
    if (!(await getOriginal(hash))) {
      await putOriginal(hash, new Blob([copy], { type: meta?.mime ?? 'application/octet-stream' }));
      stored++;
    }
  }
  return { stored, corrupt };
}
