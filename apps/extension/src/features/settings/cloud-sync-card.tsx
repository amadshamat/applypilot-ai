import { useId, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { CloudClientError } from '@applypilot/sync';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/field';
import { Switch } from '../../components/ui/switch';
import { CloudAuthError, type CloudSession } from '../../cloud/auth';
import {
  LOCAL_TEST_CONNECTION,
  cloudConnectionSchema,
  connectionOrigins,
  isLocalConnection,
  type CloudConnection,
  type CloudSettings,
} from '../../cloud/connection';
import type { BackupSummary } from '../../cloud/local-data';
import type { SyncRequest, SyncResponse } from '../../cloud/messages';
import type { SyncStatus } from '../../cloud/sync-store';
import { useCloud } from '../../hooks/use-cloud';
import { useServices } from '../../services/app-services';
import { downloadText } from '../ai/download';

/**
 * Optional ApplyPilot Cloud: an account (Amazon Cognito) and sync of the
 * profile and tracker between browsers. Everything keeps working without it.
 */

type Feedback = { tone: 'success' | 'error' | 'info'; text: string } | null;

const describeError = (e: unknown) =>
  e instanceof CloudAuthError || e instanceof CloudClientError
    ? e.message
    : 'Something went wrong.';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

function ConnectionForm({ onSaved }: { onSaved: (feedback: Feedback) => void }) {
  const id = useId();
  const { cloud } = useServices();
  const [values, setValues] = useState({ apiUrl: '', authUrl: '', clientId: '' });
  const [error, setError] = useState<string | null>(null);
  const check = cloudConnectionSchema.safeParse(values);
  const fieldError = (name: keyof CloudConnection) =>
    values[name] === '' ? undefined : check.error?.issues.find((i) => i.path[0] === name)?.message;

  const save = async (connection: CloudConnection) => {
    setError(null);
    // Requested first, while the click still counts as a user gesture.
    const granted = await cloud.requestOrigins(connectionOrigins(connection));
    if (!granted) {
      setError('ApplyPilot needs permission to reach these addresses. Try again and choose Allow.');
      return;
    }
    await cloud.settings.save({ connection, syncEnabled: false });
    onSaved({ tone: 'info', text: 'Connected. Sign in or create an account next.' });
  };

  const set = (name: keyof CloudConnection) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Enter the three values printed by the CDK deployment (ApiUrl, AuthUrl, ClientId), or try it
        with the local test server started by{' '}
        <code className="rounded bg-surface-muted px-1">pnpm cloud:local</code>.
      </p>
      <Field id={`${id}-api`} label="Cloud API URL (ApiUrl)" error={fieldError('apiUrl')}>
        {(props) => (
          <Input
            {...props}
            value={values.apiUrl}
            onChange={set('apiUrl')}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <Field id={`${id}-auth`} label="Cloud sign-in URL (AuthUrl)" error={fieldError('authUrl')}>
        {(props) => (
          <Input
            {...props}
            value={values.authUrl}
            onChange={set('authUrl')}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={`${id}-client`}
        label="Cloud app client ID (ClientId)"
        error={fieldError('clientId')}
      >
        {(props) => (
          <Input
            {...props}
            value={values.clientId}
            onChange={set('clientId')}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!check.success}
          onClick={() => check.success && void save(check.data)}
        >
          <Cloud aria-hidden className="h-3.5 w-3.5" /> Connect
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void save(LOCAL_TEST_CONNECTION)}>
          Use local test server
        </Button>
      </div>
      {error ? (
        <Alert tone="error" title="Not connected">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}

function StatusLine({ status, enabled }: { status: SyncStatus | null; enabled: boolean }) {
  if (!enabled)
    return <p className="text-xs text-muted">Sync is off. Your data stays in this browser only.</p>;
  if (!status) return null;
  const label: Record<SyncStatus['state'], string> = {
    off: 'Not synced yet.',
    syncing: 'Syncing…',
    synced: 'Up to date.',
    'needs-confirmation': 'Paused: waiting for you.',
    'cloud-reset': 'Paused: cloud data was reset.',
    'signed-out': 'Paused: signed out.',
    error: 'Sync did not finish.',
  };
  return (
    <div role="status" className="space-y-0.5 text-xs text-muted">
      <p>
        <span className="font-medium text-foreground">{label[status.state]}</span> Last synced:{' '}
        {when(status.lastSyncedAt)}.
      </p>
      {status.message ? <p>{status.message}</p> : null}
      {status.rejected.map((r) => (
        <p key={`${r.kind}:${r.id}`} className="text-danger">
          Not uploaded: {r.message}
        </p>
      ))}
    </div>
  );
}

function Prompts({
  status,
  run,
  turnOff,
}: {
  status: SyncStatus;
  run: (request: SyncRequest) => Promise<void>;
  turnOff: () => Promise<void>;
}) {
  if (status.state === 'needs-confirmation') {
    const parts = [
      status.pendingDeletions > 0
        ? `delete ${status.pendingDeletions} record${status.pendingDeletions === 1 ? '' : 's'} in this browser that were deleted on another device`
        : '',
      status.pendingCloudDeletions > 0
        ? `delete ${status.pendingCloudDeletions} record${status.pendingCloudDeletions === 1 ? '' : 's'} from the cloud that you deleted here`
        : '',
    ].filter(Boolean);
    return (
      <Alert
        tone="warning"
        title="Confirm deletions"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => void run({ type: 'sync/run', allowDeletions: true })}
            >
              Yes, delete and sync
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
              Turn off sync instead
            </Button>
          </div>
        }
      >
        Sync would {parts.join(' and ')}. A backup of this browser's data is kept first.
      </Alert>
    );
  }
  if (status.state === 'cloud-reset') {
    return (
      <Alert
        tone="warning"
        title="Your cloud data was deleted elsewhere"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void run({ type: 'sync/restart' })}>
              Upload this browser's data again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
              Turn off sync
            </Button>
          </div>
        }
      >
        Another device deleted or reset the cloud copy. This browser's data is untouched and was not
        uploaded.
      </Alert>
    );
  }
  return null;
}

function Conflicts({
  status,
  run,
}: {
  status: SyncStatus;
  run: (r: SyncRequest) => Promise<void>;
}) {
  if (status.conflicts.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">
        Changed on two devices ({status.conflicts.length}). Choose which copy to keep:
      </p>
      <ul className="space-y-2">
        {status.conflicts.map((c) => (
          <li key={`${c.kind}:${c.id}`} className="rounded-lg border border-border p-2 text-xs">
            <p className="font-medium text-foreground">{c.title}</p>
            <p className="text-muted">
              {c.fields.includes('deleted')
                ? 'Deleted on one device and edited on the other.'
                : `Both changed: ${c.fields.join(', ')}.`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run({ type: 'sync/resolve', kind: c.kind, id: c.id, choice: 'local' })
                }
              >
                Keep this browser's copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run({ type: 'sync/resolve', kind: c.kind, id: c.id, choice: 'cloud' })
                }
              >
                Use the cloud copy
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Backups({
  backups,
  onRestore,
}: {
  backups: BackupSummary[];
  onRestore: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (backups.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">
        Backups taken before sync changed data ({backups.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {backups.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {when(b.createdAt)}: {b.reason}. {b.applications} application
              {b.applications === 1 ? '' : 's'}
              {b.hasProfile ? ' and the profile' : ''}.
            </span>
            {confirming === b.id ? (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void onRestore(b.id).then(() => setConfirming(null))}
                >
                  Replace current data
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(b.id)}>
                <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

type Danger = 'delete-data' | 'delete-account' | null;

function SignedIn({
  settings,
  connection,
  session,
  status,
  backups,
  setFeedback,
}: {
  settings: CloudSettings;
  connection: CloudConnection;
  session: CloudSession;
  status: SyncStatus | null;
  backups: BackupSummary[];
  setFeedback: (f: Feedback) => void;
}) {
  const id = useId();
  const { cloud } = useServices();
  const [busy, setBusy] = useState(false);
  const [danger, setDanger] = useState<Danger>(null);

  const report = (response: SyncResponse) => {
    if (!response.ok) setFeedback({ tone: 'error', text: response.error.message });
    else setFeedback(null);
  };
  const run = async (request: SyncRequest) => {
    setBusy(true);
    try {
      report(await cloud.sync(request));
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    await cloud.settings.save({ ...settings, syncEnabled: false });
  };
  const toggle = async (on: boolean) => {
    await cloud.settings.save({ ...settings, syncEnabled: on });
    if (on) await run({ type: 'sync/run' });
  };

  const exportCloud = async () => {
    try {
      const data = await cloud.client(connection).exportAll();
      downloadText(
        `applypilot-cloud-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
        'application/json',
      );
      setFeedback({ tone: 'success', text: 'Cloud export downloaded.' });
    } catch (e) {
      setFeedback({ tone: 'error', text: describeError(e) });
    }
  };

  const confirmDanger = async () => {
    setBusy(true);
    try {
      if (danger === 'delete-data') {
        await cloud.client(connection).deleteData();
        await cloud.settings.save({ ...settings, syncEnabled: false });
        await cloud.sync({ type: 'sync/reset' });
        setFeedback({
          tone: 'success',
          text: 'Your cloud data was deleted and sync is off. Everything in this browser is still here.',
        });
      } else if (danger === 'delete-account') {
        await cloud.client(connection).deleteAccount();
        await cloud.auth.forget();
        await cloud.settings.save({ ...settings, syncEnabled: false });
        await cloud.sync({ type: 'sync/reset' });
        setFeedback({
          tone: 'success',
          text: 'Your ApplyPilot Cloud account and its data were deleted. Everything in this browser is still here.',
        });
      }
      setDanger(null);
    } catch (e) {
      setFeedback({ tone: 'error', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Signed in as{' '}
        <span className="font-medium text-foreground">{session.email || 'your account'}</span>
        {isLocalConnection(connection) ? ' on the local test server' : ''}.
      </p>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-sync`} className="text-sm text-foreground">
          Sync profile and tracker
        </label>
        <Switch
          id={`${id}-sync`}
          checked={settings.syncEnabled}
          onCheckedChange={(on) => void toggle(on)}
          disabled={busy}
        />
      </div>
      <StatusLine status={status} enabled={settings.syncEnabled} />
      {settings.syncEnabled && status ? (
        <>
          <Prompts status={status} run={run} turnOff={turnOff} />
          <Conflicts status={status} run={run} />
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {settings.syncEnabled ? (
          <Button size="sm" onClick={() => void run({ type: 'sync/run' })} disabled={busy}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> Sync now
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => void exportCloud()}>
          <Download aria-hidden className="h-3.5 w-3.5" /> Export cloud data
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void cloud.auth.signOut(connection)}>
          <LogOut aria-hidden className="h-3.5 w-3.5" /> Sign out
        </Button>
      </div>
      <Backups
        backups={backups}
        onRestore={async (backupId) => {
          const response = await cloud.sync({ type: 'sync/restore', backupId });
          report(response);
          if (response.ok)
            setFeedback({
              tone: 'success',
              text: 'Backup restored. What was here before is kept as a backup too.',
            });
        }}
      />
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-foreground">Delete cloud data</p>
        {danger ? (
          <Alert
            tone="warning"
            title={
              danger === 'delete-data' ? 'Delete all your cloud data?' : 'Delete your account?'
            }
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void confirmDanger()}
                >
                  {danger === 'delete-data' ? 'Yes, delete cloud data' : 'Yes, delete my account'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDanger(null)}>
                  Cancel
                </Button>
              </div>
            }
          >
            {danger === 'delete-data'
              ? 'This permanently removes your profile and tracked applications from ApplyPilot Cloud. Other signed-in browsers stop syncing until you choose what to do there. This browser keeps its data.'
              : 'This permanently removes your cloud data and your sign-in account. This browser keeps its data.'}
          </Alert>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDanger('delete-data')}>
              <Trash2 aria-hidden className="h-3.5 w-3.5" /> Delete cloud data
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDanger('delete-account')}>
              <Trash2 aria-hidden className="h-3.5 w-3.5" /> Delete account
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CloudSyncCard() {
  const { cloud } = useServices();
  const { settings, session, status, backups } = useCloud();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [signingIn, setSigningIn] = useState(false);
  if (!settings) return null;
  const connection = settings.connection;

  const signIn = async (c: CloudConnection) => {
    setSigningIn(true);
    setFeedback(null);
    try {
      await cloud.auth.signIn(c);
    } catch (e) {
      if (!(e instanceof CloudAuthError && e.code === 'CANCELLED')) {
        setFeedback({ tone: 'error', text: describeError(e) });
      }
    } finally {
      setSigningIn(false);
    }
  };

  const disconnect = async () => {
    if (connection) await cloud.auth.signOut(connection);
    await cloud.settings.save({ connection: null, syncEnabled: false });
    await cloud.sync({ type: 'sync/reset' });
    setFeedback(null);
  };

  return (
    <Card className="space-y-3">
      <div>
        <CardTitle>Cloud sync (optional)</CardTitle>
        <CardDescription>
          Keep your profile and tracked applications (notes, statuses and reminders) in step across
          browsers with an ApplyPilot Cloud account. Off by default; resume files are never
          uploaded. Data is encrypted in transit and at rest, and only your account can read it.
        </CardDescription>
      </div>
      {!connection ? <ConnectionForm onSaved={setFeedback} /> : null}
      {connection && !session ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Connected to{' '}
            {isLocalConnection(connection)
              ? 'the local test server'
              : new URL(connection.apiUrl).hostname}
            . Sign-in opens in a Chrome window; ApplyPilot never sees your password.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void signIn(connection)} disabled={signingIn}>
              <LogIn aria-hidden className="h-3.5 w-3.5" />{' '}
              {signingIn ? 'Signing in…' : 'Sign in or create account'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
              <CloudOff aria-hidden className="h-3.5 w-3.5" /> Disconnect
            </Button>
          </div>
          {status?.state === 'signed-out' && settings.syncEnabled ? (
            <p className="text-xs text-muted">{status.message}</p>
          ) : null}
        </div>
      ) : null}
      {connection && session ? (
        <SignedIn
          settings={settings}
          connection={connection}
          session={session}
          status={status}
          backups={backups}
          setFeedback={setFeedback}
        />
      ) : null}
      {feedback ? (
        <Alert
          tone={feedback.tone}
          title={{ error: 'Cloud sync', success: 'Done', info: 'Next step' }[feedback.tone]}
        >
          {feedback.text}
        </Alert>
      ) : null}
    </Card>
  );
}
