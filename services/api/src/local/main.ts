import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startLocalCloud } from './cloud-server';

/* eslint-disable no-console -- this is the server's own console output. */

/**
 * pnpm cloud:local: ApplyPilot Cloud on this computer, for testing sign-in
 * and sync without AWS. Data and test accounts are kept in
 * services/api/.local-cloud/ (git-ignored) so they survive restarts.
 */

const port = Number(process.env.APPLYPILOT_CLOUD_PORT ?? 8788);
// APPLYPILOT_CLOUD_MEMORY=1 (the e2e tests) keeps nothing on disk.
const inMemory = process.env.APPLYPILOT_CLOUD_MEMORY === '1';
const dataDir = inMemory
  ? undefined
  : fileURLToPath(new URL('../../.local-cloud/', import.meta.url));
if (dataDir) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const cloud = await startLocalCloud({
  port,
  ...(dataDir ? { dataDir } : {}),
  log: (entry) =>
    console.log(
      `${new Date().toISOString()} ${entry.route} ${entry.status} ${entry.durationMs}ms${entry.code ? ` ${entry.code}` : ''}`,
    ),
});

console.log(`ApplyPilot Cloud (local test) running at ${cloud.url}`);
console.log('');
console.log('In the extension: Settings > Cloud sync (optional), click "Use local test server",');
console.log('or enter these values:');
console.log(`  Cloud API URL (ApiUrl):          ${cloud.url}`);
console.log(`  Cloud sign-in URL (AuthUrl):     ${cloud.url}`);
console.log(`  Cloud app client ID (ClientId):  ${cloud.auth.clientId}`);
console.log('');
console.log(
  'DynamoDB and Cognito are local stand-ins. Nothing is sent to AWS and nothing is billed.',
);
console.log(
  dataDir ? `Data and test accounts are kept in ${dataDir}` : 'Data is kept in memory only.',
);
console.log('Press Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void cloud.close().then(() => process.exit(0));
  });
}
