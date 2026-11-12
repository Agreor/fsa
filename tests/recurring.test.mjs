import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecurring, recurringKey, recurringLookup, recurringProblem, SAVED } from '../src/recurring.js';
import { loadRecurring } from '../app/recurring-data.js';
import { memoryBackend } from '../src/store.js';
import { merchantKey } from '../src/merchant.js';
import { rowIdentity } from '../src/contracts.js';

const row = (date, amount, description = 'TRF TO OTH BK', account = 'bk') => ({ account, date, amount, description, currency: 'THB', sourceId: `${date}${amount}` });

test('a rule matches the same account, text, amount and currency, and only outflows', () => {
  const lookup = recurringLookup([{ key: recurringKey(row('2026-09-01', -500000)), saved: true }]);
  assert.equal(lookup(row('2026-10-01', -500000))?.saved, true);
  assert.equal(lookup(row('2026-10-01', -500100)), undefined); // a changed amount no longer matches
  assert.equal(lookup(row('2026-10-01', 500000)), undefined);
  assert.equal(lookup(row('2026-10-01', -500000, 'TRF TO OTH BK', 'other')), undefined);
});

test('a rule is saved or has a category, never both or neither', async () => {
  const backend = memoryBackend();
  const store = createRecurring({ backend });
  await store.set(row('2026-09-01', -500000), SAVED);
  await store.set(row('2026-09-01', -8500000, 'TRANSFER'), 'Housing');
  const rules = await store.list();
  assert.deepEqual(rules.map(({ saved, category }) => [saved, category]), [[undefined, 'Housing'], [true, undefined]]);
  assert.equal(recurringProblem({ key: 'a|b|1|THB', saved: true, category: 'x' }) !== null, true);
  assert.equal(recurringProblem({ key: 'a|b|1|THB' }) !== null, true);
  await store.remove(rules[1].key);
  assert.equal((await store.list()).length, 1);
});

test('review lists fixed outflows seen in two months, largest first, and hides ruled ones and transfer legs', () => {
  const rows = [row('2026-09-01', -8500000, 'TRANSFER'), row('2026-10-01', -8500000, 'TRANSFER'),
    row('2026-09-01', -300000), row('2026-10-01', -300000), row('2026-10-01', -125, 'TRANSFER'),
    row('2026-09-01', -500000, 'GRAB'), row('2026-10-01', -500000, 'GRAB'), row('2026-09-01', -700000, 'ONCE')];
  const accounts = [{ id: 'bk', name: 'Bangkok Bank', kind: 'bank' }];
  const base = { rows, transfers: [], accounts, rowIdentity, recurringKey, merchantKey };
  const { candidates } = loadRecurring({ ...base, rules: [] });
  assert.deepEqual(candidates.map(({ amount, months }) => [amount, months]), [[8500000, 2], [500000, 2], [300000, 2]]);
  const ruled = loadRecurring({ ...base, rules: [{ key: candidates[0].key, saved: true }] });
  assert.equal(ruled.candidates.length, 2);
  assert.deepEqual([ruled.rules[0].account, ruled.rules[0].amount, ruled.rules[0].currency], ['Bangkok Bank', 8500000, 'THB']);
  const legged = loadRecurring({ ...base, rules: [], transfers: [{ state: 'matched', legs: [{ rowId: rowIdentity(rows[2]) }, { rowId: rowIdentity(rows[3]) }] }] });
  assert.equal(legged.candidates.some(({ amount }) => amount === 300000), false);
});
