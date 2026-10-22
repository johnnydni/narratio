import type * as Y from 'yjs';
import type { Project } from './project';
import { backupFileName, createBackupZip, mediaPath } from './backup';
import { getOriginal } from './blobs';

/**
 * Automatische Sicherungen (SY-02).
 *
 * Zwei Ziele mit unterschiedlichem Schutz:
 * - Browser-intern (eigene IndexedDB): schützt vor Fehlbedienung, missglückter Migration oder
 *   Wiederherstellung. Liegt aber im selben Speicher wie das Projekt; räumt der Browser, ist
 *   beides weg.
 * - Sicherungsordner auf der Festplatte (nur Chromium-Browser, File System Access API):
 *   schützt auch davor. Eine Datei pro Tag, im Laufe des Tages überschrieben.
 */

export type BackupReason = 'auto' | 'manuell' | 'vor-wiederherstellen' | 'vor-migration';

export interface LocalBackupMeta {
  /** Zeitpunkt als ISO-String, zugleich Schlüssel. */
  createdAt: string;
  /** Projekt, zu dem die Sicherung gehört. Ältere Einträge ohne Angabe gehören zum ersten Projekt. */
  projectId?: string;
  reason: BackupReason;
  name: string;
  size: number;
}

interface LocalBackup extends LocalBackupMeta {
  zip: Uint8Array<ArrayBuffer>;
}

