import { latestMonth } from './month-data.js';

// One total over dated values (each converted at its own date); a missing rate makes it partial, never zero.
async function totalLine({ id, label, points, convert, displayCurrency, formatAmount }) {
  const line = { id, label, value: null, asOf: null, partial: false, note: 'No data yet' };
  let total = 0;
  let added = false;
  const notes = [];
  for (const { amount, currency, asOf } of points) {
    const converted = await convert({ amount, currency }, displayCurrency, asOf);
    if (converted.unavailable) {
      line.partial = true;
      notes.push(`No rate for ${currency} on ${asOf}`);
      continue;
    }
    total += converted.amount;
    added = true;
    if (!line.asOf || asOf > line.asOf) line.asOf = asOf;
  }
  if (added) line.value = formatAmount(total, displayCurrency);
  if (notes.length) line.note = notes.join('; ');
  else if (added) line.note = null;
  return line;
}

// The latest dated statement value of each broker account and currency.
function brokerPoints(accounts, batches) {
  const points = [];
  for (const account of accounts.filter(({ kind }) => kind === 'broker')) {
    const latest = new Map();
    for (const point of batches.filter((batch) => batch.account === account.id)
      .flatMap((batch) => batch.balances ?? [])) {
      if (!latest.has(point.currency) || point.asOf > latest.get(point.currency).asOf) {
        latest.set(point.currency, point);
      }
    }
    for (const [currency, point] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
      points.push({ amount: point.amount, currency, asOf: point.asOf });
    }
  }
  return points;
}

// The latest dated value of each pension or insurance entry, by name.
function entryPoints(entries) {
  const latest = new Map();
  for (const entry of entries) {
    if (!latest.has(entry.name) || entry.asOf > latest.get(entry.name).asOf) latest.set(entry.name, entry);
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map(({ amount, currency, asOf }) => ({ amount, currency, asOf }));
}

export async function loadHome({ accounts, rows, batches = [], entries = [], makeBalances, convert,
  displayCurrency, formatAmount }) {
  const common = { convert, displayCurrency, formatAmount };
  const investments = await totalLine({ id: 'investments', label: 'Total investments',
    points: brokerPoints(accounts, batches), ...common });
  const pension = await totalLine({ id: 'pension', label: 'Total pension and insurance',
    points: entryPoints(entries), ...common });
  const month = latestMonth(rows);
  const cash = {
    id: 'cash', label: 'Total cash', value: null, asOf: null, partial: false, note: null,
  };
  if (!month) {
    cash.note = 'No data yet';
    return { month, lines: [cash, investments,
      pension] };
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
    pension] };
}
