import { describe, expect, it } from 'vitest';
import type { DialogGraph, DialogNode, Item, ProjectSnapshot, WorldVar } from './types';
import { dialogOutcomeKey } from './types';
import { evaluate, explain, makeContext } from './conditions';
import { selectVariant } from './variants';
import { validateProject } from './validate';
import { exportUnreal, loreToCsv } from './exportUnreal';
import { extractLoreIds, loreToken, splitLoreTokens } from './refs';

const vars: WorldVar[] = [
  { id: 'v_phase', key: 'Quest.Salzspur.Phase', label: 'Salzspur: Phase', kind: 'questPhase', defaultValue: 0 },
  { id: 'v_guide', key: 'Perk.Fremdenfuehrer', label: 'Perk: Fremdenführer', kind: 'perk', defaultValue: false },
  { id: 'v_intim', key: 'Skill.Einschuechtern', label: 'Skill: Einschüchtern', kind: 'skill', defaultValue: 1 },
];

const ysa: Item = { id: 'd_ysa', type: 'dialog', title: 'Handel: Ysa', parentId: null, order: 1 };

const brannLine: DialogNode = {
  id: 'n_line',
  type: 'line',
  x: 0,
  y: 0,
  speakerId: 'l_brann',
  variants: [
    { id: 'va', priority: 1, condition: { type: 'compare', varId: 'v_guide', op: '==', value: true }, text: 'Zoll zahlen, dann geht durch.' },
    {
      id: 'vb',
      priority: 2,
      condition: {
        type: 'and',
        items: [
          { type: 'compare', varId: 'v_phase', op: '>=', value: 2 },
          { type: 'dialogOutcome', dialogId: 'd_ysa', outcome: 'Betrug aufgedeckt' },
        ],
      },
      text: 'Du schon wieder.',
    },
    { id: 'vc', priority: 3, condition: null, text: 'Was führt dich nach Aschenstadt?' },
  ],
};

describe('Bedingungen', () => {
  it('nutzt Standardwerte, wenn der Zustand eine Variable nicht kennt', () => {
    const ctx = makeContext({}, vars);
    expect(evaluate({ type: 'compare', varId: 'v_intim', op: '>=', value: 1 }, ctx)).toBe(true);
    expect(evaluate({ type: 'compare', varId: 'v_intim', op: '>=', value: 3 }, ctx)).toBe(false);
  });

  it('wertet und, oder und nicht korrekt aus', () => {
    const ctx = makeContext({ v_phase: 3, v_guide: false }, vars);
    const a = { type: 'compare', varId: 'v_phase', op: '>=', value: 2 } as const;
    const b = { type: 'compare', varId: 'v_guide', op: '==', value: true } as const;
    expect(evaluate({ type: 'and', items: [a, b] }, ctx)).toBe(false);
    expect(evaluate({ type: 'or', items: [a, b] }, ctx)).toBe(true);
    expect(evaluate({ type: 'not', item: b }, ctx)).toBe(true);
  });

  it('erkennt das Ergebnis eines anderen Dialogs', () => {
    const ctx = makeContext({ [dialogOutcomeKey('d_ysa')]: 'Betrug aufgedeckt' }, vars);
    expect(evaluate({ type: 'dialogOutcome', dialogId: 'd_ysa', outcome: 'Betrug aufgedeckt' }, ctx)).toBe(true);
    expect(evaluate({ type: 'dialogOutcome', dialogId: 'd_ysa', outcome: 'Handel abgeschlossen' }, ctx)).toBe(false);
  });

  it('erklärt jede Teilbedingung mit dem aktuellen Wert', () => {
    const ctx = makeContext({ v_phase: 3 }, vars);
    const lines = explain(brannLine.variants![1]!.condition, ctx, {
      varLabel: (id) => vars.find((v) => v.id === id)!.label,
      dialogLabel: () => 'Handel: Ysa',
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ ok: true, text: 'Salzspur: Phase mindestens 2 (aktuell: 3)' });
    expect(lines[1]!.ok).toBe(false);
  });
});

describe('Variantenauswahl', () => {
  it('wählt die Variante mit höchster Priorität, die zutrifft', () => {
    expect(selectVariant(brannLine, makeContext({ v_guide: true, v_phase: 3 }, vars))?.id).toBe('va');
  });

  it('berücksichtigt Questphase und Ereignisse aus anderen Dialogen', () => {
    const state = { v_phase: 3, [dialogOutcomeKey('d_ysa')]: 'Betrug aufgedeckt' };
    expect(selectVariant(brannLine, makeContext(state, vars))?.id).toBe('vb');
  });

  it('fällt auf den Fallback zurück, auch wenn dieser eine hohe Prioritätszahl hat', () => {
    expect(selectVariant(brannLine, makeContext({}, vars))?.id).toBe('vc');
    const fallbackFirst: DialogNode = {
      ...brannLine,
      variants: brannLine.variants!.map((v) => (v.condition === null ? { ...v, priority: 0 } : v)),
    };
    expect(selectVariant(fallbackFirst, makeContext({ v_guide: true }, vars))?.id).toBe('va');
  });

  it('liefert null, wenn kein Fallback existiert und nichts zutrifft', () => {
    const noFallback: DialogNode = { ...brannLine, variants: brannLine.variants!.slice(0, 2) };
    expect(selectVariant(noFallback, makeContext({}, vars))).toBeNull();
  });
});

