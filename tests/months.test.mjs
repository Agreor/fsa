import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonths } from '../src/months.js';
import { memoryBackend } from '../src/store.js';
import { UNCATEGORISED } from '../src/categories.js';
import { rowIdentity } from '../src/contracts.js';
import { createTransfers } from '../src/transfers.js';

const row = (account, date, amount, description, currency = 'USD') => ({
  account, date, amount, description, currency, sourceId: description,
});
const setup = async (items = [], options = {}) => {
  const backend = memoryBackend();
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const categoryMap = options.categoryMap ?? {};
  const service = createMonths({ backend, accounts: options.accounts ?? { bank: { kind: 'bank' },
    card: { kind: 'credit_card' }, broker: { kind: 'broker' }, cash: { kind: 'cash' } },
    categories: { async categoryOf(value) {
      return { category: categoryMap[value.description] ?? UNCATEGORISED };
    } }, transfers: { async transferRowIds() { return new Set(options.transferIds ?? []); } },
    client: options.client ?? { async convert(value) { return { amount: value.amount }; } },
  });
  return { backend, service };
};

test('month totals classify salary, spending, transfers, broker rows, and refunds', async () => {
  const items = [row('bank', '2025-03-01', 5000, 'salary'),
    row('bank', '2025-03-02', -1200, 'groceries'), row('card', '2025-03-03', -700, 'purchase'),
    row('bank', '2025-03-04', -700, 'card bill'), row('broker', '2025-03-05', 800, 'dividend'),
    row('broker', '2025-03-06', 900, 'sale'), row('card', '2025-03-07', 200, 'purchase refund'),
    row('bank', '2025-03-08', 100, 'Refund from shop')];
  const transferIds = [rowIdentity(items[3])];
  const { service } = await setup(items, { transferIds, categoryMap: { groceries: 'Food',
    purchase: 'Goods', 'purchase refund': 'Goods' } });
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.net], [5000, 1600, 3400]);
  assert.deepEqual(result.byCategory, [{ category: 'Food', amount: 1200 },
    { category: 'Goods', amount: 500 }, { category: UNCATEGORISED, amount: -100 }]);
  assert.equal(result.cashMovement.out, 1900);
  assert.equal(result.uncategorised, 0);
});

test('transfer legs and broker rows do not become income or spending', async () => {
  const items = [row('bank', '2025-01-01', 20, 'transfer'), row('broker', '2025-01-02', -30, 'buy')];
  const { service } = await setup(items, { transferIds: [rowIdentity(items[0])] });
  const result = await service.monthView('2025-01', 'USD');
  assert.equal(result.income + result.spending, 0);
  assert.equal(result.cashMovement.in, 20);
});

test('markIncome on a broker credit counts it as income', async () => {
  const item = row('broker', '2025-03-01', 10000, 'Dividend ACME');
  const { service } = await setup([item]);
  await service.markIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.cashMovement.in], [10000, 0]);
});

test('markNotIncome on a broker credit counts as nothing', async () => {
  const item = row('broker', '2025-03-01', 10000, 'Dividend ACME');
  const { service } = await setup([item]);
  await service.markNotIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.in], [0, 0, 0]);
});

test('markRefund on a broker credit reduces spending', async () => {
  const item = row('broker', '2025-03-01', 10000, 'Dividend ACME');
  const { service } = await setup([item]);
  await service.markRefund(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.equal(result.spending, -10000);
  assert.deepEqual(result.byCategory, [{ category: UNCATEGORISED, amount: -10000 }]);
});

test('an unmarked broker credit stays ignored', async () => {
  const item = row('broker', '2025-03-01', 10000, 'Dividend ACME');
  const { service } = await setup([item]);
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.in], [0, 0, 0]);
});

test('a broker debit stays ignored whatever its role', async () => {
  const item = row('broker', '2025-03-01', -10000, 'Buy ACME');
  for (const role of ['income', 'not_income', 'refund']) {
    const { service } = await setup([item]);
    if (role === 'income') await service.markIncome(rowIdentity(item));
    if (role === 'not_income') await service.markNotIncome(rowIdentity(item));
    if (role === 'refund') await service.markRefund(rowIdentity(item));
    const result = await service.monthView('2025-03', 'USD');
    assert.deepEqual([result.income, result.spending, result.cashMovement.out], [0, 0, 0]);
  }
});

