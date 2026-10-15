import { ScanSearch } from 'lucide-react';
import type { JobExtractionResult } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';

/** Shown when the tab has moved on to another job since it was analyzed. */
export function StaleAnalysisAlert({
  result,
  onAnalyze,
  disabled,
}: {
  result: JobExtractionResult;
  onAnalyze: () => void;
  disabled?: boolean;
}) {
  const title = result.job.title.status === 'found' ? result.job.title.value : 'the earlier job';
  return (
    <Alert
      tone="warning"
      title="The selected job changed"
      action={
        <Button size="sm" onClick={onAnalyze} disabled={disabled}>
          <ScanSearch aria-hidden className="h-3.5 w-3.5" /> Analyze selected job
        </Button>
      }
    >
      This analysis is for “{title}”, but the tab now shows a different job. Analyze again so
      nothing from the earlier job is used.
    </Alert>
  );
}
