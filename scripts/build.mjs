// Builds the site into one output folder: the app folder at its root, src/ beside it, and the pinned pdf.js files.
// Usage: node scripts/build.mjs [outDir]   (default: dist)
import fs from "node:fs";
import path from "node:path";

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
console.log(`built ${out}`);
