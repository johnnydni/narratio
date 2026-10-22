import * as Y from 'yjs';
import type {
  DialogEdge,
  DialogGraph,
  DialogNode,
  Id,
  Item,
  ItemType,
  MediaMeta,
  Profile,
  ProjectSnapshot,
  WorldVar,
} from '../model/types';

/**
 * Abbildung des Datenmodells auf ein Y.Doc.
 *
 * Aufbau:
 *   meta            Y.Map    Projektname, Schema-Version, Seed-Flag
 *   items           Y.Map    id → Y.Map (Felder eines Eintrags; je Feld "letzte Änderung gewinnt")
 *   worldVars       Y.Map    id → WorldVar (als Objekt)
 *   profiles        Y.Map    id → Profile (als Objekt)
 *   dialogs         Y.Map    dialogId → Y.Map { nodes: Y.Map<id, Y.Map>, edges: Y.Map<id, Edge> }
 *   scene:<id>      Y.XmlFragment   Szenentext, vom Editor zeichengenau zusammengeführt
 *   media           Y.Map    hash → MediaMeta (ab Schema 2; die Dateien liegen im Blob-Speicher)
 *
 * Langtext (Szenen) wird per CRDT zeichengenau gemergt. Kurze Felder (Titel, Varianten-Texte)
 * sind "letzte Änderung gewinnt" pro Feld. Für einen Einzelnutzer auf mehreren Geräten genügt das;
 * Variantentexte zeichengenau zu mergen wäre ein späterer Ausbau.
 */
export const SCHEMA_VERSION = 2;

export function newId(prefix = ''): Id {
  const rnd = crypto.getRandomValues(new Uint8Array(9));
  let s = '';
  for (const b of rnd) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36];
  return prefix + s;
}

type YItem = Y.Map<unknown>;

export class Project {
  readonly meta: Y.Map<unknown>;
  readonly items: Y.Map<YItem>;
  readonly worldVars: Y.Map<WorldVar>;
  readonly profiles: Y.Map<Profile>;
  readonly dialogs: Y.Map<Y.Map<Y.Map<unknown>>>;
  readonly media: Y.Map<MediaMeta>;

  constructor(readonly doc: Y.Doc) {
    this.meta = doc.getMap('meta');
    this.items = doc.getMap('items');
    this.worldVars = doc.getMap('worldVars');
    this.profiles = doc.getMap('profiles');
    this.dialogs = doc.getMap('dialogs');
    this.media = doc.getMap('media');
  }

  transact(fn: () => void): void {
    this.doc.transact(fn);
  }

  get name(): string {
    return (this.meta.get('name') as string) ?? 'Neues Projekt';
  }

  setName(name: string): void {
    this.meta.set('name', name);
  }

  /* ---------------- Einträge ---------------- */

  readItem(y: YItem): Item {
    return y.toJSON() as Item;
  }

  getItem(id: Id): Item | undefined {
    const y = this.items.get(id);
    return y ? this.readItem(y) : undefined;
  }

  listItems(): Item[] {
    const out: Item[] = [];
    this.items.forEach((y) => out.push(this.readItem(y)));
    return out;
  }

