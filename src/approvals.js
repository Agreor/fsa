// An approval says "this merchant, in this currency, normally charges between min and max" (minor units).
// A charge well outside that range is flagged. One record per merchant key and currency.
export const TOLERANCE_PERCENT = 10; // [guess] how far past the range counts as unusual
export const approvalKey = (key, currency) => `approval:${key}|${currency}`;

// null when usable, else why not. `storedKey`, when given, must match the record.
export function approvalProblem(approval, storedKey) {
  if (approval === null || typeof approval !== 'object') return 'an approval is not an object';
  const { key, currency, min, max, approvedAt } = approval;
  if (typeof key !== 'string' || !key.trim() || key.includes('|')) return 'an approval needs a merchant key';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return 'an approval needs a currency';
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || min > max) {
    return 'an approval needs a range of positive whole amounts, lowest first';
  }
  if (typeof approvedAt !== 'string' || Number.isNaN(Date.parse(approvedAt))) {
    return 'an approval needs the date it was approved';
  }
  return storedKey !== undefined && storedKey !== approvalKey(key, currency)
    ? 'an approval key does not match its content' : null;
}

export function createApprovals({ backend, now = () => new Date() }) {
  return {
    async list() {
      return (await backend.list('approval:')).sort((a, b) =>
        a.key.localeCompare(b.key) || a.currency.localeCompare(b.currency));
    },
    async approve({ key, currency, min, max }) {
      const approval = { key, currency, min, max, approvedAt: now().toISOString() };
      const problem = approvalProblem(approval);
      if (problem) throw new TypeError(problem);
      await backend.commit([{ key: approvalKey(key, currency), value: approval }]);
      return approval;
    },
    async revoke(key, currency) {
      await backend.commit([{ key: approvalKey(key, currency), value: undefined }]);
    },
  };
}

// Whether a charge (positive magnitude) is outside an approval's range plus the tolerance.
export function isUnusual(approval, amount) {
  const low = Math.floor((approval.min * (100 - TOLERANCE_PERCENT)) / 100);
  const high = Math.ceil((approval.max * (100 + TOLERANCE_PERCENT)) / 100);
  return amount < low || amount > high;
}
