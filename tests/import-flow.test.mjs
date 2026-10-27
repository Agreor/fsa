import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImport, commitImport, runImport } from '../src/import-flow.js';

const parsed = { rows: [{ date: '2026-01-02', description: 'Coffee', amount: -250, currency: 'EUR', account: 'a1', occurrence: 1 }], coverage: null, balances: [] };
function harness({ pages = { pages: [] }, outcome = parsed } = {}) {
  const saved = [];
  const reader = { extractPdf: async (_bytes, askPassword) => { await askPassword?.(); return pages; } };
  const source = { parse: (input, context) => { assert.deepEqual(input, pages.pages); assert.equal(context.account, 'a1'); return outcome; } };
  const store = { addBatch: async (...args) => { saved.push(args); return { batchId: 'b1', added: 1, skipped: 0 }; } };
  return { saved, reader, source, store };
}

test('prepare returns parsed rows and a SHA-256 hash, then commit saves them', async () => {
  const h = harness();
  const ready = await prepareImport({ bytes: new Uint8Array([1, 2]), name: 'x.pdf', accountId: 'a1', source: h.source, reader: h.reader });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.fileHash, 'a12871fee210fb8619291eaea194581cbd2531e4b23759d225f6806923f63222');
  assert.deepEqual(await commitImport({ ...ready, accountId: 'a1', name: 'x.pdf', store: h.store }), { status: 'imported', batchId: 'b1', added: 1, skipped: 0 });
  assert.equal(h.saved.length, 1);
});

test('reader and parser rejection leave the store untouched', async () => {
  const h = harness({ pages: { error: 'unreadable' } });
  assert.deepEqual(await runImport({ bytes: new Uint8Array([1]), name: 'x.pdf', accountId: 'a1', source: h.source, reader: h.reader, store: h.store }), { status: 'rejected', code: 'unreadable' });
  assert.equal(h.saved.length, 0);
  const p = harness({ outcome: { reason: 'not this bank' } });
  assert.deepEqual(await runImport({ bytes: new Uint8Array([1]), name: 'x.pdf', accountId: 'a1', source: p.source, reader: p.reader, store: p.store }), { status: 'rejected', reason: 'not this bank' });
  assert.equal(p.saved.length, 0);
});

test('missing or empty input is rejected without reading or saving', async () => {
  const h = harness();
  h.reader = { extractPdf: async () => { assert.fail('reader must not receive an empty import'); } };
  for (const bytes of [undefined, new Uint8Array()]) {
    const result = await runImport({ bytes, name: 'x.pdf', accountId: 'a1', source: h.source, reader: h.reader, store: h.store });
    assert.equal(result.status, 'rejected');
  }
  assert.equal(h.saved.length, 0);
});

test('duplicate file and password callback are passed through without retention', async () => {
  let called = false;
  const h = harness();
  h.reader = { extractPdf: async (_bytes, askPassword) => { assert.equal(await askPassword({}), 'secret'); called = true; return { pages: [] }; } };
  h.store.addBatch = async () => ({ duplicateFile: true, added: 0, skipped: 1 });
  const result = await runImport({ bytes: new Uint8Array([1]), name: 'x.pdf', accountId: 'a1', source: h.source, reader: h.reader, store: h.store, askPassword: async () => 'secret' });
  assert.deepEqual(result, { status: 'duplicate_file', added: 0, skipped: 1 });
  assert.equal(called, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
