// Bundles each Lambda function into dist/lambda/<name>/index.mjs for the CDK
// stack. One self-contained file per function, with the AWS SDK version this
// repository pins (rather than whichever the Lambda runtime happens to ship).
import { build } from 'esbuild';
import { rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/lambda`;
rmSync(out, { recursive: true, force: true });

for (const name of ['data', 'account', 'ai']) {
  await build({
    entryPoints: [`${root}src/lambda/${name}.ts`],
    outfile: `${out}/${name}/index.mjs`,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    // Some dependencies are CommonJS and call require(); give them one.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
  const kb = Math.round(statSync(`${out}/${name}/index.mjs`).size / 1024);
  console.log(`dist/lambda/${name}/index.mjs  ${kb} KB`);
}
