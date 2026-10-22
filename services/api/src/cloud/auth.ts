import { JwtVerifier } from 'aws-jwt-verify';
import type { Jwks } from 'aws-jwt-verify/jwk';

/**
 * Checks the Cognito access token on every request. In AWS, API Gateway's
 * Cognito authorizer checks it first; the function checks it again, so a
 * misconfigured route can never reach data without a valid token (defence in
 * depth). The same code verifies the local stand-in's tokens in tests.
 *
 * A token is accepted only if its signature matches the user pool's keys, it
 * has not expired, it was issued by the pool, it is an access token (not an ID
 * token) and it was issued to the ApplyPilot app client.
 */

export interface AuthenticatedUser {
  /** Cognito `sub`: stable, never reused, and not personal data on its own. */
  userId: string;
  /** Cognito user name, needed to delete the account. */
  username: string;
}

export type Authenticator = (
  authorization: string | undefined,
) => Promise<AuthenticatedUser | null>;

export interface JwtAuthOptions {
  /** https://cognito-idp.<region>.amazonaws.com/<userPoolId>, or the local stand-in's issuer. */
  issuer: string;
  clientId: string;
  /** Defaults to <issuer>/.well-known/jwks.json. */
  jwksUri?: string;
  /** Pre-loaded keys (local stand-in and tests), so nothing is fetched. */
  jwks?: Jwks;
}

const SAFE_ID = /^[A-Za-z0-9-]{1,128}$/;

export function cognitoIssuer(region: string, userPoolId: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

export function jwtAuthenticator(options: JwtAuthOptions): Authenticator {
  const verifier = JwtVerifier.create({
    issuer: options.issuer,
    audience: null,
    jwksUri: options.jwksUri ?? `${options.issuer}/.well-known/jwks.json`,
    customJwtCheck: ({ payload }) => {
      if (payload.token_use !== 'access') throw new Error('Not an access token.');
      if (payload.client_id !== options.clientId) throw new Error('Wrong app client.');
    },
  });
  if (options.jwks) verifier.cacheJwks(options.jwks);

  return async (authorization) => {
    const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization ?? '');
    if (!match?.[1]) return null;
    try {
      const payload = await verifier.verify(match[1]);
      const sub = payload.sub;
      const username = typeof payload.username === 'string' ? payload.username : sub;
      if (typeof sub !== 'string' || !SAFE_ID.test(sub)) return null;
      if (typeof username !== 'string' || username.length > 128) return null;
      return { userId: sub, username };
    } catch {
      return null;
    }
  };
}
