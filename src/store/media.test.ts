import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from './project';
import { seedDemo } from './seed';
import { createBackupZipWithMedia, mediaPath, readBackupContents, restoreBackupData } from './backup';
import { getOriginal, getThumb, hasOriginal, hashBytes, putOriginal } from './blobs';
import { imageFor, importFile, purgeMedia, restoreMedia, storeBackupMedia, trashMedia, type Thumbnailer } from './media';

function demo(): Project {
  const p = new Project(new Y.Doc());
  seedDemo(p);
  return p;
}

let calls = 0;
const fakeThumbs: Thumbnailer = async () => {
  calls++;
  return { width: 800, height: 600, color: '#a89f8c', thumbs: { s: new Blob(['s'], { type: 'image/webp' }), m: new Blob(['m'], { type: 'image/webp' }), l: new Blob(['l'], { type: 'image/webp' }) } };
};

let seq = 0;
/** Jedes Bild ist anders, damit sich Tests nicht über den Hash in die Quere kommen. */
const png = (label = String(seq++)) => new File([new Uint8Array([137, 80, 78, 71, ...new TextEncoder().encode(label)])], `${label}.png`, { type: 'image/png' });

describe('Medienimport (ME-01, ME-07, ME-08)', () => {
  it('speichert Original, Vorschaubilder und Metadaten', async () => {
    const p = demo();
    const file = png('tor');
    const { meta, duplicate } = await importFile(p, file, 'nordtor_konzept.png', fakeThumbs);
    expect(duplicate).toBe(false);
    expect(meta).toMatchObject({ kind: 'image', name: 'nordtor_konzept.png', mime: 'image/png', width: 800, height: 600, color: '#a89f8c' });
    expect(meta.hash).toBe(await hashBytes(new Uint8Array(await file.arrayBuffer())));
    expect(p.getMedia(meta.hash)?.name).toBe('nordtor_konzept.png');
    // Original unverändert
    expect(new Uint8Array(await (await getOriginal(meta.hash))!.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
    expect(await (await getThumb(meta.hash, 'm'))!.text()).toBe('m');
  });

  it('legt dieselbe Datei nur einmal an und holt sie aus dem Papierkorb zurück', async () => {
    const p = demo();
    const file = png('doppelt');
    const first = await importFile(p, file, 'a.png', fakeThumbs);
    const second = await importFile(p, file, 'b.png', fakeThumbs);
    expect(second.duplicate).toBe(true);
    expect(p.listMedia()).toHaveLength(1);
    expect(p.getMedia(first.meta.hash)?.name).toBe('a.png');

    trashMedia(p, first.meta.hash);
    expect(p.getMedia(first.meta.hash)?.trashedAt).toBeDefined();
    await importFile(p, file, 'c.png', fakeThumbs);
    expect(p.getMedia(first.meta.hash)?.trashedAt).toBeUndefined();
  });

  it('bewahrt Bilder auf, die sich nicht dekodieren lassen', async () => {
    const p = demo();
    const { meta } = await importFile(p, png('kaputt'), 'kaputt.png', async () => { throw new Error('decode'); });
    expect(meta.width).toBeUndefined();
    expect(await hasOriginal(meta.hash)).toBe(true);
  });

  it('erkennt PDFs und erzeugt dafür keine Bildvorschau', async () => {
    const p = demo();
    calls = 0;
    const pdf = new File([new TextEncoder().encode('%PDF-1.7 test')], 'Weltband.pdf', { type: '' });
    const { meta } = await importFile(p, pdf, 'Weltband.pdf', fakeThumbs);
    expect(meta).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    expect(calls).toBe(0);
  });

  it('rechnet fehlende Vorschaubilder aus dem Original nach', async () => {
    const p = demo();
    const { meta } = await importFile(p, png('ohne-vorschau'), 'x.png');
    expect(await getThumb(meta.hash, 's')).toBeUndefined();
    const img = await imageFor(meta, 's', fakeThumbs);
    expect(await img!.text()).toBe('s');
    expect(await getThumb(meta.hash, 'l')).toBeDefined();
  });

  it('löscht endgültig nur auf ausdrücklichen Wunsch, dann samt Dateien', async () => {
    const p = demo();
    const { meta } = await importFile(p, png('weg'), 'weg.png', fakeThumbs);
    trashMedia(p, meta.hash);
    restoreMedia(p, meta.hash);
    expect(p.getMedia(meta.hash)?.trashedAt).toBeUndefined();
    await purgeMedia(p, meta.hash);
    expect(p.getMedia(meta.hash)).toBeUndefined();
    expect(await hasOriginal(meta.hash)).toBe(false);
    expect(await getThumb(meta.hash, 's')).toBeUndefined();
  });
});

describe('Sicherung mit Medien', () => {
  it('nimmt Originale ins ZIP und stellt sie auf einem leeren Gerät wieder her', async () => {
    const a = demo();
    const { meta } = await importFile(a, png('sicherung'), 'Karte der Unterstadt.png', fakeThumbs);
    const { zip, missing } = await createBackupZipWithMedia(a, getOriginal, new Date('2026-10-22T08:00:00Z'));
    expect(missing).toEqual([]);

    const contents = readBackupContents(zip);
    expect(mediaPath(meta)).toBe(`Medien/${meta.hash.slice(0, 8)} Karte der Unterstadt.png`);
    expect(contents.media.get(meta.hash)).toBeDefined();

    // „Leeres Gerät“: Original entfernen, dann aus der Sicherung zurückholen.
    await purgeMedia(a, meta.hash);
    const b = new Project(new Y.Doc());
    const res = await storeBackupMedia(contents.media, contents.data.media ?? []);
    restoreBackupData(b, contents.data);
    expect(res).toEqual({ stored: 1, corrupt: [] });
    expect(b.getMedia(meta.hash)?.name).toBe('Karte der Unterstadt.png');
    expect(await hasOriginal(meta.hash)).toBe(true);
  });

  it('übernimmt keine Datei, die nicht zu ihrem Hash passt', async () => {
    const hash = await hashBytes(new Uint8Array([1, 2, 3]));
    const res = await storeBackupMedia(new Map([[hash, new Uint8Array([9, 9, 9])]]), [{ hash, kind: 'image', name: 'falsch.png', mime: 'image/png', size: 3, addedAt: '' }]);
    expect(res.corrupt).toEqual(['falsch.png']);
    expect(await hasOriginal(hash)).toBe(false);
  });

  it('meldet Medien, deren Datei fehlt, statt die Sicherung abzubrechen', async () => {
    const p = demo();
    p.addMedia({ hash: 'f'.repeat(64), kind: 'image', name: 'verloren.png', mime: 'image/png', size: 1, addedAt: '2026-10-22T00:00:00Z' });
    const { missing } = await createBackupZipWithMedia(p, getOriginal);
    expect(missing).toEqual(['verloren.png']);
  });

  it('ersetzt beim Wiederherstellen auch die Medienliste', async () => {
    const p = demo();
    await putOriginal('0'.repeat(64), new Blob(['x']));
    const data = (await import('./backup')).toBackupData(p);
    p.addMedia({ hash: '0'.repeat(64), kind: 'image', name: 'neu.png', mime: 'image/png', size: 1, addedAt: '2026-10-22T00:00:00Z' });
    restoreBackupData(p, data);
    expect(p.listMedia()).toEqual([]);
  });
});
