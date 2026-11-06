import { rowIdentity } from './contracts.js';
import { entryProblem } from './entries.js';
import { approvalProblem } from './approvals.js';

export const BACKUP_FORMAT = 'fsa-backup';
export const BACKUP_VERSION = 1;
export const SETTING_KEYS = ['fsa.accounts', 'fsa.currency'];
const PREFIXES = ['row:', 'batch:', 'transfer:', 'notransfer:', 'confirm:', 'role:', 'rule:', 'opening:',
  'entry:', 'approval:', 'linecat:'];
const known = (key) => PREFIXES.some((prefix) => key.startsWith(prefix));
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string';
const isoDate = (value) => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const damaged = (detail) => ({ reason: `damaged backup: ${detail}` });
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function accountCount(raw) {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}
function countsOf(records, settings) {
  const withPrefix = (prefix) => records.filter(({ key }) => key.startsWith(prefix)).length;
  return { records: records.length, rows: withPrefix('row:'), batches: withPrefix('batch:'),
    accounts: accountCount(settings['fsa.accounts']) };
}

function recordProblem(record, seen) {
  if (!plain(record) || !text(record.key) || !('value' in record)) return 'a record is not { key, value }';
  if (!known(record.key)) return 'a record has an unknown key prefix';
  if (seen.has(record.key)) return 'a key appears twice';
  seen.add(record.key);
  const { key, value } = record;
  if (!plain(value)) return 'a record value is not an object';
  if (key.startsWith('row:')) return rowProblem(key, value);
  if (key.startsWith('batch:')) return batchProblem(key, value);
  if (key.startsWith('opening:')) return openingProblem(key, value);
  if (key.startsWith('entry:')) return entryProblem(value, key) && 'an entry is malformed';
  if (key.startsWith('approval:')) return approvalProblem(value, key) && 'an approval is malformed';
  return smallProblem(key, value);
}

// transfer, confirm, notransfer, role and rule: just the fields their readers use.
function legOk(leg) {
  return plain(leg) && text(leg.rowId) && text(leg.account) && isoDate(leg.date) && text(leg.currency)
    && Number.isInteger(leg.amount);
}

function smallProblem(key, value) {
  const texts = (items) => Array.isArray(items) && items.every(text);
  const kinds = {
    'transfer:': () => text(value.id) && key === `transfer:${value.id}` && text(value.kind)
      && text(value.state) && plain(value.fee) && Array.isArray(value.legs) && value.legs.every(legOk),
    'confirm:': () => Array.isArray(value.legs) && value.legs.length === 2 && texts(value.legs),
    'notransfer:': () => text(value.rowId),
    'role:': () => text(value.rowId) && text(value.role),
    'rule:': () => text(value.key) && text(value.category),
    'linecat:': () => text(value.rowId) && text(value.category),
  };
  const prefix = Object.keys(kinds).find((name) => key.startsWith(name));
  return kinds[prefix]() ? null : `a ${prefix.slice(0, -1)} record is malformed`;
}

function rowProblem(key, row) {
  if (!(isoDate(row.date) && text(row.description) && text(row.currency) && text(row.account)
    && Number.isInteger(row.amount) && Number.isInteger(row.occurrence)
    && Array.isArray(row.batches) && row.batches.every(text))) return 'a row is malformed';
  let identity = null;
  try { identity = rowIdentity(row); } catch {}
  return key === `row:${identity}` ? null : 'a row key does not match its content';
}
function batchProblem(key, batch) {
  if (!text(batch.id) || key !== `batch:${batch.id}` || !text(batch.account)) {
    return 'a batch is malformed';
  }
  if (batch.netDeposits !== undefined && !Number.isSafeInteger(batch.netDeposits)) {
    return 'a batch has malformed deposits';
  }
  const points = batch.balances ?? [];
  if (!Array.isArray(points) || !points.every((point) => plain(point) && text(point.currency)
    && isoDate(point.asOf) && Number.isInteger(point.amount))) return 'a batch has malformed balances';
  const range = batch.coverage ?? null;
  const validRange = plain(range) && isoDate(range.from) && isoDate(range.to) && range.from <= range.to;
  if (range !== null && !validRange) {
    return 'a batch has malformed coverage';
  }
  return null;
}
function openingProblem(key, start) {
  const ok = text(start.account) && text(start.currency) && isoDate(start.date)
    && Number.isInteger(start.amount);
  const matches = key === `opening:${start.account}|${start.currency}`;
  return ok && matches ? null : 'an opening balance is malformed';
}

