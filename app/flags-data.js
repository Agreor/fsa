// Review flags: merchants never approved, and charges outside an approved range. Pure.
// rows: stored rows; approvals: stored approvals; transfers: stored transfer records;
// merchantKey(description), rowIdentity(row) and isUnusual(approval, amount) are the app's own functions.
const KINDS = ['bank', 'debit_card', 'credit_card'];

const MIN_CHARGES_TO_FLAG = 3; // a range from fewer charges says nothing about what is unusual

// A readable label: no processor prefix, no trailing statement reference, no shouting, at most 40 letters.
export function prettyName(text) {
  let name = text.trim();
  const star = name.indexOf('*');
  if (star > 0 && star <= 8) name = name.slice(star + 1);
  name = name.replace(/\s+\d{2}\/\d{2}.*$/, '').replace(/\s+/g, ' ').trim();
  if (name === name.toUpperCase()) name = name.toLowerCase().replace(/(^|[\s.])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
  return name.length > 40 ? `${name.slice(0, 39)}…` : name;
}
// shortcut: a bank line that starts with "To <name>" is a payment to a person; other wordings are not detected.
const isPerson = (text) => /^to\s+\S/i.test(text.trim());

export function loadFlags({ rows, approvals, transfers, accounts, rowIdentity, merchantKey, isUnusual,
  ruleKeys = new Set(), lineIds = new Set() }) {
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
    if (approval && !lineIds.has(rowIdentity(row))) {
      if ((approval.count ?? MIN_CHARGES_TO_FLAG) >= MIN_CHARGES_TO_FLAG && isUnusual(approval, amount)) {
        outOfRange.push({ key, currency: row.currency, date: row.date, description: row.description,
          amount, min: approval.min, max: approval.max });
      }
    }
    if (lineIds.has(rowIdentity(row))) continue; // already categorised on its own
    if (approval && ruleKeys.has(key)) continue; // approved and categorised: nothing to ask
    const id = `${key}|${row.currency}`;
    const group = groups.get(id) ?? { key, currency: row.currency, approved: Boolean(approval), sample: row.description, latest: '',
      count: 0, min: amount, max: amount, total: 0, charges: [] };
    group.count++;
    group.min = Math.min(group.min, amount);
    group.max = Math.max(group.max, amount);
    group.total += amount;
    group.charges.push({ date: row.date, amount, rowId: rowIdentity(row) });
    if (row.date >= group.latest) { group.latest = row.date; group.sample = row.description; }
    groups.set(id, group);
  }
  const all = [...groups.values()].map(({ approved: isApproved, ...group }) => ({ ...group,
    name: prettyName(group.sample), person: isPerson(group.sample), isApproved }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const strip = ({ isApproved, ...group }) => group;
  // newMerchants: never approved. todo: no category yet, approved or not (removing a category brings a
  // merchant back). silent: categorised but not approved, so only its range needs saving.
  const newMerchants = all.filter(({ isApproved }) => !isApproved).map(strip);
  const todo = all.filter(({ key }) => !ruleKeys.has(key)).map(strip);
  const silent = all.filter(({ key, isApproved }) => ruleKeys.has(key) && !isApproved).map(strip);
  outOfRange.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return { newMerchants, todo, silent, outOfRange };
}