const DB = 'narratio-backups';
const STORE = 'backups';
const SETTINGS = 'settings';
const KEEP_RECENT = 10;
const KEEP_DAYS = 30;
const KEEP_SPECIAL = 5;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'createdAt' });
      req.result.createObjectStore(SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Welche Sicherungen bleiben: die letzten 10, dazu die jeweils neueste jedes Tages der letzten
 * 30 Tage, und von den Sicherungen vor Wiederherstellen und Migration die letzten 5.
 */
export function selectToKeep(entries: LocalBackupMeta[], now: Date): Set<string> {
  const keep = new Set<string>();
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const regular = sorted.filter((e) => e.reason === 'auto' || e.reason === 'manuell');
  const special = sorted.filter((e) => e.reason !== 'auto' && e.reason !== 'manuell');
  regular.slice(0, KEEP_RECENT).forEach((e) => keep.add(e.createdAt));
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  const days = new Set<string>();
  for (const e of regular) {
    const day = e.createdAt.slice(0, 10);
    if (e.createdAt >= cutoff && !days.has(day)) {
      days.add(day);
      keep.add(e.createdAt);
    }
  }
  special.slice(0, KEEP_SPECIAL).forEach((e) => keep.add(e.createdAt));
  return keep;
}

export async function listLocalBackups(projectId = 'default'): Promise<LocalBackupMeta[]> {
  const all = ((await tx<LocalBackup[]>(STORE, 'readonly', (s) => s.getAll())) ?? []) as LocalBackup[];
  return all
    .filter((b) => (b.projectId ?? 'default') === projectId)
    .map(({ createdAt, reason, name, size, projectId: p }) => ({ createdAt, reason, name, size, projectId: p ?? 'default' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Entfernt alle Browser-Sicherungen eines Projekts (beim endgültigen Löschen). */
export async function deleteProjectBackups(projectId: string): Promise<void> {
  const keys = (await listLocalBackups(projectId)).map((b) => b.createdAt);
  await tx(STORE, 'readwrite', (s) => {
    for (const k of keys) s.delete(k);
  });
}

export async function getLocalBackup(createdAt: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const b = (await tx<LocalBackup>(STORE, 'readonly', (s) => s.get(createdAt))) as LocalBackup | undefined;
  return b?.zip;
}

export async function saveLocalBackup(project: Project, reason: BackupReason, now = new Date()): Promise<LocalBackupMeta> {
  const zip = createBackupZip(project, now);
  const entry: LocalBackup = { createdAt: now.toISOString(), projectId: project.id, reason, name: backupFileName(project, now), size: zip.byteLength, zip };
  await tx(STORE, 'readwrite', (s) => s.put(entry));
  // Aufräumen nur innerhalb dieses Projekts; die Sicherungen anderer Projekte bleiben unberührt.
  const mine = await listLocalBackups(project.id);
  const keep = selectToKeep(mine, now);
  await tx(STORE, 'readwrite', (s) => {
    for (const b of mine) if (!keep.has(b.createdAt)) s.delete(b.createdAt);
  });
  const { zip: _, ...meta } = entry;
  return meta;
}

/* ---------------- Sicherungsordner ---------------- */

type Permission = 'granted' | 'denied' | 'prompt';

interface DirHandle {
  name: string;
  queryPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>;
  getDirectoryHandle(name: string, o: { create: boolean }): Promise<DirHandle>;
}

export type FolderState =
  | { kind: 'unsupported' }
  | { kind: 'none' }
  | { kind: 'needs-permission'; name: string }
  | { kind: 'ready'; name: string; lastWrite?: string };

export function folderSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function getHandle(): Promise<DirHandle | undefined> {
  return (await tx<DirHandle>(SETTINGS, 'readonly', (s) => s.get('folder'))) as DirHandle | undefined;
}

export async function folderState(): Promise<FolderState> {
  if (!folderSupported()) return { kind: 'unsupported' };
  const h = await getHandle();
  if (!h) return { kind: 'none' };
  const perm = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as const);
  if (perm !== 'granted') return { kind: 'needs-permission', name: h.name };
  const lastWrite = (await tx<string>(SETTINGS, 'readonly', (s) => s.get('folderLastWrite'))) as string | undefined;
  return { kind: 'ready', name: h.name, lastWrite };
}

/** Muss aus einem Klick heraus aufgerufen werden (Browser-Vorgabe). */
export async function chooseFolder(): Promise<FolderState> {
  const picker = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<DirHandle> }).showDirectoryPicker;
  const h = await picker({ mode: 'readwrite', id: 'narratio-backup' });
  await tx(SETTINGS, 'readwrite', (s) => s.put(h, 'folder'));
  return folderState();
}

/** Nach einem Neustart fragt der Browser erneut; ebenfalls nur aus einem Klick heraus. */
export async function regrantFolder(): Promise<FolderState> {
  const h = await getHandle();
  if (h) await h.requestPermission({ mode: 'readwrite' });
  return folderState();
}

export async function forgetFolder(): Promise<void> {
  await tx(SETTINGS, 'readwrite', (s) => {
    s.delete('folder');
    s.delete('folderLastWrite');
  });
}

export async function writeToFolder(project: Project, now = new Date()): Promise<boolean> {
  const state = await folderState();
  if (state.kind !== 'ready') return false;
  const h = (await getHandle())!;
  const day = now.toISOString().slice(0, 10);
  const base = backupFileName(project, now).replace(/_\d{4}-\d{2}-\d{2}_.*$/, '');
  const file = await h.getFileHandle(`${base}_${day}.zip`, { create: true });
  const w = await file.createWritable();
  await w.write(createBackupZip(project, now));
  await w.close();
  await writeMediaToFolder(project, h);
  await tx(SETTINGS, 'readwrite', (s) => s.put(now.toISOString(), 'folderLastWrite'));
  return true;
}

/**
 * Medien landen nicht im täglichen ZIP (sonst läge jedes Bild jeden Tag einmal mehr auf der
 * Platte), sondern einmal als Datei im Unterordner „Medien“. Dateien ändern sich nie, weil der
 * Name den Hash enthält; vorhandene werden übersprungen.
 */
async function writeMediaToFolder(project: Project, root: DirHandle): Promise<void> {
  const metas = project.listMedia();
  if (!metas.length) return;
  const dir = await root.getDirectoryHandle('Medien', { create: true });
  for (const m of metas) {
    const name = mediaPath(m).slice('Medien/'.length);
    try {
      await dir.getFileHandle(name, { create: false });
      continue;
    } catch {
      // gibt es noch nicht
    }
    const blob = await getOriginal(m.hash);
    if (!blob) continue;
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
  }
}

/* ---------------- Zeitplan ---------------- */

const INTERVAL_MS = 15 * 60_000;

/**
 * Sichert beim Start und danach alle 15 Minuten, aber nur, wenn sich seit der letzten
 * Sicherung etwas geändert hat. Mehrere Fenster teilen sich die Arbeit über eine Sperre.
 */
export function startAutoBackup(project: Project, onDone?: () => void): () => void {
  let dirty = true;
  const onUpdate = () => {
    dirty = true;
  };
  (project.doc as Y.Doc).on('update', onUpdate);

  const run = async () => {
    if (!dirty) return;
    dirty = false;
    const work = async () => {
      try {
        await saveLocalBackup(project, 'auto');
        await writeToFolder(project).catch(() => false);
        onDone?.();
      } catch {
        dirty = true;
      }
    };
    if ('locks' in navigator) await navigator.locks.request('narratio-auto-backup', { ifAvailable: true }, async (lock) => (lock ? work() : undefined));
    else await work();
  };

  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, INTERVAL_MS);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void run();
  };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    (project.doc as Y.Doc).off('update', onUpdate);
  };
}
