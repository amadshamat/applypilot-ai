import { useId, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  classifyQuestion,
  explainClassification,
  reviewScreeningAnswers,
  splitQuestions,
  type CandidateContext,
  type HealthResponse,
  type JobContext,
  type ScreeningQuestion,
} from '@applypilot/ai-core';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Textarea } from '../../components/ui/field';
import { Skeleton } from '../../components/ui/skeleton';
import type { AiConnection } from '../../storage/ai-connection-repository';
import { hasEdits } from '../../storage/ai-drafts-repository';
import { DiscardButton, GenerateButton, PreviousVersionNotice } from './draft-controls';
import { EditableDraft } from './editable-draft';
import { DraftMeta, FindingsList, Flags } from './draft-meta';
import { SendPreview } from './send-preview';
import { useAiTask } from './use-ai-task';

const MAX_QUESTIONS = 15;

export function ScreeningPanel({
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
  const [input, setInput] = useState('');
  const { state, run, discard, saveEdit, restorePrevious } = useAiTask('screening-answers', jobKey);
  const edited = state.status === 'success' && hasEdits(state.draft);

  const parsed = useMemo(
    () =>
      splitQuestions(input).map((text, i) => ({
        id: `Q${i + 1}`,
        text: text.slice(0, 1000),
        classification: classifyQuestion(text),
      })),
    [input],
  );
  // Only questions ApplyPilot may draft are ever sent.
  const draftable: ScreeningQuestion[] = parsed
    .filter((q) => q.classification.category === 'draftable')
    .map(({ id: questionId, text }) => ({ id: questionId, text }));
  const tooMany = parsed.length > MAX_QUESTIONS;
  const request = { job, candidate, questions: draftable };

  const reviewed = useMemo(
    () =>
      state.status === 'success'
        ? reviewScreeningAnswers(
            state.draft.response.output,
            state.draft.request.questions,
            state.draft.request.candidate,
            state.draft.request.job,
          )
        : null,
    [state],
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div>
          <CardTitle>Draft screening answers</CardTitle>
          <CardDescription>
            Paste the application&apos;s questions, one per line. Questions about work
            authorization, legal matters, demographics, pay or availability are never sent; you
            answer those yourself.
          </CardDescription>
        </div>
        <Field id={`${id}-questions`} label="Questions">
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={input}
              placeholder={'Why do you want to work here?\nDescribe a project you are proud of.'}
              onChange={(e) => setInput(e.target.value)}
            />
          )}
        </Field>
        {parsed.length > 0 ? (
          <ul className="space-y-1" aria-label="Questions found">
            {parsed.map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-xs">
                {q.classification.category === 'draftable' ? (
                  <Badge tone="primary">Can draft</Badge>
                ) : (
                  <Badge tone="warning">You answer</Badge>
                )}
                <span>
                  {q.text}
                  {q.classification.category === 'draftable' ? null : (
                    <span className="block text-[11px] text-muted">
                      {explainClassification(q.classification)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {tooMany ? (
          <Alert tone="warning" title="Too many questions">
            Paste up to {MAX_QUESTIONS} questions at a time.
          </Alert>
        ) : null}
        {draftable.length > 0 && !tooMany ? (
          <SendPreview task="screening-answers" request={request} health={health} />
        ) : null}
        <GenerateButton
          edited={edited}
          onGenerate={() => void run(connection, request)}
          disabled={state.status === 'loading' || draftable.length === 0 || tooMany}
        >
          Draft {draftable.length === 1 ? '1 answer' : `${draftable.length} answers`}
        </GenerateButton>
      </Card>

      {state.status === 'loading' ? (
        <Card className="space-y-2" aria-busy="true" aria-label="Generating">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="error" title="The drafts could not be generated">
          {state.message}
        </Alert>
      ) : null}

      {state.status === 'success' && reviewed ? (
        <div className="space-y-3">
          <DraftMeta response={state.draft.response} restored={state.restored} />
          <PreviousVersionNotice draft={state.draft} onRestore={() => void restorePrevious()} />
          <FindingsList findings={reviewed.findings} />
          {state.draft.response.skipped.map((s) => (
            <Alert key={s.questionId} tone="warning" title="Not drafted">
              {s.reason}
            </Alert>
          ))}
          {reviewed.answers.map((answer) => (
            <Card key={answer.questionId} className="space-y-2">
              <CardTitle>{answer.question}</CardTitle>
              {answer.answer ? (
                <>
                  <Flags flags={answer.flags} />
                  <EditableDraft
                    key={state.draft.response.generatedAt}
                    target={{
                      task: 'screening-answers',
                      jobKey,
                      generatedAt: state.draft.response.generatedAt,
                      part: answer.questionId,
                    }}
                    label="Draft answer (edit before you use it)"
                    generated={answer.answer}
                    saved={state.draft.edits?.[answer.questionId]}
                    onSave={(text) =>
                      saveEdit(state.draft.response.generatedAt, answer.questionId, text)
                    }
                    rows={6}
                  />
                </>
              ) : (
                <p className="flex items-center gap-1 text-xs text-muted">
                  <ShieldAlert aria-hidden className="h-3.5 w-3.5" /> No draft. Answer this
                  yourself.
                </p>
              )}
              {answer.needsYourInput ? (
                <p className="text-[11px] text-warning">Add yourself: {answer.needsYourInput}</p>
              ) : null}
              {answer.sources.length > 0 ? (
                <p className="text-[11px] text-muted">Draws on: {answer.sources.join('; ')}</p>
              ) : null}
            </Card>
          ))}
          <DiscardButton edited={edited} label="Discard drafts" onDiscard={() => void discard()} />
        </div>
      ) : null}
    </div>
  );
}
