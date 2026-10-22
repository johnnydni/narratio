import * as Y from 'yjs';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { DialogEdge, DialogGraph, DialogNode, Id, Item, MediaMeta, Profile, WorldVar } from '../model/types';
import { LORE_KINDS } from '../model/types';
import { Project, SCHEMA_VERSION } from './project';
import { schemaOf } from './migrate';
import { sketchesToJson, writeSketches, type StrokeJson } from '../sketch/model';

/**
 * Offenes Sicherungsformat (SY-02, EX-02, NFR Datenhoheit).
 *
 * Eine Sicherung ist ein ZIP, das sich ohne narratio lesen lässt:
 *   narratio.json        der vollständige Stand, aus dem wiederhergestellt wird
 *   Manuskript/…/*.md    Szenen als Markdown, in der Ordnerstruktur des Binders (nur zum Lesen)
 *   Lore/<Art>/*.md      Lore-Einträge mit Feldern als Markdown (nur zum Lesen)
 *   Medien/*             Originaldateien, unverändert (nur in Sicherungen „mit Medien“)
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
  /** Ab Schema 2. Nur Metadaten; die Dateien liegen unter Medien/ (siehe mediaPath). */
  media?: MediaMeta[];
  /** Bleistiftstriche je Szene, am Absatz verankert (fehlt in älteren Sicherungen). */
  sketches?: Record<Id, StrokeJson[]>;
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
  const sketches: Record<Id, StrokeJson[]> = {};
  for (const i of snap.items) {
    if (i.type !== 'scene') continue;
    scenes[i.id] = sceneToJson(project.sceneFragment(i.id));
    const strokes = sketchesToJson(project, i.id);
    if (strokes.length) sketches[i.id] = strokes;
  }
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
    media: project.listMedia(),
    sketches,
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
    project.media.clear();
    // Szenentexte sind Top-Level-Typen und lassen sich nicht entfernen, nur leeren.
    for (const name of doc.share.keys()) {
      if (name.startsWith('scene:')) {
        const frag = doc.getXmlFragment(name);
        if (frag.length) frag.delete(0, frag.length);
      } else if (name.startsWith('sketch:')) {
        const arr = doc.getArray(name);
        if (arr.length) arr.delete(0, arr.length);
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
    for (const [sceneId, strokes] of Object.entries(data.sketches ?? {})) writeSketches(project, sceneId, strokes);
    for (const m of data.media ?? []) project.media.set(m.hash, m);
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

/** Wie Verweise im Markdown erscheinen: Lore als Name, Bilder als relativer Pfad ins ZIP. */
export interface MdNames {
  lore: (id: string) => string;
  /** Markdown für ein Bild; fehlt die Funktion, erscheint nur die Unterschrift. */
  media?: (hash: string) => string;
}

function inlineMd(nodes: SceneNode[] | undefined, names: MdNames): string {
  return (nodes ?? [])
    .map((n) => {
      if (isText(n)) return applyMarks(n.text, n.marks);
      const node = n as { attrs?: Record<string, unknown> };
      if (n.type === 'loreRef') return names.lore(String(node.attrs?.id ?? ''));
      if (n.type === 'hardBreak') return '  \n';
      return '';
    })
    .join('');
}

function blocksMd(nodes: SceneNode[] | undefined, names: MdNames, indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes ?? []) {
    const node = n as { attrs?: Record<string, unknown>; content?: SceneNode[] };
    switch (n.type) {
      case 'heading':
        out.push(`${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inlineMd(node.content, names)}`);
        break;
      case 'paragraph':
        out.push(indent + inlineMd(node.content, names));
        break;
      case 'blockquote':
        out.push(blocksMd(node.content, names).map((l) => (l ? `> ${l}` : '>')).join('\n'));
        break;
      case 'bulletList':
      case 'orderedList':
        out.push(
          (node.content ?? [])
            .map((li, k) => {
              const marker = n.type === 'bulletList' ? '- ' : `${k + 1}. `;
              const inner = blocksMd((li as { content?: SceneNode[] }).content, names);
              return inner.map((l, j) => (j === 0 ? marker : ' '.repeat(marker.length)) + l).join('\n');
            })
            .join('\n'),
        );
        break;
      case 'codeBlock':
        out.push('```\n' + inlineMd(node.content, names) + '\n```');
        break;
      case 'mediaImage':
        out.push(names.media?.(String(node.attrs?.hash ?? '')) ?? '');
        break;
      case 'horizontalRule':
        out.push('---');
        break;
      default:
        if (node.content) out.push(...blocksMd(node.content, names));
    }
  }
  return out;
}

export function sceneToMarkdown(item: Item, nodes: SceneNode[], names: MdNames): string {
  const head = [`# ${item.title || 'Ohne Titel'}`];
  if (item.synopsis) head.push('', `> ${item.synopsis}`);
  const body = blocksMd(nodes, names).filter((b) => b !== '');
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
Medien/         Bilder und PDFs als unveränderte Originale (nur in Sicherungen mit Medien).
                Der Name beginnt mit den ersten 8 Zeichen des SHA-256 der Datei.

Die Markdown-Dateien werden beim Wiederherstellen nicht gelesen.
`;

/** Pfad eines Mediums im ZIP; eindeutig über den Hash-Anfang, lesbar über den Dateinamen. */
export function mediaPath(m: MediaMeta): string {
  const dot = m.name.lastIndexOf('.');
  const base = dot > 0 ? m.name.slice(0, dot) : m.name;
  const ext = dot > 0 ? m.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  return `Medien/${m.hash.slice(0, 8)} ${safeName(base).slice(0, 60)}.${ext || 'bin'}`;
}

export function backupFiles(data: BackupData, mediaFiles: Map<string, Uint8Array> = new Map()): Zippable {
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const loreName = (id: string) => byId.get(id)?.title ?? '@?';
  const mediaByHash = new Map((data.media ?? []).map((m) => [m.hash, m]));
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
      // Bilder verweisen relativ auf Medien/ im ZIP, auch wenn die Datei in dieser Sicherung fehlt.
      const up = '../'.repeat(path.split('/').length - 1);
      const media = (hash: string) => {
        const m = mediaByHash.get(hash);
        if (!m) return '';
        const alt = (m.caption || m.name).replace(/[\[\]]/g, '');
        return `![${alt}](${encodeURI(up + mediaPath(m))})`;
      };
      files[path] = strToU8(sceneToMarkdown(item, data.scenes[item.id] ?? [], { lore: loreName, media }));
    } else if (item.type === 'lore') {
      const kind = LORE_KINDS.find((k) => k.kind === item.loreKind)?.plural ?? 'Sonstige';
      files[unique(`Lore/${kind}/${safeName(item.title)}.md`)] = strToU8(loreToMarkdown(item));
    }
  }
  for (const m of data.media ?? []) {
    const bytes = mediaFiles.get(m.hash);
    // Bilder und PDFs sind schon komprimiert; nochmal packen kostet nur Zeit.
    if (bytes) files[mediaPath(m)] = [bytes, { level: 0 }];
  }
  return files;
}

/** Sicherung ohne Mediendateien (Metadaten sind enthalten). Synchron, für die automatische Sicherung. */
export function createBackupZip(project: Project, now = new Date()): Uint8Array<ArrayBuffer> {
  // mtime fest auf den Sicherungszeitpunkt, damit gleiche Stände gleiche Dateien ergeben.
  return zipSync(backupFiles(toBackupData(project, now)), { level: 6, mtime: now }) as Uint8Array<ArrayBuffer>;
}

/** Sicherung mit allen Originaldateien. Fehlt eine Datei im Blob-Speicher, fehlt sie im ZIP. */
export async function createBackupZipWithMedia(
  project: Project,
  readOriginal: (hash: string) => Promise<Blob | undefined>,
  now = new Date(),
): Promise<{ zip: Uint8Array<ArrayBuffer>; missing: string[] }> {
  const data = toBackupData(project, now);
  const files = new Map<string, Uint8Array>();
  const missing: string[] = [];
  for (const m of data.media ?? []) {
    const blob = await readOriginal(m.hash);
    if (blob) files.set(m.hash, new Uint8Array(await blob.arrayBuffer()));
    else missing.push(m.name);
  }
  const zip = zipSync(backupFiles(data, files), { level: 6, mtime: now }) as Uint8Array<ArrayBuffer>;
  return { zip, missing };
}

export interface BackupContents {
  data: BackupData;
  /** hash → Datei, nur für Medien, die im ZIP liegen. */
  media: Map<string, Uint8Array>;
}

export function readBackupZip(zip: Uint8Array): BackupData {
  return readBackupContents(zip, false).data;
}

export function readBackupContents(zip: Uint8Array, withMedia = true): BackupContents {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, { filter: (f) => f.name === 'narratio.json' || (withMedia && f.name.startsWith('Medien/')) });
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
  const data = parseBackupData(parsed);
  const media = new Map<string, Uint8Array>();
  for (const m of data.media ?? []) {
    const bytes = files[mediaPath(m)];
    if (bytes) media.set(m.hash, bytes);
  }
  return { data, media };
}

export function backupFileName(project: Project, now = new Date()): string {
  const base = project.name.replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, '_').replace(/^_|_$/g, '') || 'narratio';
  const stamp = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  return `${base}_${stamp}.zip`;
}
