import { useState, type ReactNode } from 'react';
import { History, Sparkles, Trash2 } from 'lucide-react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import type { SavedDraft } from '../../storage/ai-drafts-repository';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The generate button. When the draft on screen has edits, generating again
 * asks first: the edited version is kept and can be restored afterwards.
 */
export function GenerateButton({
  edited,
  disabled,
  onGenerate,
  children,
}: {
  edited: boolean;
  disabled?: boolean;
  onGenerate: () => void;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-surface p-2">
        <p className="text-xs">
          You edited this draft. A new draft will replace it on screen; your edited version is kept
          and you can restore it afterwards.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
              onGenerate();
            }}
          >
            Generate a new draft
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep my edited draft
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button onClick={() => (edited ? setConfirming(true) : onGenerate())} disabled={disabled}>
      <Sparkles aria-hidden className="h-4 w-4" />
      {children}
    </Button>
  );
}

/** Discard, with a confirmation when the draft has edits. */
export function DiscardButton({
  edited,
  label = 'Discard draft',
  onDiscard,
}: {
  edited: boolean;
  label?: string;
  onDiscard: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-danger">Delete this draft and your edits?</span>
        <Button size="sm" variant="danger" onClick={onDiscard}>
          Yes, discard
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={() => (edited ? setConfirming(true) : onDiscard())}>
      <Trash2 aria-hidden className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}

/** Shown after generating again over an edited draft. */
export function PreviousVersionNotice({
  draft,
  onRestore,
}: {
  draft: SavedDraft;
  onRestore: () => void;
}) {
  if (!draft.previous) return null;
  const when = draft.previous.editedAt ?? draft.previous.savedAt;
  return (
    <Alert
      tone="info"
      title="Your edited version is kept"
      action={
        <Button size="sm" variant="secondary" onClick={onRestore}>
          <History aria-hidden className="h-3.5 w-3.5" /> Restore my edited version
        </Button>
      }
    >
      The draft you edited (last changed {dateFormat.format(new Date(when))}) was replaced by this
      new one. Restoring it brings your edits back
      {draft.edits
        ? ' and keeps this new draft, with its edits, as the version you can switch back to'
        : '; this new draft, which you have not edited, is then discarded'}
      .
    </Alert>
  );
}
