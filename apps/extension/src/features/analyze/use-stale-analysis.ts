import { useEffect, useState } from 'react';
import { isSameJobPage, type JobExtractionResult } from '@applypilot/shared';
import { useServices } from '../../services/app-services';

/**
 * True when the active tab no longer shows the job an analysis describes, for
 * example after the user picks another job on an Indeed search page. Drafts
 * must then not be made from the old analysis, or they would describe the
 * wrong job. Unknown addresses (no permission) never count as a change.
 */
export function useStaleAnalysis(result: JobExtractionResult | null): boolean {
  const services = useServices();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      services
        .getActiveTabUrl()
        .then((next) => {
          if (active) setUrl(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const stop = services.watchActiveTab(refresh);
    return () => {
      active = false;
      stop();
    };
  }, [services]);

  return result !== null && url !== null && !isSameJobPage(result.pageUrl, url);
}
