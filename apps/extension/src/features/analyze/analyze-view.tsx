import { useEffect } from 'react';
import { RefreshCw, ScanSearch } from 'lucide-react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useServices } from '../../services/app-services';
import { ExtractionChecks } from './extraction-checks';
import { FrameAccessAlert } from './frame-access-alert';
import { PasteJobForm } from './paste-job-form';
import { JobDetails } from './job-details';
import { MatchCard } from './match-card';
import { StaleAnalysisAlert } from './stale-analysis-alert';
import { useAnalysis } from './store';
import { useStaleAnalysis } from './use-stale-analysis';

const ERROR_TITLES = {
  PERMISSION_REQUIRED: 'Permission needed for this page',
  UNSUPPORTED_PAGE: 'This page cannot be analyzed',
  NO_ACTIVE_TAB: 'No tab to analyze',
  TIMEOUT: 'The page took too long',
} as const;

function AnalysisSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Analyzing page">
      <Card className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
      <Card className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </Card>
    </div>
  );
}

export function AnalyzeView() {
  const services = useServices();
  const { state, analyze, restoreCached } = useAnalysis();

  useEffect(() => {
    void restoreCached(services);
  }, [restoreCached, services]);

  const run = () => void analyze(services);
  const loading = state.status === 'loading';
  const stale = useStaleAnalysis(state.status === 'success' ? state.result : null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-brand">Job analysis</h1>
          <p className="text-xs text-muted">
            Reads the job on the current tab. Nothing leaves your browser.
          </p>
        </div>
        {state.status === 'success' ? (
          <Button size="sm" variant="secondary" onClick={run} disabled={loading}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Re-analyze
          </Button>
        ) : null}
      </div>

      {state.status === 'idle' ? (
        <EmptyState
          icon={ScanSearch}
          title="Analyze the job on this tab"
          description="Open a job posting, then analyze it to see the role, requirements and skills ApplyPilot found, with where each detail came from."
          action={
            <Button onClick={run}>
              <ScanSearch aria-hidden className="h-4 w-4" /> Analyze this page
            </Button>
          }
        />
      ) : null}
      {state.status === 'idle' || state.status === 'error' ? <PasteJobForm /> : null}

      {loading ? <AnalysisSkeleton /> : null}

      {state.status === 'error' ? (
        <Alert
          tone="error"
          title={
            state.error.code in ERROR_TITLES
              ? ERROR_TITLES[state.error.code as keyof typeof ERROR_TITLES]
              : 'Analysis failed'
          }
          action={
            <Button size="sm" variant="secondary" onClick={run}>
              Try again
            </Button>
          }
        >
          {state.error.message}
        </Alert>
      ) : null}

      {state.status === 'success' ? (
        <>
          {stale ? <StaleAnalysisAlert result={state.result} onAnalyze={run} /> : null}
          <FrameAccessAlert result={state.result} onGranted={run} />
          {state.result.isJobPosting ? null : <PasteJobForm />}
          {state.result.isJobPosting ? null : (
            <Alert tone="warning" title="This may not be a job posting">
              Results are shown below, but they may not describe a job.
            </Alert>
          )}
          {state.result.warnings
            .filter((w) => state.result.isJobPosting || !/does not look like/.test(w))
            .map((warning) => (
              <Alert key={warning} tone="info" title="Note">
                {warning}
              </Alert>
            ))}
          {state.fromCache ? (
            <p className="text-xs text-muted">Showing the earlier analysis of this tab.</p>
          ) : null}
          <JobDetails result={state.result} />
          <ExtractionChecks result={state.result} />
          <MatchCard job={state.result.job} />
        </>
      ) : null}
    </div>
  );
}
