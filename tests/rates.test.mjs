import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateClient, summarize } from '../src/rates.js';

const placeholder = 'placeholder-not-real';
const data = { rates: { '2026-09-04': { THB: '37.5', USD: '2' } } };
function client(fetch = async () => Response.json(data)) {
  return createRateClient({ baseUrl: 'https://fn.test', getSecret: () => placeholder, fetch });
}

test('load sends bearer authorization and requests seven earlier days', async () => {
  let received;
  await client(async (url, options) => {
    received = [url, options];
    return Response.json(data);
  }).load({ from: '2026-09-04', to: '2026-09-10' });
  assert.equal(received[0], 'https://fn.test/rates?from=2026-08-28&to=2026-09-10');
  assert.equal(received[1].headers.Authorization, `Bearer ${placeholder}`);
});

test('401 errors hide both the placeholder and response body', async () => {
  const body = 'upstream-private-body';
  await assert.rejects(client(async () => new Response(body, { status: 401 }))
    .load({ from: '2026-09-04', to: '2026-09-04' }), (error) => {
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.message.includes(placeholder), false);
    assert.equal(error.message.includes(body), false);
    return true;
  });
});

test('rejected fetch is offline and non-200 response is upstream', async () => {
  await assert.rejects(client(async () => { throw Error('offline'); })
    .load({ from: '2026-09-04', to: '2026-09-04' }), { code: 'offline' });
  await assert.rejects(client(async () => new Response('', { status: 503 }))
    .load({ from: '2026-09-04', to: '2026-09-04' }), { code: 'upstream' });
});

test('converts THB to EUR, EUR to THB and preserves same currency', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 3750, currency: 'THB' }, 'EUR', '2026-09-04'),
    { amount: 100 });
  assert.deepEqual(rates.convert({ amount: 100, currency: 'EUR' }, 'THB', '2026-09-04'),
    { amount: 3750 });
  assert.deepEqual(rates.convert({ amount: 15, currency: 'THB' }, 'THB', '2026-09-04'),
    { amount: 15 });
});

test('a Sunday date uses Friday rate', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-06', to: '2026-09-06' });
  assert.deepEqual(rates.convert({ amount: 3750, currency: 'THB' }, 'EUR', '2026-09-06'),
    { amount: 100 });
});

test('failed September load does not make its dates available after January loaded', async () => {
  let calls = 0;
  const rates = client(async () => {
    calls += 1;
    if (calls === 1) return Response.json({ rates: { '2026-01-15': { THB: '37.5' } } });
    throw Error('offline');
  });
  await rates.load({ from: '2026-01-15', to: '2026-01-15' });
  await assert.rejects(rates.load({ from: '2026-09-04', to: '2026-09-10' }),
    { code: 'offline' });
  const row = { date: '2026-09-04', amount: 3750, currency: 'THB' };
  assert.deepEqual(rates.convert(row, 'EUR', row.date), { unavailable: true });
  assert.deepEqual(summarize([row], rates, 'EUR'), { total: 0, partial: true });
});

test('weekend fallback stays inside loaded window and periods remain separate', async () => {
  const rates = client(async () => Response.json({ rates: {
    '2026-01-15': { THB: '37.5' }, '2026-09-04': { THB: '37.5' },
  } }));
  await rates.load({ from: '2026-01-15', to: '2026-01-15' });
  await rates.load({ from: '2026-09-06', to: '2026-09-06' });
  assert.deepEqual(rates.convert({ amount: 3750, currency: 'THB' }, 'EUR', '2026-09-06'),
    { amount: 100 });
  assert.deepEqual(rates.convert({ amount: 3750, currency: 'THB' }, 'EUR', '2026-01-15'),
    { amount: 100 });
});

test('dates outside loaded period bounds are unavailable', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  for (const date of ['2026-08-27', '2026-09-05']) {
    assert.deepEqual(rates.convert({ amount: 1, currency: 'THB' }, 'EUR', date),
      { unavailable: true });
  }
});

test('dates before loaded rates and unknown currencies are unavailable', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 1, currency: 'THB' }, 'EUR', '2026-08-01'),
    { unavailable: true });
  assert.deepEqual(rates.convert({ amount: 1, currency: 'ZZZ' }, 'EUR', '2026-09-04'),
    { unavailable: true });
});

test('rounds positive and negative half amounts away from zero', async () => {
  const rates = client(async () => Response.json({ rates: { '2026-09-04': { USD: '0.5' } } }));
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 1, currency: 'EUR' }, 'USD', '2026-09-04'),
    { amount: 1 });
  assert.deepEqual(rates.convert({ amount: -1, currency: 'EUR' }, 'USD', '2026-09-04'),
    { amount: -1 });
});

test('converts a large minor-unit amount exactly', async () => {
  const rates = client(async () => Response.json({ rates: { '2026-09-04': { USD: '2' } } }));
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 12345678 * 10, currency: 'EUR' }, 'USD',
    '2026-09-04'), { amount: 12345678 * 20 });
});

test('zero amount converts to zero', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 0, currency: 'THB' }, 'EUR', '2026-09-04'),
    { amount: 0 });
});

test('loading the same range twice keeps the same rates without duplicates', async () => {
  const rates = client();
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  await rates.load({ from: '2026-09-04', to: '2026-09-04' });
  assert.deepEqual(rates.convert({ amount: 3750, currency: 'THB' }, 'EUR', '2026-09-04'),
    { amount: 100 });
});

test('summarize marks unavailable rows partial, handles empty rows and leaves rows unchanged',
  async () => {
    const rates = client();
    await rates.load({ from: '2026-09-04', to: '2026-09-04' });
    const rows = [
      { date: '2026-09-04', amount: 3750, currency: 'THB' },
      { date: '2026-09-04', amount: 10, currency: 'ZZZ' },
    ];
    const copy = JSON.stringify(rows);
    assert.deepEqual(summarize(rows, rates, 'EUR'), { total: 100, partial: true });
    assert.deepEqual(summarize([], rates, 'EUR'), { total: 0, partial: false });
    assert.equal(JSON.stringify(rows), copy);
  });
