import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useProject } from './state';
import { BackupError, backupFileName, createBackupZipWithMedia, readBackupContents, restoreBackupData, type BackupContents } from '../store/backup';
import { getOriginal } from '../store/blobs';
import { storeBackupMedia } from '../store/media';
import { migrate } from '../store/migrate';
import {
  chooseFolder,
  folderState,
  forgetFolder,
  getLocalBackup,
  listLocalBackups,
  regrantFolder,
  saveLocalBackup,
  writeToFolder,
  type BackupReason,
  type FolderState,
  type LocalBackupMeta,
} from '../store/autoBackup';
import { formatBytes } from '../store/storage';

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const REASONS: Record<BackupReason, string> = {
  auto: 'automatisch',
  manuell: 'manuell',
  'vor-wiederherstellen': 'vor dem Wiederherstellen',
  'vor-migration': 'vor einem Update',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

type Pending =
  | { kind: 'zip'; label: string; contents: BackupContents }
  | { kind: 'legacy'; label: string; update: Uint8Array };

/** Sicherung und Wiederherstellung (SY-02, EX-02). */
export function BackupPanel() {
  const project = useProject();
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<LocalBackupMeta[]>([]);
  const [folder, setFolder] = useState<FolderState>({ kind: 'none' });
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLocal(await listLocalBackups().catch(() => []));
    setFolder(await folderState().catch((): FolderState => ({ kind: 'unsupported' })));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fail = (e: unknown) => setMessage(e instanceof BackupError ? e.message + '.' : 'Das hat nicht geklappt.');

  const pickFile = async (f: File) => {
    setMessage(null);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (f.name.endsWith('.narratio')) {
      setPending({ kind: 'legacy', label: `„${f.name}“ (altes Format)`, update: bytes });
      return;
    }
    try {
      const contents = readBackupContents(bytes);
      const { data, media } = contents;
      const mediaNote = data.media?.length ? ` und ${media.size} von ${data.media.length} Mediendateien` : '';
      setPending({ kind: 'zip', label: `„${f.name}“ vom ${when(data.createdAt)} mit ${data.items.length} Einträgen${mediaNote}`, contents });
    } catch (e) {
      fail(e);
    }
  };

  const confirmRestore = async () => {
    if (!pending) return;
    try {
      await saveLocalBackup(project, 'vor-wiederherstellen');
      let note = '';
      if (pending.kind === 'zip') {
        const { corrupt } = await storeBackupMedia(pending.contents.media, pending.contents.data.media ?? []);
        if (corrupt.length) note = ` ${corrupt.length} beschädigte Mediendatei(en) wurden übersprungen: ${corrupt.join(', ')}.`;
        restoreBackupData(project, pending.contents.data);
      } else Y.applyUpdate(project.doc, pending.update);
      migrate(project);
      setMessage(`${pending.label} wiederhergestellt. Der vorherige Stand liegt unten unter „vor dem Wiederherstellen“.${note}`);
    } catch (e) {
      fail(e);
    }
    setPending(null);
    await refresh();
  };

  const restoreLocal = async (b: LocalBackupMeta) => {
    const zip = await getLocalBackup(b.createdAt);
    if (!zip) return;
    try {
      setPending({ kind: 'zip', label: `Die Sicherung vom ${when(b.createdAt)}`, contents: readBackupContents(zip) });
    } catch (e) {
      fail(e);
    }
  };

  const downloadFull = async () => {
    setMessage('Sicherung wird erstellt …');
    const { zip, missing } = await createBackupZipWithMedia(project, getOriginal);
    download(backupFileName(project), zip, 'application/zip');
    setMessage(missing.length ? `Heruntergeladen. ${missing.length} Mediendatei(en) fehlen auf diesem Gerät: ${missing.join(', ')}.` : null);
  };

  const downloadLocal = async (b: LocalBackupMeta) => {
    const zip = await getLocalBackup(b.createdAt);
    if (zip) download(b.name, zip, 'application/zip');
  };

  return (
    <div className="field">
      <span className="label">Sicherung</span>
      <p className="muted small" style={{ margin: 0, maxWidth: 680, lineHeight: 1.6 }}>
        Eine Sicherung ist ein ZIP, das sich auch ohne narratio lesen lässt: Szenen und Lore als Markdown, Medien als Originaldateien, dazu der vollständige Stand als JSON.
        narratio sichert automatisch alle 15 Minuten, wenn sich etwas geändert hat, und behält die letzten 30 Tage. Diese automatischen Sicherungen im Browser enthalten die Medien nicht, nur ihre Liste; im Sicherungsordner liegen die Medien einmal im Unterordner „Medien“.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn small" onClick={() => void downloadFull()}>
          Sicherung herunterladen
        </button>
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Sicherung einlesen …</button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.narratio"
          hidden
          data-testid="backup-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {pending && (
        <div className="confirm" role="alertdialog" aria-label="Wiederherstellen bestätigen">
          <span style={{ flex: 1, minWidth: 240 }}>
            {pending.kind === 'zip'
              ? `${pending.label} ersetzt den aktuellen Stand vollständig.`
              : `${pending.label} wird mit dem aktuellen Stand zusammengeführt.`}{' '}
            Der aktuelle Stand wird vorher gesichert.
          </span>
          <button type="button" className="btn small primary" onClick={() => void confirmRestore()}>Wiederherstellen</button>
          <button type="button" className="btn small" onClick={() => setPending(null)}>Abbrechen</button>
        </div>
      )}
      {message && <span className="muted small" data-testid="backup-message">{message}</span>}

      <span className="label" style={{ marginTop: 10 }}>Sicherungsordner auf der Festplatte</span>
      {folder.kind === 'unsupported' && (
        <p className="muted small" style={{ margin: 0, maxWidth: 680, lineHeight: 1.6 }}>
          Dieser Browser kann nicht selbst in einen Ordner schreiben (nur Chrome und Edge). Die automatischen Sicherungen liegen im Browser und verschwinden mit ihm; bitte regelmäßig herunterladen.
        </p>
      )}
      {folder.kind === 'none' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted small">Noch kein Ordner. Mit Ordner legt narratio dort täglich ein ZIP ab, zum Beispiel in einem Cloud-Ordner.</span>
          <button type="button" className="btn small" onClick={() => void chooseFolder().then(setFolder).catch(() => undefined)}>Ordner wählen …</button>
        </div>
      )}
      {folder.kind === 'needs-permission' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="warn-text small">„{folder.name}“ braucht nach dem Neustart wieder deine Freigabe.</span>
          <button type="button" className="btn small" onClick={() => void regrantFolder().then(setFolder)}>Freigeben</button>
          <button type="button" className="btn small" onClick={() => void forgetFolder().then(refresh)}>Ordner entfernen</button>
        </div>
      )}
      {folder.kind === 'ready' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="small">
            „{folder.name}“{folder.lastWrite ? `, zuletzt ${when(folder.lastWrite)}` : ', noch nichts geschrieben'}
          </span>
          <button type="button" className="btn small" onClick={() => void writeToFolder(project).then(refresh)}>Jetzt sichern</button>
          <button type="button" className="btn small" onClick={() => void forgetFolder().then(refresh)}>Ordner entfernen</button>
        </div>
      )}

      <span className="label" style={{ marginTop: 10 }}>Automatische Sicherungen im Browser</span>
      {local.length === 0 ? (
        <span className="muted small">Noch keine. Die erste entsteht einige Sekunden nach dem Start.</span>
      ) : (
        <div className="backup-list" data-testid="backup-list">
          {local.map((b) => (
            <div key={b.createdAt} className="backup-row">
              <span className="when">{when(b.createdAt)}</span>
              <span className="why">{REASONS[b.reason]} · {formatBytes(b.size)}</span>
              <button type="button" className="btn small" onClick={() => void downloadLocal(b)}>Herunterladen</button>
              <button type="button" className="btn small" onClick={() => void restoreLocal(b)}>Wiederherstellen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
