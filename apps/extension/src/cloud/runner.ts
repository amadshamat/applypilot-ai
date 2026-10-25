import { applicationRecordSchema } from '@applypilot/shared';
import {
  CloudClient,
  CloudClientError,
  SyncEngine,
  initialSyncState,
  type SyncConflict,
  type SyncReport,
} from '@applypilot/sync';
import { CloudAuthError, type CloudAuth } from './auth';
import type { CloudConnection, CloudSettingsRepository } from './connection';
import type { ExtensionLocalData } from './local-data';
import { okStatus, type SyncRequest, type SyncResponse } from './messages';
import {
  OFF_STATUS,
  ownerKey,
  type SyncConflictSummary,
  type SyncStateRepository,
  type SyncStatus,
  type SyncStatusRepository,
} from './sync-store';

/**
 * Runs sync in the service worker, one operation at a time, and records the
 * outcome where Settings can show it. Sync only ever runs when the user has
 * turned it on and is signed in.
 */

export interface SyncRunnerDeps {
  settings: CloudSettingsRepository;
  auth: CloudAuth;
  local: ExtensionLocalData;
  state: SyncStateRepository;
  status: SyncStatusRepository;
  fetch?: typeof fetch;
  now?: () => Date;
}

function conflictTitle(conflict: SyncConflict): string {
  if (conflict.kind === 'profile') return 'Your profile';
  for (const candidate of [conflict.local, conflict.remote.data]) {
    const parsed = applicationRecordSchema.safeParse(candidate);
    if (parsed.success) {
      const { title, company } = parsed.data.job;
      return company ? `${title} at ${company}` : title;
    }
  }
  return 'A tracked application';
}

export function summarizeConflicts(conflicts: SyncConflict[]): SyncConflictSummary[] {
  return conflicts.map((c) => ({
    kind: c.kind,
    id: c.id,
    title: conflictTitle(c),
    fields: c.fields,
    detectedAt: c.detectedAt,
  }));
}

function errorMessage(error: unknown): { state: SyncStatus['state']; message: string } {
  if (error instanceof CloudAuthError) {
    return error.code === 'SIGNED_OUT'
      ? { state: 'signed-out', message: error.message }
      : { state: 'error', message: error.message };
  }
  if (error instanceof CloudClientError) {
    if (error.code === 'UNAUTHORIZED') {
      return { state: 'signed-out', message: 'Your sign-in is no longer valid. Sign in again.' };
    }
    return { state: 'error', message: error.message };
  }
  return { state: 'error', message: 'Sync failed unexpectedly. Your local data was not changed.' };
}

