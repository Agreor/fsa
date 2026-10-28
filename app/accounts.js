const KEY = 'fsa.accounts';
export const KINDS = ['bank', 'debit_card', 'credit_card', 'broker', 'cash'];
const hintsOf = (value) => {
  const hints = (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .map((hint) => String(hint).trim()).filter(Boolean);
  return hints.filter((hint, i) => hints.findIndex((item) =>
    item.toLowerCase() === hint.toLowerCase()) === i);
};
export function normaliseAccount(raw) {
  const kind = ({ current: 'bank', savings: 'bank', credit: 'credit_card' })[raw.kind] ?? raw.kind;
  return { id: raw.id, name: raw.name, source: raw.source, kind: KINDS.includes(kind) ? kind : 'bank',
    hints: hintsOf(raw.hints), hintsAreEvidence: raw.hintsAreEvidence === true };
}
export function listAccounts() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item === 'object' && item.id)
      .map(normaliseAccount) : [];
  } catch { return []; }
}
export function addAccount(account) {
  const accounts = listAccounts();
  accounts.push(normaliseAccount({ ...account, id: crypto.randomUUID() }));
  localStorage.setItem(KEY, JSON.stringify(accounts));
  return accounts;
}
const comparable = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function sharedHints(accounts) {
  const found = new Map();
  for (const account of accounts) for (const hint of new Set(account.hints.map(comparable).filter(Boolean))) {
    if (!found.has(hint)) found.set(hint, { hint, names: [], ids: new Set() });
    const match = found.get(hint);
    if (!match.ids.has(account.id)) match.names.push(account.name);
    match.ids.add(account.id);
  }
  return [...found.values()].filter((match) => match.ids.size > 1)
    .map(({ hint, names }) => ({ hint, accounts: names }));
}
export function transferAccounts(accounts) {
  return Object.fromEntries(accounts.map(({ id, kind, hints, hintsAreEvidence }) =>
    [id, { kind, hints, hintsAreEvidence }]));
}

export function createPreviewRunner({ selection, prepare, save }) {
  let generation = 0;
  let current;
  return {
    get current() { return current; },
    invalidate() { generation++; current = undefined; },
    async preview() {
      const token = ++generation;
      const { accountId, file } = selection();
      current = undefined;
      if (!file || !file.size) return;
      const name = file.name;
      let result;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        result = await prepare({ bytes, name, accountId });
      } catch (error) {
        if (token !== generation) return;
        throw error;
      }
      if (token !== generation) return;
      if (result.status === 'ready') current = { ...result, name, accountId };
      return current;
    },
    async save() {
      if (!current) return;
      return save(current);
    },
  };
}
