import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LORE_KINDS, type Id, type Item } from '../model/types';
import { splitLoreTokens } from '../model/refs';
import { useItems, useNav } from './state';

export function kindLabel(item: Item | undefined): string {
  return LORE_KINDS.find((k) => k.kind === item?.loreKind)?.label ?? 'Lore';
}

/** Vorschaukarte eines Lore-Eintrags (beim Darüberfahren). */
export function HoverCard({ item, x, y }: { item: Item; x: number; y: number }) {
  const fields = Object.entries(item.fields ?? {}).slice(0, 4);
  const left = Math.min(x, window.innerWidth - 316);
  const top = y + 180 > window.innerHeight ? y - 190 : y + 14;
  return createPortal(
    <div className="hovercard" style={{ left, top }} role="tooltip">
      <div className="hc-head">
        <span className="hc-title">{item.title || 'Ohne Titel'}</span>
        <span className="muted small">{kindLabel(item)}</span>
      </div>
      {fields.length > 0 && (
        <div className="muted small" style={{ marginTop: 8, lineHeight: 1.5 }}>
          {fields.map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </div>
      )}
      {item.description && <div className="small" style={{ marginTop: 8, lineHeight: 1.5 }}>{item.description}</div>}
      {item.exportId && <div className="mono muted" style={{ marginTop: 8 }}>{item.exportId}</div>}
    </div>,
    document.body,
  );
}

/** Ein Verweis auf einen Lore-Eintrag: zeigt immer den aktuellen Namen, Klick öffnet den Eintrag. */
export function LoreRefChip({ id, items }: { id: Id; items: Item[] }) {
  const nav = useNav();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const item = items.find((i) => i.id === id);
  if (!item) return <span className="ref dead" title="Gelöschter Lore-Eintrag">gelöscht</span>;
  return (
    <>
      <span
        className={`ref k-${item.loreKind}`}
        role="link"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); nav.go({ kind: 'item', id }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') nav.go({ kind: 'item', id }); }}
        onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
      >
        {item.title || 'Ohne Titel'}
      </span>
      {hover && <HoverCard item={item} x={hover.x} y={hover.y} />}
    </>
  );
}

/** Text mit {{lore:id}}-Tokens, Verweise als Chips. */
export function RichText({ text, className }: { text: string; className?: string }): ReactNode {
  const items = useItems();
  return (
    <span className={className}>
      {splitLoreTokens(text).map((p, i) => (p.kind === 'text' ? <span key={i}>{p.text}</span> : <LoreRefChip key={i} id={p.id} items={items} />))}
    </span>
  );
}
