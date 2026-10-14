import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* eslint-disable no-console -- command-line setup output. */

/**
 * Creates services/api/.env with a fresh random access token, in mock mode.
 * Never overwrites an existing file. The file is git-ignored and readable
 * only by the current user.
 */

const envFile = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(envFile)) {
  console.log(`${envFile} already exists. Nothing was changed.`);
  console.log('Your access token is the APPLYPILOT_LOCAL_TOKEN value in that file.');
  process.exit(0);
}

const token = randomBytes(32).toString('base64url');
writeFileSync(
  envFile,
  `# ApplyPilot local API settings. Keep this file private; it is git-ignored.

# Paste this token into ApplyPilot > Settings > AI connection.
APPLYPILOT_LOCAL_TOKEN=${token}

# "mock" generates free offline drafts from your own profile text.
# "anthropic" calls Claude and is billed to your Anthropic account.
APPLYPILOT_PROVIDER=mock

# Needed only for APPLYPILOT_PROVIDER=anthropic. Never put this key in the extension.
# ANTHROPIC_API_KEY=

# Optional:
# APPLYPILOT_PORT=8787
# APPLYPILOT_MODEL=claude-opus-5-5
# APPLYPILOT_EFFORT=medium
# APPLYPILOT_DAILY_LIMIT=25
# APPLYPILOT_ALLOWED_ORIGINS=chrome-extension://<your extension id>
`,
  { mode: 0o600 },
);

console.log(`Created ${envFile} in mock mode.`);
console.log(`Access token (paste into ApplyPilot > Settings > AI connection):\n\n  ${token}\n`);
console.log('Start the API with: pnpm api');
