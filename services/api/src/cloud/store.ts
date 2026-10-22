import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { MAX_APPLICATIONS } from '@applypilot/shared';
import {
  PROFILE_ITEM_ID,
  cloudItemSchema,
  type ApplicationItem,
  type CloudItem,
  type ItemChange,
  type ItemKind,
} from '@applypilot/sync';
import { TABLE } from './table';

/**
 * Cloud storage for synced items, on DynamoDB.
 *
 * - Optimistic concurrency: a write names the version it was based on and is
 *   a conditional put, so two devices can never silently overwrite each other.
 * - Item data is stored gzip-compressed (resumes and notes compress well, and
 *   it keeps items far below DynamoDB's 400 KB limit).
 * - Every key is built here from the authenticated user id passed in by the
 *   API; request input never chooses a partition.
 */

export const MAX_STORED_BYTES = 300_000;
/** Changes are re-sent from slightly before the cursor, so a write still in flight is never missed. */
export const CHANGE_OVERLAP_MS = 30_000;
const PAGE_ITEMS = 50;
const PAGE_BYTES = 3_000_000;

interface StoredItem {
  pk: string;
  sk: string;
  kind: ItemKind;
  id: string;
  version: number;
  changedAt: number;
  updatedAt: string;
  /** gzip(JSON(data)); absent for a tombstone. */
  data?: Uint8Array;
}

export type PutOutcome =
  | { outcome: 'applied'; item: CloudItem }
  | { outcome: 'conflict'; current: CloudItem | null }
  | { outcome: 'rejected'; code: 'LIMIT_REACHED' | 'PAYLOAD_TOO_LARGE'; message: string };

export function documentClient(client: DynamoDBClient): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export class StoredDataError extends Error {
  override name = 'StoredDataError';
}

export const userKey = (userId: string) => `USER#${userId}`;
export const itemKey = (kind: ItemKind, id: string) =>
  kind === 'profile' ? 'PROFILE' : `APP#${id}`;
const META = 'META';

