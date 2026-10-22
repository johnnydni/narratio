import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Project, SCHEMA_VERSION } from './project';
import { seedDemo } from './seed';
import { restoreBackupData, toBackupData, type BackupContents } from './backup';
import { getOriginal, mediaDbName, setMediaProject } from './blobs';
import { storeBackupMedia } from './media';
import { deleteProjectBackups } from './autoBackup';
import { migrate } from './migrate';

/**
 * Die Bibliothek: alle Projekte auf diesem Gerät.
 *
 * Jedes Projekt hat eine eigene Projekt-Datenbank (Y.Doc), einen eigenen Medienspeicher und
 * eigene Browser-Sicherungen. Das Verzeichnis selbst ist nur ein Zwischenspeicher für Namen
 * und Kennzahlen im localStorage; die Wahrheit liegt in den Projekt-Datenbanken. Geht das
 * Verzeichnis verloren, findet `discoverProjects` die Projekte wieder.
 */

export interface ProjectStats {
  scenes: number;
  dialogs: number;
  lore: number;
  words: number;
  media: number;
}

export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: string;
  openedAt?: string;
  /** Im Papierkorb: ausgeblendet, aber vollständig erhalten, bis es endgültig gelöscht wird. */
  trashedAt?: string;
  /** Farbe des Buchrückens, Index in die Palette der Bibliothek. */
  color: number;
  stats?: ProjectStats;
}

const KEY = 'narratio:library';
const EVENT = 'narratio-library';
export const SPINE_COLORS = 8;

export function docDbName(id: string): string {
  return `narratio-project-${id}`;
}

export function listProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ProjectEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveProjects(list: ProjectEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* privater Modus: nur für diese Sitzung */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function getProject(id: string): ProjectEntry | undefined {
  return listProjects().find((p) => p.id === id);
}

export function updateProject(id: string, patch: Partial<ProjectEntry>): void {
  const list = listProjects();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return;
  const next = { ...list[i]!, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
  list[i] = next;
  saveProjects(list);
}

function addEntry(entry: ProjectEntry): void {
  saveProjects([...listProjects().filter((p) => p.id !== entry.id), entry]);
}

/** Meldet Änderungen am Verzeichnis, auch aus anderen Fenstern. */
export function subscribeLibrary(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function newProjectId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function nextColor(): number {
  const used = listProjects().map((p) => p.color);
  for (let c = 0; c < SPINE_COLORS; c++) if (!used.includes(c)) return c;
  return used.length % SPINE_COLORS;
}

/* ---------------- Projekt-Datenbanken ---------------- */

/**
 * Öffnet die Datenbank eines Projekts kurz, ohne es anzuzeigen (Umbenennen, Duplizieren,
 * Anlegen). Andere Fenster mit demselben Projekt sehen die Änderung beim nächsten Öffnen;
 * Yjs führt beide Stände ohne Verlust zusammen.
 */
export async function withProjectDoc<T>(id: string, fn: (project: Project) => T | Promise<T>): Promise<T> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docDbName(id), doc);
  await persistence.whenSynced;
  try {
    return await fn(new Project(doc, id));
  } finally {
    // Schreibvorgänge von y-indexeddb laufen asynchron; close() wartet, bis sie abgeschlossen sind.
    await persistence.destroy();
    doc.destroy();
  }
}

export function computeStats(project: Project): ProjectStats {
  const items = project.listItems();
  const scenes = items.filter((i) => i.type === 'scene');
  let words = 0;
  for (const s of scenes) words += project.sceneText(s.id).split(/\s+/).filter(Boolean).length;
  return {
    scenes: scenes.length,
    dialogs: items.filter((i) => i.type === 'dialog').length,
    lore: items.filter((i) => i.type === 'lore').length,
    words,
    media: project.listMedia().filter((m) => !m.trashedAt).length,
  };
}

/** Ein leeres Projekt mit dem Nötigsten: Manuskript-Ordner und eine erste Szene. */
export function seedEmpty(project: Project, name: string): void {
  project.transact(() => {
    project.setName(name);
    project.meta.set('schema', SCHEMA_VERSION);
    const folder = project.createItem('folder', { title: 'Manuskript' });
    project.createItem('scene', { title: 'Erste Szene', parentId: folder, status: 'idea' });
    project.meta.set('seeded', true);
  });
}

export type ProjectSource = { kind: 'empty'; name: string } | { kind: 'demo' } | { kind: 'backup'; contents: BackupContents };

/** Legt ein Projekt an und trägt es in die Bibliothek ein. Liefert die neue ID. */
export async function createProject(source: ProjectSource): Promise<string> {
  const id = newProjectId();
  let corrupt: string[] = [];
  const name = await withProjectDoc(id, async (p) => {
    if (source.kind === 'empty') seedEmpty(p, source.name.trim() || 'Neues Projekt');
    else if (source.kind === 'demo') seedDemo(p);
    else {
      restoreBackupData(p, source.contents.data);
      p.meta.set('seeded', true);
      migrate(p);
      corrupt = (await inMediaScope(id, () => storeBackupMedia(source.contents.media, source.contents.data.media ?? []))).corrupt;
    }
    return p.name;
  });
  const now = new Date().toISOString();
  const stats = await withProjectDoc(id, (p) => {
    if (!p.meta.get('seeded')) throw new Error('Das Projekt konnte nicht gespeichert werden');
    return computeStats(p);
  });
  addEntry({ id, name, createdAt: now, color: nextColor(), stats });
  if (corrupt.length) console.warn('Beschädigte Mediendateien übersprungen:', corrupt);
  return id;
}

/** Führt etwas im Medienspeicher eines anderen Projekts aus und schaltet danach zurück. */
async function inMediaScope<T>(id: string, fn: () => Promise<T>): Promise<T> {
  setMediaProject(id);
  try {
    return await fn();
  } finally {
    setMediaProject('default');
  }
}

export async function duplicateProject(id: string): Promise<string> {
  const data = await withProjectDoc(id, (p) => toBackupData(p));
  const media = new Map<string, Uint8Array>();
  await inMediaScope(id, async () => {
    for (const m of data.media ?? []) {
      const blob = await getOriginal(m.hash);
      if (blob) media.set(m.hash, new Uint8Array(await blob.arrayBuffer()));
    }
  });
  const name = `${(data.meta.name as string) || 'Projekt'} (Kopie)`;
  data.meta = { ...data.meta, name };
  return createProject({ kind: 'backup', contents: { data, media } });
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await withProjectDoc(id, (p) => p.setName(clean));
  updateProject(id, { name: clean });
}

export function trashProject(id: string): void {
  updateProject(id, { trashedAt: new Date().toISOString() });
}

export function restoreProject(id: string): void {
  updateProject(id, { trashedAt: undefined });
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Ist das Projekt noch in einem anderen Fenster offen, wartet das Löschen, bis es zu ist.
    req.onblocked = () => resolve();
  });
}

