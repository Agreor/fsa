import { latestBalance } from './statement-balance.js';

export async function loadBanks({ month, accounts, rows, batches = [], transfers, roles, recurringRule = () => undefined, rowIdentity,
  matchesRefund, makeBalances, convert, displayCurrency, formatAmount }) {
  const bankAccounts = accounts.filter(({ kind }) => kind === 'bank' || kind === 'debit_card');
  if (!month || !bankAccounts.length) return { month, accounts: [], totals: null };

  const [year, monthNumber] = month.split('-').map(Number);
  const asOf = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const balances = makeBalances();
  const rowRoles = new Map(roles.map(({ rowId, role }) => [rowId, role]));
  const transferLegs = new Map();
  for (const transfer of transfers) {
    for (const leg of transfer.legs) transferLegs.set(leg.rowId, transfer.kind);
  }

  const totals = { income: 0, transfers: 0, cardPayments: 0, spending: 0, saved: 0, partial: false };
  const result = await Promise.all(bankAccounts.map(async ({ id, name }) => {
    // The newest statement balance is the best figure we have, even when months in between were never imported;
    // transactions after it are added. Without a statement the opening balance and the rows decide.
    const points = batches.filter((batch) => batch.account === id).flatMap((batch) => batch.balances ?? []);
    const known = [...new Set([...rows.filter(row => row.account === id).map(row => row.currency),
      ...points.map(({ currency }) => currency)])].sort();
    const currencies = known.length ? known : [displayCurrency]; // an account with no data still says its balance is missing
    const accountBalances = await Promise.all(currencies.map(async currency => {
      let amount, shownAsOf = asOf;
      const latest = latestBalance({ account: id, currency, rows, batches });
      if (latest) ({ amount, asOf: shownAsOf } = latest);
      else {
        const balance = await balances.balance(id, currency, asOf);
        if (!balance.known) return { currency, value: null, asOf, note: 'Opening balance missing' };
        amount = balance.amount;
      }
      // Shown in the display currency like everything else; the account's own currency stays visible as `original`.
      const converted = currency === displayCurrency ? null : convert({ amount, currency }, displayCurrency, shownAsOf);
      if (!converted) return { currency, value: formatAmount(amount, currency), asOf: shownAsOf, note: null };
      return converted.unavailable
        ? { currency, value: formatAmount(amount, currency), asOf: shownAsOf, note: `No rate for ${currency} on ${shownAsOf}; shown in ${currency}` }
        : { currency, value: formatAmount(converted.amount, displayCurrency), original: formatAmount(amount, currency), asOf: shownAsOf, note: null };
    }));
    const sums = { income: 0, transfers: 0, cardPayments: 0, spending: 0, saved: 0 };
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
        bucket = recurringRule(row)?.saved ? 'saved' : 'spending'; // fixed payments marked saved or invested are not spending
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
    const net = sums.income + sums.transfers - sums.cardPayments - sums.spending - sums.saved; // what the account gained or lost
    return { id, name, balances: accountBalances, amounts: { ...sums, net }, net: formatAmount(net, displayCurrency),
      income: formatAmount(sums.income, displayCurrency),
      transfers: formatAmount(sums.transfers, displayCurrency),
      cardPayments: formatAmount(sums.cardPayments, displayCurrency),
      spending: formatAmount(sums.spending, displayCurrency), saved: formatAmount(sums.saved, displayCurrency), partial,
      note: notes.length ? notes.join('; ') : null };
  }));
  const totalNet = totals.income + totals.transfers - totals.cardPayments - totals.spending - totals.saved;
  return { month, accounts: result, totals: {
    amounts: { income: totals.income, transfers: totals.transfers, cardPayments: totals.cardPayments,
      spending: totals.spending, saved: totals.saved, net: totalNet }, net: formatAmount(totalNet, displayCurrency),
    income: formatAmount(totals.income, displayCurrency),
    transfers: formatAmount(totals.transfers, displayCurrency),
    cardPayments: formatAmount(totals.cardPayments, displayCurrency),
    spending: formatAmount(totals.spending, displayCurrency), saved: formatAmount(totals.saved, displayCurrency), partial: totals.partial
  } };
}