test('markIncome on a transfer-claimed credit counts it as income', async () => {
  const item = row('bank', '2025-03-01', 10000, 'Transfer from savings');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markIncome(rowIdentity(item));
  assert.equal((await service.monthView('2025-03', 'USD')).income, 10000);
});

test('markIncome on a transfer-claimed card credit counts it as income', async () => {
  const item = row('card', '2025-03-01', 10000, 'Payment thank you');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markIncome(rowIdentity(item));
  assert.equal((await service.monthView('2025-03', 'USD')).income, 10000);
});

test('markRefund on a transfer-claimed credit reduces spending', async () => {
  const item = row('bank', '2025-03-01', 10000, 'Transfer from savings');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markRefund(rowIdentity(item));
  assert.equal((await service.monthView('2025-03', 'USD')).spending, -10000);
});

test('markRefund on a transfer-claimed card credit reduces spending', async () => {
  const item = row('card', '2025-03-01', 10000, 'Payment thank you');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markRefund(rowIdentity(item));
  assert.equal((await service.monthView('2025-03', 'USD')).spending, -10000);
});

test('a transfer-claimed card credit with no role stays a transfer', async () => {
  const item = row('card', '2025-03-01', 10000, 'Payment thank you');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.in], [0, 0, 0]);
});

test('a transfer-claimed card debit stays excluded whatever its role', async () => {
  const item = row('card', '2025-03-01', -10000, 'Payment thank you');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending], [0, 0]);
});

test('a card account contributes nothing to cash movement even for a marked credit', async () => {
  const item = row('card', '2025-03-01', 10000, 'Payment thank you');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual(result.cashMovement, { out: 0, in: 0, net: 0 });
});

test(
  'markNotIncome on a transfer-claimed credit leaves income and spending at zero but keeps cash movement',
  async () => {
  const item = row('bank', '2025-03-01', 10000, 'Transfer from savings');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markNotIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.in], [0, 0, 10000]);
});

test('a role never changes a transfer-claimed debit', async () => {
  const item = row('bank', '2025-03-01', -10000, 'Transfer to savings');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  await service.markIncome(rowIdentity(item));
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.out], [0, 0, 10000]);
});

test('a credit with no role stays a transfer', async () => {
  const item = row('bank', '2025-03-01', 10000, 'Transfer from savings');
  const { service } = await setup([item], { transferIds: [rowIdentity(item)] });
  const result = await service.monthView('2025-03', 'USD');
  assert.deepEqual([result.income, result.spending, result.cashMovement.in], [0, 0, 10000]);
});

test('roles replace, clear, and refund links choose purchase category', async () => {
  const items = [row('bank', '2025-02-01', 100, 'salary'),
    row('bank', '2025-02-02', 30, 'purchase refund'), row('bank', '2025-02-03', -80, 'purchase'),
    row('bank', '2025-02-04', 10, 'linked refund')];
  const { backend, service } = await setup(items, { categoryMap: { purchase: 'Food',
    'linked refund': 'Other' } });
  const ids = items.map(rowIdentity);
  await service.markIncome(ids[1]);
  assert.equal((await service.monthView('2025-02', 'USD')).income, 130);
  await service.markNotIncome(ids[0]);
  await service.markRefund(ids[3], ids[2]);
  let result = await service.monthView('2025-02', 'USD');
  assert.equal(result.income, 30);
  assert.equal(result.byCategory[0].category, 'Food');
  await service.clearRole(ids[0]);
  assert.equal((await backend.get(`role:${ids[0]}`)), undefined);
  await service.markIncome(ids[0]);
  await service.markIncome(ids[0]);
  assert.equal((await service.monthView('2025-02', 'USD')).income, 130);
});

