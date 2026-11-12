import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDashboard } from '../app/dashboard-data.js';

const formatAmount = (amount, currency) => `${amount} ${currency}`;
const cash = (inn, out) => ({ in: inn, out, net: inn - out });
const views = {
  '2026-03': { income: 1000, spending: 600, partial: false, cashMovement: cash(1000, 700),
    byCategory: [{ category: 'Food', amount: 400 }, { category: 'Rent', amount: 200 }] },
  '2026-02': { income: 0, spending: 300, partial: false, cashMovement: cash(0, 300), byCategory: [{ category: 'Food', amount: 300 }] },
  '2026-01': { income: 500, spending: 500, partial: true, cashMovement: cash(500, 500), byCategory: [{ category: 'Rent', amount: 500 }] },
  '2025-03': { income: 100, spending: -50, partial: false, cashMovement: cash(100, 150),
    byCategory: [{ category: 'Refunds', amount: -50 }] },
};
const run = (months, extra = {}) => loadDashboard({ months, monthView: async (month) => views[month],
  displayCurrency: 'EUR', formatAmount, ...extra });

test('per-month cash flow, spending and savings rate, including the special cases', async () => {
  const { months } = await run(['2026-03', '2026-02', '2026-01', '2025-03']);
  assert.deepEqual(months.map(({ month, savingsRate, partial }) => [month, savingsRate, partial]), [
    ['2026-03', '30.0%', false], ['2026-02', 'not available', false], ['2026-01', '0.0%', true],
    ['2025-03', '-50.0%', false]]); // 2025-03: 150 out of 100 in
  assert.deepEqual(months[0], { month: '2026-03', incomeAmount: 1000, spendingAmount: 600, income: '1000 EUR', spending: '600 EUR', net: '400 EUR',
    cashInAmount: 1000, cashOutAmount: 700, cashIn: '1000 EUR', cashOut: '700 EUR', cashFlow: '300 EUR',
    savingsRate: '30.0%', partial: false });
});

test('category shares by window sum to exactly 100% and sort by amount', async () => {
  const { windows } = await run(['2026-03', '2026-02', '2026-01']);
  assert.deepEqual(windows[0].categories, [{ category: 'Food', amount: 400, value: '400 EUR', share: '66.7%' },
    { category: 'Rent', amount: 200, value: '200 EUR', share: '33.3%' }]);
  const three = windows[1];
  assert.equal(three.months, 3);
  assert.equal(three.total, '1400 EUR');
  assert.equal(three.partial, true);
  assert.equal(three.otherCredits, null);
  assert.deepEqual(three.categories.map(({ category, share }) => [category, share]),
    [['Food', '50.0%'], ['Rent', '50.0%']]);
  for (const window of windows) {
    const sum = window.categories.reduce((total, { share }) => total + Number.parseFloat(share) * 10, 0);
    assert.equal(Math.round(sum), window.categories.length ? 1000 : 0);
  }
});

test('three equal shares add up to 100.0% by largest remainder', async () => {
  const equal = { income: 0, spending: 3, partial: false, cashMovement: cash(0, 3), byCategory: ['A', 'B', 'C']
    .map((category) => ({ category, amount: 1 })) };
  const { windows } = await loadDashboard({ months: ['2026-03'], monthView: async () => equal,
    displayCurrency: 'EUR', formatAmount });
  assert.deepEqual(windows[0].categories.map(({ share }) => share), ['33.4%', '33.3%', '33.3%']);
});

test('a window counts only months with data; refunds-only categories are left out', async () => {
  const { windows } = await run(['2026-03', '2025-03']);
  assert.equal(windows[2].months, 1);
  const only = await run(['2025-03']);
  assert.deepEqual(only.windows[0].categories, []);
  assert.equal(only.windows[0].total, '0 EUR');
});

test('set-aside is the average surplus of the last months with complete data, never advice', async () => {
  const result = await run(['2026-03', '2026-02', '2026-01']);
  assert.deepEqual(result.setAside, { value: '0 EUR', months: 2, // cash flow 300 and -300
    note: 'Estimate from your imported history, not advice' });
  assert.equal((await run(['2026-01'])).setAside, null);
  assert.equal((await run(['2026-02'])).setAside, null); // complete month, but no income at all
});

test('no months gives an empty dashboard', async () => {
  assert.deepEqual(await run([]), { currency: 'EUR', months: [], windows: [], setAside: null });
});

test('refunds outside any positive category show as other credits', async () => {
  const month = { income: 0, spending: 450, partial: false, cashMovement: cash(0, 450),
    byCategory: [{ category: 'Food', amount: 500 }, { category: 'Uncategorised', amount: -50 }] };
  const { windows } = await loadDashboard({ months: ['2026-03'], monthView: async () => month,
    displayCurrency: 'EUR', formatAmount });
  assert.equal(windows[0].total, '500 EUR');
  assert.equal(windows[0].otherCredits, '-50 EUR');
});
