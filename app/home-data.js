import { latestMonth } from './month-data.js';

// The latest dated statement value of each broker account and currency, converted at its own date.
async function investmentsLine({ accounts, batches, convert, displayCurrency, formatAmount }) {
  const line = { id: 'investments', label: 'Total investments', value: null, asOf: null, partial: false,
    note: 'No data yet' };
  let total = 0;
  let added = false;
  const notes = [];
  for (const account of accounts.filter(({ kind }) => kind === 'broker')) {
    const latest = new Map();
    for (const point of batches.filter((batch) => batch.account === account.id)
      .flatMap((batch) => batch.balances ?? [])) {
      if (!latest.has(point.currency) || point.asOf > latest.get(point.currency).asOf) {
        latest.set(point.currency, point);
      }
    }
    for (const [currency, point] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
      const converted = await convert({ amount: point.amount, currency }, displayCurrency, point.asOf);
      if (converted.unavailable) {
        line.partial = true;
        notes.push(`No rate for ${currency} on ${point.asOf}`);
        continue;
      }
      total += converted.amount;
      added = true;
      if (!line.asOf || point.asOf > line.asOf) line.asOf = point.asOf;
    }
  }
  if (added) line.value = formatAmount(total, displayCurrency);
  if (notes.length) line.note = notes.join('; ');
  else if (added) line.note = null;
  return line;
}

export async function loadHome({ accounts, rows, batches = [], makeBalances, convert, displayCurrency,
  formatAmount }) {
  const investments = await investmentsLine({ accounts, batches, convert, displayCurrency, formatAmount });
  const month = latestMonth(rows);
  const cash = {
    id: 'cash', label: 'Total cash', value: null, asOf: null, partial: false, note: null,
  };
  const empty = (id, label) => ({ id, label, value: null, asOf: null, partial: false, note: 'No data yet' });
  if (!month) {
    cash.note = 'No data yet';
    return { month, lines: [cash, investments,
      empty('pension', 'Total pension and insurance')] };
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  cash.asOf = `${month}-${String(lastDay).padStart(2, '0')}`;
  let total = 0;
  let added = false;
  const notes = [];
  const eligible = accounts.filter((account) => account.kind === 'bank' || account.kind === 'debit_card');
  const balances = makeBalances();
  for (const account of eligible) {
    const currencies = [...new Set(rows.filter((row) => row.account === account.id)
      .map((row) => row.currency))].sort();
    for (const currency of currencies) {
      const balance = await balances.balance(account.id, currency, cash.asOf);
      if (!balance.known) {
        cash.partial = true;
        notes.push(`Opening balance missing for ${account.name}`);
        continue;
      }
      const converted = await convert({ amount: balance.amount, currency }, displayCurrency, cash.asOf);
      if (converted.unavailable) {
        cash.partial = true;
        notes.push(`No rate for ${currency} on ${cash.asOf}`);
        continue;
      }
      total += converted.amount;
      added = true;
    }
  }
  cash.value = added ? formatAmount(total, displayCurrency) : null;
  cash.note = notes.length ? notes.join('; ') : null;
  return { month, lines: [cash, investments,
    empty('pension', 'Total pension and insurance')] };
}
