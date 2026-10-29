import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createStore } from '../src/store.js';
import { createMonths } from '../src/months.js';
import { createTransfers } from '../src/transfers.js';
import { createCategories } from '../src/categories.js';
import { rowIdentity } from '../src/contracts.js';
import { createMonthData, createActions, monthsWithRows, latestMonth, monthLabel, summaryLines,
  categoryLines, pendingNotice, markChoices, currentChoice } from '../app/month-data.js';

const rows = [
  { date: '2026-03-01', description: 'Salary', amount: 500000, currency: 'EUR',
    account: 'bank', occurrence: 1 },
  { date: '2026-03-02', description: 'Market', amount: -4000, currency: 'EUR',
    account: 'card', occurrence: 1 },
  { date: '2026-03-03', description: 'Refund Market', amount: 1000, currency: 'EUR',
    account: 'card', occurrence: 1 },
  { date: '2026-03-04', description: 'Card payment', amount: 4000, currency: 'EUR',
    account: 'card', occurrence: 1 },
  { date: '2026-03-04', description: 'Card payment', amount: -4000, currency: 'EUR',
    account: 'bank', occurrence: 1 },
];
const accounts = { bank: { kind: 'bank' }, card: { kind: 'credit_card' } };
const format = (amount, currency) => `${amount} ${currency}`;
function setup() {
  const backend = memoryBackend(), store = createStore(backend);
  const makeTransfers = () => createTransfers({ backend, accounts });
  const makeMonths = () => createMonths({ backend, accounts,
    categories: createCategories({ backend }), transfers: makeTransfers(),
    client: { convert: (row) => ({ amount: row.amount }) } });
  const data = createMonthData({ listRows: () => store.listRows(), rowIdentity,
    ensureRates: async () => ({ status: 'nothing' }), makeMonths, makeTransfers,
    listRoles: () => backend.list('role:'), formatAmount: format });
  return { backend, store, data, makeMonths, makeTransfers };
}

test('month helpers validate, deduplicate and order months', () => {
  assert.deepEqual(monthsWithRows([{ date: '2026-01-01' }, { date: '2026-01-31' },
    { date: '2026-02-01' }, { date: '2026-02-30' }]), ['2026-02', '2026-01']);
  assert.equal(latestMonth([{ date: 'bad' }]), null);
  assert.equal(monthLabel('2026-03'), 'March 2026');
  assert.equal(monthLabel('bad'), 'bad');
});

test('summary, categories, notices and marks format the expected choices', () => {
  const view = { currency: 'EUR', income: 100, spending: 20, net: 80, uncategorised: 1,
    cashMovement: { out: 20, in: 100, net: 80 }, byCategory: [{ category: 'Food', amount: 20 }],
    pendingSuggestions: { count: 1, amount: 20 } };
  assert.equal(summaryLines(view, format).length, 7);
  assert.equal(summaryLines({ ...view, income: -100, spending: -20,
    cashMovement: { out: -20, in: -100, net: -80 } }, format)[0].value, '-100 EUR');
  assert.equal(summaryLines({ ...view, income: -100, spending: -20,
    cashMovement: { out: -20, in: -100, net: -80 } }, format)[1].value, '-20 EUR');
  assert.deepEqual(categoryLines(view, format), [{ category: 'Food', value: '20 EUR' }]);
  assert.match(pendingNotice(view), /1 amount is in transfer/);
  assert.equal(pendingNotice({ pendingSuggestions: { count: 0 } }), null);
  assert.match(pendingNotice({ pendingSuggestions: { count: 2 } }), /2 amounts are in transfers/);
  assert.deepEqual(markChoices({ amount: 1 }).map(({ value }) => value),
    ['auto', 'income', 'not_income', 'refund']);
  assert.deepEqual(markChoices({ amount: -1 }), []);
  assert.equal(currentChoice({ role: 'income' }), 'income');
});

