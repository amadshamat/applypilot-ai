import { useEffect, useRef, useState } from 'react';
import { FileUp, PencilLine, UserRound } from 'lucide-react';
import { emptyProfileContent, type ProfileContent } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { ProfileEditor } from './profile-editor';
import { useProfile } from './use-profile';
import { validateProfile, type FieldErrors } from './validation';

const contentOf = (profile: ProfileContent): ProfileContent => ({
  personal: profile.personal,
  summary: profile.summary,
  education: profile.education,
  experience: profile.experience,
  skills: profile.skills,
  certifications: profile.certifications,
  projects: profile.projects,
  preferences: profile.preferences,
});

/** The saved profile with add/edit/delete for every section and an explicit Save. */
export function ProfilePage({ onUploadResume }: { onUploadResume: () => void }) {
  const { state, error, save, reset } = useProfile();
  const [draft, setDraft] = useState<ProfileContent | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [startedByHand, setStartedByHand] = useState(false);
  // Lets the storage-sync effect see the latest dirty flag without re-running.
  const dirtyRef = useRef(false);

  const saved = state?.status === 'ok' ? contentOf(state.profile) : null;
  const savedJson = JSON.stringify(saved);

  // Load the saved profile into the editor, and follow saves made elsewhere while nothing is unsaved here.
  useEffect(() => {
    // Read the flag now: the updater below runs later, after this render's effects.
    const hasUnsavedEdits = dirtyRef.current;
    setDraft((current) =>
      current === null || !hasUnsavedEdits ? (saved ?? emptyProfileContent()) : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized profile
  }, [savedJson]);

  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(saved ?? emptyProfileContent());
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  if (error)
    return (
      <Alert tone="error" title="Could not load your profile">
        {error}
      </Alert>
    );
  if (state === null || draft === null) return <Skeleton className="h-32 w-full" />;

  if (state.status === 'corrupt') {
    return (
      <Alert
        tone="error"
        title="Your saved profile could not be read"
        action={
          <Button size="sm" variant="secondary" onClick={() => void reset()}>
            Start a new profile
          </Button>
        }
      >
        It may have been saved by a newer version. Export your data from Settings first if you want
        a copy.
      </Alert>
    );
  }

  if (state.status === 'empty' && !dirty && !startedByHand) {
    return (
      <EmptyState
        icon={UserRound}
        title="Build your profile"
        description="Your profile is what ApplyPilot compares with each job. Start from your resume, or fill it in yourself."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onUploadResume}>
              <FileUp aria-hidden className="h-4 w-4" /> Upload a resume
            </Button>
            <Button variant="secondary" onClick={() => setStartedByHand(true)}>
              <PencilLine aria-hidden className="h-4 w-4" /> Fill in by hand
            </Button>
          </div>
        }
      />
    );
  }

  const submit = async () => {
    const result = validateProfile(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(null);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const next = await save(result.data);
      setDraft(contentOf(next));
      setMessage('Profile saved.');
    } catch (e) {
      setMessage(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const errorCount = Object.keys(errors).length;
  return (
    <div className="space-y-3 pb-2">
      <ProfileEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setMessage(null);
        }}
        errors={errors}
      />
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-md">
        <Button onClick={() => void submit()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
        <Button
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(saved ?? emptyProfileContent());
            setErrors({});
          }}
        >
          Discard changes
        </Button>
        <p role="status" className="text-xs text-muted">
          {errorCount > 0 ? (
            <span className="text-danger">
              Fix {errorCount} field{errorCount === 1 ? '' : 's'} marked above.
            </span>
          ) : dirty ? (
            'Unsaved changes'
          ) : (
            message
          )}
        </p>
      </div>
    </div>
  );
}
