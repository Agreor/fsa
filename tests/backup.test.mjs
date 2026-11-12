import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, BACKUP_FORMAT, BACKUP_VERSION, SETTING_KEYS } from '../src/backup.js';
import { createStore, memoryBackend } from '../src/store.js';
import { rowIdentity } from '../src/contracts.js';

const fakeStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); }, removeItem: (key) => { data.delete(key); } };
};
const when = () => new Date('2026-03-04T10:00:00Z');
const parsed = (rows) => ({ rows, coverage: { from: '2026-01-01', to: '2026-01-31' },
  balances: [{ currency: 'EUR', asOf: '2026-01-31', amount: 50 }] });
const row = (extra = {}) => ({ date: '2026-01-05', description: 'Alpha', amount: -100, currency: 'EUR',
  account: 'a1', occurrence: 1, ...extra });
const accountsText = JSON.stringify([{ id: 'a1', name: 'One' }, { id: 'a2', name: 'Two' }]);
const filled = async () => {
  const backend = memoryBackend(), store = createStore(backend);
  await store.addBatch('a1', parsed([row(), row({ description: 'Beta', amount: 5 })]),
    { fileHash: 'h1', name: 'one.pdf' });
  await backend.commit([{ key: 'rule:alpha', value: { key: 'alpha', category: 'Other' } },
    { key: 'role:r1', value: { rowId: 'r1', role: 'income' } },
    { key: 'opening:a1|EUR', value: { account: 'a1', currency: 'EUR', date: '2026-01-01', amount: 7 } },
    { key: 'confirm:p1', value: { legs: ['r1', 'r2'], kind: 'pair' } },
    { key: 'notransfer:r2', value: { rowId: 'r2' } },
    { key: 'linecat:r1', value: { rowId: 'r1', category: 'Fees', at: '2026-03-01T00:00:00.000Z' } },
    { key: 'approval:alpha|EUR', value: { key: 'alpha', currency: 'EUR', min: 50, max: 150,
      approvedAt: '2026-03-01T00:00:00.000Z' } },
    { key: 'entry:Fund A|2026-03-31', value: { name: 'Fund A', kind: 'pension', amount: 10,
      currency: 'EUR', asOf: '2026-03-31', payoutAge: null } },
    { key: 'recurring:bk|trf to|300000|THB', value: { key: 'bk|trf to|300000|THB', saved: true } },
    { key: 'transfer:t1', value: { id: 't1', kind: 'pair', state: 'matched', fee: { known: false },
      legs: [{ rowId: 'r1', account: 'a1', date: '2026-01-05', amount: -100, currency: 'EUR' }] } }]);
  const storage = fakeStorage({ 'fsa.accounts': accountsText, 'fsa.currency': 'EUR', 'fsa.access': 'KEEP' });
  return { backend, storage, backup: createBackup({ backend, storage, now: when }) };
};
const sorted = async (backend) => (await backend.entries()).sort((a, b) => (a.key < b.key ? -1 : 1));
const doc = (extra = {}) => JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION,
  createdAt: '2026-03-04T10:00:00.000Z', records: [], settings: {}, ...extra });

test('the export has a dated file name, counts, every record kind and no access secret', async () => {
  const { backup } = await filled();
  const out = await backup.exportBackup();
  assert.equal(out.fileName, 'fsa-backup-2026-03-04.json');
  assert.deepEqual(out.counts, { records: 13, rows: 2, batches: 1, accounts: 2 });
  const parsedOut = JSON.parse(out.text);
  assert.equal(parsedOut.createdAt, '2026-03-04T10:00:00.000Z');
  assert.deepEqual(Object.keys(parsedOut.settings).sort(), [...SETTING_KEYS].sort());
  assert.ok(!out.text.includes('fsa.access') && !out.text.includes('KEEP'));
  const prefixes = ['row:', 'batch:', 'rule:', 'role:', 'opening:', 'confirm:', 'notransfer:', 'transfer:', 'entry:', 'approval:', 'linecat:', 'recurring:'];
  for (const prefix of prefixes) {
    assert.ok(parsedOut.records.some(({ key }) => key.startsWith(prefix)), prefix);
  }
});

test('a backup restores into a fresh browser exactly (round trip)', async () => {
  const { backend, backup, storage } = await filled();
  const { text } = await backup.exportBackup();
  const freshBackend = memoryBackend(), freshStorage = fakeStorage({ 'fsa.access': 'OTHER' });
  const result = await createBackup({ backend: freshBackend, storage: freshStorage }).restore(text);
  assert.deepEqual(result, { ok: true, counts: { records: 13, rows: 2, batches: 1, accounts: 2 } });
  assert.deepEqual(await sorted(freshBackend), await sorted(backend));
  assert.equal(freshStorage.getItem('fsa.accounts'), storage.getItem('fsa.accounts'));
  assert.equal(freshStorage.getItem('fsa.currency'), 'EUR');
  assert.equal(freshStorage.getItem('fsa.access'), 'OTHER');
});

