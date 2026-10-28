import { rowIdentity, validateParsed } from "./contracts.js";

const copy = (value) => structuredClone(value);
const idbLocks = new Map();
const enqueue = (chain, work) => {
  const result = chain.then(work);
  return { result, tail: result.catch(() => {}) };
};

export function memoryBackend() {
  const data = new Map();
  let chain = Promise.resolve();
  return {
    withLock(work) { const queued = enqueue(chain, work); chain = queued.tail; return queued.result; },
    async get(key) { return copy(data.get(key)); },
    async list(prefix = "") { return [...data].filter(([key]) => key.startsWith(prefix)).map(([, value]) => copy(value)); },
    async commit(operations) {
      const next = new Map(data);
      for (const op of operations) op.value === undefined ? next.delete(op.key) : next.set(op.key, copy(op.value));
      data.clear();
      for (const [key, value] of next) data.set(key, value);
    },
  };
}

export function indexedDbBackend(name, factory = globalThis.indexedDB) {
  if (!factory) throw new Error("IndexedDB is unavailable");
  const open = new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!idbLocks.has(name)) idbLocks.set(name, Promise.resolve());
  const transaction = async (mode, work) => {
    const db = await open;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("records", mode), result = work(tx.objectStore("records"), tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    withLock(work) {
      if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request(`store:${name}`, work);
      const queued = enqueue(idbLocks.get(name), work);
      idbLocks.set(name, queued.tail);
      return queued.result;
    },
    async get(key) { return transaction("readonly", store => new Promise((resolve, reject) => { const r = store.get(key); r.onsuccess = () => resolve(r.result?.value); r.onerror = () => reject(r.error); })); },
    async list(prefix = "") { return transaction("readonly", store => new Promise((resolve, reject) => { const r = store.getAll(); r.onsuccess = () => resolve(r.result.filter(x => x.key.startsWith(prefix)).map(x => x.value)); r.onerror = () => reject(r.error); })); },
    async commit(operations) { return transaction("readwrite", store => { for (const op of operations) op.value === undefined ? store.delete(op.key) : store.put({ key: op.key, value: op.value }, op.key); }); },
  };
}

export function createStore(backend) {
  const exclusive = backend.withLock ?? (work => work());
  return {
    addBatch(accountId, parsed, { fileHash, name } = {}) {
      return exclusive(async () => {
        const problems = validateParsed(parsed);
        if (problems.length) throw new Error(problems.join("; "));
        if (!accountId || !fileHash) throw new Error("accountId and fileHash are required");
        if (!Array.isArray(parsed.rows)) throw new Error("rows are required");
        if (!parsed.rows.length && parsed.coverage == null) throw new Error("rows must not be empty");
        const batches = await backend.list("batch:"), dup = batches.find(b => b.account === accountId && b.fileHash === fileHash);
        if (dup) return { duplicateFile: true, added: 0, skipped: 0 };
        const ops = [], held = new Set(), pending = new Map(), batchId = globalThis.crypto.randomUUID();
        let added = 0, skipped = 0;
        for (const input of parsed.rows) {
          const row = { ...input, account: accountId };
          let key = `row:${rowIdentity(row)}`;
          let existing = pending.get(key) ?? await backend.get(key);
          if (!row.sourceId && parsed.coverage == null) {
            const similar = [...await backend.list("row:"), ...pending.values()].find(r => r.account === accountId && r.date === row.date && r.amount === row.amount && r.currency === row.currency && r.description.trim().replace(/\s+/g, " ").toLowerCase() === row.description.trim().replace(/\s+/g, " ").toLowerCase());
            if (similar) {
              row.possibleDuplicate = true;
              row.occurrence = Math.max(row.occurrence, ...([...await backend.list("row:"), ...pending.values()].filter(r => r.account === accountId && r.date === row.date && r.amount === row.amount && r.currency === row.currency && r.description.trim().replace(/\s+/g, " ").toLowerCase() === row.description.trim().replace(/\s+/g, " ").toLowerCase()).map(r => r.occurrence))) + 1;
              key = `row:${rowIdentity(row)}`;
              existing = pending.get(key) ?? await backend.get(key);
            }
          } else if (existing) {
            existing.batches = [...new Set([...existing.batches, batchId])];
            ops.push({ key, value: existing }); held.add(key); skipped++; continue;
          }
          if (held.has(key)) { skipped++; continue; }
          if (existing) { skipped++; continue; }
          const stored = { ...row, batches: [batchId] };
          ops.push({ key, value: stored }); pending.set(key, stored); held.add(key); added++;
        }
        const batch = { id: batchId, account: accountId, name, fileHash, coverage: copy(parsed.coverage ?? null), balances: copy(parsed.balances ?? []) };
        ops.push({ key: `batch:${batchId}`, value: batch });
        await backend.commit(ops);
        return { batchId, added, skipped };
      });
    },
    undoBatch(batchId) {
      return exclusive(async () => {
        const batch = await backend.get(`batch:${batchId}`);
        if (!batch) return { removed: 0 };
        const ops = [];
        for (const row of await backend.list("row:")) {
          if (!row.batches.includes(batchId)) continue;
          const batches = row.batches.filter(id => id !== batchId), key = `row:${rowIdentity(row)}`;
          if (batches.length) ops.push({ key, value: { ...row, batches } });
          else ops.push({ key, value: undefined });
        }
        ops.push({ key: `batch:${batchId}`, value: undefined });
        await backend.commit(ops);
        return { removed: ops.filter(x => x.key.startsWith("row:") && x.value === undefined).length };
      });
    },
    async listRows({ account } = {}) { const rows = await backend.list("row:"); return rows.filter(r => account === undefined || r.account === account).map(({ batches, ...row }) => row); },
    async listBatches() { return backend.list("batch:"); },
  };
}
