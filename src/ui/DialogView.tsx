import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type * as Y from 'yjs';
import type { Condition, DialogNode, DialogNodeType, Id, Item } from '../model/types';
import { makeContext } from '../model/conditions';
import { selectVariant } from '../model/variants';
import { validateDialog } from '../model/validate';
import { newId } from '../store/project';
import { useItems, useProjectSetting, useObserved, useProject, useWorld } from './state';
import { nodeTypes, type FlowNode } from './dialog/nodes';
import { Inspector } from './dialog/Inspector';
import { Icon } from './icons';
import { IconButton } from './itemIcons';

const ADD: { type: DialogNodeType; label: string }[] = [
  { type: 'line', label: 'Zeile' },
  { type: 'choice', label: 'Auswahl' },
  { type: 'effect', label: 'Effekt' },
  { type: 'end', label: 'Ende' },
  { type: 'jump', label: 'Sprung' },
];

function rfType(t: DialogNodeType): string {
  return t === 'line' ? 'line' : t === 'choice' ? 'choice' : 'pill';
}

function Canvas({ item }: { item: Item }) {
  const project = useProject();
  const items = useItems();
  const { vars, profiles } = useWorld();
  const flow = useReactFlow();
  const dialogMap = project.dialogMap(item.id);
  const graph = useObserved([dialogMap as unknown as Y.AbstractType<unknown>], () => project.readGraph(item.id));
  const [selected, setSelected] = useState<Id | null>(null);
  const [profileId, setProfileId] = useProjectSetting<string>(`profile:${item.id}`, '');
  const profile = profiles.find((p) => p.id === profileId) ?? null;

  const characters = useMemo(() => items.filter((i) => i.type === 'lore' && i.loreKind === 'character').sort((a, b) => a.title.localeCompare(b.title)), [items]);
  const dialogs = useMemo(() => items.filter((i) => i.type === 'dialog'), [items]);

  const issues = useMemo(() => {
    const lore = items.filter((i) => i.type === 'lore');
    return validateDialog(item, graph, {
      loreIds: new Set(lore.map((l) => l.id)),
      characterIds: new Set(characters.map((c) => c.id)),
      varIds: new Set(vars.map((v) => v.id)),
      dialogIds: new Set(dialogs.map((d) => d.id)),
    });
  }, [item, graph, items, characters, vars, dialogs]);

  const condLabel = useCallback((c: Condition | null): string => {
    if (c === null) return 'sonst';
    const label = (x: Condition): string => {
      switch (x.type) {
        case 'compare': {
          const v = vars.find((y) => y.id === x.varId);
          const name = v?.label ?? 'Unbekannt';
          if (typeof x.value === 'boolean') return x.value === (x.op === '==') ? name : `nicht ${name}`;
          return `${name} ${x.op} ${x.value}`;
        }
        case 'dialogOutcome': return `${dialogs.find((d) => d.id === x.dialogId)?.title ?? 'Dialog'}: ${x.outcome}`;
        case 'not': return `nicht (${label(x.item)})`;
        default: return x.items.map(label).join(x.type === 'and' ? ' und ' : ' oder ');
      }
    };
    const s = label(c);
    return s.length > 48 ? `${s.slice(0, 46)}…` : s;
  }, [vars, dialogs]);

  // React-Flow-Nodes: Position und Inhalt aus Yjs, Messwerte und Auswahl lokal.
  const [rfNodes, setRfNodes] = useState<FlowNode[]>([]);
  useEffect(() => {
    const ctx = makeContext(profile?.state ?? {}, vars);
    const errorNodes = new Set(issues.filter((i) => i.severity === 'error' && i.nodeId).map((i) => i.nodeId));
    setRfNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n): FlowNode => {
        const o = old.get(n.id);
        return {
          ...(o ?? {}),
          id: n.id,
          type: rfType(n.type),
          position: o?.dragging ? o.position : { x: n.x, y: n.y },
          selected: n.id === selected,
          deletable: n.type !== 'start',
          data: {
            node: n,
            speaker: items.find((i) => i.id === n.speakerId),
            dialogs,
            activeVariantId: profile && n.type === 'line' ? selectVariant(n, ctx)?.id ?? null : null,
            hasError: errorNodes.has(n.id),
            condLabel,
          },
        };
      });
    });
  }, [graph, items, dialogs, selected, profile, vars, issues, condLabel]);

  const rfEdges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, type: 'smoothstep' })),
    [graph.edges],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        project.updateNode(item.id, c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
      }
      if (c.type === 'select' && c.selected) setSelected(c.id);
      if (c.type === 'remove') {
        project.deleteNode(item.id, c.id);
        setSelected((s) => (s === c.id ? null : s));
      }
    }
  }, [project, item.id]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === 'remove') project.deleteEdge(item.id, c.id);
  }, [project, item.id]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const exists = graph.edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null));
    if (exists) return;
    // Ein Options-Ausgang führt immer genau an ein Ziel: alte Verbindung ersetzen.
    if (c.sourceHandle) {
      for (const e of graph.edges) if (e.source === c.source && e.sourceHandle === c.sourceHandle) project.deleteEdge(item.id, e.id);
    }
    project.putEdge(item.id, { id: newId('e'), source: c.source, target: c.target, sourceHandle: c.sourceHandle ?? null });
  }, [project, item.id, graph.edges]);

  const addNode = (type: DialogNodeType) => {
    const rect = document.querySelector('.canvas')?.getBoundingClientRect();
    const center = rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
    const id = newId('n');
    const base: DialogNode = { id, type, x: Math.round(center.x - 120 + Math.random() * 40), y: Math.round(center.y - 40 + Math.random() * 40) };
    if (type === 'line') base.variants = [{ id: newId('v'), priority: 99, condition: null, text: '' }];
    if (type === 'choice') base.options = [{ id: newId('o'), text: '', condition: null, effects: [] }, { id: newId('o'), text: '', condition: null, effects: [] }];
    if (type === 'effect') base.effects = [];
    project.putNode(item.id, base);
    setSelected(id);
  };

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;

  return (
    <div className="dialog">
      <div className="dialog-bar">
        <IconButton item={item} onChange={(patch) => project.updateItem(item.id, patch)} size={16} small />
        {ADD.map((a) => (
          <button key={a.type} type="button" className="btn ghost small" onClick={() => addNode(a.type)}>
            <Icon name="plus" size={13} /> {a.label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => setSelected(null)} title="Prüfergebnis anzeigen">
          {errors > 0 ? <span className="err-text">{errors} Fehler</span> : warnings > 0 ? <span className="warn-text">{warnings} Hinweise</span> : <span className="ok-text">Geprüft</span>}
        </button>
        <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Vorschau
          <select className="select" style={{ width: 210, minHeight: 28, padding: '3px 8px' }} value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="Spielstand für die Vorschau">
            <option value="">Kein Spielstand</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="dialog-body">
        <div className="canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelected(null)}
            onlyRenderVisibleElements
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.15}
            deleteKeyCode={['Delete', 'Backspace']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--canvas-dot)" />
            <MiniMap pannable zoomable nodeColor={(n) => (n.selected ? 'var(--accent)' : 'var(--line)')} maskColor="rgba(0,0,0,0.06)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Inspector
          project={project}
          dialog={item}
          node={selectedNode}
          issues={issues}
          characters={characters}
          dialogs={dialogs}
          vars={vars}
          profile={profile}
          onSelectNode={setSelected}
        />
      </div>
    </div>
  );
}

export default function DialogView({ item }: { item: Item }) {
  return (
    <ReactFlowProvider>
      <Canvas item={item} />
    </ReactFlowProvider>
  );
}
