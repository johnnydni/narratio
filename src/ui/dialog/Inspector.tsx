import type { ChoiceOption, DialogNode, Effect, Id, Item, Profile, Variant, WorldVar } from '../../model/types';
import { valueTypeOf } from '../../model/types';
import { explain, makeContext } from '../../model/conditions';
import { orderedVariants, selectVariant } from '../../model/variants';
import type { Issue } from '../../model/validate';
import type { Project } from '../../store/project';
import { newId } from '../../store/project';
import { MiniEditor } from '../../editor/MiniEditor';
import { ConditionEditor } from './ConditionEditor';
import { Icon } from '../icons';

interface Props {
  project: Project;
  dialog: Item;
  node: DialogNode | null;
  issues: Issue[];
  characters: Item[];
  dialogs: Item[];
  vars: WorldVar[];
  profile: Profile | null;
  onSelectNode: (id: Id | null) => void;
}

function EffectsEditor({ effects, vars, onChange }: { effects: Effect[]; vars: WorldVar[]; onChange: (e: Effect[]) => void }) {
  return (
    <div className="cond-box">
      {effects.length === 0 && <span className="muted small">Keine Effekte.</span>}
      {effects.map((ef, i) => {
        const v = vars.find((x) => x.id === ef.varId);
        const isBool = v ? valueTypeOf(v.kind) === 'boolean' : typeof ef.value === 'boolean';
        const set = (patch: Partial<Effect>) => onChange(effects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={ef.id} className="clause">
            <select className="select" aria-label="Variable" value={ef.varId} onChange={(e) => {
              const nv = vars.find((x) => x.id === e.target.value);
              const b = nv ? valueTypeOf(nv.kind) === 'boolean' : false;
              set({ varId: e.target.value, mode: b ? 'set' : ef.mode, value: b ? true : typeof ef.value === 'number' ? ef.value : 1 });
            }}>
              {!v && <option value={ef.varId}>Unbekannte Variable</option>}
              {vars.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {isBool ? (
              <select className="select" aria-label="Wert" value={String(ef.value)} onChange={(e) => set({ mode: 'set', value: e.target.value === 'true' })}>
                <option value="true">aktivieren</option>
                <option value="false">deaktivieren</option>
              </select>
            ) : (
              <>
                <select className="select" aria-label="Art" value={ef.mode} onChange={(e) => set({ mode: e.target.value as Effect['mode'] })}>
                  <option value="set">setzen auf</option>
                  <option value="add">ändern um</option>
                </select>
                <input className="input" style={{ width: 64 }} type="number" aria-label="Wert" value={Number(ef.value)} onChange={(e) => set({ value: Number(e.target.value) })} />
              </>
            )}
            <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Effekt entfernen" onClick={() => onChange(effects.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} disabled={vars.length === 0} onClick={() => {
        const v = vars[0]!;
        const b = valueTypeOf(v.kind) === 'boolean';
        onChange([...effects, { id: newId('ef'), varId: v.id, mode: 'set', value: b ? true : 1 }]);
      }}>+ Effekt</button>
    </div>
  );
}

function IssueList({ issues, onSelectNode }: { issues: Issue[]; onSelectNode: (id: Id | null) => void }) {
  if (issues.length === 0) return <div className="ok-text small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="check" size={14} /> Keine Probleme gefunden</div>;
  return (
    <div className="issues">
      {issues.map((i, k) => (
        <button key={k} type="button" className="issue" onClick={() => i.nodeId && onSelectNode(i.nodeId)}>
          <span className={`sev ${i.severity}`} />
          <span>{i.message}</span>
        </button>
      ))}
    </div>
  );
}

export function Inspector({ project, dialog, node, issues, characters, dialogs, vars, profile, onSelectNode }: Props) {
  const update = (patch: Partial<DialogNode>) => node && project.updateNode(dialog.id, node.id, patch);
  const ctx = makeContext(profile?.state ?? {}, vars);
  const names = {
    varLabel: (id: Id) => vars.find((v) => v.id === id)?.label ?? 'Unbekannte Variable',
    dialogLabel: (id: Id) => dialogs.find((d) => d.id === id)?.title ?? 'Gelöschter Dialog',
  };

  if (!node) {
    return (
      <aside className="inspector" aria-label="Dialogdetails">
        <div>
          <div className="label">Dialog</div>
          <input className="input bare" style={{ fontSize: 18, fontWeight: 600 }} aria-label="Titel des Dialogs" key={dialog.id + dialog.title}
            defaultValue={dialog.title} onBlur={(e) => e.currentTarget.value !== dialog.title && project.updateItem(dialog.id, { title: e.currentTarget.value })} />
        </div>
        <label className="field">
          <span className="label">Export-ID</span>
          <input className="input mono" key={dialog.id + (dialog.exportId ?? '')} defaultValue={dialog.exportId ?? ''} placeholder="Dialog.Name"
            onBlur={(e) => project.updateItem(dialog.id, { exportId: e.currentTarget.value.trim() || undefined })} />
        </label>
        <div className="field">
          <span className="label">Prüfung</span>
          <IssueList issues={issues} onSelectNode={onSelectNode} />
        </div>
        <p className="muted small" style={{ lineHeight: 1.6, margin: 0 }}>
          Wähle einen Node, um ihn zu bearbeiten. Neue Nodes legst du oben in der Leiste an, Verbindungen ziehst du von Punkt zu Punkt. Entf löscht die Auswahl.
        </p>
      </aside>
    );
  }

  const nodeIssues = issues.filter((i) => i.nodeId === node.id);

  return (
    <aside className="inspector" aria-label="Node bearbeiten">
      {node.type === 'line' && (() => {
        const variants = orderedVariants(node.variants ?? []);
        const winner = selectVariant(node, ctx);
        const setVariants = (vs: Variant[]) => update({ variants: vs });
        const setVariant = (id: Id, patch: Partial<Variant>) => setVariants((node.variants ?? []).map((v) => (v.id === id ? { ...v, ...patch } : v)));
        return (
          <>
            <div>
              <div className="label">Zeile</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                {variants.length > 1 ? `${variants.length} Varianten` : 'Eine Fassung'}
              </div>
            </div>
            <label className="field">
              <span className="label">Sprecher</span>
              <select className="select" value={node.speakerId ?? ''} onChange={(e) => update({ speakerId: e.target.value || undefined })}>
                <option value="">Kein Sprecher</option>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            {profile && (
              <div className="card" style={{ gap: 6 }}>
                <span className="label">Vorschau: {profile.name}</span>
                {winner ? (
                  <span className="ok-text">Variante {variants.findIndex((v) => v.id === winner.id) + 1} greift</span>
                ) : (
                  <span className="err-text">Keine Variante greift: Fallback fehlt</span>
                )}
                {winner && explain(winner.condition, ctx, names).map((l, i) => (
                  <div key={i} className="explain"><span className={l.ok ? 'ok-text' : 'muted'}>{l.ok ? '✓' : '✗'}</span><span className={l.ok ? '' : 'muted'}>{l.text}</span></div>
                ))}
                {variants.filter((v) => winner && v.id !== winner.id && v.condition && variants.indexOf(v) < variants.indexOf(winner)).map((v) => (
                  <div key={v.id} className="explain muted"><span>✗</span><span>Variante {variants.indexOf(v) + 1} nicht erfüllt: {explain(v.condition, ctx, names).filter((l) => !l.ok).map((l) => l.text).join('; ')}</span></div>
                ))}
              </div>
            )}
            {variants.map((v, i) => (
              <div key={v.id} className={`variant-edit ${winner?.id === v.id ? 'winner' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="vnum" style={winner?.id === v.id ? { background: 'var(--accent)', color: 'var(--on-accent)' } : undefined}>{i + 1}</span>
                  <span style={{ fontWeight: 500, flex: 1 }}>{v.condition === null ? 'Fallback (sonst)' : `Variante ${i + 1}`}</span>
                  {v.condition !== null && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Priorität
                      <input className="input" style={{ width: 52, minHeight: 26, padding: '2px 6px' }} type="number" min={1} value={v.priority} onChange={(e) => setVariant(v.id, { priority: Number(e.target.value) })} />
                    </label>
                  )}
                  <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Variante löschen" onClick={() => setVariants((node.variants ?? []).filter((x) => x.id !== v.id))}><Icon name="trash" size={14} /></button>
                </div>
                <MiniEditor label={`Text der Variante ${i + 1}`} value={v.text} placeholder="Was wird gesagt? @ für Verweise" onChange={(text) => setVariant(v.id, { text })} />
                <input className="input" placeholder="Regieanweisung, Tonfall" value={v.direction ?? ''} onChange={(e) => setVariant(v.id, { direction: e.target.value || undefined })} aria-label="Regieanweisung" />
                {v.condition === null ? (
                  <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => {
                    const first = vars[0];
                    if (!first) return;
                    const b = valueTypeOf(first.kind) === 'boolean';
                    setVariant(v.id, { condition: { type: 'compare', varId: first.id, op: b ? '==' : '>=', value: b ? true : 1 } });
                  }}>Bedingung hinzufügen</button>
                ) : (
                  <ConditionEditor value={v.condition} onChange={(c) => setVariant(v.id, { condition: c })} vars={vars} dialogs={dialogs} project={project} />
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn small" onClick={() => {
                const max = Math.max(0, ...(node.variants ?? []).filter((v) => v.condition).map((v) => v.priority));
                const first = vars[0];
                const cond = first ? { type: 'compare' as const, varId: first.id, op: valueTypeOf(first.kind) === 'boolean' ? ('==' as const) : ('>=' as const), value: valueTypeOf(first.kind) === 'boolean' ? true : 1 } : null;
                setVariants([...(node.variants ?? []), { id: newId('v'), priority: max + 1, condition: cond, text: '' }]);
              }}>+ Variante</button>
              {!(node.variants ?? []).some((v) => v.condition === null) && (
                <button type="button" className="btn small" onClick={() => setVariants([...(node.variants ?? []), { id: newId('v'), priority: 99, condition: null, text: '' }])}>+ Fallback</button>
              )}
            </div>
          </>
        );
      })()}

      {node.type === 'choice' && (() => {
        const options = node.options ?? [];
        const setOptions = (os: ChoiceOption[]) => update({ options: os });
        const setOption = (id: Id, patch: Partial<ChoiceOption>) => setOptions(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
        return (
          <>
            <div><div className="label">Auswahl</div><div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{options.length} Optionen</div></div>
            {options.map((o, i) => (
              <div key={o.id} className="variant-edit">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="vnum">{i + 1}</span>
                  <span style={{ fontWeight: 500, flex: 1 }}>Option {i + 1}</span>
                  <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Option löschen" onClick={() => setOptions(options.filter((x) => x.id !== o.id))}><Icon name="trash" size={14} /></button>
                </div>
                <MiniEditor label={`Text der Option ${i + 1}`} value={o.text} placeholder="Was kann die Spielerin sagen?" onChange={(text) => setOption(o.id, { text })} />
                <span className="label">Sichtbar, wenn</span>
                <ConditionEditor value={o.condition} onChange={(c) => setOption(o.id, { condition: c })} vars={vars} dialogs={dialogs} project={project} />
                <span className="label">Effekte bei Wahl</span>
                <EffectsEditor effects={o.effects} vars={vars} onChange={(effects) => setOption(o.id, { effects })} />
              </div>
            ))}
            <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setOptions([...options, { id: newId('o'), text: '', condition: null, effects: [] }])}>+ Option</button>
          </>
        );
      })()}

      {node.type === 'effect' && (
        <>
          <div><div className="label">Effekt</div><div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Weltzustand ändern</div></div>
          <EffectsEditor effects={node.effects ?? []} vars={vars} onChange={(effects) => update({ effects })} />
        </>
      )}

      {node.type === 'end' && (
        <>
          <div><div className="label">Ende</div></div>
          <label className="field">
            <span className="label">Ergebnis</span>
            <input className="input" value={node.outcome ?? ''} placeholder="z. B. Durchgelassen" onChange={(e) => update({ outcome: e.target.value || undefined })} />
            <span className="muted small">Andere Dialoge können dieses Ergebnis als Bedingung abfragen.</span>
          </label>
        </>
      )}

      {node.type === 'jump' && (
        <label className="field">
          <span className="label">Weiter in Dialog</span>
          <select className="select" value={node.targetDialogId ?? ''} onChange={(e) => update({ targetDialogId: e.target.value || undefined })}>
            <option value="">Dialog wählen</option>
            {dialogs.filter((d) => d.id !== dialog.id).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
      )}

      {node.type === 'start' && <div><div className="label">Start</div><p className="muted small">Hier beginnt der Dialog.</p></div>}

      {nodeIssues.length > 0 && (
        <div className="field">
          <span className="label">Prüfung</span>
          <IssueList issues={nodeIssues} onSelectNode={onSelectNode} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn small" onClick={() => onSelectNode(null)}>Zum Dialog</button>
        {node.type !== 'start' && (
          <button type="button" className="btn small danger" onClick={() => { project.deleteNode(dialog.id, node.id); onSelectNode(null); }}>
            <Icon name="trash" size={13} /> Node löschen
          </button>
        )}
      </div>
    </aside>
  );
}
