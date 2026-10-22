import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { CreateTableCommand, DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import { documentClient } from '../cloud/store';
import { createTableInput } from '../cloud/table';

/**
 * A local stand-in for DynamoDB (dynalite, an open-source implementation of
 * the DynamoDB API), so the real AWS SDK calls in CloudStore run unchanged in
 * tests and on Muhaid's machine. Nothing here talks to AWS.
 *
 * The local server can keep its data in a JSON file between restarts; the
 * file holds personal data and stays on this machine (it is git-ignored).
 */

export interface LocalDynamo {
  endpoint: string;
  tableName: string;
  client: DynamoDBClient;
  doc: DynamoDBDocumentClient;
  /** Writes every item to the persistence file, if one was given. */
  save(): Promise<void>;
  close(): Promise<void>;
}

export async function startLocalDynamo(
  options: { tableName?: string; persistFile?: string } = {},
): Promise<LocalDynamo> {
  const tableName = options.tableName ?? 'applypilot-local';
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}`;
  const client = new DynamoDBClient({
    endpoint,
    region: 'local',
    // dynalite ignores credentials; these are placeholders, not secrets.
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const doc = documentClient(client);
  await client.send(new CreateTableCommand(createTableInput(tableName)));

  if (options.persistFile && existsSync(options.persistFile)) {
    const items = JSON.parse(readFileSync(options.persistFile, 'utf8')) as Record<
      string,
      unknown
    >[];
    for (let i = 0; i < items.length; i += 25) {
      await doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: items
              .slice(i, i + 25)
              .map((item) => ({ PutRequest: { Item: revive(item) } })),
          },
        }),
      );
    }
  }

  async function save() {
    if (!options.persistFile) return;
    const items: Record<string, unknown>[] = [];
    let start: Record<string, AttributeValue> | undefined;
    do {
      const page = await doc.send(
        new ScanCommand({ TableName: tableName, ...(start ? { ExclusiveStartKey: start } : {}) }),
      );
      items.push(...(page.Items ?? []).map(freeze));
      start = page.LastEvaluatedKey as Record<string, AttributeValue> | undefined;
    } while (start);
    const tmp = `${options.persistFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(items), { mode: 0o600 });
    renameSync(tmp, options.persistFile);
  }

  return {
    endpoint,
    tableName,
    client,
    doc,
    save,
    async close() {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Binary attributes (compressed item data) round-trip through JSON as base64. */
function freeze(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [
      k,
      v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v,
    ]),
  );
}

function revive(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [
      k,
      v && typeof v === 'object' && '$b64' in v
        ? new Uint8Array(Buffer.from((v as { $b64: string }).$b64, 'base64'))
        : v,
    ]),
  );
}
