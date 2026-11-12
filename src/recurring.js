// A recurring payment rule: "this account pays this text, this exact amount" (minor units, positive).
// It either marks the money as saved or invested (cash left the bank, but it is not spending) or gives it a
// category. For fixed monthly payments; when the amount changes, the rule no longer matches and the payment
// shows up in Review again.
import { merchantKey } from './merchant.js';

export const SAVED = 'saved';
export const recurringKey = (row) => `${row.account}|${merchantKey(row.description) ?? ''}|${-row.amount}|${row.currency}`;
const storeKey = (key) => `recurring:${key}`;

export function recurringProblem(rule, storedKey) {
  if (rule === null || typeof rule !== 'object') return 'a recurring rule is not an object';
  const { key, saved, category } = rule;
  if (typeof key !== 'string' || key.split('|').length < 4) return 'a recurring rule needs a key';
  if (saved !== undefined && saved !== true) return 'a recurring rule is saved or has a category';
  if ((saved === true) === (typeof category === 'string')) return 'a recurring rule is saved or has a category';
  return storedKey !== undefined && storedKey !== storeKey(key) ? 'a recurring key does not match its content' : null;
}

// A function from a row to its rule, for outflows only.
export function recurringLookup(rules) {
  const byKey = new Map(rules.map((rule) => [rule.key, rule]));
  return (row) => (row.amount < 0 ? byKey.get(recurringKey(row)) : undefined);
}

export function createRecurring({ backend }) {
  return {
    list: async () => (await backend.list('recurring:')).sort((a, b) => a.key.localeCompare(b.key)),
    // choice: SAVED or a category name
    async set(row, choice) {
      const rule = { key: recurringKey(row), ...(choice === SAVED ? { saved: true } : { category: choice }) };
      const problem = recurringProblem(rule);
      if (problem) throw new TypeError(problem);
      await backend.commit([{ key: storeKey(rule.key), value: rule }]);
      return rule;
    },
    async remove(key) { await backend.commit([{ key: storeKey(key), value: undefined }]); },
  };
}
