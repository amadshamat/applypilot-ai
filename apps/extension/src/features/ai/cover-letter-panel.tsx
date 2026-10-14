import { useId, useMemo, useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import {
  coverLetterToText,
  reviewCoverLetter,
  type CandidateContext,
  type CoverLetterOptions,
  type CoverLetterRequest,
  type HealthResponse,
  type JobContext,
} from '@applypilot/ai-core';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/skeleton';
import type { AiConnection } from '../../storage/ai-connection-repository';
import { DraftMeta, FindingsList } from './draft-meta';
import { OutputActions } from './output-actions';
import { SendPreview } from './send-preview';
import { useAiTask } from './use-ai-task';

/** The draft as an editable text box. Edits stay on screen; copy or download to keep them. */
export function EditableDraft({
  label,
  initial,
  fileName,
  rows = 14,
}: {
  label: string;
  initial: string;
  fileName?: string;
  rows?: number;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <Textarea id={id} value={text} rows={rows} onChange={(e) => setText(e.target.value)} />
      <OutputActions text={text} {...(fileName ? { fileName } : {})} />
    </div>
  );
}

export function CoverLetterPanel({
  jobKey,
  job,
  candidate,
  connection,
  health,
}: {
  jobKey: string;
  job: JobContext;
  candidate: CandidateContext;
  connection: AiConnection;
  health: HealthResponse | null;
}) {
  const id = useId();
  const [options, setOptions] = useState<CoverLetterOptions>({
    tone: 'professional',
    length: 'standard',
    notes: '',
  });
  const request: CoverLetterRequest = { job, candidate, options };
  const { state, run, discard } = useAiTask('cover-letter', jobKey);
  const reviewed = useMemo(
    () =>
      state.status === 'success'
        ? reviewCoverLetter(
            state.draft.response.output,
            state.draft.request.candidate,
            state.draft.request.job,
            state.draft.request.options.notes,
          )
        : null,
    [state],
  );
  const flagged = reviewed?.paragraphs.flatMap((p, i) =>
    p.flags.map((flag) => `Paragraph ${i + 1}: ${flag}`),
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div>
          <CardTitle>Write a cover letter</CardTitle>
          <CardDescription>
            Connects your real experience to what this job asks for. Add anything personal you want
            mentioned, such as why this company; the letter uses only your profile and these notes.
          </CardDescription>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${id}-tone`} label="Tone">
            {(props) => (
              <Select
                {...props}
                value={options.tone}
                onChange={(e) =>
                  setOptions({ ...options, tone: e.target.value as CoverLetterOptions['tone'] })
                }
              >
                <option value="professional">Professional</option>
                <option value="warm">Warm</option>
                <option value="concise">Concise</option>
              </Select>
            )}
          </Field>
          <Field id={`${id}-length`} label="Length">
            {(props) => (
              <Select
                {...props}
                value={options.length}
                onChange={(e) =>
                  setOptions({ ...options, length: e.target.value as CoverLetterOptions['length'] })
                }
              >
                <option value="short">Short</option>
                <option value="standard">Standard</option>
              </Select>
            )}
          </Field>
        </div>
        <Field
          id={`${id}-notes`}
          label="Your notes (optional)"
          hint="Facts only you know, for example why you want this job. Sent with the request."
        >
          {(props) => (
            <Textarea
              {...props}
              value={options.notes}
              maxLength={1000}
              onChange={(e) => setOptions({ ...options, notes: e.target.value })}
            />
          )}
        </Field>
        <SendPreview task="cover-letter" request={request} health={health} />
        <Button onClick={() => void run(connection, request)} disabled={state.status === 'loading'}>
          <Sparkles aria-hidden className="h-4 w-4" />
          {state.status === 'success' ? 'Generate again' : 'Generate cover letter'}
        </Button>
      </Card>

      {state.status === 'loading' ? (
        <Card className="space-y-2" aria-busy="true" aria-label="Generating">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="error" title="The draft could not be generated">
          {state.message}
        </Alert>
      ) : null}

      {state.status === 'success' && reviewed ? (
        <Card className="space-y-3">
          <DraftMeta response={state.draft.response} restored={state.restored} />
          <FindingsList findings={reviewed.findings} />
          {flagged && flagged.length > 0 ? (
            <Alert tone="warning" title="Check before you use this letter">
              <ul className="list-disc space-y-0.5 pl-4">
                {flagged.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <EditableDraft
            key={state.draft.response.generatedAt}
            label="Cover letter (edit before you use it)"
            initial={coverLetterToText(reviewed)}
            fileName="cover-letter.txt"
          />
          {reviewed.sources.length > 0 ? (
            <p className="text-[11px] text-muted">Draws on: {reviewed.sources.join('; ')}</p>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void discard()}>
            <Trash2 aria-hidden className="h-3.5 w-3.5" /> Discard draft
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
