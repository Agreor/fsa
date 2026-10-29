import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const filesUnder = async (directory) => {
  const entries = await readdir(new URL(`${directory}/`, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    files.push(...(entry.isDirectory() ? await filesUnder(path) : [path]));
  }
  return files;
};

test('Worker-first routes do not capture static app files', async () => {
  const text = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  const routes = config.assets.run_worker_first;
  assert.deepEqual(routes, ['/rates']);
  assert.ok(routes.every((route) => !route.includes('*')));
  const appFiles = await filesUnder('app');
  const srcFiles = await filesUnder('src');
  const staticPaths = [...appFiles.map((file) => `/${file.slice('app/'.length)}`),
    ...srcFiles.map((file) => `/src/${file.slice('src/'.length)}`)];
  assert.ok(routes.every((route) => !staticPaths.includes(route)));
  assert.doesNotMatch(text.replace(/^\s*\/\/.*$/gm, ''), /\/rates\*/);
});
