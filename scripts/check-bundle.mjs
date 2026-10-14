// Fails if the built extension contains anything that looks like a Claude API key or
// server-side secret handling. The key belongs only to services/api.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'apps/extension/dist';
const patterns = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, 'an Anthropic API key'],
  [/ANTHROPIC_API_KEY/, 'the ANTHROPIC_API_KEY variable'],
  [/x-api-key/i, 'an x-api-key header'],
  [/api\.anthropic\.com/, 'a direct call to the Anthropic API'],
  [/@anthropic-ai\/sdk/, 'the Anthropic SDK'],
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const problems = [];
for (const file of files(root)) {
  if (!/\.(js|mjs|html|json|css)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) problems.push(`${file}: contains ${label}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Bundle check passed: no API keys or direct Claude calls in ${root}.`);
