import type { ApiRequest, ApiResponse } from '../app';

/**
 * Turns API Gateway (REST API, Lambda proxy integration) events into the
 * API's plain requests and back. Only the fields used here are typed.
 */

export interface ApiGatewayEvent {
  httpMethod: string;
  /** The resource path without the stage, e.g. /v1/profile. */
  path: string;
  headers: Record<string, string | undefined> | null;
  queryStringParameters: Record<string, string | undefined> | null;
  body: string | null;
  isBase64Encoded: boolean;
  requestContext: { requestId: string };
}

export interface ApiGatewayResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function toApiRequest(event: ApiGatewayEvent): ApiRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  const body =
    event.body === null
      ? ''
      : event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
  return {
    method: event.httpMethod,
    path: event.path,
    headers,
    query: { ...(event.queryStringParameters ?? {}) },
    body,
    requestId: event.requestContext.requestId,
  };
}

/**
 * Security headers on every response. CORS is answered only for the
 * extension origins the stack was configured with.
 */
export function toResult(
  response: ApiResponse,
  origin: string | undefined,
  allowedOrigins: readonly string[],
): ApiGatewayResult {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    Vary: 'Origin',
    ...response.headers,
  };
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return {
    statusCode: response.status,
    headers,
    body: response.body === null ? '' : JSON.stringify(response.body),
  };
}

export function allowedOriginsFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^chrome-extension:\/\/[a-p]{32}$/.test(o));
}

export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}
