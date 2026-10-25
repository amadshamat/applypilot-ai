import { useEffect, useId, useRef, useState } from 'react';
import { Undo2, Upload } from 'lucide-react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { CardDescription } from '../../components/ui/card';
import {
  MAX_BACKUP_BYTES,
  buildBackup,
  parseBackup,
  type ParsedBackup,
} from '../../data/backup-format';
import { PAGE_ORIGIN } from '../../data/page-state';
import {
  ImportFailedError,
  applyImport,
  loadUndo,
  planImport,
  planIsEmpty,
  readCurrent,
  undoLastImport,
  type CurrentData,
  type ImportMode,
} from '../../data/import-plan';
import {
  describeBackup,
  describePlan,
  reportImport,
  type EffectTone,
  type ImportReport,
} from '../../data/import-summary';
import { cn } from '../../lib/cn';
import { useServices } from '../../services/app-services';
import { downloadText } from '../ai/download';

type Step =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; fileName: string; backup: ParsedBackup; current: CurrentData }
  | { kind: 'importing' }
  | { kind: 'done'; report: ImportReport; backupFile: string | null };

const TONE_CLASS: Record<EffectTone, string> = {
  add: 'text-success',
  keep: 'text-muted',
  remove: 'text-danger',
};
const TONE_MARK: Record<EffectTone, string> = { add: '+', keep: '=', remove: '−' };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Settings > Your data > Import data: loads a file made by Export data,
 * checks it, previews what it would change, and applies it only after the
 * user confirms. Nothing is written before that.
 */
