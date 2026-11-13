import { columns, el, grid, segmented } from './charts.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let shown = 0; // which account's monthly chart is shown; kept across redraws

// One table for every bank and debit account (a row each, then the total), then one monthly chart for the chosen account.
export function renderBanks(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#banks-accounts');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No bank accounts yet.')); return; }
  const several = [...data.accounts, data.totals].some((item) => !/^-?0(\.0+)?\s/.test(item.transfers)); // the column appears once any transfer exists
  // Opening, Closing and Change come from the statement; the columns after them classify what happened in between.
  const headers = ['Account', 'Opening', 'Closing', 'Change', 'Income', ...(several ? ['Transfers'] : []), 'Card payments', 'Spending', 'Saved'];
  const currency = data.totals.income.split(' ').at(-1); // shown once in the caption, not in every cell
  const bare = (text) => text.replace(/ [A-Z]{3}(?= |$)/g, '');
  const plus = (item, text) => bare(text) + (item.partial ? ' +' : '');
  const cells = (name, item) => [name, bare(item.opening), bare(item.closing), bare(item.change), plus(item, item.income),
    ...(several ? [plus(item, item.transfers)] : []), plus(item, item.cardPayments), plus(item, item.spending), plus(item, item.saved)];
  const rows = data.accounts.map((account) => ({ cells: cells(account.name, account) }));
  if (data.accounts.length > 1) rows.push({ cells: cells('All accounts', data.totals), total: true });
  box.append(grid(doc, headers, rows, { caption: `Bank accounts, ${data.month}, amounts in ${currency}` }));
  const notes = [...data.accounts.filter(({ balances }) => balances.some(({ note, value }) => note || !value)).flatMap(({ name, balances }) =>
    balances.filter(({ note }) => note).map(({ note }) => `${name}: ${note}`)),
  ...data.accounts.filter(({ closedAsOf }) => closedAsOf).map(({ name, closedAsOf }) => `${name}: the data ends ${closedAsOf}, so Closing is as of that date.`)];
  const incomplete = [...data.accounts, data.totals].filter((item) => item.partial && item.note).map((item) => item.note);
  for (const text of [...notes, ...incomplete]) box.append(el(doc, 'p', text, 'note'));

  const withTrend = data.accounts.filter(({ id }) => data.trend?.[id]?.length > 1);
  if (withTrend.length) {
    if (shown >= withTrend.length) shown = 0;
    box.append(el(doc, 'h3', 'Cash in and out by month'));
    if (withTrend.length > 1) {
      box.append(segmented(doc, withTrend.map(({ name }, index) => ({ value: index, label: name })), shown,
        (index) => { shown = index; renderBanks(root, data); }, 'Choose an account'));
    }
    const account = withTrend[shown];
    box.append(columns(doc, data.trend[account.id].map((month) => ({ label: SHORT[Number(month.month.slice(5)) - 1], a: month.in, b: month.out,
      text: `${month.month}: cash in ${month.inText}, cash out ${month.outText}` })),
    { aName: 'Cash in', bName: 'Cash out', caption: `${account.name}: cash in and out by month` }));
  }
}
