import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from './project';
import { TabSync, type ChannelLike } from './tabSync';
import { seedDemo } from './seed';
import { validateProject } from '../model/validate';
import { exportUnreal } from '../model/exportUnreal';

/** Ein In-Memory-Kanal, der sich wie BroadcastChannel verhält (asynchron, an alle anderen). */
class Bus {
  members = new Set<FakeChannel>();
  queue: Promise<void> = Promise.resolve();
}
class FakeChannel implements ChannelLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(private bus: Bus) {
    bus.members.add(this);
  }
  postMessage(msg: unknown) {
    for (const m of this.bus.members) {
      if (m === this) continue;
      this.bus.queue = this.bus.queue.then(() => m.onmessage?.({ data: msg }));
    }
  }
  close() {
    this.bus.members.delete(this);
  }
}

const flush = async (bus: Bus) => {
  for (let i = 0; i < 10; i++) await bus.queue;
};

describe('Beispielprojekt', () => {
  it('ist fehlerfrei und exportierbar', () => {
    const p = new Project(new Y.Doc());
    seedDemo(p);
    const errors = validateProject(p.snapshot()).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(exportUnreal(p.snapshot()).ok).toBe(true);
  });

  it('findet Lore-Verweise im Szenentext', () => {
    const p = new Project(new Y.Doc());
    seedDemo(p);
    expect(p.sceneRefs('s_ankunft')).toEqual(['l_nordtor', 'l_mara', 'l_brann', 'l_klinge']);
  });

  it('löscht beim Entfernen eines Nodes auch seine Verbindungen', () => {
    const p = new Project(new Y.Doc());
    seedDemo(p);
    p.deleteNode('d_tor', 'n_choice');
    const g = p.readGraph('d_tor');
    expect(g.edges.some((e) => e.source === 'n_choice' || e.target === 'n_choice')).toBe(false);
  });
});

describe('Sync zwischen Fenstern (P0-Gate)', () => {
  it('bringt ein neues Fenster auf den Stand des alten', async () => {
    const bus = new Bus();
    const a = new Y.Doc();
    seedDemo(new Project(a));
    const syncA = new TabSync(a, new FakeChannel(bus));
    const b = new Y.Doc();
    const syncB = new TabSync(b, new FakeChannel(bus));
    await flush(bus);
    expect(new Project(b).getItem('l_klinge')?.title).toBe('Aschenklinge');
    expect(new Project(b).sceneRefs('s_ankunft')).toHaveLength(4);
    syncA.destroy();
    syncB.destroy();
  });

  it('führt gleichzeitige Änderungen beider Fenster ohne Verlust zusammen', async () => {
    const bus = new Bus();
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedDemo(new Project(a));
    const syncA = new TabSync(a, new FakeChannel(bus));
    const syncB = new TabSync(b, new FakeChannel(bus));
    await flush(bus);

    const pa = new Project(a);
    const pb = new Project(b);
    // Beide schreiben gleichzeitig in denselben Szenentext und ändern verschiedene Felder.
    const ta = new Y.XmlElement('paragraph');
    ta.insert(0, [new Y.XmlText('Absatz aus Fenster A.')]);
    const tb = new Y.XmlElement('paragraph');
    tb.insert(0, [new Y.XmlText('Absatz aus Fenster B.')]);
    pa.sceneFragment('s_ankunft').push([ta]);
    pb.sceneFragment('s_ankunft').push([tb]);
    pa.updateItem('l_klinge', { title: 'Aschenklinge (umbenannt)' });
    pb.updateNode('d_tor', 'n_halt', { x: 999 });
    await flush(bus);

    for (const p of [pa, pb]) {
      const text = p.sceneText('s_ankunft');
      expect(text).toContain('Absatz aus Fenster A.');
      expect(text).toContain('Absatz aus Fenster B.');
      expect(p.getItem('l_klinge')?.title).toBe('Aschenklinge (umbenannt)');
      expect(p.readGraph('d_tor').nodes.find((n) => n.id === 'n_halt')?.x).toBe(999);
    }
    // Beide Dokumente sind byte-gleich im Zustand.
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    syncA.destroy();
    syncB.destroy();
  });

  it('zählt verbundene Fenster', async () => {
    const bus = new Bus();
    const syncA = new TabSync(new Y.Doc(), new FakeChannel(bus));
    const syncB = new TabSync(new Y.Doc(), new FakeChannel(bus));
    await flush(bus);
    expect(syncA.peerCount).toBe(1);
    expect(syncB.peerCount).toBe(1);
    syncB.destroy();
    await flush(bus);
    expect(syncA.peerCount).toBe(0);
    syncA.destroy();
  });
});
