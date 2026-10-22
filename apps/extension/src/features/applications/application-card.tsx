import { useId, useState } from 'react';
import { BellRing, ChevronDown, ExternalLink, Trash2 } from 'lucide-react';
import {
  APPLICATION_STAGES,
  type ApplicationRecord,
  type ApplicationStage,
} from '@applypilot/shared';
import {
  STAGE_LABELS,
  addDays,
  addNote,
  appliedAt,
  isClosed,
  removeNote,
  setFollowUp,
  setStatus,
} from '@applypilot/tracking';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Select, Textarea } from '../../components/ui/field';
import { cn } from '../../lib/cn';
import { STAGE_TONES, formatDay } from './format';
import { clock, dayOf, today } from './use-applications';

function FollowUpEditor({
  record,
  onSave,
}: {
  record: ApplicationRecord;
  onSave: (record: ApplicationRecord) => void;
}) {
  const id = useId();
  const [due, setDue] = useState(record.followUp?.due ?? '');
  const [note, setNote] = useState(record.followUp?.note ?? '');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(due);
  const save = (day: string) => {
    setDue(day);
    onSave(setFollowUp(record, { due: day, note: note.trim().slice(0, 300) }, clock.now()));
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium">Follow-up reminder</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          id={`${id}-due`}
          type="date"
          aria-label="Follow-up date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="w-auto"
        />
        <Input
          aria-label="Follow-up note"
          placeholder="What to do (optional)"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" disabled={!valid} onClick={() => save(due)}>
          Save reminder
        </Button>
        <Button size="sm" variant="ghost" onClick={() => save(addDays(today(), 7))}>
          In 1 week
        </Button>
        {record.followUp ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDue('');
              setNote('');
              onSave(setFollowUp(record, null, clock.now()));
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

function Notes({
  record,
  onSave,
}: {
  record: ApplicationRecord;
  onSave: (record: ApplicationRecord) => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Notes</p>
      <Textarea
        aria-label="New note"
        placeholder="Recruiter name, interview prep, what you sent…"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!text.trim()}
        onClick={() => {
          onSave(addNote(record, text, clock));
          setText('');
        }}
      >
        Add note
      </Button>
      {record.notes.length > 0 ? (
        <ul className="space-y-1">
          {record.notes.map((note) => (
            <li
              key={note.id}
              className="flex items-start gap-2 rounded-md bg-surface-muted p-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted">{formatDay(dayOf(note.at))}</p>
                <p className="whitespace-pre-wrap break-words">{note.text}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete note from ${formatDay(dayOf(note.at))}`}
                onClick={() => onSave(removeNote(record, note.id, clock.now()))}
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ApplicationCard({
  record,
  open,
  onToggle,
  onSave,
  onRemove,
}: {
  record: ApplicationRecord;
  open: boolean;
  onToggle: () => void;
  onSave: (record: ApplicationRecord) => void;
  onRemove: (id: string) => void;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const { job } = record;
  const sent = appliedAt(record);
  const due = record.followUp && !isClosed(record) && record.followUp.due <= today();
  const name = job.company ? `${job.title} at ${job.company}` : job.title;

  return (
    <Card className="space-y-2" aria-label={name} role="article">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={job.title}>
            {job.title}
          </p>
          <p className="truncate text-xs text-muted">
            {[job.company, job.location].filter(Boolean).join(' · ') || 'No company entered'}
          </p>
        </div>
        <Badge tone={STAGE_TONES[record.status]}>{STAGE_LABELS[record.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>Saved {formatDay(dayOf(record.createdAt))}</span>
        {sent ? <span>Applied {formatDay(dayOf(sent))}</span> : null}
        {record.matchScore !== null ? <span>Match {record.matchScore}</span> : null}
        {record.followUp ? (
          <span className={cn('inline-flex items-center gap-1', due && 'font-medium text-warning')}>
            <BellRing aria-hidden className="h-3 w-3" />
            {due ? 'Follow up now' : `Follow up ${formatDay(record.followUp.due)}`}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Select
          aria-label={`Status for ${job.title}`}
          value={record.status}
          onChange={(e) =>
            onSave(setStatus(record, e.target.value as ApplicationStage, clock.now()))
          }
          className="flex-1"
        >
          {APPLICATION_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          onClick={onToggle}
        >
          Details
          <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />
        </Button>
      </div>

      {open ? (
        <div id={`${id}-details`} className="space-y-3 border-t border-border pt-2">
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline"
            >
              Open the posting <ExternalLink aria-hidden className="h-3 w-3" />
            </a>
          ) : null}
          {job.pay ? <p className="text-xs">Pay: {job.pay}</p> : null}
          <FollowUpEditor record={record} onSave={onSave} />
          <Notes record={record} onSave={onSave} />
          <div className="space-y-1">
            <p className="text-xs font-medium">Status history</p>
            <ol className="space-y-0.5 text-[11px] text-muted">
              {record.history.map((h) => (
                <li key={`${h.at}-${h.status}`}>
                  {formatDay(dayOf(h.at))}: {STAGE_LABELS[h.status]}
                </li>
              ))}
            </ol>
          </div>
          {confirming ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-danger">Delete this application and its notes?</span>
              <Button size="sm" variant="danger" onClick={() => onRemove(record.id)}>
                Yes, delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
