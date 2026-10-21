import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { EditorContent, NodeViewWrapper, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import type * as Y from 'yjs';
import { STATUSES, type Item, type Status } from '../model/types';
import { createLoreRef, createLoreSuggest, FocusParagraph } from '../editor/extensions';
import { useItems, useLocalSetting, useNav, useObserved, useProject } from './state';
import { HoverCard, kindLabel } from './LoreRef';
import { useImmersion } from './immersion';
import { Icon } from './icons';

/** Darstellung eines Lore-Verweises im Editor: immer der aktuelle Name, mit Vorschaukarte. */
function LoreRefView({ node }: NodeViewProps) {
  const items = useItems();
  const nav = useNav();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const item = items.find((i) => i.id === node.attrs.id);
  return (
    <NodeViewWrapper as="span" className={`ref ${item ? `k-${item.loreKind}` : 'dead'}`}
      onMouseEnter={(e: MouseEvent) => setHover({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHover(null)}
      onDoubleClick={() => item && nav.go({ kind: 'item', id: item.id })}
      title={item ? 'Doppelklick öffnet den Eintrag' : 'Dieser Lore-Eintrag wurde gelöscht'}
    >
      {item ? item.title || 'Ohne Titel' : 'gelöscht'}
      {hover && item && <HoverCard item={item} x={hover.x} y={hover.y} />}
    </NodeViewWrapper>
  );
}

const LoreRef = createLoreRef(LoreRefView);

function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export default function SceneView({ item }: { item: Item }) {
  const project = useProject();
  const items = useItems();
  const nav = useNav();
  const { onWritingKey } = useImmersion();
  const [focus, setFocus] = useLocalSetting('focusMode', false);
  const [words, setWords] = useState(0);
  const fragment = useMemo(() => project.sceneFragment(item.id), [project, item.id]);
  const keyRef = useRef(onWritingKey);
  keyRef.current = onWritingKey;
  const goal = Number(item.fields?.Wortziel ?? 600);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
        Collaboration.configure({ fragment }),
        Placeholder.configure({ placeholder: 'Schreib los. Mit @ verweist du auf Figuren, Orte und Items.' }),
        LoreRef,
        createLoreSuggest(() => project.listItems().filter((i) => i.type === 'lore')),
        FocusParagraph,
      ],
      editorProps: {
        attributes: { 'aria-label': `Szenentext: ${item.title}`, spellcheck: 'true', lang: 'de' },
        handleKeyDown: (_view, event) => {
          keyRef.current(event);
          return false;
        },
      },
      onCreate: ({ editor }) => setWords(countWords(editor.getText())),
      onUpdate: ({ editor }) => setWords(countWords(editor.getText())),
    },
    [fragment],
  );

  // Verweise dieser Szene, live aus dem Text
  const refs = useObserved([fragment as unknown as Y.AbstractType<unknown>], () => [...new Set(project.sceneRefs(item.id))]);
  const refItems = refs.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i);
  const deadRefs = refs.length - refItems.length;

  const active = (name: string, attrs?: Record<string, unknown>) => (editor?.isActive(name, attrs) ? 'on' : '');
  const blockLabel = editor?.isActive('heading', { level: 1 }) ? 'Titel' : editor?.isActive('heading', { level: 2 }) ? 'Überschrift' : 'Absatz';

  return (
    <div className="scene">
      <div className="scene-main">
        <div className="toolbar" role="toolbar" aria-label="Formatierung">
          <button type="button" className="tool" onClick={() => {
            if (!editor) return;
            if (editor.isActive('heading', { level: 1 })) editor.chain().focus().setHeading({ level: 2 }).run();
            else if (editor.isActive('heading', { level: 2 })) editor.chain().focus().setParagraph().run();
            else editor.chain().focus().setHeading({ level: 1 }).run();
          }} title="Absatz, Titel, Überschrift">{blockLabel} ▾</button>
          <span className="tool-sep" />
          <button type="button" className={`tool ${active('bold')}`} aria-label="Fett" aria-pressed={!!editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} style={{ fontWeight: 600 }}>B</button>
          <button type="button" className={`tool ${active('italic')}`} aria-label="Kursiv" aria-pressed={!!editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }}>I</button>
          <button type="button" className={`tool ${active('blockquote')}`} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>Zitat</button>
          <button type="button" className={`tool ${active('bulletList')}`} onClick={() => editor?.chain().focus().toggleBulletList().run()}>Liste</button>
          <span className="tool-sep" />
          <button type="button" className="tool on" onClick={() => editor?.chain().focus().insertContent('@').run()} title="Verweis auf einen Lore-Eintrag einfügen">@ Verweis</button>
          <span className="spacer" />
          <span className="muted small" style={{ marginRight: 12 }} data-testid="word-count">{words} Wörter</span>
          <button type="button" className={`btn small ${focus ? 'primary' : ''}`} aria-pressed={focus} onClick={() => setFocus(!focus)}>
            <Icon name="focus" size={13} /> Fokus
          </button>
        </div>
        <div className={`editor-scroll ${focus ? 'focus-mode' : ''}`}>
          <div className="page">
            <div className="kicker">{item.title}</div>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <aside className="side" aria-label="Szenendetails">
        <div className="field">
          <span className="label">Status</span>
          <select className="select" value={item.status ?? 'idea'} onChange={(e) => project.updateItem(item.id, { status: e.target.value as Status })} aria-label="Status">
            {STATUSES.map((s) => <option key={s.status} value={s.status}>{s.label}</option>)}
          </select>
        </div>
        <label className="field">
          <span className="label">Synopse</span>
          <textarea
            key={item.id}
            className="textarea"
            rows={4}
            defaultValue={item.synopsis ?? ''}
            placeholder="Worum geht es in dieser Szene?"
            onBlur={(e) => e.currentTarget.value !== (item.synopsis ?? '') && project.updateItem(item.id, { synopsis: e.currentTarget.value })}
          />
        </label>
        <div className="field">
          <span className="label">Verweise in dieser Szene</span>
          {refItems.length === 0 && <span className="muted small">Noch keine. Tippe @ im Text.</span>}
          {refItems.map((r) => (
            <button key={r.id} type="button" className="ref-row" onClick={() => nav.go({ kind: 'item', id: r.id })}>
              <span className={`kind-dot k-${r.loreKind}`} />
              <span style={{ flex: 1 }}>{r.title || 'Ohne Titel'}</span>
              <span className="muted small">{kindLabel(r)}</span>
            </button>
          ))}
          {deadRefs > 0 && <span className="err-text small">{deadRefs} Verweis{deadRefs > 1 ? 'e' : ''} auf gelöschte Einträge</span>}
        </div>
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between' }} className="muted small">
            <span>Ziel dieser Szene</span>
            <span>{words} von {goal} Wörtern</span>
          </div>
          <div className="progress"><div style={{ width: `${Math.min(100, (words / goal) * 100)}%` }} /></div>
        </div>
        <span className="spacer" />
        <span className="muted small">Jede Änderung liegt sofort lokal auf diesem Gerät.</span>
      </aside>
    </div>
  );
}
