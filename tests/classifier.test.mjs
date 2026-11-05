import test from 'node:test';
import assert from 'node:assert/strict';
import { createClassifierClient } from '../src/classifier.js';

const placeholder = 'placeholder-not-real';
const make = (fetch) => createClassifierClient({ fetch, baseUrl: 'https://app.test',
  getSecret: () => placeholder });
const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
const code = async (client, texts = ['Lidl']) => {
  try { await client.classify(texts); } catch (error) { return error.code; }
  return 'none';
};

test('it posts the texts with the bearer secret and returns only requested string categories', async () => {
  const seen = [];
  const client = make(async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({
      categories: { Lidl: 'Groceries', Other: 'Fees', Cafe: 5, extra: 'Fees' } }));
  });
  assert.deepEqual(await client.classify(['Lidl', 'Cafe', 'Missing']), { Lidl: 'Groceries' });
  assert.equal(seen[0].url, 'https://app.test/classify');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${placeholder}`);
  assert.deepEqual(JSON.parse(seen[0].init.body), { texts: ['Lidl', 'Cafe', 'Missing'] });
});

test('odd keys are plain entries and inherited ones are never read', async () => {
  const client = make(async () => new Response('{"categories":{"__proto__":"Fees","constructor":"Fees"}}'));
  const result = await client.classify(['__proto__', 'constructor', 'toString']);
  assert.deepEqual(Object.getOwnPropertyNames(result).sort(), ['__proto__', 'constructor']);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test('a bad call fails before any request is made', async () => {
  let calls = 0;
  const client = make(async () => { calls++; return new Response('{}'); });
  const many = Array.from({ length: 51 }, (_, i) => `n${i}`);
  for (const texts of [[], many, 'Lidl', null, undefined, {}]) {
    await assert.rejects(client.classify(texts), (error) => error.code === 'bad_request');
  }
  assert.equal(calls, 0);
});

test('failures map to the stated codes', async () => {
  assert.equal(await code(make(async () => { throw new TypeError('offline'); })), 'offline');
  assert.equal(await code(make(json({}, 401))), 'unauthorized');
  assert.equal(await code(make(json({ error: 'busy' }, 503))), 'busy');
  assert.equal(await code(make(json({ error: 'classifier_unavailable' }, 503))), 'unavailable');
  assert.equal(await code(make(json({ error: 'unavailable' }, 503))), 'unavailable');
  assert.equal(await code(make(async () => new Response('oops', { status: 503 }))), 'unavailable');
  for (const status of [400, 413]) assert.equal(await code(make(json({}, status))), 'bad_request');
  for (const status of [404, 429, 500, 502]) assert.equal(await code(make(json({}, status))), 'upstream');
  assert.equal(await code(make(async () => new Response(null, { status: 204 }))), 'upstream');
  assert.equal(await code(make(async () => new Response('not json'))), 'upstream');
  for (const body of [null, {}, { categories: null }, { categories: [] }, { categories: 'x' }, []]) {
    assert.equal(await code(make(json(body))), 'upstream', JSON.stringify(body));
  }
});

test('the client does not import the worker', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/classifier.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /worker\//);
});
