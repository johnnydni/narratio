/**
 * Das Datenmodell von narratio.
 *
 * Grundsatz: Alles ist ein Eintrag mit stabiler ID. Ein Dialog ist ein Eintrag, dessen Inhalt
 * ein Graph ist; ein Lore-Eintrag hat strukturierte Felder. Verweise laufen über IDs, nie über
 * Namen, damit Umbenennen nichts bricht (LR-04).
 *
 * Diese Typen sind reine Daten, unabhängig von Yjs. Die Sync-Schicht (src/store) bildet sie ab.
 */

export type Id = string;

export type ItemType = 'folder' | 'scene' | 'dialog' | 'lore';

export type LoreKind = 'character' | 'place' | 'item' | 'faction' | 'quest' | 'event' | 'term';

export const LORE_KINDS: { kind: LoreKind; label: string; plural: string }[] = [
  { kind: 'character', label: 'Figur', plural: 'Figuren' },
  { kind: 'place', label: 'Ort', plural: 'Orte' },
  { kind: 'item', label: 'Item', plural: 'Items' },
  { kind: 'faction', label: 'Fraktion', plural: 'Fraktionen' },
  { kind: 'quest', label: 'Quest', plural: 'Quests' },
  { kind: 'event', label: 'Ereignis', plural: 'Ereignisse' },
  { kind: 'term', label: 'Begriff', plural: 'Begriffe' },
];

export type Status = 'idea' | 'draft' | 'revised' | 'final';

export const STATUSES: { status: Status; label: string }[] = [
  { status: 'idea', label: 'Idee' },
  { status: 'draft', label: 'Entwurf' },
  { status: 'revised', label: 'Überarbeitet' },
  { status: 'final', label: 'Fertig' },
];

/** Ein Eintrag im Binder. Szenentext und Dialoggraph liegen getrennt (siehe store). */
export interface Item {
  id: Id;
  type: ItemType;
  title: string;
  parentId: Id | null;
  /** Sortierschlüssel unter Geschwistern. */
  order: number;
  status?: Status;
  synopsis?: string;
  /** Nur Lore. */
  loreKind?: LoreKind;
  /** Stabile, lesbare ID für den Engine-Export (LR-01), z. B. "Item.Waffe.Aschenklinge". */
  exportId?: string;
  /** Strukturierte Felder (LO-02), z. B. { Seltenheit: "Episch" }. */
  fields?: Record<string, string>;
  description?: string;
  /** Zugeordnete Medien (Hashes), z. B. Porträt einer Figur oder Konzeptbild einer Szene (ME-02). */
  mediaIds?: string[];
  /** Gewähltes Icon aus der Icon-Bibliothek (Lucide-Name, z. B. "Sword"); fehlt es, gilt das Standard-Icon. */
  icon?: string;
  /** Farbe des Icons, Schlüssel aus ITEM_COLORS; fehlt sie, gilt die Farbe der Art. */
  iconColor?: string;
}

/* ------------------------------------------------------------------ */
/* Weltzustand                                                          */
/* ------------------------------------------------------------------ */

/**
 * Art einer Zustandsvariable. Perks, Skills, Questphasen und Inventar sind fachlich
 * verschieden, technisch aber Zahlen oder Wahrheitswerte. Die Art steuert Editor und Export.
 */
export type VarKind = 'flag' | 'number' | 'questPhase' | 'perk' | 'skill' | 'inventory';

export const VAR_KINDS: { kind: VarKind; label: string; valueType: 'boolean' | 'number' }[] = [
  { kind: 'flag', label: 'Flag', valueType: 'boolean' },
  { kind: 'number', label: 'Zahl', valueType: 'number' },
  { kind: 'questPhase', label: 'Questphase', valueType: 'number' },
  { kind: 'perk', label: 'Perk', valueType: 'boolean' },
  { kind: 'skill', label: 'Skill', valueType: 'number' },
  { kind: 'inventory', label: 'Inventar', valueType: 'number' },
];

export function valueTypeOf(kind: VarKind): 'boolean' | 'number' {
  return VAR_KINDS.find((k) => k.kind === kind)?.valueType ?? 'number';
}

/** Eine Variable des Weltzustands (VW-01). */
export interface WorldVar {
  id: Id;
  /** Export-Schlüssel, z. B. "Quest.Salzspur.Phase". */
  key: string;
  label: string;
  kind: VarKind;
  defaultValue: boolean | number;
  /** Optional: verknüpfter Lore-Eintrag (Quest, Item, Figur). */
  loreId?: Id;
}