// Validates only; returns { doc } or { reason }.
function read(source) {
  let doc;
  try { doc = JSON.parse(source); } catch { return { reason: 'not a backup file' }; }
  if (!plain(doc) || doc.format !== BACKUP_FORMAT) return { reason: 'not a backup file' };
  if (Number.isInteger(doc.version) && doc.version > BACKUP_VERSION) {
    return { reason: 'made by a newer version' };
  }
  if (doc.version !== BACKUP_VERSION) return damaged('unknown version');
  if (!Array.isArray(doc.records)) return damaged('records is not a list');
  const seen = new Set();
  for (const record of doc.records) {
    const problem = recordProblem(record, seen);
    if (problem) return damaged(problem);
  }
  const settings = doc.settings ?? {};
  if (!plain(settings)) return damaged('settings is not an object');
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTING_KEYS.includes(key)) return damaged(`setting ${key} is not allowed`);
    if (!text(value)) return damaged(`setting ${key} is not text`);
  }
  if ('fsa.accounts' in settings && !Array.isArray(safeParse(settings['fsa.accounts']))) {
    return damaged('accounts setting is not a list');
  }
  return { doc: { ...doc, settings } };
}
function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function createBackup({ backend, storage, now = () => new Date() }) {
  return {
    async exportBackup() {
      const createdAt = now().toISOString();
      // Under the same lock as restore, so a backup never mixes old records with new settings.
      const { records, settings } = await backend.withLock(async () => {
        const entries = (await backend.entries()).filter(({ key }) => known(key)).sort(byKey);
        const found = {};
        for (const key of SETTING_KEYS) {
          let value = null;
          try { value = storage.getItem(key); } catch {}
          if (value !== null) found[key] = value;
        }
        return { records: entries, settings: found };
      });
      return { text: JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, records,
        settings }), fileName: `fsa-backup-${createdAt.slice(0, 10)}.json`,
      counts: countsOf(records, settings) };
    },
    inspect(source) {
      const { doc, reason } = read(source);
      if (reason) return { ok: false, reason };
      return { ok: true, counts: countsOf(doc.records, doc.settings),
        createdAt: text(doc.createdAt) ? doc.createdAt : '' };
    },
    async restore(source) {
      const { doc, reason } = read(source);
      if (reason) return { ok: false, reason };
      // Settings go first and are put back if anything fails, so a failure leaves the data untouched.
      // Capture, write and roll back all happen under the lock, so no export or restore can interleave.
      const put = (values) => {
        for (const key of SETTING_KEYS) {
          if (values[key] === undefined || values[key] === null) storage.removeItem(key);
          else storage.setItem(key, values[key]);
        }
      };
      try {
        await backend.withLock(async () => {
          const previous = Object.fromEntries(SETTING_KEYS.map((key) => [key, storage.getItem(key)]));
          try {
            put(doc.settings);
            const wanted = new Set(doc.records.map(({ key }) => key));
            const stale = (await backend.entries()).filter(({ key }) => !wanted.has(key));
            await backend.commit([...stale.map(({ key }) => ({ key, value: undefined })),
              ...doc.records.map(({ key, value }) => ({ key, value }))]);
          } catch (error) {
            try { put(previous); } catch {}
            throw error;
          }
        });
      } catch (error) {
        return { ok: false, reason: `could not restore: ${error.message}` };
      }
      return { ok: true, counts: countsOf(doc.records, doc.settings) };
    },
  };
}
