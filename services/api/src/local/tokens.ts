import { createSign, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import type { Jwks } from 'aws-jwt-verify/jwk';

/**
 * Signs tokens shaped like Amazon Cognito's (RS256, same claims), for the
 * local stand-in and for tests. Never used in AWS: there, Cognito issues the
 * tokens and the API only verifies them.
 */

export interface TokenSigner {
  issuer: string;
  clientId: string;
  jwks: Jwks;
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): string;
  accessToken(user: { sub: string; username?: string }, options?: TokenOptions): string;
  idToken(user: { sub: string; email: string }, options?: TokenOptions): string;
}

export interface TokenOptions {
  /** Seconds; negative makes an expired token (tests). */
  expiresIn?: number;
  now?: Date;
  overrides?: Record<string, unknown>;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createTokenSigner(issuer: string, clientId: string, key?: KeyObject): TokenSigner {
  const privateKey = key ?? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const kid = randomUUID();
  // The private JWK carries the public modulus and exponent; only those are published.
  const { n, e } = privateKey.export({ format: 'jwk' }) as { n: string; e: string };
  const jwks: Jwks = { keys: [{ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n, e }] };

  function sign(payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
    const head = b64({ alg: 'RS256', kid, typ: 'JWT', ...header });
    const body = b64(payload);
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
  }

  function times(options: TokenOptions) {
    const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
    return { iat, auth_time: iat, exp: iat + (options.expiresIn ?? 3600) };
  }

  return {
    issuer,
    clientId,
    jwks,
    sign,
    accessToken(user, options = {}) {
      return sign({
        sub: user.sub,
        iss: issuer,
        client_id: clientId,
        token_use: 'access',
        scope: 'openid email',
        username: user.username ?? user.sub,
        jti: randomUUID(),
        ...times(options),
        ...options.overrides,
      });
    },
    idToken(user, options = {}) {
      return sign({
        sub: user.sub,
        iss: issuer,
        aud: clientId,
        token_use: 'id',
        email: user.email,
        email_verified: true,
        'cognito:username': user.sub,
        jti: randomUUID(),
        ...times(options),
        ...options.overrides,
      });
    },
  };
}
