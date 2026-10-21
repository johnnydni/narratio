import type { CompareOp, Condition, Id, StateValue, WorldState, WorldVar } from './types';
import { dialogOutcomeKey } from './types';

/** Liefert den Wert einer Variable im Zustand, sonst ihren Standardwert. */
export function readVar(state: WorldState, v: WorldVar | undefined, varId: Id): StateValue | undefined {
  if (varId in state) return state[varId];
  return v?.defaultValue;
}

function compare(a: StateValue | undefined, op: CompareOp, b: boolean | number): boolean {
  if (a === undefined) return false;
  if (typeof b === 'boolean' || typeof a === 'boolean') {
    const av = Boolean(a);
    const bv = Boolean(b);
    if (op === '==') return av === bv;
    if (op === '!=') return av !== bv;
    return false;
  }
  const an = Number(a);
  switch (op) {
    case '==': return an === b;
    case '!=': return an !== b;
    case '>=': return an >= b;
    case '<=': return an <= b;
    case '>': return an > b;
    case '<': return an < b;
  }
}

export interface EvalContext {
  state: WorldState;
  vars: Map<Id, WorldVar>;
}

export function makeContext(state: WorldState, worldVars: WorldVar[]): EvalContext {
  return { state, vars: new Map(worldVars.map((v) => [v.id, v])) };
}

/** Wertet eine Bedingung aus. null (keine Bedingung) gilt immer als erfüllt. */
export function evaluate(cond: Condition | null, ctx: EvalContext): boolean {
  if (cond === null) return true;
  switch (cond.type) {
    case 'and': return cond.items.every((c) => evaluate(c, ctx));
    case 'or': return cond.items.some((c) => evaluate(c, ctx));
    case 'not': return !evaluate(cond.item, ctx);
    case 'compare': return compare(readVar(ctx.state, ctx.vars.get(cond.varId), cond.varId), cond.op, cond.value);
    case 'dialogOutcome': return ctx.state[dialogOutcomeKey(cond.dialogId)] === cond.outcome;
  }
}

/** Ein Prüfschritt für die Erklärung in der Vorschau ("✓ Salzspur steht auf Phase 3"). */
export interface ExplainLine {
  ok: boolean;
  text: string;
}

const OP_TEXT: Record<CompareOp, string> = {
  '==': 'ist', '!=': 'ist nicht', '>=': 'mindestens', '<=': 'höchstens', '>': 'größer als', '<': 'kleiner als',
};

function formatValue(v: StateValue | undefined): string {
  if (v === undefined) return 'nicht gesetzt';
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  return String(v);
}

/**
 * Erklärt eine Bedingung Zeile für Zeile. Für verschachtelte Ausdrücke werden die Blätter
 * aufgelistet; das reicht für die Vorschau und bleibt lesbar.
 */
export function explain(
  cond: Condition | null,
  ctx: EvalContext,
  names: { varLabel: (id: Id) => string; dialogLabel: (id: Id) => string },
): ExplainLine[] {
  if (cond === null) return [{ ok: true, text: 'Fallback: greift, wenn keine andere Variante zutrifft' }];
  switch (cond.type) {
    case 'and':
    case 'or':
      return cond.items.flatMap((c) => explain(c, ctx, names));
    case 'not':
      return explain(cond.item, ctx, names).map((l) => ({ ok: !l.ok, text: `nicht: ${l.text}` }));
    case 'compare': {
      const actual = readVar(ctx.state, ctx.vars.get(cond.varId), cond.varId);
      const ok = evaluate(cond, ctx);
      return [{
        ok,
        text: `${names.varLabel(cond.varId)} ${OP_TEXT[cond.op]} ${formatValue(cond.value)} (aktuell: ${formatValue(actual)})`,
      }];
    }
    case 'dialogOutcome': {
      const actual = ctx.state[dialogOutcomeKey(cond.dialogId)];
      return [{
        ok: actual === cond.outcome,
        text: `Dialog „${names.dialogLabel(cond.dialogId)}“ endete mit „${cond.outcome}“ (aktuell: ${formatValue(actual)})`,
      }];
    }
  }
}

/** Alle Variablen-IDs, die eine Bedingung liest (für Verwendungsnachweis VW-06). */
export function collectVarIds(cond: Condition | null, out: Set<Id> = new Set()): Set<Id> {
  if (cond === null) return out;
  switch (cond.type) {
    case 'and':
    case 'or':
      cond.items.forEach((c) => collectVarIds(c, out));
      break;
    case 'not':
      collectVarIds(cond.item, out);
      break;
    case 'compare':
      out.add(cond.varId);
      break;
    case 'dialogOutcome':
      break;
  }
  return out;
}

/** Alle Dialog-IDs, deren Ergebnis eine Bedingung abfragt. */
export function collectDialogIds(cond: Condition | null, out: Set<Id> = new Set()): Set<Id> {
  if (cond === null) return out;
  if (cond.type === 'and' || cond.type === 'or') cond.items.forEach((c) => collectDialogIds(c, out));
  else if (cond.type === 'not') collectDialogIds(cond.item, out);
  else if (cond.type === 'dialogOutcome') out.add(cond.dialogId);
  return out;
}
