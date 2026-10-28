import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategories, CATEGORIES, UNCATEGORISED } from '../src/categories.js';
import { memoryBackend } from '../src/store.js';

const row = (description, account = 'card', amount = 12, date = '2026-01-02') => ({
  description, account, date, amount, currency: 'USD',
});
const setup = (options = {}) => createCategories({
  backend: memoryBackend(), accountKinds: { card: 'credit_card', bank: 'bank' }, ...options,
});
const letters = (number) => String.fromCharCode(97 + Math.floor(number / 676) % 26,
  97 + Math.floor(number / 26) % 26, 97 + number % 26);

test('categoryOf handles missing rules, existing rules, and null keys', async () => {
  const categories = setup();
  assert.deepEqual(await categories.categoryOf(row('Acme Shop')), {
    category: UNCATEGORISED, via: 'none', key: 'acme shop',
  });
  await categories.correct('acme shop', 'Shopping');
  assert.deepEqual(await categories.categoryOf(row('Acme Shop')), {
    category: 'Shopping', via: 'rule', key: 'acme shop',
  });
  assert.deepEqual(await categories.categoryOf(row('')), {
    category: UNCATEGORISED, via: 'none', key: null,
  });
});

test('categorise keeps order and lists rules once', async () => {
  const backend = memoryBackend();
  let lists = 0;
  const categories = createCategories({ backend: { ...backend, list: async (prefix) => {
    lists++;
    return backend.list(prefix);
  } }, accountKinds: {} });
  const rows = [row('Zulu Shop'), row('Alpha Shop'), row('Zulu Shop')];
  assert.deepEqual(await categories.categorise(rows), rows.map(() => ({
    category: UNCATEGORISED, via: 'none', key: null,
  })).map((result, index) => ({ ...result, key: index === 1 ? 'alpha shop' : 'zulu shop' })));
  assert.equal(lists, 1);
});

test('correct validates, replaces, and forget removes rules; listRules sorts', async () => {
  const categories = setup();
  await categories.correct('zeta', 'Shopping');
  await categories.correct('alpha', 'Groceries');
  await assert.rejects(categories.correct('x', 'Invalid'), (error) => error instanceof TypeError);
  await assert.rejects(categories.correct('  ', 'Shopping'), (error) => error instanceof TypeError);
  await assert.rejects(categories.correct(row(''), 'Shopping'), (error) => error instanceof TypeError);
  await categories.forget('zeta');
  assert.deepEqual((await categories.listRules()).map((rule) => rule.key), ['alpha']);
  assert.ok(CATEGORIES.includes('Groceries'));
});

test('preview filters locally, groups and sorts, and contains only sendable data', async () => {
  const categories = setup();
  await categories.correct('ruled shop', 'Shopping');
  const rows = [row('Alpha Cafe', 'card'), row('Alpha Cafe', 'card'),
    row('Beta Store', 'card'), row('Bank Secret', 'bank'), row('Ruled Shop', 'card'),
    row('', 'card')];
  const first = await categories.preview(rows);
  const second = await categories.preview([...rows]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.skipped, { notSendable: 1, localOnly: 1, ruled: 1 });
  assert.deepEqual(first.items.map(({ text, count }) => ({ text, count })), [
    { text: 'Alpha Cafe', count: 2 }, { text: 'Beta Store', count: 1 },
  ]);
  const json = JSON.stringify(first);
  for (const secret of ['Bank Secret', 'Ruled Shop', 'card', 'USD', '2026-01-02']) {
    assert.equal(json.includes(secret), false);
  }
  assert.notEqual(first.id, (await categories.preview([row('Gamma Cafe', 'card')])).id);
});

test('classification sends only approved preview text and rejects unknown text', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Alpha Cafe', 'card')]);
  let sent;
  const result = await categories.classifyApproved(preview, ['Alpha Cafe', 'private'], async (texts) => {
    sent = texts;
    return { 'Alpha Cafe': 'Eating out' };
  });
  assert.deepEqual(sent, ['Alpha Cafe']);
  assert.deepEqual(result, { sent: 1, saved: 1, retryLater: false, rejected: 1, skipped: 0,
    inFlight: 0 });
});

test('classification skips empty approvals, chunks at 50, and retries failures', async () => {
  const categories = setup();
  let calls = 0;
  assert.deepEqual(await categories.classifyApproved({ items: [] }, [], async () => {
    calls++;
  }), { sent: 0, saved: 0, retryLater: false, rejected: 0, skipped: 0, inFlight: 0,
    unknownPreview: true });
  assert.equal(calls, 0);
  const rows = Array.from({ length: 120 }, (_, index) => row(`${letters(index)} Cafe`, 'card'));
  const preview = await categories.preview(rows);
  let sizes = [];
  const approved = preview.items.map((item) => item.text);
  const result = await categories.classifyApproved(preview, approved, async (texts) => {
    sizes.push(texts.length);
    return Object.fromEntries(texts.map((text) => [text, 'Other']));
  });
  assert.deepEqual(sizes, [50, 50, 20]);
  assert.equal(result.sent, 120);
  const retryPreview = await categories.preview([row('Offline Cafe', 'card')]);
  const retry = await categories.classifyApproved(retryPreview, [retryPreview.items[0].text], async () => {
    throw new Error('offline');
  });
  assert.equal(retry.retryLater, true);
  const stillPending = await categories.preview([row('Offline Cafe', 'card')]);
  assert.deepEqual(stillPending.items, retryPreview.items);
  const recovered = await categories.classifyApproved(stillPending,
    [stillPending.items[0].text], async (texts) =>
      Object.fromEntries(texts.map((text) => [text, 'Other'])));
  assert.equal(recovered.saved, 1);
});

