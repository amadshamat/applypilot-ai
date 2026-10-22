import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTokenSigner, type TokenSigner } from './tokens';

/**
 * A local stand-in for the Amazon Cognito hosted sign-in pages and OAuth
 * endpoints, for testing the extension without an AWS account. It speaks the
 * same protocol the extension uses with Cognito (authorization code + PKCE):
 *
 *   GET  /oauth2/authorize   sign-in / sign-up page (or straight back if signed in)
 *   POST /login              the page's form
 *   POST /oauth2/token       code → tokens, refresh token → new tokens
 *   POST /oauth2/revoke      revokes a refresh token
 *   GET  /logout             ends the sign-in session
 *   GET  /.well-known/jwks.json
 *
 * Test only: no email verification, no MFA, users kept in a local file.
 * Passwords are stored as scrypt hashes, never in plain text.
 */

export const LOCAL_CLIENT_ID = 'applypilot-local-client';
const REDIRECT = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/;
const ACCESS_SECONDS = 3600;
const CODE_SECONDS = 300;
const MIN_PASSWORD = 12;

interface DevUser {
  sub: string;
  email: string;
  salt: string;
  hash: string;
}

interface PendingCode {
  sub: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

export interface DevAuthOptions {
  /** Where the server is reachable, e.g. http://127.0.0.1:8788 */
  baseUrl: string;
  clientId?: string;
  usersFile?: string;
  now?: () => Date;
  /** Extra allowed redirect addresses (tests). */
  redirectUris?: string[];
}

export interface DevAuth {
  signer: TokenSigner;
  issuer: string;
  clientId: string;
  /** Handles the request if it is an auth path; returns false otherwise. */
  handle(req: IncomingMessage, res: ServerResponse, body: string): boolean;
  deleteUser(username: string): Promise<void>;
  userCount(): number;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString('base64');
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== ''),
  );
}

