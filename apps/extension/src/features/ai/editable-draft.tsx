import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/field';
import { cn } from '../../lib/cn';
import { clearBuffered, readBuffered, writeBuffered, type EditTarget } from './edit-buffer';
import { OutputActions } from './output-actions';

/** How long typing pauses before the text is stored. */
export const SAVE_DELAY_MS = 600;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'replaced';

/**
 * One editable part of an AI draft. Edits are saved automatically, per part,
 * next to the generated text, so they survive closing the panel and restarting
 * Chrome, and "Revert to generated text" can bring the original back.
 */
export function EditableDraft({
  target,
  label,
  generated,
  saved,
  onSave,
  fileName,
  rows = 14,
}: {
  target: EditTarget;
  label: string;
  /** The generated (reviewed) text of this part. */
  generated: string;
  /** The stored edit of this part, if any. */
  saved: string | undefined;
  /** Stores the text (null: back to the generated text); false if the draft was replaced. */
  onSave: (text: string | null) => Promise<boolean>;
  fileName?: string;
  rows?: number;
}) {
  const id = useId();
  // A change left in the page's copy (the panel closed before it was stored) wins.
  const [initial] = useState(() => readBuffered(target) ?? saved ?? generated);
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>(() =>
    initial !== (saved ?? generated) ? 'saving' : 'idle',
  );
  const [confirmRevert, setConfirmRevert] = useState(false);
  const pending = useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const latest = useRef({ target, generated, onSave });
  useEffect(() => {
    latest.current = { target, generated, onSave };
  });

  const store = async (value: string) => {
    const { target: t, generated: g, onSave: save } = latest.current;
    try {
      const ok = await save(value === g ? null : value);
      clearBuffered(t, value);
      // A newer keystroke is already waiting; it reports its own result.
      if (pending.current) return;
      setStatus(ok ? 'saved' : 'replaced');
    } catch {
      setStatus('error');
    }
  };

  const flush = () => {
    const job = pending.current;
    if (!job) return;
    clearTimeout(job.timer);
    pending.current = null;
    void store(job.text);
  };

  const schedule = (value: string) => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { text: value, timer: setTimeout(flush, SAVE_DELAY_MS) };
  };

  // Stores a change recovered from the page's copy, and flushes on close.
  useEffect(() => {
    if (initial !== (saved ?? generated)) schedule(initial);
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
    // Runs once per mounted draft part; the panels key this component by draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (value: string) => {
    setText(value);
    setConfirmRevert(false);
    writeBuffered(target, value);
    setStatus('saving');
    schedule(value);
  };

  const revert = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    clearBuffered(target);
    setConfirmRevert(false);
    setText(generated);
    setStatus('saving');
    void store(generated);
  };

  const edited = text !== generated;
  const statusText =
    status === 'saving'
      ? 'Saving…'
      : status === 'error'
        ? 'Could not save your edits. They are kept in this window; copy them to be safe.'
        : status === 'replaced'
          ? 'This draft was replaced or deleted, so these edits were not saved. Copy them if you need them.'
          : edited || status === 'saved'
            ? 'All changes saved'
            : 'Edits are saved automatically';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium">
          {label}
        </label>
        <span
          role="status"
          aria-live="polite"
          className={cn(
            'text-[11px]',
            status === 'error' || status === 'replaced' ? 'text-danger' : 'text-muted',
          )}
        >
          {edited ? <span className="font-medium">Edited · </span> : null}
          {statusText}
        </span>
      </div>
      <Textarea id={id} value={text} rows={rows} onChange={(e) => change(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <OutputActions text={text} {...(fileName ? { fileName } : {})} />
        {edited && !confirmRevert ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmRevert(true)}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Revert to generated text
          </Button>
        ) : null}
      </div>
      {confirmRevert ? (
        <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-surface p-2">
          <p className="text-xs">
            Discard your edits to this text and go back to the generated draft?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={revert}>
              Yes, discard my edits
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRevert(false)}>
              Keep my edits
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
