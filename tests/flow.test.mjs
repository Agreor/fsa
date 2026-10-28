import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryBackend, createStore } from '../src/store.js';
import { createTransfers } from '../src/transfers.js';
import { savePreview } from '../src/import-flow.js';
import { createFlow } from '../app/flow.js';

const preview = (hash = 'hash') => ({ parsed: { rows: [] }, fileHash: hash, name: 'file', accountId: 'a' });
test('save reconciles after import and skips duplicate files', async () => {
  const calls = [];
  const store = { addBatch: async () => calls.length ? { duplicateFile: true, added: 0, skipped: 0 }
    : { batchId: 'b', added: 1, skipped: 0 } };
  const flow = createFlow({ store, savePreview, makeTransfers: () => ({
    reconcile: async () => calls.push('reconcile'),
  }) });
  assert.equal((await flow.save(preview())).status, 'imported');
  assert.equal((await flow.save(preview())).status, 'duplicate_file');
  assert.deepEqual(calls, ['reconcile']);
});
test('undo reconciles and reports reconciliation errors after commit', async () => {
  const calls = [];
  const store = { undoBatch: async (id) => { calls.push(id); return { removed: 1 }; } };
  const flow = createFlow({ store, savePreview, makeTransfers: () => ({ reconcile: async () => {} }) });
  assert.deepEqual(await flow.undo('batch'), { removed: 1 });
  const failed = createFlow({ store, savePreview, makeTransfers: () => ({ reconcile: async () => {
    throw new Error('offline');
  } }) });
  assert.deepEqual(await failed.undo('batch'), { removed: 1, reconcileError: 'offline' });
  assert.deepEqual(calls, ['batch', 'batch']);
});
test('save returns committed result when reconciliation throws', async () => {
  const flow = createFlow({ store: { addBatch: async () => ({ batchId: 'b', added: 1, skipped: 0 }) },
    savePreview,
    makeTransfers: () => ({ reconcile: async () => { throw new Error('offline'); } }) });
  assert.deepEqual(await flow.save(preview()), { status: 'imported', batchId: 'b', added: 1,
    skipped: 0, reconcileError: 'offline' });
});
test('import and undo reconcile card payment state', async () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  const accounts = { bank: { kind: 'bank', hints: [], hintsAreEvidence: false },
    card: { kind: 'credit_card', hints: ['alpha'], hintsAreEvidence: true } };
  const flow = createFlow({ store, savePreview,
    makeTransfers: () => createTransfers({ backend, accounts }) });
  const debit = { date: '2026-01-01', description: 'transfer to alpha card', amount: -5000,
    currency: 'USD', account: 'bank', sourceId: 'bank-row', occurrence: 1 };
  const credit = { date: '2026-01-01', description: 'payment thank you', amount: 5000,
    currency: 'USD', account: 'card', sourceId: 'card-row', occurrence: 1 };
  const result = await flow.save({ parsed: { rows: [debit] }, fileHash: 'first', name: 'bank',
    accountId: 'bank' });
  const cardBatch = await flow.save({ parsed: { rows: [credit] }, fileHash: 'second', name: 'card',
    accountId: 'card' });
  const transfers = createTransfers({ backend, accounts });
  assert.equal((await transfers.listTransfers())[0].kind, 'card_payment');
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
  await flow.undo(cardBatch.batchId);
  assert.equal((await transfers.listTransfers())[0].state, 'provisional');
  assert.ok(result.batchId);
});
