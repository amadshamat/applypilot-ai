import { useEffect, useMemo, useState } from 'react';
import { PlugZap, ScanSearch, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import {
  buildCandidateContext,
  buildJobContext,
  hasUsableJob,
  type HealthResponse,
} from '@applypilot/ai-core';
import { isProfileEmpty } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAiConnection } from '../../hooks/use-ai-connection';
import { useSettings } from '../../hooks/use-settings';
import { cn } from '../../lib/cn';
import { AiClientError } from '../../services/ai-client';
import { useServices } from '../../services/app-services';
import { isConfigured, type AiConnection } from '../../storage/ai-connection-repository';
import { jobKeyFor } from '../../storage/ai-drafts-repository';
import { useAnalysis } from '../analyze/store';
import { useNavigation } from '../navigation/store';
import { useProfile } from '../profile/use-profile';
import { describeProvider } from './provider-label';
import { CoverLetterPanel } from './cover-letter-panel';
import { ScreeningPanel } from './screening-panel';
import { TailorPanel } from './tailor-panel';

type Tool = 'resume' | 'cover-letter' | 'screening';
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'resume', label: 'Resume' },
  { id: 'cover-letter', label: 'Cover letter' },
  { id: 'screening', label: 'Questions' },
];

type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; health: HealthResponse }
  | { status: 'error'; message: string };

function useHealth(connection: AiConnection | null, enabled: boolean) {
  const { ai } = useServices();
  const [state, setState] = useState<HealthState>({ status: 'checking' });
  useEffect(() => {
    if (!connection || !enabled) return;
    let active = true;
    ai.health(connection)
      .then((health) => active && setState({ status: 'ok', health }))
      .catch(
        (e: unknown) =>
          active &&
          setState({
            status: 'error',
            message: e instanceof AiClientError ? e.message : 'The ApplyPilot API did not answer.',
          }),
      );
    return () => {
      active = false;
    };
  }, [ai, connection, enabled]);
  return state;
}

function Header() {
  return (
    <div>
      <h1 className="text-base font-semibold text-brand">AI Tailor</h1>
      <p className="text-xs text-muted">
        Drafts from your verified profile only. You review everything; nothing is submitted.
      </p>
    </div>
  );
}

