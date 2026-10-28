import { merchantKey, reduceForClassifier } from './merchant.js';

export const CATEGORIES = Object.freeze([
  'Groceries', 'Eating out', 'Transport', 'Shopping', 'Subscriptions', 'Health',
  'Housing', 'Utilities', 'Travel', 'Entertainment', 'Fees', 'Other',
]);
export const UNCATEGORISED = 'Uncategorised';

const ruleKey = (key) => `rule:${key}`;
const isCategory = (category) => CATEGORIES.includes(category);
const plainObject = (value) => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const freezeDeep = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
};

function hash(value) {
  let a = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (const char of value) {
    const code = char.codePointAt(0);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + 1), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function createCategories({ backend, accountKinds = {}, now = () => new Date().toISOString() }) {
  const previews = new Map();
  const pending = new Set();
  const keyOf = (target) => typeof target === 'string' ? target.trim() : merchantKey(target?.description);
  const readRules = async () => backend.list('rule:');
  const categoryOf = async (row) => {
    const key = merchantKey(row?.description);
    if (!key) return { category: UNCATEGORISED, via: 'none', key: null };
    const rules = await readRules();
    const rule = rules.find((item) => item.key === key);
    return rule ? { category: rule.category, via: 'rule', key }
      : { category: UNCATEGORISED, via: 'none', key };
  };

  return {
    categoryOf,
    async categorise(rows) {
      const rules = await readRules();
      const byKey = new Map(rules.map((rule) => [rule.key, rule]));
      return rows.map((row) => {
        const key = merchantKey(row?.description);
        const rule = key && byKey.get(key);
        return rule ? { category: rule.category, via: 'rule', key }
          : { category: UNCATEGORISED, via: 'none', key };
      });
    },
    async correct(target, category) {
      if (!isCategory(category)) throw new TypeError(`category must be one of: ${CATEGORIES.join(', ')}`);
      const key = keyOf(target);
      if (!key) throw new TypeError('target must have a non-empty merchant key');
      await backend.withLock(async () => backend.commit([{
        key: ruleKey(key), value: { key, category, source: 'user', at: now() },
      }]));
      return { key, category };
    },
    async forget(key) {
      await backend.withLock(async () => backend.commit([{ key: ruleKey(key), value: undefined }]));
    },
    async listRules() {
      return (await readRules()).sort((a, b) => a.key.localeCompare(b.key));
    },
    async preview(rows) {
      const rules = new Set((await readRules()).map((rule) => rule.key));
      const groups = new Map();
      const skipped = { notSendable: 0, localOnly: 0, ruled: 0 };
      for (const row of rows) {
        const key = merchantKey(row?.description);
        if (!key) {
          skipped.notSendable++;
          continue;
        }
        if (rules.has(key)) {
          skipped.ruled++;
          continue;
        }
        if ((accountKinds[row.account] ?? 'bank') !== 'credit_card') {
          skipped.localOnly++;
          continue;
        }
        const text = reduceForClassifier(row.description, { accountKind: 'credit_card' });
        if (text === null) {
          skipped.notSendable++;
          continue;
        }
        if (!groups.has(text)) groups.set(text, { text, keys: new Set(), count: 0 });
        const group = groups.get(text);
        group.keys.add(key);
        group.count++;
      }
      const items = [...groups.values()].map(({ text, keys, count }) => ({
        text, keys: [...keys].sort(), count,
      })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
      const snapshot = freezeDeep(structuredClone({ id: hash(JSON.stringify(items)), items, skipped }));
      previews.set(snapshot.id, snapshot);
      if (previews.size > 20) previews.delete(previews.keys().next().value);
      return structuredClone(snapshot);
    },
    async classifyApproved(preview, approvedTexts, classify) {
      const snapshot = previews.get(preview?.id);
      if (!snapshot) return { sent: 0, saved: 0, retryLater: false,
        rejected: approvedTexts.length, skipped: 0, inFlight: 0, unknownPreview: true };
      const items = new Map(snapshot.items.filter((item) => typeof item.text === 'string')
        .map((item) => [item.text, { ...item, keys: item.keys.filter((key) => typeof key === 'string') }]));
      const rejected = new Set(approvedTexts.filter((text) => !items.has(text))).size;
      const texts = [...new Set(approvedTexts)].filter((text) => items.has(text));
      const sendTexts = texts.filter((text) => !pending.has(text));
      const inFlight = texts.length - sendTexts.length;
      for (const text of sendTexts) pending.add(text);
      try {
        const rules = new Set((await readRules()).map((rule) => rule.key));
        const sendItems = new Map();
        let skipped = 0;
        for (const text of sendTexts) {
          const item = items.get(text);
          const keys = item.keys.filter((key) => typeof key === 'string' && !rules.has(key));
          if (keys.length) sendItems.set(text, { ...item, keys });
          else skipped++;
        }
        const readyTexts = [...sendItems.keys()];
        if (!readyTexts.length) {
          return { sent: 0, saved: 0, retryLater: false, rejected, skipped, inFlight };
        }
        let saved = 0;
        for (let offset = 0; offset < readyTexts.length; offset += 50) {
          const chunk = readyTexts.slice(offset, offset + 50);
          let result;
          try {
            result = await classify(chunk);
          } catch {
            return { sent: offset + chunk.length, saved, retryLater: true, rejected, inFlight };
          }
          if (!plainObject(result)) {
            return { sent: offset + chunk.length, saved, retryLater: true, rejected, inFlight };
          }
          const writes = await backend.withLock(async () => {
            const operations = [];
            for (const text of chunk) {
              const category = Object.hasOwn(result, text) ? result[text] : null;
              if (!isCategory(category)) continue;
              for (const key of sendItems.get(text).keys) {
                if (await backend.get(ruleKey(key)) !== undefined) continue;
                operations.push({ key: ruleKey(key), value: {
                  key, category, source: 'classifier', at: now(),
                } });
              }
            }
            if (operations.length) await backend.commit(operations);
            return operations.length;
          });
          saved += writes;
        }
        return { sent: readyTexts.length, saved, retryLater: false, rejected, skipped, inFlight };
      } finally {
        for (const text of sendTexts) pending.delete(text);
      }
    },
  };
}
