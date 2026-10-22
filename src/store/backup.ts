import * as Y from 'yjs';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { DialogEdge, DialogGraph, DialogNode, Id, Item, Profile, WorldVar } from '../model/types';
import { LORE_KINDS } from '../model/types';
import { Project, SCHEMA_VERSION } from './project';
import { schemaOf } from './migrate';

/**
 * Offenes Sicherungsformat (SY-02, EX-02, NFR Datenhoheit).
 *
 * Eine Sicherung ist ein ZIP, das sich ohne narratio lesen lässt:
 *   narratio.json        der vollständige Stand, aus dem wiederhergestellt wird
 *   Manuskript/…/*.md    Szenen als Markdown, in der Ordnerstruktur des Binders (nur zum Lesen)
 *   Lore/<Art>/*.md      Lore-Einträge mit Feldern als Markdown (nur zum Lesen)
 *   LIESMICH.txt         was wo liegt
 *
 * Szenentexte stehen in narratio.json als Baum im ProseMirror-Stil ({type, attrs, content, text,
 * marks}). Das ist verlustfrei, weil es eins zu eins dem Y.XmlFragment entspricht, und
 * lesbar, weil es dasselbe Format ist, das TipTap selbst für JSON verwendet.
 */
export const BACKUP_FORMAT = 'narratio-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface SceneMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export type SceneNode =
  | { type: 'text'; text: string; marks?: SceneMark[] }
  | { type: string; attrs?: Record<string, unknown>; content?: SceneNode[] };

export interface BackupData {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schema: number;
  createdAt: string;
  meta: Record<string, unknown>;
  items: Item[];
  worldVars: WorldVar[];
  profiles: Profile[];
  dialogs: Record<Id, DialogGraph>;
  scenes: Record<Id, SceneNode[]>;
}

/* ------------------------------------------------------------------ */
/* Szenentext <-> JSON                                                  */
/* ------------------------------------------------------------------ */

function textNodes(t: Y.XmlText): SceneNode[] {
  const out: SceneNode[] = [];
  for (const op of t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    if (typeof op.insert !== 'string') continue;
    const marks = op.attributes
      ? Object.entries(op.attributes).map(([type, attrs]): SceneMark => {
          const a = attrs && typeof attrs === 'object' && Object.keys(attrs).length ? (attrs as Record<string, unknown>) : undefined;
          return a ? { type, attrs: a } : { type };
        })
      : [];
    out.push(marks.length ? { type: 'text', text: op.insert, marks } : { type: 'text', text: op.insert });
  }
  return out;
}

function elementNode(el: Y.XmlElement): SceneNode {
  const attrs = el.getAttributes() as Record<string, unknown>;
  const content = childNodes(el);
  const node: { type: string; attrs?: Record<string, unknown>; content?: SceneNode[] } = { type: el.nodeName };
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

function childNodes(parent: Y.XmlFragment | Y.XmlElement): SceneNode[] {
  const out: SceneNode[] = [];
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) out.push(...textNodes(child));
    else if (child instanceof Y.XmlElement) out.push(elementNode(child));
  }
  return out;
}

export function sceneToJson(frag: Y.XmlFragment): SceneNode[] {
  return childNodes(frag);
}

function isText(n: SceneNode): n is { type: 'text'; text: string; marks?: SceneMark[] } {
  return n.type === 'text' && typeof (n as { text?: unknown }).text === 'string';
}

function buildChildren(nodes: SceneNode[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Y.XmlElement | Y.XmlText)[] = [];
  let run: { text: string; marks?: SceneMark[] }[] = [];
  const flush = () => {
    if (!run.length) return;
    // Aufeinanderfolgende Textstücke bilden wie im Editor ein einziges Y.XmlText.
    const t = new Y.XmlText();
    let pos = 0;
    for (const r of run) {
      const attrs = r.marks?.length ? Object.fromEntries(r.marks.map((m) => [m.type, m.attrs ?? {}])) : {};
      t.insert(pos, r.text, attrs);
      pos += r.text.length;
    }
    out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (isText(n)) {
      run.push(n);
      continue;
    }
    flush();
    const el = new Y.XmlElement(n.type);
    const node = n as { attrs?: Record<string, unknown>; content?: SceneNode[] };
    for (const [k, v] of Object.entries(node.attrs ?? {})) el.setAttribute(k, v as string);
    if (node.content?.length) el.insert(0, buildChildren(node.content));
    out.push(el);
  }
  flush();
  return out;
}

export function writeScene(frag: Y.XmlFragment, nodes: SceneNode[]): void {
  if (frag.length) frag.delete(0, frag.length);
  const children = buildChildren(nodes);
  if (children.length) frag.insert(0, children);
}

/* ------------------------------------------------------------------ */
/* Projekt <-> Sicherung                                                */
/* ------------------------------------------------------------------ */