test('classification ignores invalid results and preserves a correction made in flight', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Alpha Cafe', 'card')]);
  await categories.classifyApproved(preview, ['Alpha Cafe'], async () => {
    await categories.correct(row('Alpha Cafe'), 'Shopping');
    return { 'Alpha Cafe': 'Eating out', stranger: 'Health' };
  });
  assert.equal((await categories.categoryOf(row('Alpha Cafe'))).category, 'Shopping');
  const invalidPreview = await categories.preview([row('Beta Cafe', 'card')]);
  const invalid = await categories.classifyApproved(invalidPreview, ['Beta Cafe'], async () => null);
  assert.equal(invalid.retryLater, true);
});

test('overlapping classifications reserve shared text and release it after completion', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Shared Cafe', 'card')]);
  let resolveClassify;
  let started;
  const startedClassify = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const classify = () => {
    calls++;
    started();
    return new Promise((resolve) => { resolveClassify = resolve; });
  };
  const first = categories.classifyApproved(preview, ['Shared Cafe'], classify);
  await startedClassify;
  assert.deepEqual(await categories.classifyApproved(preview, ['Shared Cafe'], classify), {
    sent: 0, saved: 0, retryLater: false, rejected: 0, skipped: 0, inFlight: 1,
  });
  assert.equal(calls, 1);
  resolveClassify({});
  assert.equal((await first).sent, 1);
  assert.equal((await categories.classifyApproved(preview, ['Shared Cafe'], async () => ({
    'Shared Cafe': 'Other',
  }))).sent, 1);
});

test('overlapping reservations allow different and partly shared texts', async () => {
  const categories = setup();
  const preview = await categories.preview(['Shared Cafe', 'First Shop', 'Second Store']
    .map((name) => row(name, 'card')));
  const pending = [];
  const classify = (texts) => new Promise((resolve) => pending.push({ texts, resolve }));
  const first = categories.classifyApproved(preview, ['Shared Cafe', 'First Shop'], classify);
  const second = categories.classifyApproved(preview, ['Shared Cafe', 'Second Store'], classify);
  while (pending.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending.map((call) => call.texts), [
    ['Shared Cafe', 'First Shop'], ['Second Store'],
  ]);
  pending[1].resolve({ 'Second Store': 'Other' });
  pending[0].resolve({ 'Shared Cafe': 'Other', 'First Shop': 'Other' });
  await Promise.all([first, second]);
});

test('a throwing classification releases its reservation for retry', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Retry Cafe', 'card')]);
  const failed = await categories.classifyApproved(preview, ['Retry Cafe'], async () => {
    throw new Error('offline');
  });
  assert.equal(failed.retryLater, true);
  const retry = await categories.classifyApproved(preview, ['Retry Cafe'], async () => ({
    'Retry Cafe': 'Other',
  }));
  assert.equal(retry.saved, 1);
});

test('classification trusts only retained snapshots and ignores caller mutations', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Original Shop', 'card')]);
  preview.items.push({ text: 'Alice account 123456789 amount 500 date 2026-01-02', // pii-ok synthetic
    keys: ['victim shop'], count: 1 });
  let sent;
  await categories.classifyApproved(preview, [preview.items[1].text, 'Original Shop'], async (texts) => {
    sent = texts;
    return { 'Original Shop': 'Shopping' };
  });
  assert.deepEqual(sent, ['Original Shop']);
  assert.equal((await categories.categoryOf(row('Victim Shop'))).via, 'none');
  const forged = await categories.classifyApproved({ id: 'forged' }, ['private'], async () => {
    assert.fail('unknown preview must not call classifier');
  });
  assert.equal(forged.unknownPreview, true);
  const other = await setup().classifyApproved(preview, ['Original Shop'], async () => assert.fail());
  assert.equal(other.unknownPreview, true);
});

test('snapshots isolate returned data, survive in-flight mutation, and evict after twenty one', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Original Shop', 'card')]);
  preview.items[0].keys[0] = 'victim shop';
  preview.items[0].text = 'forged text';
  await categories.classifyApproved(preview, ['Original Shop'], async (texts) => {
    const issued = preview.items[0];
    issued.keys[0] = 'redirected shop';
    return { 'Original Shop': 'Shopping' };
  });
  assert.equal((await categories.categoryOf(row('Original Shop'))).category, 'Shopping');
  assert.equal((await categories.categoryOf(row('Victim Shop'))).via, 'none');
  const first = await categories.preview([row('First Shop', 'card')]);
  for (let index = 0; index < 20; index++) {
    await categories.preview([row(`${letters(index)} Unique Cafe`, 'card')]);
  }
  const evicted = await categories.classifyApproved(first, [first.items[0].text], async () => assert.fail());
  assert.equal(evicted.unknownPreview, true);
});

test('stale previews skip corrected merchants and prototype names never save', async () => {
  const categories = setup();
  const preview = await categories.preview([row('Alice Shop', 'card')]);
  await categories.correct(row('Alice Shop'), 'Shopping');
  let calls = 0;
  const result = await categories.classifyApproved(preview, ['Alice Shop'], async () => {
    calls++;
    return {};
  });
  assert.equal(calls, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.inFlight, 0);
  const names = await categories.preview([row('safe alpha', 'card'), row('safe beta', 'card')]);
  const special = Object.create({ '__proto__': 'Shopping', constructor: 'Shopping' });
  await categories.classifyApproved(names, names.items.map((item) => item.text), async () => special);
  assert.equal((await categories.listRules()).some((rule) => rule.source === 'classifier'), false);
});
