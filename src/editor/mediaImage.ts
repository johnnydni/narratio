import { Node, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { ComponentType } from 'react';

/**
 * Fügt Bilder als eigene Blöcke ein, ohne einen Absatz mitten im Wort zu teilen: Am Absatzanfang
 * davor, sonst dahinter. Ein leerer Absatz wird ersetzt.
 */
export function insertImages(editor: Editor, hashes: string[], at?: number): void {
  const nodes = hashes.map((hash) => ({ type: 'mediaImage', attrs: { hash } }));
  const $pos = editor.state.doc.resolve(at ?? editor.state.selection.from);
  const block = $pos.parent;
  if (!block.isTextblock || $pos.depth === 0) {
    editor.chain().focus().insertContentAt($pos.pos, nodes).run();
    return;
  }
  const before = $pos.before();
  const after = $pos.after();
  if (block.content.size === 0) editor.chain().focus().insertContentAt({ from: before, to: after }, nodes).run();
  else editor.chain().focus().insertContentAt($pos.parentOffset === 0 ? before : after, nodes).run();
}

/**
 * Bild im Szenentext (ME-02). Gespeichert wird nur der Hash; Datei, Vorschau und
 * Bildunterschrift kommen aus der Medienbibliothek. So ändert eine neue Unterschrift alle
 * Stellen, und der Text bleibt klein.
 */
export function createMediaImage(
  view: ComponentType<NodeViewProps>,
  /** Importiert eingefügte oder abgelegte Bilder und liefert ihre Hashes. */
  importFiles: (files: File[]) => Promise<string[]>,
) {
  const component = view as Parameters<typeof ReactNodeViewRenderer>[0];
  return Node.create({
    name: 'mediaImage',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return { hash: { default: null, parseHTML: (el) => el.getAttribute('data-media'), renderHTML: (a) => ({ 'data-media': a.hash }) } };
    },
    parseHTML() {
      return [{ tag: 'figure[data-media]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['figure', HTMLAttributes];
    },
    addNodeView() {
      return ReactNodeViewRenderer(component);
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      const insert = async (files: File[], pos: number | null) => {
        const hashes = await importFiles(files);
        if (!hashes.length) return;
        insertImages(editor, hashes, pos ?? undefined);
      };
      const images = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
      return [
        new Plugin({
          key: new PluginKey('mediaImageFiles'),
          props: {
            handlePaste(_view, event) {
              const files = images(event.clipboardData?.files);
              if (!files.length) return false;
              void insert(files, null);
              return true;
            },
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const files = images((event as DragEvent).dataTransfer?.files);
              if (!files.length) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              void insert(files, at?.pos ?? null);
              return true;
            },
          },
        }),
      ];
    },
  });
}