test('load summarizes saved rows and role changes without writing', async () => {
  const { backend, store, data, makeMonths, makeTransfers } = setup();
  await store.addBatch('bank', { rows: [rows[0], rows[4]], coverage: null },
    { fileHash: 'one', name: 'one.pdf' });
  await store.addBatch('card', { rows: [rows[1], rows[2], rows[3]], coverage: null },
    { fileHash: 'two', name: 'two.pdf' });
  const before = await backend.list();
  let result = await data.load('missing', 'EUR');
  assert.deepEqual(await backend.list(), before);
  assert.equal(result.month, '2026-03');
  assert.equal(result.view.income, 500000);
  assert.equal(result.view.spending, 3000);
  assert.equal(result.view.cashMovement.out, 4000);
  assert.ok(result.view.byCategory.length);
  await makeMonths().markNotIncome(rowIdentity(rows[0]));
  result = await data.load('2026-03', 'EUR');
  assert.equal(result.view.income, 0);
  assert.deepEqual((await data.load('unknown', 'EUR')).months, ['2026-03']);
  assert.ok((await backend.list('role:')).length);
  assert.notDeepEqual(before, await backend.list());
});

test('suggested card transfers remain counted and flag their rows', async () => {
  const { backend, store, data } = setup();
  const cardPayment = { ...rows[3], date: '2026-04-01' };
  await store.addBatch('bank', { rows: [rows[4]], coverage: null },
    { fileHash: 'bank', name: 'bank.pdf' });
  await store.addBatch('card', { rows: [cardPayment], coverage: null },
    { fileHash: 'card', name: 'card.pdf' });
  const bankId = rowIdentity({ ...rows[4], account: 'bank' });
  const cardId = rowIdentity({ ...cardPayment, account: 'card' });
  await backend.commit([{ key: 'transfer:waiting', value: { id: 'waiting', kind: 'card_payment',
    state: 'suggested', legs: [{ rowId: bankId, account: 'bank', date: rows[4].date,
      amount: rows[4].amount, currency: 'EUR' }, { rowId: cardId, account: 'card',
      date: cardPayment.date, amount: cardPayment.amount, currency: 'EUR' }] } }]);
  const result = await data.load('2026-03', 'EUR');
  assert.equal(result.view.pendingSuggestions.count, 1);
  assert.equal(result.suggested.length, 1);
  assert.ok(result.rows.every((row) => row.isSuggested));
  assert.equal(result.suggested[0].legs[1].description, 'Card payment');
});

test('empty and failed rates loads return the required state', async () => {
  const { data } = setup();
  assert.deepEqual(await data.load(null, 'EUR'), { empty: true, months: [] });
  const failed = createMonthData({ listRows: async () => [rows[0]], rowIdentity,
    ensureRates: async () => ({ status: 'offline' }), makeMonths: () => ({ monthView: async () => ({
      income: 0, spending: 0, net: 0, uncategorised: 0,
      cashMovement: { out: 0, in: 0, net: 0 }, byCategory: [], pendingSuggestions: { count: 0 },
    }) }),
    makeTransfers: () => ({ transferRowIds: async () => new Set(), listTransfers: async () => [] }),
    listRoles: async () => [], formatAmount: format });
  assert.equal((await failed.load(null, 'EUR')).ratesStatus.status, 'offline');
});

test('a refund-only month shows negative spending, a matching category and the refund note',
  async () => {
    const { store, data } = setup();
    await store.addBatch('card', { rows: [{ date: '2026-03-05', description: 'Refund',
      amount: 10000, currency: 'EUR', account: 'card', occurrence: 1 }], coverage: null },
    { fileHash: 'refund', name: 'refund.pdf' });
    const result = await data.load('2026-03', 'EUR');
    assert.equal(result.view.spending, -10000);
    assert.equal(result.summary.find((line) => line.label === 'Spending').value, '-10000 EUR');
    assert.equal(result.summary.find((line) => line.label === 'Net').value, '10000 EUR');
    assert.equal(result.categories[0].value, '-10000 EUR');
    assert.equal(result.spendingNote, 'Refunds are larger than purchases this month.');
  });

test('a refund in a later month than its purchase makes that month negative', async () => {
  const { store, data } = setup();
  const purchase = { ...rows[1], date: '2026-02-05' };
  const refund = { ...rows[2], description: 'Refund', amount: 5000, date: '2026-03-05' };
  await store.addBatch('card', { rows: [purchase, refund], coverage: null },
    { fileHash: 'later-refund', name: 'later.pdf' });
  const result = await data.load('2026-03', 'EUR');
  assert.equal(result.view.spending, -5000);
  assert.equal(result.spendingNote, 'Refunds are larger than purchases this month.');
});