export function toBackupData(project: Project, now = new Date()): BackupData {
  const snap = project.snapshot();
  const scenes: Record<Id, SceneNode[]> = {};
  for (const i of snap.items) if (i.type === 'scene') scenes[i.id] = sceneToJson(project.sceneFragment(i.id));
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schema: schemaOf(project),
    createdAt: now.toISOString(),
    meta: project.meta.toJSON(),
    items: snap.items,
    worldVars: snap.worldVars,
    profiles: snap.profiles,
    dialogs: snap.dialogs,
    scenes,
  };
}

export class BackupError extends Error {}

export function parseBackupData(json: unknown): BackupData {
  const d = json as Partial<BackupData> | null;
  if (!d || d.format !== BACKUP_FORMAT) throw new BackupError('Keine narratio-Sicherung');
  if (typeof d.formatVersion !== 'number' || d.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError('Die Sicherung stammt aus einer neueren narratio-Version');
  }
  if (!Array.isArray(d.items) || !Array.isArray(d.worldVars) || !Array.isArray(d.profiles) || !d.dialogs || !d.scenes || !d.meta) {
    throw new BackupError('Die Sicherung ist unvollständig');
  }
  if (typeof d.schema === 'number' && d.schema > SCHEMA_VERSION) {
    throw new BackupError('Die Sicherung stammt aus einer neueren narratio-Version');
  }
  return d as BackupData;
}

/**
 * Ersetzt den gesamten Projektstand durch die Sicherung, in einer Transaktion. Andere Fenster
 * übernehmen das über den normalen Sync. Vorher sollte der aktuelle Stand gesichert werden.
 */
export function restoreBackupData(project: Project, data: BackupData): void {
  const doc = project.doc;
  project.transact(() => {
    for (const key of [...project.meta.keys()]) project.meta.delete(key);
    for (const [k, v] of Object.entries(data.meta)) project.meta.set(k, v);
    project.items.clear();
    project.worldVars.clear();
    project.profiles.clear();
    project.dialogs.clear();
    // Szenentexte sind Top-Level-Typen und lassen sich nicht entfernen, nur leeren.
    for (const name of doc.share.keys()) {
      if (name.startsWith('scene:')) {
        const frag = doc.getXmlFragment(name);
        if (frag.length) frag.delete(0, frag.length);
      }
    }

    for (const item of data.items) {
      const y = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(item)) if (v !== undefined) y.set(k, v);
      project.items.set(item.id, y);
    }
    for (const v of data.worldVars) project.putWorldVar(v);
    for (const p of data.profiles) project.putProfile(p);
    for (const [dialogId, graph] of Object.entries(data.dialogs)) {
      const nodes = new Y.Map<Y.Map<unknown>>();
      const edges = new Y.Map<DialogEdge>();
      const d = new Y.Map<unknown>();
      d.set('nodes', nodes);
      d.set('edges', edges);
      project.dialogs.set(dialogId, d as Y.Map<Y.Map<unknown>>);
      for (const n of graph.nodes as DialogNode[]) {
        const y = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(n)) if (v !== undefined) y.set(k, v);
        nodes.set(n.id, y);
      }
      for (const e of graph.edges) edges.set(e.id, e);
    }
    for (const [sceneId, nodes] of Object.entries(data.scenes)) writeScene(project.sceneFragment(sceneId), nodes);
  });
}

/* ------------------------------------------------------------------ */
/* Markdown zum Lesen ohne narratio                                     */
/* ------------------------------------------------------------------ */

function applyMarks(text: string, marks: SceneMark[] | undefined): string {
  if (!marks?.length || !text.trim()) return text;
  // Leerzeichen am Rand bleiben außerhalb der Markierung, sonst ist das Markdown ungültig.
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  let core = text.slice(lead.length, text.length - trail.length);
  for (const m of marks) {
    if (m.type === 'code') core = `\`${core}\``;
    else if (m.type === 'bold') core = `**${core}**`;
    else if (m.type === 'italic') core = `*${core}*`;
    else if (m.type === 'strike') core = `~~${core}~~`;
    else if (m.type === 'link' && typeof m.attrs?.href === 'string') core = `[${core}](${m.attrs.href})`;
  }
  return lead + core + trail;
}

function inlineMd(nodes: SceneNode[] | undefined, loreName: (id: string) => string): string {
  return (nodes ?? [])
    .map((n) => {
      if (isText(n)) return applyMarks(n.text, n.marks);
      const node = n as { attrs?: Record<string, unknown> };
      if (n.type === 'loreRef') return loreName(String(node.attrs?.id ?? ''));
      if (n.type === 'hardBreak') return '  \n';
      return '';
    })
    .join('');
}

function blocksMd(nodes: SceneNode[] | undefined, loreName: (id: string) => string, indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    const node = n as { attrs?: Record<string, unknown>; content?: SceneNode[] };
    switch (n.type) {
      case 'heading':
        out.push(`${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineMd(node.content, loreName)}`);
        break;
      case 'paragraph':
        out.push(indent + inlineMd(node.content, loreName));
        break;
      case 'blockquote':
        out.push(blocksMd(node.content, loreName).map((l) => (l ? `> ${l}` : '>')).join('\n'));
        break;
      case 'bulletList':
      case 'orderedList':
        out.push(
          (node.content ?? [])
            .map((li, k) => {
              const marker = n.type === 'bulletList' ? '- ' : `${k + 1}. `;
              const inner = blocksMd((li as { content?: SceneNode[] }).content, loreName);
              return inner.map((l, j) => (j === 0 ? marker : ' '.repeat(marker.length)) + l).join('\n');
            })
            .join('\n'),
        );
        break;
      case 'codeBlock':
        out.push('```\n' + inlineMd(node.content, loreName) + '\n```');
        break;
      case 'horizontalRule':
        out.push('---');
        break;
      default:
        if (node.content) out.push(...blocksMd(node.content, loreName));
    }
  }
  return out;
}

