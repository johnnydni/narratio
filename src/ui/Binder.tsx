import { useMemo, useState, type DragEvent } from 'react';
import { LORE_KINDS, STATUSES, type Id, type Item, type ItemType, type LoreKind } from '../model/types';
import { useItems, useLocalSetting, useNav, useProject } from './state';
import { Icon } from './icons';
import { newId } from '../store/project';

const TYPE_ICON: Record<ItemType, string> = { folder: 'folder', scene: 'scene', dialog: 'dialog', lore: 'lore' };

export function Binder() {
  const project = useProject();
  const items = useItems();
  const nav = useNav();
  const [collapsed, setCollapsed] = useLocalSetting<Record<Id, boolean>>('collapsed', {});
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [dragId, setDragId] = useState<Id | null>(null);
  const [dropId, setDropId] = useState<Id | null>(null);

  const activeId = nav.view.kind === 'item' ? nav.view.id : null;

  const { childrenOf, lore } = useMemo(() => {
    const map = new Map<Id | null, Item[]>();
    const loreByKind = new Map<LoreKind, Item[]>();
    for (const i of items) {
      if (i.type === 'lore') {
        const k = i.loreKind ?? 'term';
        loreByKind.set(k, [...(loreByKind.get(k) ?? []), i]);
        continue;
      }
      map.set(i.parentId, [...(map.get(i.parentId) ?? []), i]);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    for (const list of loreByKind.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return { childrenOf: map, lore: loreByKind };
  }, [items]);

  /** Neuer Eintrag in den Ordner des aktuell gewählten Eintrags. */
  const targetFolder = (): Id | null => {
    const active = items.find((i) => i.id === activeId);
    if (!active || active.type === 'lore') return null;
    return active.type === 'folder' ? active.id : active.parentId;
  };

  const create = (type: ItemType, init: Partial<Item> = {}) => {
    const titles: Record<ItemType, string> = { scene: 'Neue Szene', dialog: 'Neuer Dialog', folder: 'Neuer Ordner', lore: 'Neuer Eintrag' };
    const id = project.createItem(type, { title: titles[type], parentId: type === 'lore' ? null : targetFolder(), ...init });
    if (type === 'dialog') project.putNode(id, { id: newId('n'), type: 'start', x: 0, y: 120 });
    nav.go({ kind: 'item', id });
    if (type !== 'lore') setRenaming(id);
  };

  const onDrop = (e: DragEvent, target: Item) => {
    e.preventDefault();
    setDropId(null);
    const id = dragId;
    setDragId(null);
    if (!id || id === target.id) return;
    // Nicht in eigene Unterordner verschieben
    let p: Id | null = target.id;
    while (p) {
      if (p === id) return;
      p = items.find((i) => i.id === p)?.parentId ?? null;
    }
    if (target.type === 'folder' && !e.shiftKey) {
      const kids = childrenOf.get(target.id) ?? [];
      project.moveItem(id, target.id, kids.length ? kids[kids.length - 1]!.order + 1 : 0);
      setCollapsed({ ...collapsed, [target.id]: false });
    } else {
      const sibs = (childrenOf.get(target.parentId) ?? []).filter((s) => s.id !== id);
      const idx = sibs.findIndex((s) => s.id === target.id);
      const next = sibs[idx + 1];
      const order = next ? (target.order + next.order) / 2 : target.order + 1;
      project.moveItem(id, target.parentId, order);
    }
  };

  const renderRow = (item: Item, depth: number) => {
    const kids = childrenOf.get(item.id) ?? [];
    const isFolder = item.type === 'folder';
    const open = !collapsed[item.id];
    return (
      <div key={item.id}>
        {renaming === item.id ? (
          <input
            className="input"
            style={{ height: 28, marginLeft: 8 + depth * 14, width: `calc(100% - ${8 + depth * 14}px)` }}
            autoFocus
            defaultValue={item.title}
            aria-label="Titel"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => { project.updateItem(item.id, { title: e.currentTarget.value.trim() || item.title }); setRenaming(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            className={`row ${activeId === item.id ? 'active' : ''} ${dropId === item.id ? 'drop-target' : ''}`}
            style={{ paddingLeft: 4 + depth * 14 }}
            draggable
            onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId && dragId !== item.id) { e.preventDefault(); setDropId(item.id); } }}
            onDragLeave={() => setDropId((d) => (d === item.id ? null : d))}
            onDrop={(e) => onDrop(e, item)}
            onDragEnd={() => { setDragId(null); setDropId(null); }}
            onClick={() => {
              if (isFolder && activeId === item.id) setCollapsed({ ...collapsed, [item.id]: open });
              nav.go({ kind: 'item', id: item.id });
            }}
            onDoubleClick={() => setRenaming(item.id)}
            title="Doppelklick zum Umbenennen, ziehen zum Verschieben"
          >
            <span
              className="twisty"
              onClick={(e) => { if (isFolder) { e.stopPropagation(); setCollapsed({ ...collapsed, [item.id]: open }); } }}
            >
              {isFolder ? (open ? '▾' : '▸') : <Icon name={TYPE_ICON[item.type]} size={13} />}
            </span>
            <span className={`title ${item.title ? '' : 'empty'}`}>{item.title || 'Ohne Titel'}</span>
            {item.status && item.type !== 'folder' && <span className={`status-dot st-${item.status}`} title={STATUSES.find((s) => s.status === item.status)?.label} />}
          </button>
        )}
        {isFolder && open && kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <nav className="binder" aria-label="Projektstruktur">
      <div className="binder-scroll">
        <div className="binder-section">
          {(childrenOf.get(null) ?? []).map((i) => renderRow(i, 0))}
        </div>

        <div className="binder-section">
          <div className="binder-head">
            <span className="label">Lore</span>
          </div>
          {LORE_KINDS.map(({ kind, plural }) => {
            const list = lore.get(kind) ?? [];
            const key = `lore:${kind}`;
            const open = !collapsed[key];
            return (
              <div key={kind}>
                <div className="row" style={{ paddingLeft: 4 }}>
                  <button type="button" className="row" style={{ flex: 1, padding: 0 }} onClick={() => setCollapsed({ ...collapsed, [key]: open })} aria-expanded={open}>
                    <span className="twisty">{open ? '▾' : '▸'}</span>
                    <span className="title">{plural}</span>
                    <span className="count">{list.length}</span>
                  </button>
                  <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`${plural}: neuer Eintrag`} onClick={() => create('lore', { loreKind: kind, title: '' })}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                {open && list.map((l) => (
                  <button key={l.id} type="button" className={`row ${activeId === l.id ? 'active' : ''}`} style={{ paddingLeft: 32 }} onClick={() => nav.go({ kind: 'item', id: l.id })}>
                    <span className={`kind-dot k-${kind}`} />
                    <span className={`title ${l.title ? '' : 'empty'}`}>{l.title || 'Ohne Titel'}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="binder-section">
          <button type="button" className={`row ${nav.view.kind === 'world' ? 'active' : ''}`} style={{ paddingLeft: 4 }} onClick={() => nav.go({ kind: 'world' })}>
            <span className="twisty"><Icon name="world" size={13} /></span>
            <span className="title">Weltzustand</span>
          </button>
          <button type="button" className={`row ${nav.view.kind === 'media' ? 'active' : ''}`} style={{ paddingLeft: 4 }} onClick={() => nav.go({ kind: 'media' })}>
            <span className="twisty"><Icon name="image" size={13} /></span>
            <span className="title">Medien</span>
          </button>
          <button type="button" className={`row ${nav.view.kind === 'export' ? 'active' : ''}`} style={{ paddingLeft: 4 }} onClick={() => nav.go({ kind: 'export' })}>
            <span className="twisty"><Icon name="export" size={13} /></span>
            <span className="title">Prüfen und exportieren</span>
          </button>
        </div>
      </div>
      <div className="binder-foot">
        <button type="button" className="btn ghost small" onClick={() => create('scene', { status: 'idea' })}><Icon name="plus" size={13} /> Szene</button>
        <button type="button" className="btn ghost small" onClick={() => create('dialog', { status: 'idea' })}><Icon name="plus" size={13} /> Dialog</button>
        <button type="button" className="btn ghost small" onClick={() => create('folder')}><Icon name="plus" size={13} /> Ordner</button>
      </div>
    </nav>
  );
}
