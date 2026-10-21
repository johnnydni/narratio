import type { DialogNode, Variant } from './types';
import { evaluate, type EvalContext } from './conditions';

/** Varianten in Prüfreihenfolge: nach Priorität, Fallback (ohne Bedingung) immer zuletzt. */
export function orderedVariants(variants: Variant[]): Variant[] {
  return [...variants].sort((a, b) => {
    const fa = a.condition === null ? 1 : 0;
    const fb = b.condition === null ? 1 : 0;
    if (fa !== fb) return fa - fb;
    return a.priority - b.priority;
  });
}

/**
 * Wählt die Variante, die im gegebenen Weltzustand greift: die erste erfüllte in
 * Prüfreihenfolge. Gibt null zurück, wenn keine greift (dann fehlt ein Fallback).
 */
export function selectVariant(node: DialogNode, ctx: EvalContext): Variant | null {
  for (const v of orderedVariants(node.variants ?? [])) {
    if (evaluate(v.condition, ctx)) return v;
  }
  return null;
}
