import { el, columns, tiles } from './charts.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The Overview's trend: bank money in and out for the last six months, and the savings figures of the chosen month.
export function renderDashboard(root, data, month) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#dashboard-body');
  box.replaceChildren();
  if (!data.months.length) { box.append(el(doc, 'p', 'No months yet.')); return; }
  const chosen = data.months.find((item) => item.month === month) ?? data.months[0];
  box.append(tiles(doc, [
    { label: 'Savings rate', value: chosen.savingsRate, note: chosen.month },
    { label: 'Could set aside a month', value: data.setAside ? data.setAside.value : 'Not available',
      note: data.setAside ? `average of ${data.setAside.months} complete month${data.setAside.months === 1 ? '' : 's'}`
        : 'needs complete months with money in' },
  ]));
  if (data.setAside) box.append(el(doc, 'p', `${data.setAside.note}.`, 'note'));
  if (data.months.length > 1) {
    box.append(el(doc, 'h3', 'Money in and out'));
    const recent = data.months.slice(0, 6).reverse(); // oldest first, left to right
    box.append(columns(doc, recent.map((item) => ({ label: SHORT[Number(item.month.slice(5)) - 1], a: item.cashInAmount, b: item.cashOutAmount,
      text: `${item.month}: money in ${item.cashIn}, money out ${item.cashOut}, cash flow ${item.cashFlow}` })),
    { aName: 'Money in', bName: 'Money out', caption: 'Bank money in and out by month' }));
  }
}
