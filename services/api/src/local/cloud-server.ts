import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import { createCloudApi, type CloudLogEntry } from '../cloud/api';
import { jwtAuthenticator } from '../cloud/auth';
import { CloudStore } from '../cloud/store';
import { createDevAuth, type DevAuth } from './dev-auth';
import { startLocalDynamo, type LocalDynamo } from './dynamo';

/**
 * ApplyPilot Cloud on this computer: the real cloud API code, with local
 * stand-ins for DynamoDB and Cognito, behind one address. It lets the
 * extension's sign-in and sync be tested end to end without an AWS account.
 *
 * Same transport rules as the local AI server: it listens on 127.0.0.1 only,
 * refuses other Host headers (DNS rebinding) and refuses web page origins.
 */

export interface LocalCloudOptions {
  port?: number;
  /** Folder for the data and test accounts; omit to keep everything in memory. */
  dataDir?: string;
  now?: () => Date;
  log?: (entry: CloudLogEntry) => void;
  requestsPerMinute?: number;
}

export interface LocalCloud {
  url: string;
  server: Server;
  auth: DevAuth;
  dynamo: LocalDynamo;
  store: CloudStore;
  close(): Promise<void>;
}

const MAX_BODY = 1_000_000;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.removeAllListeners('data');
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startLocalCloud(options: LocalCloudOptions = {}): Promise<LocalCloud> {
  const dynamo = await startLocalDynamo(
    options.dataDir ? { persistFile: join(options.dataDir, 'cloud-data.json') } : {},
  );
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const now = options.now ?? (() => new Date());
  const auth = createDevAuth({
    baseUrl: url,
    now,
    ...(options.dataDir ? { usersFile: join(options.dataDir, 'test-accounts.json') } : {}),
  });
  const store = new CloudStore({ doc: dynamo.doc, tableName: dynamo.tableName, now });
  const api = createCloudApi({
    store,
    authenticate: jwtAuthenticator({
      issuer: auth.issuer,
      clientId: auth.clientId,
      jwks: auth.signer.jwks,
    }),
    users: auth,
    functions: ['data', 'account'],
    version: pkg.version,
    now,
    ...(options.log ? { log: options.log } : {}),
    ...(options.requestsPerMinute ? { requestsPerMinute: options.requestsPerMinute } : {}),
  });

  let dirty = false;
  const timer = options.dataDir
    ? setInterval(() => {
        if (!dirty) return;
        dirty = false;
        void dynamo.save();
      }, 2000)
    : null;

  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  function sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string>,
  ) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
      ...headers,
    });
    res.end(body === null ? undefined : JSON.stringify(body));
  }

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const origin = req.headers.origin;
      const cors: Record<string, string> =
        origin && EXTENSION_ORIGIN.test(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
      if (!hosts.has(req.headers.host ?? '')) {
        sendJson(res, 403, { error: { code: 'FORBIDDEN', message: 'Use 127.0.0.1.' } }, {});
        return;
      }
      if (origin !== undefined && !EXTENSION_ORIGIN.test(origin) && origin !== url) {
        sendJson(
          res,
          403,
          { error: { code: 'FORBIDDEN', message: 'This origin is not allowed.' } },
          {},
        );
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          ...(req.headers['access-control-request-private-network'] === 'true'
            ? { 'Access-Control-Allow-Private-Network': 'true' }
            : {}),
        });
        res.end();
        return;
      }
      const body = await readBody(req);
      if (body === null) {
        res.setHeader('Connection', 'close');
        sendJson(res, 413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Too large.' } }, cors);
        return;
      }
      if (auth.handle(req, res, body)) return;
      const parsed = new URL(req.url ?? '/', url);
      const response = await api({
        method: req.method ?? 'GET',
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
        ),
        body,
      });
      if (req.method !== 'GET') dirty = true;
      sendJson(res, response.status, response.body, { ...cors, ...response.headers });
    })().catch((e: unknown) => {
      console.error(e);
      if (!res.headersSent)
        sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Error' } }, {});
    });
  });

  return {
    url,
    server,
    auth,
    dynamo,
    store,
    async close() {
      if (timer) clearInterval(timer);
      await dynamo.save();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await dynamo.close();
    },
  };
}