test('conversion, partial results, month boundaries, validation, and empty months', async () => {
  const items = [row('bank', '2025-04-01', 1, 'one', 'EUR'),
    row('bank', '2025-04-30', 2, 'last'), row('bank', '2025-04-15', 50, 'missing')];
  const { service } = await setup(items, { client: { async convert(value) {
    if (value.description === 'missing') return { unavailable: true };
    return { amount: value.currency === 'EUR' ? 100 : value.amount };
  } } });
  const result = await service.monthView('2025-04', 'USD');
  assert.equal(result.income, 102);
  assert.equal(result.partial, true);
  assert.equal((await service.monthView('2025-05', 'USD')).partial, false);
  await assert.rejects(service.monthView('2025-13', 'USD'), TypeError);
  await assert.rejects(service.monthView('2025-01', ''), TypeError);
});

test('a suggested card payment stays in the totals and is reported as pending', async () => {
  const items = [row('bank', '2025-03-31', -10000, 'UOB card payment'),
    row('card', '2025-04-01', 10000, 'Payment thank you')];
  const accounts = { bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['uob'] } };
  const backend = memoryBackend();
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const transfers = createTransfers({ backend, accounts });
  await transfers.reconcile();
  const service = createMonths({ backend, accounts, transfers,
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  assert.equal((await transfers.listTransfers())[0].state, 'suggested');
  const march = await service.monthView('2025-03', 'USD');
  const april = await service.monthView('2025-04', 'USD');
  assert.equal(march.spending, 10000);
  assert.deepEqual(march.pendingSuggestions, { count: 1, amount: 10000 });
  assert.equal(april.spending, -10000);
  assert.deepEqual(april.pendingSuggestions, { count: 1, amount: 10000 });
});

test('setting hintsAreEvidence on the card makes the same pair matched and nothing pending', async () => {
  const items = [row('bank', '2025-03-31', -10000, 'UOB card payment'),
    row('card', '2025-04-01', 10000, 'Payment thank you')];
  const accounts = { bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['uob'], hintsAreEvidence: true } };
  const backend = memoryBackend();
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const transfers = createTransfers({ backend, accounts });
  await transfers.reconcile();
  const service = createMonths({ backend, accounts, transfers,
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
  for (const month of ['2025-03', '2025-04']) {
    assert.deepEqual((await service.monthView(month, 'USD')).pendingSuggestions,
      { count: 0, amount: 0 });
  }
});

test('a marked row is not pending', async () => {
  const items = [row('bank', '2025-03-31', -10000, 'UOB card payment'),
    row('card', '2025-04-01', 10000, 'Payment thank you')];
  const accounts = { bank: { kind: 'bank', hints: [] }, card: { kind: 'credit_card', hints: ['uob'] } };
  const backend = memoryBackend();
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const transfers = createTransfers({ backend, accounts });
  await transfers.reconcile();
  const service = createMonths({ backend, accounts, transfers,
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  await service.markIncome(rowIdentity(items[1]));
  assert.deepEqual((await service.monthView('2025-04', 'USD')).pendingSuggestions,
    { count: 0, amount: 0 });
});

test('no listTransfers means nothing pending', async () => {
  const { service } = await setup([row('bank', '2025-03-01', 10, 'salary')]);
  assert.deepEqual((await service.monthView('2025-03', 'USD')).pendingSuggestions,
    { count: 0, amount: 0 });
});

test('a suggested pair outside the month is not pending', async () => {
  const items = [row('bank', '2025-03-31', -10000, 'UOB card payment'),
    row('card', '2025-04-01', 10000, 'Payment thank you')];
  const accounts = { bank: { kind: 'bank', hints: [] }, card: { kind: 'credit_card', hints: ['uob'] } };
  const backend = memoryBackend();
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const transfers = createTransfers({ backend, accounts });
  await transfers.reconcile();
  const service = createMonths({ backend, accounts, transfers,
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  assert.deepEqual((await service.monthView('2025-05', 'USD')).pendingSuggestions,
    { count: 0, amount: 0 });
});

test('unknown accounts are ignored and 5,000 rows finish promptly', async () => {
  const items = Array.from({ length: 5000 }, (_, index) => row('bank',
    '2025-06-01', 1, `row ${index}`));
  items.push(row('unknown', '2025-06-01', 500, 'ignored'));
  const { service } = await setup(items);
  const start = performance.now();
  const result = await service.monthView('2025-06', 'USD');
  assert.equal(result.income, 5000);
  assert.ok(performance.now() - start < 1000);
});