export function createDevAuth(options: DevAuthOptions): DevAuth {
  const clientId = options.clientId ?? LOCAL_CLIENT_ID;
  const issuer = `${options.baseUrl}/local-cognito`;
  const now = options.now ?? (() => new Date());
  const signer = createTokenSigner(issuer, clientId);
  const users = new Map<string, DevUser>();
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Map<string, string>();
  const sessions = new Map<string, string>();

  if (options.usersFile && existsSync(options.usersFile)) {
    for (const user of JSON.parse(readFileSync(options.usersFile, 'utf8')) as DevUser[]) {
      users.set(user.email, user);
    }
  }
  function saveUsers() {
    if (!options.usersFile) return;
    const tmp = `${options.usersFile}.tmp`;
    writeFileSync(tmp, JSON.stringify([...users.values()]), { mode: 0o600 });
    renameSync(tmp, options.usersFile);
  }

  const redirectAllowed = (uri: string) =>
    REDIRECT.test(uri) || (options.redirectUris ?? []).includes(uri);

  function send(
    res: ServerResponse,
    status: number,
    body: string,
    type = 'application/json; charset=utf-8',
    headers: Record<string, string> = {},
  ) {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(body);
  }

  const json = (res: ServerResponse, status: number, value: unknown) =>
    send(res, status, JSON.stringify(value));

  function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}) {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
    res.end();
  }

  function issueCode(sub: string, params: URLSearchParams): string {
    const code = randomBytes(24).toString('base64url');
    codes.set(code, {
      sub,
      clientId,
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      expiresAt: now().getTime() + CODE_SECONDS * 1000,
    });
    const target = new URL(params.get('redirect_uri') ?? '');
    target.searchParams.set('code', code);
    const state = params.get('state');
    if (state) target.searchParams.set('state', state);
    return target.toString();
  }

  /** Problems with the request itself are shown on the page, never sent to a redirect address. */
  function checkAuthorize(params: URLSearchParams): string | null {
    if (params.get('client_id') !== clientId) return 'Unknown app client.';
    if (params.get('response_type') !== 'code') return 'Only the code flow is supported.';
    if (!redirectAllowed(params.get('redirect_uri') ?? ''))
      return 'That redirect address is not allowed.';
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) {
      return 'PKCE (S256) is required.';
    }
    return null;
  }

  function page(res: ServerResponse, params: URLSearchParams, message = '', status = 200) {
    const hidden = [...params.entries()]
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join('');
    send(
      res,
      status,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ApplyPilot local sign-in</title>
<style>body{font:15px system-ui,sans-serif;max-width:360px;margin:40px auto;padding:0 16px;color:#1f2937}
label{display:block;margin:12px 0 4px}input[type=email],input[type=password]{width:100%;padding:8px;box-sizing:border-box}
button{margin-top:16px;padding:8px 14px}.note{background:#fef3c7;padding:8px;border-radius:6px;font-size:13px}.err{color:#b91c1c}</style></head>
<body><h1>ApplyPilot Cloud (local test)</h1>
<p class="note">This page stands in for Amazon Cognito on your own computer. Accounts made here exist only in this local test server.</p>
${message ? `<p class="err" role="alert">${escapeHtml(message)}</p>` : ''}
<form method="post" action="/login">${hidden}
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">Password (12 characters or more)</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button name="mode" value="signin" type="submit">Sign in</button>
<button name="mode" value="signup" type="submit">Create account</button>
</form></body></html>`,
      'text/html; charset=utf-8',
      {
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://*.chromiumapp.org; frame-ancestors 'none'",
      },
    );
  }

  function tokens(sub: string, withRefresh: boolean) {
    const user = [...users.values()].find((u) => u.sub === sub);
    if (!user) return null;
    const result: Record<string, unknown> = {
      access_token: signer.accessToken({ sub }, { now: now(), expiresIn: ACCESS_SECONDS }),
      id_token: signer.idToken(
        { sub, email: user.email },
        { now: now(), expiresIn: ACCESS_SECONDS },
      ),
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
    };
    if (withRefresh) {
      const refresh = randomBytes(32).toString('base64url');
      refreshTokens.set(refresh, sub);
      result.refresh_token = refresh;
    }
    return result;
  }

  function handle(req: IncomingMessage, res: ServerResponse, body: string): boolean {
    const url = new URL(req.url ?? '/', options.baseUrl);
    const route = `${req.method ?? 'GET'} ${url.pathname}`;
    const form = new URLSearchParams(body);

    switch (route) {
      case 'GET /.well-known/jwks.json':
      case 'GET /local-cognito/.well-known/jwks.json':
        json(res, 200, signer.jwks);
        return true;

      case 'GET /oauth2/authorize': {
        const problem = checkAuthorize(url.searchParams);
        if (problem) {
          send(res, 400, escapeHtml(problem), 'text/plain; charset=utf-8');
          return true;
        }
        const session = sessions.get(cookies(req).applypilot_session ?? '');
        if (session) redirect(res, issueCode(session, url.searchParams));
        else page(res, url.searchParams);
        return true;
      }

      case 'POST /login': {
        const params = new URLSearchParams(
          [...form.entries()].filter(([k]) => !['email', 'password', 'mode'].includes(k)),
        );
        const problem = checkAuthorize(params);
        if (problem) {
          send(res, 400, escapeHtml(problem), 'text/plain; charset=utf-8');
          return true;
        }
        const email = (form.get('email') ?? '').trim().toLowerCase();
        const password = form.get('password') ?? '';
        if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
          page(res, params, 'Enter a valid email address.', 400);
          return true;
        }
        let user = users.get(email);
        if (form.get('mode') === 'signup') {
          if (user) {
            page(res, params, 'An account with that email exists. Sign in instead.', 400);
            return true;
          }
          if (password.length < MIN_PASSWORD) {
            page(res, params, `Use a password of at least ${MIN_PASSWORD} characters.`, 400);
            return true;
          }
          const salt = randomBytes(16).toString('base64');
          user = { sub: randomUUID(), email, salt, hash: hashPassword(password, salt) };
          users.set(email, user);
          saveUsers();
        } else {
          const given = user ? Buffer.from(hashPassword(password, user.salt)) : null;
          if (!user || !given || !timingSafeEqual(given, Buffer.from(user.hash))) {
            // Same message either way, so the page does not reveal which emails have accounts.
            page(res, params, 'Wrong email or password.', 400);
            return true;
          }
        }
        const session = randomBytes(24).toString('base64url');
        sessions.set(session, user.sub);
        redirect(res, issueCode(user.sub, params), {
          'Set-Cookie': `applypilot_session=${session}; HttpOnly; SameSite=Lax; Path=/`,
        });
        return true;
      }

      case 'POST /oauth2/token': {
        if (form.get('client_id') !== clientId) {
          json(res, 400, { error: 'invalid_client' });
          return true;
        }
        if (form.get('grant_type') === 'authorization_code') {
          const code = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (
            !code ||
            code.expiresAt < now().getTime() ||
            code.redirectUri !== form.get('redirect_uri') ||
            verifier.length < 43 ||
            challenge !== code.challenge
          ) {
            json(res, 400, { error: 'invalid_grant' });
            return true;
          }
          json(res, 200, tokens(code.sub, true));
          return true;
        }
        if (form.get('grant_type') === 'refresh_token') {
          const sub = refreshTokens.get(form.get('refresh_token') ?? '');
          const issued = sub ? tokens(sub, false) : null;
          if (!issued) json(res, 400, { error: 'invalid_grant' });
          else json(res, 200, issued);
          return true;
        }
        json(res, 400, { error: 'unsupported_grant_type' });
        return true;
      }

      case 'POST /oauth2/revoke':
        refreshTokens.delete(form.get('token') ?? '');
        send(res, 200, '');
        return true;

      case 'GET /logout': {
        const logoutUri = url.searchParams.get('logout_uri') ?? '';
        sessions.delete(cookies(req).applypilot_session ?? '');
        const clear = { 'Set-Cookie': 'applypilot_session=; Max-Age=0; Path=/' };
        if (url.searchParams.get('client_id') === clientId && redirectAllowed(logoutUri)) {
          redirect(res, logoutUri, clear);
        } else {
          send(res, 200, 'Signed out.', 'text/plain; charset=utf-8', clear);
        }
        return true;
      }

      default:
        return false;
    }
  }

  return {
    signer,
    issuer,
    clientId,
    handle,
    deleteUser(username) {
      for (const [email, user] of users) {
        if (user.sub === username) users.delete(email);
      }
      for (const [token, sub] of refreshTokens) if (sub === username) refreshTokens.delete(token);
      for (const [session, sub] of sessions) if (sub === username) sessions.delete(session);
      saveUsers();
      return Promise.resolve();
    },
    userCount: () => users.size,
  };
}
