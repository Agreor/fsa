import { el, bars, tiles } from './charts.js';

const ROWS = [['income', 'Income'], ['transfers', 'Transfers'], ['cardPayments', 'Card payments'], ['spending', 'Spending']];

export function renderBanks(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#banks-accounts');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No bank accounts yet.')); return; }
  const block = (title, item) => {
    const section = el(doc, 'div', undefined, 'block');
    section.append(el(doc, 'h3', title));
    if (item.balances) {
      section.append(tiles(doc, item.balances.map(({ currency, value, asOf, note }) => ({
        label: `Balance ${currency}`, value: value ?? 'Not known', note: value ? `as of ${asOf}` : note }))));
    }
    const count = item.note ? item.note.split('; ').length : 0;
    const flag = item.partial ? ` (at least${count ? `; ${count} not converted` : ''})` : '';
    section.append(bars(doc, ROWS.map(([key, label]) => ({ label, amount: item.amounts[key],
      text: item[key] + (item.partial ? ' +' : '') })), { caption: `${title}: money in and out this month` }));
    if (item.partial) section.append(el(doc, 'p', `Incomplete${flag}: ${item.note ?? ''}`, 'note'));
    return section;
  };
  for (const account of data.accounts) box.append(block(account.name, account));
  box.append(block('All accounts', { ...data.totals, amounts: data.totals.amounts }));
}