export type StateValue = boolean | number | string;

/** Ein konkreter Weltzustand: Variablen-ID → Wert; Dialogergebnisse unter "dialog:<id>". */
export type WorldState = Record<string, StateValue>;

export function dialogOutcomeKey(dialogId: Id): string {
  return `dialog:${dialogId}`;
}

/** Gespeicherter Spielstand für die Vorschau (VW-07). */
export interface Profile {
  id: Id;
  name: string;
  state: WorldState;
}

/* ------------------------------------------------------------------ */
/* Bedingungen als Ausdrucksbaum                                        */
/* ------------------------------------------------------------------ */

export type CompareOp = '==' | '!=' | '>=' | '<=' | '>' | '<';

/**
 * Bedingungen sind ein strukturierter Baum, kein Freitext (bewusste Grenze im Lastenheft):
 * nur so kann Unreal sie ohne Übersetzung auswerten und narratio sie prüfen.
 */
export type Condition =
  | { type: 'and'; items: Condition[] }
  | { type: 'or'; items: Condition[] }
  | { type: 'not'; item: Condition }
  | { type: 'compare'; varId: Id; op: CompareOp; value: boolean | number }
  | { type: 'dialogOutcome'; dialogId: Id; outcome: string };

/* ------------------------------------------------------------------ */
/* Dialoge                                                              */
/* ------------------------------------------------------------------ */

export interface Variant {
  id: Id;
  /** Kleinere Zahl = höhere Priorität. */
  priority: number;
  /** null = Fallback ("sonst"). Jede Zeile braucht genau einen Fallback (VW-02). */
  condition: Condition | null;
  text: string;
  /** Regieanweisung, Tonfall. */
  direction?: string;
  /** Verknüpfte Medien (Porträt, Audio). */
  mediaIds?: Id[];
}

export interface Effect {
  id: Id;
  varId: Id;
  /** set = Wert setzen, add = addieren (nur Zahlen). */
  mode: 'set' | 'add';
  value: boolean | number;
}

export interface ChoiceOption {
  id: Id;
  text: string;
  /** Option nur sichtbar, wenn erfüllt. */
  condition: Condition | null;
  effects: Effect[];
}

export type DialogNodeType = 'start' | 'line' | 'choice' | 'effect' | 'end' | 'jump';

export interface DialogNode {
  id: Id;
  type: DialogNodeType;
  x: number;
  y: number;
  /** line: sprechende Figur (Lore-ID). */
  speakerId?: Id;
  variants?: Variant[];
  options?: ChoiceOption[];
  effects?: Effect[];
  /** end: Ergebnis, das andere Dialoge abfragen können (VW-04). */
  outcome?: string;
  /** jump: Zieldialog. */
  targetDialogId?: Id;
  note?: string;
}

export interface DialogEdge {
  id: Id;
  source: Id;
  /** Bei Auswahl-Nodes: ID der Option, aus der die Kante kommt. */
  sourceHandle?: string | null;
  target: Id;
}

export interface DialogGraph {
  nodes: DialogNode[];
  edges: DialogEdge[];
}

/* ------------------------------------------------------------------ */
/* Medien                                                               */
/* ------------------------------------------------------------------ */

export type MediaKind = 'image' | 'pdf' | 'other';

/**
 * Ein Medium (ME-01, ME-02, ME-08). Die Datei selbst liegt nicht im Projekt-Dokument, sondern im
 * Blob-Speicher unter ihrem SHA-256-Hash; hier stehen nur Metadaten. Gleiche Datei = gleicher
 * Hash = ein Eintrag.
 */
export interface MediaMeta {
  /** SHA-256 des Originals, hex. Zugleich die ID. */
  hash: string;
  kind: MediaKind;
  /** Dateiname beim Import. */
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Mittlere Farbe als Platzhalter beim Laden, z. B. "#a89f8c". */
  color?: string;
  caption?: string;
  /** Herkunft: Quelle, Urheber, URL. */
  source?: string;
  addedAt: string;
  /** Gesetzt = im Papierkorb. */
  trashedAt?: string;
}

export function mediaKindOf(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

/** Der gesamte, aus dem Store gelesene Projektstand (für Prüfung und Export). */
export interface ProjectSnapshot {
  name: string;
  items: Item[];
  worldVars: WorldVar[];
  profiles: Profile[];
  dialogs: Record<Id, DialogGraph>;
  /** Lore-Verweise je Szene, aus dem Text extrahiert. */
  sceneRefs: Record<Id, Id[]>;
}
