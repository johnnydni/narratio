import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Project, SCHEMA_VERSION } from './project';
import { seedDemo } from './seed';
import {
  BackupError,
  createBackupZip,
  readBackupZip,
  restoreBackupData,
  sceneToJson,
  toBackupData,
  writeScene,
} from './backup';
import { migrate } from './migrate';

function demo(): Project {
  const p = new Project(new Y.Doc());
  seedDemo(p);
  return p;
}

const NOW = new Date('2026-10-22T08:00:00Z');

describe('Offenes Backup (SY-02, EX-02)', () => {
  it('stellt den vollständigen Stand verlustfrei wieder her', () => {
    const a = demo();
    // Formatierung, Liste und Verweis, damit der Rundlauf mehr als Absätze prüft.
    const frag = a.sceneFragment('s_nacht');
    writeScene(frag, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Fett', marks: [{ type: 'bold' }] }, { type: 'text', text: ' und normal' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'loreRef', attrs: { id: 'l_mara' } }] }] }] },
    ]);

    const zip = createBackupZip(a, NOW);
    const b = new Project(new Y.Doc());
    restoreBackupData(b, readBackupZip(zip));

    expect(b.snapshot()).toEqual(a.snapshot());
    for (const id of ['s_ankunft', 's_zoellner', 's_nacht']) {
      expect(sceneToJson(b.sceneFragment(id))).toEqual(sceneToJson(a.sceneFragment(id)));
    }
    expect(b.sceneFragment('s_ankunft').toString()).toBe(a.sceneFragment('s_ankunft').toString());
    expect(b.meta.toJSON()).toEqual(a.meta.toJSON());
  });

  it('ersetzt beim Wiederherstellen den alten Stand, statt ihn zu vermischen', () => {
    const a = demo();
    const data = toBackupData(a, NOW);
    a.createItem('scene', { title: 'Nach der Sicherung', parentId: null });
    a.updateItem('l_mara', { title: 'Mara (umbenannt)' });
    writeScene(a.sceneFragment('s_ankunft'), [{ type: 'paragraph', content: [{ type: 'text', text: 'überschrieben' }] }]);

    restoreBackupData(a, data);

    expect(a.listItems().some((i) => i.title === 'Nach der Sicherung')).toBe(false);
    expect(a.getItem('l_mara')?.title).toBe('Mara');
    expect(a.sceneText('s_ankunft')).toContain('Der Wind trug');
  });

  it('enthält lesbare Markdown-Dateien in der Binder-Struktur', () => {
    const files = unzipSync(createBackupZip(demo(), NOW));
    const names = Object.keys(files);
    expect(names).toContain('narratio.json');
    expect(names).toContain('LIESMICH.txt');
    expect(names).toContain('Manuskript/Akt I_ Ankunft/Kapitel 1_ Das Tor/01 Ankunft am Nordtor.md');
    expect(names).toContain('Lore/Items/Aschenklinge.md');

    const scene = strFromU8(files['Manuskript/Akt I_ Ankunft/Kapitel 1_ Das Tor/01 Ankunft am Nordtor.md']!);
    expect(scene).toMatch(/^# Ankunft am Nordtor\n/);
    expect(scene.match(/# Ankunft am Nordtor/g)).toHaveLength(1);
    // Lore-Verweise erscheinen mit ihrem aktuellen Namen.
    expect(scene).toContain('durch das Nordtor, lange bevor Mara');

    const item = strFromU8(files['Lore/Items/Aschenklinge.md']!);
    expect(item).toContain('Export-ID: `Item.Waffe.Aschenklinge`');
    expect(item).toContain('- **Seltenheit:** Episch');
  });

  it('erzeugt für denselben Stand dieselbe Datei', () => {
    const p = demo();
    expect(createBackupZip(p, NOW)).toEqual(createBackupZip(p, NOW));
  });

  it('lehnt fremde, beschädigte und zu neue Dateien ab, ohne etwas zu ändern', () => {
    expect(() => readBackupZip(strToU8('kein zip'))).toThrow(BackupError);
    expect(() => readBackupZip(zipSync({ 'a.txt': strToU8('x') }))).toThrow('narratio.json fehlt');
    expect(() => readBackupZip(zipSync({ 'narratio.json': strToU8('{') }))).toThrow('beschädigt');
    expect(() => readBackupZip(zipSync({ 'narratio.json': strToU8('{"format":"anders"}') }))).toThrow('Keine narratio-Sicherung');

    const data = toBackupData(demo(), NOW);
    const newer = zipSync({ 'narratio.json': strToU8(JSON.stringify({ ...data, schema: SCHEMA_VERSION + 1 })) });
    expect(() => readBackupZip(newer)).toThrow('neueren narratio-Version');
  });

  it('übersteht Sonderzeichen und doppelte Titel in Dateinamen', () => {
    const p = demo();
    p.createItem('scene', { title: 'Wer? Was: Wo/Wie', parentId: null }, 's_x1');
    p.createItem('scene', { title: 'Wer? Was: Wo/Wie', parentId: null }, 's_x2');
    const names = Object.keys(unzipSync(createBackupZip(p, NOW))).filter((n) => n.includes('Wer_'));
    expect(names).toHaveLength(2);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
  });
});

/** Ein Projekt auf dem Stand von Schema 1 (P0). */
function oldDemo(): Project {
  const p = demo();
  p.meta.set('schema', 1);
  return p;
}

describe('Migrationen', () => {
  it('hebt ein altes Projekt Schritt für Schritt auf die Zielversion', () => {
    const p = oldDemo();
    const calls: number[] = [];
    const res = migrate(p, { 2: () => calls.push(2), 3: (q) => { calls.push(3); q.meta.set('neu', true); } }, 3);
    expect(res).toEqual({ from: 1, to: 3, tooNew: false });
    expect(calls).toEqual([2, 3]);
    expect(p.meta.get('schema')).toBe(3);
    expect(p.meta.get('neu')).toBe(true);
  });

  it('tut nichts, wenn das Projekt aktuell ist, und fasst zu neue Projekte nicht an', () => {
    const p = demo();
    expect(migrate(p, {}, SCHEMA_VERSION)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, tooNew: false });
    p.meta.set('schema', 99);
    expect(migrate(p, {}, SCHEMA_VERSION).tooNew).toBe(true);
    expect(p.meta.get('schema')).toBe(99);
  });

  it('hebt ein P0-Projekt mit den echten Migrationen auf den aktuellen Stand', () => {
    const p = oldDemo();
    expect(migrate(p)).toEqual({ from: 1, to: SCHEMA_VERSION, tooNew: false });
    expect(p.snapshot()).toEqual(demo().snapshot());
  });

  it('bricht ab, bevor etwas geändert wird, wenn eine Migration fehlt', () => {
    const p = oldDemo();
    expect(() => migrate(p, { 3: () => undefined }, 3)).toThrow('Schema 2 fehlt');
    expect(p.meta.get('schema')).toBe(1);
  });

  it('ergibt dasselbe, wenn zwei Fenster gleichzeitig migrieren', () => {
    const a = new Y.Doc();
    seedDemo(new Project(a));
    new Project(a).meta.set('schema', 1);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const m = { 2: (q: Project) => { if (!q.meta.has('neu')) q.meta.set('neu', 1); } };
    migrate(new Project(a), m, 2);
    migrate(new Project(b), m, 2);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(new Project(a).meta.toJSON()).toEqual(new Project(b).meta.toJSON());
    expect(new Project(a).meta.get('schema')).toBe(2);
  });
});
