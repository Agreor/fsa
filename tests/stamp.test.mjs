import test from 'node:test';
import assert from 'node:assert/strict';
import { stampFor, stampServiceWorker } from '../scripts/stamp.mjs';

test('stamp is order independent and includes paths and exact bytes', () => {
  const a = [{ path: 'a', bytes: Buffer.from('') }, { path: 'a/b', bytes: Buffer.from('x') }];
  assert.equal(stampFor(a), stampFor([...a].reverse()));
  assert.notEqual(stampFor(a), stampFor([{ ...a[0], path: 'b' }, a[1]]));
  assert.notEqual(stampFor(a), stampFor([a[0], { ...a[1], bytes: Buffer.from('y') }]));
  assert.notEqual(stampFor([]), stampFor([{ path: 'x', bytes: Buffer.alloc(0) }]));
});

test('stamp is a fixed value that does not depend on the machine locale', () => {
  const files = [{ path: 'B', bytes: Buffer.from('1') }, { path: 'a', bytes: Buffer.from('2') },
    { path: '\u00e9', bytes: Buffer.from('3') }];
  assert.equal(stampFor(files), 'eb009d1172');
});

test('stamp separates a path from its bytes', () => {
  assert.notEqual(stampFor([{ path: 'ab', bytes: Buffer.from('c') }]),
    stampFor([{ path: 'a', bytes: Buffer.from('bc') }]));
  assert.notEqual(stampFor([{ path: 'a', bytes: Buffer.from('b') }, { path: 'a/b', bytes: Buffer.from('') }]),
    stampFor([{ path: 'a', bytes: Buffer.from('') }, { path: 'a/b', bytes: Buffer.from('b') }]));
});

test('the placeholder is replaced once and anything else is refused', () => {
  const line = "const CACHE = 'fsa-shell-dev';";
  assert.equal(stampServiceWorker(`${line}\nrest`, 'abc'), "const CACHE = 'fsa-shell-abc';\nrest");
  assert.throws(() => stampServiceWorker('const CACHE = "x";', 'abc'));
  assert.throws(() => stampServiceWorker(`${line}\n${line}`, 'abc'));
  assert.throws(() => stampServiceWorker(`  ${line}`, 'abc'));
});
