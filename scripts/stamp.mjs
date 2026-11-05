import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function stampFor(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const name = Buffer.from(file.path);
    const bytes = Buffer.from(file.bytes);
    hash.update(`${name.length}:`).update(name).update(`${bytes.length}:`).update(bytes);
  }
  return hash.digest('hex').slice(0, 10);
}

const PLACEHOLDER = /^const CACHE = 'fsa-shell-dev';$/gm;

export function stampServiceWorker(source, stamp) {
  if ([...source.matchAll(PLACEHOLDER)].length !== 1) {
    throw new Error('expected exactly one fsa-shell-dev CACHE placeholder in sw.js');
  }
  return source.replace(PLACEHOLDER, () => `const CACHE = 'fsa-shell-${stamp}';`);
}

// The worker is hashed too, with its own cache-name line put back to the placeholder.
const unstamped = (bytes) => Buffer.from(bytes.toString('utf8')
  .replace(/^const CACHE = 'fsa-shell-(?:dev|[0-9a-f]{10})';$/m, "const CACHE = 'fsa-shell-dev';"));

export function stampDirectory(directory) {
  const files = [];
  const visit = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = path.posix.join(prefix, name);
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) visit(full, rel);
      else if (rel === 'sw.js') files.push({ path: rel, bytes: unstamped(fs.readFileSync(full)) });
      else files.push({ path: rel, bytes: fs.readFileSync(full) });
    }
  };
  visit(directory);
  return stampFor(files);
}