test('ordinary months have no spending note and positive spending', async () => {
  const { store, data } = setup();
  await store.addBatch('card', { rows: [rows[1]], coverage: null },
    { fileHash: 'purchase', name: 'purchase.pdf' });
  const result = await data.load('2026-03', 'EUR');
  assert.equal(result.view.spending, 4000);
  assert.equal(result.spendingNote, null);
});

test('a partial view returns incomplete and the note', async () => {
  const backend = memoryBackend(), store = createStore(backend);
  const thb = { date: '2026-03-02', description: 'Purchase', amount: -350000,
    currency: 'THB', account: 'card', occurrence: 1 };
  await store.addBatch('bank', { rows: [rows[0], thb], coverage: null },
    { fileHash: 'partial', name: 'partial.pdf' });
  const makeMonths = () => createMonths({ backend, accounts, categories: createCategories({ backend }),
    transfers: createTransfers({ backend, accounts }),
    client: { convert: (row) => row.currency === 'THB' ? { unavailable: true }
      : { amount: row.amount } } });
  const data = createMonthData({ listRows: () => store.listRows(), rowIdentity,
    ensureRates: async () => ({ status: 'ok' }), makeMonths,
    makeTransfers: () => createTransfers({ backend, accounts }), listRoles: () => backend.list('role:'),
    formatAmount: format });
  const result = await data.load('2026-03', 'EUR');
  assert.equal(result.incomplete, true);
  assert.equal(result.incompleteNote,
    'Some amounts could not be converted, so these totals are incomplete.');
});

test('a complete view has no incomplete note', async () => {
  const { store, data } = setup();
  await store.addBatch('bank', { rows: [rows[0]], coverage: null },
    { fileHash: 'complete', name: 'complete.pdf' });
  const result = await data.load('2026-03', 'EUR');
  assert.equal(result.incomplete, false);
  assert.equal(result.incompleteNote, null);
});

test('actions: a failing write reports the error and still refreshes', async () => {
  for (const run of [
    (actions) => actions.mark('row', 'income'),
    (actions) => actions.confirm('transfer'),
    (actions) => actions.notTransfer(['row']),
  ]) {
    const reports = [], refreshes = [];
    const fail = async () => { throw new Error('disk full'); };
    const actions = createActions({ makeMonths: () => ({ markIncome: fail }),
      makeTransfers: () => ({ confirmTransfer: fail, markNotTransfer: fail }),
      report: (message) => reports.push(message), refresh: async () => refreshes.push(true) });
    await assert.doesNotReject(run(actions));
    assert.deepEqual(reports, ['Could not save the change: disk full']);
    assert.equal(refreshes.length, 1);
  }
});

test('actions: a partial write in notTransfer still refreshes', async () => {
  let writes = 0, refreshes = 0;
  const reports = [];
  const actions = createActions({ makeMonths: () => ({}), makeTransfers: () => ({
    markNotTransfer: async () => { if (++writes === 2) throw new Error('disk full'); },
  }), report: (message) => reports.push(message), refresh: async () => { refreshes += 1; } });
  await actions.notTransfer(['first', 'second']);
  assert.equal(writes, 2);
  assert.deepEqual(reports, ['Could not save the change: disk full']);
  assert.equal(refreshes, 1);
});

test('actions: a successful action reports nothing and refreshes once', async () => {
  let refreshes = 0;
  const reports = [];
  const actions = createActions({ makeMonths: () => ({ clearRole: async () => {} }),
    makeTransfers: () => ({}), report: (message) => reports.push(message),
    refresh: async () => { refreshes += 1; } });
  await actions.mark('row', 'auto');
  assert.deepEqual(reports, []);
  assert.equal(refreshes, 1);
});

test('actions: mark maps income, not_income, refund and auto', async () => {
  const calls = [];
  const actions = createActions({ makeMonths: () => Object.fromEntries(
    ['markIncome', 'markNotIncome', 'markRefund', 'clearRole'].map((method) =>
      [method, async (...args) => calls.push([method, ...args])])),
  makeTransfers: () => ({}), report: () => {}, refresh: async () => {} });
  await actions.mark('r', 'income'); await actions.mark('r', 'not_income');
  await actions.mark('r', 'refund'); await actions.mark('r', 'auto');
  assert.deepEqual(calls, [['markIncome', 'r'], ['markNotIncome', 'r'],
    ['markRefund', 'r'], ['clearRole', 'r']]);
});
