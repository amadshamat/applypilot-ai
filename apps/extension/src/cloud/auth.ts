import { z } from 'zod';
import { STORAGE_KEYS } from '@applypilot/shared';
import type { KeyValueStore } from '../storage/storage-area';
import type { CloudConnection } from './connection';

/**
 * Sign-in with Amazon Cognito's hosted pages, using the OAuth 2.0
 * authorization code flow with PKCE (RFC 7636), the flow recommended for
 * apps that cannot keep a secret, such as browser extensions:
 *
 * 1. a random verifier is made and only its SHA-256 hash goes to Cognito;
 * 2. Chrome opens the sign-in page (chrome.identity.launchWebAuthFlow) and
 *    returns to https://<extension-id>.chromiumapp.org/ with a one-time code;
 * 3. the code and the verifier are exchanged for tokens. A stolen code is
 *    useless without the verifier, which never left this extension.
 *
 * Tokens are kept in chrome.storage.session only: in memory, readable by the
 * extension's own pages and service worker (not content scripts), and gone
 * when the browser closes. Passwords never pass through the extension.
 */

export const cloudSessionSchema = z.object({
  /** Which connection these tokens belong to. */
  authUrl: z.string(),
  clientId: z.string(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Milliseconds since epoch. */
  expiresAt: z.number().int(),
  userId: z.string().min(1),
  email: z.string(),
});
export type CloudSession = z.infer<typeof cloudSessionSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});

const idClaimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.string(),
  email: z.string().default(''),
  exp: z.number(),
  token_use: z.literal('id'),
});