describe('Lore-Verweise im Text', () => {
  it('findet und zerlegt Tokens', () => {
    const t = `Die ${loreToken('l_blade')} trägt man hier nicht offen, ${loreToken('l_mara')}.`;
    expect(extractLoreIds(t)).toEqual(['l_blade', 'l_mara']);
    expect(splitLoreTokens(t).map((p) => p.kind)).toEqual(['text', 'ref', 'text', 'ref', 'text']);
  });
});

function project(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  const graph: DialogGraph = {
    nodes: [
      { id: 'n_start', type: 'start', x: 0, y: 0 },
      { ...brannLine, variants: [...brannLine.variants!, { id: 'vd', priority: 4, condition: { type: 'compare', varId: 'v_intim', op: '>=', value: 3 }, text: `Die ${loreToken('l_blade')}.` }] },
      { id: 'n_end', type: 'end', x: 0, y: 0, outcome: 'Durchgelassen' },
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_line' },
      { id: 'e2', source: 'n_line', target: 'n_end' },
    ],
  };
  return {
    name: 'Aschenstadt',
    items: [
      { id: 'l_brann', type: 'lore', loreKind: 'character', title: 'Brann', exportId: 'Char.Brann', parentId: null, order: 0 },
      { id: 'l_blade', type: 'lore', loreKind: 'item', title: 'Aschenklinge', exportId: 'Item.Waffe.Aschenklinge', parentId: null, order: 1, fields: { Seltenheit: 'Episch', Wert: '1.250' } },
      { id: 'd_tor', type: 'dialog', title: 'Torverhör: Brann', parentId: null, order: 0 },
      ysa,
    ],
    worldVars: vars,
    profiles: [],
    dialogs: { d_tor: graph, d_ysa: { nodes: [{ id: 's', type: 'start', x: 0, y: 0 }, { id: 'e', type: 'end', x: 0, y: 0 }], edges: [{ id: 'x', source: 's', target: 'e' }] } },
    sceneRefs: { scene1: ['l_blade'] },
    ...overrides,
  };
}

describe('Projektprüfung', () => {
  it('meldet für ein sauberes Projekt keine Fehler', () => {
    expect(validateProject(project()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('erkennt fehlenden Fallback, tote Verweise und unbekannte Variablen', () => {
    const p = project();
    const g = p.dialogs.d_tor!;
    const line = g.nodes[1]!;
    line.variants = line.variants!.filter((v) => v.condition !== null);
    line.variants.push({ id: 'vx', priority: 9, condition: { type: 'compare', varId: 'v_unknown', op: '==', value: 1 }, text: loreToken('l_deleted') });
    const msgs = validateProject(p).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(msgs).toContain('Zeile ohne Fallback-Variante: in manchen Spielständen bleibt sie stumm');
    expect(msgs).toContain('Zeile: Bedingung nutzt eine unbekannte Variable');
    expect(msgs).toContain('Text verweist auf einen gelöschten Lore-Eintrag');
  });

  it('erkennt doppelte Export-IDs und unerreichbare Nodes', () => {
    const p = project();
    p.items[1] = { ...p.items[1]!, exportId: 'Char.Brann' };
    p.dialogs.d_tor!.nodes.push({ id: 'orphan', type: 'end', x: 0, y: 0 });
    const issues = validateProject(p);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('doppelt'))).toBe(true);
    expect(issues.some((i) => i.nodeId === 'orphan' && i.message.includes('nicht erreichbar'))).toBe(true);
  });
});

describe('Unreal-Export', () => {
  it('exportiert Bedingungen als Baum mit Export-Schlüsseln und Platzhaltern', () => {
    const r = exportUnreal(project());
    expect(r.ok).toBe(true);
    const data = r.data as { dialogs: { id: string; nodes: { type: string; variants?: { condition: unknown; text: string; refs: string[] }[] }[] }[] };
    const tor = data.dialogs.find((d) => d.id === 'Dialog.Torverhoer_Brann' || d.id.startsWith('Dialog.Torverh'))!;
    const line = tor.nodes.find((n) => n.type === 'line')!;
    expect(line.variants![1]!.condition).toEqual({
      type: 'and',
      items: [
        { type: 'compare', var: 'Quest.Salzspur.Phase', op: '>=', value: 2 },
        { type: 'dialogOutcome', dialog: 'Dialog.Handel_Ysa', outcome: 'Betrug aufgedeckt' },
      ],
    });
    // Fallback steht im Export immer zuletzt
    expect(line.variants!.at(-1)!.condition).toBeNull();
    const withRef = line.variants!.find((v) => v.refs.length > 0)!;
    expect(withRef.text).toBe('Die {Lore:Item.Waffe.Aschenklinge}.');
  });

  it('verweigert den Export bei Fehlern', () => {
    const p = project();
    p.items = p.items.filter((i) => i.id !== 'l_brann');
    const r = exportUnreal(p);
    expect(r.ok).toBe(false);
    expect(r.data).toBeUndefined();
  });

  it('erzeugt CSV für Data Tables mit Feldern als Spalten', () => {
    const csv = loreToCsv(project().items, 'item');
    expect(csv.split('\n')[0]).toBe('Name,DisplayName,Seltenheit,Wert,Description');
    expect(csv.split('\n')[1]).toBe('Item.Waffe.Aschenklinge,Aschenklinge,Episch,1.250,');
  });
});
