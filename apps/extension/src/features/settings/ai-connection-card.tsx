import { useId, useState } from 'react';
import { PlugZap } from 'lucide-react';
import type { HealthResponse } from '@applypilot/ai-core';
import { describeProvider } from '../ai/provider-label';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/field';
import { useAiConnection } from '../../hooks/use-ai-connection';
import { AiClientError } from '../../services/ai-client';
import { useServices } from '../../services/app-services';
import {
  apiUrlSchema,
  permissionOrigin,
  type AiConnection,
} from '../../storage/ai-connection-repository';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'connected'; health: HealthResponse }
  | { kind: 'error'; message: string };

function AiConnectionForm({ initial }: { initial: AiConnection }) {
  const id = useId();
  const services = useServices();
  const [apiUrl, setApiUrl] = useState(initial.apiUrl);
  const [token, setToken] = useState(initial.token);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const urlCheck = apiUrlSchema.safeParse(apiUrl);
  const urlError = urlCheck.success ? undefined : urlCheck.error.issues[0]?.message;

  const connect = async () => {
    if (!urlCheck.success || token.trim() === '') return;
    setStatus({ kind: 'testing' });
    // Requested first, while the click still counts as a user gesture.
    const granted = await services.permissions.request(permissionOrigin(urlCheck.data));
    if (!granted) {
      setStatus({
        kind: 'error',
        message:
          'ApplyPilot needs permission to talk to the API on this computer. Try again and choose Allow.',
      });
      return;
    }
    const saved = await services.aiConnection.save({ apiUrl: urlCheck.data, token: token.trim() });
    try {
      setStatus({ kind: 'connected', health: await services.ai.health(saved) });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof AiClientError ? e.message : 'The connection test failed.',
      });
    }
  };

  return (
    <Card className="space-y-3">
      <div>
        <CardTitle>AI connection</CardTitle>
        <CardDescription>
          AI drafts come from the ApplyPilot API running on your computer. It keeps the Claude API
          key; the extension only holds this access token. Start it with{' '}
          <code className="rounded bg-surface-muted px-1">pnpm api</code> (see the install guide).
        </CardDescription>
      </div>
      <Field id={`${id}-url`} label="API address" error={urlError}>
        {(props) => (
          <Input
            {...props}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <Field
        id={`${id}-token`}
        label="Access token"
        hint='The APPLYPILOT_LOCAL_TOKEN value printed by "pnpm api:setup".'
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => void connect()}
          disabled={!urlCheck.success || token.trim() === '' || status.kind === 'testing'}
        >
          <PlugZap aria-hidden className="h-3.5 w-3.5" />
          {status.kind === 'testing' ? 'Testing…' : 'Save and test connection'}
        </Button>
        {token ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setToken('');
              setStatus({ kind: 'idle' });
              void services.aiConnection.save({ apiUrl: initial.apiUrl, token: '' });
            }}
          >
            Forget token
          </Button>
        ) : null}
      </div>
      {status.kind === 'connected' ? (
        <Alert tone="success" title={`Connected to ApplyPilot API ${status.health.version}`}>
          {describeProvider(status.health)}
        </Alert>
      ) : null}
      {status.kind === 'error' ? (
        <Alert tone="error" title="Not connected">
          {status.message}
        </Alert>
      ) : null}
    </Card>
  );
}

/** Settings card for connecting the extension to the local ApplyPilot API. */
export function AiConnectionCard() {
  const { connection } = useAiConnection();
  if (!connection) return null;
  return <AiConnectionForm initial={connection} />;
}
