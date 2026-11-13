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
    'Starting balance missing for Alpha; No rate for USD on 2024-01-31 (Beta)');
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
  // A statement balance counts even with no transactions at all.
  assert.equal(result.lines[0].value, '9999 EUR');
  assert.equal(result.lines[0].asOf, '2026-03-31');
});

test('cash: statement balances convert at the statement date and a missing rate names the account', async () => {
  const accounts = [{ id: 'b1', name: 'Bank', kind: 'bank' }];
  const batches = [{ account: 'b1', balances: [{ currency: 'USD', asOf: '2026-03-15', amount: 100 }] }];
  const rows = [{ account: 'b1', date: '2026-03-31', amount: 1, currency: 'USD', description: 'x' }];
  const dates = [];
  await loadHome({ accounts, rows, batches, makeBalances: () => ({}),
    convert: (money, to, date) => { dates.push(date); return { amount: money.amount }; }, displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(dates, ['2026-03-31']);
  const partial = await loadHome({ accounts, rows, batches, makeBalances: () => ({}),
    convert: () => ({ unavailable: true }), displayCurrency: 'EUR', formatAmount });
  assert.equal(partial.lines[0].note, 'No rate for USD on 2026-03-31 (Bank)');
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

test('pension and insurance: latest dated value per name, each converted at its own date', async () => {
  const entries = [
    { name: 'Fund A', kind: 'pension', amount: 1000, currency: 'EUR', asOf: '2026-01-31' },
    { name: 'Fund A', kind: 'pension', amount: 1500, currency: 'EUR', asOf: '2026-03-31' },
    { name: 'Policy B', kind: 'insurance', amount: 400, currency: 'USD', asOf: '2026-02-10' }];
  const result = await loadHome({ accounts: [], rows: [], entries, makeBalances: () => ({}),
    convert: ({ amount, currency }, to, date) => currency === 'USD' && date === '2026-02-10'
      ? { amount: amount * 2 } : { amount }, displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(result.lines[2], { id: 'pension', label: 'Total pension and insurance',
    value: '2300 EUR', asOf: '2026-03-31', partial: false, note: null });
  assert.equal(result.lines.length, 3);
});

test('pension and insurance: a missing rate is partial and not counted as zero', async () => {
  const entries = [{ name: 'Policy B', kind: 'insurance', amount: 400, currency: 'USD', asOf: '2026-02-10' }];
  const result = await loadHome({ accounts: [], rows: [], entries, makeBalances: () => ({}),
    convert: () => ({ unavailable: true }), displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(result.lines[2], { id: 'pension', label: 'Total pension and insurance', value: null,
    asOf: null, partial: true, note: 'No rate for USD on 2026-02-10' });
});

test('cash uses the newest statement balance plus later rows, without an opening balance', async () => {
  const result = await loadHome({ accounts: [{ id: 'a', name: 'A', kind: 'bank' }],
    rows: [{ date: '2024-03-10', currency: 'USD', account: 'a', amount: -50 }],
    batches: [{ account: 'a', balances: [{ currency: 'USD', asOf: '2024-02-29', amount: 1000 }] }],
    makeBalances: () => ({ balance: () => ({ known: false }) }),
    convert: ({ amount }) => ({ amount }), displayCurrency: 'USD', formatAmount });
  assert.equal(result.lines[0].value, '950 USD');
  assert.equal(result.lines[0].partial, false);
});

test('net worth sums the parts that have a figure, lists positive parts and cash by account, and is partial when a line is', async () => {
  const accounts = [{ id: 'a', name: 'A', kind: 'bank' }, { id: 'b', name: 'B', kind: 'bank' }, { id: 'k', name: 'K', kind: 'broker' }];
  const rows = [{ date: '2024-03-01', currency: 'USD', account: 'a' }, { date: '2024-03-02', currency: 'USD', account: 'b' }];
  const batches = [{ account: 'k', balances: [{ currency: 'USD', asOf: '2024-03-31', amount: 700 }] }];
  const result = await loadHome({ accounts, rows, batches, entries: [{ name: 'P', kind: 'pension', amount: 50, currency: 'XXX', asOf: '2024-03-01' }],
    makeBalances: () => ({ balance: async (id) => ({ known: true, amount: id === 'a' ? 100 : 300 }) }),
    convert: ({ amount, currency }) => (currency === 'XXX' ? { unavailable: true } : { amount }), displayCurrency: 'USD', formatAmount });
  assert.deepEqual(result.netWorth, { amount: 1100, text: '1100 USD', partial: true, bound: 'least' }); // pension has no rate
  assert.deepEqual(result.parts.map(({ id, amount }) => [id, amount]), [['cash', 400], ['investments', 700]]);
  assert.deepEqual(result.accounts.map(({ name, amount }) => [name, amount]), [['B', 300], ['A', 100]]);
  const none = await loadHome({ accounts: [], rows: [], makeBalances: () => ({}), convert: () => ({ amount: 0 }), displayCurrency: 'USD', formatAmount });
  assert.equal(none.netWorth, null);
});

test('net worth is assets minus what the cards owe; a card without a statement makes it partial', async () => {
  const accounts = [{ id: 'a', name: 'A', kind: 'bank' }, { id: 'c', name: 'Visa', kind: 'credit_card' }, { id: 'd', name: 'Amex', kind: 'credit_card' }];
  const rows = [{ date: '2024-03-01', currency: 'USD', account: 'a' }, { date: '2024-03-20', currency: 'USD', account: 'c', amount: -50 },
    { date: '2024-03-21', currency: 'USD', account: 'd', amount: -10 }];
  const batches = [{ account: 'c', balances: [{ currency: 'USD', asOf: '2024-03-10', amount: -300 }] }];
  const common = { accounts, rows, batches, makeBalances: () => ({ balance: async () => ({ known: true, amount: 1000 }) }),
    convert: ({ amount }) => ({ amount }), displayCurrency: 'USD', formatAmount };
  const result = await loadHome(common);
  assert.equal(result.liabilities.amount, 350); // 300 on the statement plus 50 spent since
  assert.deepEqual([result.netWorth.amount, result.netWorth.partial], [650, true]); // Amex has no statement
  assert.equal(result.netWorth.bound, 'most'); // unknown debt can only lower it
  assert.match(result.liabilities.note, /Card debt unknown for Amex/);
  const clean = await loadHome({ ...common, accounts: accounts.slice(0, 2) });
  assert.deepEqual([clean.netWorth.amount, clean.netWorth.partial], [650, false]);
});

test('card debt is valued at the statement date, like the Cards tab', async () => {
  const accounts = [{ id: 'c', name: 'Visa', kind: 'credit_card' }];
  const rows = [{ date: '2024-03-20', currency: 'THB', account: 'c', amount: -50 }];
  const batches = [{ account: 'c', balances: [{ currency: 'THB', asOf: '2024-03-10', amount: -300 }] }];
  const dates = [];
  await loadHome({ accounts, rows, batches, makeBalances: () => ({ balance: async () => ({ known: false }) }),
    convert: ({ amount }, to, date) => { dates.push(date); return { amount }; }, displayCurrency: 'USD', formatAmount });
  assert.ok(dates.includes('2024-03-10') && !dates.includes('2024-03-20'));
});
