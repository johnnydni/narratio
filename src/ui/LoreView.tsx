import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { LORE_KINDS, type Item, type LoreKind } from '../model/types';
import { extractLoreIds } from '../model/refs';
import { useItems, useMedia, useNav, useObserved, useProject, useWorld } from './state';
import { MediaPicker, MediaThumb } from './mediaHooks';
import { Icon } from './icons';
import { IconButton } from './itemIcons';

interface Use {
  kind: string;
  title: string;
  detail: string;
  go: () => void;
}

function suggestExportId(kind: LoreKind | undefined, title: string): string {
  const prefix: Record<LoreKind, string> = { character: 'Char', place: 'Place', item: 'Item', faction: 'Faction', quest: 'Quest', event: 'Event', term: 'Term' };
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '');
  return `${prefix[kind ?? 'term']}.${slug || 'Neu'}`;
}

export function LoreView({ item }: { item: Item }) {
  const project = useProject();
  const items = useItems();
  const nav = useNav();
  const { vars } = useWorld();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picking, setPicking] = useState(false);
  const media = useMedia();
  const attached = (item.mediaIds ?? []).map((h) => media.find((m) => m.hash === h)).filter((m): m is NonNullable<typeof m> => !!m && !m.trashedAt);
  const dialogsVersion = useObserved([project.dialogs as unknown as Y.AbstractType<unknown>], () => Math.random());

  // Verwendungsnachweis (VW-06): Szenen, Dialoge, Variablen
  const uses = useMemo<Use[]>(() => {
    const out: Use[] = [];
    for (const s of items.filter((i) => i.type === 'scene')) {
      const n = project.sceneRefs(s.id).filter((r) => r === item.id).length;
      if (n) out.push({ kind: 'Szene', title: s.title, detail: `${n}× im Text verlinkt`, go: () => nav.go({ kind: 'item', id: s.id }) });
    }
    for (const d of items.filter((i) => i.type === 'dialog')) {
      const g = project.readGraph(d.id);
      let speaker = 0, text = 0;
      for (const n of g.nodes) {
        if (n.speakerId === item.id) speaker++;
        for (const v of n.variants ?? []) if (extractLoreIds(v.text).includes(item.id)) text++;
        for (const o of n.options ?? []) if (extractLoreIds(o.text).includes(item.id)) text++;
      }
      const parts = [speaker && `spricht ${speaker} Zeile${speaker > 1 ? 'n' : ''}`, text && `${text}× im Text erwähnt`].filter(Boolean);
      if (parts.length) out.push({ kind: 'Dialog', title: d.title, detail: parts.join(', '), go: () => nav.go({ kind: 'item', id: d.id }) });
    }
    for (const v of vars.filter((x) => x.loreId === item.id)) {
      out.push({ kind: 'Weltzustand', title: v.label, detail: v.key, go: () => nav.go({ kind: 'world' }) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, vars, item.id, dialogsVersion]);

  const fields = Object.entries(item.fields ?? {});
  const setFields = (entries: [string, string][]) => project.updateItem(item.id, { fields: Object.fromEntries(entries) });
  const dupExport = item.exportId && items.some((i) => i.id !== item.id && i.exportId === item.exportId);

  return (
    <div className="lore">
      <div className="lore-main">
        <div className="lore-page">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconButton item={item} onChange={(patch) => project.updateItem(item.id, patch)} size={20} />
              <select className="select" style={{ width: 'auto', minHeight: 28, padding: '2px 8px' }} aria-label="Art des Eintrags" value={item.loreKind ?? 'term'} onChange={(e) => project.updateItem(item.id, { loreKind: e.target.value as LoreKind })}>
                {LORE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <span className="spacer" />
              {confirmDelete ? (
                <>
                  <span className="small muted">{uses.length ? `Wird an ${uses.length} Stellen verwendet. Trotzdem löschen?` : 'Wirklich löschen?'}</span>
                  <button type="button" className="btn small danger" onClick={() => { project.deleteItem(item.id); nav.go({ kind: 'world' }); }}>Löschen</button>
                  <button type="button" className="btn small" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
                </>
              ) : (
                <button type="button" className="btn ghost small" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={13} /> Löschen</button>
              )}
            </div>
            <input
              key={item.id + item.title}
              className="lore-title"
              style={{ marginTop: 10 }}
              defaultValue={item.title}
              placeholder="Name"
              aria-label="Name"
              autoFocus={!item.title}
              onBlur={(e) => {
                const title = e.currentTarget.value.trim();
                if (title === item.title) return;
                project.updateItem(item.id, { title, ...(item.exportId ? {} : { exportId: suggestExportId(item.loreKind, title) }) });
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }} className="muted small">
              <span>Export-ID</span>
              <input
                key={item.id + (item.exportId ?? '')}
                className="input mono"
                style={{ width: 280, minHeight: 28, padding: '3px 8px' }}
                defaultValue={item.exportId ?? ''}
                placeholder={suggestExportId(item.loreKind, item.title)}
                aria-label="Export-ID"
                onBlur={(e) => project.updateItem(item.id, { exportId: e.currentTarget.value.trim() || undefined })}
              />
              {dupExport ? <span className="err-text">bereits vergeben</span> : <span>bleibt beim Umbenennen stabil</span>}
            </div>
          </div>

          <div className="field">
            <span className="label">Felder</span>
            <div className="fields">
              {fields.map(([k, v], i) => (
                <div key={i} className="field-row">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="key" aria-label="Feldname" defaultValue={k} key={`k${item.id}${i}${k}`} onBlur={(e) => setFields(fields.map(([fk, fv], j) => (j === i ? [e.currentTarget.value, fv] : [fk, fv])))} />
                    <button type="button" className="icon-btn" style={{ width: 20, height: 20, marginLeft: 'auto' }} aria-label={`Feld ${k} entfernen`} onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</button>
                  </div>
                  <input className="val" aria-label={k} defaultValue={v} key={`v${item.id}${i}${v}`} onBlur={(e) => e.currentTarget.value !== v && setFields(fields.map(([fk, fv], j) => (j === i ? [fk, e.currentTarget.value] : [fk, fv])))} />
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setFields([...fields, [`Feld ${fields.length + 1}`, '']])}>+ Feld</button>
          </div>

          <label className="field">
            <span className="label">Beschreibung</span>
            <textarea
              key={item.id}
              className="textarea serif-text"
              rows={5}
              defaultValue={item.description ?? ''}
              placeholder="Was sollte man über diesen Eintrag wissen?"
              onBlur={(e) => e.currentTarget.value !== (item.description ?? '') && project.updateItem(item.id, { description: e.currentTarget.value })}
            />
          </label>

          <div className="field">
            <span className="label">Bilder und Dokumente</span>
            <div className="lore-media" data-testid="lore-media">
              {attached.map((m) => (
                <figure key={m.hash} className="lore-media-item">
                  <MediaThumb meta={m} size="m" />
                  <figcaption className="small">
                    <span>{m.caption || m.name}</span>
                    <button type="button" className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`${m.name} lösen`} onClick={() => project.detachMedia(item.id, m.hash)}>×</button>
                  </figcaption>
                </figure>
              ))}
              <span style={{ position: 'relative', alignSelf: 'flex-start' }}>
                <button type="button" className="btn ghost small" onClick={() => setPicking(!picking)}>+ Medium zuordnen</button>
                {picking && <MediaPicker project={project} onClose={() => setPicking(false)} onPick={(hash) => project.attachMedia(item.id, hash)} />}
              </span>
            </div>
          </div>
        </div>
      </div>

      <aside className="uses" aria-label="Verwendung">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600 }}>Verwendet in</span>
          <span className="muted small">{uses.length} Stellen</span>
        </div>
        {uses.length === 0 && <span className="muted small">Noch nirgends. Verweise im Text mit @, in Dialogen über den Sprecher.</span>}
        {uses.map((u, i) => (
          <button key={i} type="button" className="use" onClick={u.go}>
            <span className="label">{u.kind}</span>
            <span style={{ fontWeight: 500 }}>{u.title}</span>
            <span className="muted small">{u.detail}</span>
          </button>
        ))}
        <div className="card">
          {item.exportId && !dupExport ? (
            <span className="ok-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="check" size={14} /> Bereit für Unreal</span>
          ) : (
            <span className="warn-text">Für den Export fehlt eine eindeutige Export-ID</span>
          )}
          <span className="muted small">Umbenennen ändert alle Verweise sofort, die Export-ID bleibt gleich.</span>
        </div>
      </aside>
    </div>
  );
}