export class CloudAuthError extends Error {
  override name = 'CloudAuthError';
  constructor(
    readonly code: 'CANCELLED' | 'SIGNED_OUT' | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

export interface IdentityApi {
  getRedirectURL(): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

export interface CloudAuthDeps {
  session: KeyValueStore;
  identity: IdentityApi;
  fetch?: typeof fetch;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
}

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtPayload(token: string): unknown {
  const part = token.split('.')[1] ?? '';
  const padded = part.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as unknown;
  } catch {
    return null;
  }
}

/** Renew the access token this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;

export class CloudAuth {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: (bytes: number) => Uint8Array;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly deps: CloudAuthDeps) {
    this.fetchImpl = deps.fetch ?? ((...args) => fetch(...args));
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  }

  async session(): Promise<CloudSession | null> {
    const parsed = cloudSessionSchema.safeParse(
      await this.deps.session.get(STORAGE_KEYS.cloudSession),
    );
    return parsed.success ? parsed.data : null;
  }

  /** The signed-in session for this connection, or null. */
  async sessionFor(connection: CloudConnection): Promise<CloudSession | null> {
    const session = await this.session();
    return session?.authUrl === connection.authUrl && session.clientId === connection.clientId
      ? session
      : null;
  }

  subscribe(listener: (session: CloudSession | null) => void): () => void {
    return this.deps.session.subscribe(STORAGE_KEYS.cloudSession, (value) => {
      const parsed = cloudSessionSchema.safeParse(value);
      listener(parsed.success ? parsed.data : null);
    });
  }

  private async tokenRequest(connection: CloudConnection, form: Record<string, string>) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${connection.authUrl}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: connection.clientId, ...form }).toString(),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new CloudAuthError('FAILED', 'Could not reach the sign-in service.');
    }
    const body: unknown = await response.json().catch(() => null);
    const parsed = tokenResponseSchema.safeParse(body);
    if (!response.ok || !parsed.success) return null;
    return parsed.data;
  }

  private sessionFrom(
    connection: CloudConnection,
    tokens: z.infer<typeof tokenResponseSchema>,
    refreshToken: string,
  ): CloudSession {
    const claims = idClaimsSchema.safeParse(decodeJwtPayload(tokens.id_token));
    if (!claims.success || claims.data.aud !== connection.clientId) {
      throw new CloudAuthError('FAILED', 'The sign-in service sent an unexpected answer.');
    }
    return {
      authUrl: connection.authUrl,
      clientId: connection.clientId,
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: this.now() + tokens.expires_in * 1000,
      userId: claims.data.sub,
      email: claims.data.email,
    };
  }

  /** Opens the sign-in page (where the user can also create an account). */
  async signIn(connection: CloudConnection): Promise<CloudSession> {
    const verifier = base64url(this.random(32));
    const challenge = base64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    const state = base64url(this.random(16));
    const redirectUri = this.deps.identity.getRedirectURL();
    const url = new URL(`${connection.authUrl}/oauth2/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: connection.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    let result: string | undefined;
    try {
      result = await this.deps.identity.launchWebAuthFlow({
        url: url.toString(),
        interactive: true,
      });
    } catch {
      throw new CloudAuthError('CANCELLED', 'Sign-in was closed before it finished.');
    }
    const returned = new URL(result ?? redirectUri);
    const params = returned.searchParams;
    // Only accept an answer for the sign-in this extension started.
    if (`${returned.origin}/` !== redirectUri || params.get('state') !== state) {
      throw new CloudAuthError('FAILED', 'The sign-in answer did not match. Please try again.');
    }
    const code = params.get('code');
    if (!code) {
      throw new CloudAuthError(
        params.get('error') === 'access_denied' ? 'CANCELLED' : 'FAILED',
        'Sign-in did not finish. Please try again.',
      );
    }
    const tokens = await this.tokenRequest(connection, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    if (!tokens?.refresh_token) {
      throw new CloudAuthError(
        'FAILED',
        'The sign-in service refused the sign-in. Please try again.',
      );
    }
    const session = this.sessionFrom(connection, tokens, tokens.refresh_token);
    await this.deps.session.set(STORAGE_KEYS.cloudSession, session);
    return session;
  }

  /** A valid access token, renewed with the refresh token when it is about to expire. */
  async accessToken(connection: CloudConnection): Promise<string> {
    const session = await this.sessionFor(connection);
    if (!session) throw new CloudAuthError('SIGNED_OUT', 'Sign in to ApplyPilot Cloud.');
    if (session.expiresAt - REFRESH_MARGIN_MS > this.now()) return session.accessToken;
    this.refreshing ??= (async () => {
      try {
        const tokens = await this.tokenRequest(connection, {
          grant_type: 'refresh_token',
          refresh_token: session.refreshToken,
        });
        if (!tokens) {
          await this.deps.session.remove(STORAGE_KEYS.cloudSession);
          throw new CloudAuthError('SIGNED_OUT', 'Your sign-in expired. Sign in again.');
        }
        const next = this.sessionFrom(connection, tokens, session.refreshToken);
        await this.deps.session.set(STORAGE_KEYS.cloudSession, next);
        return next.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Revokes the refresh token, forgets the tokens and ends the hosted sign-in session. */
  async signOut(connection: CloudConnection | null): Promise<void> {
    const session = await this.session();
    await this.deps.session.remove(STORAGE_KEYS.cloudSession);
    if (!session || !connection) return;
    try {
      await this.fetchImpl(`${connection.authUrl}/oauth2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: session.refreshToken,
          client_id: connection.clientId,
        }).toString(),
        credentials: 'omit',
      });
    } catch {
      // Best effort: the tokens are already forgotten here.
    }
    try {
      const logout = new URL(`${connection.authUrl}/logout`);
      logout.search = new URLSearchParams({
        client_id: connection.clientId,
        logout_uri: this.deps.identity.getRedirectURL(),
      }).toString();
      await this.deps.identity.launchWebAuthFlow({ url: logout.toString(), interactive: false });
    } catch {
      // Best effort: the hosted page's own cookie expires on its own.
    }
  }

  /** Forgets the tokens without contacting the server (account deleted). */
  async forget(): Promise<void> {
    await this.deps.session.remove(STORAGE_KEYS.cloudSession);
  }
}
