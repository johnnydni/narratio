import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Item, LoreKind } from '../model/types';
import type { IconDef } from './iconCatalog';
import { Icon } from './icons';
import { useLocalSetting } from './state';

type Catalog = { groups: typeof import('./iconCatalog').ICON_GROUPS; byName: Map<string, IconDef>; index: { d: IconDef; hay: string }[] };

/*
 * Der Katalog (gut 30 KB komprimiert) lädt getrennt vom Start-Paket, gleich beim Start und
 * verdeckt vom Startbildschirm. Bis er da ist, zeigen Einträge ihr allgemeines Icon.
 */
let catalog: Catalog | null = null;
const listeners = new Set<() => void>();
const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const loading: Promise<Catalog> = import('./iconCatalog').then(({ ICON_GROUPS }) => {
  const all = ICON_GROUPS.flatMap((g) => g.icons);
  catalog = { groups: ICON_GROUPS, byName: new Map(all.map((i) => [i.name, i])), index: all.map((d) => ({ d, hay: norm(`${d.words} ${d.name}`) })) };
  listeners.forEach((f) => f());
  return catalog;
});

export function loadIconCatalog(): Promise<Catalog> {
  return loading;
}

function useCatalog(): Catalog | null {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => catalog,
  );
}

/** Standard je Lore-Art; Szenen, Dialoge und Ordner behalten ihre eigenen Strich-Icons. */
export const LORE_DEFAULT_ICON: Record<LoreKind, string> = {
  character: 'UserRound',
  place: 'MapPin',
  item: 'Package',
  faction: 'Flag',
  quest: 'ScrollText',
  event: 'Zap',
  term: 'BookOpen',
};

const TYPE_ICON = { folder: 'folder', scene: 'scene', dialog: 'dialog', lore: 'lore' } as const;

/** Farben für Icons; die Werte stehen als --ic-<key> in styles.css, je für hell und dunkel. */
export const ITEM_COLORS: { key: string; label: string }[] = [
  { key: 'teal', label: 'Grün' },
  { key: 'blue', label: 'Blau' },
  { key: 'violet', label: 'Violett' },
  { key: 'rose', label: 'Rosa' },
  { key: 'red', label: 'Rot' },
  { key: 'amber', label: 'Bernstein' },
  { key: 'olive', label: 'Oliv' },
  { key: 'stone', label: 'Grau' },
];

function iconStyle(item: Pick<Item, 'iconColor'>): CSSProperties | undefined {
  return item.iconColor ? { color: `var(--ic-${item.iconColor})` } : undefined;
}

/** Das Icon eines Eintrags: gewählt, sonst Standard der Art. */
export function ItemIcon({ item, size = 14 }: { item: Pick<Item, 'type' | 'loreKind' | 'icon' | 'iconColor'>; size?: number }) {
  const cat = useCatalog();
  const kind = item.loreKind ?? 'term';
  const def = cat && ((item.icon && cat.byName.get(item.icon)) || (item.type === 'lore' ? cat.byName.get(LORE_DEFAULT_ICON[kind]) : undefined));
  const cls = `item-icon t-${item.type} ${item.type === 'lore' ? `k-${kind}` : ''}`;
  if (def) return <def.Icon className={cls} size={size} strokeWidth={1.75} style={iconStyle(item)} aria-hidden="true" />;
  return (
    <span className={cls} style={{ ...iconStyle(item), display: 'inline-flex' }}>
      <Icon name={TYPE_ICON[item.type]} size={size - 1} />
    </span>
  );
}

export function searchIcons(cat: Catalog, query: string): IconDef[] {
  const q = norm(query.trim());
  if (!q) return [];
  const parts = q.split(/\s+/);
  return cat.index.filter(({ hay }) => parts.every((p) => hay.includes(p)))
    .sort((a, b) => Number(!a.hay.startsWith(parts[0]!)) - Number(!b.hay.startsWith(parts[0]!)))
    .map(({ d }) => d);
}

const RECENT_MAX = 16;

/**
 * Auswahl aus der Icon-Bibliothek: Suche (deutsch oder englisch), zuletzt benutzte, Gruppen und
 * Farbe. Schwebt über allem, damit keine Leiste sie abschneidet.
 */
