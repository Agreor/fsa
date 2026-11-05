import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_KEY, PERSIST_KEY, checkPersistence, lastBackup, recordBackup, safetyNotes,
  storedPersistence } from '../src/safety.js';

const settings = (start = {}) => { const map = new Map(Object.entries(start)); return { map,
  getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) }; };
const at = () => new Date('2026-11-05T10:00:00Z');

test('an already persistent store is granted without asking again', async () => {
  let asked = 0;
  const store = settings();
  const result = await checkPersistence({ storageManager: { persisted: async () => true,
    persist: async () => { asked++; return true; } }, settings: store, now: at });
  assert.deepEqual(result, { status: 'granted', at: '2026-11-05T10:00:00.000Z' });
  assert.equal(asked, 0);
  assert.equal(storedPersistence(store), 'granted');
});

test('the browser can grant, refuse or not support it, and the answer is recorded as given', async () => {
  const ask = (answer) => checkPersistence({ storageManager: { persisted: async () => false,
    persist: async () => answer }, settings: settings(), now: at });
  assert.equal((await ask(true)).status, 'granted');
  assert.equal((await ask(false)).status, 'denied');
  assert.equal((await checkPersistence({ storageManager: undefined, settings: settings(), now: at })).status,
    'unsupported');
  const throwing = { persisted: async () => { throw new Error('no'); }, persist: async () => true };
  assert.equal((await checkPersistence({ storageManager: throwing, settings: settings(), now: at })).status,
    'unsupported');
});

test('unavailable storage never throws; a garbled record reads as unknown', async () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  await checkPersistence({ storageManager: { persist: async () => true }, settings: broken, now: at });
  recordBackup({ settings: broken, now: at });
  assert.equal(lastBackup(broken), null);
  assert.equal(storedPersistence(settings({ [PERSIST_KEY]: '{nope' })), null);
  assert.equal(lastBackup(settings({ [BACKUP_KEY]: 'yesterday' })), null);
});

test('the last backup is remembered; the reminder is due at 30 days, 7 if the browser refused', () => {
  const store = settings();
  recordBackup({ settings: store, now: at });
  assert.equal(lastBackup(store), '2026-11-05T10:00:00.000Z');
  const notes = (days, persistence = 'granted') => safetyNotes({ persistence, lastBackupAt: lastBackup(store),
    now: new Date(Date.parse('2026-11-05T10:00:00Z') + days * 86400000) });
  assert.deepEqual(notes(0), { storage: 'Storage: this browser will keep your data.',
    backup: 'Last backup: 2026-11-05 (0 days ago).', warn: false });
  assert.equal(notes(29).warn, false);
  assert.equal(notes(30).warn, true);
  assert.equal(notes(1).backup, 'Last backup: 2026-11-05 (1 day ago).');
  assert.equal(notes(6, 'denied').warn, false);
  assert.equal(notes(7, 'denied').warn, true);
});

test('no backup yet is always a reminder, and every storage answer has a message', () => {
  const none = safetyNotes({ persistence: 'granted', lastBackupAt: null, now: at() });
  assert.deepEqual(none, { storage: 'Storage: this browser will keep your data.', backup: 'No backup yet.',
    warn: true });
  for (const persistence of ['denied', 'unsupported', null]) {
    assert.match(safetyNotes({ persistence, lastBackupAt: null, now: at() }).storage, /^Storage: /);
  }
});
