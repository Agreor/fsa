import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatest, createRatesFlow } from '../app/rates-flow.js';
import { createRateClient } from '../src/rates.js';

const row = (date) => ({ date, amount: 1000, currency: 'EUR' });
const daysAfter = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

test('ensure skips missing inputs and loads bounded, remembered spans', async () => {
  const calls = [];
  const flow = createRatesFlow({ client: { load: async (span) => calls.push(span),
    convert: () => ({ amount: 5 }) }, hasSecret: () => true });
  assert.deepEqual(await flow.ensure([]), { status: 'nothing' });
  assert.deepEqual(await flow.ensure([row('bad')]), { status: 'nothing' });
  assert.deepEqual(await createRatesFlow({ client: { load() { throw Error(); } },
    hasSecret: () => false }).ensure([row('2026-01-01')]), { status: 'no_secret' });
  const last = daysAfter('2026-01-01', 800);
  assert.deepEqual(await flow.ensure([row('2026-01-01'), row(last)]), { status: 'ok' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].to, daysAfter(calls[0].from, 389));
  assert.equal(daysAfter(calls[0].to, 1), calls[1].from);
  assert.equal(daysAfter(calls[1].to, 1), calls[2].from);
  await flow.ensure([row('2026-01-01'), row(last)]);
  await flow.ensure([row('2026-02-01')]);
  assert.equal(calls.length, 3);
});

test('one-day and 390/391-day spans use the exact chunk boundary', async () => {
  for (const [days, expected] of [[0, 1], [389, 1], [390, 2]]) {
    const calls = [];
    const flow = createRatesFlow({ client: { load: async (span) => calls.push(span),
      convert: () => ({ amount: 1 }) }, hasSecret: () => true });
    await flow.ensure([row('2026-01-01'), row(daysAfter('2026-01-01', days))]);
    assert.equal(calls.length, expected);
    assert.ok(calls.every(({ from, to }) =>
      (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 <= 389));
  }
});

test('failed chunks map errors and retry', async () => {
  for (const code of ['offline', 'unauthorized', 'upstream', 'unknown']) {
    let attempts = 0;
    const flow = createRatesFlow({ client: { async load() {
      attempts++; if (attempts === 1) { const error = Error(); error.code = code; throw error; }
    } }, hasSecret: () => true });
    assert.deepEqual(await flow.ensure([row('2026-01-01')]),
      { status: code === 'unknown' ? 'upstream' : code });
    assert.deepEqual(await flow.ensure([row('2026-01-01')]), { status: 'ok' });
    assert.equal(attempts, 2);
  }
});

test('merged spans skip loaded days and load only holes', async () => {
  const calls = [];
  const flow = createRatesFlow({ client: { load: async (span) => calls.push(span) },
    hasSecret: () => true });
  await flow.ensure([row('2026-01-01'), row('2026-01-31')]);
  await flow.ensure([row('2026-02-01'), row('2026-02-28')]);
  await flow.ensure([row('2026-01-01'), row('2026-02-28')]);
  assert.equal(calls.length, 2);

  const extended = createRatesFlow({ client: { load: async (span) => calls.push(span) },
    hasSecret: () => true });
  await extended.ensure([row('2026-01-01'), row('2026-01-31')]);
  await extended.ensure([row('2026-01-01'), row('2026-02-28')]);
  assert.deepEqual(calls.slice(2), [{ from: '2026-01-01', to: '2026-01-31' },
    { from: '2026-02-01', to: '2026-02-28' }]);
});

test('a failed middle chunk retries alone and concurrent ensures serialize', async () => {
  const calls = [];
  let failures = 0;
  const flow = createRatesFlow({ client: { async load(span) {
    calls.push(span);
    if (span.from === '2027-01-26' && failures++ === 0) throw Error();
  } }, hasSecret: () => true });
  const from = '2026-01-01';
  const to = daysAfter(from, 800);
  assert.deepEqual(await flow.ensure([row(from), row(to)]), { status: 'upstream' });
  assert.deepEqual(await flow.ensure([row(from), row(to)]), { status: 'ok' });
  assert.deepEqual(calls.map(({ from: start, to: end }) => [start, end]), [
    [from, daysAfter(from, 389)], [daysAfter(from, 390), daysAfter(from, 779)],
    [daysAfter(from, 390), daysAfter(from, 779)], [daysAfter(from, 780), to],
  ]);
});

test('concurrent ensures share loaded chunks and failures do not block later calls', async () => {
  const calls = [];
  let reject = true;
  const flow = createRatesFlow({ client: { async load(span) {
    calls.push(span);
    if (reject) { reject = false; throw Error(); }
  } }, hasSecret: () => true });
  assert.deepEqual(await flow.ensure([row('2026-01-01')]), { status: 'upstream' });
  const first = flow.ensure([row('2026-01-01')]);
  const second = flow.ensure([row('2026-01-01')]);
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
});

test('loaded January and March leave only February uncovered', async () => {
  const calls = [];
  const flow = createRatesFlow({ client: { load: async (span) => calls.push(span) },
    hasSecret: () => true });
  await flow.ensure([row('2026-01-01'), row('2026-01-31')]);
  await flow.ensure([row('2026-03-01'), row('2026-03-31')]);
  await flow.ensure([row('2026-01-01'), row('2026-03-31')]);
  assert.deepEqual(calls[2], { from: '2026-02-01', to: '2026-02-28' });
});

test('latest conversion token invalidates older work', () => {
  const latest = createLatest();
  const old = latest.next();
  const current = latest.next();
  assert.equal(latest.isCurrent(old), false);
  assert.equal(latest.isCurrent(current), true);
});

test('convertRows marks unavailable results', () => {
  const flow = createRatesFlow({ client: { convert: (item) =>
    item.amount === 1000 ? { amount: 36500 } : { unavailable: true } }, hasSecret: () => true });
  assert.deepEqual(flow.convertRows([row('2026-01-01'), { ...row('2026-01-01'), amount: 1 }], 'THB'),
    { items: [{ row: row('2026-01-01'), amount: 36500 },
      { row: { ...row('2026-01-01'), amount: 1 }, amount: null }], partial: true });
});

test('real rate client converts cross rates and authorizes requests', async () => {
  const requests = [];
  const client = createRateClient({ baseUrl: '.', getSecret: () => 'test-secret-value',
    fetch: async (...args) => {
      requests.push(args);
      return { status: 200, json: async () => ({ rates: {
        '2026-01-05': { THB: '36.5', USD: '1.1' },
      } }) };
    } });
  const flow = createRatesFlow({ client, hasSecret: () => true });
  await flow.ensure([row('2026-01-05')]);
  assert.deepEqual(flow.convertRows([row('2026-01-05'), { date: '2026-01-05', amount: 1100,
    currency: 'USD' }], 'THB').items.map(({ amount }) => amount), [36500, 36500]);
  assert.equal(flow.convertRows([row('2025-01-01')], 'THB').items[0].amount, null);
  assert.equal(requests[0][1].headers.Authorization, 'Bearer test-secret-value');
  assert.ok(requests[0][0].startsWith('./rates?'));
});
