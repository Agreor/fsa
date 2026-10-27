import test from "node:test";
import assert from "node:assert/strict";
import { createStore, memoryBackend, indexedDbBackend } from "../src/store.js";

const row = (over = {}) => ({ date: "2026-01-05", description: "Shop A", amount: -1250, currency: "EUR", account: "a1", occurrence: 1, ...over });
const parsed = (rows = [row()], more = {}) => ({ rows, coverage: null, balances: [], ...more });
const store = () => createStore(memoryBackend());

test("adds rows and batch metadata, then undo removes both", async () => {
  const s = store();
  const result = await s.addBatch("a1", parsed(), { fileHash: "h1", name: "one" });
  assert.deepEqual([result.added, result.skipped], [1, 0]);
  assert.equal((await s.listBatches())[0].fileHash, "h1");
  assert.deepEqual(await s.undoBatch(result.batchId), { removed: 1 });
  assert.deepEqual(await s.listRows({}), []);
  assert.deepEqual(await s.listBatches(), []);
});

test("deduplicates shared rows, tracks file duplicates per account, and serializes adds", async () => {
  const s = store(), x = row({ sourceId: "S1" });
  const [a, b] = await Promise.all([
    s.addBatch("a1", parsed([x]), { fileHash: "h", name: "a" }),
    s.addBatch("a1", parsed([x]), { fileHash: "h2", name: "b" }),
  ]);
  assert.equal(b.skipped, 1);
  assert.deepEqual(await s.addBatch("a1", parsed([x]), { fileHash: "h", name: "again" }), { duplicateFile: true, added: 0, skipped: 0 });
  await s.undoBatch(a.batchId);
  assert.equal((await s.listRows({})).length, 1);
  assert.equal((await s.addBatch("a2", parsed([row({ account: "a2", sourceId: "S1" })]), { fileHash: "h", name: "other" })).added, 1);
});

test("flags no-coverage possible duplicates and rejects invalid input", async () => {
  const s = store(), x = row();
  await s.addBatch("a1", parsed([x]), { fileHash: "h1", name: "one" });
  const r = await s.addBatch("a1", parsed([row({ occurrence: 2, description: " shop  a " })]), { fileHash: "h2", name: "two" });
  assert.equal(r.added, 1);
  assert.equal((await s.listRows({})).filter(x => x.possibleDuplicate).length, 1);
  await assert.rejects(s.addBatch("a1", parsed([]), { fileHash: "h3", name: "empty" }), /rows/);
  assert.equal((await s.listBatches()).length, 2);
});

test("failed commits and repeated undo leave state intact", async () => {
  let fail = false;
  const base = memoryBackend();
  const backend = { ...base, commit: async (...args) => { if (fail) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } return base.commit(...args); } };
  const s = createStore(backend);
  const a = await s.addBatch("a1", parsed(), { fileHash: "h1", name: "one" });
  fail = true;
  await assert.rejects(s.addBatch("a1", parsed([row({ sourceId: "S2" })]), { fileHash: "h2", name: "two" }), { name: "QuotaExceededError" });
  assert.equal((await s.listRows({})).length, 1);
  fail = false;
  assert.deepEqual(await s.undoBatch(a.batchId), { removed: 1 });
  assert.deepEqual(await s.undoBatch(a.batchId), { removed: 0 });
});

test("indexedDB returns values and deduplicates an overlapping sourceId", async () => {
  const records = new Map();
  const factory = { open() {
    const request = {};
    queueMicrotask(() => { request.result = { createObjectStore() {}, transaction(_name, mode) {
      const tx = { error: null, objectStore() { return {
        get(key) { const r = {}; queueMicrotask(() => { r.result = records.has(key) ? { key, value: records.get(key) } : undefined; r.onsuccess?.(); }); return r; },
        getAll() { const r = {}; queueMicrotask(() => { r.result = [...records].map(([key, value]) => ({ key, value })); r.onsuccess?.(); }); return r; },
        put(value, key) { records.set(key, value.value); }, delete(key) { records.delete(key); },
      }; } };
      queueMicrotask(() => tx.oncomplete?.()); return tx;
    } }; request.onsuccess?.(); });
    return request;
  } };
  const s = createStore(indexedDbBackend("test", factory)), x = row({ sourceId: "idb-source" });
  const first = await s.addBatch("a1", parsed([x]), { fileHash: "idb1", name: "one" });
  const second = await s.addBatch("a1", parsed([x]), { fileHash: "idb2", name: "two" });
  assert.equal(second.skipped, 1);
  assert.equal((await s.listRows({})).length, 1);
  assert.equal((await s.undoBatch(second.batchId)).removed, 0);
  assert.equal((await s.listBatches()).length, 1);
  assert.equal(first.added, 1);
});

test("occurrences allocated in one batch include earlier pending rows", async () => {
  const s = store();
  await s.addBatch("a1", parsed([row({ amount: -250 })]), { fileHash: "occ1", name: "one" });
  await s.addBatch("a1", parsed([row({ amount: -250, occurrence: 1 }), row({ amount: -250, occurrence: 2 })]), { fileHash: "occ2", name: "two" });
  assert.equal((await s.listRows({})).length, 3);
});

test("separate stores over one backend serialize shared-row ownership", async () => {
  const backend = memoryBackend(), a = createStore(backend), b = createStore(backend), x = row({ sourceId: "shared" });
  const [one, two] = await Promise.all([
    a.addBatch("a1", parsed([x]), { fileHash: "shared1", name: "one" }),
    b.addBatch("a1", parsed([x]), { fileHash: "shared2", name: "two" }),
  ]);
  await b.undoBatch(two.batchId);
  assert.equal((await a.listRows({})).length, 1);
  assert.equal((await a.listBatches()).some(batch => batch.id === one.batchId), true);
});