test('restore replaces: extra records go, shared ones are overwritten, settings follow', async () => {
  const { text } = await (await filled()).backup.exportBackup();
  const backend = memoryBackend();
  await backend.commit([{ key: 'rule:alpha', value: { key: 'alpha', category: 'Groceries' } },
    { key: 'rule:extra', value: { key: 'extra', category: 'Fees' } }, { key: 'unknown:x', value: { a: 1 } }]);
  const storage = fakeStorage({ 'fsa.accounts': '[]', 'fsa.currency': 'THB', 'fsa.access': 'KEEP' });
  const trimmed = JSON.parse(text); delete trimmed.settings['fsa.currency'];
  const result = await createBackup({ backend, storage }).restore(JSON.stringify(trimmed));
  assert.equal(result.ok, true);
  assert.equal((await backend.get('rule:alpha')).category, 'Other');
  assert.equal(await backend.get('rule:extra'), undefined);
  assert.equal(await backend.get('unknown:x'), undefined);
  assert.equal(storage.getItem('fsa.currency'), null);
  assert.equal(storage.getItem('fsa.accounts'), accountsText);
  assert.equal(storage.getItem('fsa.access'), 'KEEP');
});

test('inspect gives counts and the date, and never writes', async () => {
  const { backend, backup } = await filled();
  const { text } = await backup.exportBackup();
  const before = await sorted(backend);
  assert.deepEqual(backup.inspect(text), { ok: true, createdAt: '2026-03-04T10:00:00.000Z',
    counts: { records: 13, rows: 2, batches: 1, accounts: 2 } });
  assert.deepEqual(await sorted(backend), before);
});

const bad = [
  ['', 'not a backup file'], ['{', 'not a backup file'], ['[]', 'not a backup file'],
  ['null', 'not a backup file'], [doc({ format: 'other' }), 'not a backup file'],
  [doc({ version: 2 }), 'made by a newer version'], [doc({ version: 99 }), 'made by a newer version'],
  [doc({ version: 0 }), 'damaged backup: '], [doc({ records: {} }), 'damaged backup: '],
  [doc({ records: [5] }), 'damaged backup: '], [doc({ records: [{ key: 'row:a' }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'zzz:a', value: {} }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'rule:a', value: {} }, { key: 'rule:a', value: {} }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'rule:a', value: 'text' }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'row:a', value: { date: '2026-01-01', currency: 'EUR', account: 'a' } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'row:a', value: { date: '2026-01-01', currency: 'EUR', account: 'a',
    amount: 1.5 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:a', value: { account: 'a' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'row:x', value: { date: '2026-01-01', currency: 'EUR', account: 'a', amount: 1,
    occurrence: 1 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'row:wrong', value: { date: '2026-01-01', description: 'x', currency: 'EUR',
    account: 'a', amount: 1, occurrence: 1 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:b', value: { id: 'b', account: 'a', balances: {} } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'batch:other', value: { id: 'b', account: 'a' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:b', value: { id: 'b', account: 'a',
    coverage: { from: 'soon', to: '2026-01-31' } } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:b', value: { id: 'b', account: 'a',
    coverage: { from: '2026-02-01', to: '2026-01-31' } } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:b', value: { id: 'b', account: 'a',
    balances: [{ currency: 'EUR', asOf: '2026-13-40', amount: 1 }] } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'opening:a|EUR', value: { account: 'a', currency: 'EUR', date: 'x',
    amount: 1 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'batch:b', value: { id: 'b', account: 'a', coverage: { from: '2026-01-01' } } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'opening:a|EUR', value: { account: 'a', currency: 'EUR', date: '2026-01-01' } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'opening:a|THB', value: { account: 'a', currency: 'EUR', date: '2026-01-01',
    amount: 1 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'entry:Fund A|2026-03-31', value: { name: 'Fund A', kind: 'stock', amount: 1,
    currency: 'EUR', asOf: '2026-03-31', payoutAge: null } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'entry:Other|2026-03-31', value: { name: 'Fund A', kind: 'pension', amount: 1,
    currency: 'EUR', asOf: '2026-03-31', payoutAge: null } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'entry:Fund A|2026-03-31', value: { name: 'Fund A', kind: 'pension', amount: -5,
    currency: 'EUR', asOf: '2026-03-31', payoutAge: null } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'approval:alpha|EUR', value: { key: 'alpha', currency: 'EUR', min: 200, max: 100,
    approvedAt: '2026-03-01T00:00:00.000Z' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'approval:alpha|THB', value: { key: 'alpha', currency: 'EUR', min: 1, max: 2,
    approvedAt: '2026-03-01T00:00:00.000Z' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'confirm:x', value: { legs: 42 } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'confirm:x', value: { legs: ['only-one'] } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'transfer:x', value: { id: 'x' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'transfer:x', value: { id: 'x', kind: 'pair', state: 'matched', fee: {},
    legs: [{ rowId: 'r', account: 'a', date: '2026-01-05', currency: 'EUR' }] } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'transfer:x', value: { id: 'x', state: 'matched', fee: {}, legs: [] } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'transfer:y', value: { id: 'x', legs: [] } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'transfer:x', value: { id: 'x', legs: [null] } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'transfer:x', value: { id: 'x', legs: [{ account: 'a' }] } }] }),
    'damaged backup: '],
  [doc({ records: [{ key: 'notransfer:x', value: {} }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'role:x', value: { rowId: 'x' } }] }), 'damaged backup: '],
  [doc({ records: [{ key: 'rule:x', value: { key: 'x' } }] }), 'damaged backup: '],
  [doc({ settings: { 'fsa.access': 'x' } }), 'damaged backup: '],
  [doc({ settings: { 'fsa.other': 'x' } }), 'damaged backup: '],
  [doc({ settings: { 'fsa.currency': 5 } }), 'damaged backup: '],
  [doc({ settings: { 'fsa.accounts': '{}' } }), 'damaged backup: '],
  [doc({ settings: { 'fsa.accounts': 'not json' } }), 'damaged backup: '],
  [doc({ settings: [] }), 'damaged backup: '],
];
test('inspect and restore refuse bad files with the stated reason and write nothing', async () => {
  const { backend, backup, storage } = await filled();
  const before = [await sorted(backend), [...storage.data]];
  for (const [source, prefix] of bad) {
    const looked = backup.inspect(source), restored = await backup.restore(source);
    assert.equal(looked.ok, false, source.slice(0, 40));
    assert.ok(looked.reason.startsWith(prefix), `${looked.reason} / ${source.slice(0, 40)}`);
    assert.deepEqual(restored, looked);
  }
  assert.deepEqual([await sorted(backend), [...storage.data]], before);
});

