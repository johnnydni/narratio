import { useEffect, useRef } from 'react';
import { EditorContent, NodeViewWrapper, useEditor, type NodeViewProps } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Placeholder from '@tiptap/extension-placeholder';
import type { JSONContent } from '@tiptap/core';
import { createLoreRef, createLoreSuggest } from './extensions';
import { loreToken, splitLoreTokens } from '../model/refs';
import { useItems, useProject } from '../ui/state';

/**
 * Einzeiliger Editor für Dialogtexte. Gespeichert wird reiner Text mit {{lore:id}}-Tokens;
 * angezeigt werden die Verweise als Chips mit aktuellem Namen. "@" fügt Verweise ein.
 */

function LoreChip({ node }: NodeViewProps) {
  const items = useItems();
  const item = items.find((i) => i.id === node.attrs.id);
  return (
    <NodeViewWrapper as="span" className={`ref ${item ? `k-${item.loreKind}` : 'dead'}`}>
      {item ? item.title || 'Ohne Titel' : 'gelöscht'}
    </NodeViewWrapper>
  );
}
const LoreRef = createLoreRef(LoreChip);

function toDoc(text: string): JSONContent {
  const content: JSONContent[] = splitLoreTokens(text).map((p) =>
    p.kind === 'text' ? { type: 'text', text: p.text } : { type: 'loreRef', attrs: { id: p.id } },
  ).filter((n) => n.type !== 'text' || (n.text ?? '') !== '');
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function fromDoc(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text') parts.push(n.text ?? '');
    else if (n.type === 'loreRef') parts.push(loreToken(String(n.attrs?.id)));
    else n.content?.forEach(walk);
    if (n.type === 'paragraph' && parts.length) parts.push('\n');
  };
  walk(doc);
  return parts.join('').replace(/\n+$/, '');
}

export function MiniEditor({
  value,
  onChange,
  placeholder,
  label,
  serif = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  serif?: boolean;
}) {
  const project = useProject();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSent = useRef(value);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      LoreRef,
      createLoreSuggest(() => project.listItems().filter((i) => i.type === 'lore')),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: toDoc(value),
    editorProps: { attributes: { 'aria-label': label, class: serif ? 'mini serif' : 'mini', spellcheck: 'true', lang: 'de' } },
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const next = fromDoc(editor.getJSON());
        if (next !== lastSent.current) {
          lastSent.current = next;
          changeRef.current(next);
        }
      }, 350);
    },
    onBlur: ({ editor }) => {
      clearTimeout(timer.current);
      const next = fromDoc(editor.getJSON());
      if (next !== lastSent.current) {
        lastSent.current = next;
        changeRef.current(next);
      }
    },
  });

  // Änderungen von außen (anderes Fenster) übernehmen, solange hier nicht getippt wird.
  useEffect(() => {
    if (!editor || editor.isFocused || value === lastSent.current) return;
    lastSent.current = value;
    editor.commands.setContent(toDoc(value), { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return <EditorContent editor={editor} className="mini-wrap" />;
}
