import type { CompareOp, Condition, Id, Item, WorldVar } from '../../model/types';
import { valueTypeOf } from '../../model/types';
import type { Project } from '../../store/project';

/**
 * Bedingungseditor ohne Code (VW-03): eine Verknüpfung (alle / mindestens eine) und eine Liste
 * von Klauseln. Jede Klausel prüft eine Variable des Weltzustands oder das Ergebnis eines
 * anderen Dialogs (VW-04), optional verneint.
 */

type Clause = Extract<Condition, { type: 'compare' } | { type: 'dialogOutcome' }> | { type: 'not'; item: Condition };

interface Props {
  value: Condition | null;
  onChange: (c: Condition | null) => void;
  vars: WorldVar[];
  dialogs: Item[];
  project: Project;
}

const OPS: { op: CompareOp; label: string }[] = [
  { op: '>=', label: 'mindestens' },
  { op: '<=', label: 'höchstens' },
  { op: '==', label: 'gleich' },
  { op: '!=', label: 'ungleich' },
  { op: '>', label: 'größer als' },
  { op: '<', label: 'kleiner als' },
];

function toParts(c: Condition | null): { mode: 'and' | 'or'; clauses: Condition[] } {
  if (c === null) return { mode: 'and', clauses: [] };
  if (c.type === 'and' || c.type === 'or') return { mode: c.type, clauses: c.items };
  return { mode: 'and', clauses: [c] };
}

function fromParts(mode: 'and' | 'or', clauses: Condition[]): Condition | null {
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0]!;
  return { type: mode, items: clauses };
}

function outcomesOf(project: Project, dialogId: Id): string[] {
  return [...new Set(project.readGraph(dialogId).nodes.filter((n) => n.type === 'end' && n.outcome).map((n) => n.outcome!))];
}

