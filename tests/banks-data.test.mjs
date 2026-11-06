import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBanks } from '../app/banks-data.js';

const fmt = (amount, currency) => `${currency} ${amount}`;
function fixture({ month = '2024-02', accounts, rows = [], transfers = [], roles = [],
  missing = [], unavailable = [] }) {
  return loadBanks({ month, accounts, rows, transfers, roles,
    rowIdentity: row => row.id, matchesRefund: description => /refund/i.test(description),
    makeBalances: () => ({ balance: async (id, currency, asOf) => missing.includes(`${id}:${currency}`)
      ? { known: false } : { known: true, amount: 500 } }),
    convert: ({ amount, currency }, target, date) => unavailable.includes(`${currency}:${date}`)
      ? { unavailable: true } : { amount }, displayCurrency: 'USD', formatAmount: fmt });
}
const account = (id, kind = 'bank') => ({ id, name: `Account ${id}`, kind });
const row = (id, accountId, amount, currency = 'USD', date = '2024-02-15', description = 'item') =>
  ({ id, account: accountId, amount, currency, date, description });

test('separates income and spending; card payment is not spending', async () => {
  const result = await fixture({ accounts: [account('a'), account('card', 'credit_card')],
    rows: [row('salary', 'a', 1000, 'USD', undefined, 'salary'), row('buy', 'a', -200),
      row('bill', 'a', -300), row('bill-card', 'card', 300)],
    transfers: [{ kind: 'card_payment', state: 'confirmed', legs: [{ rowId: 'bill' },
      { rowId: 'bill-card' }] }] });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].income, 'USD 1000');
  assert.equal(result.accounts[0].spending, 'USD 200');
  assert.equal(result.accounts[0].cardPayments, 'USD 300');
});

test('ordinary transfer is signed on each bank; suggested transfer falls through', async () => {
  const result = await fixture({ accounts: [account('a'), account('b')],
    rows: [row('out', 'a', -80), row('in', 'b', 80), row('suggested', 'a', 20)],
    transfers: [{ kind: 'transfer', state: 'confirmed', legs: [{ rowId: 'out' },
      { rowId: 'in' }] }, { kind: 'transfer', state: 'suggested', legs: [{ rowId: 'suggested' }] }] });
  assert.equal(result.accounts[0].transfers, 'USD -80');
  assert.equal(result.accounts[1].transfers, 'USD 80');
  assert.equal(result.accounts[0].income, 'USD 20');
});

test('refund signals are ignored unless role forces income', async () => {
  const result = await fixture({ accounts: [account('a')],
    rows: [row('word', 'a', 10, 'USD', undefined, 'refund credit'), row('refund', 'a', 20),
      row('excluded', 'a', 30), row('forced', 'a', 40)], roles: [
      { rowId: 'refund', role: 'refund' }, { rowId: 'excluded', role: 'not_income' },
      { rowId: 'forced', role: 'income' }] });
  assert.equal(result.accounts[0].income, 'USD 40');
});

test('balances, missing rates, empty inputs and leap month ends', async () => {
  const result = await fixture({ accounts: [account('a'), account('card', 'credit_card')],
    rows: [row('usd', 'a', 1), row('eur', 'a', 1, 'EUR'), row('skip', 'a', 5, 'GBP')],
    missing: ['a:EUR'], unavailable: ['GBP:2024-02-15'] });
  assert.deepEqual(result.accounts[0].balances.map(({ currency, value, original, asOf, note }) =>
    ({ currency, value, original, asOf, note })), [
    { currency: 'EUR', value: null, original: undefined, asOf: '2024-02-29', note: 'Opening balance missing' },
    { currency: 'GBP', value: 'USD 500', original: 'GBP 500', asOf: '2024-02-29', note: null },
    { currency: 'USD', value: 'USD 500', original: undefined, asOf: '2024-02-29', note: null }
  ]);
  const noRate = await fixture({ accounts: [account('a')], rows: [row('g', 'a', 1, 'GBP')], unavailable: ['GBP:2024-02-29'] });
  assert.deepEqual([noRate.accounts[0].balances[0].value, noRate.accounts[0].balances[0].note],
    ['GBP 500', 'No rate for GBP on 2024-02-29; shown in GBP']);
  assert.equal(result.accounts[0].partial, true);
  assert.equal(result.accounts[0].note, 'No rate for GBP on 2024-02-15');
  assert.deepEqual(await fixture({ month: null, accounts: [account('a')] }),
    { month: null, accounts: [], totals: null });
  const ordinary = await fixture({ month: '2023-02', accounts: [account('a')],
    rows: [row('old', 'a', 1, 'USD', '2023-02-28')] });
  assert.equal(ordinary.accounts[0].balances[0].asOf, '2023-02-28');
  const leap = await fixture({ accounts: [account('a')], rows: [row('x', 'a', 1)] });
  assert.equal(leap.accounts[0].balances[0].asOf, '2024-02-29');
  assert.deepEqual(leap, await fixture({ accounts: [account('a')], rows: [row('x', 'a', 1)] }));
});

test('empty inputs return zero totals for a listed account', async () => {
  const result = await fixture({ accounts: [account('a')] });
  assert.equal(result.accounts[0].income, 'USD 0');
  assert.deepEqual(await fixture({ accounts: [] }), { month: '2024-02', accounts: [], totals: null });
});