export function AiView() {
  const services = useServices();
  const setView = useNavigation((s) => s.setView);
  const { settings } = useSettings();
  const { connection } = useAiConnection();
  const { state: profileState } = useProfile();
  const { state: analysis, analyze } = useAnalysis();
  const [tool, setTool] = useState<Tool>('resume');

  const consented = settings?.allowAiProcessing === true;
  const configured = connection !== null && isConfigured(connection);
  const health = useHealth(connection, consented && configured);

  const profile = profileState?.status === 'ok' ? profileState.profile : null;
  const job = useMemo(
    () => (analysis.status === 'success' ? buildJobContext(analysis.result.job) : null),
    [analysis],
  );
  const contexts = useMemo(
    () =>
      profile
        ? {
            anonymous: buildCandidateContext(profile, { includeName: false }).context,
            named: buildCandidateContext(profile, { includeName: true }).context,
          }
        : null,
    [profile],
  );

  if (!settings || !connection || !profileState) {
    return (
      <div className="space-y-3">
        <Header />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!consented) {
    return (
      <div className="space-y-3">
        <Header />
        <EmptyState
          icon={ShieldCheck}
          title="AI processing is off"
          description={
            <>
              To draft with AI, ApplyPilot sends the job text and parts of your profile (never your
              contact details) to the ApplyPilot API you run. You see exactly what is sent before
              each request, and nothing is sent until you press Generate.
            </>
          }
          action={
            <Button onClick={() => void services.settings.update({ allowAiProcessing: true })}>
              Allow AI processing
            </Button>
          }
        />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="space-y-3">
        <Header />
        <EmptyState
          icon={PlugZap}
          title="Connect the ApplyPilot API"
          description='Start the local API with "pnpm api", then paste its access token in Settings. Mock mode is free and works offline.'
          action={<Button onClick={() => setView('settings')}>Open Settings</Button>}
        />
      </div>
    );
  }

  if (!profile || isProfileEmpty(profile) || !contexts) {
    return (
      <div className="space-y-3">
        <Header />
        <EmptyState
          icon={UserRound}
          title="Build your profile first"
          description="AI drafts use only what your profile shows. Upload a resume or add your experience."
          action={<Button onClick={() => setView('resume')}>Go to Profile</Button>}
        />
      </div>
    );
  }

  if (analysis.status !== 'success' || !job) {
    return (
      <div className="space-y-3">
        <Header />
        <EmptyState
          icon={ScanSearch}
          title="Analyze a job first"
          description="Open a job posting, then analyze it. The AI tools tailor your drafts to that job."
          action={
            <Button onClick={() => void analyze(services)} disabled={analysis.status === 'loading'}>
              <ScanSearch aria-hidden className="h-4 w-4" /> Analyze this page
            </Button>
          }
        />
      </div>
    );
  }

  const jobKey = jobKeyFor(analysis.result.pageUrl);
  const ready = health.status === 'ok' ? health.health : null;

  return (
    <div className="space-y-3">
      <Header />
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
        <p className="font-medium">
          {job.title || 'Untitled job'}
          {job.company ? ` at ${job.company}` : ''}
        </p>
        {health.status === 'ok' ? (
          <p className="mt-0.5 flex items-center gap-1 text-muted">
            <Badge
              className="shrink-0 whitespace-nowrap"
              tone={health.health.provider === 'mock' ? 'neutral' : 'primary'}
            >
              {health.health.provider === 'mock' ? 'Mock mode' : 'Claude'}
            </Badge>
            {describeProvider(health.health)}
          </p>
        ) : null}
      </div>
      {health.status === 'error' ? (
        <Alert
          tone="error"
          title="The ApplyPilot API is not reachable"
          action={
            <Button size="sm" variant="secondary" onClick={() => setView('settings')}>
              Settings
            </Button>
          }
        >
          {health.message}
        </Alert>
      ) : null}
      {!hasUsableJob(job) ? (
        <Alert tone="warning" title="Not enough job detail">
          ApplyPilot found no description or qualifications on this page, so there is nothing to
          tailor against. Try re-analyzing once the page has fully loaded.
        </Alert>
      ) : null}

      <div
        role="group"
        aria-label="AI tools"
        className="grid grid-cols-3 rounded-lg bg-surface-muted p-0.5"
      >
        {TOOLS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
            className={cn(
              'h-7 rounded-md text-xs font-medium transition-colors',
              tool === id
                ? 'bg-surface text-foreground shadow-xs'
                : 'text-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {health.status === 'checking' ? <Skeleton className="h-24 w-full" /> : null}
      {ready && hasUsableJob(job) ? (
        <>
          {tool === 'resume' ? (
            <TailorPanel
              key={jobKey}
              jobKey={jobKey}
              request={{ job, candidate: contexts.anonymous }}
              connection={connection}
              health={ready}
            />
          ) : null}
          {tool === 'cover-letter' ? (
            <CoverLetterPanel
              key={jobKey}
              jobKey={jobKey}
              job={job}
              candidate={contexts.named}
              connection={connection}
              health={ready}
            />
          ) : null}
          {tool === 'screening' ? (
            <ScreeningPanel
              key={jobKey}
              jobKey={jobKey}
              job={job}
              candidate={contexts.anonymous}
              connection={connection}
              health={ready}
            />
          ) : null}
        </>
      ) : null}
      <p className="flex items-center gap-1 text-[11px] text-muted">
        <Sparkles aria-hidden className="h-3 w-3" /> AI can still make mistakes. ApplyPilot checks
        every draft against your profile, but you are the final reviewer.
      </p>
    </div>
  );
}
