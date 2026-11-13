import { latestBalance } from './statement-balance.js';
import { latestMonth } from './month-data.js';

// One total over dated values (each converted at its own date); a missing rate makes it partial, never zero.
async function totalLine({ id, label, points, convert, displayCurrency, formatAmount, totals }) {
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
  if (added) { line.value = formatAmount(total, displayCurrency); totals.set(id, total); }
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
      const held = latest.get(point.currency);
      // Same date twice: the larger amount wins, so the figure never depends on storage order.
      if (!held || point.asOf > held.asOf || (point.asOf === held.asOf && point.amount > held.amount)) {
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

// What net worth is made of, for the composition chart: only positive parts.
const LABELS = { cash: 'Cash', investments: 'Investments', pension: 'Pension and insurance' };
const partsOf = (totals, money) => ['cash', 'investments', 'pension'].filter((id) => totals.get(id) > 0)
  .map((id) => ({ id, label: LABELS[id], amount: totals.get(id), text: money(totals.get(id)) }));

// What is owed on the credit cards: for each card and currency the newest statement debt plus the rows after it, in
// the display currency at the statement date. A card with no statement is unknown, which makes the figure partial.
async function cardDebt({ accounts, rows, batches, convert, displayCurrency }) {
  let amount = 0;
  let partial = false;
  const notes = [];
  for (const card of accounts.filter(({ kind }) => kind === 'credit_card')) {
    const currencies = [...new Set([...rows.filter((row) => row.account === card.id).map((row) => row.currency),
      ...batches.filter((batch) => batch.account === card.id).flatMap((batch) => batch.balances ?? []).map(({ currency }) => currency)])].sort();
    if (!currencies.length) continue;
    let known = false;
    for (const currency of currencies) {
      const held = latestBalance({ account: card.id, currency, rows, batches });
      if (!held) continue;
      known = true;
      // Valued at the statement date, the same date the Cards tab uses, so the two screens agree.
      const stated = batches.filter((batch) => batch.account === card.id).flatMap((batch) => batch.balances ?? [])
        .filter((p) => p.currency === currency).map(({ asOf }) => asOf).sort().at(-1);
      const converted = await convert({ amount: -held.amount, currency }, displayCurrency, stated);
      if (converted.unavailable) { partial = true; notes.push(`No rate for ${currency} on ${stated} (${card.name})`); } else amount += converted.amount;
    }
    if (!known) { partial = true; notes.push(`Card debt unknown for ${card.name}: no statement`); }
  }
  return { amount, partial, note: notes.length ? notes.join('; ') : null };
}

// Net worth is assets minus liabilities: the cash, investment and pension lines that have a value, less what the cards
// owe. Partial when any line or the debt is partial or has no figure at all.
const netWorthOf = (totals, lines, liabilities, money) => {
  const known = lines.filter(({ id }) => totals.has(id));
  if (!known.length) return null;
  const amount = known.reduce((sum, { id }) => sum + totals.get(id), 0) - liabilities.amount;
  // A missing asset makes the figure a floor ("at least"); a missing debt makes it a ceiling ("at most"); both: neither.
  const assetsPartial = lines.some((line) => line.partial);
  const bound = assetsPartial === liabilities.partial ? null : assetsPartial ? 'least' : 'most';
  return { amount, text: money(amount), partial: assetsPartial || liabilities.partial, bound };
};

export async function loadHome({ accounts, rows, batches = [], entries = [], makeBalances, convert,
  displayCurrency, formatAmount }) {
  const money = (amount) => formatAmount(amount, displayCurrency);
  const liabilities = await cardDebt({ accounts, rows, batches, convert, displayCurrency });
  const totals = new Map(); // id -> amount in the display currency (minor units), for the charts
  const common = { convert, displayCurrency, formatAmount, totals };
  const investments = await totalLine({ id: 'investments', label: 'Total investments',
    points: brokerPoints(accounts, batches), ...common });
  const pension = await totalLine({ id: 'pension', label: 'Total pension and insurance',
    points: entryPoints(entries), ...common });
  const month = latestMonth(rows);
  const cash = {
    id: 'cash', label: 'Total cash', value: null, asOf: null, partial: false, note: null,
  };
  const statementDates = batches.flatMap((batch) => batch.balances ?? []).map(({ asOf }) => asOf).sort();
  if (!month && !statementDates.length) {
    cash.note = 'No data yet';
    return { month, lines: [cash, investments, pension], parts: partsOf(totals, money), accounts: [], netWorth: netWorthOf(totals, [cash, investments, pension], liabilities, money),
    liabilities: { ...liabilities, text: money(liabilities.amount) } };
  }
  // Statements alone are enough: with no transactions the newest statement date stands in for the month.
  const monthKey = month ?? statementDates.at(-1).slice(0, 7);
  const [year, monthNumber] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  cash.asOf = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  let total = 0;
  let added = false;
  const notes = [];
  const accountTotals = [];
  const eligible = accounts.filter((account) => account.kind === 'bank' || account.kind === 'debit_card');
  const balances = makeBalances();
  for (const account of eligible) {
    const currencies = [...new Set([...rows.filter((row) => row.account === account.id).map((row) => row.currency),
      ...batches.filter((batch) => batch.account === account.id).flatMap((batch) => batch.balances ?? [])
        .map(({ currency }) => currency)])].sort();
    for (const currency of currencies) {
      const statement = latestBalance({ account: account.id, currency, rows, batches });
      const balance = statement ? { known: true, amount: statement.amount } : await balances.balance(account.id, currency, cash.asOf);
      if (!balance.known) {
        cash.partial = true;
        notes.push(`Opening balance missing for ${account.name}`);
        continue;
      }
      // Converted at the statement date, like the Banks section, so both show the same figure.
      const at = statement ? statement.asOf : cash.asOf;
      const converted = await convert({ amount: balance.amount, currency }, displayCurrency, at);
      if (converted.unavailable) {
        cash.partial = true;
        notes.push(`No rate for ${currency} on ${at} (${account.name})`);
        continue;
      }
      total += converted.amount;
      added = true;
      const held = accountTotals.find((item) => item.name === account.name);
      if (held) held.amount += converted.amount; else accountTotals.push({ name: account.name, amount: converted.amount });
    }
  }
  cash.value = added ? formatAmount(total, displayCurrency) : null;
  cash.note = notes.length ? notes.join('; ') : null;
  if (added) totals.set('cash', total);
  const accountsShown = accountTotals.filter(({ amount }) => amount > 0).sort((a, b) => b.amount - a.amount)
    .map(({ name, amount }) => ({ name, amount, text: formatAmount(amount, displayCurrency) }));
  return { month, lines: [cash, investments, pension], parts: partsOf(totals, money), accounts: accountsShown, netWorth: netWorthOf(totals, [cash, investments, pension], liabilities, money),
    liabilities: { ...liabilities, text: money(liabilities.amount) } };
}
