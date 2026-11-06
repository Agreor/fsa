import { el, bars, stacked, line, columns, tiles, segmented } from './charts.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let chosen = 0; // which window is shown; kept across redraws

export function renderDashboard(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#dashboard-body');
  box.replaceChildren();
  if (!data.months.length) { box.append(el(doc, 'p', 'No months yet.')); return; }
  if (chosen >= data.windows.length) chosen = 0;

  box.append(el(doc, 'h3', 'Where the money went'));
  box.append(segmented(doc, data.windows.map(({ label }, index) => ({ value: index, label })), chosen,
    (index) => { chosen = index; renderDashboard(root, data); }));
  const window = data.windows[chosen];
  box.append(el(doc, 'p', `${window.total} over ${window.months} month${window.months === 1 ? '' : 's'}`, 'chart-total'));
  const slices = window.categories.map(({ category, amount, value, share }) => ({ label: category, amount, text: value, share }));
  if (slices.length > 1) box.append(stacked(doc, slices, { caption: `Share of spending, ${window.label}` }));
  box.append(bars(doc, window.categories.map(({ category, amount, value, share }) => ({ label: category, amount,
    text: value, hint: share })), { caption: `Spending by category, ${window.label}` }));
  if (window.otherCredits) box.append(el(doc, 'p', `Refunds and credits outside these categories: ${window.otherCredits}`, 'note'));
  if (window.partial) box.append(el(doc, 'p', 'Incomplete: some amounts could not be converted.', 'note'));

  box.append(el(doc, 'h3', 'Income against spending'));
  const months = [...data.months].reverse(); // oldest first, left to right
  box.append(columns(doc, months.map((month) => ({
    label: `${SHORT[Number(month.month.slice(5)) - 1]}`, a: month.incomeAmount, b: month.spendingAmount,
    text: `${month.month}: income ${month.income}, spending ${month.spending}, net ${month.net}` })),
  { aName: 'Income', bName: 'Spending' }));
  const rated = months.filter((m) => m.incomeAmount > 0 && !m.partial);
  if (rated.length > 1) {
    box.append(el(doc, 'h3', 'Savings rate by month'));
    box.append(line(doc, rated.map((m) => ({ label: SHORT[Number(m.month.slice(5)) - 1], value: ((m.incomeAmount - m.spendingAmount) * 100) / m.incomeAmount,
      text: m.savingsRate })), { caption: 'Savings rate by month' }));
  }
  const latest = data.months[0];
  box.append(tiles(doc, [
    { label: 'Savings rate', value: latest.savingsRate, note: latest.month },
    { label: 'Could set aside a month', value: data.setAside ? data.setAside.value : 'Not available',
      note: data.setAside ? `average of ${data.setAside.months} complete month${data.setAside.months === 1 ? '' : 's'}`
        : 'needs complete months with income' },
  ]));
  if (data.setAside) box.append(el(doc, 'p', `${data.setAside.note}.`, 'note'));

  const table = el(doc, 'details');
  table.append(el(doc, 'summary', 'Figures by month'));
  for (const month of data.months) {
    table.append(el(doc, 'p', `${month.month}: income ${month.income}, spending ${month.spending}, `
      + `net ${month.net}, savings rate ${month.savingsRate}${month.partial ? ' (incomplete)' : ''}`));
  }
  box.append(table);
}
