import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { capturePreview, savePreview } from '../src/import-flow.js';
import { createPreviewRunner } from '../app/accounts.js';

const get = (name) => readFile(new URL(`../app/${name}`, import.meta.url), 'utf8');
test('manifest is installable with the required identity and scope', async () => {
  const m = JSON.parse(await get('manifest.webmanifest'));
  assert.equal(m.name, 'fsa'); assert.equal(m.short_name, 'fsa'); assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './'); assert.equal(m.scope, './');
  assert.ok(m.theme_color); assert.ok(m.background_color);
  assert.ok(m.icons.some((i) => i.sizes === 'any' && i.src.endsWith('.svg')));
});
test('shell CSP and form inputs are safe and local', async () => {
  const html = await get('index.html');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.ok(html.includes("default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    + "worker-src 'self'; img-src 'self' data:; object-src 'none'"));
  assert.doesNotMatch(html, /unsafe-inline|<script\b[^>]*>[^<]/i);
  assert.match(html, /type="file"/);
  assert.match(html, /type="password"[^>]*autocomplete="current-password"/);
  assert.match(html, /<input id="secret" type="password" autocomplete="off">/);
  assert.equal([...html.matchAll(/id="secret"/g)].length, 1);
  for (const region of ['month-picker', 'summary', 'categories', 'notice', 'suggested', 'rows']) {
    assert.equal([...html.matchAll(new RegExp(`data-region="${region}"`, 'g'))].length, 1);
  }
  assert.match(html, /Treat rows containing these words as transfers to this account/);
  for (const file of ['index.html', 'app.js', 'settings.js', 'rates-flow.js', 'style.css',
    'manifest.webmanifest', 'sw.js', 'icon.svg', 'accounts.js', 'sources.js', 'flow.js',
    'month-data.js', 'month-screen.js']) {
    const text = await get(file);
    assert.doesNotMatch(text, /https?:\/\//i, `${file} has an external URL`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=/i, `${file} has an inline handler`);
  }
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
});

test('converted heading follows the selected currency', async () => {
  const app = await get('app.js'), html = await get('index.html');
  const update = app.match(/async function updateConverted\(rows\) \{([\s\S]*?)\n\}/);
  assert.ok(update);
  const source = app.replace(/^import .*;\n/gm, '');
  const calls = [...source.matchAll(/convertedHeading\(/g)];
  assert.equal(calls.length, 2);
  assert.ok(calls[0].index < source.indexOf('function invalidatePreview'));
  assert.ok(update[1].indexOf('await ratesFlow.ensure') < update[1].indexOf('convertedHeading('));
  assert.ok(update[1].indexOf('isCurrent(token)') < update[1].indexOf('convertedHeading('));
  assert.match(source.slice(calls[0].index - 120, calls[0].index),
    /\$\('#currency'\)\.value = currencySetting\.get\(\);[\s\S]*$/);
  const handlerPattern = /\$\('#currency'\)\.addEventListener\('change', \(event\) => \{/;
  const handler = app.match(new RegExp(`${handlerPattern.source}([\\s\\S]*?)\\n\\}\\);`));
  assert.ok(handler);
  assert.doesNotMatch(handler[1], /convertedHeading\(/);
  assert.equal([...html.matchAll(/id="converted-heading"/g)].length, 1);
});

test('Prepare preserves current state for superseded requests and reports rejection', async () => {
  const app = await get('app.js');
  const handler = app.match(/\$\('#prepare'\)\.addEventListener\('click',[\s\S]*?\n\}\);/);
  assert.ok(handler);
  assert.equal([...handler[0].matchAll(/const result = await previewRunner\.preview\(\)/g)].length, 1);
  assert.doesNotMatch(handler[0], /prepared = await previewRunner\.preview\(\)/);
  const resultLine = handler[0].indexOf('const result = await previewRunner.preview()');
  const preparedLine = handler[0].indexOf('prepared = result');
  assert.ok(resultLine >= 0 && preparedLine > resultLine);
  assert.match(handler[0].slice(resultLine, preparedLine), /if\s*\(!result\)[\s\S]*?return/);
  assert.match(handler[0], /result\.reason \|\| result\.code \|\| 'This file could not be read\.'/);
});

test('secret storage access and console calls stay confined', async () => {
  for (const file of await readdir(new URL('../app/', import.meta.url))) {
    if (!file.endsWith('.js') || file === 'app.js') continue;
    const content = await get(file);
    assert.doesNotMatch(content, /console\s*\./, `${file} contains console output`);
    assert.doesNotMatch(content, /localStorage\.getItem\(['"]fsa\.access/,
      `${file} reads the secret directly`);
  }
});

test('month actions use the helper and Undo catches failures', async () => {
  const app = await get('app.js');
  assert.doesNotMatch(app, /async onMark\(/);
  const undo = app.match(/button\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(undo);
  assert.match(undo[1], /try/);
  assert.match(undo[1], /catch/);
});

test('saving a preview uses the account, name and hash captured with it', async () => {
  const calls = [];
  const preview = capturePreview({ status: 'ready', parsed: { rows: ['A rows'] },
    fileHash: 'A hash' }, { accountId: 'a1', name: 'A.pdf' });
  await savePreview(preview, { addBatch: async (...args) => {
    calls.push(args); return { batchId: 'b1', added: 1, skipped: 0 };
  } });
  assert.deepEqual(calls, [['a1', { rows: ['A rows'] }, { fileHash: 'A hash', name: 'A.pdf' }]]);
});

test('stale preparation is discarded after selection changes and newer Preview', async () => {
  let current = { accountId: 'a1', file: { name: 'A.pdf', size: 1 } };
  const pending = [];
  const saved = [];
  const reader = { extractPdf: (bytes) => new Promise((resolve) => pending.push(
    () => resolve({ pages: [bytes[0]] }))) };
  const store = { addBatch: async (accountId, parsed, meta) => {
    saved.push([accountId, meta.name, parsed.rows[0]]); return {};
  } };
  const runner = createPreviewRunner({
    selection: () => ({ ...current, file: { ...current.file,
      arrayBuffer: async () => new Uint8Array([1]).buffer } }),
    prepare: async ({ bytes, accountId, name }) => {
      await reader.extractPdf(bytes);
      return { status: 'ready', parsed: { rows: [accountId] }, fileHash: name };
    },
    save: async (preview) => {
      const { commitImport } = await import('../src/import-flow.js');
      return commitImport({ ...preview, store });
    },
  });
  const old = runner.preview();
  await Promise.resolve();
  current = { accountId: 'a2', file: { name: 'B.pdf', size: 1 } };
  runner.invalidate();
  pending[0](); await old;
  assert.equal(runner.current, undefined);
  await runner.save();
  assert.deepEqual(saved, []);
});

test('a newer Preview supersedes an older pending preparation', async () => {
  const pending = [], saved = [];
  const reader = { extractPdf: (bytes) => new Promise((resolve) => pending.push(
    () => resolve({ pages: [bytes[0]] }))) };
  const runner = createPreviewRunner({
    selection: () => ({ accountId: 'a1', file: { name: 'A.pdf', size: 1,
      arrayBuffer: async () => new Uint8Array([1]).buffer } }),
    prepare: async ({ bytes, name }) => {
      await reader.extractPdf(bytes);
      return { status: 'ready', parsed: { rows: [name] }, fileHash: name };
    },
    save: async (preview) => saved.push(preview.name),
  });
  const first = runner.preview(), second = runner.preview();
  await Promise.resolve();
  pending[1](); await second;
  pending[0](); await first;
  await runner.save();
  assert.deepEqual(saved, ['A.pdf']);
});

test('offline shell includes every relative module imported by app startup', async () => {
  const app = await get('app.js'), sw = await get('sw.js');
  const cached = new Set([...sw.matchAll(/['"](\.\/[^'"]+)['"]/g)].map((match) => match[1]));
  const pending = ['app.js'], visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const content = file === 'app.js' ? app : file.startsWith('src/')
      ? await readFile(new URL(`../${file}`, import.meta.url), 'utf8') : await get(file);
    for (const [, specifier] of content.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
      assert.ok(!resolved.startsWith('..'), `${file} import escapes built site: ${specifier}`);
      const shellPath = `./${resolved}`;
      assert.ok(cached.has(shellPath), `service worker shell is missing ${shellPath}`);
      if (resolved.startsWith('vendor/')) continue;
      pending.push(resolved);
    }
  }
});

test('app modules do not import outside their built site root', async () => {
  for (const file of await readdir(new URL('../app/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const content = await get(file);
    for (const [, specifier] of content.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      assert.ok(!specifier.startsWith('../'), `${file} imports outside the built site: ${specifier}`);
      if (file !== 'app.js') assert.ok(!specifier.startsWith('./src/'),
        `${file} imports source code instead of receiving it by injection`);
    }
  }
  const app = await get('app.js');
  for (const file of ['months.js', 'categories.js', 'contracts.js']) {
    assert.match(app, new RegExp(`from ['"]\\./src/${file}['"]`));
  }
});