/** Endgültig: Projekt, Medien und Browser-Sicherungen. Nicht rückgängig zu machen. */
export async function purgeProject(id: string): Promise<void> {
  await deleteDb(docDbName(id));
  await deleteDb(mediaDbName(id));
  await deleteProjectBackups(id);
  saveProjects(listProjects().filter((p) => p.id !== id));
}

/** Beim Öffnen: Zeitpunkt, Name und Kennzahlen im Verzeichnis nachführen. */
export function recordProject(project: Project, opened: boolean): void {
  const entry = getProject(project.id);
  const patch: Partial<ProjectEntry> = { name: project.name, stats: computeStats(project) };
  if (opened) patch.openedAt = new Date().toISOString();
  if (entry) updateProject(project.id, patch);
  else addEntry({ id: project.id, createdAt: new Date().toISOString(), color: nextColor(), ...patch, name: project.name });
}

/**
 * Gleicht das Verzeichnis mit den vorhandenen Datenbanken ab: Beim allerersten Start entsteht
 * das Beispielprojekt, und Projekte ohne Eintrag (etwa nach gelöschtem localStorage) tauchen
 * wieder auf.
 */
export async function discoverProjects(): Promise<void> {
  const known = new Set(listProjects().map((p) => p.id));
  let names: string[] = [];
  try {
    names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '').filter(Boolean);
  } catch {
    names = [];
  }
  const prefix = docDbName('');
  const found = names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
  if (!known.size && !found.length) found.push('default'); // erster Start: Beispielprojekt
  for (const id of found) {
    if (known.has(id)) continue;
    const info = await withProjectDoc(id, (p) => {
      if (!p.meta.get('seeded') && id === 'default') seedDemo(p);
      return { name: p.name, stats: computeStats(p) };
    });
    addEntry({ id, name: info.name, createdAt: new Date().toISOString(), color: nextColor(), stats: info.stats });
  }
}
