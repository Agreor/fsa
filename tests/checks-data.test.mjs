import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, createChecksData, createChecksActions } from '../app/checks-data.js';
import { createBalances } from '../src/balances.js';
import { createStore, memoryBackend } from '../src/store.js';

const fmt = (amount, currency) => `${amount} ${currency}`;
const accounts = [{ id: 'a1', name: 'One' }, { id: 'a2', name: 'Empty' }];
const row = (date, amount, extra = {}) => ({ date, description: 'x', amount, currency: 'EUR',
  account: 'a1', occurrence: 1, ...extra });
const setup = async (batches = []) => {
  const backend = memoryBackend(), store = createStore(backend);
  const makeBalances = () => createBalances({ backend });
  for (const [index, parsed] of batches.entries()) {
    await store.addBatch('a1', parsed, { fileHash: `h${index}`, name: `f${index}` });
  }
  const data = createChecksData({ listAccounts: () => accounts, listBatches: () => store.listBatches(),
    listRows: () => store.listRows(), makeBalances, formatAmount: fmt });
  return { backend, store, makeBalances, data };
};
const statement = (from, to, opening, closing, rows = []) => ({ rows, coverage: { from, to },
  balances: [{ currency: 'EUR', asOf: from, amount: opening },
    { currency: 'EUR', asOf: to, amount: closing }] });

test('parseAmount reads decimals exactly and rejects everything else', () => {
  const good = [['1234.56', 123456], ['-12,5', -1250], ['+7', 700], ['1.15', 115], ['0.07', 7],
    ['  2.1 ', 210], ['-0', 0], ['-0.00', 0], ['9007199254740991', null], // pii-ok synthetic
    ['90071992547409.91', 9007199254740991]]; // pii-ok synthetic
  for (const [text, value] of good) assert.equal(parseAmount(text), value, text);
  const bad = ['', ' ', '-', '+', '1,234.56', '12.345', 'abc', '1e3', '.5', '5.', '1 2', '90071992547409.92',
    null, undefined, 12];
  for (const text of bad) assert.equal(parseAmount(text), null, String(text));
});

test('load lists every account with currencies from rows and statement balances', async () => {
  const { data } = await setup([statement('2026-01-01', '2026-01-31', 1000, 900, [row('2026-01-05', -100)])]);
  const { accounts: loaded } = await data.load();
  assert.deepEqual(loaded.map(({ name }) => name), ['One', 'Empty']);
  assert.deepEqual(loaded[1].currencies, []);
  assert.deepEqual([loaded[1].covered, loaded[1].gaps], [[], []]);
  assert.deepEqual(loaded[0].currencies.map(({ currency }) => currency), ['EUR']);
  assert.deepEqual(loaded[0].covered, [{ from: '2026-01-01', to: '2026-01-31' }]);
});

test('a currency that appears only in rows is listed without checks or suggestion', async () => {
  const { data } = await setup([{ rows: [row('2026-01-05', -100, { currency: 'THB' })], coverage: null }]);
  const [one] = (await data.load()).accounts;
  assert.deepEqual(one.currencies.map(({ currency, suggestion, checks }) => [currency, suggestion, checks]),
    [['THB', null, []]]);
});

test('the suggestion is the earliest statement balance and goes away once an opening is set', async () => {
  const { data, makeBalances } = await setup([
    statement('2026-02-01', '2026-02-28', 900, 800), statement('2026-01-01', '2026-01-31', 1000, 900)]);
  let [eur] = (await data.load()).accounts[0].currencies;
  assert.deepEqual(eur.suggestion, { date: '2026-01-01', amount: 1000, display: '1000 EUR' });
  assert.deepEqual(eur.opening, { known: false });
  assert.deepEqual(eur.checks.map(({ asOf, status }) => [asOf, status]), [['2026-01-01', 'unchecked'],
    ['2026-01-31', 'unchecked'], ['2026-02-01', 'unchecked'], ['2026-02-28', 'unchecked']]);
  await makeBalances().setOpening('a1', 'EUR', '2026-01-01', 1000);
  [eur] = (await data.load()).accounts[0].currencies;
  assert.equal(eur.suggestion, null);
  assert.deepEqual(eur.opening, { known: true, date: '2026-01-01', display: '1000 EUR' });
});

test('with real balances an opening gives match or mismatch and clearing undoes it', async () => {
  const { data, makeBalances } = await setup([statement('2026-01-01', '2026-01-31', 1000, 900,
    [row('2026-01-05', -100)])]);
  const refreshes = [], reports = [];
  const actions = createChecksActions({ makeBalances, report: (m) => reports.push(m),
    refresh: async () => { refreshes.push(true); } });
  const status = async () => (await data.load()).accounts[0].currencies[0].checks.map((c) => c.status);
  const { suggestion } = (await data.load()).accounts[0].currencies[0];
  await actions.useSuggestion('a1', 'EUR', suggestion);
  assert.deepEqual(await status(), ['match', 'match']);
  await actions.clearOpening('a1', 'EUR');
  assert.deepEqual(await status(), ['unchecked', 'unchecked']);
  await actions.setOpening('a1', 'EUR', '2026-01-01', '9,50');
  const [first, second] = (await data.load()).accounts[0].currencies[0].checks;
  assert.deepEqual([first.status, first.difference, second.status, second.difference],
    ['mismatch', '-50 EUR', 'mismatch', '-50 EUR']);
  assert.deepEqual([reports, refreshes.length], [[], 3]);
});

test('an invalid amount or date writes nothing, is reported, and still refreshes', async () => {
  const { backend, makeBalances } = await setup();
  const reports = []; let refreshes = 0;
  const actions = createChecksActions({ makeBalances, report: (m) => reports.push(m),
    refresh: async () => { refreshes++; } });
  const before = await backend.list();
  await actions.setOpening('a1', 'EUR', '2026-01-01', 'abc');
  await actions.setOpening('a1', 'EUR', '2026-13-01', '10');
  await actions.setOpening('a1', 'EUR', '', '10');
  assert.deepEqual(await backend.list(), before);
  assert.equal(reports.length, 3);
  assert.equal(reports[0], 'Could not save the opening balance: enter an amount like 1234.56');
  assert.ok(reports.every((m) => m.startsWith('Could not save the opening balance: ')));
  assert.equal(refreshes, 3);
});

test('a failing refresh after a write does not hide the write or throw', async () => {
  const { makeBalances } = await setup();
  const actions = createChecksActions({ makeBalances, report() {},
    refresh: async () => { throw new Error('x'); } });
  await actions.setOpening('a1', 'EUR', '2026-01-01', '5');
  assert.equal((await makeBalances().balance('a1', 'EUR')).known, true);
});

test('gaps of exactly one day are reported and touching statements are not gaps', async () => {
  const { data } = await setup([statement('2026-01-01', '2026-01-31', 1, 1),
    statement('2026-02-02', '2026-02-28', 1, 1), statement('2026-03-01', '2026-03-31', 1, 1)]);
  const [one] = (await data.load()).accounts;
  assert.deepEqual(one.gaps, [{ from: '2026-02-01', to: '2026-02-01' }]);
  assert.equal(one.covered.length, 2);
});

test('an account with a batch that has no balances and no coverage still loads', async () => {
  const { data } = await setup([{ rows: [row('2026-01-05', -100)], coverage: null }]);
  const [one] = (await data.load()).accounts;
  assert.deepEqual([one.covered, one.gaps, one.currencies[0].checks], [[], [], []]);
});
