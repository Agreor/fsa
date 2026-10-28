const openingKey = (account, currency) => `opening:${account}|${currency}`;
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function createBalances({ backend }) {
  const rows = () => backend.list("row:");
  const batches = () => backend.list("batch:");
  const opening = (account, currency) => backend.get(openingKey(account, currency));
  const calculate = async (account, currency, asOf) => {
    const start = await opening(account, currency);
    if (!start) return { known: false };
    if (asOf !== undefined && asOf < start.date) return { known: false };
    const amount = (await rows()).filter(row => row.account === account && row.currency === currency
      && row.date > start.date && (asOf === undefined || row.date <= asOf))
      .reduce((sum, row) => sum + row.amount, start.amount);
    return { known: true, amount, openingDate: start.date };
  };
  return {
    async setOpening(account, currency, date, amount) {
      if (!account || !currency || !validDate(date) || !Number.isSafeInteger(amount)) {
        throw new TypeError("opening requires account, currency, date, and integer amount");
      }
      const value = { account, currency, date, amount };
      await backend.commit([{ key: openingKey(account, currency), value }]);
      return value;
    },
    async clearOpening(account, currency) {
      await backend.commit([{ key: openingKey(account, currency), value: undefined }]);
    },
    balance(account, currency, asOf) { return calculate(account, currency, asOf); },
    async checkStatements(account) {
      const result = [];
      for (const batch of await batches()) {
        if (account !== undefined && batch.account !== account) continue;
        for (const point of batch.balances ?? []) {
          const start = await opening(batch.account, point.currency);
          const computedResult = !start || point.asOf < start.date ? { known: false }
            : await calculate(batch.account, point.currency, point.asOf);
          const computed = computedResult.known ? computedResult.amount : null;
          const difference = computed === null ? null : computed - point.amount;
          result.push({ account: batch.account, batchId: batch.id, currency: point.currency,
            asOf: point.asOf, statement: point.amount, computed, difference,
            status: computed === null ? "unchecked" : difference === 0 ? "match" : "mismatch" });
        }
      }
      return result;
    },
    async coverageGaps(account) {
      const ranges = (await batches()).filter(batch => batch.account === account && batch.coverage)
        .map(batch => batch.coverage).sort((a, b) => a.from.localeCompare(b.from));
      const covered = [];
      for (const range of ranges) {
        const last = covered.at(-1);
        if (last && Date.parse(`${range.from}T00:00:00Z`) <= Date.parse(`${last.to}T00:00:00Z`) + 86400000) {
          if (range.to > last.to) last.to = range.to;
        } else covered.push({ from: range.from, to: range.to });
      }
      const gaps = covered.slice(1).map((range, index) => ({
        from: new Date(Date.parse(`${covered[index].to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10),
        to: new Date(Date.parse(`${range.from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10),
      }));
      return { covered, gaps };
    },
  };
}
