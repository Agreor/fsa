import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCards } from '../app/cards-data.js';

const formatAmount = (amount, currency) => `${currency} ${amount}`;
const account = (id, kind = 'credit_card') => ({ id, name: `Card ${id}`, kind });
const row = (id, amount, options = {}) => ({ id, amount, account: 'a', currency: 'USD',
  date: '2024-02-15', description: 'item', ...options });
const run = ({ month = '2024-02', accounts = [account('a')], rows = [], batches = [],
  transfers = [], roles = [], unavailable = [] } = {}) => loadCards({ month, accounts, rows,
  batches, transfers, roles, categoryOf: async item => ({ category: item.category || 'Other' }),
  rowIdentity: item => item.id, convert: ({ amount, currency }, target, date) =>
    unavailable.includes(`${currency}:${date}`) ? { unavailable: true } : { amount },
  displayCurrency: 'USD', formatAmount });

test('groups charges, nets refunds, omits zero categories and sorts by value', async () => {
  const result = await run({ rows: [row('food', -30, { category: 'Food' }),
    row('travel', -20, { category: 'Travel' }), row('refund', 10, { category: 'Food' }),
    row('zero', -5, { category: 'Zero' }), row('zero-refund', 5, { category: 'Zero' })] });
  assert.deepEqual(result.cards[0].categories, [
    { category: 'Food', amount: 20, value: 'USD 20' }, { category: 'Travel', amount: 20, value: 'USD 20' }
  ]);
  assert.equal(result.cards[0].charges, 'USD 40');
});

test('counts card payments only, while suggested transfers and ordinary credits refund', async () => {
  const result = await run({ rows: [row('payment', 100, { category: 'Food' }),
    row('suggested', 20, { category: 'Food' }), row('charge', -150, { category: 'Food' })],
    transfers: [{ kind: 'card_payment', state: 'confirmed', legs: [{ rowId: 'payment' }] },
      { kind: 'card_payment', state: 'suggested', legs: [{ rowId: 'suggested' }] }] });
  assert.deepEqual(result.cards[0].categories, [{ category: 'Food', amount: 130, value: 'USD 130' }]);
  assert.equal(result.cards[0].payments, 'USD 100');
  assert.equal(result.cards[0].charges, 'USD 130');
});

test('ignores not_income credits and reports missing conversion rates', async () => {
  const result = await run({ rows: [row('ignored', 10, { category: 'Food' }),
    row('missing', -3, { currency: 'EUR', date: '2024-02-29' })],
    roles: [{ rowId: 'ignored', role: 'not_income' }], unavailable: ['EUR:2024-02-29'] });
  assert.equal(result.cards[0].partial, true);
  assert.equal(result.cards[0].note, 'No rate for EUR on 2024-02-29');
  assert.deepEqual(result.cards[0].categories, []);
});

test('uses latest statement and subsequent same-currency rows for owed', async () => {
  const result = await run({ rows: [row('on-date', -100, { date: '2024-02-10' }),
    row('later-charge', -5000, { date: '2024-02-11' }),
    row('later-payment', 10000, { date: '2024-02-12' }),
    row('other-currency', -900, { date: '2024-02-13', currency: 'EUR' })], batches: [
    { account: 'a', balances: [{ currency: 'USD', asOf: '2024-02-10', amount: -30000 },
      { currency: 'USD', asOf: '2024-02-09', amount: -1000 }] }
  ] });
  assert.deepEqual(result.cards[0].statement,
    { asOf: '2024-02-10', debt: 'USD 30000', currency: 'USD' });
  assert.equal(result.cards[0].owed, 'USD 25000');
});

test('handles absent statements, empty inputs, month boundaries and repeated calls', async () => {
  const args = { rows: [row('first', -1, { date: '2024-02-01' }),
    row('last', -2, { date: '2024-02-29' }), row('outside', -4, { date: '2024-03-01' })] };
  const result = await run(args);
  assert.equal(result.cards[0].charges, 'USD 3');
  assert.equal(result.cards[0].statement, null);
  assert.equal(result.cards[0].owed, null);
  assert.deepEqual(await run(args), result);
  assert.deepEqual(await run({ month: null, accounts: [account('a')] }), { month: null, cards: [] });
  assert.deepEqual(await run({ accounts: [account('bank', 'bank')], rows: [], batches: [],
    transfers: [] }), { month: '2024-02', cards: [] });
  assert.equal((await run({ accounts: [account('a')], rows: [], batches: [], transfers: [] }))
    .cards[0].charges, 'USD 0');
});

test('keeps cards separate and excludes bank account rows', async () => {
  const result = await run({ accounts: [account('a'), account('b'), account('bank', 'bank')],
    rows: [row('a-charge', -10, { account: 'a' }), row('b-charge', -20, { account: 'b' }),
      row('bank-charge', -999, { account: 'bank' })] });
  assert.deepEqual(result.cards.map(({ id, charges }) => [id, charges]), [
    ['a', 'USD 10'], ['b', 'USD 20']
  ]);
});
