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

test('parses only the days inside the requested window', async () => {
  const day = (date, rate) => `<Cube time="${date}"><Cube currency="THB" rate="${rate}"/></Cube>`;
  // The day outside the window carries an unusable rate; it must be neither parsed nor returned.
  const history = `<Cube>${day('2026-09-06', 'bad')}${day('2026-09-05', '37.7')}${day('2026-09-04', '37.5')}`
    + `${day('2026-09-03', 'bad')}</Cube>`;
  await withFeed(history, '/rates?from=2026-09-04&to=2026-09-05', async (result) => {
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).rates, {
      '2026-09-04': { THB: '37.5' }, '2026-09-05': { THB: '37.7' } });
  });
  await withFeed(history, '/rates?from=2026-08-01&to=2026-08-02', async (result) => {
    assert.equal(result.status, 502);
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

const classifierEnv = { ...env, TYPESAFE_API_KEY: 'placeholder-not-real' }; // pii-ok synthetic
const post = (body, headers = {}, path = '/classify') => new Request(`https://fn.test${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${secret}`, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const stubUpstream = async (handler, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
};
const jevReply = (choice, confidence = 0.9) => async () => new Response(JSON.stringify({
  answers: { q0: { type: 'choice', choice, confidence, probabilities: {} } } }));

test('classify answers other methods and paths with 404 and the preflight with 204', async () => {
  const get = await worker.fetch(request('/classify'), classifierEnv);
  assert.equal(get.status, 404);
  const put = await worker.fetch(new Request('https://fn.test/classify', { method: 'PUT' }), classifierEnv);
  assert.equal(put.status, 404);
  const preflight = await worker.fetch(new Request('https://fn.test/classify', { method: 'OPTIONS',
    headers: { Origin: env.ALLOWED_ORIGIN } }), classifierEnv);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'authorization, content-type');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  assert.equal((await worker.fetch(post({ texts: ['Lidl'] }, {}, '/other'), classifierEnv)).status, 404);
});

test('classify checks configuration and authorisation before it reads the body', async () => {
  let read = false;
  const spy = (text) => ({ ...post(text), text: async () => { read = true; return text; },
    headers: new Headers({ Authorization: `Bearer ${secret}` }), method: 'POST',
    url: 'https://fn.test/classify' });
  const noSecret = await worker.fetch(spy('{}'), { TYPESAFE_API_KEY: 'x' });
  assert.deepEqual([noSecret.status, await noSecret.json()], [503, { error: 'unavailable' }]);
  const wrong = await worker.fetch(post({ texts: ['Lidl'] }, { Authorization: 'Bearer nope' }),
    classifierEnv);
  assert.deepEqual([wrong.status, await wrong.json()], [401, { error: 'unauthorized' }]);
  const missing = await worker.fetch(new Request('https://fn.test/classify', { method: 'POST', body: '{}' }),
    classifierEnv);
  assert.equal(missing.status, 401);
  const noKey = await worker.fetch(spy('{}'), env);
  assert.deepEqual([noKey.status, await noKey.json()], [503, { error: 'classifier_unavailable' }]);
  assert.equal(read, false);
});

test('classify counts the body limit in bytes and stops reading a long stream', async () => {
  const status = async (body) => (await worker.fetch(post(body), classifierEnv)).status;
  assert.equal(await status(JSON.stringify({ texts: ['Lidl'], padding: 'ก'.repeat(6000) })), 413);
  await stubUpstream(jevReply('Groceries'), async () => {
    assert.equal(await status(JSON.stringify({ texts: ['Lidl'], padding: 'x'.repeat(16000) })), 200);
  });
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) {
    pulls++;
    controller.enqueue(new TextEncoder().encode('x'.repeat(4096)));
  }, cancel() { cancelled = true; } });
  const streamed = new Request('https://fn.test/classify', { method: 'POST', body: stream, duplex: 'half',
    headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await worker.fetch(streamed, classifierEnv)).status, 413);
  assert.ok(pulls <= 8, `pulled ${pulls} times`);
  assert.equal(cancelled, true);
  const declared = post('{}', { 'Content-Length': '99999' });
  assert.equal((await worker.fetch(declared, classifierEnv)).status, 413);
});