export function sceneToMarkdown(item: Item, nodes: SceneNode[], loreName: (id: string) => string): string {
  const head = [`# ${item.title || 'Ohne Titel'}`];
  if (item.synopsis) head.push('', `> ${item.synopsis}`);
  const body = blocksMd(nodes, loreName);
  // Die Szene beginnt oft selbst mit ihrem Titel als Überschrift; nicht doppelt ausgeben.
  if (body[0] === `# ${item.title}`) body.shift();
  return [...head, '', body.join('\n\n'), ''].join('\n');
}

function loreToMarkdown(item: Item): string {
  const lines = [`# ${item.title || 'Ohne Titel'}`, ''];
  if (item.exportId) lines.push(`Export-ID: \`${item.exportId}\``, '');
  for (const [k, v] of Object.entries(item.fields ?? {})) lines.push(`- **${k}:** ${v}`);
  if (item.fields && Object.keys(item.fields).length) lines.push('');
  if (item.description) lines.push(item.description, '');
  return lines.join('\n');
}

function safeName(s: string): string {
  return (s || 'Ohne Titel').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

const README = `narratio-Sicherung

narratio.json   Vollständiger Projektstand (Binder, Szenen, Lore, Weltzustand, Dialoge).
                Aus dieser Datei stellt narratio wieder her. Format: JSON, Szenentexte als
                Baum im TipTap/ProseMirror-Stil.
Manuskript/     Szenen als Markdown in der Ordnerstruktur des Binders, zum Lesen ohne narratio.
Lore/           Lore-Einträge mit ihren Feldern als Markdown.

Die Markdown-Dateien werden beim Wiederherstellen nicht gelesen.
`;

export function backupFiles(data: BackupData): Zippable {
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const loreName = (id: string) => byId.get(id)?.title ?? '@?';
  const files: Zippable = {
    'LIESMICH.txt': strToU8(README),
    'narratio.json': strToU8(JSON.stringify(data, null, 2)),
  };
  const used = new Set<string>();
  const unique = (path: string) => {
    let p = path;
    for (let n = 2; used.has(p.toLowerCase()); n++) p = path.replace(/\.md$/, ` (${n}).md`);
    used.add(p.toLowerCase());
    return p;
  };
  const folderPath = (item: Item): string[] => {
    const parts: string[] = [];
    const seen = new Set<Id>();
    for (let p = item.parentId ? byId.get(item.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
      seen.add(p.id);
      parts.unshift(safeName(p.title));
    }
    return parts;
  };
  const siblingsIndex = (item: Item) =>
    data.items.filter((i) => i.parentId === item.parentId).sort((a, b) => a.order - b.order).indexOf(item) + 1;

  for (const item of data.items) {
    if (item.type === 'scene') {
      const dir = folderPath(item);
      const name = `${String(siblingsIndex(item)).padStart(2, '0')} ${safeName(item.title)}.md`;
      const path = unique([...(dir[0] === 'Manuskript' ? dir : ['Manuskript', ...dir]), name].join('/'));
      files[path] = strToU8(sceneToMarkdown(item, data.scenes[item.id] ?? [], loreName));
    } else if (item.type === 'lore') {
      const kind = LORE_KINDS.find((k) => k.kind === item.loreKind)?.plural ?? 'Sonstige';
      files[unique(`Lore/${kind}/${safeName(item.title)}.md`)] = strToU8(loreToMarkdown(item));
    }
  }
  return files;
}

export function createBackupZip(project: Project, now = new Date()): Uint8Array<ArrayBuffer> {
  // mtime fest auf den Sicherungszeitpunkt, damit gleiche Stände gleiche Dateien ergeben.
  return zipSync(backupFiles(toBackupData(project, now)), { level: 6, mtime: now }) as Uint8Array<ArrayBuffer>;
}

export function readBackupZip(zip: Uint8Array): BackupData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (f) => f.name === 'narratio.json' });
  } catch {
    throw new BackupError('Die Datei ist kein gültiges ZIP');
  }
  const json = files['narratio.json'];
  if (!json) throw new BackupError('narratio.json fehlt in der Sicherung');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(json));
  } catch {
    throw new BackupError('narratio.json ist beschädigt');
  }
  return parseBackupData(parsed);
}

export function backupFileName(project: Project, now = new Date()): string {
  const base = project.name.replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, '_').replace(/^_|_$/g, '') || 'narratio';
  const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  return `${base}_${stamp}.zip`;
}
