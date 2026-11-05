import { latestMonth } from './month-data.js';

export async function loadHome({ accounts, rows, makeBalances, convert, displayCurrency, formatAmount }) {
  const month = latestMonth(rows);
  const cash = {
    id: 'cash', label: 'Total cash', value: null, asOf: null, partial: false, note: null,
  };
  const empty = (id, label) => ({ id, label, value: null, asOf: null, partial: false, note: 'No data yet' });
  if (!month) {
    cash.note = 'No data yet';
    return { month, lines: [cash, empty('investments', 'Total investments'),
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
  return { month, lines: [cash, empty('investments', 'Total investments'),
    empty('pension', 'Total pension and insurance')] };
}
