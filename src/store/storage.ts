/**
 * Dauerhafter Speicher (SY-01). Ohne ihn darf der Browser die lokale Datenbank bei Platzmangel
 * oder (Safari) nach längerer Inaktivität räumen. Das Ergebnis wird angezeigt, damit ein
 * abgelehnter Antrag nicht unbemerkt bleibt.
 */
export interface StorageStatus {
  /** null = Browser kennt die Storage-API nicht. */
  persisted: boolean | null;
  usage?: number;
  quota?: number;
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persisted) return { persisted: null };
  let persisted = await storage.persisted().catch(() => false);
  if (!persisted && storage.persist) persisted = await storage.persist().catch(() => false);
  const est = await storage.estimate?.().catch(() => undefined);
  return { persisted, usage: est?.usage, quota: est?.quota };
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '?';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',')} GB`;
}
