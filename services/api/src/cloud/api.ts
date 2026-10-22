import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { applicationRecordSchema, type ApplicationRecord } from '@applypilot/shared';
import { addNote, removeNote, setFollowUp, setStatus } from '@applypilot/tracking';
import {
  CLOUD_ROUTES,
  PROFILE_ITEM_ID,
  applicationChangeSchema,
  followUpRequestSchema,
  itemIdSchema,
  matchRoute,
  noteRequestSchema,
  profileChangeSchema,
  pushRequestSchema,
  putItemRequestSchema,
  statusRequestSchema,
  type AccountExport,
  type AccountResponse,
  type ApplicationItem,
  type ChangesResponse,
  type CloudErrorBody,
  type CloudErrorCode,
  type CloudFunction,
  type CloudItem,
  type ItemChange,
  type PushResponse,
  type PushResult,
} from '@applypilot/sync';
import type { ApiRequest, ApiResponse } from '../app';
import type { Authenticator, AuthenticatedUser } from './auth';
import { InvalidPageError, type CloudStore } from './store';

/**
 * The cloud data API as a pure request → response function. AWS Lambda
 * (through API Gateway) and the local test server both wrap this same
 * function, so what is tested locally is what runs in AWS.
 *
 * Order of checks for every request: route → authentication → per-user rate
 * limit → input validation → the operation, always scoped to the
 * authenticated user's own partition.
 */

export interface UserDirectory {
  /** Deletes the sign-in account (Cognito AdminDeleteUser in AWS). */
  deleteUser(username: string): Promise<void>;
}

export interface CloudLogEntry {
  requestId: string;
  /** The route template ("PUT /v1/applications/{id}"), never the concrete path. */
  route: string;
  status: number;
  durationMs: number;
  /** Short one-way hash of the user id, enough to group requests and nothing more. */
  user?: string;
  code?: CloudErrorCode;
}

export interface CloudApiOptions {
  store: CloudStore;
  authenticate: Authenticator;
  /** Only the account function has it (it alone may delete sign-in accounts). */
  users?: UserDirectory;
  /** Which routes this deployment serves; others answer 404. Defaults to all. */
  functions?: readonly CloudFunction[];
  version: string;
  requestsPerMinute?: number;
  maxBodyBytes?: number;
  now?: () => Date;
  log?: (entry: CloudLogEntry) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudErrorCode,
    message: string,
    readonly extra: Partial<CloudErrorBody['error']> = {},
  ) {
    super(message);
  }
}

function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'The request is not valid.';
  const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
  return `Invalid ${path}: ${issue.message}`;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, 'INVALID_REQUEST', describeIssue(parsed.error.issues[0]));
  }
  return parsed.data;
}