function ClauseEditor({ clause, onChange, onRemove, vars, dialogs, project }: {
  clause: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  vars: WorldVar[];
  dialogs: Item[];
  project: Project;
}) {
  const negated = clause.type === 'not';
  const inner = clause.type === 'not' ? clause.item : clause;
  const wrap = (c: Condition, neg = negated): Condition => (neg ? { type: 'not', item: c } : c);

  if (inner.type !== 'compare' && inner.type !== 'dialogOutcome') {
    return (
      <div className="clause">
        <span className="muted small">Verschachtelte Bedingung (wird unverändert übernommen)</span>
        <button type="button" className="btn ghost small danger" onClick={onRemove}>Entfernen</button>
      </div>
    );
  }

  const kindSelect = (
    <select
      className="select"
      aria-label="Art der Bedingung"
      value={inner.type}
      onChange={(e) => {
        if (e.target.value === 'compare') {
          const v = vars[0];
          onChange(wrap({ type: 'compare', varId: v?.id ?? '', op: v && valueTypeOf(v.kind) === 'boolean' ? '==' : '>=', value: v && valueTypeOf(v.kind) === 'boolean' ? true : 1 }));
        } else {
          const d = dialogs[0];
          onChange(wrap({ type: 'dialogOutcome', dialogId: d?.id ?? '', outcome: d ? outcomesOf(project, d.id)[0] ?? '' : '' }));
        }
      }}
    >
      <option value="compare">Weltzustand</option>
      <option value="dialogOutcome">Dialogergebnis</option>
    </select>
  );

  const notToggle = (
    <label className="chip" title="Bedingung verneinen">
      <input type="checkbox" checked={negated} onChange={(e) => onChange(wrap(inner, e.target.checked))} /> nicht
    </label>
  );

  if (inner.type === 'compare') {
    const v = vars.find((x) => x.id === inner.varId);
    const isBool = v ? valueTypeOf(v.kind) === 'boolean' : typeof inner.value === 'boolean';
    return (
      <div className="clause">
        {notToggle}
        {kindSelect}
        <select
          className="select"
          aria-label="Variable"
          value={inner.varId}
          onChange={(e) => {
            const nv = vars.find((x) => x.id === e.target.value);
            const b = nv ? valueTypeOf(nv.kind) === 'boolean' : false;
            onChange(wrap({ type: 'compare', varId: e.target.value, op: b ? '==' : inner.op, value: b ? true : typeof inner.value === 'number' ? inner.value : 1 }));
          }}
        >
          {!v && <option value={inner.varId}>Unbekannte Variable</option>}
          {vars.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        {isBool ? (
          <select className="select" aria-label="Wert" value={String(inner.op === '!=' ? !inner.value : inner.value)} onChange={(e) => onChange(wrap({ ...inner, op: '==', value: e.target.value === 'true' }))}>
            <option value="true">ist aktiv</option>
            <option value="false">ist nicht aktiv</option>
          </select>
        ) : (
          <>
            <select className="select" aria-label="Vergleich" value={inner.op} onChange={(e) => onChange(wrap({ ...inner, op: e.target.value as CompareOp }))}>
              {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            <input className="input" style={{ width: 64 }} type="number" aria-label="Wert" value={Number(inner.value)} onChange={(e) => onChange(wrap({ ...inner, value: Number(e.target.value) }))} />
          </>
        )}
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Bedingung entfernen" onClick={onRemove}>×</button>
      </div>
    );
  }

  const outcomes = inner.dialogId ? outcomesOf(project, inner.dialogId) : [];
  const listId = `outcomes-${inner.dialogId}`;
  return (
    <div className="clause">
      {notToggle}
      {kindSelect}
      <select className="select" aria-label="Dialog" value={inner.dialogId} onChange={(e) => onChange(wrap({ type: 'dialogOutcome', dialogId: e.target.value, outcome: outcomesOf(project, e.target.value)[0] ?? '' }))}>
        {!dialogs.some((d) => d.id === inner.dialogId) && <option value={inner.dialogId}>Gelöschter Dialog</option>}
        {dialogs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
      </select>
      <span className="muted small">endete mit</span>
      <input className="input" style={{ width: 150 }} list={listId} aria-label="Ergebnis" value={inner.outcome} onChange={(e) => onChange(wrap({ ...inner, outcome: e.target.value }))} />
      <datalist id={listId}>{outcomes.map((o) => <option key={o} value={o} />)}</datalist>
      <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Bedingung entfernen" onClick={onRemove}>×</button>
    </div>
  );
}

export function ConditionEditor({ value, onChange, vars, dialogs, project }: Props) {
  const { mode, clauses } = toParts(value);
  const set = (m: 'and' | 'or', cs: Condition[]) => onChange(fromParts(m, cs));

  return (
    <div className="cond-box">
      {clauses.length > 1 && (
        <select className="select" style={{ width: 'auto', alignSelf: 'flex-start' }} aria-label="Verknüpfung" value={mode} onChange={(e) => set(e.target.value as 'and' | 'or', clauses)}>
          <option value="and">Alle folgenden Punkte treffen zu</option>
          <option value="or">Mindestens ein Punkt trifft zu</option>
        </select>
      )}
      {clauses.length === 0 && <span className="muted small">Keine Bedingung: gilt immer.</span>}
      {clauses.map((c, i) => (
        <ClauseEditor
          key={i}
          clause={c as Clause}
          vars={vars}
          dialogs={dialogs}
          project={project}
          onChange={(nc) => set(mode, clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => set(mode, clauses.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        className="btn ghost small"
        style={{ alignSelf: 'flex-start' }}
        disabled={vars.length === 0}
        onClick={() => {
          const v = vars[0]!;
          const b = valueTypeOf(v.kind) === 'boolean';
          set(mode, [...clauses, { type: 'compare', varId: v.id, op: b ? '==' : '>=', value: b ? true : 1 }]);
        }}
      >
        + Bedingung
      </button>
    </div>
  );
}
