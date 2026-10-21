import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { DialogNode, Item, Variant } from '../../model/types';
import { orderedVariants } from '../../model/variants';
import { RichText } from '../LoreRef';

export interface NodeData extends Record<string, unknown> {
  node: DialogNode;
  speaker?: Item;
  dialogs: Item[];
  /** Variante, die im gewählten Spielstand greift. */
  activeVariantId?: string | null;
  hasError: boolean;
  condLabel: (v: Variant['condition']) => string;
}

export type FlowNode = Node<NodeData>;

function initials(name: string | undefined): string {
  return (name ?? '?').trim().slice(0, 1).toUpperCase() || '?';
}

export const LineNode = memo(function LineNode({ data, selected }: NodeProps<FlowNode>) {
  const variants = orderedVariants(data.node.variants ?? []);
  return (
    <div className={`dnode ${selected ? 'selected' : ''} ${data.hasError ? 'has-error' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="dnode-head">
        <span className="avatar">{initials(data.speaker?.title)}</span>
        <span style={{ fontWeight: 500 }}>{data.speaker?.title ?? 'Kein Sprecher'}</span>
        {variants.length > 1 && <span className="chip accent">{variants.length} Varianten</span>}
        <span className="dnode-kind">Zeile</span>
      </div>
      {variants.map((v, i) => (
        <div key={v.id} className={`variant ${data.activeVariantId === v.id ? 'active' : ''}`}>
          <span className="vnum">{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            {variants.length > 1 && <span className="chip vcond">{data.condLabel(v.condition)}</span>}
            <div className="vtext"><RichText text={v.text || '…'} /></div>
            {v.direction && <div className="muted" style={{ fontStyle: 'italic', marginTop: 2 }}>{v.direction}</div>}
          </div>
        </div>
      ))}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const ChoiceNode = memo(function ChoiceNode({ data, selected }: NodeProps<FlowNode>) {
  const options = data.node.options ?? [];
  return (
    <div className={`dnode ${selected ? 'selected' : ''} ${data.hasError ? 'has-error' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="dnode-head">
        <span className="avatar">?</span>
        <span style={{ fontWeight: 500 }}>Auswahl</span>
        <span className="dnode-kind">{options.length} Optionen</span>
      </div>
      {options.map((o) => (
        <div key={o.id} className="option">
          <div className="vtext"><RichText text={o.text || '…'} /></div>
          {(o.condition || o.effects.length > 0) && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {o.condition && <span className="chip">{data.condLabel(o.condition)}</span>}
              {o.effects.length > 0 && <span className="chip accent">{o.effects.length} Effekt{o.effects.length > 1 ? 'e' : ''}</span>}
            </div>
          )}
          <Handle type="source" position={Position.Right} id={o.id} style={{ top: '50%' }} />
        </div>
      ))}
    </div>
  );
});

export const PillNode = memo(function PillNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.node;
  let label = '';
  if (n.type === 'start') label = 'Start';
  else if (n.type === 'end') label = n.outcome ? `Ende · ${n.outcome}` : 'Ende';
  else if (n.type === 'jump') label = `↗ ${data.dialogs.find((d) => d.id === n.targetDialogId)?.title ?? 'Zieldialog wählen'}`;
  else if (n.type === 'effect') label = `Effekt · ${(n.effects ?? []).length}`;
  return (
    <div className={`pill-node ${selected ? 'selected' : ''}`} style={data.hasError ? { borderColor: 'var(--danger)' } : undefined}>
      {n.type !== 'start' && <Handle type="target" position={Position.Left} />}
      <span>{label}</span>
      {n.type !== 'end' && n.type !== 'jump' && <Handle type="source" position={Position.Right} />}
    </div>
  );
});

export const nodeTypes = { line: LineNode, choice: ChoiceNode, pill: PillNode };