test('classify sends a whole batch when one merchant needs a second prefix strip', async () => {
  let sent;
  await stubUpstream(async (_url, init) => {
    sent = JSON.parse(init.body).state.merchants;
    return new Response(JSON.stringify({ answers: {} }));
  }, async () => {
    const result = await worker.fetch(post({ texts: ['POS CARD FACTORY', 'Lidl'] }), classifierEnv);
    assert.equal(result.status, 200);
  });
  assert.deepEqual(sent, ['POS CARD FACTORY', 'Lidl']);
});

test('classify refuses a personal transfer text without calling the upstream', async () => {
  let called = 0;
  await stubUpstream(async () => { called++; return new Response('{}'); }, async () => {
    const result = await worker.fetch(post({ texts: ['Transfer Alice Example'] }), classifierEnv);
    assert.equal(result.status, 400);
  });
  assert.equal(called, 0);
});

test('classify refuses oversized, malformed and unsafe bodies', async () => {
  const status = async (body) => (await worker.fetch(post(body), classifierEnv)).status;
  assert.equal(await status('x'.repeat(16385)), 413);
  const cardLike = { texts: ['4111111111111111'] }; // pii-ok synthetic
  for (const body of ['not json', '{', 'null', '[]', '{}', { texts: [] }, { texts: 'Lidl' },
    { texts: ['Lidl 12'] }, cardLike, { texts: ['Lidl', 'Lidl'] }, { texts: [5] }]) {
    assert.equal(await status(body), 400, JSON.stringify(body));
  }
});

test('classify returns confident categories with no-store and no merchant text elsewhere', async () => {
  await stubUpstream(jevReply('Groceries'), async () => {
    const result = await worker.fetch(post({ texts: ['Lidl'] }, { Origin: env.ALLOWED_ORIGIN }),
      classifierEnv);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
    assert.deepEqual(await result.json(), { categories: { Lidl: 'Groceries' } });
  });
  await stubUpstream(jevReply('Groceries', 0.2), async () => {
    const result = await worker.fetch(post({ texts: ['Lidl'] }), classifierEnv);
    assert.deepEqual(await result.json(), { categories: {} });
  });
});

test('classify reports a busy upstream with Retry-After and any other failure as upstream', async () => {
  const outcome = async (handler) => stubUpstream(handler, async () => {
    const result = await worker.fetch(post({ texts: ['Lidl'] }), classifierEnv);
    const text = await result.text();
    assert.ok(!text.includes('Lidl') && !text.includes(classifierEnv.TYPESAFE_API_KEY));
    return [result.status, JSON.parse(text).error, result.headers.get('Retry-After')];
  });
  assert.deepEqual(await outcome(async () => new Response('', { status: 429 })), [503, 'busy', '30']);
  assert.deepEqual(await outcome(async () => new Response('', { status: 529 })), [503, 'busy', '30']);
  assert.deepEqual(await outcome(async () => new Response('', { status: 500 })), [502, 'upstream', null]);
  const rejected = await stubUpstream(async () => new Response('{"detail":"Lidl"}', { status: 422 }), () =>
    worker.fetch(post({ texts: ['Lidl'] }), classifierEnv));
  assert.equal(rejected.status, 502);
  assert.equal(rejected.headers.get('X-Upstream-Status'), '422');
  assert.ok(!(await rejected.text()).includes('Lidl'));
  const down = await stubUpstream(async () => { throw new Error('down'); }, () =>
    worker.fetch(post({ texts: ['Lidl'] }), classifierEnv));
  assert.equal(down.headers.get('X-Upstream-Status'), null);
  assert.deepEqual(await outcome(async () => { throw new Error('down'); }), [502, 'upstream', null]);
  assert.deepEqual(await outcome(async () => new Response('{}')), [502, 'upstream', null]);
});

test('rates still answer next to classify', async () => {
  await stubUpstream(async () => new Response(feed), async () => {
    const result = await worker.fetch(request(), classifierEnv);
    assert.equal(result.status, 200);
  });
});
