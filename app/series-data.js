// Per broker statement period: start value, net deposits, end value, market change and return.
// shortcut: deposits are timed at the middle of the period (the statement gives only the net figure).
const day = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const next = (date) => iso(Date.parse(`${date}T00:00:00Z`) + day);
const middle = (a, b) =>
  iso(Math.floor((Date.parse(`${a}T00:00:00Z`) + Date.parse(`${b}T00:00:00Z`)) / 2 / day) * day);

export async function loadSeries({ accounts, batches, convert, displayCurrency, formatAmount }) {
  const money = (amount) => formatAmount(amount, displayCurrency);
  const result = [];
  for (const account of accounts.filter(({ kind }) => kind === 'broker')) {
    const periods = [];
    for (const batch of batches.filter((item) => item.account === account.id)) {
      const points = [...(batch.balances ?? [])].sort((a, b) => a.asOf.localeCompare(b.asOf));
      if (points.length < 2 || points[0].currency !== points.at(-1).currency) continue;
      periods.push({ start: points[0], end: points.at(-1), deposits: batch.netDeposits });
    }
    periods.sort((a, b) => a.start.asOf.localeCompare(b.start.asOf));
    const rows = [];
    const gaps = [];
    for (const [index, { start, end, deposits }] of periods.entries()) {
      const row = { from: next(start.asOf), to: end.asOf, start: null, deposits: null, end: null,
        marketChange: null, returnPct: null, partial: false, note: null };
      const before = periods[index - 1];
      if (before && start.asOf > before.end.asOf) gaps.push({ from: next(before.end.asOf), to: start.asOf });
      if (before && start.asOf < before.end.asOf) row.note = 'Overlaps the previous statement';
      const { currency } = start;
      const flow = deposits === undefined ? null : deposits;
      const startValue = await convert({ amount: start.amount, currency }, displayCurrency, start.asOf);
      const endValue = await convert({ amount: end.amount, currency }, displayCurrency, end.asOf);
      const flowValue = flow === null ? { amount: null }
        : await convert({ amount: flow, currency }, displayCurrency, middle(start.asOf, end.asOf));
      if (startValue.unavailable || endValue.unavailable || flowValue.unavailable) {
        row.partial = true;
        row.note = 'A rate is missing, so the figures cannot be converted';
      } else {
        row.start = money(startValue.amount);
        row.end = money(endValue.amount);
        if (flow === null) {
          row.note = 'Import this statement again to separate deposits from market change';
        } else {
          const change = endValue.amount - startValue.amount - flowValue.amount;
          const base = startValue.amount + flowValue.amount / 2;
          row.deposits = money(flowValue.amount);
          row.marketChange = money(change);
          row.returnPct = base > 0 ? `${((change / base) * 100).toFixed(2)}%` : 'not defined';
        }
      }
      rows.push(row);
    }
    result.push({ id: account.id, name: account.name, periods: rows, gaps });
  }
  return { accounts: result };
}
