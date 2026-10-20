import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { JobExtractionResult } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { INDEED_FRAMES_ORIGIN, isIndeedOrigin } from '../../lib/host-access';
import { useServices } from '../../services/app-services';

/**
 * Shown when the job sits in an Indeed frame that Chrome does not let
 * ApplyPilot read with the toolbar click alone (a different Indeed subdomain).
 * Access is asked for only here, from the user's click, and only for Indeed.
 */
export function FrameAccessAlert({
  result,
  onGranted,
}: {
  result: JobExtractionResult;
  onGranted: () => void;
}) {
  const services = useServices();
  const [declined, setDeclined] = useState(false);
  const origins = (result.diagnostics?.blockedFrameOrigins ?? []).filter(isIndeedOrigin);
  if (result.isJobPosting || origins.length === 0) return null;

  const allow = async () => {
    const granted = await services.permissions.request(INDEED_FRAMES_ORIGIN);
    if (granted) onGranted();
    else setDeclined(true);
  };

  return (
    <Alert
      tone="warning"
      title="Indeed shows this job in a protected frame"
      action={
        <Button size="sm" onClick={() => void allow()}>
          <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> Allow reading Indeed job details
        </Button>
      }
    >
      The job details come from {origins.join(', ')}, which Chrome keeps separate from the page you
      opened. ApplyPilot can read them if you allow access to Indeed pages. It still reads only when
      you click Analyze, and never changes or submits anything.
      {declined ? ' Access was not granted; you can paste the job below instead.' : ''}
    </Alert>
  );
}
