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
    const notes = []; // statements that cannot form a period are said, never dropped silently
    for (const batch of batches.filter((item) => item.account === account.id)) {
      const points = [...(batch.balances ?? [])].sort((a, b) => a.asOf.localeCompare(b.asOf));
      if (points.length === 1) {
        notes.push(`One balance only (${formatAmount(points[0].amount, points[0].currency)} on ${points[0].asOf}): a period needs two.`);
        continue;
      }
      if (points.length > 1 && points[0].currency !== points.at(-1).currency) {
        notes.push(`A statement ending ${points.at(-1).asOf} mixes currencies and cannot form a period.`);
        continue;
      }
      if (points.length < 2) continue;
      periods.push({ start: points[0], end: points.at(-1), deposits: batch.netDeposits });
    }
    periods.sort((a, b) => a.start.asOf.localeCompare(b.start.asOf));
    const rows = [];
    const gaps = [];
    let covered = null; // the latest end date of any earlier statement
    for (const { start, end, deposits } of periods) {
      const row = { from: next(start.asOf), to: end.asOf, start: null, deposits: null, end: null,
        marketChange: null, returnPct: null, endAmount: null, partial: false, note: null };
      if (covered && start.asOf > next(covered)) gaps.push({ from: next(covered), to: start.asOf }); // the very next day is not a gap
      if (covered && start.asOf < covered) row.note = 'Overlaps the previous statement';
      if (!covered || end.asOf > covered) covered = end.asOf;
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
        row.endAmount = endValue.amount; // for the value-over-time line
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
    result.push({ id: account.id, name: account.name, periods: rows, gaps, notes });
  }
  return { accounts: result };
}
