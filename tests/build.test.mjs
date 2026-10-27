import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const build = (out) => execFileSync("node", ["scripts/build.mjs", out], { cwd: root, encoding: "utf8" });
const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));

test("the build copies the pinned pdf.js files and the sources", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsa-build-"));
  try {
    build(out);
    for (const file of ["pdf.min.mjs", "pdf.worker.min.mjs", "LICENSE"]) {
      assert.ok(same(path.join(root, "node_modules/pdfjs-dist", file === "LICENSE" ? file : `build/${file}`), path.join(out, "vendor/pdfjs", file)), file);
    }
    assert.ok(same(path.join(root, "src/contracts.js"), path.join(out, "src/contracts.js")));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the build copies the app folder when it exists and tolerates it being absent", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fsa-build-"));
  try {
    build(out);
    const app = path.join(root, "app");
    if (fs.existsSync(app)) for (const f of fs.readdirSync(app)) assert.ok(fs.existsSync(path.join(out, f)), f);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the build refuses to run when the output folder is the repository itself", () => {
  assert.throws(() => build(root));
});

test("the lockfile pins pdf.js to the agreed version", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/pdfjs-dist"].version, "4.10.38");
  assert.ok(lock.packages["node_modules/pdfjs-dist"].integrity.startsWith("sha512-"));
});