test('an empty backup is valid and an empty database exports cleanly', async () => {
  const backend = memoryBackend(), storage = fakeStorage();
  const backup = createBackup({ backend, storage, now: when });
  const out = await backup.exportBackup();
  assert.deepEqual(out.counts, { records: 0, rows: 0, batches: 0, accounts: 0 });
  assert.equal(backup.inspect(out.text).ok, true);
  assert.equal((await backup.restore(out.text)).ok, true);
  assert.deepEqual(await backend.entries(), []);
});

test('a failing commit reports the reason and leaves records and settings unchanged', async () => {
  const { backend, storage, backup } = await filled();
  const { text } = await backup.exportBackup();
  const before = [await sorted(backend), [...storage.data]];
  const failing = { ...backend, commit: async () => { throw new Error('quota'); } };
  const result = await createBackup({ backend: failing, storage }).restore(text);
  assert.deepEqual(result, { ok: false, reason: 'could not restore: quota' });
  assert.deepEqual([await sorted(backend), [...storage.data]], before);
});

test('repeating a restore gives the same data', async () => {
  const { backend, backup } = await filled();
  const { text } = await backup.exportBackup();
  const once = await sorted(backend);
  await backup.restore(text); await backup.restore(text);
  assert.deepEqual(await sorted(backend), once);
});

test('a settings write that fails leaves records and settings as they were', async () => {
  const { backend, storage, backup } = await filled();
  const { text } = await backup.exportBackup();
  const trimmed = JSON.parse(text); trimmed.records = []; trimmed.settings = { 'fsa.accounts': '[]' };
  const before = [await sorted(backend), [...storage.data]];
  const real = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'fsa.accounts') throw new Error('QuotaExceeded');
    real(key, value);
  };
  const result = await backup.restore(JSON.stringify(trimmed));
  storage.setItem = real;
  assert.deepEqual(result, { ok: false, reason: 'could not restore: QuotaExceeded' });
  assert.deepEqual([await sorted(backend), [...storage.data]], before);
});

test('a commit that fails after the settings were written puts the old settings back', async () => {
  const { backend, storage, backup } = await filled();
  const { text } = await backup.exportBackup();
  const changed = JSON.parse(text); changed.settings = { 'fsa.currency': 'THB' };
  const failing = { ...backend, commit: async () => { throw new Error('quota'); } };
  const result = await createBackup({ backend: failing, storage }).restore(JSON.stringify(changed));
  assert.equal(result.ok, false);
  assert.equal(storage.getItem('fsa.currency'), 'EUR');
  assert.equal(storage.getItem('fsa.accounts'), accountsText);
  assert.equal(storage.getItem('fsa.access'), 'KEEP');
});

test('a correctly keyed row without a batch list is refused', async () => {
  const value = { date: '2026-01-05', description: 'Alpha', amount: -100, currency: 'EUR', account: 'a1',
    occurrence: 1 };
  const records = [{ key: `row:${rowIdentity(value)}`, value }];
  const { backup } = await filled();
  assert.match(backup.inspect(doc({ records })).reason, /^damaged backup: /);
  records[0].value = { ...value, batches: ['b1'] };
  assert.equal(backup.inspect(doc({ records })).ok, true);
  records[0].value = { ...value, batches: [5] };
  assert.equal(backup.inspect(doc({ records })).ok, false);
});
