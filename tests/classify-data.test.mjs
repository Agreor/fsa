import test from 'node:test';
import assert from 'node:assert/strict';
import { createClassifyFlow, previewView, resultMessage, NO_SECRET } from '../app/classify-data.js';
import { createCategories } from '../src/categories.js';
import { createClassifierClient } from '../src/classifier.js';
import { createStore, memoryBackend } from '../src/store.js';
import worker from '../worker/index.js';
import { buildRequest } from '../worker/classify.js';

const kinds = { card: 'credit_card', bank: 'bank' };
const row = (account, description, amount, extra = {}) => ({ date: '2026-01-05', description, amount,
  currency: 'EUR', account, occurrence: 1, ...extra });
const setup = async (rows, { classify, secret = true } = {}) => {
  const backend = memoryBackend(), store = createStore(backend);
  for (const [index, batch] of rows.entries()) {
    await store.addBatch(batch.account, { rows: batch.rows, coverage: null },
      { fileHash: `h${index}`, name: 'f' });
  }
  let refreshes = 0;
  const calls = [];
  const classifier = { classify: async (texts) => {
    calls.push(texts);
    return classify(texts, calls.length);
  } };
  const flow = createClassifyFlow({ makeCategories: () => createCategories({ backend, accountKinds: kinds }),
    listRows: () => store.listRows(), classifier, hasSecret: () => secret,
    refresh: async () => { refreshes++; } });
  return { backend, flow, calls, refreshes: () => refreshes };
};
const mixed = [
  { account: 'card', rows: [row('card', 'LIDL 1234 BRUSSELS', -500), row('card', 'UBER TRIP', -300),
    row('card', 'Transfer Alice Example', -900), row('card', 'REFUND SHOP', 700)] },
  { account: 'bank', rows: [row('bank', 'LIDL BANK', -100)] },
];

test('find lists reduced card merchant names and says what stays behind', async () => {
  const { flow } = await setup(mixed, { classify: async () => ({}) });
  const view = await flow.find();
  assert.deepEqual(view.items, [{ text: 'LIDL BRUSSELS', count: 1 }, { text: 'UBER TRIP', count: 1 }]);
  assert.deepEqual(view.notes, ['1 transaction from bank accounts stays on this device.',
    '1 transaction was skipped because the text looks personal.']);
});

test('names that already have a rule are not offered again', async () => {
  const { flow, backend } = await setup(mixed, { classify: async () => ({}) });
  await createCategories({ backend, accountKinds: kinds }).correct({ description: 'UBER TRIP' }, 'Transport');
  const view = await flow.find();
  assert.deepEqual(view.items.map(({ text }) => text), ['LIDL BRUSSELS']);
  assert.ok(view.notes.some((note) => /already has a category/.test(note)));
});

test('send saves confident categories as classifier rules, refreshes and ends the list', async () => {
  const { flow, backend, calls, refreshes } = await setup(mixed, {
    classify: async (texts) => Object.fromEntries(texts.map((text) => [text, 'Groceries'])) });
  await flow.find();
  const out = await flow.send(['LIDL BRUSSELS']);
  assert.deepEqual(calls, [['LIDL BRUSSELS']]);
  assert.equal(out.done, true);
  assert.match(out.message, /^Saved 1 category\./);
  assert.equal(refreshes(), 1);
  const rules = await backend.list('rule:');
  assert.deepEqual(rules.map(({ category, source }) => [category, source]), [['Groceries', 'classifier']]);
  assert.deepEqual(await flow.send(['UBER TRIP']), { message: 'Find merchants first.', done: false });
});

test('names whose data was removed after the list was made are not sent', async () => {
  const backend = memoryBackend(), store = createStore(backend);
  const kept = await store.addBatch('card',
    { rows: [row('card', 'LIDL 1234 BRUSSELS', -500)], coverage: null }, { fileHash: 'a', name: 'a' });
  const undone = await store.addBatch('card',
    { rows: [row('card', 'UBER TRIP', -300)], coverage: null }, { fileHash: 'b', name: 'b' });
  const calls = [];
  const classifier = { classify: async (texts) => {
    calls.push(texts);
    return Object.fromEntries(texts.map((text) => [text, 'Groceries']));
  } };
  const flow = createClassifyFlow({ makeCategories: () => createCategories({ backend, accountKinds: kinds }),
    listRows: () => store.listRows(), classifier, hasSecret: () => true, refresh: async () => {} });
  await flow.find();
  await store.undoBatch(undone.batchId);
  const out = await flow.send(['LIDL BRUSSELS', 'UBER TRIP']);
  assert.deepEqual(calls, [['LIDL BRUSSELS']]);
  assert.match(out.message, /^Saved 1 category/);
  assert.equal(kept.added, 1);
  assert.deepEqual((await backend.list('rule:')).map(({ key }) => key), ['lidl']);

  const second = await store.addBatch('card',
    { rows: [row('card', 'SHELL STATION', -100)], coverage: null }, { fileHash: 'c', name: 'c' });
  await flow.find();
  await store.undoBatch(second.batchId);
  calls.length = 0;
  const gone = await flow.send(['SHELL STATION']);
  assert.deepEqual(calls, []);
  assert.deepEqual(gone, { message: 'This list is out of date. Find merchants again.', done: true });
  assert.equal((await flow.send(['SHELL STATION'])).message, 'Find merchants first.');
});