function encodePage(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePage(token: string): unknown {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export class InvalidPageError extends Error {
  override name = 'InvalidPageError';
}

export interface CloudStoreOptions {
  doc: DynamoDBDocumentClient;
  tableName: string;
  now?: () => Date;
  newEpoch?: () => string;
}

export class CloudStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly now: () => Date;
  private readonly newEpoch: () => string;

  constructor({
    doc,
    tableName,
    now = () => new Date(),
    newEpoch = randomUUID,
  }: CloudStoreOptions) {
    this.doc = doc;
    this.table = tableName;
    this.now = now;
    this.newEpoch = newEpoch;
  }

  private decode(stored: StoredItem): CloudItem {
    let data: unknown = null;
    if (stored.data) {
      data = JSON.parse(gunzipSync(stored.data).toString('utf8'));
    }
    const parsed = cloudItemSchema.safeParse({
      kind: stored.kind,
      id: stored.id,
      version: stored.version,
      changedAt: stored.changedAt,
      data,
    });
    if (!parsed.success) throw new StoredDataError(`Stored item ${stored.sk} does not validate.`);
    return parsed.data;
  }

  /** The user's data epoch, created on first use. It changes when all cloud data is deleted. */
  async epoch(userId: string): Promise<{ epoch: string; applications: number }> {
    const found = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: userKey(userId), sk: META },
        ConsistentRead: true,
      }),
    );
    const meta = found.Item as { epoch?: string; appCount?: number } | undefined;
    if (meta?.epoch) return { epoch: meta.epoch, applications: Math.max(0, meta.appCount ?? 0) };
    const epoch = this.newEpoch();
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: userKey(userId), sk: META, epoch, appCount: 0 },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return { epoch, applications: 0 };
    } catch (e) {
      // Another request created it first.
      if (e instanceof ConditionalCheckFailedException) return this.epoch(userId);
      throw e;
    }
  }

  async get(userId: string, kind: ItemKind, id: string): Promise<CloudItem | null> {
    const found = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: userKey(userId), sk: itemKey(kind, id) },
        ConsistentRead: true,
      }),
    );
    return found.Item ? this.decode(found.Item as StoredItem) : null;
  }

  async put(userId: string, change: ItemChange): Promise<PutOutcome> {
    const pk = userKey(userId);
    const creating = change.kind === 'application' && change.data !== null;
    if (creating && change.baseVersion === 0) {
      const { applications } = await this.epoch(userId);
      if (applications >= MAX_APPLICATIONS) {
        return {
          outcome: 'rejected',
          code: 'LIMIT_REACHED',
          message: `The cloud keeps up to ${MAX_APPLICATIONS} applications.`,
        };
      }
    }
    let data: Uint8Array | undefined;
    if (change.data !== null) {
      data = gzipSync(JSON.stringify(change.data));
      if (data.byteLength > MAX_STORED_BYTES) {
        return {
          outcome: 'rejected',
          code: 'PAYLOAD_TOO_LARGE',
          message: 'This item is too large to store in the cloud.',
        };
      }
    }
    const item: StoredItem = {
      pk,
      sk: itemKey(change.kind, change.kind === 'profile' ? PROFILE_ITEM_ID : change.id),
      kind: change.kind,
      id: change.id,
      version: change.baseVersion + 1,
      changedAt: this.now().getTime(),
      updatedAt: this.now().toISOString(),
      ...(data ? { data } : {}),
    };
    let previous: StoredItem | undefined;
    try {
      const result = await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ...(change.baseVersion === 0
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : {
                ConditionExpression: '#v = :base',
                ExpressionAttributeNames: { '#v': 'version' },
                ExpressionAttributeValues: { ':base': change.baseVersion },
              }),
          ReturnValues: 'ALL_OLD',
        }),
      );
      previous = result.Attributes as StoredItem | undefined;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        return {
          outcome: 'conflict',
          current: await this.get(userId, change.kind, change.id),
        };
      }
      throw e;
    }
    if (change.kind === 'application') {
      const delta = (data ? 1 : 0) - (previous?.data ? 1 : 0);
      if (delta !== 0) await this.adjustCount(userId, delta);
    }
    return { outcome: 'applied', item: this.decode(item) };
  }

  private async adjustCount(userId: string, delta: number) {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: userKey(userId), sk: META },
        UpdateExpression: 'ADD appCount :d',
        ExpressionAttributeValues: { ':d': delta },
      }),
    );
  }

  /** Items changed after `since` (minus the overlap), oldest first, in pages. */
  async changes(
    userId: string,
    since: number | null,
    page: string | null,
  ): Promise<{ items: CloudItem[]; page: string | null; cursor: number | null }> {
    const pk = userKey(userId);
    let start: Record<string, unknown> | undefined;
    let cursorAt = this.now().getTime();
    if (page !== null) {
      const token = decodePage(page) as { k?: Record<string, unknown>; c?: number } | null;
      if (!token?.k || token.k.pk !== pk || typeof token.c !== 'number') {
        throw new InvalidPageError('The page token is not valid.');
      }
      start = token.k;
      cursorAt = token.c;
    }
    const from = since === null ? -1 : Math.max(-1, since - CHANGE_OVERLAP_MS);
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: TABLE.changeIndex,
        KeyConditionExpression: 'pk = :pk AND changedAt > :from',
        ExpressionAttributeValues: { ':pk': pk, ':from': from },
        ConsistentRead: true,
        Limit: PAGE_ITEMS,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    const items: CloudItem[] = [];
    let bytes = 0;
    let next: Record<string, unknown> | undefined = result.LastEvaluatedKey;
    for (const stored of (result.Items ?? []) as StoredItem[]) {
      items.push(this.decode(stored));
      bytes += stored.data?.byteLength ?? 0;
      if (bytes > PAGE_BYTES && stored !== result.Items?.at(-1)) {
        next = { pk: stored.pk, sk: stored.sk, changedAt: stored.changedAt };
        break;
      }
    }
    return next
      ? { items, page: encodePage({ k: next, c: cursorAt }), cursor: null }
      : { items, page: null, cursor: cursorAt };
  }

  /** Live (not deleted) applications, a page at a time. */
  async listApplications(
    userId: string,
    page: string | null,
  ): Promise<{ items: ApplicationItem[]; page: string | null }> {
    const pk = userKey(userId);
    let start: Record<string, unknown> | undefined;
    if (page !== null) {
      const token = decodePage(page) as { k?: Record<string, unknown> } | null;
      if (!token?.k || token.k.pk !== pk)
        throw new InvalidPageError('The page token is not valid.');
      start = token.k;
    }
    const result = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :app)',
        ExpressionAttributeValues: { ':pk': pk, ':app': 'APP#' },
        ConsistentRead: true,
        Limit: 100,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    const items = ((result.Items ?? []) as StoredItem[])
      .filter((s) => s.data)
      .map((s) => this.decode(s) as ApplicationItem);
    return {
      items,
      page: result.LastEvaluatedKey ? encodePage({ k: result.LastEvaluatedKey }) : null,
    };
  }

  /**
   * Deletes every item the user has, then starts a new epoch so other devices
   * notice instead of uploading their copies straight back. When the account
   * is being closed, nothing at all is left behind.
   */
  async deleteAll(
    userId: string,
    { closeAccount = false }: { closeAccount?: boolean } = {},
  ): Promise<{ deleted: number; epoch: string | null }> {
    const pk = userKey(userId);
    let deleted = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const result = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ProjectionExpression: 'pk, sk',
          ConsistentRead: true,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      const keys = (result.Items ?? []) as { pk: string; sk: string }[];
      for (let i = 0; i < keys.length; i += 25) {
        let requests = keys
          .slice(i, i + 25)
          .map((Key) => ({ DeleteRequest: { Key: { pk: Key.pk, sk: Key.sk } } }));
        for (let attempt = 0; requests.length > 0; attempt++) {
          if (attempt > 5) throw new Error('DynamoDB did not finish deleting the items.');
          const written = await this.doc.send(
            new BatchWriteCommand({ RequestItems: { [this.table]: requests } }),
          );
          requests = (written.UnprocessedItems?.[this.table] ?? []) as typeof requests;
          if (requests.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
        deleted += keys
          .slice(i, i + 25)
          .filter((k) => k.sk === 'PROFILE' || k.sk.startsWith('APP#')).length;
      }
      start = result.LastEvaluatedKey;
    } while (start);
    if (closeAccount) return { deleted, epoch: null };
    const epoch = this.newEpoch();
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk, sk: META, epoch, appCount: 0 },
      }),
    );
    return { deleted, epoch };
  }

  /** How many requests the counter has recorded in the current window. */
  async used(userId: string, name: string, windowSeconds: number): Promise<number> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const window = nowSeconds - (nowSeconds % windowSeconds);
    const found = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: userKey(userId), sk: `LIMIT#${name}#${window}` },
        ConsistentRead: true,
      }),
    );
    return (found.Item as { count?: number } | undefined)?.count ?? 0;
  }

  /**
   * Fixed-window counter: true if the user may make another request in this
   * window. Counters expire on their own through the table's TTL.
   */
  async consume(userId: string, name: string, limit: number, windowSeconds: number) {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const window = nowSeconds - (nowSeconds % windowSeconds);
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: userKey(userId), sk: `LIMIT#${name}#${window}` },
          UpdateExpression: 'ADD #n :one SET #ttl = :ttl',
          ConditionExpression: 'attribute_not_exists(#n) OR #n < :limit',
          ExpressionAttributeNames: { '#n': 'count', '#ttl': TABLE.ttlAttribute },
          ExpressionAttributeValues: {
            ':one': 1,
            ':limit': limit,
            ':ttl': window + windowSeconds * 2,
          },
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }
}
