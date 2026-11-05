import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalKey, approvalProblem, createApprovals, isUnusual } from '../src/approvals.js';
import { memoryBackend } from '../src/store.js';

const when = () => new Date('2026-11-05T10:00:00Z');

test('approves, lists (by merchant then currency) and revokes', async () => {
  const approvals = createApprovals({ backend: memoryBackend(), now: when });
  await approvals.approve({ key: 'grab', currency: 'THB', min: 3000, max: 40000 });
  await approvals.approve({ key: 'amazon', currency: 'EUR', min: 1000, max: 5000 });
  await approvals.approve({ key: 'amazon', currency: 'USD', min: 1, max: 1 });
  assert.deepEqual((await approvals.list()).map(({ key, currency }) => `${key}|${currency}`),
    ['amazon|EUR', 'amazon|USD', 'grab|THB']);
  assert.equal((await approvals.list())[0].approvedAt, '2026-11-05T10:00:00.000Z');
  await approvals.approve({ key: 'amazon', currency: 'EUR', min: 500, max: 5000 });
  assert.equal((await approvals.list())[0].min, 500);
  await approvals.revoke('amazon', 'USD');
  assert.equal((await approvals.list()).length, 2);
});

test('rejects unusable approvals and writes nothing', async () => {
  const backend = memoryBackend();
  const approvals = createApprovals({ backend, now: when });
  for (const bad of [{ key: '', currency: 'EUR', min: 1, max: 2 },
    { key: 'a|b', currency: 'EUR', min: 1, max: 2 },
    { key: 'a', currency: 'eur', min: 1, max: 2 }, { key: 'a', currency: 'EUR', min: 0, max: 2 },
    { key: 'a', currency: 'EUR', min: 3, max: 2 }, { key: 'a', currency: 'EUR', min: 1.5, max: 2 },
    { key: 'a', currency: 'EUR', min: 1, max: NaN }, {}]) {
    await assert.rejects(() => approvals.approve(bad), TypeError);
  }
  assert.deepEqual(await approvals.list(), []);
});

test('approvalProblem checks that a stored key matches its content', () => {
  const approval = { key: 'grab', currency: 'THB', min: 1, max: 2, approvedAt: '2026-11-05T10:00:00.000Z' };
  assert.equal(approvalProblem(approval, approvalKey('grab', 'THB')), null);
  assert.equal(typeof approvalProblem(approval, 'approval:grab|EUR'), 'string');
  assert.equal(typeof approvalProblem({ ...approval, approvedAt: 'soon' }), 'string');
  assert.equal(typeof approvalProblem(null), 'string');
});

test('a charge is unusual only beyond the range plus 10 percent', () => {
  const approval = { min: 1000, max: 2000 };
  assert.deepEqual([899, 900, 1500, 2200, 2201].map((amount) => isUnusual(approval, amount)),
    [true, false, false, false, true]);
  assert.equal(isUnusual({ min: 1005, max: 1005 }, 904), false);
  assert.equal(isUnusual({ min: 1005, max: 1005 }, 903), true);
});
