// The newest statement balance of an account and currency, plus the transactions after it. Months in between may be
// missing: the latest statement is still the best figure there is. Returns null when no statement gives a balance.
export function latestBalance({ account, currency, rows, batches }) {
  const point = batches.filter((batch) => batch.account === account).flatMap((batch) => batch.balances ?? [])
    .filter((p) => p.currency === currency).sort((x, y) => y.asOf.localeCompare(x.asOf))[0];
  if (!point) return null;
  const later = rows.filter((row) => row.account === account && row.currency === currency && row.date > point.asOf);
  return {
    amount: point.amount + later.reduce((sum, row) => sum + row.amount, 0),
    asOf: later.reduce((latest, row) => (row.date > latest ? row.date : latest), point.asOf),
  };
}

// The balance of an account and currency on a date: the nearest statement balance on or before it plus the rows in
// between, else the nearest one after it minus the rows in between. null with no statement. `asOf` is the date the
// figure really stands for: the date is not claimed beyond the last statement or row there is.
export function balanceAt({ account, currency, rows, batches, date }) {
  const points = batches.filter((batch) => batch.account === account).flatMap((batch) => batch.balances ?? [])
    .filter((p) => p.currency === currency).sort((x, y) => x.asOf.localeCompare(y.asOf));
  if (!points.length) return null;
  const mine = rows.filter((row) => row.account === account && row.currency === currency);
  const sum = (items) => items.reduce((total, row) => total + row.amount, 0);
  const before = points.filter((p) => p.asOf <= date).at(-1);
  if (before) {
    const between = mine.filter((row) => row.date > before.asOf && row.date <= date);
    return { amount: before.amount + sum(between), asOf: between.reduce((latest, row) => (row.date > latest ? row.date : latest), before.asOf) };
  }
  const after = points[0];
  return { amount: after.amount - sum(mine.filter((row) => row.date > date && row.date <= after.asOf)), asOf: date };
}
