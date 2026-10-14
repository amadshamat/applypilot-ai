import { useId, useState } from 'react';
import { isProfileEmpty, type ProfileContent, type ResumeVersionMeta } from '@applypilot/shared';
import { mergeProfiles, type MergeSummary } from '@applypilot/resume-parser';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { useServices } from '../../services/app-services';
import { ProfileEditor } from '../profile/profile-editor';
import { useProfile } from '../profile/use-profile';
import { validateProfile, type FieldErrors } from '../profile/validation';

type Mode = 'merge' | 'replace';

function describeSummary(summary: MergeSummary): string {
  const parts = Object.entries(summary.added)
    .filter(([, count]) => count > 0)
    .map(([section, count]) => `${String(count)} ${section}`);
  const added = parts.length > 0 ? `Added ${parts.join(', ')}.` : 'Nothing new was added.';
  return summary.skippedDuplicates > 0
    ? `${added} Skipped ${String(summary.skippedDuplicates)} already in your profile.`
    : added;
}

/**
 * Review screen for a parsed resume. The user corrects the draft, then chooses
 * how it is applied. Until "Save to profile" is pressed nothing changes.
 */
export function ResumeReview({
  meta,
  onClose,
}: {
  meta: ResumeVersionMeta;
  onClose: (message?: string) => void;
}) {
  const id = useId();
  const { resumes } = useServices();
  const { state, save } = useProfile();
  const [draft, setDraft] = useState<ProfileContent>(meta.parsed.draft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const existing = state?.status === 'ok' ? state.profile : null;
  const hasExisting = existing !== null && !isProfileEmpty(existing);
  const [mode, setMode] = useState<Mode>('merge');

  if (state === null) return null;

  const apply = async () => {
    const result = validateProfile(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setFailure(null);
    try {
      const { profile, summary } = existing
        ? mergeProfiles(existing, result.data, hasExisting ? mode : 'replace')
        : mergeProfiles(result.data, result.data, 'replace');
      await save(profile);
      await resumes.update({ ...meta, appliedAt: new Date().toISOString() });
      onClose(
        hasExisting && mode === 'merge'
          ? describeSummary(summary)
          : 'Your profile was saved from this resume.',
      );
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-brand">Review {meta.fileName}</h2>
        <p className="text-xs text-muted">
          Check everything below and correct anything that was read wrong. Nothing is saved to your
          profile until you press Save.
        </p>
      </div>

      {meta.parsed.sections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">Sections found:</span>
          {meta.parsed.sections.map((section) => (
            <Badge key={section} tone="primary">
              {section}
            </Badge>
          ))}
        </div>
      ) : null}

      {meta.parsed.warnings.length > 0 ? (
        <Alert tone="warning" title="Please double-check">
          <ul className="list-disc space-y-0.5 pl-4">
            {meta.parsed.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <ProfileEditor value={draft} onChange={setDraft} errors={errors} showPreferences={false} />

      <Card className="sticky bottom-0 space-y-3 shadow-md">
        {hasExisting ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">How should this resume be applied?</legend>
            <label className="flex gap-2 text-xs">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <span>
                <span className="font-medium">Add what's new</span>
                <CardDescription>
                  Keeps everything already in your profile and adds entries it doesn't have yet.
                </CardDescription>
              </span>
            </label>
            <label className="flex gap-2 text-xs">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span>
                <span className="font-medium">Replace my profile</span>
                <CardDescription>
                  Uses this resume for every section. Your job preferences are kept.
                </CardDescription>
              </span>
            </label>
          </fieldset>
        ) : (
          <CardTitle>Save this as your profile?</CardTitle>
        )}
        {errorCount > 0 ? (
          <p role="alert" className="text-xs text-danger">
            Fix {errorCount} field{errorCount === 1 ? '' : 's'} marked above before saving.
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            Could not save: {failure}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void apply()} disabled={saving}>
            {saving ? 'Saving…' : 'Save to profile'}
          </Button>
          <Button variant="ghost" onClick={() => onClose()} disabled={saving}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  );
}
