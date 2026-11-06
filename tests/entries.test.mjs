import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntries, entryKey, entryProblem } from '../src/entries.js';
import { memoryBackend } from '../src/store.js';

const good = { name: 'Fund A', kind: 'pension', amount: 123456, currency: 'EUR', asOf: '2026-03-31',
  payoutAge: 65 };

test('adds, lists (by name, newest first) and removes dated entries', async () => {
  const entries = createEntries({ backend: memoryBackend() });
  await entries.add(good);
  await entries.add({ ...good, amount: 130000, asOf: '2026-06-30' });
  await entries.add({ name: ' Policy B ', kind: 'insurance', amount: 5000, currency: 'THB',
    asOf: '2026-01-01' });
  const listed = await entries.list();
  assert.deepEqual(listed.map(({ name, asOf, amount }) => [name, asOf, amount]), [
    ['Fund A', '2026-06-30', 130000], ['Fund A', '2026-03-31', 123456], ['Policy B', '2026-01-01', 5000]]);
  assert.equal(listed[2].payoutAge, null);
  await entries.add({ ...good, amount: 1 });
  assert.equal((await entries.list()).find(({ asOf }) => asOf === '2026-03-31').amount, 1);
  await entries.remove('Fund A', '2026-03-31');
  assert.equal((await entries.list()).length, 2);
});

test('rejects unusable entries and writes nothing', async () => {
  const backend = memoryBackend();
  const entries = createEntries({ backend });
  for (const bad of [{ ...good, name: '' }, { ...good, name: 'a|b' }, { ...good, name: 'x'.repeat(61) },
    { ...good, kind: 'stock' }, { ...good, amount: -1 }, { ...good, amount: 1.5 }, { ...good, amount: NaN },
    { ...good, currency: 'eur' }, { ...good, asOf: '2026-02-30' }, { ...good, asOf: 'x' },
    { ...good, payoutAge: 130 }, { ...good, payoutAge: 6.5 }, null]) {
    await assert.rejects(() => entries.add(bad), TypeError);
  }
  assert.deepEqual(await entries.list(), []);
});

test('entryProblem checks that a stored key matches its content', () => {
  assert.equal(entryProblem(good, entryKey('Fund A', '2026-03-31')), null);
  assert.equal(typeof entryProblem(good, 'entry:Other|2026-03-31'), 'string');
  assert.equal(typeof entryProblem({ ...good, name: ' padded ' }), 'string');
});

test('a second entry with the same name and date but another kind is refused, not overwritten', async () => {
  const entries = createEntries({ backend: memoryBackend() });
  await entries.add(good);
  await assert.rejects(entries.add({ ...good, kind: 'insurance', amount: 1 }), /already a pension/);
  assert.equal((await entries.list()).length, 1);
  await entries.add({ ...good, amount: 999 }); // same kind: a correction, allowed
  assert.equal((await entries.list())[0].amount, 999);
});