export class SyncRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly deps: SyncRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Runs `task` after every earlier one has finished. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async context() {
    const settings = await this.deps.settings.load();
    const connection = settings.connection;
    if (!connection) return null;
    const session = await this.deps.auth.sessionFor(connection);
    return { settings, connection, session };
  }

  private engine(connection: CloudConnection, userId: string) {
    const client = new CloudClient({
      apiUrl: connection.apiUrl,
      accessToken: () => this.deps.auth.accessToken(connection),
      ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
    });
    const owner = ownerKey(connection.apiUrl, userId);
    return {
      owner,
      engine: new SyncEngine(this.deps.local, client, this.deps.state.forOwner(owner)),
    };
  }

  private async record(
    owner: string,
    report: SyncReport | null,
    failure: { state: SyncStatus['state']; message: string } | null,
  ): Promise<SyncStatus> {
    const previous = await this.deps.status.load();
    const state = await this.deps.state.load(owner);
    const at = this.now().toISOString();
    const status: SyncStatus = {
      ...OFF_STATUS,
      lastRunAt: at,
      lastSyncedAt: state.lastSyncedAt ?? previous.lastSyncedAt,
      conflicts: summarizeConflicts(state.conflicts),
    };
    if (failure) return this.deps.status.save({ ...status, ...failure });
    if (!report) return this.deps.status.save(status);
    status.rejected = report.rejected;
    switch (report.outcome) {
      case 'synced':
        status.state = 'synced';
        status.message =
          report.conflicts > 0
            ? `Synced. ${report.conflicts} item${report.conflicts === 1 ? '' : 's'} changed on two devices need your choice.`
            : null;
        break;
      case 'needs-confirmation':
        status.state = 'needs-confirmation';
        status.pendingDeletions = report.pendingDeletions;
        status.pendingCloudDeletions = report.pendingCloudDeletions;
        status.message = 'Sync paused before deleting several records. Nothing was deleted.';
        break;
      case 'cloud-reset':
        status.state = 'cloud-reset';
        status.message =
          'Your cloud data was deleted or reset from another device. Nothing was uploaded from this browser.';
        break;
      case 'retry':
        status.state = 'error';
        status.message =
          'You edited data while syncing, so nothing was overwritten. Sync runs again within 15 minutes, or press Sync now.';
        break;
    }
    return this.deps.status.save(status);
  }

  /**
   * Call when the service worker starts. A status still saying "syncing" is
   * left from a run that Chrome stopped part-way (the worker was suspended or
   * the browser closed); no run can be in progress in a fresh worker. Writes
   * are checked against what was read, so an interrupted run loses nothing.
   */
  recoverInterrupted(): Promise<void> {
    return this.exclusive(async () => {
      const status = await this.deps.status.load();
      if (status.state !== 'syncing') return;
      await this.deps.status.save({
        ...status,
        state: 'error',
        message: 'The last sync was interrupted. Nothing was lost; it runs again at the next sync.',
      });
    });
  }

  /** An automatic run (timer or data change): skipped unless sync is on and signed in. */
  runIfEnabled(): Promise<SyncStatus | null> {
    return this.exclusive(async () => {
      const context = await this.context();
      if (!context?.settings.syncEnabled || !context.session) return null;
      return this.runNow(context.connection, context.session.userId, false);
    });
  }

  private async runNow(
    connection: CloudConnection,
    userId: string,
    allowDeletions: boolean,
  ): Promise<SyncStatus> {
    const { owner, engine } = this.engine(connection, userId);
    await this.deps.status.save({
      ...(await this.deps.status.load()),
      state: 'syncing',
      message: null,
    });
    try {
      let report = await engine.run({ allowDeletions, now: this.now });
      // The user typed while the run was writing: nothing was lost; try once more.
      if (report.outcome === 'retry') report = await engine.run({ allowDeletions, now: this.now });
      return await this.record(owner, report, null);
    } catch (error) {
      return this.record(owner, null, errorMessage(error));
    }
  }

  handle(request: SyncRequest): Promise<SyncResponse> {
    return this.exclusive(async () => {
      if (request.type === 'sync/reset') {
        await this.deps.state.clear();
        return okStatus(await this.deps.status.save({ ...OFF_STATUS }));
      }
      if (request.type === 'sync/restore') {
        const restored = await this.deps.local.restore(request.backupId);
        if (!restored)
          return {
            ok: false,
            error: { code: 'NOT_FOUND', message: 'That backup no longer exists.' },
          };
        return okStatus(await this.deps.status.load());
      }
      const context = await this.context();
      if (!context) {
        return {
          ok: false,
          error: { code: 'NOT_CONNECTED', message: 'Set up ApplyPilot Cloud first.' },
        };
      }
      if (!context.session) {
        return okStatus(
          await this.deps.status.save({
            ...(await this.deps.status.load()),
            state: 'signed-out',
            message: 'Sign in to ApplyPilot Cloud to sync.',
          }),
        );
      }
      if (!context.settings.syncEnabled) {
        return { ok: false, error: { code: 'SYNC_OFF', message: 'Turn on sync first.' } };
      }
      const { connection } = context;
      const { userId } = context.session;
      const { owner, engine } = this.engine(connection, userId);
      switch (request.type) {
        case 'sync/run':
          return okStatus(await this.runNow(connection, userId, request.allowDeletions ?? false));
        case 'sync/resolve':
          try {
            await engine.resolve(request.kind, request.id, request.choice);
          } catch (error) {
            return okStatus(await this.record(owner, null, errorMessage(error)));
          }
          return okStatus(await this.runNow(connection, userId, false));
        case 'sync/restart': {
          // Keep a copy first: the next run merges this browser with whatever the cloud has now.
          await this.deps.local.backup(
            await this.deps.local.read(),
            'Before syncing again after a cloud reset',
          );
          await this.deps.state.save(owner, initialSyncState());
          return okStatus(await this.runNow(connection, userId, false));
        }
      }
    });
  }
}
