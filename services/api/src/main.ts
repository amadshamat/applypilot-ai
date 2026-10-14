import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApi } from './app';
import { ConfigError, loadConfig, type ApiConfig } from './config';
import { createHttpServer } from './http';
import { createAnthropicClient, createAnthropicProvider } from './providers/anthropic';
import { createMockProvider } from './providers/mock';
import type { AiProvider } from './providers/types';

/* eslint-disable no-console -- this is the server's own console output. */

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function createProvider(config: ApiConfig): AiProvider {
  if (config.provider === 'anthropic' && config.anthropicApiKey) {
    return createAnthropicProvider({
      client: createAnthropicClient(config.anthropicApiKey),
      model: config.model,
      effort: config.effort,
    });
  }
  return createMockProvider();
}

let config: ApiConfig;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`ApplyPilot API is not configured: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const provider = createProvider(config);
const handle = createApi({
  config,
  provider,
  log: (entry) => {
    const cost =
      entry.estimatedCostUsd === undefined || entry.estimatedCostUsd === null
        ? ''
        : ` ~$${entry.estimatedCostUsd.toFixed(4)}`;
    const tokens =
      entry.inputTokens === undefined
        ? ''
        : ` ${entry.inputTokens} in / ${entry.outputTokens ?? 0} out`;
    console.log(
      `${new Date().toISOString()} ${entry.route} ${entry.status} ${entry.durationMs}ms${entry.model ? ` ${entry.model}` : ''}${tokens}${cost}`,
    );
  },
});

createHttpServer(handle, config).listen(config.port, config.host, () => {
  console.log(`ApplyPilot API ${config.version} listening on http://${config.host}:${config.port}`);
  console.log(
    config.provider === 'anthropic'
      ? `Provider: Claude (${config.model}, effort ${config.effort}). Requests are billed to your Anthropic account. Daily limit: ${config.dailyLimit}.`
      : 'Provider: mock. Drafts are generated offline from your own profile text. Nothing is sent anywhere and nothing is billed.',
  );
  console.log('Press Ctrl+C to stop.');
});
