import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../store/project';
import { seedDemo } from '../store/seed';
import { createBackupZip, readBackupZip, restoreBackupData, writeScene } from '../store/backup';
import { addStroke, anchorAt, blockOf, moveStrokes, sketchArray, sketchesToJson, type Stroke } from './model';
import { distanceToStroke, rasterizePencil } from './pencil';

function scene(): { p: Project; frag: Y.XmlFragment } {
  const p = new Project(new Y.Doc());
  seedDemo(p);
  const frag = p.sceneFragment('s_nacht');
  writeScene(frag, ['Eins', 'Zwei', 'Drei'].map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })));
  return { p, frag };
}

function stroke(frag: Y.XmlFragment, block: number, id = 'k1'): Stroke {
  return { id, anchor: anchorAt(frag, block), color: 'graphite', width: 4, seed: 7, pts: [10, 5, 0.6, 40, 12, 0.8], group: 'g1' };
}

describe('Scribble: Striche am Absatz', () => {
  it('wandert mit, wenn darüber ein Absatz eingefügt oder gelöscht wird', () => {
    const { p, frag } = scene();
    addStroke(p, 's_nacht', stroke(frag, 1));
    const anchor = () => sketchArray(p, 's_nacht').get(0).anchor;
    expect(blockOf(frag, anchor())).toBe(1);
    const neu = new Y.XmlElement('paragraph');
    frag.insert(0, [neu]);
    expect(blockOf(frag, anchor())).toBe(2);
    frag.delete(0, 2);
    // Der Ankerabsatz "Zwei" ist jetzt der erste.
    expect(blockOf(frag, anchor())).toBe(0);
  });

  it('fällt auf den folgenden Absatz zurück, wenn der eigene gelöscht wird', () => {
    const { p, frag } = scene();
    addStroke(p, 's_nacht', stroke(frag, 1));
    frag.delete(1, 1);
    expect(blockOf(frag, sketchArray(p, 's_nacht').get(0).anchor)).toBe(1);
  });

  it('verschiebt Striche und hängt sie an einen neuen Absatz', () => {
    const { p, frag } = scene();
    addStroke(p, 's_nacht', stroke(frag, 0));
    moveStrokes(p, 's_nacht', new Map([['k1', { anchor: anchorAt(frag, 2), dx: 5, dy: -3 }]]));
    const s = sketchArray(p, 's_nacht').get(0);
    expect(blockOf(frag, s.anchor)).toBe(2);
    expect(s.pts).toEqual([15, 2, 0.6, 45, 9, 0.8]);
  });

  it('übersteht Sicherung und Wiederherstellung', () => {
    const { p, frag } = scene();
    addStroke(p, 's_nacht', stroke(frag, 2));
    const b = new Project(new Y.Doc());
    restoreBackupData(b, readBackupZip(createBackupZip(p)));
    expect(sketchesToJson(b, 's_nacht')).toEqual(sketchesToJson(p, 's_nacht'));
    expect(sketchesToJson(b, 's_nacht')[0]!.block).toBe(2);
  });

  it('räumt die Striche einer gelöschten Szene mit ab', () => {
    const { p, frag } = scene();
    addStroke(p, 's_nacht', stroke(frag, 0));
    p.deleteItem('s_nacht');
    expect(sketchArray(p, 's_nacht').length).toBe(0);
  });
});

describe('Scribble: Bleistift', () => {
  it('rastert deterministisch, abhängig vom Seed', () => {
    const pts = [0, 0, 0.7, 30, 10, 0.7, 60, 0, 0.7];
    const a = rasterizePencil(pts, 6, 1, 2)!;
    const b = rasterizePencil(pts, 6, 1, 2)!;
    const c = rasterizePencil(pts, 6, 2, 2)!;
    expect(a.alpha).toEqual(b.alpha);
    expect(a.alpha).not.toEqual(c.alpha);
  });

  it('lässt Papierkorn stehen und hat dennoch Deckung', () => {
    const pts: number[] = [];
    for (let x = 0; x <= 100; x += 2) pts.push(x, 0, 0.7);
    const r = rasterizePencil(pts, 8, 3, 1)!;
    const covered = r.alpha.filter((a) => a > 60).length / r.alpha.length;
    // Weder ein voller Balken noch fast leer
    expect(covered).toBeGreaterThan(0.15);
    expect(covered).toBeLessThan(0.75);
  });

  it('misst den Abstand zum Strich für den Radierer', () => {
    expect(distanceToStroke([0, 0, 1, 10, 0, 1], 5, 3)).toBeCloseTo(3);
  });
});
