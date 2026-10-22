import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DEFAULT_MODEL } from '@applypilot/ai-core';
import { createApi, type UsageLimiter } from '../app';
import { createCloudApi, type UserDirectory } from '../cloud/api';
import { cognitoIssuer, jwtAuthenticator, type Authenticator } from '../cloud/auth';
import { CloudStore, documentClient } from '../cloud/store';
import { createAnthropicClient, createAnthropicProvider } from '../providers/anthropic';
import { createMockProvider } from '../providers/mock';
import type { AiProvider } from '../providers/types';
import { EFFORTS, type ApiConfig, type Effort } from '../config';
import {
  allowedOriginsFromEnv,
  requireEnv,
  toApiRequest,
  toResult,
  type ApiGatewayEvent,
  type ApiGatewayResult,
} from './adapter';

/**
 * The three Lambda functions. Each is built from environment variables set by
 * the CDK stack, and each gets only the AWS permissions its routes need
 * (see infra/lib/applypilot-stack.ts):
 *
 * - data: profile, applications, sync. Reads and writes the table.
 * - account: deleting cloud data or the whole account. Bulk-deletes the
 *   user's items and may call Cognito AdminDeleteUser.
 * - ai: the Claude features. Reads the Anthropic key from Secrets Manager.
 *
 * Clients are created once per container (outside the handler), the usual
 * Lambda pattern for connection reuse.
 */

export type Env = Record<string, string | undefined>;
export type Handler = (event: ApiGatewayEvent) => Promise<ApiGatewayResult>;

export interface HandlerDeps {
  doc?: DynamoDBDocumentClient;
  authenticate?: Authenticator;
  users?: UserDirectory;
}

function log(entry: object) {
  // One JSON line per request: CloudWatch Logs Insights can query the fields.
  // eslint-disable-next-line no-console -- Lambda's stdout is the CloudWatch log stream.
  console.log(JSON.stringify({ level: 'info', ...entry }));
}

function authenticatorFromEnv(env: Env): Authenticator {
  return jwtAuthenticator({
    issuer: cognitoIssuer(requireEnv(env, 'AWS_REGION'), requireEnv(env, 'USER_POOL_ID')),
    clientId: requireEnv(env, 'USER_POOL_CLIENT_ID'),
  });
}

function storeFromEnv(env: Env, doc?: DynamoDBDocumentClient) {
  return new CloudStore({
    doc: doc ?? documentClient(new DynamoDBClient({})),
    tableName: requireEnv(env, 'TABLE_NAME'),
  });
}

function integer(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function createCloudHandler(
  fn: 'data' | 'account',
  env: Env,
  deps: HandlerDeps = {},
): Handler {
  const users =
    fn === 'account' ? (deps.users ?? cognitoUsers(requireEnv(env, 'USER_POOL_ID'))) : undefined;
  const api = createCloudApi({
    store: storeFromEnv(env, deps.doc),
    authenticate: deps.authenticate ?? authenticatorFromEnv(env),
    ...(users ? { users } : {}),
    functions: [fn],
    version: env.APP_VERSION ?? 'unknown',
    requestsPerMinute: integer(env.REQUESTS_PER_MINUTE, 120),
    log,
  });
  const origins = allowedOriginsFromEnv(env.ALLOWED_ORIGINS);
  return async (event) => {
    const request = toApiRequest(event);
    return toResult(await api(request), request.headers.origin, origins);
  };
}

export function cognitoUsers(
  userPoolId: string,
  client = new CognitoIdentityProviderClient({}),
): UserDirectory {
  return {
    async deleteUser(username) {
      try {
        await client.send(
          new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }),
        );
      } catch (e) {
        // Already gone: deleting again is not an error.
        if (!(e instanceof UserNotFoundException)) throw e;
      }
    },
  };
}

/** Reads the Anthropic key once per container; it never leaves the function. */
export function secretReader(secretArn: string, client = new SecretsManagerClient({})) {
  let cached: Promise<string> | null = null;
  return () => {
    cached ??= client
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((result) => {
        const key = result.SecretString?.trim() ?? '';
        if (!key) throw new Error('The Anthropic API key secret is empty.');
        return key;
      })
      .catch((e: unknown) => {
        cached = null;
        throw e;
      });
    return cached;
  };
}

export interface AiHandlerDeps extends HandlerDeps {
  /** Overrides provider creation (tests). */
  provider?: AiProvider;
  readSecret?: () => Promise<string>;
}

export function createAiHandler(env: Env, deps: AiHandlerDeps = {}): Handler {
  const store = storeFromEnv(env, deps.doc);
  const authenticate = deps.authenticate ?? authenticatorFromEnv(env);
  const dailyLimit = integer(env.AI_DAILY_LIMIT, 25);
  const effort = (EFFORTS as readonly string[]).includes(env.AI_EFFORT ?? '')
    ? (env.AI_EFFORT as Effort)
    : 'medium';
  const useClaude = env.AI_PROVIDER === 'anthropic';
  const config: ApiConfig = {
    version: env.APP_VERSION ?? 'unknown',
    host: '127.0.0.1',
    port: 0,
    // Unused in AWS: requests are authenticated with Cognito tokens below.
    token: '',
    provider: useClaude ? 'anthropic' : 'mock',
    anthropicApiKey: null,
    model: env.AI_MODEL || DEFAULT_MODEL,
    effort,
    dailyLimit,
    allowedOrigins: allowedOriginsFromEnv(env.ALLOWED_ORIGINS),
    maxBodyBytes: 300_000,
  };
  const limiter: UsageLimiter = {
    tryConsume: (userId) => store.consume(userId, 'ai', dailyLimit, 86_400),
    used: (userId) => store.used(userId, 'ai', 86_400),
  };
  const readSecret =
    deps.readSecret ?? (useClaude ? secretReader(requireEnv(env, 'ANTHROPIC_SECRET_ARN')) : null);

  let api: ReturnType<typeof createApi> | null = null;
  async function getApi() {
    if (api) return api;
    let provider = deps.provider;
    if (!provider) {
      provider =
        useClaude && readSecret
          ? createAnthropicProvider({
              client: createAnthropicClient(await readSecret()),
              model: config.model,
              effort,
            })
          : createMockProvider();
    }
    api = createApi({
      config,
      provider,
      limiter,
      authenticate: async (request) =>
        (await authenticate(request.headers.authorization))?.userId ?? null,
      // Metadata only, as in the local server: never prompts, drafts or profile text.
      log: (entry) => log(entry),
    });
    return api;
  }

  return async (event) => {
    const request = toApiRequest(event);
    if (Buffer.byteLength(request.body) > config.maxBodyBytes) {
      return toResult(
        {
          status: 413,
          body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' } },
        },
        request.headers.origin,
        config.allowedOrigins,
      );
    }
    const handle = await getApi();
    return toResult(await handle(request), request.headers.origin, config.allowedOrigins);
  };
}
