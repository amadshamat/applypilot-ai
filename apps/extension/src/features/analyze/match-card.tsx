import { useMemo } from 'react';
import { Check, CircleHelp, Lightbulb, Minus, UserRound, X } from 'lucide-react';
import { isProfileEmpty, type JobPosting } from '@applypilot/shared';
import { matchJob, type MatchResult, type SkillMatch } from '@applypilot/matching';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { useSettings } from '../../hooks/use-settings';
import { cn } from '../../lib/cn';
import { useNavigation } from '../navigation/store';
import { useProfile } from '../profile/use-profile';

function scoreTone(score: number): { text: string; bar: string; label: string } {
  if (score >= 75) return { text: 'text-success', bar: 'bg-success', label: 'Strong match' };
  if (score >= 50) return { text: 'text-primary', bar: 'bg-primary', label: 'Partial match' };
  return { text: 'text-warning', bar: 'bg-warning', label: 'Weak match' };
}

const STATUS = {
  matched: { icon: Check, tone: 'success', label: 'You have this' },
  related: { icon: Minus, tone: 'warning', label: 'Related experience' },
  missing: { icon: X, tone: 'danger', label: 'Not in your profile' },
} as const;

function SkillChips({ title, skills }: { title: string; skills: readonly SkillMatch[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{title}</p>
      <ul className="flex flex-wrap gap-1">
        {skills.map((match) => {
          const { icon: Icon, tone, label } = STATUS[match.status];
          const where =
            match.status === 'related'
              ? `related: ${match.relatedVia ?? ''}`
              : match.evidence.join('; ');
          const name =
            match.alternatives && match.status !== 'missing'
              ? `${match.skill} (one of ${match.alternatives.join(', ')})`
              : match.alternatives
                ? `One of ${match.alternatives.join(', ')}`
                : match.skill;
          return (
            <li key={match.skill}>
              <Badge tone={tone} title={where ? `${label}. Found in: ${where}` : label}>
                <Icon aria-hidden className="h-3 w-3" />
                <span>{name}</span>
                <span className="sr-only">: {label}</span>
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Where in the profile each matched skill was found, so every claim can be checked. */
function Evidence({ skills }: { skills: readonly SkillMatch[] }) {
  const found = skills.filter((m) => m.status !== 'missing');
  if (found.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium">
        Where your profile shows these ({found.length})
      </summary>
      <ul className="mt-1.5 space-y-1">
        {found.map((match) => (
          <li key={match.skill}>
            <span className="font-medium">{match.skill}</span>
            <span className="text-muted">
              {match.status === 'related' ? ` (related, via ${match.relatedVia ?? ''})` : ''}:{' '}
              {match.evidence.join('; ')}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Breakdown({ result }: { result: MatchResult }) {
  return (
    <ul className="space-y-2" aria-label="Score breakdown">
      {result.components.map((component) => (
        <li key={component.key} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">
              {component.label}{' '}
              <span className="font-normal text-muted">· {component.weight}%</span>
            </span>
            {component.score === null ? (
              <Badge>Not compared</Badge>
            ) : (
              <span className="tabular-nums">{Math.round(component.score * 100)}%</span>
            )}
          </div>
          {component.score !== null ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${String(Math.round(component.score * 100))}%` }}
              />
            </div>
          ) : null}
          <p className="text-[11px] text-muted">{component.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function List({
  title,
  items,
  icon: Icon,
  className,
}: {
  title: string;
  items: readonly string[];
  icon: typeof Check;
  className: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-xs">
            <Icon aria-hidden className={cn('mt-0.5 h-3 w-3 shrink-0', className)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchResultView({ result }: { result: MatchResult }) {
  const notCompared = result.components
    .filter((c) => c.score === null && c.weight > 0)
    .map((c) => c.label.toLowerCase());
  return (
    <div className="space-y-4">
      {result.score === null ? (
        <div>
          <p className="text-sm font-medium">Not enough to compare</p>
          <p className="text-xs text-muted">
            The posting didn't state skills, years, education or other details that could be checked
            against your profile. No score is shown rather than a guess.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p
            className={cn('text-3xl font-semibold tabular-nums', scoreTone(result.score).text)}
            aria-label={`Match score ${String(result.score)} out of 100`}
          >
            {result.score}
            <span className="text-sm font-normal text-muted">/100</span>
          </p>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">{scoreTone(result.score).label}</p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div
                className={cn('h-full rounded-full', scoreTone(result.score).bar)}
                style={{ width: `${String(result.score)}%` }}
              />
            </div>
          </div>
        </div>
      )}
      {result.score !== null && notCompared.length > 0 ? (
        <p className="text-[11px] text-muted">
          Based on {Math.round(result.coverage * 100)}% of the scoring weight. Not compared:{' '}
          {notCompared.join(', ')}.
        </p>
      ) : null}

      <Breakdown result={result} />
      <SkillChips title="Required skills" skills={result.requiredSkills} />
      <SkillChips title="Preferred skills" skills={result.preferredSkills} />
      <Evidence skills={[...result.requiredSkills, ...result.preferredSkills]} />
      <List
        title="Matching qualifications"
        items={result.strengths}
        icon={Check}
        className="text-success"
      />
      <List title="Missing or weaker" items={result.gaps} icon={X} className="text-danger" />
      <List
        title="Check these yourself"
        items={result.toConfirm}
        icon={CircleHelp}
        className="text-muted"
      />

      {result.suggestions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">How to improve your resume for this job</p>
          <ul className="space-y-2">
            {result.suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex gap-2 rounded-lg bg-surface-muted p-2">
                <Lightbulb aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs font-medium">{suggestion.title}</p>
                  <p className="text-[11px] text-muted">{suggestion.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[11px] text-muted">
        This score is a heuristic using your weights from Settings. It is not a prediction of
        whether you will be hired.
      </p>
    </div>
  );
}

export function MatchCard({ job }: { job: JobPosting }) {
  const { state } = useProfile();
  const { settings } = useSettings();
  const setView = useNavigation((s) => s.setView);
  const profile = state?.status === 'ok' ? state.profile : null;
  const result = useMemo(
    () =>
      settings && profile && !isProfileEmpty(profile)
        ? matchJob(job, profile, settings.matchWeights)
        : null,
    [job, profile, settings],
  );

  return (
    <Card className="space-y-3" role="region" aria-label="Match score">
      <div>
        <CardTitle>Match with your profile</CardTitle>
        <CardDescription>
          Compares this job with the profile you saved. Every point links back to your own entries.
        </CardDescription>
      </div>
      {state === null || settings === null ? (
        <Skeleton className="h-16 w-full" />
      ) : result ? (
        <MatchResultView result={result} />
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">
            {state.status === 'corrupt'
              ? 'Your saved profile could not be read, so no match can be shown.'
              : 'Add your skills, experience and education to see how well you match. Upload a resume to start quickly.'}
          </p>
          <Button size="sm" onClick={() => setView('resume')}>
            <UserRound aria-hidden className="h-3.5 w-3.5" /> Build your profile
          </Button>
        </div>
      )}
    </Card>
  );
}
