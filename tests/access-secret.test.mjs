import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessSecret, ACCESS_SECRET_KEY } from '../src/access-secret.js';

const placeholder = 'placeholder-not-real';

test('get returns null when the value is absent', () => {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  assert.equal(createAccessSecret(storage).get(), null);
});

test('set then get returns the value and another instance sees it', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(createAccessSecret(storage).set(placeholder), true);
  assert.equal(createAccessSecret(storage).get(), placeholder);
});

test('clear removes the stored value', () => {
  const values = new Map([[ACCESS_SECRET_KEY, placeholder]]);
  const access = createAccessSecret({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  access.clear();
  assert.equal(access.get(), null);
});

test('get returns null when storage getItem throws', () => {
  assert.equal(createAccessSecret({ getItem() { throw Error(); } }).get(), null);
});

test('set returns false when storage setItem throws', () => {
  assert.equal(createAccessSecret({ setItem() { throw Error(); } }).set(placeholder), false);
});

test('clear does not throw when storage removeItem throws', () => {
  assert.doesNotThrow(() => createAccessSecret({ removeItem() { throw Error(); } }).clear());
});

test('ACCESS_SECRET_KEY is fsa.access and is the only key touched', () => {
  const calls = [];
  const access = createAccessSecret({
    getItem(key) { calls.push(['get', key]); return null; },
    setItem(key) { calls.push(['set', key]); },
    removeItem(key) { calls.push(['remove', key]); },
  });
  assert.equal(ACCESS_SECRET_KEY, 'fsa.access');
  access.get();
  access.set(placeholder);
  access.clear();
  assert.deepEqual(calls.map((call) => call[1]), Array(3).fill(ACCESS_SECRET_KEY));
});
