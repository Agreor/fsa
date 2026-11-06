export async function loadBanks({ month, accounts, rows, transfers, roles, rowIdentity,
  matchesRefund, makeBalances, convert, displayCurrency, formatAmount }) {
  const bankAccounts = accounts.filter(({ kind }) => kind === 'bank' || kind === 'debit_card');
  if (!month || !bankAccounts.length) return { month, accounts: [], totals: null };

  const [year, monthNumber] = month.split('-').map(Number);
  const asOf = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const balances = makeBalances();
  const rowRoles = new Map(roles.map(({ rowId, role }) => [rowId, role]));
  const transferLegs = new Map();
  for (const transfer of transfers) {
    if (transfer.state === 'suggested') continue;
    for (const leg of transfer.legs) transferLegs.set(leg.rowId, transfer.kind);
  }

  const totals = { income: 0, transfers: 0, cardPayments: 0, spending: 0, partial: false };
  const result = await Promise.all(bankAccounts.map(async ({ id, name }) => {
    const currencies = [...new Set(rows.filter(row => row.account === id).map(row => row.currency))]
      .sort();
    const accountBalances = await Promise.all(currencies.map(async currency => {
      const balance = await balances.balance(id, currency, asOf);
      return { currency, value: balance.known ? formatAmount(balance.amount, currency) : null,
        asOf, note: balance.known ? null : 'Opening balance missing' };
    }));
    const sums = { income: 0, transfers: 0, cardPayments: 0, spending: 0 };
    const notes = [];
    for (const row of rows) {
      if (row.account !== id || !row.date.startsWith(`${month}-`) || row.amount === 0) continue;
      const rowId = rowIdentity(row);
      const transferKind = transferLegs.get(rowId);
      let bucket;
      let amount = row.amount;
      if (transferKind !== undefined) {
        if (transferKind === 'card_payment') {
          if (amount >= 0) continue;
          bucket = 'cardPayments';
          amount = -amount;
        } else bucket = 'transfers';
      } else if (amount < 0) {
        bucket = 'spending';
        amount = -amount;
      } else {
        const role = rowRoles.get(rowId);
        if (role === 'not_income' || role === 'refund' ||
            (role === undefined && matchesRefund(row.description))) continue;
        bucket = 'income';
      }
      const converted = convert({ amount, currency: row.currency }, displayCurrency, row.date);
      if (converted.unavailable) {
        notes.push(`No rate for ${row.currency} on ${row.date}`);
        continue;
      }
      sums[bucket] += converted.amount;
    }
    for (const key of Object.keys(sums)) totals[key] += sums[key];
    const partial = notes.length > 0;
    totals.partial ||= partial;
    return { id, name, balances: accountBalances, amounts: { ...sums },
      income: formatAmount(sums.income, displayCurrency),
      transfers: formatAmount(sums.transfers, displayCurrency),
      cardPayments: formatAmount(sums.cardPayments, displayCurrency),
      spending: formatAmount(sums.spending, displayCurrency), partial,
      note: notes.length ? notes.join('; ') : null };
  }));
  return { month, accounts: result, totals: {
    amounts: { income: totals.income, transfers: totals.transfers, cardPayments: totals.cardPayments,
      spending: totals.spending },
    income: formatAmount(totals.income, displayCurrency),
    transfers: formatAmount(totals.transfers, displayCurrency),
    cardPayments: formatAmount(totals.cardPayments, displayCurrency),
    spending: formatAmount(totals.spending, displayCurrency), partial: totals.partial
  } };
}
