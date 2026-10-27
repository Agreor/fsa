// Slice 1 feature check: the four parts working together on synthetic files. Run it explicitly:
//   node --test tests/feature/slice1.feature.mjs
// It is not named *.test.mjs on purpose, so the default test run skips it until slice 1 is complete.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPdfReader } from "../../src/pdf-reader.js";
import * as s1 from "../../src/sources/s1.js";
import { createStore, memoryBackend } from "../../src/store.js";
import { runImport } from "../../src/import-flow.js";
import { assignOccurrences, validatePages } from "../../src/contracts.js";
import { expected, pages as fixturePages } from "../fixtures/s1-pages.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const lib = path.join(root, "node_modules/pdfjs-dist/build");
const pdfjs = await import(pathToFileURL(path.join(lib, "pdf.min.mjs")));
const workerSrc = pathToFileURL(path.join(lib, "pdf.worker.min.mjs")).href;
const reader = createPdfReader({ pdfjs, workerSrc });
const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(root, "tests/fixtures/pdf", name)));
const fresh = () => createStore(memoryBackend());
const never = async () => null;
const run = (store, name, askPassword = never, accountId = "a1") =>
  runImport({ bytes: fixture(name), name, accountId, source: s1, reader, store, askPassword });

test("a synthetic statement imports through reader, parser and store", async () => {
  const store = fresh();
  const result = await run(store, "synthetic-text.pdf");
  assert.equal(result.status, "imported");
  assert.equal(result.added, 4);
  assert.equal(result.skipped, 0);
  const rows = await store.listRows({ account: "a1" });
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.sourceId]).sort(), expected.rows.map((r) => [r.date, r.amount, r.sourceId]).sort());
  const [batch] = await store.listBatches();
  assert.deepEqual(batch.coverage, expected.coverage);
  assert.deepEqual(batch.balances, expected.balances);
});

test("importing the same file again adds nothing", async () => {
  const store = fresh();
  await run(store, "synthetic-text.pdf");
  const again = await run(store, "synthetic-text.pdf");
  assert.equal(again.status, "duplicate_file");
  assert.equal(again.added, 0);
  assert.equal((await store.listRows({})).length, 4);
  assert.equal((await store.listBatches()).length, 1);
});

test("a password-locked file asks for the password and imports with the right one", async () => {
  const store = fresh();
  const asked = [];
  const result = await run(store, "synthetic-locked.pdf", async (info) => { asked.push(info); return "fixture-pass-1"; });
  assert.equal(result.status, "imported");
  assert.equal(asked.length, 1);
  assert.equal(result.added, 4);
});

test("a wrong password is asked again, then gives up when cancelled, and adds nothing", async () => {
  const store = fresh();
  const answers = ["wrong", null];
  const asked = [];
  const result = await run(store, "synthetic-locked.pdf", async (info) => { asked.push(info); return answers.shift(); });
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "wrong_password");
  assert.equal(asked.length, 2);
  assert.equal(asked[1].wrong, true);
  assert.equal((await store.listRows({})).length, 0);
});

test("cancelling the first password prompt rejects with password_needed", async () => {
  const store = fresh();
  const result = await run(store, "synthetic-locked.pdf", never);
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "password_needed");
  assert.equal((await store.listBatches()).length, 0);
});

for (const [name, code] of [["synthetic-blank.pdf", "no_text"], ["synthetic-garbage.bin", "unreadable"]]) {
  test(`${name} is rejected with ${code} and adds nothing`, async () => {
    const store = fresh();
    const result = await run(store, name);
    assert.equal(result.status, "rejected");
    assert.equal(result.code, code);
    assert.equal((await store.listRows({})).length, 0);
    assert.equal((await store.listBatches()).length, 0);
  });
}

test("text that is not this source's layout is rejected with a reason and adds nothing", async () => {
  const store = fresh();
  const wrongReader = { extractPdf: async () => ({ pages: [{ lines: [{ y: 700, text: "Some other document" }] }] }) };
  const result = await runImport({ bytes: new Uint8Array([1, 2, 3]), name: "x.pdf", accountId: "a1", source: s1, reader: wrongReader, store, askPassword: never });
  assert.equal(result.status, "rejected");
  assert.ok(result.reason);
  assert.equal((await store.listRows({})).length, 0);
});

