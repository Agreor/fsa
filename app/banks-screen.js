import { columns, el, grid, segmented } from './charts.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let shown = 0; // which account's monthly chart is shown; kept across redraws

// One table for every bank and debit account (a row each, then the total), then one monthly chart for the chosen account.
export function renderBanks(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#banks-accounts');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No bank accounts yet.')); return; }
  // The table reads left to right: Opening + Cash in - Cash out = Closing. Where the cash went is a second, smaller table.
  const currency = data.totals.income.split(' ').at(-1); // shown once in the caption, not in every cell
  const bare = (text) => text.replace(/ [A-Z]{3}(?= |$)/g, '');
  const plus = (item, text) => bare(text) + (item.partial ? ' +' : '');
  const early = data.accounts.some(({ closedAsOf }) => closedAsOf); // a Data to column only when some account's data ends before the month does
  const moved = [...data.accounts, data.totals].some((item) => item.amounts.ownMoves); // own-account transfers move the balance but are not cash in or out
  const cells = (name, item, upTo) => [name, bare(item.opening), plus(item, item.cashIn), plus(item, item.cashOut), ...(moved ? [bare(item.ownMoves)] : []), bare(item.closing), ...(early ? [upTo] : [])];
  const rows = data.accounts.map((account) => ({ cells: cells(account.name, account, account.closedAsOf ?? 'month end') }));
  if (data.accounts.length > 1) rows.push({ cells: cells('All accounts', data.totals, ''), total: true });
  box.append(grid(doc, ['Account', 'Opening', 'Cash in', 'Cash out', ...(moved ? ['Between your accounts'] : []), 'Closing', ...(early ? ['Data to'] : [])], rows,
    { caption: `Bank accounts, ${data.month}, amounts in ${currency}` }));
  const showOther = [...data.accounts, data.totals].some((item) => item.amounts.other !== 0);
  const split = (name, item) => [name, plus(item, item.spending), plus(item, item.cardPayments), plus(item, item.saved), ...(showOther ? [bare(item.other)] : [])];
  const splitRows = data.accounts.map((account) => ({ cells: split(account.name, account) }));
  if (data.accounts.length > 1) splitRows.push({ cells: split('All accounts', data.totals), total: true });
  box.append(el(doc, 'h3', 'Where cash out went'));
  box.append(grid(doc, ['Account', 'Spending', 'Card payments', 'Saved', ...(showOther ? ['Other'] : [])], splitRows,
    { caption: `Cash out by use, ${data.month}, amounts in ${currency}` }));
  const off = data.accounts.filter(({ gap, amounts }) => gap !== null && Math.abs(amounts.gap) >= 1);
  const notes = [...data.accounts.filter(({ balances }) => balances.some(({ note, value }) => note || !value)).flatMap(({ name, balances }) =>
    balances.filter(({ note }) => note).map(({ note }) => `${name}: ${note}`)),
  ...(off.length ? [`Opening + Cash in - Cash out is off Closing by ${off.map(({ name, gap }) => `${bare(gap)} (${name})`).join(', ')}. Usually exchange-rate differences on foreign-currency accounts; otherwise a statement may be missing.`] : [])];
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
