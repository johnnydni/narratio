import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from './project';
import { seedDemo } from './seed';
import { readBackupZip } from './backup';
import { getLocalBackup, listLocalBackups, saveLocalBackup, selectToKeep, type LocalBackupMeta } from './autoBackup';

const entry = (createdAt: string, reason: LocalBackupMeta['reason'] = 'auto'): LocalBackupMeta => ({ createdAt, reason, name: '', size: 0 });

describe('Aufbewahrung automatischer Sicherungen', () => {
  it('behält die letzten 10 und je Tag die neueste der letzten 30 Tage', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const entries: LocalBackupMeta[] = [];
    // 40 Tage, je drei Sicherungen.
    for (let d = 0; d < 40; d++) {
      for (const h of ['08', '12', '18']) {
        entries.push(entry(new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10) + `T${h}:00:00.000Z`));
      }
    }
    const keep = selectToKeep(entries, now);
    const days = new Set([...keep].map((k) => k.slice(0, 10)));
    expect(days.size).toBe(31);
    expect(keep.has('2026-10-22T18:00:00.000Z')).toBe(true);
    expect(keep.has('2026-10-22T08:00:00.000Z')).toBe(true);
    expect(keep.has('2026-09-01T18:00:00.000Z')).toBe(false);
    // Pro älterem Tag nur die neueste.
    expect(keep.has('2026-10-01T18:00:00.000Z')).toBe(true);
    expect(keep.has('2026-10-01T08:00:00.000Z')).toBe(false);
  });

  it('räumt Sicherungen vor Wiederherstellen nicht mit den automatischen weg', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    const entries = [entry('2026-01-01T00:00:00.000Z', 'vor-wiederherstellen'), ...Array.from({ length: 20 }, (_, i) => entry(`2026-10-22T11:${String(i).padStart(2, '0')}:00.000Z`))];
    expect(selectToKeep(entries, now).has('2026-01-01T00:00:00.000Z')).toBe(true);
  });
});

describe('Browser-interne Sicherungen', () => {
  it('speichert, listet und liefert eine lesbare Sicherung', async () => {
    const p = new Project(new Y.Doc());
    seedDemo(p);
    const meta = await saveLocalBackup(p, 'vor-wiederherstellen', new Date('2026-10-22T09:00:00Z'));
    expect(meta.name).toBe('Aschenstadt_2026-10-22_09-00.zip');
    const list = await listLocalBackups();
    expect(list.map((b) => b.createdAt)).toContain('2026-10-22T09:00:00.000Z');
    const zip = await getLocalBackup('2026-10-22T09:00:00.000Z');
    expect(readBackupZip(zip!).items.length).toBe(p.listItems().length);
  });
});

describe('Sicherungen je Projekt', () => {
  it('listet und räumt nur die Sicherungen des eigenen Projekts', async () => {
    const a = new Project(new Y.Doc(), 'proj-a');
    const b = new Project(new Y.Doc(), 'proj-b');
    seedDemo(a);
    seedDemo(b);
    await saveLocalBackup(b, 'manuell', new Date('2026-10-01T09:00:00Z'));
    // Mehr als genug Sicherungen in A, damit dort aufgeräumt wird
    for (let i = 0; i < 12; i++) await saveLocalBackup(a, 'auto', new Date(`2026-10-22T10:${String(i).padStart(2, '0')}:00Z`));
    expect((await listLocalBackups('proj-a')).every((x) => x.projectId === 'proj-a')).toBe(true);
    expect((await listLocalBackups('proj-b')).map((x) => x.createdAt)).toEqual(['2026-10-01T09:00:00.000Z']);
  });
});
