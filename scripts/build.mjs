// Builds the site into one output folder: the app folder at its root, src/ beside it, and the pinned pdf.js files.
// Usage: node scripts/build.mjs [outDir]   (default: dist)
import fs from "node:fs";
import path from "node:path";
import { stampDirectory, stampServiceWorker } from "./stamp.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.resolve(root, process.argv[2] ?? "dist");
if (out === root || root.startsWith(out + path.sep)) throw new Error(`refusing to build into ${out}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

if (fs.existsSync(path.join(root, "app"))) copy("app", ".");
copy("src", "src");
const lib = "node_modules/pdfjs-dist";
fs.mkdirSync(path.join(out, "vendor/pdfjs"), { recursive: true });
copy(`${lib}/build/pdf.min.mjs`, "vendor/pdfjs/pdf.min.mjs");
copy(`${lib}/build/pdf.worker.min.mjs`, "vendor/pdfjs/pdf.worker.min.mjs");
copy(`${lib}/LICENSE`, "vendor/pdfjs/LICENSE");
// Text recognition for statements that are pictures; loaded only when one is imported.
fs.mkdirSync(path.join(out, "vendor/ocr"), { recursive: true });
copy("node_modules/tesseract.js/dist/tesseract.esm.min.js", "vendor/ocr/tesseract.esm.min.js");
copy("node_modules/tesseract.js/dist/worker.min.js", "vendor/ocr/worker.min.js");
for (const core of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) {
  copy(`node_modules/tesseract.js-core/${core}`, `vendor/ocr/${core}`);
}
copy("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "vendor/ocr/eng.traineddata.gz");
copy("node_modules/tesseract.js/LICENSE.md", "vendor/ocr/LICENSE-tesseract.js.md");
copy("node_modules/tesseract.js-core/LICENSE", "vendor/ocr/LICENSE-tesseract.js-core");
const sw = path.join(out, "sw.js");
if (fs.existsSync(sw)) {
  fs.writeFileSync(sw, stampServiceWorker(fs.readFileSync(sw, "utf8"), stampDirectory(out)));
}
console.log(`built ${out}`);
