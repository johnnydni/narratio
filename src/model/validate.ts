import type { Condition, DialogGraph, Id, Item, ProjectSnapshot } from './types';
import { collectDialogIds, collectVarIds } from './conditions';
import { extractLoreIds } from './refs';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  message: string;
  /** Wo das Problem liegt, für die Navigation. */
  itemId?: Id;
  nodeId?: Id;
}

function checkCondition(
  cond: Condition | null,
  ctx: { varIds: Set<Id>; dialogIds: Set<Id> },
  where: string,
  push: (sev: Severity, msg: string) => void,
) {
  for (const v of collectVarIds(cond)) {
    if (!ctx.varIds.has(v)) push('error', `${where}: Bedingung nutzt eine unbekannte Variable`);
  }
  for (const d of collectDialogIds(cond)) {
    if (!ctx.dialogIds.has(d)) push('error', `${where}: Bedingung verweist auf einen gelöschten Dialog`);
  }
}

/** Prüft einen Dialoggraphen (DL-07, VW-09, LR-06). */
export function validateDialog(
  dialog: Item,
  graph: DialogGraph,
  project: { loreIds: Set<Id>; characterIds: Set<Id>; varIds: Set<Id>; dialogIds: Set<Id> },
): Issue[] {
  const issues: Issue[] = [];
  const push = (severity: Severity, message: string, nodeId?: Id) =>
    issues.push({ severity, message, itemId: dialog.id, nodeId });
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const starts = graph.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) push('error', 'Kein Start-Node');
  if (starts.length > 1) push('warning', 'Mehr als ein Start-Node');

  for (const e of graph.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) push('error', 'Verbindung zu einem gelöschten Node');
  }

  const outgoing = new Map<Id, string[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e.sourceHandle ?? '');
    outgoing.set(e.source, list);
  }

  for (const n of graph.nodes) {
    const where = n.type === 'line' ? 'Zeile' : n.type === 'choice' ? 'Auswahl' : 'Node';
    const p = (sev: Severity, msg: string) => push(sev, msg, n.id);

    if (n.type === 'line') {
      const variants = n.variants ?? [];
      const fallbacks = variants.filter((v) => v.condition === null);
      if (variants.length === 0) p('error', 'Zeile ohne Text');
      if (fallbacks.length === 0) p('error', 'Zeile ohne Fallback-Variante: in manchen Spielständen bleibt sie stumm');
      if (fallbacks.length > 1) p('warning', 'Mehr als eine Fallback-Variante; nur die erste wird je greifen');
      if (!n.speakerId) p('warning', 'Zeile ohne Sprecher');
      else if (!project.characterIds.has(n.speakerId)) p('error', 'Sprecher wurde in der Lore gelöscht');
      for (const v of variants) {
        if (!v.text.trim()) p('warning', 'Variante ohne Text');
        checkCondition(v.condition, project, where, p);
        for (const id of extractLoreIds(v.text)) {
          if (!project.loreIds.has(id)) p('error', 'Text verweist auf einen gelöschten Lore-Eintrag');
        }
      }
      if (variants.length > 8) p('warning', `${variants.length} Varianten in einer Zeile: schwer zu überblicken`);
    }

    if (n.type === 'choice') {
      const opts = n.options ?? [];
      if (opts.length === 0) p('error', 'Auswahl ohne Optionen');
      const handles = new Set(outgoing.get(n.id) ?? []);
      for (const o of opts) {
        if (!handles.has(o.id)) p('warning', `Option „${o.text || 'ohne Text'}“ führt nirgendwohin`);
        checkCondition(o.condition, project, where, p);
        for (const ef of o.effects) if (!project.varIds.has(ef.varId)) p('error', 'Effekt setzt eine unbekannte Variable');
        for (const id of extractLoreIds(o.text)) {
          if (!project.loreIds.has(id)) p('error', 'Option verweist auf einen gelöschten Lore-Eintrag');
        }
      }
    }

    if (n.type === 'effect') {
      for (const ef of n.effects ?? []) if (!project.varIds.has(ef.varId)) p('error', 'Effekt setzt eine unbekannte Variable');
    }

    if (n.type === 'jump' && (!n.targetDialogId || !project.dialogIds.has(n.targetDialogId))) {
      p('error', 'Sprung ohne gültigen Zieldialog');
    }

    if (n.type !== 'end' && n.type !== 'jump' && n.type !== 'choice' && !outgoing.has(n.id)) {
      p('warning', 'Sackgasse: Node hat keinen Ausgang');
    }
  }

  // Erreichbarkeit vom Start
  if (starts.length > 0) {
    const seen = new Set<Id>();
    const queue = starts.map((s) => s.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of graph.edges) if (e.source === id) queue.push(e.target);
    }
    for (const n of graph.nodes) {
      if (!seen.has(n.id)) push('warning', 'Node ist vom Start aus nicht erreichbar', n.id);
    }
  }

  return issues;
}

/** Prüft das ganze Projekt vor dem Export. Fehler blockieren den Export (LR-06). */
export function validateProject(p: ProjectSnapshot): Issue[] {
  const issues: Issue[] = [];
  const lore = p.items.filter((i) => i.type === 'lore');
  const loreIds = new Set(lore.map((i) => i.id));
  const characterIds = new Set(lore.filter((i) => i.loreKind === 'character').map((i) => i.id));
  const dialogs = p.items.filter((i) => i.type === 'dialog');
  const dialogIds = new Set(dialogs.map((d) => d.id));
  const varIds = new Set(p.worldVars.map((v) => v.id));

  const exportIds = new Map<string, Id>();
  for (const l of lore) {
    if (!l.exportId) {
      issues.push({ severity: 'warning', message: `„${l.title}“ hat keine Export-ID`, itemId: l.id });
    } else if (exportIds.has(l.exportId)) {
      issues.push({ severity: 'error', message: `Export-ID „${l.exportId}“ ist doppelt vergeben`, itemId: l.id });
    } else {
      exportIds.set(l.exportId, l.id);
    }
  }

  const keys = new Set<string>();
  for (const v of p.worldVars) {
    if (!v.key.trim()) issues.push({ severity: 'error', message: `Variable „${v.label}“ hat keinen Export-Schlüssel` });
    else if (keys.has(v.key)) issues.push({ severity: 'error', message: `Variablen-Schlüssel „${v.key}“ ist doppelt` });
    keys.add(v.key);
  }

  for (const [sceneId, refs] of Object.entries(p.sceneRefs)) {
    for (const r of refs) {
      if (!loreIds.has(r)) issues.push({ severity: 'error', message: 'Szene verweist auf einen gelöschten Lore-Eintrag', itemId: sceneId });
    }
  }

  for (const d of dialogs) {
    const graph = p.dialogs[d.id] ?? { nodes: [], edges: [] };
    issues.push(...validateDialog(d, graph, { loreIds, characterIds, varIds, dialogIds }));
  }

  return issues;
}
