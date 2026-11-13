import { el, figures, shares, segmented } from './charts.js';

let chosen = 0; // which range is shown; kept across redraws

// Where the money went: one pie with a range switch, then what moved against the month before.
export function renderSpending(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#spending-body');
  box.replaceChildren();
  if (!data.months.length) { box.append(el(doc, 'p', 'No months yet.')); return; }
  const ranges = data.windows.filter((window, index, all) => index === 0 || window.months !== all[index - 1].months);
  if (chosen >= ranges.length) chosen = 0;
  if (ranges.length > 1) {
    box.append(segmented(doc, ranges.map(({ label }, index) => ({ value: index, label })), chosen,
      (index) => { chosen = index; renderSpending(root, data); }));
  }
  const window = ranges[chosen];
  box.append(el(doc, 'p', `${window.total} over ${window.months} month${window.months === 1 ? '' : 's'}`, 'chart-total'));
  box.append(el(doc, 'p', `Bank accounts over the same months: cash out ${window.cashOut}, cash in ${window.cashIn}`, 'note'));
  box.append(shares(doc, window.categories.map(({ category, amount, value }) => ({ label: category, amount, text: value })),
    { caption: `Spending by category, ${window.label}` }));
  if (window.otherCredits) box.append(el(doc, 'p', `Refunds and credits outside these categories: ${window.otherCredits}`, 'note'));
  if (window.partial) box.append(el(doc, 'p', 'Incomplete: some amounts could not be converted.', 'note'));
  if (data.movers?.length) {
    box.append(el(doc, 'h3', `What moved since ${data.moversSince}`));
    box.append(figures(doc, data.movers.map(({ category, nowText, beforeText, change, changeText }) => ({ label: category,
      text: `${change > 0 ? '▲' : '▼'} ${changeText} (${nowText}, was ${beforeText})` })), { caption: 'Spending by category against the month before' }));
  }
}
