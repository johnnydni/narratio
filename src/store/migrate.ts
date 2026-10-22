import type { Project } from './project';
import { SCHEMA_VERSION } from './project';

/**
 * Versionierte Schema-Migrationen (NFR Wartbarkeit).
 *
 * Eine Migration hebt ein Projekt von Version n-1 auf n. Weil zwei Fenster dasselbe Projekt
 * gleichzeitig öffnen und migrieren können, muss jede Migration idempotent sein: zweimal
 * ausgeführt ergibt sie dasselbe wie einmal. Neue Felder deshalb nur setzen, wenn sie fehlen.
 */
export type Migration = (project: Project) => void;

/** Schlüssel = Zielversion. Version 1 ist der Ausgangsstand aus P0 und braucht keine Migration. */
export const MIGRATIONS: Record<number, Migration> = {};

export interface MigrationResult {
  from: number;
  to: number;
  /** Das Projekt stammt aus einer neueren narratio-Version. Dann wird nichts angefasst. */
  tooNew: boolean;
}

export function schemaOf(project: Project): number {
  const v = project.meta.get('schema');
  return typeof v === 'number' && v >= 1 ? v : 1;
}

export function migrate(
  project: Project,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): MigrationResult {
  const from = schemaOf(project);
  if (from > target) return { from, to: from, tooNew: true };
  if (from === target) return { from, to: from, tooNew: false };

  for (let v = from + 1; v <= target; v++) {
    if (!migrations[v]) throw new Error(`Migration auf Schema ${v} fehlt`);
  }
  // Alles in einer Transaktion: Andere Fenster sehen entweder den alten oder den fertigen Stand.
  project.transact(() => {
    for (let v = from + 1; v <= target; v++) migrations[v]!(project);
    project.meta.set('schema', target);
  });
  return { from, to: target, tooNew: false };
}
