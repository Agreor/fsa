const AMOUNT = /^([-+]?)(\d+)(?:[.,](\d{1,2}))?$/;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// Whole minor units, parsed from the digits so 1.15 is never a float.
export function parseAmount(text) {
  const match = typeof text === 'string' ? AMOUNT.exec(text.trim()) : null;
  if (!match) return null;
  const minor = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  const value = match[1] === '-' ? -minor : minor;
  return value >= -SAFE && value <= SAFE ? Number(value) : null;
}

const byAsOf = (a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);

export function createChecksData({ listAccounts, listBatches, listRows, makeBalances, formatAmount }) {
  return { async load() {
    const [accounts, batches, rows] = await Promise.all([listAccounts(), listBatches(), listRows()]);
    const balances = makeBalances();
    const checks = await balances.checkStatements();
    return { accounts: await Promise.all(accounts.map(async ({ id, name }) => {
      const points = batches.filter((batch) => batch.account === id).flatMap((batch) => batch.balances ?? []);
      const currencies = [...new Set([...rows.filter((row) => row.account === id).map((row) => row.currency),
        ...points.map((point) => point.currency)])].sort();
      const { covered, gaps } = await balances.coverageGaps(id);
      return { id, name, covered, gaps, currencies: await Promise.all(currencies.map(async (currency) => {
        const start = await balances.balance(id, currency);
        const opening = start.known ? { known: true, date: start.openingDate, display: formatAmount(
          (await balances.balance(id, currency, start.openingDate)).amount, currency) } : { known: false };
        const first = points.filter((point) => point.currency === currency).sort(byAsOf)[0];
        return { currency, opening,
          suggestion: start.known || !first ? null : { date: first.asOf, amount: first.amount,
            display: formatAmount(first.amount, currency) },
          checks: checks.filter((check) => check.account === id && check.currency === currency)
            .sort(byAsOf).map((check) => ({ asOf: check.asOf, status: check.status,
              statement: formatAmount(check.statement, currency),
              computed: check.computed === null ? null : formatAmount(check.computed, currency),
              difference: check.difference === null ? null : formatAmount(check.difference, currency) })) };
      })) };
    })) };
  } };
}

export function createChecksActions({ makeBalances, report, refresh }) {
  const run = async (write) => {
    try { await write(); }
    catch (error) { report(`Could not save the opening balance: ${error.message}`); }
    finally { try { await refresh(); } catch {} }
  };
  const open = (account, currency, date, amount) =>
    makeBalances().setOpening(account, currency, date, amount);
  return {
    setOpening: (account, currency, date, amountText) => run(async () => {
      const amount = parseAmount(amountText);
      if (amount === null) throw new TypeError('enter an amount like 1234.56');
      await open(account, currency, date, amount);
    }),
    useSuggestion: (account, currency, suggestion) => run(() =>
      open(account, currency, suggestion.date, suggestion.amount)),
    clearOpening: (account, currency) => run(() => makeBalances().clearOpening(account, currency)),
  };
}
