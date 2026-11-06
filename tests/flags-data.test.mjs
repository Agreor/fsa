import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlags } from '../app/flags-data.js';
import { isUnusual } from '../src/approvals.js';

const accounts = [{ id: 'b1', kind: 'bank' }, { id: 'c1', kind: 'credit_card' },
  { id: 'k1', kind: 'broker' }];
const row = (account, date, amount, description, currency = 'EUR') => ({ account, date, amount, description,
  currency });
const merchantKey = (description) =>
  (description === 'noise' ? null : description.split(' ')[0].toLowerCase());
const rowIdentity = (item) => `${item.account}|${item.date}|${item.amount}|${item.description}`;
const run = (rows, approvals = [], transfers = []) =>
  loadFlags({ rows, approvals, transfers, accounts, rowIdentity, merchantKey, isUnusual });

test('an unapproved merchant is one group: count, range, total, latest description', () => {
  const { newMerchants, outOfRange } = run([row('b1', '2026-01-05', -1000, 'Shop A'),
    row('c1', '2026-03-05', -3000, 'Shop B'), row('b1', '2026-02-01', -2000, 'Shop A'),
    row('b1', '2026-02-02', -500, 'Cafe')]);
  assert.deepEqual(outOfRange, []);
  assert.deepEqual(newMerchants, [
    { key: 'shop', currency: 'EUR', sample: 'Shop B', latest: '2026-03-05', count: 3, min: 1000, max: 3000,
      total: 6000, name: 'Shop B', person: false, charges: [{ date: '2026-01-05', amount: 1000, rowId: 'b1|2026-01-05|-1000|Shop A' },
        { date: '2026-03-05', amount: 3000, rowId: 'c1|2026-03-05|-3000|Shop B' },
        { date: '2026-02-01', amount: 2000, rowId: 'b1|2026-02-01|-2000|Shop A' }] },
    { key: 'cafe', currency: 'EUR', sample: 'Cafe', latest: '2026-02-02', count: 1, min: 500, max: 500,
      total: 500, name: 'Cafe', person: false,
      charges: [{ date: '2026-02-02', amount: 500, rowId: 'b1|2026-02-02|-500|Cafe' }] }]);
});

test('an approved merchant is silent inside its range and flagged outside it, by currency', () => {
  const approvals = [{ key: 'shop', currency: 'EUR', min: 1000, max: 2000 }];
  const { newMerchants, outOfRange } = run([row('b1', '2026-01-05', -1500, 'Shop A'),
    row('b1', '2026-02-05', -2201, 'Shop A'), row('b1', '2026-03-05', -800, 'Shop A'),
    row('b1', '2026-04-05', -1500, 'Shop A', 'THB')], approvals);
  assert.deepEqual(outOfRange.map(({ date, amount }) => [date, amount]), [['2026-03-05', 800],
    ['2026-02-05', 2201]]);
  assert.deepEqual(outOfRange[0], { key: 'shop', currency: 'EUR', date: '2026-03-05', description: 'Shop A',
    amount: 800, min: 1000, max: 2000 });
  assert.deepEqual(newMerchants.map(({ key, currency }) => `${key}|${currency}`), ['shop|THB']);
});

test('credits, brokers, transfer legs and keyless text are left out; a suggested one is no leg', () => {
  const rows = [row('b1', '2026-01-05', 5000, 'Shop A'), row('k1', '2026-01-06', -100, 'Fund'),
    row('b1', '2026-01-07', -900, 'Bill pay'), row('b1', '2026-01-08', -50, 'noise'),
    row('b1', '2026-01-09', -700, 'Sugg')];
  const transfers = [{ state: 'matched', legs: [{ rowId: rowIdentity(rows[2]) }] },
    { state: 'suggested', legs: [{ rowId: rowIdentity(rows[4]) }] }];
  assert.deepEqual(run(rows, [], transfers).newMerchants.map(({ key }) => key), ['sugg']);
});

test('nothing to review gives empty lists', () => {
  assert.deepEqual(run([]), { newMerchants: [], todo: [], silent: [], outOfRange: [] });
});

test('todo has no rule yet, silent has one; a person payment and a ruled merchant are told apart', () => {
  const rows = [row('b1', '2026-01-05', -1000, 'Shop A'), row('b1', '2026-01-06', -500, 'To Ann Lee')];
  const out = loadFlags({ rows, approvals: [], transfers: [], accounts, rowIdentity, merchantKey, isUnusual,
    ruleKeys: new Set(['shop']) });
  assert.deepEqual(out.silent.map(({ key }) => key), ['shop']);
  assert.deepEqual(out.todo.map(({ key, person }) => [key, person]), [['to', true]]);
});

test('a range built from fewer than three charges is never flagged', () => {
  const rows = [row('b1', '2026-03-05', -9000, 'Shop A')];
  const flagged = (count) => run(rows, [{ key: 'shop', currency: 'EUR', min: 1000, max: 1000, count }]).outOfRange;
  assert.equal(flagged(1).length, 0);
  assert.equal(flagged(3).length, 1);
  assert.equal(run(rows, [{ key: 'shop', currency: 'EUR', min: 1000, max: 1000 }]).outOfRange.length, 1);
});

test('prettyName drops processor prefixes and shouting, and cuts long text', async () => {
  const { prettyName } = await import('../app/flags-data.js');
  assert.equal(prettyName('LINEPAY*PF_LINE MAN WO BANGKOK'), 'Pf_line Man Wo Bangkok');
  assert.equal(prettyName('Spotify Stockholm'), 'Spotify Stockholm');
  assert.equal(prettyName('Shop 02/03 33,333.33'), 'Shop');
  assert.ok(prettyName('x'.repeat(80)).length <= 40);
});
