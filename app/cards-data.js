export async function loadCards({ month, accounts, rows, batches, transfers, roles, categoryOf,
  rowIdentity, convert, displayCurrency, formatAmount }) {
  const cards = accounts.filter(({ kind }) => kind === 'credit_card');
  if (!month || !cards.length) return { month, cards: [] };

  const transferLegs = new Map();
  for (const transfer of transfers) {
    if (transfer.state === 'suggested') continue;
    for (const leg of transfer.legs) transferLegs.set(leg.rowId, transfer.kind);
  }
  const rowRoles = new Map(roles.map(({ rowId, role }) => [rowId, role]));

  return { month, cards: await Promise.all(cards.map(async ({ id, name }) => {
    const categorySums = new Map();
    let payments = 0;
    let partial = false;
    const notes = [];
    for (const row of rows) {
      if (row.account !== id || !row.date.startsWith(`${month}-`) || row.amount === 0) continue;
      const rowId = rowIdentity(row);
      if (transferLegs.has(rowId)) {
        if (transferLegs.get(rowId) === 'card_payment' && row.amount > 0) {
          const converted = convert({ amount: row.amount, currency: row.currency }, displayCurrency,
            row.date);
          if (converted.unavailable) {
            partial = true;
            notes.push(`No rate for ${row.currency} on ${row.date}`);
          } else payments += converted.amount;
        }
        continue;
      }
      if (row.amount > 0 && rowRoles.get(rowId) === 'not_income') continue;
      const converted = convert({ amount: Math.abs(row.amount), currency: row.currency },
        displayCurrency, row.date);
      if (converted.unavailable) {
        partial = true;
        notes.push(`No rate for ${row.currency} on ${row.date}`);
        continue;
      }
      const category = (await categoryOf(row)).category;
      categorySums.set(category, (categorySums.get(category) || 0) +
        (row.amount < 0 ? converted.amount : -converted.amount));
    }

    const categories = [...categorySums].filter(([, value]) => value !== 0)
      .sort(([aCategory, aValue], [bCategory, bValue]) =>
        bValue - aValue || aCategory.localeCompare(bCategory))
      .map(([category, value]) => ({ category, value: formatAmount(value, displayCurrency) }));
    const chargeTotal = [...categorySums.values()].reduce((sum, value) => sum + value, 0);
    let statementPoint = null;
    for (const batch of batches) {
      if (batch.account !== id) continue;
      for (const point of batch.balances || []) {
        if (!statementPoint || point.asOf > statementPoint.asOf) statementPoint = point;
      }
    }
    const statement = statementPoint ? { asOf: statementPoint.asOf,
      debt: formatAmount(-statementPoint.amount, statementPoint.currency),
      currency: statementPoint.currency } : null;
    const owed = statementPoint ? formatAmount(-(statementPoint.amount + rows
      .filter(row => row.account === id && row.currency === statementPoint.currency &&
        row.date > statementPoint.asOf)
      .reduce((sum, row) => sum + row.amount, 0)), statementPoint.currency) : null;
    return { id, name, categories, charges: formatAmount(chargeTotal, displayCurrency),
      payments: formatAmount(payments, displayCurrency), statement, owed, partial,
      note: notes.length ? notes.join('; ') : null };
  })) };
}
