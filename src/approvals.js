// An approval says "this merchant, in this currency, normally charges between min and max" (minor units).
// A charge well outside that range is flagged. One record per merchant key and currency.
export const TOLERANCE_PERCENT = 10; // [guess] how far past the range counts as unusual
export const approvalKey = (key, currency) => `approval:${key}|${currency}`;

// null when usable, else why not. `storedKey`, when given, must match the record.
export function approvalProblem(approval, storedKey) {
  if (approval === null || typeof approval !== 'object') return 'an approval is not an object';
  const { key, currency, min, max, approvedAt, count } = approval;
  if (typeof key !== 'string' || !key.trim() || key.includes('|')) return 'an approval needs a merchant key';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return 'an approval needs a currency';
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || min > max) {
    return 'an approval needs a range of positive whole amounts, lowest first';
  }
  if (count !== undefined && !(Number.isSafeInteger(count) && count >= 1)) return 'an approval count must be a whole number';
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
    // count: how many charges the range was built from; a range from few charges is too thin to flag against.
    async approve({ key, currency, min, max, count }) {
      const approval = { key, currency, min, max, approvedAt: now().toISOString(),
        ...(count === undefined ? {} : { count }) };
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

// Small baht fees vary by a few baht, which 10 percent would flag; baht gets a flat margin as well (minor units).
const THB_SLACK = 2000;

// Whether a charge (positive magnitude) is outside an approval's range plus the tolerance:
// 10 percent, or 20 baht for THB, whichever is wider.
export function isUnusual(approval, amount) {
  const slack = approval.currency === 'THB' ? THB_SLACK : 0;
  const low = Math.min(Math.floor((approval.min * (100 - TOLERANCE_PERCENT)) / 100), approval.min - slack);
  const high = Math.max(Math.ceil((approval.max * (100 + TOLERANCE_PERCENT)) / 100), approval.max + slack);
  return amount < low || amount > high;
}
