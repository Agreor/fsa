import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceAt } from '../app/statement-balance.js';

const batches = [{ account: 'a', balances: [{ currency: 'THB', asOf: '2026-08-31', amount: 1000 }, { currency: 'THB', asOf: '2026-10-26', amount: 1500 }] }];
const rows = [{ account: 'a', currency: 'THB', date: '2026-09-10', amount: 300 }, { account: 'a', currency: 'THB', date: '2026-09-20', amount: -200 },
  { account: 'a', currency: 'THB', date: '2026-10-05', amount: 400 }, { account: 'b', currency: 'THB', date: '2026-09-11', amount: 9999 }];
const at = (date, over = {}) => balanceAt({ account: 'a', currency: 'THB', rows, batches, date, ...over });

test('the balance on a date is the statement balance before it plus the rows in between', () => {
  assert.deepEqual(at('2026-08-31'), { amount: 1000, asOf: '2026-08-31' });
  assert.deepEqual(at('2026-09-30'), { amount: 1100, asOf: '2026-09-20' }); // only this account's rows; asOf is the last row, not the date asked
  assert.deepEqual(at('2026-10-31'), { amount: 1500, asOf: '2026-10-26' }); // the later statement point, nothing after it
});

test('before the first statement the balance is worked back from the first one; no statement gives null', () => {
  assert.deepEqual(at('2026-08-15', { rows: [{ account: 'a', currency: 'THB', date: '2026-08-20', amount: 50 }] }), { amount: 950, asOf: '2026-08-15' });
  assert.equal(at('2026-09-30', { batches: [] }), null);
  assert.equal(at('2026-09-30', { batches: [{ account: 'a', balances: [{ currency: 'EUR', asOf: '2026-08-31', amount: 1 }] }] }), null);
});
