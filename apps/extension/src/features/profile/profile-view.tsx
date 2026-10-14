import { useState } from 'react';
import type { ResumeVersionMeta } from '@applypilot/shared';
import { Alert } from '../../components/ui/alert';
import { cn } from '../../lib/cn';
import { ResumeList } from '../resume/resume-list';
import { ResumeReview } from '../resume/resume-review';
import { ResumeUpload } from '../resume/resume-upload';
import { ProfilePage } from './profile-page';

type Tab = 'profile' | 'resumes';

/** The "Profile" tab: the editable profile, and uploaded resumes that feed it. */
export function ProfileView() {
  const [tab, setTab] = useState<Tab>('profile');
  const [reviewing, setReviewing] = useState<ResumeVersionMeta | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (reviewing) {
    return (
      <ResumeReview
        meta={reviewing}
        onClose={(message) => {
          setReviewing(null);
          setRefreshKey((k) => k + 1);
          if (message) {
            setNotice(message);
            setTab('profile');
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-brand">Your profile</h1>
        <p className="text-xs text-muted">
          Stored only in this browser. Job matches use nothing else.
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Profile sections"
        className="grid grid-cols-2 rounded-lg bg-surface-muted p-0.5"
      >
        {(['profile', 'resumes'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'h-7 rounded-md text-xs font-medium transition-colors',
              tab === id
                ? 'bg-surface text-foreground shadow-xs'
                : 'text-muted hover:text-foreground',
            )}
          >
            {id === 'profile' ? 'Profile' : 'Resumes'}
          </button>
        ))}
      </div>
      {notice ? (
        <Alert tone="success" title="Profile updated">
          {notice}
        </Alert>
      ) : null}
      {tab === 'profile' ? (
        <ProfilePage
          onUploadResume={() => {
            setNotice(null);
            setTab('resumes');
          }}
        />
      ) : (
        <div className="space-y-3">
          <ResumeUpload
            onParsed={(meta) => {
              setNotice(null);
              setReviewing(meta);
            }}
          />
          <ResumeList refreshKey={refreshKey} onReview={setReviewing} />
        </div>
      )}
    </div>
  );
}