test('a name that gained a rule since the list was made is not sent again', async () => {
  const { flow, backend, calls } = await setup(mixed, {
    classify: async (texts) => Object.fromEntries(texts.map((text) => [text, 'Fees'])) });
  await flow.find();
  await createCategories({ backend, accountKinds: kinds }).correct({ description: 'UBER TRIP' }, 'Transport');
  const out = await flow.send(['LIDL BRUSSELS', 'UBER TRIP']);
  assert.deepEqual(calls, [['LIDL BRUSSELS']]);
  assert.match(out.message, /^Saved 1 category/);
});

test('a name the classifier is unsure about stays uncategorised and nothing changes', async () => {
  const { flow, backend, refreshes } = await setup(mixed, { classify: async () => ({}) });
  await flow.find();
  const out = await flow.send(['LIDL BRUSSELS', 'UBER TRIP']);
  assert.equal(out.message, 'No name came back with enough confidence, so nothing changed.');
  assert.deepEqual(await backend.list('rule:'), []);
  assert.equal(refreshes(), 0);
});

test('without a secret nothing is sent and the list stays', async () => {
  const { flow, calls } = await setup(mixed, { classify: async () => ({}), secret: false });
  await flow.find();
  assert.deepEqual(await flow.send(['LIDL BRUSSELS']), { message: NO_SECRET, done: false });
  assert.deepEqual(calls, []);
});

test('a failing classifier explains why, keeps the list and a retry works', async () => {
  const failures = { busy: /busy/, offline: /offline/, unauthorized: /rejected/, unavailable: /not set up/,
    bad_request: /refused/, upstream: /did not answer/ };
  for (const [code, pattern] of Object.entries(failures)) {
    let fail = true;
    const { flow, backend } = await setup(mixed, { classify: async (texts) => {
      if (fail) throw Object.assign(new Error(code), { code });
      return Object.fromEntries(texts.map((text) => [text, 'Fees']));
    } });
    await flow.find();
    const first = await flow.send(['LIDL BRUSSELS']);
    assert.equal(first.done, false, code);
    assert.match(first.message, pattern, code);
    assert.deepEqual(await backend.list('rule:'), []);
    fail = false;
    const second = await flow.send(['LIDL BRUSSELS']);
    assert.equal(second.done, true, code);
    assert.match(second.message, /^Saved 1 category/, code);
  }
});

test('a failure without a code is reported as the classifier not answering', async () => {
  const { flow } = await setup(mixed, { classify: async () => { throw new Error('boom'); } });
  await flow.find();
  assert.match((await flow.send(['LIDL BRUSSELS'])).message, /did not answer/);
});

test('names outside the list are refused and cancel forgets the list', async () => {
  const { flow, calls } = await setup(mixed, { classify: async () => ({}) });
  await flow.find();
  const out = await flow.send(['Not In The List']);
  assert.deepEqual(out, { message: 'This list is out of date. Find merchants again.', done: true });
  assert.deepEqual(calls, []);
  await flow.find();
  flow.cancel();
  assert.equal((await flow.send(['LIDL BRUSSELS'])).message, 'Find merchants first.');
  assert.deepEqual(calls, []);
});

test('an empty book gives an empty list', async () => {
  const { flow } = await setup([], { classify: async () => ({}) });
  assert.deepEqual(await flow.find(), { items: [], notes: [] });
});

test('messages are plain for singular and plural', () => {
  assert.equal(previewView({ items: [], skipped: { localOnly: 2, notSendable: 0, ruled: 0 } }).notes[0],
    '2 transactions from bank accounts stay on this device.');
  assert.match(resultMessage({ saved: 3, retryLater: true }, 'busy'), /3 categories were saved first\.$/);
  assert.match(resultMessage({ saved: 1, retryLater: true }, 'busy'), /1 category was saved first\.$/);
  assert.match(resultMessage({ unknownPreview: true }), /out of date/);
});

test('end to end through the real client and the real Worker, only names leave', async () => {
  const placeholder = 'placeholder-not-real';
  const env = { ACCESS_SECRET: placeholder, TYPESAFE_API_KEY: placeholder }; // pii-ok synthetic
  const originalFetch = globalThis.fetch;
  const upstream = [];
  globalThis.fetch = async (url, init) => {
    upstream.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ answers: { q0: { type: 'choice', choice: 'Groceries',
      confidence: 0.95, probabilities: {} }, q1: { type: 'choice', choice: 'Transport', confidence: 0.4,
      probabilities: {} } } }));
  };
  try {
    const backend = memoryBackend(), store = createStore(backend);
    await store.addBatch('card', { rows: mixed[0].rows, coverage: null }, { fileHash: 'e2e', name: 'f' });
    const client = createClassifierClient({ baseUrl: 'https://app.test', getSecret: () => placeholder,
      fetch: (url, init) => worker.fetch(new Request(url, init), env) });
    const flow = createClassifyFlow({
      makeCategories: () => createCategories({ backend, accountKinds: kinds }),
      listRows: () => store.listRows(), classifier: client, hasSecret: () => true, refresh: async () => {} });
    const view = await flow.find();
    const out = await flow.send(view.items.map(({ text }) => text));
    assert.match(out.message, /^Saved 1 category/);
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].url, 'https://api.typesafe.ai/v1/systemone');
    assert.deepEqual(upstream[0].body.state, { merchants: ['LIDL BRUSSELS', 'UBER TRIP'] });
    assert.deepEqual(upstream[0].body, buildRequest(['LIDL BRUSSELS', 'UBER TRIP']));
    const sent = JSON.stringify(upstream[0].body.state);
    for (const leak of ['500', '300', '2026', 'card', 'Alice', 'bank', 'EUR']) {
      assert.ok(!sent.includes(leak), `${leak} must not be sent`);
    }
    assert.deepEqual((await backend.list('rule:')).map(({ category }) => category), ['Groceries']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
