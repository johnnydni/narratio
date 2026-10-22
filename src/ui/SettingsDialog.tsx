import { useEffect, useRef, type ReactNode } from 'react';
import { useLocalSetting, useSession } from './state';
import { usePresence } from './motion';
import { useTheme } from './theme';
import { APPEARANCE_DEFAULTS, useAppearance, useWritingPrefs, type Appearance } from './prefs';
import { Segmented, SoundSettings } from './immersion';
import { SKETCH_DEFAULTS, SketchOptions, type SketchSettings } from './SketchLayer';
import { BackupPanel } from './BackupPanel';
import { formatBytes } from '../store/storage';
import { SCHEMA_VERSION } from '../store/project';
import { Icon } from './icons';

/**
 * Einstellungsmenü: bündelt, was sonst über Kopfleiste, Werkzeugleiste und Export verteilt ist.
 * Die Schnellzugriffe bleiben; beide Wege schreiben in denselben Speicher und bleiben gleich.
 * Alles hier gilt für dieses Gerät, außer der Sicherung, die zum offenen Projekt gehört.
 */

export type SettingsSection = 'appearance' | 'writing' | 'sound' | 'storage' | 'keys';

const SECTIONS: { id: SettingsSection; title: string; icon: string; project?: boolean }[] = [
  { id: 'appearance', title: 'Darstellung', icon: 'sun' },
  { id: 'writing', title: 'Schreiben', icon: 'scene' },
  { id: 'sound', title: 'Klang', icon: 'headphones', project: true },
  { id: 'storage', title: 'Sicherung und Speicher', icon: 'export', project: true },
  { id: 'keys', title: 'Tastenkürzel', icon: 'command' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Strg';

export function SettingsDialog({ open, onClose, inProject }: { open: boolean; onClose: () => void; inProject: boolean }) {
  const { mounted, state } = usePresence(open, 150);
  const [section, setSection] = useLocalSetting<SettingsSection>('settings-section', 'appearance');
  const box = useRef<HTMLDivElement>(null);
  const sections = SECTIONS.filter((s) => inProject || !s.project);
  const active = sections.some((s) => s.id === section) ? section : 'appearance';

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;
  const title = sections.find((s) => s.id === active)!.title;
  return (
    <div className="palette-backdrop settings-backdrop" data-state={state} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className="settings" role="dialog" aria-modal="true" aria-label="Einstellungen" data-testid="settings">
        <nav className="settings-nav" aria-label="Bereiche">
          <div className="settings-head">Einstellungen</div>
          {sections.map((s) => (
            <button key={s.id} type="button" className={`settings-tab ${s.id === active ? 'on' : ''}`} aria-current={s.id === active ? 'page' : undefined} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={14} /> {s.title}
            </button>
          ))}
        </nav>
        <section className="settings-body" aria-label={title}>
          <div className="settings-title">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {active === 'appearance' && <AppearanceSection />}
          {active === 'writing' && <WritingSection />}
          {active === 'sound' && <SoundSettings title={false} />}
          {active === 'storage' && <StorageSection />}
          {active === 'keys' && <KeysSection />}
        </section>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

const WIDTHS = [
  { value: '600', label: 'Schmal' },
  { value: '680', label: 'Normal' },
  { value: '800', label: 'Breit' },
];

function AppearanceSection() {
  const theme = useTheme();
  const [a, update] = useAppearance();
  const systemReduces = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDefault = (Object.keys(APPEARANCE_DEFAULTS) as (keyof Appearance)[]).every((k) => a[k] === APPEARANCE_DEFAULTS[k]);
  return (
    <div className="settings-list">
      <Row label="Design">
        <Segmented label="Design" value={theme.mode} onChange={theme.setMode} options={[{ value: 'system', label: 'Wie System' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]} />
      </Row>
      <Row label="Schrift im Text">
        <Segmented label="Schrift" value={a.font} onChange={(font) => update({ font })} options={[{ value: 'serif', label: 'Literata' }, { value: 'sans', label: 'Inter' }]} />
      </Row>
      <Row label="Textgröße" hint={`${a.textSize} px`}>
        <input className="range" type="range" min={15} max={24} step={1} value={a.textSize} aria-label="Textgröße" onChange={(e) => update({ textSize: Number(e.target.value) })} />
      </Row>
      <Row label="Zeilenbreite">
        <Segmented label="Zeilenbreite" value={String(a.lineWidth)} onChange={(v) => update({ lineWidth: Number(v) })} options={WIDTHS} />
      </Row>
      <div className="settings-preview" aria-hidden="true">
        <p>Der Schmied hob den Kopf, als die Tür aufschwang. „Ihr seid spät“, sagte er, ohne den Hammer abzulegen.</p>
      </div>
      <Row label="Bewegung reduzieren" hint={systemReduces ? 'Das System verlangt das bereits.' : 'Keine Übergänge und Animationen'}>
        <input className="switch" type="checkbox" checked={a.motion === 'reduce' || systemReduces} disabled={systemReduces} onChange={(e) => update({ motion: e.target.checked ? 'reduce' : 'system' })} aria-label="Bewegung reduzieren" />
      </Row>
      <Row label="Startbildschirm">
        <Segmented label="Startbildschirm" value={a.splash} onChange={(splash) => update({ splash })} options={[{ value: 'full', label: 'Ganz' }, { value: 'short', label: 'Kurz' }, { value: 'off', label: 'Aus' }]} />
      </Row>
      {!isDefault && (
        <div>
          <button type="button" className="btn small" onClick={() => update(APPEARANCE_DEFAULTS)}>Darstellung zurücksetzen</button>
        </div>
      )}
    </div>
  );
}

function WritingSection() {
  const [w, update] = useWritingPrefs();
  const [focus, setFocus] = useLocalSetting('focusMode', false);
  const [sketch, setSketch] = useLocalSetting<SketchSettings>('sketch', SKETCH_DEFAULTS);
  return (
    <div className="settings-list">
      <Row label="Rechtschreibprüfung" hint="Die des Browsers, auf Deutsch">
        <input className="switch" type="checkbox" checked={w.spellcheck} onChange={(e) => update({ spellcheck: e.target.checked })} aria-label="Rechtschreibprüfung" />
      </Row>
      <Row label="Fokusmodus" hint="Nur der aktuelle Absatz ist hervorgehoben">
        <input className="switch" type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} aria-label="Fokusmodus" />
      </Row>
      <Row label="Wortziel je Szene" hint="Gilt, wenn eine Szene kein eigenes Feld „Wortziel“ hat">
        <input
          className="input settings-number"
          type="number"
          min={50}
          max={20000}
          step={50}
          value={w.wordGoal}
          aria-label="Wortziel je Szene"
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (n > 0) update({ wordGoal: n });
          }}
        />
      </Row>
      <div className="settings-group">
        <span className="label">Bleistift</span>
        <SketchOptions settings={sketch} onChange={setSketch} />
        <span className="muted small">
          Zeichnungen hängen am Absatz. Ändern sich Textgröße oder Zeilenbreite, bricht der Absatz anders um, und eine Notiz sitzt nicht mehr genau auf demselben Wort.
        </span>
      </div>
    </div>
  );
}

function StorageSection() {
  const { storage } = useSession();
  const quota = storage.usage !== undefined && storage.quota ? ` von ${formatBytes(storage.quota)}` : '';
  return (
    <div className="settings-list">
      <Row
        label="Dauerhafter Speicher"
        hint={
          storage.persisted === null
            ? 'Dieser Browser sagt nicht, ob er die Daten behält.'
            : storage.persisted
              ? 'Der Browser räumt die Daten nicht von selbst.'
              : 'Abgelehnt: Bei Platzmangel darf der Browser räumen. Abhilfe: als App installieren oder ein Lesezeichen setzen, und regelmäßig sichern.'
        }
      >
        <span className={storage.persisted === false ? 'warn-text small' : 'small'} data-testid="settings-persisted">
          {storage.persisted === null ? 'unbekannt' : storage.persisted ? 'Ja' : 'Nein'}
        </span>
      </Row>
      <Row label="Belegt" hint={`Alle Projekte und Medien in diesem Browser · Datenformat ${SCHEMA_VERSION}`}>
        <span className="small">{formatBytes(storage.usage)}{quota}</span>
      </Row>
      <BackupPanel />
    </div>
  );
}

const KEYS: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Überall',
    rows: [
      [`${MOD} K`, 'Suchen, springen und Befehle'],
      [`${MOD} ,`, 'Einstellungen'],
      [`${MOD} Alt B`, 'Linke Leiste ein- oder ausblenden'],
      [`${MOD} Alt I`, 'Rechte Leiste ein- oder ausblenden'],
      ['Esc', 'Eintauchen beenden, Fenster schließen'],
    ],
  },
  {
    group: 'Im Text',
    rows: [
      [`${MOD} B`, 'Fett'],
      [`${MOD} I`, 'Kursiv'],
      ['@', 'Auf Figur, Ort oder Item verweisen'],
    ],
  },
  {
    group: 'Bleistift',
    rows: [
      ['Strg + Ziehen', 'Zeichnen'],
      ['Strg + Rechtsklick oder Umschalt', 'Radieren'],
      ['Strg Alt + Ziehen', 'Zeichnung verschieben'],
      ['Strg Z / Strg Y', 'Letzten Strich zurück / wieder'],
    ],
  },
];

function KeysSection() {
  return (
    <div className="settings-list">
      {KEYS.map((g) => (
        <div key={g.group} className="settings-group">
          <span className="label">{g.group}</span>
          <div className="keys">
            {g.rows.map(([k, what]) => (
              <div key={k} className="keys-row">
                <span>{what}</span>
                <span className="keys-combo">
                  {k.split(' ').map((part, i) => (part === '+' || part === '/' || part === 'oder' || part === 'Ziehen' || part === 'Rechtsklick' ? <span key={i} className="muted"> {part} </span> : <kbd key={i}>{part}</kbd>))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="muted small">Die Kürzel sind fest. Freies Belegen lohnt sich bei so wenigen nicht.</span>
    </div>
  );
}
