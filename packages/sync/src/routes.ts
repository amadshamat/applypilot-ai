/**
 * Every cloud endpoint, in one table. The API routes requests with it and the
 * CDK stack creates exactly these API Gateway methods from it, so an endpoint
 * cannot exist in one place and not the other.
 */

export type CloudFunction = 'data' | 'account' | 'ai';
export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE';

export interface CloudRoute {
  method: HttpMethod;
  /** API Gateway style path; `{name}` matches one path segment. */
  path: string;
  /** Which Lambda function serves it (each has only the permissions it needs). */
  fn: CloudFunction;
  /** False only for the health check. Everything else needs a signed-in user. */
  auth: boolean;
  summary: string;
}

export const CLOUD_ROUTES: readonly CloudRoute[] = [
  { method: 'GET', path: '/v1/health', fn: 'data', auth: false, summary: 'Service status' },
  { method: 'GET', path: '/v1/account', fn: 'data', auth: true, summary: 'Account summary' },
  {
    method: 'GET',
    path: '/v1/account/export',
    fn: 'data',
    auth: true,
    summary: 'Download all cloud data',
  },
  {
    method: 'DELETE',
    path: '/v1/account/data',
    fn: 'account',
    auth: true,
    summary: 'Delete all cloud data, keep the account',
  },
  {
    method: 'DELETE',
    path: '/v1/account',
    fn: 'account',
    auth: true,
    summary: 'Delete the account and all cloud data',
  },
  { method: 'GET', path: '/v1/profile', fn: 'data', auth: true, summary: 'Read the profile' },
  { method: 'PUT', path: '/v1/profile', fn: 'data', auth: true, summary: 'Save the profile' },
  { method: 'DELETE', path: '/v1/profile', fn: 'data', auth: true, summary: 'Delete the profile' },
  {
    method: 'GET',
    path: '/v1/applications',
    fn: 'data',
    auth: true,
    summary: 'List tracked applications',
  },
  {
    method: 'GET',
    path: '/v1/applications/{id}',
    fn: 'data',
    auth: true,
    summary: 'Read one application',
  },
  {
    method: 'PUT',
    path: '/v1/applications/{id}',
    fn: 'data',
    auth: true,
    summary: 'Save one application',
  },
  {
    method: 'DELETE',
    path: '/v1/applications/{id}',
    fn: 'data',
    auth: true,
    summary: 'Delete one application',
  },
  {
    method: 'GET',
    path: '/v1/applications/{id}/history',
    fn: 'data',
    auth: true,
    summary: 'Status history',
  },
  {
    method: 'POST',
    path: '/v1/applications/{id}/status',
    fn: 'data',
    auth: true,
    summary: 'Change the status',
  },
  {
    method: 'POST',
    path: '/v1/applications/{id}/notes',
    fn: 'data',
    auth: true,
    summary: 'Add a note',
  },
  {
    method: 'DELETE',
    path: '/v1/applications/{id}/notes/{noteId}',
    fn: 'data',
    auth: true,
    summary: 'Delete a note',
  },
  {
    method: 'PUT',
    path: '/v1/applications/{id}/follow-up',
    fn: 'data',
    auth: true,
    summary: 'Set or clear the follow-up reminder',
  },
  {
    method: 'GET',
    path: '/v1/sync/changes',
    fn: 'data',
    auth: true,
    summary: 'Changes since a cursor',
  },
  {
    method: 'POST',
    path: '/v1/sync/push',
    fn: 'data',
    auth: true,
    summary: 'Upload changes with conflict checks',
  },
];

export interface RouteMatch {
  route: CloudRoute;
  params: Record<string, string>;
}

/**
 * Finds the route for a request. Returns `{ route: null, pathKnown: true }`
 * when the path exists with other methods (405 rather than 404).
 */
export function matchRoute(
  method: string,
  path: string,
  routes: readonly CloudRoute[] = CLOUD_ROUTES,
): RouteMatch | { route: null; pathKnown: boolean } {
  const segments = path.split('/');
  let pathKnown = false;
  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((part, i) => {
      const segment = segments[i] ?? '';
      if (part.startsWith('{') && part.endsWith('}')) {
        if (segment === '') return false;
        try {
          params[part.slice(1, -1)] = decodeURIComponent(segment);
        } catch {
          return false;
        }
        return true;
      }
      return part === segment;
    });
    if (!ok) continue;
    if (route.method === method) return { route, params };
    pathKnown = true;
  }
  return { route: null, pathKnown };
}