export function ImportData({ onImported }: { onImported?: () => void }) {
  const services = useServices();
  const { localStore, resumes } = services;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [mode, setMode] = useState<ImportMode>('merge');
  const [undoAt, setUndoAt] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  const refreshUndo = () =>
    void loadUndo(localStore).then((undo) => setUndoAt(undo ? undo.createdAt : null));
  useEffect(refreshUndo, [localStore]);

  const plan = step.kind === 'preview' ? planImport(step.backup, step.current, mode) : null;

  const chooseFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setUndoMessage(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setStep({
        kind: 'error',
        message: 'This file is larger than 60 MB, so it is not an ApplyPilot backup.',
      });
      return;
    }
    setStep({ kind: 'reading' });
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) {
        setStep({ kind: 'error', message: parsed.error });
        return;
      }
      setMode('merge');
      setStep({
        kind: 'preview',
        fileName: file.name,
        backup: parsed.backup,
        current: await readCurrent(localStore, resumes),
      });
    } catch {
      setStep({ kind: 'error', message: 'This file could not be read.' });
    }
  };

  const confirm = async () => {
    if (step.kind !== 'preview' || !plan) return;
    const { backup } = step;
    setStep({ kind: 'importing' });
    let backupFile: string | null = null;
    try {
      if (plan.mode === 'replace') {
        // A file copy of what is here now, in addition to the in-browser undo copy.
        backupFile = `applypilot-before-import-${today()}.json`;
        downloadText(
          backupFile,
          await buildBackup(localStore, resumes, { appVersion: services.appVersion }),
          'application/json',
        );
      }
      await applyImport(plan, { store: localStore, resumes, origin: PAGE_ORIGIN });
      setStep({ kind: 'done', report: reportImport(plan, backup), backupFile });
      refreshUndo();
      onImported?.();
    } catch (error) {
      setStep({
        kind: 'error',
        message:
          error instanceof ImportFailedError
            ? error.message
            : 'The import could not be started. Nothing was changed.',
      });
      refreshUndo();
    }
  };

  const undo = async () => {
    setConfirmUndo(false);
    try {
      const done = await undoLastImport({ store: localStore, resumes, origin: PAGE_ORIGIN });
      setUndoMessage(
        done
          ? 'The last import was undone. Your data is back as it was before it.'
          : 'There is no import to undo.',
      );
      setStep({ kind: 'idle' });
    } catch {
      setUndoMessage('The import could not be undone. Your data was not changed further.');
    }
    refreshUndo();
  };

  const contents = step.kind === 'preview' ? describeBackup(step.backup) : null;
  const effects = plan ? describePlan(plan) : [];
  const busy = step.kind === 'reading' || step.kind === 'importing';

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 border-t border-border pt-3">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-medium">
          Import data
        </h3>
        <CardDescription>
          Restore a file made with Export data. You see what it holds and choose how to apply it
          before anything changes.
        </CardDescription>
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={`${id}-file`}
          className={cn(
            'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium shadow-xs hover:bg-background',
            busy && 'pointer-events-none opacity-50',
          )}
        >
          <Upload aria-hidden className="h-3.5 w-3.5" /> Choose a backup file
        </label>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept="application/json,.json"
          aria-label="Backup file to import"
          className="sr-only"
          disabled={busy}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        {undoAt && step.kind !== 'preview' ? (
          confirmUndo ? (
            <>
              <Button size="sm" variant="danger" onClick={() => void undo()}>
                Yes, undo the import
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmUndo(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmUndo(true)}>
              <Undo2 aria-hidden className="h-3.5 w-3.5" /> Undo last import
            </Button>
          )
        ) : null}
      </div>
      {confirmUndo && undoAt ? (
        <p className="text-xs text-danger">
          Puts your profile, tracker, settings, AI drafts and resumes back as they were before the
          import of {new Date(undoAt).toLocaleString()}. Changes made since then are lost.
        </p>
      ) : null}

      {step.kind === 'reading' ? (
        <p role="status" className="text-xs text-muted">
          Checking the file…
        </p>
      ) : null}
      {step.kind === 'importing' ? (
        <p role="status" className="text-xs text-muted">
          Importing…
        </p>
      ) : null}
      {step.kind === 'error' ? (
        <Alert tone="error" title="Could not import this file">
          {step.message}
        </Alert>
      ) : null}
      {undoMessage ? (
        <p role="status" className="text-xs text-muted">
          {undoMessage}
        </p>
      ) : null}

      {step.kind === 'preview' && contents && plan ? (
        <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Import preview">
          <div className="space-y-1">
            <p className="text-xs font-medium">{step.fileName}</p>
            <p className="text-xs text-muted">{contents.source}</p>
            <p className="text-xs">
              <span className="font-medium">In this file: </span>
              {contents.items.length > 0
                ? contents.items.join(', ')
                : 'nothing that can be restored'}
              .
            </p>
          </div>
          {contents.problems.length > 0 ? (
            <Alert tone="warning" title="Some entries will not be imported">
              <ul className="list-disc space-y-0.5 pl-4">
                {contents.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {[
            ...contents.notes,
            ...(contents.ignored.length > 0
              ? [
                  `Not imported (belongs to the browser that made the file): ${contents.ignored.join('; ')}.`,
                ]
              : []),
          ].map((note) => (
            <p key={note} className="text-xs text-muted">
              {note}
            </p>
          ))}

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold">How should it be applied?</legend>
            <label className="flex gap-2 text-xs">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <span>
                <span className="font-medium">Merge (recommended)</span>
                <CardDescription>
                  Keeps everything here and adds only what is missing. Nothing here is changed or
                  removed.
                </CardDescription>
              </span>
            </label>
            <label className="flex gap-2 text-xs">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span>
                <span className="font-medium">Replace</span>
                <CardDescription>
                  Makes each part in the file match the file. A backup of your current data is
                  downloaded first, and the import can be undone.
                </CardDescription>
              </span>
            </label>
          </fieldset>

          <div>
            <p className="text-xs font-semibold">What will happen</p>
            {effects.length > 0 ? (
              <ul className="mt-1 space-y-0.5" aria-label="Import changes">
                {effects.map((effect) => (
                  <li
                    key={effect.text}
                    className={cn('flex gap-1.5 text-xs', TONE_CLASS[effect.tone])}
                  >
                    <span aria-hidden className="w-2 font-mono">
                      {TONE_MARK[effect.tone]}
                    </span>
                    <span>{effect.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {planIsEmpty(plan) ? (
              <p className="mt-1 text-xs text-muted">
                Nothing would change: everything in this file is already here.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={mode === 'replace' ? 'danger' : 'primary'}
              disabled={planIsEmpty(plan)}
              onClick={() => void confirm()}
            >
              {mode === 'replace' ? 'Back up and replace' : 'Import and merge'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep({ kind: 'idle' })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step.kind === 'done' ? (
        <Alert tone="success" title="Import finished">
          <div className="space-y-1">
            <p>
              <span className="font-medium">Restored: </span>
              {step.report.restored.length > 0 ? step.report.restored.join(', ') : 'nothing new'}.
            </p>
            {step.report.removed.length > 0 ? (
              <p>
                <span className="font-medium">Removed: </span>
                {step.report.removed.join(', ')}.
              </p>
            ) : null}
            {step.report.skipped.length > 0 ? (
              <p>
                <span className="font-medium">Skipped: </span>
                {step.report.skipped.join(', ')}.
              </p>
            ) : null}
            {step.report.failed.length > 0 ? (
              <p>
                <span className="font-medium">Could not be imported: </span>
                {step.report.failed.join(' ')}
              </p>
            ) : null}
            {step.backupFile ? (
              <p>Your data from before the import was downloaded as {step.backupFile}.</p>
            ) : null}
            <p>Use Undo last import to put everything back as it was.</p>
          </div>
        </Alert>
      ) : null}
    </section>
  );
}