function hashUser(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

function ok(body: unknown, status = 200): ApiResponse {
  return { status, body };
}

const MAX_WRITE_RETRIES = 3;

export function createCloudApi({
  store,
  authenticate,
  users,
  functions = ['data', 'account'],
  version,
  requestsPerMinute = 120,
  maxBodyBytes = 1_000_000,
  now = () => new Date(),
  log = () => undefined,
}: CloudApiOptions) {
  const routes = CLOUD_ROUTES.filter((r) => functions.includes(r.fn));
  const clock = { now, newId: () => randomUUID() };

  function readJson(request: ApiRequest): unknown {
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
      throw new HttpError(400, 'INVALID_REQUEST', 'Send JSON with Content-Type: application/json.');
    }
    try {
      return JSON.parse(request.body);
    } catch {
      throw new HttpError(400, 'INVALID_REQUEST', 'The request body is not valid JSON.');
    }
  }

  function baseVersionParam(request: ApiRequest): number {
    const raw = request.query?.baseVersion;
    const value = Number(raw);
    if (raw === undefined || !Number.isInteger(value) || value < 1) {
      throw new HttpError(
        400,
        'INVALID_REQUEST',
        'Add ?baseVersion=<the version you are deleting>.',
      );
    }
    return value;
  }

  function pageParam(request: ApiRequest): string | null {
    const page = request.query?.page;
    if (page === undefined || page === '') return null;
    if (page.length > 2000)
      throw new HttpError(400, 'INVALID_REQUEST', 'The page token is not valid.');
    return page;
  }

  function idParam(params: Record<string, string>, name = 'id'): string {
    return parse(itemIdSchema, params[name]);
  }

  /** Writes one change; a version clash becomes 409 with the current copy. */
  async function write(user: AuthenticatedUser, change: ItemChange): Promise<CloudItem> {
    const result = await store.put(user.userId, change);
    if (result.outcome === 'applied') return result.item;
    if (result.outcome === 'conflict') {
      throw new HttpError(409, 'CONFLICT', 'The item changed in the cloud. Sync and try again.', {
        current: result.current,
      });
    }
    throw new HttpError(
      result.code === 'PAYLOAD_TOO_LARGE' ? 413 : 409,
      result.code,
      result.message,
    );
  }

  async function liveApplication(user: AuthenticatedUser, id: string): Promise<ApplicationItem> {
    const item = await store.get(user.userId, 'application', id);
    if (!item || item.kind !== 'application' || item.data === null) {
      throw new HttpError(404, 'NOT_FOUND', 'No application with that id.');
    }
    return item;
  }

  /** Read, change and write back one record, retrying if another device wrote in between. */
  async function modify(
    user: AuthenticatedUser,
    id: string,
    change: (record: ApplicationRecord) => ApplicationRecord,
  ): Promise<CloudItem> {
    for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
      const item = await liveApplication(user, id);
      const next = applicationRecordSchema.parse(change(item.data as ApplicationRecord));
      const result = await store.put(user.userId, {
        kind: 'application',
        id,
        baseVersion: item.version,
        data: next,
      });
      if (result.outcome === 'applied') return result.item;
      if (result.outcome === 'rejected') throw new HttpError(413, result.code, result.message);
    }
    throw new HttpError(409, 'CONFLICT', 'The item kept changing. Try again.');
  }

  async function push(user: AuthenticatedUser, body: unknown): Promise<PushResponse> {
    const request = parse(pushRequestSchema, body);
    const { epoch } = await store.epoch(user.userId);
    if (request.epoch !== epoch) {
      throw new HttpError(
        409,
        'EPOCH_CHANGED',
        'The cloud data was deleted or reset since this device last synced.',
      );
    }
    const results: PushResult[] = [];
    for (const change of request.changes) {
      const result = await store.put(user.userId, change);
      results.push(
        result.outcome === 'applied'
          ? { outcome: 'applied', item: result.item }
          : result.outcome === 'conflict'
            ? { outcome: 'conflict', kind: change.kind, id: change.id, current: result.current }
            : {
                outcome: 'rejected',
                kind: change.kind,
                id: change.id,
                code: result.code,
                message: result.message,
              },
      );
    }
    return { epoch, results };
  }

  async function exportAll(user: AuthenticatedUser): Promise<AccountExport> {
    const profile = await store.get(user.userId, 'profile', PROFILE_ITEM_ID);
    const applications: ApplicationRecord[] = [];
    let page: string | null = null;
    do {
      const result = await store.listApplications(user.userId, page);
      for (const item of result.items) if (item.data) applications.push(item.data);
      page = result.page;
    } while (page !== null);
    return {
      format: 'applypilot-cloud-export',
      version: 1,
      exportedAt: now().toISOString(),
      profile: profile?.kind === 'profile' ? profile.data : null,
      applications,
    };
  }

  async function dispatch(
    request: ApiRequest,
    key: string,
    params: Record<string, string>,
    user: AuthenticatedUser | null,
  ): Promise<ApiResponse> {
    if (key === 'GET /v1/health') return ok({ ok: true, service: 'applypilot-cloud', version });
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in again.');
    switch (key) {
      case 'GET /v1/account': {
        const { epoch, applications } = await store.epoch(user.userId);
        const profile = await store.get(user.userId, 'profile', PROFILE_ITEM_ID);
        const body: AccountResponse = {
          userId: user.userId,
          epoch,
          profile: profile !== null && profile.data !== null,
          applications,
        };
        return ok(body);
      }
      case 'GET /v1/account/export':
        return ok(await exportAll(user));
      case 'DELETE /v1/account/data': {
        const { deleted, epoch } = await store.deleteAll(user.userId);
        return ok({ deleted, epoch });
      }
      case 'DELETE /v1/account': {
        if (!users) throw new HttpError(404, 'NOT_FOUND', 'Unknown endpoint.');
        // Data first: if deleting the sign-in account then fails, retrying is safe.
        const { deleted } = await store.deleteAll(user.userId, { closeAccount: true });
        await users.deleteUser(user.username);
        return ok({ deleted, accountDeleted: true });
      }
      case 'GET /v1/profile': {
        const item = await store.get(user.userId, 'profile', PROFILE_ITEM_ID);
        if (!item || item.data === null)
          throw new HttpError(404, 'NOT_FOUND', 'No profile in the cloud.');
        return ok({ item });
      }
      case 'PUT /v1/profile': {
        const body = parse(putItemRequestSchema, readJson(request));
        const change = parse(profileChangeSchema, {
          kind: 'profile',
          id: PROFILE_ITEM_ID,
          ...body,
        });
        if (change.data === null)
          throw new HttpError(400, 'INVALID_REQUEST', 'Use DELETE to delete.');
        return ok({ item: await write(user, change) });
      }
      case 'DELETE /v1/profile':
        return ok({
          item: await write(user, {
            kind: 'profile',
            id: PROFILE_ITEM_ID,
            baseVersion: baseVersionParam(request),
            data: null,
          }),
        });
      case 'GET /v1/applications':
        return ok(await store.listApplications(user.userId, pageParam(request)));
      case 'GET /v1/applications/{id}':
        return ok({ item: await liveApplication(user, idParam(params)) });
      case 'PUT /v1/applications/{id}': {
        const body = parse(putItemRequestSchema, readJson(request));
        const change = parse(applicationChangeSchema, {
          kind: 'application',
          id: idParam(params),
          ...body,
        });
        if (change.data === null)
          throw new HttpError(400, 'INVALID_REQUEST', 'Use DELETE to delete.');
        return ok({ item: await write(user, change) });
      }
      case 'DELETE /v1/applications/{id}':
        return ok({
          item: await write(user, {
            kind: 'application',
            id: idParam(params),
            baseVersion: baseVersionParam(request),
            data: null,
          }),
        });
      case 'GET /v1/applications/{id}/history': {
        const item = await liveApplication(user, idParam(params));
        const data = item.data as ApplicationRecord;
        return ok({ id: item.id, status: data.status, history: data.history });
      }
      case 'POST /v1/applications/{id}/status': {
        const { status } = parse(statusRequestSchema, readJson(request));
        return ok({
          item: await modify(user, idParam(params), (r) => setStatus(r, status, now())),
        });
      }
      case 'POST /v1/applications/{id}/notes': {
        const { text } = parse(noteRequestSchema, readJson(request));
        return ok(
          { item: await modify(user, idParam(params), (r) => addNote(r, text, clock)) },
          201,
        );
      }
      case 'DELETE /v1/applications/{id}/notes/{noteId}': {
        const noteId = idParam(params, 'noteId');
        return ok({
          item: await modify(user, idParam(params), (r) => {
            if (!r.notes.some((n) => n.id === noteId)) {
              throw new HttpError(404, 'NOT_FOUND', 'No note with that id.');
            }
            return removeNote(r, noteId, now());
          }),
        });
      }
      case 'PUT /v1/applications/{id}/follow-up': {
        const { followUp } = parse(followUpRequestSchema, readJson(request));
        return ok({
          item: await modify(user, idParam(params), (r) => setFollowUp(r, followUp, now())),
        });
      }
      case 'GET /v1/sync/changes': {
        const raw = request.query?.since;
        const since = raw === undefined || raw === '' ? null : Number(raw);
        if (since !== null && (!Number.isSafeInteger(since) || since < 0)) {
          throw new HttpError(
            400,
            'INVALID_REQUEST',
            'since must be a cursor from an earlier response.',
          );
        }
        const { epoch } = await store.epoch(user.userId);
        const body: ChangesResponse = {
          epoch,
          ...(await store.changes(user.userId, since, pageParam(request))),
        };
        return ok(body);
      }
      case 'POST /v1/sync/push':
        return ok(await push(user, readJson(request)));
      default:
        throw new HttpError(404, 'NOT_FOUND', 'Unknown endpoint.');
    }
  }

  return async function handle(request: ApiRequest): Promise<ApiResponse> {
    const started = Date.now();
    const requestId = request.requestId ?? randomUUID();
    let routeName = `${request.method} (unmatched)`;
    let user: AuthenticatedUser | null = null;
    let response: ApiResponse;
    try {
      const match = matchRoute(request.method, request.path, routes);
      if (!match.route) {
        throw match.pathKnown
          ? new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint does not take that method.')
          : new HttpError(404, 'NOT_FOUND', 'Unknown endpoint.');
      }
      routeName = `${match.route.method} ${match.route.path}`;
      if (Buffer.byteLength(request.body) > maxBodyBytes) {
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
      }
      if (match.route.auth) {
        user = await authenticate(request.headers.authorization);
        if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in again.');
        if (!(await store.consume(user.userId, 'requests', requestsPerMinute, 60))) {
          throw new HttpError(
            429,
            'RATE_LIMITED',
            'Too many requests. Wait a minute and try again.',
          );
        }
      }
      response = await dispatch(request, routeName, match.params, user);
    } catch (caught) {
      const e =
        caught instanceof InvalidPageError
          ? new HttpError(400, 'INVALID_REQUEST', caught.message)
          : caught;
      if (e instanceof HttpError) {
        const body: CloudErrorBody = {
          error: { code: e.code, message: e.message, requestId, ...e.extra },
        };
        response = {
          status: e.status,
          body,
          ...(e.status === 429 ? { headers: { 'Retry-After': '60' } } : {}),
          ...(e.status === 401 ? { headers: { 'WWW-Authenticate': 'Bearer' } } : {}),
        };
      } else {
        // Details go to the logs with the request id; the user sees the id only.
        console.error(JSON.stringify({ level: 'error', requestId, error: String(e) }));
        const body: CloudErrorBody = {
          error: {
            code: 'INTERNAL',
            message: 'Something went wrong in ApplyPilot Cloud.',
            requestId,
          },
        };
        response = { status: 500, body };
      }
    }
    const code = (response.body as Partial<CloudErrorBody> | null)?.error?.code;
    log({
      requestId,
      route: routeName,
      status: response.status,
      durationMs: Date.now() - started,
      ...(user ? { user: hashUser(user.userId) } : {}),
      ...(code ? { code } : {}),
    });
    return response;
  };
}
