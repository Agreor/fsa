import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonths } from '../src/months.js';
import { memoryBackend } from '../src/store.js';
import { UNCATEGORISED } from '../src/categories.js';
import { rowIdentity } from '../src/contracts.js';
import { createTransfers } from '../src/transfers.js';
import { createRecurring, SAVED } from '../src/recurring.js';

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

test('a suggested card payment is left out of the totals and reported as pending', async () => {
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
  assert.equal(march.spending, 0);
  assert.deepEqual(march.pendingSuggestions, { count: 1, amount: 10000 });
  assert.equal(april.spending, 0);
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

test('hasBank is true only when a bank or debit account has rows in the month', async () => {
  const backend = memoryBackend();
  const items = [{ date: '2025-03-05', amount: -500, currency: 'USD', description: 'shop', account: 'card' },
    { date: '2025-04-05', amount: 9000, currency: 'USD', description: 'salary', account: 'bank' }];
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const accounts = { card: { kind: 'credit_card', hints: [] }, bank: { kind: 'bank', hints: [] } };
  const transfers = createTransfers({ backend, accounts });
  const service = createMonths({ backend, accounts, transfers,
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  assert.equal((await service.monthView('2025-03', 'USD')).hasBank, false);
  assert.equal((await service.monthView('2025-04', 'USD')).hasBank, true);
});

test('cash flow counts bank money in and out, skips moves between own accounts, keeps card bills out', async () => {
  const backend = memoryBackend();
  const items = [
    { date: '2025-03-01', amount: 100000, currency: 'USD', description: 'salary', account: 'a' },
    { date: '2025-03-02', amount: -20000, currency: 'USD', description: 'to b', account: 'a' },
    { date: '2025-03-02', amount: 20000, currency: 'USD', description: 'from a', account: 'b' },
    { date: '2025-03-05', amount: -30000, currency: 'USD', description: 'card bill', account: 'a' },
    { date: '2025-03-06', amount: 30000, currency: 'USD', description: 'payment', account: 'c' },
    { date: '2025-03-07', amount: -5000, currency: 'USD', description: 'shop', account: 'c' }];
  await backend.commit(items.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  const id = (i) => rowIdentity(items[i]);
  const records = [{ kind: 'ordinary', state: 'confirmed', legs: [{ rowId: id(1) }, { rowId: id(2) }] },
    { kind: 'card_payment', state: 'confirmed', legs: [{ rowId: id(3) }, { rowId: id(4) }] }];
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'debit_card', hints: [] }, c: { kind: 'credit_card', hints: [] } };
  const service = createMonths({ backend, accounts,
    transfers: { transferRowIds: async () => new Set(records.flatMap((r) => r.legs.map((l) => l.rowId))), listTransfers: async () => records },
    categories: { async categoryOf() { return { category: UNCATEGORISED }; } },
    client: { async convert(value) { return { amount: value.amount }; } } });
  const { cashMovement } = await service.monthView('2025-03', 'USD');
  assert.deepEqual(cashMovement, { in: 100000, out: 30000, net: 70000 }); // salary in; card bill out; the card's own rows never count
});

test('a recurring payment marked saved leaves Spending but stays cash out; a recurring category fills the gap', async () => {
  const items = [row('bank', '2025-03-01', -300000, 'TRF TO OTH BK'), row('bank', '2025-03-01', -85000, 'TRF TO OTH BK'),
    row('bank', '2025-03-01', -8500000, 'TRANSFER'), row('bank', '2025-03-05', 20000000, 'salary')]
    .map((item, index) => ({ ...item, sourceId: `r${index}` })); // distinct ids: two rows share a day and a text
  const { backend, service } = await setup(items, { categoryMap: {} });
  const recurring = createRecurring({ backend });
  await recurring.set(items[0], SAVED);
  await recurring.set(items[2], 'Housing');
  const view = await service.monthView('2025-03', 'USD');
  assert.deepEqual([view.saved, view.spending], [300000, 8585000]); // the 850.00 other transfer is still spending
  assert.deepEqual(view.byCategory.map(({ category }) => category).sort(), ['Housing', UNCATEGORISED]);
  assert.equal(view.cashMovement.out, 8885000); // saved money still left the bank
});

test('the largest charges of a month are spending only, biggest first, at most five', async () => {
  const items = [...[50, 400, 30, 900, 10, 700, 20].map((cents, i) => row('bank', `2025-03-0${i + 1}`, -cents, `shop ${i}`)),
    row('bank', '2025-03-09', -5000, 'moved'), row('bank', '2025-03-10', 90000, 'salary')]
    .map((item, index) => ({ ...item, sourceId: `l${index}` }));
  const { backend, service } = await setup(items);
  await createRecurring({ backend }).set(items[7], SAVED);
  const view = await service.monthView('2025-03', 'USD');
  assert.deepEqual(view.largest.map(({ amount }) => amount), [900, 700, 400, 50, 30]);
});
