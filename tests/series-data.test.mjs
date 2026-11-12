import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeries } from '../app/series-data.js';

const formatAmount = (amount, currency) => `${amount} ${currency}`;
const accounts = [{ id: 'k1', name: 'Broker', kind: 'broker' }, { id: 'b1', name: 'Bank', kind: 'bank' }];
const batch = (from, to, start, end, netDeposits, account = 'k1') => ({ account, netDeposits, balances: [
  { currency: 'EUR', asOf: from, amount: start }, { currency: 'EUR', asOf: to, amount: end }] });
const run = (batches, convert = ({ amount }) => ({ amount })) =>
  loadSeries({ accounts, batches, convert, displayCurrency: 'EUR', formatAmount });

test('market change and Modified Dietz return, deposit timed mid-period', async () => {
  const { accounts: result } = await run([batch('2026-01-31', '2026-03-02', 100000, 150000, 20000)]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].periods, [{ from: '2026-02-01', to: '2026-03-02', start: '100000 EUR',
    deposits: '20000 EUR', end: '150000 EUR', marketChange: '30000 EUR', returnPct: '27.27%',
    partial: false, note: null }]);
});

test('a deposit-only period has zero market change and a price move has the matching return', async () => {
  const flat = (await run([batch('2026-01-31', '2026-03-02', 100000, 120000, 20000)]))
    .accounts[0].periods[0];
  assert.equal(flat.marketChange, '0 EUR');
  assert.equal(flat.returnPct, '0.00%');
  const move = (await run([batch('2026-01-31', '2026-03-02', 100000, 110000, 0)]))
    .accounts[0].periods[0];
  assert.equal(move.marketChange, '10000 EUR');
  assert.equal(move.returnPct, '10.00%');
});

test('a currency gain on a deposit is kept: values convert at their own dates', async () => {
  // EUR to USD at 2.0 on the start date and 3.0 at the end; the deposit is converted at the middle date.
  const rate = { '2026-01-31': 2, '2026-03-02': 3 };
  const convert = ({ amount }, to, date) => ({ amount: amount * (rate[date] ?? 2.5) });
  const { accounts: result } = await run([batch('2026-01-31', '2026-03-02', 100, 100, 0)], convert);
  assert.deepEqual([result[0].periods[0].start, result[0].periods[0].end, result[0].periods[0].marketChange],
    ['200 EUR', '300 EUR', '100 EUR']);
});

test('a zero denominator is not defined; unknown deposits and missing rates are never invented', async () => {
  const zero = (await run([batch('2026-01-31', '2026-03-02', 0, 0, 0)])).accounts[0].periods[0];
  assert.equal(zero.returnPct, 'not defined');
  const unknown = (await run([batch('2026-01-31', '2026-03-02', 100, 120, undefined)]))
    .accounts[0].periods[0];
  assert.deepEqual([unknown.start, unknown.end, unknown.marketChange, unknown.returnPct],
    ['100 EUR', '120 EUR', null, null]);
  assert.match(unknown.note, /again/);
  const noRate = (await run([batch('2026-01-31', '2026-03-02', 100, 120, 0)],
    () => ({ unavailable: true }))).accounts[0].periods[0];
  assert.equal(noRate.partial, true);
  assert.equal(noRate.start, null);
});

test('periods are sorted; a gap and an overlap between statements are reported', async () => {
  const batches = [batch('2026-05-31', '2026-06-30', 1, 1, 0), batch('2026-01-31', '2026-03-02', 1, 1, 0),
    batch('2026-06-15', '2026-07-15', 1, 1, 0)];
  const [account] = (await run(batches)).accounts;
  assert.deepEqual(account.periods.map(({ from, to }) => [from, to]), [['2026-02-01', '2026-03-02'],
    ['2026-06-01', '2026-06-30'], ['2026-06-16', '2026-07-15']]);
  assert.deepEqual(account.gaps, [{ from: '2026-03-03', to: '2026-05-31' }]);
  assert.equal(account.periods[2].note, 'Overlaps the previous statement');
});

test('only broker accounts are listed and a batch without two points is ignored', async () => {
  const { accounts: result } = await run([batch('2026-01-31', '2026-03-02', 1, 1, 0, 'b1'),
    { account: 'k1', balances: [{ currency: 'EUR', asOf: '2026-01-31', amount: 1 }] }]);
  assert.deepEqual(result, [{ id: 'k1', name: 'Broker', periods: [], gaps: [] }]);
});

test('a short statement inside a longer one leaves no false gap before the next', async () => {
  const batches = [batch('2026-01-31', '2026-09-30', 1, 1, 0), batch('2026-02-28', '2026-03-31', 1, 1, 0),
    batch('2026-09-30', '2026-10-31', 1, 1, 0)];
  assert.deepEqual((await run(batches)).accounts[0].gaps, []);
});
