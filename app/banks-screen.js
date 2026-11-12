import { el, figures, tiles } from './charts.js';

const ROWS = [['income', 'Income'], ['transfers', 'Transfers'], ['cardPayments', 'Card payments'], ['spending', 'Spending'],
  ['net', 'Left over']]; // what the account gained or lost this month

const opened = new Set(); // blocks the reader opened; kept when the screen redraws

export function renderBanks(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#banks-accounts');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No bank accounts yet.')); return; }
  const block = (title, item) => {
    const section = el(doc, 'details', undefined, 'block'); // closed until asked for
    section.append(el(doc, 'summary', title));
    section.open = opened.has(title);
    section.addEventListener('toggle', () => (section.open ? opened.add(title) : opened.delete(title)));
    if (item.balances) {
      const several = item.balances.length > 1;
      section.append(tiles(doc, item.balances.map(({ currency, value, asOf, note, original }) => ({
        label: several ? `Balance, ${currency} part` : 'Balance', value: value ?? 'Not known',
        note: value ? [`as of ${asOf}`, original ? `${original} originally` : null, note].filter(Boolean).join('; ') : note }))));
    }
    const count = item.note ? item.note.split('; ').length : 0;
    const flag = item.partial ? ` (at least${count ? `; ${count} not converted` : ''})` : '';
    section.append(figures(doc, ROWS.map(([key, label]) => ({ label, text: item[key] + (item.partial ? ' +' : '') })),
      { caption: `${title}: money in and out this month` }));
    if (item.partial) section.append(el(doc, 'p', `Incomplete${flag}: ${item.note ?? ''}`, 'note'));
    return section;
  };
  for (const account of data.accounts) box.append(block(account.name, account));
  box.append(block('All accounts', { ...data.totals, amounts: data.totals.amounts }));
}
