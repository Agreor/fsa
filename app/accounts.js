const KEY = 'fsa.accounts';
export function listAccounts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function addAccount(account) {
  const accounts = listAccounts();
  accounts.push({ id: crypto.randomUUID(), ...account });
  localStorage.setItem(KEY, JSON.stringify(accounts));
  return accounts;
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
