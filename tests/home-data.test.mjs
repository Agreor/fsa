import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHome } from '../app/home-data.js';

const formatAmount = (amount, currency) => `${amount} ${currency}`;
const build = ({ accounts, rows, amount = () => ({ known: true, amount: 0 }),
  rates = () => ({ amount: 0 }) }) =>
  loadHome({ accounts, rows, makeBalances: () => ({ balance: amount }),
    convert: rates, displayCurrency: 'USD', formatAmount });

test('sums bank currencies after conversion and returns only three ordered lines', async () => {
  const result = await build({
    accounts: [{ id: 'a', name: 'A', kind: 'bank' }, { id: 'b', name: 'B', kind: 'bank' }],
    rows: [{ date: '2024-03-01', currency: 'EUR', account: 'a' },
      { date: '2024-03-02', currency: 'USD', account: 'b' }],
    amount: (id, currency) => ({ known: true, amount: id === 'a' ? 100 : 200 }),
    rates: ({ amount, currency }) => ({ amount: currency === 'EUR' ? amount * 2 : amount }),
  });
  assert.equal(result.month, '2024-03');
  assert.deepEqual(result.lines.map(({ id, label }) => [id, label]), [
    ['cash', 'Total cash'], ['investments', 'Total investments'],
    ['pension', 'Total pension and insurance'],
  ]);
  assert.equal(result.lines[0].value, '400 USD');
  assert.equal('total' in result, false);
});

test('counts debit card but excludes credit card', async () => {
  const result = await build({
    accounts: [{ id: 'd', name: 'D', kind: 'debit_card' }, { id: 'c', name: 'C', kind: 'credit_card' }],
    rows: [{ date: '2024-01-01', currency: 'USD', account: 'd' },
      { date: '2024-01-01', currency: 'USD', account: 'c' }],
    amount: (id) => ({ known: true, amount: id === 'd' ? 25 : 900 }),
    rates: ({ amount }) => ({ amount }),
  });
  assert.equal(result.lines[0].value, '25 USD');
});

test('unknown balance and missing rate are partial and excluded', async () => {
  const accounts = [{ id: 'a', name: 'Alpha', kind: 'bank' }, { id: 'b', name: 'Beta', kind: 'bank' }];
  const rows = accounts.map(({ id }) => ({ date: '2024-01-01', currency: 'USD', account: id }));
  const result = await build({ accounts, rows,
    amount: (id) => id === 'a' ? { known: false } : { known: true, amount: 90 },
    rates: () => ({ unavailable: true }),
  });
  assert.equal(result.lines[0].value, null);
  assert.equal(result.lines[0].partial, true);
  assert.equal(result.lines[0].note,
    'Opening balance missing for Alpha; No rate for USD on 2024-01-31');
});

test('empty rows and February month ends', async () => {
  const none = await build({ accounts: [], rows: [] });
  assert.equal(none.month, null);
  assert.deepEqual(none.lines[0], { id: 'cash', label: 'Total cash', value: null,
    asOf: null, partial: false, note: 'No data yet' });
  for (const [year, day] of [[2024, '29'], [2023, '28']]) {
    const rows = [{ date: `${year}-02-01`, currency: 'USD', account: 'x' }];
    const result = await build({ accounts: [], rows });
    assert.equal(result.lines[0].asOf, `${year}-02-${day}`);
  }
});

test('investments: latest dated broker statement value per currency, converted at its own date', async () => {
  const batches = [
    { account: 'k1', balances: [{ currency: 'EUR', asOf: '2026-01-31', amount: 1000 },
      { currency: 'EUR', asOf: '2026-02-28', amount: 2500 }] },
    { account: 'k1', balances: [{ currency: 'USD', asOf: '2026-02-10', amount: 400 }] },
    { account: 'b1', balances: [{ currency: 'EUR', asOf: '2026-03-31', amount: 9999 }] }];
  const accounts = [{ id: 'k1', name: 'Broker', kind: 'broker' }, { id: 'b1', name: 'Bank', kind: 'bank' }];
  const result = await loadHome({ accounts, rows: [], batches, makeBalances: () => ({}),
    convert: ({ amount, currency }, to, date) => currency === 'USD' && date === '2026-02-10'
      ? { amount: amount * 2 } : { amount }, displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(result.lines[1], { id: 'investments', label: 'Total investments',
    value: '3300 EUR', asOf: '2026-02-28', partial: false, note: null });
  assert.equal(result.month, null);
  assert.equal(result.lines[0].note, 'No data yet');
});

test('investments: a missing rate is partial, never zero; no broker is No data yet', async () => {
  const accounts = [{ id: 'k1', name: 'Broker', kind: 'broker' }];
  const batches = [{ account: 'k1', balances: [{ currency: 'USD', asOf: '2026-02-10', amount: 400 }] }];
  const partial = await loadHome({ accounts, rows: [], batches, makeBalances: () => ({}),
    convert: () => ({ unavailable: true }), displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(partial.lines[1], { id: 'investments', label: 'Total investments', value: null,
    asOf: null, partial: true, note: 'No rate for USD on 2026-02-10' });
  const none = await loadHome({ accounts, rows: [], makeBalances: () => ({}),
    convert: () => ({ amount: 0 }), displayCurrency: 'EUR', formatAmount });
  assert.equal(none.lines[1].note, 'No data yet');
});
