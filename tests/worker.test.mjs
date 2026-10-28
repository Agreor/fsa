import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const placeholder = 'placeholder-not-real';
const secret = placeholder;
const env = { ACCESS_SECRET: secret, ALLOWED_ORIGIN: 'https://app.test' };
const feed = '<Cube><Cube time="2026-09-04"><Cube currency="THB" rate="37.5000"/>' +
  '</Cube></Cube>';
const request = (path = '/rates?from=2026-09-04&to=2026-09-04', headers = {}) =>
  new Request(`https://fn.test${path}`, {
    headers: { Authorization: `Bearer ${secret}`, ...headers },
  });

test('rejects requests without configured secret', async () => {
  const result = await worker.fetch(request(), {});
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'unavailable' });
});

test('serves filtered exact decimal rates with matching origin only', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(feed);
  try {
    const result = await worker.fetch(request(undefined, { Origin: env.ALLOWED_ORIGIN }), env);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await result.json(), {
      base: 'EUR', source: 'ecb', rates: { '2026-09-04': { THB: '37.5000' } },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns fixed errors for bad input, authorization, route and upstream failure', async () => {
  const invalid = await worker.fetch(request('/rates?from=bad&to=2026-09-04'), env);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'bad_request' });
  const unauthorized = await worker.fetch(new Request(
    'https://fn.test/rates?from=2026-09-04&to=2026-09-04',
  ), env);
  assert.equal(unauthorized.status, 401);
  const missing = await worker.fetch(request('/other'), env);
  assert.equal(missing.status, 404);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    const upstream = await worker.fetch(request(), env);
    assert.equal(upstream.status, 502);
    assert.deepEqual(await upstream.json(), { error: 'upstream' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OPTIONS allows authorization and serving requests never logs', async () => {
  const result = await worker.fetch(new Request('https://fn.test/rates', { method: 'OPTIONS' }), env);
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('Access-Control-Allow-Headers'), 'authorization');
  const originalFetch = globalThis.fetch;
  const methods = Object.keys(console);
  const originals = new Map(methods.map((method) => [method, console[method]]));
  let calls = 0;
  for (const method of methods) console[method] = () => { calls++; };
  globalThis.fetch = async () => new Response('invalid');
  try {
    await worker.fetch(request(), env);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [method, original] of originals) console[method] = original;
  }
});

async function withFeed(body, path, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body);
  try {
    const result = await worker.fetch(request(path), env);
    await callback(result);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('accepts a range of exactly 400 days', async () => {
  await withFeed(feed, '/rates?from=2025-08-01&to=2026-09-05', async (result) => {
    assert.equal(result.status, 200);
  });
});

test('rejects a range of 401 days with bad_request', async () => {
  const result = await worker.fetch(request('/rates?from=2025-08-01&to=2026-09-06'), env);
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: 'bad_request' });
});

test('rejects a from date after to with bad_request', async () => {
  const result = await worker.fetch(request('/rates?from=2026-09-05&to=2026-09-04'), env);
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: 'bad_request' });
});

test('rejects zero, negative and nonnumeric rates as upstream errors', async () => {
  for (const rate of ['0', '-1', 'abc']) {
    const body = `<Cube><Cube time="2026-09-04"><Cube currency="THB" rate="${rate}"/>` +
      '</Cube></Cube>';
    await withFeed(body, undefined, async (result) => {
      assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), { error: 'upstream' });
    });
  }
});

test('rejects an empty feed and a feed without Cube elements', async () => {
  for (const body of ['', '<gesmes:Envelope></gesmes:Envelope>']) {
    await withFeed(body, undefined, async (result) => {
      assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), { error: 'upstream' });
    });
  }
});

test('rejects duplicate dates in the feed', async () => {
  const duplicate = '<Cube><Cube time="2026-09-04"><Cube currency="THB" rate="1"/>' +
    '</Cube><Cube time="2026-09-04"><Cube currency="USD" rate="1"/></Cube></Cube>';
  await withFeed(duplicate, undefined, async (result) => {
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { error: 'upstream' });
  });
});

test('fetches recent or all-history feed based on request age', async () => {
  const originalFetch = globalThis.fetch;
  const originalDate = globalThis.Date;
  const urls = [];
  globalThis.Date = class extends originalDate {
    constructor(...args) {
      super(...(args.length ? args : ['2026-09-04T12:00:00Z']));
    }
    static now() { return new originalDate('2026-09-04T12:00:00Z').valueOf(); }
  };
  globalThis.fetch = async (url) => {
    urls.push(url);
    return new Response(feed);
  };
  try {
    await worker.fetch(request('/rates?from=2026-06-06&to=2026-09-04'), env);
    await worker.fetch(request('/rates?from=2026-06-05&to=2026-09-04'), env);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = originalDate;
  }
  assert.match(urls[0], /hist-90d\.xml$/);
  assert.match(urls[1], /hist\.xml$/);
});

test('refuses a wrong credential with the same length', async () => {
  const wrong = `${placeholder.slice(0, -1)}x`;
  const result = await worker.fetch(new Request(
    'https://fn.test/rates?from=2026-09-04&to=2026-09-04',
    { headers: { Authorization: `Bearer ${wrong}` } },
  ), env);
  assert.equal(result.status, 401);
});

test('rejects an unknown currencies value with bad_request', async () => {
  const result = await worker.fetch(request(
    '/rates?from=2026-09-04&to=2026-09-04&currencies=THB,unknown',
  ), env);
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: 'bad_request' });
});
