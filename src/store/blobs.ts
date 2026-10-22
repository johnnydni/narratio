/**
 * Blob-Speicher für Medien (ME-07, ME-08).
 *
 * Originale und Vorschaubilder liegen in einer eigenen IndexedDB, nicht im Projekt-Dokument:
 * Das Y.Doc bleibt klein, Sync und Start werden von Medien nie gebremst. Schlüssel ist der
 * SHA-256 des Originals, damit dieselbe Datei nur einmal gespeichert wird. Originale werden
 * unverändert abgelegt.
 */

export const THUMB_SIZES = { s: 160, m: 480, l: 1280 } as const;
export type ThumbSize = keyof typeof THUMB_SIZES;

const ORIGINALS = 'originals';
const THUMBS = 'thumbs';

/** Jedes Projekt hat seinen eigenen Medienspeicher; das erste behält den alten Namen. */
export function mediaDbName(projectId: string): string {
  return projectId === 'default' ? 'narratio-media' : `narratio-media-${projectId}`;
}

let DB = mediaDbName('default');
let dbPromise: Promise<IDBDatabase> | null = null;

/** Schaltet auf den Medienspeicher eines Projekts um (beim Öffnen eines Projekts). */
export function setMediaProject(projectId: string): void {
  const name = mediaDbName(projectId);
  if (name === DB) return;
  const old = dbPromise;
  dbPromise = null;
  DB = name;
  void old?.then((db) => db.close()).catch(() => undefined);
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ORIGINALS);
      req.result.createObjectStore(THUMBS);
    };
    req.onsuccess = () => {
      // Wird die DB von außen gelöscht oder hochgestuft, beim nächsten Zugriff neu öffnen.
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function hashBytes(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putOriginal(hash: string, blob: Blob): Promise<void> {
  await request(ORIGINALS, 'readwrite', (s) => s.put(blob, hash));
}

export async function getOriginal(hash: string): Promise<Blob | undefined> {
  return (await request<Blob | undefined>(ORIGINALS, 'readonly', (s) => s.get(hash))) ?? undefined;
}

export async function hasOriginal(hash: string): Promise<boolean> {
  return (await request<number>(ORIGINALS, 'readonly', (s) => s.count(hash))) > 0;
}

export async function listOriginalHashes(): Promise<string[]> {
  return (await request<IDBValidKey[]>(ORIGINALS, 'readonly', (s) => s.getAllKeys())).map(String);
}

export async function putThumb(hash: string, size: ThumbSize, blob: Blob): Promise<void> {
  await request(THUMBS, 'readwrite', (s) => s.put(blob, `${hash}:${size}`));
}

export async function getThumb(hash: string, size: ThumbSize): Promise<Blob | undefined> {
  return (await request<Blob | undefined>(THUMBS, 'readonly', (s) => s.get(`${hash}:${size}`))) ?? undefined;
}

/** Entfernt Original und alle Vorschaubilder. Nur für endgültiges Löschen. */
export async function deleteBlobs(hash: string): Promise<void> {
  await request(ORIGINALS, 'readwrite', (s) => s.delete(hash));
  for (const size of Object.keys(THUMB_SIZES)) await request(THUMBS, 'readwrite', (s) => s.delete(`${hash}:${size}`));
}
