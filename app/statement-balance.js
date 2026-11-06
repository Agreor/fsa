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
