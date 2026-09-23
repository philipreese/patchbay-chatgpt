import { preview } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// An actual HTTP check of dist at the Pages subpath; this is not a browser test.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await preview({ root, configFile: false, base: '/patchbay-chatgpt/', preview: { host: '127.0.0.1', port: 4178, strictPort: true } });
const origin = 'http://127.0.0.1:4178';
const prefix = '/patchbay-chatgpt/';
const visited = new Set();
async function check(path) {
  assert(path.startsWith(prefix), `Asset escaped repository subpath: ${path}`);
  if (visited.has(path)) return;
  visited.add(path);
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, `HTTP ${response.status} for ${path}`);
  const body = new Uint8Array(await response.arrayBuffer());
  assert(body.length > 0, `Empty response: ${path}`);
  const expected = await readFile(new URL(`../dist/${path.slice(prefix.length) || 'index.html'}`, import.meta.url));
  assert.deepEqual(body, new Uint8Array(expected), `HTTP content differs from built asset: ${path}`);
  const text = new TextDecoder().decode(body);
  if (path === prefix) {
    for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) await check(match[1]);
  }
  if (path.endsWith('.css')) {
    for (const match of text.matchAll(/url\(([^)]+)\)/g)) {
      const source = match[1].replace(/^["']|["']$/g, '');
      assert(!/^https?:/.test(source), `External runtime asset: ${source}`);
      if (!source.startsWith('data:')) await check(new URL(source, origin + path).pathname);
    }
  }
}
try {
  await check(prefix);
  const assets = await readdir(new URL('../dist/assets/', import.meta.url));
  for (const name of assets) await check(`${prefix}assets/${name}`);
  const verification = await fetch(`${origin}${prefix}?verify=1`);
  assert.equal(verification.status, 200);
  console.log(JSON.stringify({check:'production HTTP at actual repository subpath',passed:true,path:prefix,assets:[...visited],verificationRoute:verification.status,browserTest:false},null,2));
} finally {
  await new Promise(resolve=>server.httpServer.close(resolve));
}
