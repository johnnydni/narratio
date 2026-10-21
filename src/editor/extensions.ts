import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ComponentType } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { LORE_KINDS, type Item } from '../model/types';

/**
 * Inline-Verweis auf einen Lore-Eintrag. Gespeichert wird nur die ID; der Name wird beim
 * Anzeigen aus der Lore gelesen, damit Umbenennen überall sofort wirkt (LR-04).
 */
export function createLoreRef(view: ComponentType<NodeViewProps>) {
  const component = view as Parameters<typeof ReactNodeViewRenderer>[0];
  return Node.create({
    name: 'loreRef',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { id: { default: null, parseHTML: (el) => el.getAttribute('data-lore'), renderHTML: (a) => ({ 'data-lore': a.id }) } };
    },
    parseHTML() {
      return [{ tag: 'span[data-lore]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { class: 'ref' })];
    },
    renderText() {
      return '@';
    },
    addNodeView() {
      return ReactNodeViewRenderer(component, { as: 'span' });
    },
  });
}

/** "@" öffnet die Lore-Auswahl und fügt einen Verweis ein (LR-02). */
export function createLoreSuggest(getLore: () => Item[]) {
  return Extension.create({
    name: 'loreSuggest',
    addProseMirrorPlugins() {
      return [
        Suggestion<Item, Item>({
          editor: this.editor,
          char: '@',
          allowSpaces: true,
          pluginKey: new PluginKey('loreSuggest'),
          items: ({ query }) => {
            const q = query.toLowerCase().trim();
            return getLore()
              .filter((i) => !q || i.title.toLowerCase().includes(q))
              .sort((a, b) => a.title.localeCompare(b.title))
              .slice(0, 8);
          },
          command: ({ editor, range, props }) => {
            editor.chain().focus().insertContentAt(range, [{ type: 'loreRef', attrs: { id: props.id } }, { type: 'text', text: ' ' }]).run();
          },
          render: () => {
            let el: HTMLDivElement | null = null;
            let items: Item[] = [];
            let selected = 0;
            let command: ((item: Item) => void) | null = null;

            const draw = () => {
              if (!el) return;
              el.replaceChildren();
              if (items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = 'Kein Lore-Eintrag gefunden';
                el.append(empty);
                return;
              }
              items.forEach((item, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = i === selected ? 'sel' : '';
                const dot = document.createElement('span');
                dot.className = `kind-dot k-${item.loreKind}`;
                const name = document.createElement('span');
                name.style.flex = '1';
                name.textContent = item.title || 'Ohne Titel';
                const kind = document.createElement('span');
                kind.className = 'muted small';
                kind.textContent = LORE_KINDS.find((k) => k.kind === item.loreKind)?.label ?? '';
                b.append(dot, name, kind);
                b.addEventListener('mousedown', (e) => { e.preventDefault(); command?.(item); });
                el!.append(b);
              });
            };
            const place = (props: SuggestionProps<Item, Item>) => {
              const rect = props.clientRect?.();
              if (!el || !rect) return;
              el.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
              el.style.top = `${rect.bottom + 6}px`;
            };

            return {
              onStart: (props) => {
                el = document.createElement('div');
                el.className = 'suggest';
                el.setAttribute('role', 'listbox');
                document.body.append(el);
                items = props.items;
                selected = 0;
                command = (item) => props.command(item);
                draw();
                place(props);
              },
              onUpdate: (props) => {
                items = props.items;
                selected = Math.min(selected, Math.max(0, items.length - 1));
                command = (item) => props.command(item);
                draw();
                place(props);
              },
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                if (event.key === 'ArrowDown') { selected = (selected + 1) % Math.max(1, items.length); draw(); return true; }
                if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  const item = items[selected];
                  if (item) command?.(item);
                  return true;
                }
                if (event.key === 'Escape') { el?.remove(); el = null; return true; }
                return false;
              },
              onExit: () => { el?.remove(); el = null; },
            };
          },
        }),
      ];
    },
  });
}

/** Markiert den Absatz mit dem Cursor, damit der Fokusmodus alles andere zurücknehmen kann. */
export const FocusParagraph = Extension.create({
  name: 'focusParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('focusParagraph'),
        props: {
          decorations(state) {
            const { $from } = state.selection;
            if ($from.depth < 1) return DecorationSet.empty;
            const start = $from.before(1);
            const node = state.doc.nodeAt(start);
            if (!node) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [Decoration.node(start, start + node.nodeSize, { class: 'has-focus' })]);
          },
        },
      }),
    ];
  },
});
