import { z } from 'zod';
import {
  accountExportSchema,
  accountResponseSchema,
  changesResponseSchema,
  cloudErrorSchema,
  pushResponseSchema,
  type AccountExport,
  type AccountResponse,
  type ChangesResponse,
  type CloudErrorCode,
  type ItemChange,
  type PushResponse,
} from './contract';
import { EpochChangedError, type SyncTransport } from './engine';

/**
 * HTTP client for the cloud API, used by the extension and by the
 * integration tests (so the tests exercise the same code). Every response is
 * validated against the contract before use.
 */

const accountDeletedSchema = z.object({ deleted: z.number().int().nonnegative() });

export type CloudClientErrorCode = CloudErrorCode | 'NETWORK' | 'TIMEOUT' | 'BAD_RESPONSE';

export class CloudClientError extends Error {
  override name = 'CloudClientError';
  constructor(
    readonly code: CloudClientErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

export interface CloudClientOptions {
  /** e.g. https://abc123.execute-api.ca-central-1.amazonaws.com/prod (no trailing slash) */
  apiUrl: string;
  /** Returns a valid access token, refreshing it if needed. */
  accessToken: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class CloudClient implements SyncTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: CloudClientOptions) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async call<T>(
    schema: z.ZodType<T>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = new Headers({ Authorization: `Bearer ${await this.options.accessToken()}` });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.apiUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new CloudClientError('TIMEOUT', 'ApplyPilot Cloud took too long to answer.');
      }
      throw new CloudClientError(
        'NETWORK',
        'Could not reach ApplyPilot Cloud. Check your connection and the cloud address.',
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new CloudClientError(
        'BAD_RESPONSE',
        'ApplyPilot Cloud sent a response that is not JSON.',
        response.status,
      );
    }
    if (!response.ok) {
      const parsed = cloudErrorSchema.safeParse(json);
      if (!parsed.success) {
        throw new CloudClientError(
          'BAD_RESPONSE',
          `ApplyPilot Cloud answered with status ${response.status}.`,
          response.status,
        );
      }
      const { code, message, requestId } = parsed.data.error;
      if (code === 'EPOCH_CHANGED') throw new EpochChangedError(message);
      throw new CloudClientError(code, message, response.status, requestId ?? null);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CloudClientError(
        'BAD_RESPONSE',
        'ApplyPilot Cloud sent data in an unexpected format.',
        response.status,
      );
    }
    return parsed.data;
  }

  changes(since: number | null, page: string | null): Promise<ChangesResponse> {
    const query = new URLSearchParams();
    if (since !== null) query.set('since', String(since));
    if (page !== null) query.set('page', page);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.call(changesResponseSchema, 'GET', `/v1/sync/changes${suffix}`);
  }

  push(epoch: string, changes: ItemChange[]): Promise<PushResponse> {
    return this.call(pushResponseSchema, 'POST', '/v1/sync/push', { epoch, changes });
  }

  account(): Promise<AccountResponse> {
    return this.call(accountResponseSchema, 'GET', '/v1/account');
  }

  exportAll(): Promise<AccountExport> {
    return this.call(accountExportSchema, 'GET', '/v1/account/export');
  }

  async deleteData(): Promise<void> {
    await this.call(accountDeletedSchema, 'DELETE', '/v1/account/data');
  }

  async deleteAccount(): Promise<void> {
    await this.call(accountDeletedSchema, 'DELETE', '/v1/account');
  }
}
