import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ApiErrorBody } from '@applypilot/ai-core';
import type { ApiConfig } from './config';
import type { ApiRequest, ApiResponse } from './app';

/**
 * Node HTTP adapter for the API. Security checks that belong to the transport
 * live here:
 * - binds to 127.0.0.1 only, so nothing else on the network can reach it;
 * - rejects requests whose Host header is not localhost (DNS rebinding);
 * - allows only Chrome extension origins (CORS), and never web pages;
 * - caps the request body size.
 * Authentication (the bearer token) is checked by the API itself.
 */

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export function originAllowed(origin: string | undefined, config: ApiConfig): boolean {
  if (origin === undefined) return true; // Not a browser request (curl, scripts); the token still applies.
  if (config.allowedOrigins.length > 0) return config.allowedOrigins.includes(origin);
  return EXTENSION_ORIGIN.test(origin);
}

export function hostAllowed(host: string | undefined, config: ApiConfig): boolean {
  return host === `127.0.0.1:${config.port}` || host === `localhost:${config.port}`;
}

function send(res: ServerResponse, status: number, body: unknown, origin: string | undefined) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(body === null ? undefined : JSON.stringify(body));
}

function fail(code: ApiErrorBody['error']['code'], message: string): ApiErrorBody {
  return { error: { code, message } };
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.pause();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHttpServer(
  handle: (request: ApiRequest) => Promise<ApiResponse>,
  config: ApiConfig,
): Server {
  return createServer((req, res) => {
    void (async () => {
      const origin = req.headers.origin;
      if (!hostAllowed(req.headers.host, config)) {
        send(res, 403, fail('FORBIDDEN', 'Requests must be addressed to localhost.'), undefined);
        return;
      }
      if (!originAllowed(origin, config)) {
        send(res, 403, fail('FORBIDDEN', 'This origin is not allowed.'), undefined);
        return;
      }
      if (req.method === 'OPTIONS') {
        const headers: Record<string, string> = {
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        };
        if (origin) headers['Access-Control-Allow-Origin'] = origin;
        if (req.headers['access-control-request-private-network'] === 'true') {
          headers['Access-Control-Allow-Private-Network'] = 'true';
        }
        res.writeHead(204, headers);
        res.end();
        return;
      }
      let body: string;
      try {
        body = await readBody(req, config.maxBodyBytes);
      } catch (e) {
        if (e instanceof BodyTooLarge) {
          res.setHeader('Connection', 'close');
          send(res, 413, fail('PAYLOAD_TOO_LARGE', 'The request is too large.'), origin);
          res.on('finish', () => req.destroy());
        }
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]),
      );
      const response = await handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        headers,
        body,
      });
      send(res, response.status, response.body, origin);
    })();
  });
}
