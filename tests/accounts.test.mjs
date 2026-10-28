import test from 'node:test';
import assert from 'node:assert/strict';
import { addAccount, listAccounts, normaliseAccount, sharedHints,
  transferAccounts } from '../app/accounts.js';
import { createSources, SOURCE_DEFAULTS } from '../app/sources.js';

const storage = () => {
  const values = {};
  globalThis.localStorage = { getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; } };
  return values;
};

test('account kinds migrate and invalid kinds become bank', () => {
  for (const [old, kind] of [['current', 'bank'], ['savings', 'bank'], ['credit', 'credit_card'],
    ['other', 'bank']]) assert.equal(normaliseAccount({ id: 'a', kind: old }).kind, kind);
});
test('hints parse, trim and deduplicate regardless of case', () => {
  assert.deepEqual(normaliseAccount({ hints: ' alpha, beta,ALPHA, ' }).hints, ['alpha', 'beta']);
  assert.deepEqual(normaliseAccount({ hints: [' X ', 'x', 'Y'] }).hints, ['X', 'Y']);
  assert.deepEqual(normaliseAccount({ hints: '' }).hints, []);
  assert.deepEqual(normaliseAccount({}).hints, []);
});
test('corrupt storage and invalid entries are ignored', () => {
  const values = storage();
  values['fsa.accounts'] = '{';
  assert.deepEqual(listAccounts(), []);
  values['fsa.accounts'] = '{}';
  assert.deepEqual(listAccounts(), []);
  values['fsa.accounts'] = JSON.stringify([null, {}, { name: 'missing' }, { id: 'ok', kind: 'cash' }]);
  assert.deepEqual(listAccounts().map(({ id }) => id), ['ok']);
});
test('shared hints fold case, accents and punctuation, not repeats on one account', () => {
  const account = (id, hints) => ({ id, name: id, hints });
  assert.deepEqual(sharedHints([account('a', ['Élite card', 'ÉLITE-card']),
    account('b', ['elite card'])]), [{ hint: 'elite card', accounts: ['a', 'b'] }]);
  assert.deepEqual(sharedHints([account('a', ['alpha', 'ALPHA'])]), []);
  assert.deepEqual(sharedHints([]), []);
});
test('transfer account map contains only matching fields', () => {
  assert.deepEqual(transferAccounts([{ id: 'a', kind: 'bank', hints: ['alpha'],
    hintsAreEvidence: true }]), { a: { kind: 'bank', hints: ['alpha'], hintsAreEvidence: true } });
});
test('source registry resolves known ids and defaults unknown ids', () => {
  const modules = Object.fromEntries(['s1', 's2', 's5'].map((id) => [id, { parse() {} }]));
  const { sourceModule, defaultsFor } = createSources(modules);
  assert.deepEqual(SOURCE_DEFAULTS, {
    s1: { label: 'S1', kind: 'bank' },
    s2: { label: 'S2', kind: 'debit_card' },
    s5: { label: 'S5', kind: 'credit_card' },
  });
  for (const id of ['s1', 's2', 's5']) assert.equal(typeof sourceModule(id).parse, 'function');
  assert.equal(sourceModule('unknown'), undefined);
  assert.equal(sourceModule('constructor'), undefined);
  assert.equal(sourceModule('__proto__'), undefined);
  assert.deepEqual(defaultsFor('unknown'), { kind: 'bank' });
  assert.deepEqual(defaultsFor('s2'), { kind: 'debit_card' });
});
test('addAccount creates a new id each time', () => {
  storage();
  let serial = 0;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true,
    value: { randomUUID: () => `id-${++serial}` } });
  const first = addAccount({ name: 'A', source: 's1' });
  const second = addAccount({ name: 'A', source: 's1' });
  assert.notEqual(first[0].id, second[1].id);
  Object.defineProperty(globalThis, 'crypto', original);
});
