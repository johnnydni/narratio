import { useMemo, useState } from 'react';
import { LORE_KINDS } from '../model/types';
import { exportUnreal, loreToCsv } from '../model/exportUnreal';
import { useItems, useNav, useProject, useWorld } from './state';
import { Icon } from './icons';
import { BackupPanel, download } from './BackupPanel';

/** Prüfen und exportieren (LR-06, EX-02, EX-03, EX-05). */
export function ExportView() {
  const project = useProject();
  const items = useItems();
  useWorld();
  const nav = useNav();
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => exportUnreal(project.snapshot()), [items, tick]);
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const json = result.data ? JSON.stringify(result.data, null, 2) : '';
  const title = (id?: string) => items.find((i) => i.id === id)?.title;
  const base = project.name.replace(/[^A-Za-z0-9]+/g, '_') || 'narratio';

  return (
    <div className="sheet">
      <div className="sheet-page">
        <div>
          <h1 className="h1">Prüfen und exportieren</h1>
          <p className="lead">Vor dem Export prüft narratio das ganze Projekt: fehlende Fallbacks, tote Verweise, unbekannte Variablen, doppelte Export-IDs. Fehler blockieren den Export, Hinweise nicht.</p>
        </div>

        <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {errors.length === 0 ? (
            <span className="ok-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Icon name="check" /> Bereit für Unreal</span>
          ) : (
            <span className="err-text">{errors.length} Fehler verhindern den Export</span>
          )}
          {warnings.length > 0 && <span className="warn-text">{warnings.length} Hinweise</span>}
          <span className="spacer" />
          <button type="button" className="btn small" onClick={() => setTick(tick + 1)}>Erneut prüfen</button>
          <button type="button" className="btn small primary" disabled={!result.ok} onClick={() => download(`${base}.unreal.json`, json, 'application/json')}>
            <Icon name="export" size={13} /> Unreal-JSON herunterladen
          </button>
        </div>

        {result.issues.length > 0 && (
          <div className="issues">
            {[...errors, ...warnings].map((i, k) => (
              <button key={k} type="button" className="issue" onClick={() => i.itemId && nav.go({ kind: 'item', id: i.itemId })}>
                <span className={`sev ${i.severity}`} />
                <span><strong style={{ fontWeight: 500 }}>{title(i.itemId) ?? 'Projekt'}</strong> · {i.message}</span>
              </button>
            ))}
          </div>
        )}

        <div className="field">
          <span className="label">Lore als CSV für Unreal Data Tables</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LORE_KINDS.filter((k) => items.some((i) => i.loreKind === k.kind)).map((k) => (
              <button key={k.kind} type="button" className="btn small" onClick={() => download(`${base}.${k.kind}.csv`, loreToCsv(items, k.kind), 'text/csv')}>
                {k.plural}
              </button>
            ))}
          </div>
        </div>

        <BackupPanel />

        {result.ok && (
          <div className="field">
            <span className="label">Vorschau des Exports</span>
            <pre className="code" data-testid="export-preview">{json}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
