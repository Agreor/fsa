// Review: fixed payments out of bank accounts that repeat, and the rules already made for them. Pure.
// recurringKey(row) and rowIdentity(row) are the app's own functions; rules are stored recurring records.
const KINDS = ['bank', 'debit_card'];
const MAX_SHOWN = 10;

export function loadRecurring({ rows, transfers, accounts, rules, rowIdentity, recurringKey, merchantKey }) {
  const accountOf = new Map(accounts.map((account) => [account.id, account]));
  const legs = new Set(transfers.flatMap(({ legs: items }) => items.map(({ rowId }) => rowId)));
  const ruled = new Set(rules.map(({ key }) => key));
  const groups = new Map();
  for (const row of rows) {
    if (row.amount >= 0 || !KINDS.includes(accountOf.get(row.account)?.kind) || legs.has(rowIdentity(row))) continue;
    const key = recurringKey(row);
    if (ruled.has(key)) continue;
    const group = groups.get(key) ?? { key, account: accountOf.get(row.account).name, name: merchantKey(row.description) ?? row.description,
      amount: -row.amount, currency: row.currency, monthSet: new Set(), sample: row };
    group.monthSet.add(row.date.slice(0, 7));
    groups.set(key, group);
  }
  const candidates = [...groups.values()].filter(({ monthSet }) => monthSet.size >= 2)
    .map(({ monthSet, ...group }) => ({ ...group, months: monthSet.size }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key)).slice(0, MAX_SHOWN);
  const named = rules.map((rule) => {
    const [accountId, name, amount, currency] = rule.key.split('|');
    return { ...rule, account: accountOf.get(accountId)?.name ?? accountId, name, amount: Number(amount), currency };
  }).sort((a, b) => b.amount - a.amount);
  return { candidates, rules: named };
}
