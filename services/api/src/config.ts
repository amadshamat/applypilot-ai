import { DEFAULT_MODEL } from '@applypilot/ai-core';
import pkg from '../package.json' with { type: 'json' };

/**
 * Runtime configuration from environment variables. The Claude API key lives
 * only here, on the user's machine (and later in AWS Secrets Manager); it is
 * never sent to the extension or written to logs.
 */

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ApiConfig {
  version: string;
  host: '127.0.0.1';
  port: number;
  /** Shared secret the extension sends as a bearer token. */
  token: string;
  provider: 'mock' | 'anthropic';
  anthropicApiKey: string | null;
  model: string;
  effort: Effort;
  /** Generation requests allowed per day (resets at local midnight). */
  dailyLimit: number;
  /** Extension origins allowed to call the API. Empty means any chrome-extension:// origin. */
  allowedOrigins: string[];
  maxBodyBytes: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const MIN_TOKEN_LENGTH = 24;

function integer(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const token = env.APPLYPILOT_LOCAL_TOKEN?.trim() ?? '';
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(
      `APPLYPILOT_LOCAL_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters. Run "pnpm api:setup" to create one.`,
    );
  }

  const providerRaw = (env.APPLYPILOT_PROVIDER ?? 'mock').trim().toLowerCase();
  if (providerRaw !== 'mock' && providerRaw !== 'anthropic') {
    throw new ConfigError('APPLYPILOT_PROVIDER must be "mock" or "anthropic".');
  }
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  // Paid calls need two deliberate settings: the provider and a key.
  if (providerRaw === 'anthropic' && anthropicApiKey === null) {
    throw new ConfigError('APPLYPILOT_PROVIDER is "anthropic" but ANTHROPIC_API_KEY is not set.');
  }

  const effortRaw = (env.APPLYPILOT_EFFORT ?? 'medium').trim().toLowerCase();
  if (!(EFFORTS as readonly string[]).includes(effortRaw)) {
    throw new ConfigError(`APPLYPILOT_EFFORT must be one of ${EFFORTS.join(', ')}.`);
  }

  const allowedOrigins = (env.APPLYPILOT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      throw new ConfigError(
        `APPLYPILOT_ALLOWED_ORIGINS has "${origin}". Use chrome-extension://<extension id>.`,
      );
    }
  }

  return {
    version: pkg.version,
    host: '127.0.0.1',
    port: integer(env.APPLYPILOT_PORT, 8787, 'APPLYPILOT_PORT', 1024, 65535),
    token,
    provider: providerRaw,
    anthropicApiKey,
    model: env.APPLYPILOT_MODEL?.trim() || DEFAULT_MODEL,
    effort: effortRaw as Effort,
    dailyLimit: integer(env.APPLYPILOT_DAILY_LIMIT, 25, 'APPLYPILOT_DAILY_LIMIT', 1, 1000),
    allowedOrigins,
    maxBodyBytes: 300_000,
  };
}
