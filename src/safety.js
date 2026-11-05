// Data safety: ask the browser to keep the app's data, record what it answered, and remember the last
// backup so the app can nag. Everything is local; settings is a localStorage-like object.
export const PERSIST_KEY = 'fsa.persist';
export const BACKUP_KEY = 'fsa.lastBackup';
export const BACKUP_DUE_DAYS = 30;
export const BACKUP_DUE_DAYS_IF_DENIED = 7;
const DAY = 86400000;

const read = (settings, key) => { try { return settings.getItem(key); } catch { return null; } };
// shortcut: a blocked settings store loses the note, the app still works.
const write = (settings, key, value) => {
  try { settings.setItem(key, value); } catch { /* ignored */ }
};

// The answer is recorded as { status: granted | denied | unsupported, at }. Chrome may refuse; that is shown.
export async function checkPersistence({ storageManager, settings, now = () => new Date() }) {
  let status = 'unsupported';
  if (typeof storageManager?.persist === 'function') {
    try {
      const kept = typeof storageManager.persisted === 'function' && await storageManager.persisted();
      status = kept || await storageManager.persist() ? 'granted' : 'denied';
    } catch { status = 'unsupported'; }
  }
  const result = { status, at: now().toISOString() };
  write(settings, PERSIST_KEY, JSON.stringify(result));
  return result;
}

export function recordBackup({ settings, now = () => new Date() }) {
  write(settings, BACKUP_KEY, now().toISOString());
}

export function lastBackup(settings) {
  const value = read(settings, BACKUP_KEY);
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function storedPersistence(settings) {
  try {
    const { status } = JSON.parse(read(settings, PERSIST_KEY));
    return ['granted', 'denied', 'unsupported'].includes(status) ? status : null;
  } catch { return null; }
}

// What to tell Colin; warn is true when a reminder should be prominent.
export function safetyNotes({ persistence, lastBackupAt, now = new Date() }) {
  const storage = { granted: 'Storage: this browser will keep your data.',
    denied: 'Storage: this browser may clear your data. Back up often.',
    unsupported: 'Storage: this browser does not say if it keeps your data. Back up often.' }[persistence]
    ?? 'Storage: not checked yet.';
  const days = lastBackupAt === null ? null : Math.floor((now.getTime() - Date.parse(lastBackupAt)) / DAY);
  const backup = days === null ? 'No backup yet.'
    : `Last backup: ${lastBackupAt.slice(0, 10)} (${days} day${days === 1 ? '' : 's'} ago).`;
  const due = persistence === 'denied' ? BACKUP_DUE_DAYS_IF_DENIED : BACKUP_DUE_DAYS;
  const warn = days === null || days >= due;
  return { storage, backup, warn };
}
