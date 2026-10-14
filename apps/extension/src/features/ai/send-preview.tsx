import {
  PROMPTS,
  formatUsd,
  worstCaseCostUsd,
  type AiTask,
  type CandidateContext,
  type HealthResponse,
  type TaskTypes,
} from '@applypilot/ai-core';

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function candidateSummary(candidate: CandidateContext): string {
  const parts = [
    candidate.name ? 'your name' : '',
    candidate.summary ? 'your summary' : '',
    candidate.experience.length
      ? `${count(candidate.experience.length, 'role')} with their bullets`
      : '',
    candidate.projects.length ? count(candidate.projects.length, 'project') : '',
    candidate.education.length
      ? count(candidate.education.length, 'education entry', 'education entries')
      : '',
    candidate.certifications.length ? count(candidate.certifications.length, 'certification') : '',
    candidate.skills.length ? count(candidate.skills.length, 'skill') : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'nothing from your profile';
}

/**
 * Shows exactly what a request will contain before the user sends it, and
 * what it may cost. Nothing is sent until the user presses Generate.
 */
export function SendPreview<T extends AiTask>({
  task,
  request,
  health,
}: {
  task: T;
  request: TaskTypes[T]['request'];
  health: HealthResponse | null;
}) {
  const prompt = PROMPTS[task] as {
    system: string;
    maxTokens: number;
    buildUserMessage: (r: TaskTypes[T]['request']) => string;
  };
  const chars = prompt.system.length + prompt.buildUserMessage(request).length;
  const worst =
    health?.provider === 'anthropic'
      ? worstCaseCostUsd(health.model, chars, prompt.maxTokens)
      : null;
  const { job, candidate } = request;

  return (
    <details className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">What will be sent</summary>
      <div className="mt-2 space-y-1.5 text-muted">
        <p>
          <span className="font-medium text-foreground">From the job:</span>{' '}
          {job.title || 'the title'}
          {job.company ? ` at ${job.company}` : ''}, the description (
          {job.description.length.toLocaleString()} characters) and the listed qualifications and
          skills.
        </p>
        <p>
          <span className="font-medium text-foreground">From your profile:</span>{' '}
          {candidateSummary(candidate)}.
        </p>
        <p>
          <span className="font-medium text-foreground">Never sent:</span> email, phone, location,
          links, GPA, job preferences, salary expectations and resume files.
        </p>
        <p>
          <span className="font-medium text-foreground">Sent to:</span>{' '}
          {health?.provider === 'anthropic'
            ? `your ApplyPilot API, which forwards it to Claude (${health.model}) using your Anthropic account. Estimated cost: up to ${worst === null ? 'an unknown amount' : formatUsd(worst)} for this request, usually less.`
            : health?.provider === 'mock'
              ? 'your ApplyPilot API in mock mode. It stays on your computer and costs nothing.'
              : 'your ApplyPilot API.'}
        </p>
        <details>
          <summary className="cursor-pointer">Show the exact data</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface p-2 text-[10px] leading-snug whitespace-pre-wrap">
            {JSON.stringify(request, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
