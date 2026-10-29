const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const validMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
export function monthsWithRows(rows) {
  return [...new Set(rows.filter((row) => validDate(row?.date)).map((row) => row.date.slice(0, 7)))]
    .sort().reverse();
}
export function latestMonth(rows) { return monthsWithRows(rows)[0] ?? null; }
export function monthLabel(month) {
  if (!validMonth(month)) return month;
  return `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}
export function summaryLines(view, formatAmount) {
  return [
    { label: 'Income', value: formatAmount(view.income, view.currency) },
    { label: 'Spending', value: formatAmount(view.spending, view.currency) },
    { label: 'Net', value: formatAmount(view.net, view.currency) },
    { label: 'Uncategorised purchases', value: String(view.uncategorised) },
    { label: 'Cash out', value: formatAmount(view.cashMovement.out, view.currency) },
    { label: 'Cash in', value: formatAmount(view.cashMovement.in, view.currency) },
    { label: 'Cash net', value: formatAmount(view.cashMovement.net, view.currency) },
  ];
}
export function categoryLines(view, formatAmount) {
  return view.byCategory.map(({ category, amount }) => ({
    category, value: formatAmount(amount, view.currency),
  }));
}
export function pendingNotice(view) {
  const { count } = view.pendingSuggestions;
  if (!count) return null;
  return `${count} amount${count === 1 ? ' is' : 's are'} in transfer${count === 1 ? '' : 's'} `
    + 'waiting for your confirmation and are still counted.';
}
export function markChoices(row) {
  return row.amount > 0 ? [
    { value: 'auto', label: 'Automatic' }, { value: 'income', label: 'Income' },
    { value: 'not_income', label: 'Not income' }, { value: 'refund', label: 'Refund' },
  ] : [];
}
export function currentChoice(row) { return row.role ?? 'auto'; }

export function createActions({ makeMonths, makeTransfers, report, refresh }) {
  const run = async (write) => {
    try { await write(); }
    catch (error) { report(`Could not save the change: ${error.message}`); }
    finally { try { await refresh(); } catch {} }
  };
  return {
    mark: (rowId, choice) => run(async () => {
      const months = makeMonths();
      if (choice === 'income') await months.markIncome(rowId);
      else if (choice === 'not_income') await months.markNotIncome(rowId);
      else if (choice === 'refund') await months.markRefund(rowId);
      else await months.clearRole(rowId);
    }),
    confirm: (id) => run(async () => {
      const transfers = makeTransfers();
      await transfers.confirmTransfer(id);
      await transfers.reconcile();
    }),
    notTransfer: (rowIds) => run(async () => {
      const transfers = makeTransfers();
      for (const rowId of rowIds) await transfers.markNotTransfer(rowId);
      await transfers.reconcile();
    }),
  };
}

export function createMonthData({ listRows, rowIdentity, ensureRates, makeMonths, makeTransfers,
  listRoles, formatAmount }) {
  return { async load(month, currency) {
    const allRows = await listRows();
    const availableMonths = monthsWithRows(allRows);
    if (!availableMonths.length) return { empty: true, months: [] };
    month = availableMonths.includes(month) ? month : availableMonths[0];
    const sourceRows = allRows.filter((row) => row.date?.startsWith(`${month}-`));
    const ratesStatus = await ensureRates(sourceRows, currency);
    const months = makeMonths();
    const transfers = makeTransfers();
    const view = await months.monthView(month, currency);
    const transferIds = await transfers.transferRowIds();
    const records = await transfers.listTransfers();
    const roles = await listRoles();
    const roleMap = new Map(roles.map((role) => [role.rowId, role.role]));
    const rows = sourceRows.map((row) => {
      const id = rowIdentity(row);
      return { id, account: row.account, date: row.date, description: row.description,
        amount: row.amount, currency: row.currency, displayAmount: formatAmount(row.amount, row.currency),
        role: roleMap.get(id) ?? null,
        isTransfer: transferIds.has(id), isSuggested: false };
    });
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const suggested = records.filter((record) => record.state === 'suggested'
      && record.legs.some((leg) => leg.date?.startsWith(`${month}-`))).map((record) => ({
      id: record.id, kind: record.kind, legs: record.legs.map((leg) => ({
        rowId: leg.rowId, date: leg.date, description: allRows.find((row) =>
          rowIdentity(row) === leg.rowId)?.description ?? '', amount: leg.amount,
        currency: leg.currency, displayAmount: formatAmount(leg.amount, leg.currency),
        account: leg.account,
      })),
    }));
    for (const record of suggested) for (const leg of record.legs) {
      if (rowMap.has(leg.rowId)) rowMap.get(leg.rowId).isSuggested = true;
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description)
      || a.id.localeCompare(b.id));
    return { empty: false, months: availableMonths, month, currency, view, ratesStatus, rows,
      suggested, summary: summaryLines(view, formatAmount), categories: categoryLines(view, formatAmount),
      notice: pendingNotice(view), incomplete: view.partial === true,
      incompleteNote: view.partial === true
        ? 'Some amounts could not be converted, so these totals are incomplete.' : null,
      spendingNote: view.spending < 0
        ? 'Refunds are larger than purchases this month.' : null };
  } };
}
