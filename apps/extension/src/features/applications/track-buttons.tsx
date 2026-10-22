import { useMemo, useState } from 'react';
import { BookmarkPlus, CheckCircle2, ListChecks } from 'lucide-react';
import {
  isProfileEmpty,
  type ApplicationJob,
  type FormScan,
  type JobExtractionResult,
} from '@applypilot/shared';
import { matchJob } from '@applypilot/matching';
import { STAGE_LABELS, SUBMITTED_STAGES, findDuplicate, setStatus } from '@applypilot/tracking';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { useSettings } from '../../hooks/use-settings';
import { useNavigation } from '../navigation/store';
import { useProfile } from '../profile/use-profile';
import { useTrackerFocus } from './focus-store';
import { jobFromAnalysis, jobFromForm } from './job-records';
import { clock, useApplications } from './use-applications';

function useOpenInTracker() {
  const setView = useNavigation((s) => s.setView);
  const setOpenId = useTrackerFocus((s) => s.setOpenId);
  return (id: string) => {
    setOpenId(id);
    setView('applications');
  };
}

/** Under an analyzed job: save it to the tracker, with the match score it has now. */
export function SaveJobCard({ result }: { result: JobExtractionResult }) {
  const { records, add, error } = useApplications();
  const { state: profileState } = useProfile();
  const { settings } = useSettings();
  const openInTracker = useOpenInTracker();
  const job = useMemo(() => jobFromAnalysis(result), [result]);
  const existing = job ? findDuplicate(records, job) : null;

  const score = useMemo(() => {
    const profile = profileState?.status === 'ok' ? profileState.profile : null;
    if (!profile || !settings || isProfileEmpty(profile)) return null;
    return matchJob(result.job, profile, settings.matchWeights).score;
  }, [profileState, settings, result]);

  if (!job) {
    return (
      <p className="text-xs text-muted">
        This job has no title yet, so it cannot be saved to the tracker. Add it by hand in the
        Applications tab.
      </p>
    );
  }
  return (
    <Card className="flex items-center gap-3" aria-label="Application tracker">
      <ListChecks aria-hidden className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <CardTitle>{existing ? 'In your tracker' : 'Track this job'}</CardTitle>
        <CardDescription>
          {existing
            ? `Status: ${STAGE_LABELS[existing.status]}.`
            : 'Save it with its details and match score, then follow it to an offer.'}
        </CardDescription>
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
      {existing ? (
        <Button size="sm" variant="secondary" onClick={() => openInTracker(existing.id)}>
          Open
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() =>
            void add({
              job,
              source: 'analyzed',
              status: 'saved',
              matchScore: score === null ? null : Math.round(score),
            })
          }
        >
          <BookmarkPlus aria-hidden className="h-3.5 w-3.5" /> Save to tracker
        </Button>
      )}
    </Card>
  );
}

/**
 * After a fill: the user says they submitted the application themselves.
 * ApplyPilot cannot know whether a form was sent, so it never marks anything
 * as applied on its own.
 */
export function MarkAppliedCard({
  scan,
  analysis,
}: {
  scan: FormScan;
  analysis: JobExtractionResult | null;
}) {
  const { records, add, save, error } = useApplications();
  const openInTracker = useOpenInTracker();
  const [done, setDone] = useState<string | null>(null);
  const job: ApplicationJob | null = useMemo(
    () => (analysis ? jobFromAnalysis(analysis) : null) ?? jobFromForm(scan),
    [analysis, scan],
  );
  if (!job) return null;
  const existing = findDuplicate(records, job);
  const alreadyApplied = existing !== null && SUBMITTED_STAGES.includes(existing.status);
  const name = job.company ? `${job.title} at ${job.company}` : job.title;

  const markApplied = async () => {
    if (existing) {
      const saved = await save(setStatus(existing, 'applied', clock.now()));
      if (saved) setDone(saved.id);
      return;
    }
    const result = await add({ job, source: 'autofill', status: 'applied', matchScore: null });
    if (result) setDone(result.record.id);
  };

  return (
    <Card className="space-y-2" aria-label="Track this application">
      <CardTitle>Did you submit it?</CardTitle>
      {done || alreadyApplied ? (
        <p className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
          {name} is marked {existing ? STAGE_LABELS[existing.status] : 'Applied'} in your tracker.
        </p>
      ) : (
        <CardDescription>
          After you press the site&apos;s own Submit button, mark {name} as applied. ApplyPilot
          never decides this for you.
        </CardDescription>
      )}
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      <div className="flex gap-1.5">
        {done || alreadyApplied ? null : (
          <Button size="sm" onClick={() => void markApplied()}>
            I submitted it: mark as applied
          </Button>
        )}
        {done || existing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openInTracker(done ?? existing?.id ?? '')}
          >
            Open in tracker
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
