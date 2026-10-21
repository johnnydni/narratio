import type { Condition, Effect, Id, Item, ProjectSnapshot, WorldVar } from './types';
import { orderedVariants } from './variants';
import { extractLoreIds, replaceLoreTokens } from './refs';
import { validateProject, type Issue } from './validate';

/**
 * Exportformat für Unreal (EX-03). Bewusst flach und engine-neutral:
 * - Variablen und Lore werden über ihre Export-Schlüssel referenziert, nie über interne IDs.
 * - Bedingungen bleiben ein Ausdrucksbaum, den eine kleine Runtime in Unreal auswertet.
 * - Lore-Verweise im Text werden zu Platzhaltern {Lore:<ExportId>}, damit die Engine
 *   den aktuellen, ggf. lokalisierten Namen einsetzen kann.
 */
export const EXPORT_FORMAT_VERSION = 1;

export type ExportCondition =
  | { type: 'and' | 'or'; items: ExportCondition[] }
  | { type: 'not'; item: ExportCondition }
  | { type: 'compare'; var: string; op: string; value: boolean | number }
  | { type: 'dialogOutcome'; dialog: string; outcome: string };

export interface ExportResult {
  ok: boolean;
  issues: Issue[];
  data?: unknown;
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function dialogExportId(d: Item): string {
  return d.exportId || `Dialog.${slug(d.title)}`;
}

export function exportUnreal(p: ProjectSnapshot): ExportResult {
  const issues = validateProject(p);
  if (issues.some((i) => i.severity === 'error')) return { ok: false, issues };

  const varsById = new Map<Id, WorldVar>(p.worldVars.map((v) => [v.id, v]));
  const itemsById = new Map<Id, Item>(p.items.map((i) => [i.id, i]));
  const loreKey = (id: Id) => itemsById.get(id)?.exportId ?? id;
  const dialogKey = (id: Id) => {
    const d = itemsById.get(id);
    return d ? dialogExportId(d) : id;
  };

  const cond = (c: Condition | null): ExportCondition | null => {
    if (c === null) return null;
    switch (c.type) {
      case 'and':
      case 'or':
        return { type: c.type, items: c.items.map((x) => cond(x)!) };
      case 'not':
        return { type: 'not', item: cond(c.item)! };
      case 'compare':
        return { type: 'compare', var: varsById.get(c.varId)?.key ?? c.varId, op: c.op, value: c.value };
      case 'dialogOutcome':
        return { type: 'dialogOutcome', dialog: dialogKey(c.dialogId), outcome: c.outcome };
    }
  };
  const effect = (e: Effect) => ({ var: varsById.get(e.varId)?.key ?? e.varId, mode: e.mode, value: e.value });
  const text = (t: string) => replaceLoreTokens(t, (id) => `{Lore:${loreKey(id)}}`);

  const dialogs = p.items
    .filter((i) => i.type === 'dialog')
    .map((d) => {
      const g = p.dialogs[d.id] ?? { nodes: [], edges: [] };
      return {
        id: dialogExportId(d),
        title: d.title,
        start: g.nodes.find((n) => n.type === 'start')?.id ?? null,
        nodes: g.nodes.map((n) => {
          const next = g.edges.filter((e) => e.source === n.id && !e.sourceHandle).map((e) => e.target);
          const base = { id: n.id, type: n.type, next };
          switch (n.type) {
            case 'line':
              return {
                ...base,
                speaker: n.speakerId ? loreKey(n.speakerId) : null,
                variants: orderedVariants(n.variants ?? []).map((v) => ({
                  condition: cond(v.condition),
                  text: text(v.text),
                  direction: v.direction ?? '',
                  refs: extractLoreIds(v.text).map(loreKey),
                })),
              };
            case 'choice':
              return {
                ...base,
                options: (n.options ?? []).map((o) => ({
                  id: o.id,
                  text: text(o.text),
                  condition: cond(o.condition),
                  effects: o.effects.map(effect),
                  next: g.edges.filter((e) => e.source === n.id && e.sourceHandle === o.id).map((e) => e.target),
                })),
              };
            case 'effect':
              return { ...base, effects: (n.effects ?? []).map(effect) };
            case 'end':
              return { ...base, outcome: n.outcome ?? '' };
            case 'jump':
              return { ...base, target: n.targetDialogId ? dialogKey(n.targetDialogId) : null };
            default:
              return base;
          }
        }),
      };
    });

  const data = {
    format: 'narratio.unreal',
    version: EXPORT_FORMAT_VERSION,
    project: p.name,
    world: p.worldVars.map((v) => ({ key: v.key, label: v.label, kind: v.kind, default: v.defaultValue })),
    lore: p.items
      .filter((i) => i.type === 'lore')
      .map((l) => ({ id: l.exportId, kind: l.loreKind, name: l.title, fields: l.fields ?? {}, description: l.description ?? '' })),
    dialogs,
  };
  return { ok: true, issues, data };
}

/**
 * Lore als CSV für Unreal Data Tables (EX-05): erste Spalte "Name" ist der Zeilenschlüssel.
 */
export function loreToCsv(items: Item[], kind: Item['loreKind']): string {
  const rows = items.filter((i) => i.type === 'lore' && i.loreKind === kind);
  const fieldNames = [...new Set(rows.flatMap((r) => Object.keys(r.fields ?? {})))];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ['Name', 'DisplayName', ...fieldNames.map(slug), 'Description'];
  const lines = rows.map((r) =>
    [r.exportId ?? r.id, r.title, ...fieldNames.map((f) => r.fields?.[f] ?? ''), r.description ?? ''].map(esc).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
