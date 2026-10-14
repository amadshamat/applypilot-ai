// Serves tests/fixtures over http://127.0.0.1 for end-to-end tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../fixtures');
const port = Number(process.env.FIXTURE_PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = resolve(root, `.${path}`);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res
      .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.warn(`Fixture server on http://127.0.0.1:${port}`));
