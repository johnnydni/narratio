import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Project, SCHEMA_VERSION } from './project';
import { TabSync } from './tabSync';
import { seedDemo } from './seed';
import { migrate, schemaOf, type MigrationResult } from './migrate';
import { requestPersistentStorage, type StorageStatus } from './storage';
import { saveLocalBackup, startAutoBackup } from './autoBackup';

/**
 * Öffnet ein Projekt: lädt es aus IndexedDB, verbindet die Fenster und legt beim allerersten
 * Start ein Beispielprojekt an.
 */
export interface Session {
  project: Project;
  sync: TabSync;
  persistence: IndexeddbPersistence;
  storage: StorageStatus;
  migration: MigrationResult;
  destroy(): void;
}

const DB_NAME = 'narratio-project-default';

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(name, fn) as Promise<T>;
  }
  return fn();
}

export async function openSession(): Promise<Session> {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(DB_NAME, doc);
  const bc = new BroadcastChannel(DB_NAME);
  const channel = {
    postMessage: (m: unknown) => bc.postMessage(m),
    close: () => bc.close(),
    set onmessage(fn: ((ev: { data: unknown }) => void) | null) {
      bc.onmessage = fn ? (ev) => fn({ data: ev.data }) : null;
    },
    get onmessage() {
      return null;
    },
  };
  const sync = new TabSync(doc, channel);
  const project = new Project(doc);

  await persistence.whenSynced;

  // Dauerhaften Speicher anfordern, damit der Browser die Daten nicht bei Platzmangel räumt.
  const storage = await requestPersistentStorage().catch((): StorageStatus => ({ persisted: null }));

  // Seed und Migration nur einmal, auch wenn zwei Fenster gleichzeitig starten.
  const migration = await withLock(`${DB_NAME}-seed`, async () => {
    sync.requestSync();
    await new Promise((r) => setTimeout(r, 120));
    if (!project.meta.get('seeded')) seedDemo(project);
    if (schemaOf(project) < SCHEMA_VERSION) {
      // Vor jeder Migration den alten Stand sichern; scheitert das, wird nicht migriert.
      await saveLocalBackup(project, 'vor-migration');
    }
    return migrate(project);
  });

  const stopAutoBackup = migration.tooNew ? () => undefined : startAutoBackup(project);

  // Beim Schließen oder Neuladen abmelden, damit andere Fenster nicht auf Phantome warten.
  const onHide = () => sync.destroy();
  window.addEventListener('pagehide', onHide, { once: true });

  return {
    project,
    sync,
    persistence,
    storage,
    migration,
    destroy() {
      stopAutoBackup();
      window.removeEventListener('pagehide', onHide);
      sync.destroy();
      void persistence.destroy();
      doc.destroy();
    },
  };
}
