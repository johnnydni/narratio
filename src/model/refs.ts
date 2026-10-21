import type { Id } from './types';

/**
 * Lore-Verweise in Dialogtexten werden als Token gespeichert: {{lore:<id>}}.
 * Die ID bleibt stabil, der angezeigte Name kommt immer aktuell aus der Lore (LR-04).
 */
export const LORE_TOKEN = /\{\{lore:([A-Za-z0-9_-]+)\}\}/g;

export function loreToken(id: Id): string {
  return `{{lore:${id}}}`;
}

export function extractLoreIds(text: string): Id[] {
  return [...text.matchAll(LORE_TOKEN)].map((m) => m[1]!);
}

/** Ersetzt Tokens durch einen Text, z. B. den aktuellen Namen oder einen Export-Platzhalter. */
export function replaceLoreTokens(text: string, render: (id: Id) => string): string {
  return text.replace(LORE_TOKEN, (_, id: string) => render(id));
}

/** Zerlegt Text in Abschnitte für die Darstellung mit hervorgehobenen Verweisen. */
export function splitLoreTokens(text: string): ({ kind: 'text'; text: string } | { kind: 'ref'; id: Id })[] {
  const parts: ({ kind: 'text'; text: string } | { kind: 'ref'; id: Id })[] = [];
  let last = 0;
  for (const m of text.matchAll(LORE_TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'ref', id: m[1]! });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}
