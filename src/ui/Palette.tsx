import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LORE_KINDS, type Id, type Item } from '../model/types';
import { useItems, useNav } from './state';
import { Icon } from './icons';
import { TYPE_ICON } from './Binder';
import { usePresence } from './motion';

/** Ein Eintrag der Schnellsuche: Sprungziel oder Befehl. */
export interface Command {
  id: string;
  title: string;
  hint?: string;
  icon: string;
  group: string;
  keywords?: string;
  run: () => void;
}

/** Klein, ohne Akzente: „Zöllner“ findet man auch mit „zollner“. */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
}

/** Treffer-Güte: Anfang > Wortanfang > irgendwo > verstreute Buchstaben. -1 = kein Treffer. */
export function matchScore(text: string, query: string): number {
  if (!query) return 0;
  const t = fold(text);
  const q = fold(query);
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return /[\s\-_/.:]/.test(t[i - 1]!) ? 80 : 60 - Math.min(i, 30);
  let pos = 0;
  for (const ch of q) {
    pos = t.indexOf(ch, pos);
    if (pos < 0) return -1;
    pos++;
  }
  return 20;
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const i = fold(text).indexOf(fold(query));
  // fold() kann die Länge verändern (ß → ss); dann lieber ohne Hervorhebung.
  if (i < 0 || fold(text).length !== text.length) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function pathOf(byId: Map<Id, Item>, item: Item): string {
  const parts: string[] = [];
  let cur = item.parentId ? byId.get(item.parentId) : undefined;
  while (cur) {
    parts.unshift(cur.title || 'Ohne Titel');
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(' / ');
}


/**
 * Schnellsuche (Strg/Cmd+K): zu jeder Szene, jedem Dialog und Lore-Eintrag springen und
 * häufige Befehle ausführen, ohne die Hände von der Tastatur zu nehmen.
 */
export function Palette(props: { open: boolean; onClose: () => void; commands: Command[]; recent: Id[] }) {
  const { mounted, state } = usePresence(props.open, 150);
  // Der Inhalt wird bei jedem Öffnen neu aufgebaut: leeres Suchfeld, erste Zeile gewählt.
  return mounted ? <PaletteBody {...props} state={state} /> : null;
}

function PaletteBody({ onClose, commands, recent, state }: { onClose: () => void; commands: Command[]; recent: Id[]; state: 'open' | 'closing' }) {
  const items = useItems();
  const nav = useNav();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const jumps: Command[] = items.map((i) => ({
      id: i.id,
      title: i.title || 'Ohne Titel',
      hint: i.type === 'lore' ? LORE_KINDS.find((k) => k.kind === (i.loreKind ?? 'term'))?.label : pathOf(byId, i) || undefined,
      icon: TYPE_ICON[i.type],
      group: 'Springen zu',
      run: () => nav.go({ kind: 'item', id: i.id }),
    }));
    if (!query.trim()) {
      const rec = recent.map((id) => jumps.find((j) => j.id === id)).filter((j): j is Command => !!j).slice(0, 6).map((j) => ({ ...j, group: 'Zuletzt geöffnet' }));
      return [...rec, ...commands];
    }
    const q = query.trim();
    return [...jumps, ...commands]
      .map((c) => ({ c, s: Math.max(matchScore(c.title, q), c.keywords ? matchScore(c.keywords, q) - 10 : -1) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.c.title.localeCompare(b.c.title))
      .slice(0, 40)
      .map((x) => x.c);
  }, [items, commands, recent, query, nav]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <div className="palette-backdrop" data-state={state} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Schnellsuche">
        <input
          className="palette-input"
          autoFocus
          placeholder="Szene, Dialog, Lore oder Befehl …"
          aria-label="Suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(results[sel]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="palette-empty">Nichts gefunden.</div>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="palette-group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={`${c.group}:${c.id}`}>
                {head}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  className={`palette-item ${i === sel ? 'sel' : ''}`}
                  onMouseMove={() => sel !== i && setSel(i)}
                  onClick={() => run(c)}
                >
                  <span className="pi-icon"><Icon name={c.icon} size={14} /></span>
                  <span className="pi-title">{highlight(c.title, query.trim())}</span>
                  {c.hint && <span className="pi-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> wählen</span>
          <span><kbd>Enter</kbd> öffnen</span>
          <span><kbd>Esc</kbd> schließen</span>
        </div>
      </div>
    </div>
  );
}
