import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // Editor und Graph werden in eigene Pakete aufgeteilt und erst bei Bedarf geladen (Ladezeit-Budget).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('@xyflow') || id.includes('d3-')) return 'graph';
          if (id.includes('yjs') || id.includes('y-indexeddb') || id.includes('lib0') || id.includes('y-protocols')) return 'sync';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