test("undo removes the batch's rows and its coverage", async () => {
  const store = fresh();
  const { batchId } = await run(store, "synthetic-text.pdf");
  const undone = await store.undoBatch(batchId);
  assert.equal(undone.removed, 4);
  assert.equal((await store.listRows({})).length, 0);
  assert.equal((await store.listBatches()).length, 0);
  const again = await run(store, "synthetic-text.pdf");
  assert.equal(again.status, "imported", "after undo the same file can be imported again");
});

test("two genuine identical charges without a source id both import", async () => {
  const store = fresh();
  const base = { date: "2026-02-01", description: "Shop Beta", amount: -300, currency: "EUR", account: "a1" };
  const parsed = { rows: assignOccurrences([base, base]), coverage: null, balances: [] };
  const result = await store.addBatch("a1", parsed, { fileHash: "h1", name: "one" });
  assert.equal(result.added, 2);
});

test("overlapping exports skip shared rows, and undoing one batch keeps rows another still holds", async () => {
  const store = fresh();
  const mk = (description, amount, sourceId) => ({ date: "2026-02-01", description, amount, currency: "EUR", account: "a1", occurrence: 1, sourceId });
  const x = mk("Shared", -100, "S1");
  const a = await store.addBatch("a1", { rows: [x, mk("Only A", -200, "A1")], coverage: null, balances: [] }, { fileHash: "ha", name: "a" });
  const b = await store.addBatch("a1", { rows: [x, mk("Only B", -300, "B1")], coverage: null, balances: [] }, { fileHash: "hb", name: "b" });
  assert.equal(b.added, 1);
  assert.equal(b.skipped, 1);
  await store.undoBatch(a.batchId);
  const left = (await store.listRows({})).map((r) => r.sourceId).sort();
  assert.deepEqual(left, ["B1", "S1"]);
  await store.undoBatch(b.batchId);
  assert.equal((await store.listRows({})).length, 0);
});

test("a row is kept per account: the same source id in two accounts is two rows", async () => {
  const store = fresh();
  const row = (account) => ({ date: "2026-02-01", description: "X", amount: -1, currency: "EUR", account, occurrence: 1, sourceId: "S1" });
  await store.addBatch("a1", { rows: [row("a1")], coverage: null, balances: [] }, { fileHash: "h1", name: "one" });
  await store.addBatch("a2", { rows: [row("a2")], coverage: null, balances: [] }, { fileHash: "h2", name: "two" });
  assert.equal((await store.listRows({})).length, 2);
});

test("the reader returns the fixture's lines with their column positions", async () => {
  const result = await reader.extractPdf(fixture("synthetic-text.pdf"), never);
  assert.deepEqual(validatePages(result.pages), []);
  const strip = (pages) => pages.map((p) => p.lines.map((l) => ({ text: l.text, x: l.items.map((i) => i.x) })));
  assert.deepEqual(strip(result.pages), strip(fixturePages));
});

test("a row with no source id from a file with no coverage dates is flagged, not silently deduplicated", async () => {
  const store = fresh();
  const row = { date: "2026-03-01", description: "Shop Gamma", amount: -500, currency: "EUR", account: "a1", occurrence: 1 };
  await store.addBatch("a1", { rows: [row], coverage: null, balances: [] }, { fileHash: "h1", name: "one" });
  const second = await store.addBatch("a1", { rows: [row], coverage: null, balances: [] }, { fileHash: "h2", name: "two" });
  assert.equal(second.added, 1);
  assert.equal(second.skipped, 0);
  const rows = await store.listRows({ account: "a1" });
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.possibleDuplicate).length, 1);
});

test("the same row from a file that states its coverage dates is deduplicated", async () => {
  const store = fresh();
  const row = { date: "2026-03-01", description: "Shop Gamma", amount: -500, currency: "EUR", account: "a1", occurrence: 1 };
  const coverage = { from: "2026-03-01", to: "2026-03-31" };
  await store.addBatch("a1", { rows: [row], coverage, balances: [] }, { fileHash: "h1", name: "one" });
  const second = await store.addBatch("a1", { rows: [row], coverage, balances: [] }, { fileHash: "h2", name: "two" });
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await store.listRows({ account: "a1" })).length, 1);
});

test("undo also removes the batch's coverage and balances from every listing", async () => {
  const store = fresh();
  const { batchId } = await run(store, "synthetic-text.pdf");
  await store.undoBatch(batchId);
  assert.deepEqual(await store.listBatches(), []);
});
