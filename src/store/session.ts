import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Project } from './project';
import { TabSync } from './tabSync';
import { seedDemo } from './seed';

/**
 * Öffnet ein Projekt: lädt es aus IndexedDB, verbindet die Fenster und legt beim allerersten
 * Start ein Beispielprojekt an.
 */
export interface Session {
  project: Project;
  sync: TabSync;
  persistence: IndexeddbPersistence;
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
  const channel = new BroadcastChannel(DB_NAME);
  const sync = new TabSync(doc, channel);
  const project = new Project(doc);

  await persistence.whenSynced;

  // Dauerhaften Speicher anfordern, damit der Browser die Daten nicht bei Platzmangel räumt.
  void navigator.storage?.persist?.().catch(() => undefined);

  // Seed nur einmal, auch wenn zwei Fenster gleichzeitig starten.
  await withLock(`${DB_NAME}-seed`, async () => {
    sync.requestSync();
    await new Promise((r) => setTimeout(r, 120));
    if (!project.meta.get('seeded')) seedDemo(project);
  });

  return {
    project,
    sync,
    persistence,
    destroy() {
      sync.destroy();
      void persistence.destroy();
      doc.destroy();
    },
  };
}
