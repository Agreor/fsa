const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const label = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ? `${names[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : month;
import { figures, tiles } from './charts.js';

const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (doc, text, action, kind = '') => {
  const node = el(doc, 'button', text);
  if (kind) node.className = kind;
  node.setAttribute('aria-label', text);
  node.addEventListener('click', action);
  return node;
};

export function renderMonth(root, data, handlers) {
  const doc = root.ownerDocument;
  const regions = Object.fromEntries([...root.querySelectorAll('[data-region]')]
    .map((region) => [region.getAttribute('data-region'), region]));
  for (const region of Object.values(regions)) region.replaceChildren();
  if (data.empty) {
    regions.summary.textContent = 'No transactions yet. Import a statement in the Data tab.';
    for (const key of ['month-picker', 'categories', 'notice', 'suggested']) {
      regions[key].hidden = true;
    }
    return;
  }
  for (const region of Object.values(regions)) region.hidden = false;
  const select = el(doc, 'select');
  select.setAttribute('aria-label', 'Choose month');
  for (const month of data.months) {
    const option = el(doc, 'option', label(month)); option.value = month;
    option.selected = month === data.month; select.append(option);
  }
  select.addEventListener('change', () => handlers.onMonth(select.value));
  regions['month-picker'].append(select);
  const HEADLINE = ['Spending', 'Saved or invested', 'Cash flow']; // income is shown per bank account, not as a headline
  const headline = data.summary.filter((item) => HEADLINE.includes(item.label)).map((item) => item.label === 'Cash flow'
    ? { ...item, note: 'net change in cash: cash in minus cash out' } : item);
  const shown = headline.filter(({ label, value }) => label !== 'Saved or invested' || !/^-?0(\.0+)?\b/.test(value)); // the tile appears once something is saved
  regions.summary.append(tiles(doc, shown.map(({ label, value, note }) => (data.missingBank && label === 'Cash flow'
    ? { label, value: 'No bank statement', note: 'import your bank account for this month' }
    : { label, value: data.incomplete ? `at least ${value}` : value, note }))));
  if (data.incompleteNote) {
    const note = el(doc, 'p', data.incompleteNote);
    note.setAttribute('role', 'status');
    regions.summary.append(note);
  }
  if (data.spendingNote) regions.summary.append(el(doc, 'p', data.spendingNote));
  // The category pie lives in Spending; this view keeps the month's largest charges.
  if (data.largest?.length) regions.categories.append(figures(doc, data.largest, { caption: 'Largest charges this month' }));
  else regions.categories.textContent = 'No spending in this month.';
  regions.notice.hidden = !data.notice;
  if (data.notice) regions.notice.textContent = data.notice;
  regions.suggested.hidden = !data.suggested.length;
  for (const record of data.suggested) {
    const block = el(doc, 'section');
    for (const leg of record.legs) block.append(el(doc, 'p',
      `${leg.date} ${leg.description} ${leg.displayAmount}`));
    block.append(button(doc, 'Confirm transfer', () => handlers.onConfirm(record.id), 'primary'));
    block.append(button(doc, 'Not a transfer', () => handlers.onNotTransfer(
      record.legs.map((leg) => leg.rowId))));
    regions.suggested.append(block);
  }
}
