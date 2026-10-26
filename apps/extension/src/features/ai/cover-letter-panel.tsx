import { useId, useMemo, useState } from 'react';
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
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Select, Textarea } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/skeleton';
import type { AiConnection } from '../../storage/ai-connection-repository';
import { hasEdits } from '../../storage/ai-drafts-repository';
import { DiscardButton, GenerateButton, PreviousVersionNotice } from './draft-controls';
import { DraftMeta, FindingsList } from './draft-meta';
import { COVER_LETTER_PART } from './draft-parts';
import { EditableDraft } from './editable-draft';
import { SendPreview } from './send-preview';
import { useAiTask } from './use-ai-task';

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
  const { state, run, discard, saveEdit, restorePrevious } = useAiTask('cover-letter', jobKey);
  const edited = state.status === 'success' && hasEdits(state.draft);
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
        <GenerateButton
          edited={edited}
          onGenerate={() => void run(connection, request)}
          disabled={state.status === 'loading'}
        >
          {state.status === 'success' ? 'Generate again' : 'Generate cover letter'}
        </GenerateButton>
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
          <PreviousVersionNotice draft={state.draft} onRestore={() => void restorePrevious()} />
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
            target={{
              task: 'cover-letter',
              jobKey,
              generatedAt: state.draft.response.generatedAt,
              part: COVER_LETTER_PART,
            }}
            label="Cover letter (edit before you use it)"
            generated={coverLetterToText(reviewed)}
            saved={state.draft.edits?.[COVER_LETTER_PART]}
            onSave={(text) => saveEdit(state.draft.response.generatedAt, COVER_LETTER_PART, text)}
            fileName="cover-letter.txt"
          />
          {reviewed.sources.length > 0 ? (
            <p className="text-[11px] text-muted">Draws on: {reviewed.sources.join('; ')}</p>
          ) : null}
          <DiscardButton edited={edited} onDiscard={() => void discard()} />
        </Card>
      ) : null}
    </div>
  );
}