export function IconPicker({
  item,
  anchor,
  onChange,
  onClose,
}: {
  item: Pick<Item, 'type' | 'loreKind' | 'icon' | 'iconColor' | 'title'>;
  anchor: HTMLElement | null;
  onChange: (patch: { icon?: string; iconColor?: string }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useLocalSetting<string[]>('recent-icons', []);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });

  useLayoutEffect(() => {
    const place = () => {
      const box = boxRef.current;
      if (!anchor || !box) return;
      const r = anchor.getBoundingClientRect();
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const below = r.bottom + 6 + h < window.innerHeight - 8;
      setPos({
        position: 'fixed',
        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
        top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && !anchor?.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose, anchor]);

  const pick = (name: string | undefined) => {
    onChange({ icon: name, iconColor: item.iconColor });
    if (name) setRecent([name, ...recent.filter((r) => r !== name)].slice(0, RECENT_MAX));
    onClose();
  };

  const cat = useCatalog();
  const hits = useMemo(() => (cat ? searchIcons(cat, query) : []), [cat, query]);
  const recentDefs = cat ? recent.map((n) => cat.byName.get(n)).filter((d): d is IconDef => !!d) : [];
  const current = item.icon && cat?.byName.has(item.icon) ? item.icon : undefined;
  const colorStyle = iconStyle(item);

  const cell = (d: IconDef) => (
    <button
      key={d.name}
      type="button"
      className={`ip-cell ${current === d.name ? 'on' : ''}`}
      title={d.words.split(' ')[0]}
      aria-label={d.words.split(' ')[0]}
      aria-pressed={current === d.name}
      data-icon={d.name}
      onClick={() => pick(d.name)}
    >
      <d.Icon size={18} strokeWidth={1.75} style={colorStyle} />
    </button>
  );

  return createPortal(
    <div ref={boxRef} className="icon-picker" role="dialog" aria-label="Icon wählen" style={pos}>
      <div className="ip-head">
        <span className="ip-preview"><ItemIcon item={item} size={20} /></span>
        <input
          className="input"
          autoFocus
          placeholder="Suchen: Schwert, Burg, Trank …"
          aria-label="Icon suchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) pick(hits[0].name);
          }}
        />
      </div>
      <div className="ip-colors" role="radiogroup" aria-label="Farbe">
        <button type="button" role="radio" aria-checked={!item.iconColor} className={`ip-swatch auto ${!item.iconColor ? 'on' : ''}`} title="Farbe der Art" onClick={() => onChange({ icon: item.icon, iconColor: undefined })} />
        {ITEM_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={item.iconColor === c.key}
            aria-label={c.label}
            title={c.label}
            className={`ip-swatch ${item.iconColor === c.key ? 'on' : ''}`}
            style={{ background: `var(--ic-${c.key})` }}
            onClick={() => onChange({ icon: item.icon, iconColor: c.key })}
          />
        ))}
        <span className="spacer" />
        {(item.icon || item.iconColor) && (
          <button type="button" className="btn ghost small" onClick={() => { onChange({ icon: undefined, iconColor: undefined }); onClose(); }}>Standard</button>
        )}
      </div>
      <div className="ip-scroll">
        {!cat ? (
          <p className="muted small ip-empty">Lädt …</p>
        ) : query.trim() ? (
          hits.length ? <div className="ip-grid">{hits.map(cell)}</div> : <p className="muted small ip-empty">Nichts gefunden. Versuch es mit einem anderen Wort, auch englisch.</p>
        ) : (
          <>
            {recentDefs.length > 0 && (
              <section>
                <h3 className="ip-group">Zuletzt benutzt</h3>
                <div className="ip-grid">{recentDefs.map(cell)}</div>
              </section>
            )}
            {cat.groups.map((g) => (
              <section key={g.label}>
                <h3 className="ip-group">{g.label}</h3>
                <div className="ip-grid">{g.icons.map(cell)}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Knopf mit dem Icon eines Eintrags; öffnet die Auswahl. */
export function IconButton({ item, onChange, size = 18, small = false }: { item: Item; onChange: (patch: { icon?: string; iconColor?: string }) => void; size?: number; small?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className={`icon-choose ${small ? 'small' : ''}`} aria-label="Icon wählen" title="Icon wählen" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ItemIcon item={item} size={size} />
      </button>
      {open && <IconPicker item={item} anchor={ref.current} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}
