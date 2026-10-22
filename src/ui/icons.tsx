/** Schlichte Strich-Icons, 16 px, folgen der Textfarbe. */
const PATHS: Record<string, string> = {
  sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  sidebarRight: 'M2.5 3.5h11v9h-11zM10 3.5v9',
  library: 'M3 2.5v11M5.5 2.5v11M8 3.5l3 9.5M12.5 13.5h-11',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5 14 14',
  plus: 'M8 3v10M3 8h10',
  scene: 'M4 2.5h6l2.5 2.5v8.5h-8.5zM9.5 2.5V5.5h3M6 8.5h5M6 11h3.5',
  dialog: 'M2.5 3.5h7v5h-4l-3 2.5zM9.5 6h4v5l-2 -1.5h-2',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
  lore: 'M3 2.5h8a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h8',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.2v.1',
  world: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
  export: 'M8 2.5v8M4.5 6 8 2.5 11.5 6M3 10.5V13.5h10v-3',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  headphones: 'M2.5 10V8a5.5 5.5 0 0 1 11 0v2M2.5 10h2.5v3.5H3.5a1 1 0 0 1-1-1zM13.5 10H11v3.5h1.5a1 1 0 0 0 1-1z',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  focus: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3',
  play: 'M5 3.5v9l7.5-4.5z',
  check: 'M3 8.5 6.5 12 13 4.5',
  warn: 'M8 2.5 14.5 13.5h-13zM8 6.5v3.5M8 11.8v.2',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  settings: 'M2.5 4.5h5.5M11 4.5h2.5M2.5 11.5h2M7.5 11.5h6M9.5 3v3M6 10v3',
  close: 'M4 4l8 8M12 4l-8 8',
  command: 'M2.5 4h11v8h-11zM5 6.5h.01M8 6.5h.01M11 6.5h.01M5.5 9.5h5',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
