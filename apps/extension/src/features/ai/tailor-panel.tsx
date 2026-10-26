import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import {
  resumeToText,
  reviewTailoredResume,
  type HealthResponse,
  type ReviewedEntry,
  type TailorResumeRequest,
} from '@applypilot/ai-core';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import type { AiConnection } from '../../storage/ai-connection-repository';
import { DraftMeta, FindingsList, Flags } from './draft-meta';
import { hasEdits } from '../../storage/ai-drafts-repository';
import { DiscardButton, GenerateButton, PreviousVersionNotice } from './draft-controls';
import { RESUME_PART } from './draft-parts';
import { EditableDraft } from './editable-draft';
import { SendPreview } from './send-preview';
import { useAiTask } from './use-ai-task';

function EntrySection({ title, entries }: { title: string; entries: ReviewedEntry[] }) {
  const shown = entries.filter((e) => e.bullets.length > 0);
  if (shown.length === 0) return null;
  return (
    <Card className="space-y-3">
      <CardTitle>{title}</CardTitle>
      {shown.map((entry) => (
        <div key={entry.ref} className="space-y-1.5">
          <p className="text-xs font-semibold">{entry.label}</p>
          <ul className="space-y-2">
            {entry.bullets.map((bullet) => (
              <li key={bullet.text} className="text-sm">
                <span aria-hidden>• </span>
                {bullet.text}
                <Flags flags={bullet.flags} />
                <details className="mt-0.5 text-[11px] text-muted">
                  <summary className="cursor-pointer">Based on your original</summary>
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {bullet.sources.map((source) => (
                      <li key={source}>“{source}”</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

export function TailorPanel({
  jobKey,
  request,
  connection,
  health,
}: {
  jobKey: string;
  request: TailorResumeRequest;
  connection: AiConnection;
  health: HealthResponse | null;
}) {
  const { state, run, discard, saveEdit, restorePrevious } = useAiTask('tailor-resume', jobKey);
  const edited = state.status === 'success' && hasEdits(state.draft);
  const reviewed = useMemo(
    () =>
      state.status === 'success'
        ? reviewTailoredResume(state.draft.response.output, state.draft.request.candidate)
        : null,
    [state],
  );

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <CardTitle>Tailor your resume</CardTitle>
        <CardDescription>
          Rewrites your existing bullets and summary for this job, and picks which skills to
          feature. Every bullet must come from one of yours; anything that cannot be traced is
          removed, and new numbers or skills are flagged.
        </CardDescription>
        <SendPreview task="tailor-resume" request={request} health={health} />
        <GenerateButton
          edited={edited}
          onGenerate={() => void run(connection, request)}
          disabled={state.status === 'loading'}
        >
          {state.status === 'success' ? 'Generate again' : 'Generate tailored resume'}
        </GenerateButton>
      </Card>

      {state.status === 'loading' ? (
        <Card className="space-y-2" aria-busy="true" aria-label="Generating">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </Card>
      ) : null}
      {state.status === 'error' ? (
        <Alert tone="error" title="The draft could not be generated">
          {state.message}
        </Alert>
      ) : null}

      {state.status === 'success' && reviewed ? (
        <>
          <DraftMeta response={state.draft.response} restored={state.restored} />
          <PreviousVersionNotice draft={state.draft} onRestore={() => void restorePrevious()} />
          <FindingsList findings={reviewed.findings} />
          {reviewed.summary.text ? (
            <Card className="space-y-1">
              <CardTitle>Summary</CardTitle>
              <p className="text-sm">{reviewed.summary.text}</p>
              <Flags flags={reviewed.summary.flags} />
            </Card>
          ) : null}
          <EntrySection title="Experience" entries={reviewed.experience} />
          <EntrySection title="Projects" entries={reviewed.projects} />
          {reviewed.skillsToFeature.length > 0 ? (
            <Card className="space-y-2">
              <CardTitle>Skills to feature</CardTitle>
              <div className="flex flex-wrap gap-1">
                {reviewed.skillsToFeature.map((skill) => (
                  <Badge key={skill} tone="primary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </Card>
          ) : null}
          {reviewed.changes.length > 0 ? (
            <Card className="space-y-1">
              <CardTitle>What changed</CardTitle>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                {reviewed.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          {reviewed.notShownInProfile.length > 0 ? (
            <Alert tone="warning" title="The job asks for things your profile does not show">
              <p>Add these only if they are true. ApplyPilot did not put them in your resume.</p>
              <ul className="mt-1 list-disc pl-4">
                {reviewed.notShownInProfile.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Card className="space-y-2">
            <EditableDraft
              key={state.draft.response.generatedAt}
              target={{
                task: 'tailor-resume',
                jobKey,
                generatedAt: state.draft.response.generatedAt,
                part: RESUME_PART,
              }}
              label="Tailored resume text (edit before you use it)"
              generated={resumeToText(reviewed)}
              saved={state.draft.edits?.[RESUME_PART]}
              onSave={(text) => saveEdit(state.draft.response.generatedAt, RESUME_PART, text)}
              fileName="tailored-resume.txt"
            />
          </Card>
          <DiscardButton edited={edited} onDiscard={() => void discard()} />
          <p className="flex items-center gap-1 text-[11px] text-muted">
            <FileText aria-hidden className="h-3 w-3" /> Your saved profile is unchanged. Copy what
            you want into your resume.
          </p>
        </>
      ) : null}
    </div>
  );
}