  children(parentId: Id | null): Item[] {
    return this.listItems()
      .filter((i) => i.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  createItem(type: ItemType, init: Partial<Item> = {}, id: Id = newId(type[0])): Id {
    this.transact(() => {
      const parentId = init.parentId ?? null;
      const siblings = this.children(parentId);
      const y = new Y.Map<unknown>();
      const item: Item = {
        id,
        type,
        title: init.title ?? '',
        parentId,
        order: init.order ?? (siblings.length ? siblings[siblings.length - 1]!.order + 1 : 0),
        ...init,
      };
      for (const [k, v] of Object.entries(item)) if (v !== undefined) y.set(k, v);
      this.items.set(id, y);
      if (type === 'dialog' && !this.dialogs.has(id)) this.initDialog(id);
    });
    return id;
  }

  updateItem(id: Id, patch: Partial<Item>): void {
    const y = this.items.get(id);
    if (!y) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) y.delete(k);
        else y.set(k, v);
      }
    });
  }

  /** Löscht einen Eintrag samt Unterelementen. Verweise darauf meldet die Prüfung (LR-05). */
  deleteItem(id: Id): void {
    this.transact(() => {
      for (const c of this.children(id)) this.deleteItem(c.id);
      this.items.delete(id);
      this.dialogs.delete(id);
      // Der Szenentext bleibt als verwaister Top-Level-Typ bestehen; Yjs kann Top-Level-Typen
      // nicht entfernen. Er wird beim Leeren nur geleert.
      const frag = this.doc.getXmlFragment(`scene:${id}`);
      if (frag.length) frag.delete(0, frag.length);
    });
  }

  moveItem(id: Id, parentId: Id | null, order: number): void {
    this.updateItem(id, { parentId, order });
  }

  sceneFragment(id: Id): Y.XmlFragment {
    return this.doc.getXmlFragment(`scene:${id}`);
  }

  /** Lore-IDs, auf die ein Szenentext verweist. */
  sceneRefs(id: Id): Id[] {
    const frag = this.sceneFragment(id);
    const ids: Id[] = [];
    for (const node of frag.createTreeWalker((n) => n instanceof Y.XmlElement && n.nodeName === 'loreRef')) {
      const ref = (node as Y.XmlElement).getAttribute('id');
      if (typeof ref === 'string') ids.push(ref);
    }
    return ids;
  }

  sceneText(id: Id): string {
    const frag = this.sceneFragment(id);
    const parts: string[] = [];
    for (const node of frag.createTreeWalker((n) => n instanceof Y.XmlText)) parts.push((node as Y.XmlText).toString());
    return parts.join(' ');
  }

  /* ---------------- Weltzustand ---------------- */

  listWorldVars(): WorldVar[] {
    return [...this.worldVars.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  putWorldVar(v: WorldVar): void {
    this.worldVars.set(v.id, v);
  }

  deleteWorldVar(id: Id): void {
    this.worldVars.delete(id);
  }

  listProfiles(): Profile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  putProfile(p: Profile): void {
    this.profiles.set(p.id, p);
  }

  deleteProfile(id: Id): void {
    this.profiles.delete(id);
  }

  /* ---------------- Dialoge ---------------- */

  private initDialog(id: Id): void {
    const d = new Y.Map<Y.Map<unknown>>();
    d.set('nodes', new Y.Map<unknown>());
    d.set('edges', new Y.Map<unknown>());
    this.dialogs.set(id, d);
  }

  dialogMap(id: Id): Y.Map<Y.Map<unknown>> | undefined {
    return this.dialogs.get(id);
  }

  private nodesOf(id: Id): Y.Map<Y.Map<unknown>> {
    if (!this.dialogs.has(id)) this.initDialog(id);
    return this.dialogs.get(id)!.get('nodes') as unknown as Y.Map<Y.Map<unknown>>;
  }

  private edgesOf(id: Id): Y.Map<DialogEdge> {
    if (!this.dialogs.has(id)) this.initDialog(id);
    return this.dialogs.get(id)!.get('edges') as unknown as Y.Map<DialogEdge>;
  }

  readGraph(dialogId: Id): DialogGraph {
    const d = this.dialogs.get(dialogId);
    if (!d) return { nodes: [], edges: [] };
    const nodes: DialogNode[] = [];
    (d.get('nodes') as unknown as Y.Map<Y.Map<unknown>>).forEach((y) => nodes.push(y.toJSON() as DialogNode));
    const edges: DialogEdge[] = [];
    (d.get('edges') as unknown as Y.Map<DialogEdge>).forEach((e) => edges.push(e));
    return { nodes, edges };
  }

  putNode(dialogId: Id, node: DialogNode): void {
    this.transact(() => {
      const nodes = this.nodesOf(dialogId);
      const y = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(node)) if (v !== undefined) y.set(k, v);
      nodes.set(node.id, y);
    });
  }

  updateNode(dialogId: Id, nodeId: Id, patch: Partial<DialogNode>): void {
    const y = this.nodesOf(dialogId).get(nodeId);
    if (!y) return;
    this.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) y.delete(k);
        else y.set(k, v);
      }
    });
  }

  deleteNode(dialogId: Id, nodeId: Id): void {
    this.transact(() => {
      this.nodesOf(dialogId).delete(nodeId);
      const edges = this.edgesOf(dialogId);
      for (const [eid, e] of [...edges.entries()]) {
        if (e.source === nodeId || e.target === nodeId) edges.delete(eid);
      }
    });
  }

  putEdge(dialogId: Id, edge: DialogEdge): void {
    this.edgesOf(dialogId).set(edge.id, edge);
  }

  deleteEdge(dialogId: Id, edgeId: Id): void {
    this.edgesOf(dialogId).delete(edgeId);
  }

  /* ---------------- Medien ---------------- */

  listMedia(): MediaMeta[] {
    return [...this.media.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  getMedia(hash: string): MediaMeta | undefined {
    return this.media.get(hash);
  }

  /** Legt ein Medium an. Gibt es den Hash schon, bleibt der Eintrag und kommt aus dem Papierkorb zurück. */
  addMedia(meta: MediaMeta): MediaMeta {
    const existing = this.media.get(meta.hash);
    if (existing) {
      if (existing.trashedAt) this.updateMedia(meta.hash, { trashedAt: undefined });
      return this.media.get(meta.hash)!;
    }
    this.media.set(meta.hash, meta);
    return meta;
  }

  updateMedia(hash: string, patch: Partial<MediaMeta>): void {
    const cur = this.media.get(hash);
    if (!cur) return;
    const next = { ...cur, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as Record<string, unknown>)[k];
    this.media.set(hash, next);
  }

  /** Endgültig aus dem Projekt entfernen. Die Datei im Blob-Speicher räumt der Aufrufer weg. */
  removeMedia(hash: string): void {
    this.media.delete(hash);
  }

  /* ---------------- Gesamtstand ---------------- */

  snapshot(): ProjectSnapshot {
    const items = this.listItems();
    const dialogs: Record<Id, DialogGraph> = {};
    const sceneRefs: Record<Id, Id[]> = {};
    for (const i of items) {
      if (i.type === 'dialog') dialogs[i.id] = this.readGraph(i.id);
      if (i.type === 'scene') sceneRefs[i.id] = this.sceneRefs(i.id);
    }
    return { name: this.name, items, worldVars: this.listWorldVars(), profiles: this.listProfiles(), dialogs, sceneRefs };
  }
}
