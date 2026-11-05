// Review flags: merchants never approved, and charges outside an approved range. Pure.
// rows: stored rows; approvals: stored approvals; transfers: stored transfer records;
// merchantKey(description), rowIdentity(row) and isUnusual(approval, amount) are the app's own functions.
const KINDS = ['bank', 'debit_card', 'credit_card'];

export function loadFlags({ rows, approvals, transfers, accounts, rowIdentity, merchantKey, isUnusual }) {
  const kindOf = new Map(accounts.map(({ id, kind }) => [id, kind]));
  const legs = new Set(transfers.filter(({ state }) => state !== 'suggested')
    .flatMap(({ legs: items }) => items.map(({ rowId }) => rowId)));
  const approved = new Map(approvals.map((approval) => [`${approval.key}|${approval.currency}`, approval]));
  const groups = new Map();
  const outOfRange = [];
  for (const row of rows) {
    if (row.amount >= 0 || !KINDS.includes(kindOf.get(row.account)) || legs.has(rowIdentity(row))) continue;
    const key = merchantKey(row.description);
    if (!key) continue;
    const amount = -row.amount;
    const approval = approved.get(`${key}|${row.currency}`);
    if (approval) {
      if (isUnusual(approval, amount)) {
        outOfRange.push({ key, currency: row.currency, date: row.date, description: row.description,
          amount, min: approval.min, max: approval.max });
      }
      continue;
    }
    const id = `${key}|${row.currency}`;
    const group = groups.get(id) ?? { key, currency: row.currency, sample: row.description, latest: '',
      count: 0, min: amount, max: amount, total: 0, charges: [] };
    group.count++;
    group.min = Math.min(group.min, amount);
    group.max = Math.max(group.max, amount);
    group.total += amount;
    group.charges.push({ date: row.date, amount });
    if (row.date >= group.latest) { group.latest = row.date; group.sample = row.description; }
    groups.set(id, group);
  }
  const newMerchants = [...groups.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  outOfRange.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return { newMerchants, outOfRange };
}
