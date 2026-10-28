import test from "node:test";
import assert from "node:assert/strict";
import { createBalances } from "../src/balances.js";
import { createStore, memoryBackend } from "../src/store.js";

const row = (date, amount, currency = "EUR", account = "a1") => ({
  date, amount, currency, account, description: "Shop", occurrence: 1,
});
const setup = () => {
  const backend = memoryBackend();
  return { backend, balances: createBalances({ backend }), store: createStore(backend) };
};
const add = (store, rows, more = {}) => store.addBatch("a1", {
  rows, coverage: null, balances: [], ...more,
}, { fileHash: crypto.randomUUID() });

test("opening cutoff ignores opening day and counts following days", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-05", 1000);
  await add(store, [row("2026-01-05", -200), row("2026-01-06", 50)]);
  assert.deepEqual(await balances.balance("a1", "EUR"), {
    known: true, amount: 1050, openingDate: "2026-01-05",
  });
});

test("balance before the opening date is unknown", async () => {
  const { balances } = setup();
  await balances.setOpening("a1", "USD", "2026-01-10", 5000);
  assert.deepEqual(await balances.balance("a1", "USD", "2026-01-05"), { known: false });
  assert.deepEqual(await balances.balance("a1", "USD", "2026-01-10"), {
    known: true, amount: 5000, openingDate: "2026-01-10",
  });
});

test("older history does not change an opening balance", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-05", 1000);
  await add(store, [row("2026-01-04", -500)]);
  assert.equal((await balances.balance("a1", "EUR")).amount, 1000);
});

test("currencies are independent and missing opening is unknown", async () => {
  const { balances } = setup();
  assert.deepEqual(await balances.balance("a1", "EUR"), { known: false });
  await balances.setOpening("a1", "EUR", "2026-01-05", 100);
  await balances.setOpening("a1", "USD", "2026-01-05", 300);
  assert.equal((await balances.balance("a1", "EUR")).amount, 100);
  assert.equal((await balances.balance("a1", "USD")).amount, 300);
});

test("opening replaces idempotently and rejects malformed input", async () => {
  const { balances, backend } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-05", 100);
  await balances.setOpening("a1", "EUR", "2026-01-06", 200);
  assert.deepEqual(await backend.list("opening:"), [{
    account: "a1", currency: "EUR", date: "2026-01-06", amount: 200,
  }]);
  await assert.rejects(balances.setOpening("a1", "EUR", "2026-02-30", 1), TypeError);
  await assert.rejects(balances.setOpening("a1", "EUR", "2026-01-01", 1.5), TypeError);
});

test("statement checks report match, mismatch, and unchecked points", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-05", 100);
  await add(store, [row("2026-01-06", 20)], { balances: [
    { currency: "EUR", asOf: "2026-01-06", amount: 120 },
    { currency: "EUR", asOf: "2026-01-06", amount: 121 },
    { currency: "EUR", asOf: "2026-01-04", amount: 50 },
    { currency: "USD", asOf: "2026-01-06", amount: 5 },
  ] });
  assert.deepEqual((await balances.checkStatements()).map(x => x.status), [
    "match", "mismatch", "unchecked", "unchecked",
  ]);
});

test("statement on the opening date is compared with the opening amount", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "USD", "2026-01-10", 5000);
  await add(store, [row("2026-01-11", 0, "USD")], { balances: [
    { currency: "USD", asOf: "2026-01-10", amount: 5000 },
    { currency: "USD", asOf: "2026-01-10", amount: 4000 },
  ] });
  assert.deepEqual((await balances.checkStatements()).map(({ computed, difference, status }) => ({
    computed, difference, status,
  })), [
    { computed: 5000, difference: 0, status: "match" },
    { computed: 5000, difference: 1000, status: "mismatch" },
  ]);
});

test("undo removes batch statement points and its rows from computed balance", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-05", 100);
  const batch = await add(store, [row("2026-01-06", 20)], {
    balances: [{ currency: "EUR", asOf: "2026-01-06", amount: 120 }],
  });
  assert.equal((await balances.checkStatements()).length, 1);
  await store.undoBatch(batch.batchId);
  assert.equal((await balances.balance("a1", "EUR")).amount, 100);
  assert.deepEqual(await balances.checkStatements(), []);
});

test("coverage merges touching ranges and reports internal gaps", async () => {
  const { balances, store } = setup();
  await add(store, [], { coverage: { from: "2026-01-01", to: "2026-01-03" } });
  await add(store, [], { coverage: { from: "2026-01-04", to: "2026-01-05" } });
  await add(store, [], { coverage: { from: "2026-01-08", to: "2026-01-09" } });
  assert.deepEqual(await balances.coverageGaps("a1"), {
    covered: [{ from: "2026-01-01", to: "2026-01-05" }, { from: "2026-01-08", to: "2026-01-09" }],
    gaps: [{ from: "2026-01-06", to: "2026-01-07" }],
  });
  await store.addBatch("a1", {
    rows: [row("2026-01-10", 1)], coverage: null, balances: [],
  }, { fileHash: "null-coverage" });
  assert.equal((await balances.coverageGaps("a1")).covered.length, 2);
});

test("empty coverage has no gaps and malformed missing batch balances are ignored", async () => {
  const { balances, backend } = setup();
  assert.deepEqual(await balances.coverageGaps("a1"), { covered: [], gaps: [] });
  await backend.commit([{ key: "batch:bad", value: { id: "bad", account: "a1", coverage: null } }]);
  assert.deepEqual(await balances.checkStatements(), []);
});

test("balance computes ten thousand rows in under a second", async () => {
  const { balances, store } = setup();
  await balances.setOpening("a1", "EUR", "2026-01-01", 0);
  const rows = Array.from({ length: 10000 }, (_, index) => ({
    ...row(`2026-01-${String(index % 28 + 2).padStart(2, "0")}`, 1, "EUR"), occurrence: index + 1,
  }));
  await add(store, rows);
  const start = performance.now();
  assert.equal((await balances.balance("a1", "EUR")).amount, 10000);
  assert.ok(performance.now() - start < 1000);
});
