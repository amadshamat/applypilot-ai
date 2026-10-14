import type { Finding, TaskResponse, AiTask } from '@applypilot/ai-core';
import { formatUsd } from '@applypilot/ai-core';
import { Alert } from '../../components/ui/alert';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Who drafted this, with which prompt version, and what it cost. */
export function DraftMeta({
  response,
  restored,
}: {
  response: TaskResponse<AiTask>;
  restored: boolean;
}) {
  const parts =
    response.provider === 'mock'
      ? ['Mock draft (free, made offline)']
      : [
          `Drafted by ${response.model}`,
          response.usage
            ? `${response.usage.inputTokens.toLocaleString()} in / ${response.usage.outputTokens.toLocaleString()} out tokens`
            : '',
          response.usage?.estimatedCostUsd != null
            ? `about ${formatUsd(response.usage.estimatedCostUsd)}`
            : '',
        ];
  parts.push(`prompt ${response.promptVersion}`);
  parts.push(
    `${restored ? 'saved' : 'generated'} ${dateFormat.format(new Date(response.generatedAt))}`,
  );
  return <p className="text-[11px] text-muted">{parts.filter(Boolean).join(' · ')}</p>;
}

/** Global findings from the grounding review. */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const removed = findings.filter((f) => f.severity === 'removed');
  const review = findings.filter((f) => f.severity === 'review');
  return (
    <>
      {removed.length > 0 ? (
        <Alert tone="info" title="ApplyPilot removed what it could not trace to your profile">
          <ul className="list-disc space-y-0.5 pl-4">
            {removed.map((f) => (
              <li key={f.message}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {review.length > 0 ? (
        <Alert tone="warning" title="Check these">
          <ul className="list-disc space-y-0.5 pl-4">
            {review.map((f) => (
              <li key={f.message}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </>
  );
}

/** Inline warnings for one piece of text. */
export function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5" aria-label="Needs your review">
      {flags.map((flag) => (
        <li
          key={flag}
          className="rounded-md bg-warning-surface px-1.5 py-0.5 text-[11px] text-warning"
        >
          Check: {flag}
        </li>
      ))}
    </ul>
  );
}
