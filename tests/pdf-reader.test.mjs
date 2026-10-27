import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPdfReader } from "../src/pdf-reader.js";
import { validatePages } from "../src/contracts.js";
import { pages as expected } from "./fixtures/s1-pages.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const lib = path.join(root, "node_modules/pdfjs-dist/build");
const pdfjs = await import(pathToFileURL(path.join(lib, "pdf.min.mjs")));
const reader = createPdfReader({ pdfjs, workerSrc: pathToFileURL(path.join(lib, "pdf.worker.min.mjs")).href });
const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(root, "tests/fixtures/pdf", name)));

test("extracts ordered positioned lines from every page", async () => {
  const result = await reader.extractPdf(fixture("synthetic-text.pdf"));
  assert.deepEqual(result, { pages: expected });
  assert.deepEqual(validatePages(result.pages), []);
});

test("reports no_text only when every page is blank", async () => {
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-blank.pdf")), { error: "no_text" });
});

test("rejects empty, garbage and truncated input", async () => {
  assert.deepEqual(await reader.extractPdf(new Uint8Array()), { error: "unreadable" });
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-garbage.bin")), { error: "unreadable" });
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-text.pdf").slice(0, 200)), { error: "unreadable" });
});

test("asks again after wrong password and opens with a later answer", async () => {
  const asked = [];
  const answers = ["wrong", "fixture-pass-1"];
  const result = await reader.extractPdf(fixture("synthetic-locked.pdf"), async (info) => { asked.push(info); return answers.shift(); });
  assert.deepEqual(asked, [{}, { wrong: true }]);
  assert.deepEqual(result, { pages: expected });
});

test("cancellation returns the last password error and each call starts clean", async () => {
  const asked = [];
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-locked.pdf"), async (info) => { asked.push(info); return null; }), { error: "password_needed" });
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-locked.pdf"), async (info) => { asked.push(info); return asked.length === 2 ? "wrong" : null; }), { error: "wrong_password" });
  assert.deepEqual(asked, [{}, {}, { wrong: true }]);
  assert.deepEqual(await reader.extractPdf(fixture("synthetic-text.pdf")), { pages: expected });
});

test("stops after three password attempts", async () => {
  const asked = [];
  const result = await reader.extractPdf(fixture("synthetic-locked.pdf"), async (info) => { asked.push(info); return "wrong"; });
  assert.deepEqual(asked, [{}, { wrong: true }, { wrong: true }]);
  assert.deepEqual(result, { error: "wrong_password" });
});
