import { VAR_KINDS, dialogOutcomeKey, valueTypeOf, type Profile, type VarKind, type WorldVar } from '../model/types';
import { collectVarIds } from '../model/conditions';
import { newId } from '../store/project';
import { useItems, useObserved, useProject, useWorld } from './state';
import type * as Y from 'yjs';
import { Icon } from './icons';

/** Weltzustand (VW-01) und Spielstand-Profile (VW-07) in einer Ansicht. */
export function WorldView() {
  const project = useProject();
  const items = useItems();
  const { vars, profiles } = useWorld();
  const lore = items.filter((i) => i.type === 'lore').sort((a, b) => a.title.localeCompare(b.title));
  const dialogs = items.filter((i) => i.type === 'dialog').sort((a, b) => a.title.localeCompare(b.title));

  // Verwendungsnachweis: wie oft wird jede Variable gelesen und gesetzt
  const usage = useObserved([project.dialogs as unknown as Y.AbstractType<unknown>], () => {
    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
    const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const d of project.listItems().filter((i) => i.type === 'dialog')) {
      for (const n of project.readGraph(d.id).nodes) {
        for (const v of n.variants ?? []) collectVarIds(v.condition).forEach((id) => inc(reads, id));
        for (const o of n.options ?? []) {
          collectVarIds(o.condition).forEach((id) => inc(reads, id));
          o.effects.forEach((e) => inc(writes, e.varId));
        }
        for (const e of n.effects ?? []) inc(writes, e.varId);
      }
    }
    return { reads, writes };
  });

  const put = (v: WorldVar, patch: Partial<WorldVar>) => project.putWorldVar({ ...v, ...patch });
  const putProfile = (p: Profile, patch: Partial<Profile>) => project.putProfile({ ...p, ...patch });

  const valueInput = (v: WorldVar, value: boolean | number | string | undefined, onChange: (x: boolean | number | undefined) => void, label: string, allowUnset = false) =>
    valueTypeOf(v.kind) === 'boolean' ? (
      <select className="select" aria-label={label} value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        {allowUnset && <option value="">Standard</option>}
        <option value="true">ja</option>
        <option value="false">nein</option>
      </select>
    ) : (
      <input className="input" type="number" aria-label={label} placeholder={allowUnset ? 'Standard' : ''} value={value === undefined ? '' : Number(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    );

  return (
    <div className="sheet">
      <div className="sheet-page">
        <div>
          <h1 className="h1">Weltzustand</h1>
          <p className="lead">Alle Zustände, auf die Dialoge reagieren: Questphasen, Perks, Skills, Inventar, Flags. Dialoge lesen sie in Bedingungen und ändern sie über Effekte. Der Schlüssel ist der Name, unter dem Unreal den Wert kennt.</p>
        </div>

        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Bezeichnung</th>
                <th style={{ minWidth: 220 }}>Export-Schlüssel</th>
                <th>Art</th>
                <th style={{ width: 110 }}>Standard</th>
                <th style={{ minWidth: 150 }}>Lore</th>
                <th>Gelesen</th>
                <th>Gesetzt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => (
                <tr key={v.id}>
                  <td><input className="input" aria-label="Bezeichnung" value={v.label} onChange={(e) => put(v, { label: e.target.value })} /></td>
                  <td><input className="input mono" aria-label="Export-Schlüssel" value={v.key} onChange={(e) => put(v, { key: e.target.value })} /></td>
                  <td>
                    <select className="select" aria-label="Art" value={v.kind} onChange={(e) => {
                      const kind = e.target.value as VarKind;
                      put(v, { kind, defaultValue: valueTypeOf(kind) === 'boolean' ? false : 0 });
                    }}>
                      {VAR_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </select>
                  </td>
                  <td>{valueInput(v, v.defaultValue, (x) => put(v, { defaultValue: x ?? (valueTypeOf(v.kind) === 'boolean' ? false : 0) }), 'Standardwert')}</td>
                  <td>
                    <select className="select" aria-label="Lore-Eintrag" value={v.loreId ?? ''} onChange={(e) => put(v, { loreId: e.target.value || undefined })}>
                      <option value="">–</option>
                      {lore.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                  </td>
                  <td className="muted">{usage.reads.get(v.id) ?? 0}×</td>
                  <td className="muted">{usage.writes.get(v.id) ?? 0}×</td>
                  <td>
                    <button type="button" className="icon-btn" aria-label={`${v.label} löschen`} onClick={() => project.deleteWorldVar(v.id)}><Icon name="trash" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => project.putWorldVar({ id: newId('v'), key: `Flag.Neu${vars.length + 1}`, label: 'Neue Variable', kind: 'flag', defaultValue: false })}>
          <Icon name="plus" size={13} /> Variable
        </button>

        <div style={{ marginTop: 18 }}>
          <h2 className="h1" style={{ fontSize: 22 }}>Spielstände für die Vorschau</h2>
          <p className="lead">Gespeicherte Weltzustände. Im Dialogeditor zeigt die Vorschau, welche Variante in welchem Spielstand greift und warum. Leere Felder nutzen den Standardwert.</p>
        </div>

        {profiles.length > 0 && (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>Variable</th>
                  {profiles.map((p) => (
                    <th key={p.id} style={{ minWidth: 170 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input className="input" style={{ fontWeight: 500 }} aria-label="Name des Spielstands" value={p.name} onChange={(e) => putProfile(p, { name: e.target.value })} />
                        <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`${p.name} löschen`} onClick={() => project.deleteProfile(p.id)}>×</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id}>
                    <td>{v.label}</td>
                    {profiles.map((p) => (
                      <td key={p.id}>
                        {valueInput(v, p.state[v.id], (x) => {
                          const state = { ...p.state };
                          if (x === undefined) delete state[v.id];
                          else state[v.id] = x;
                          putProfile(p, { state });
                        }, `${v.label} in ${p.name}`, true)}
                      </td>
                    ))}
                  </tr>
                ))}
                {dialogs.map((d) => {
                  const key = dialogOutcomeKey(d.id);
                  const outcomes = [...new Set(project.readGraph(d.id).nodes.filter((n) => n.type === 'end' && n.outcome).map((n) => n.outcome!))];
                  return (
                    <tr key={d.id}>
                      <td><span className="muted">Ergebnis:</span> {d.title}</td>
                      {profiles.map((p) => (
                        <td key={p.id}>
                          <select className="select" aria-label={`Ergebnis von ${d.title} in ${p.name}`} value={String(p.state[key] ?? '')} onChange={(e) => {
                            const state = { ...p.state };
                            if (e.target.value === '') delete state[key];
                            else state[key] = e.target.value;
                            putProfile(p, { state });
                          }}>
                            <option value="">Noch nicht geführt</option>
                            {outcomes.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => project.putProfile({ id: newId('p'), name: `Spielstand ${profiles.length + 1}`, state: {} })}>
          <Icon name="plus" size={13} /> Spielstand
        </button>
      </div>
    </div>
  );
}
