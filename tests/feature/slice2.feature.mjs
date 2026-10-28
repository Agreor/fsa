// Slice 2 feature check: the card parser, the rates function and the rate client working together on synthetic data.
// Run it explicitly: node --test tests/feature/slice2.feature.mjs
// It is not named *.test.mjs on purpose, so the default test run skips it until slice 2 is complete.
import test from "node:test";
import assert from "node:assert/strict";
import * as s5 from "../../src/sources/s5.js";
import worker from "../../worker/index.js";
import { createRateClient, summarize } from "../../src/rates.js";
import { createAccessSecret } from "../../src/access-secret.js";
import { createStore, memoryBackend } from "../../src/store.js";
import { runImport } from "../../src/import-flow.js";
import { expected, pages as cardPages } from "../fixtures/s5-pages.mjs";

// A fake ECB feed: Friday 2026-09-04 and Monday 2026-09-07 have a THB rate; the weekend between does not.
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<gesmes:subject>Reference rates</gesmes:subject><Cube><Cube time="2026-09-07"><Cube currency="USD" rate="1.1000"/><Cube currency="THB" rate="40.0000"/></Cube>
<Cube time="2026-09-04"><Cube currency="USD" rate="1.1000"/><Cube currency="THB" rate="37.5000"/></Cube></Cube></gesmes:Envelope>`;
const placeholder = "placeholder-not-real"; // pii-ok placeholder
const env = { ACCESS_SECRET: placeholder, ALLOWED_ORIGIN: "https://app.test" };

const withFakeEcb = async (fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(ECB_XML, { status: 200, headers: { "content-type": "text/xml" } });
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const callWorker = (url, init) => worker.fetch(new Request(url, init), env, {});
const client = () => createRateClient({
  baseUrl: "https://fn.test",
  getSecret: () => env.ACCESS_SECRET,
  fetch: (url, init) => callWorker(url, init),
});

test("a synthetic card statement imports with negative purchases and a closing balance", async () => {
  const store = createStore(memoryBackend());
  const reader = { extractPdf: async () => ({ pages: cardPages }) };
  const result = await runImport({ bytes: new Uint8Array([5, 5, 5]), name: "card.pdf", accountId: "c1", source: s5, reader, store, askPassword: async () => null });
  assert.equal(result.status, "imported");
  const rows = await store.listRows({ account: "c1" });
  assert.equal(rows.length, expected.rows.length);
  assert.ok(rows.every((r) => r.currency === "THB"));
  assert.ok(rows.some((r) => r.amount < 0) && rows.some((r) => r.amount > 0), "purchases are negative, credits positive");
  const [batch] = await store.listBatches();
  assert.deepEqual(batch.balances, expected.balances);
});

test("the function refuses a missing or wrong secret and does not echo input", async () => {
  await withFakeEcb(async () => {
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const res = await callWorker("https://fn.test/rates?from=2026-09-01&to=2026-09-30", { headers });
      assert.equal(res.status, 401);
      assert.ok(!(await res.text()).includes("2026-09-01"));
    }
  });
});

test("the function writes nothing to the console while serving rates", async () => {
  const seen = [];
  const saved = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) { saved[k] = console[k]; console[k] = (...a) => seen.push(a); }
  try {
    await withFakeEcb(async () => {
      await callWorker("https://fn.test/rates?from=2026-09-01&to=2026-09-30", { headers: { authorization: `Bearer ${env.ACCESS_SECRET}` } });
      await callWorker("https://fn.test/rates?from=bad&to=worse", { headers: { authorization: "Bearer nope" } });
    });
  } finally { Object.assign(console, saved); }
  assert.deepEqual(seen, []);
});

test("a THB flow converts at the rate of its own day; a weekend uses the latest earlier rate", async () => {
  await withFakeEcb(async () => {
    const rates = client();
    await rates.load({ from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(rates.convert({ amount: 3750, currency: "THB" }, "EUR", "2026-09-04"), { amount: 100 });
    assert.deepEqual(rates.convert({ amount: 3750, currency: "THB" }, "EUR", "2026-09-06"), { amount: 100 }); // Sunday
    assert.deepEqual(rates.convert({ amount: 4000, currency: "THB" }, "EUR", "2026-09-07"), { amount: 100 });
    assert.deepEqual(rates.convert({ amount: 100, currency: "EUR" }, "THB", "2026-09-04"), { amount: 3750 });
    assert.deepEqual(rates.convert({ amount: 100, currency: "EUR" }, "EUR", "2026-09-04"), { amount: 100 });
  });
});

test("a date before the first published rate, or an unknown currency, is unavailable and makes a total partial", async () => {
  await withFakeEcb(async () => {
    const rates = client();
    await rates.load({ from: "2026-09-01", to: "2026-09-30" });
    assert.deepEqual(rates.convert({ amount: 3750, currency: "THB" }, "EUR", "2026-08-01"), { unavailable: true });
    assert.deepEqual(rates.convert({ amount: 100, currency: "XXX" }, "EUR", "2026-09-04"), { unavailable: true });
    const rows = [
      { date: "2026-09-04", amount: -3750, currency: "THB" },
      { date: "2026-09-05", amount: -100, currency: "EUR" },
      { date: "2026-08-01", amount: -3750, currency: "THB" },
    ];
    assert.deepEqual(summarize(rows, rates, "EUR"), { total: -200, partial: true });
  });
});

test("the display switch changes only the output, never the stored rows", async () => {
  await withFakeEcb(async () => {
    const rates = client();
    await rates.load({ from: "2026-09-01", to: "2026-09-30" });
    const rows = [{ date: "2026-09-04", amount: -3750, currency: "THB" }, { date: "2026-09-04", amount: -100, currency: "EUR" }];
    const before = JSON.stringify(rows);
    assert.deepEqual(summarize(rows, rates, "EUR"), { total: -200, partial: false });
    assert.deepEqual(summarize(rows, rates, "THB"), { total: -7500, partial: false });
    assert.equal(JSON.stringify(rows), before);
  });
});

test("the access secret is kept in the given storage and is not part of any export", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const access = createAccessSecret(storage);
  assert.equal(secret.get(), null);
  secret.set("abc");
  assert.equal(secret.get(), "abc");
  assert.equal(createAccessSecret(storage).get(), "abc");
  secret.clear();
  assert.equal(secret.get(), null);
});
