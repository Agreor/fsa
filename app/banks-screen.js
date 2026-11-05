const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  node.textContent = text;
  return node;
};
const line = (doc, label, value) => el(doc, 'p', `${label}: ${value}`);

export function renderBanks(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#banks-accounts');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No bank accounts yet.')); return; }
  const block = (title, item) => {
    const section = el(doc, 'div', '');
    section.append(el(doc, 'h3', title));
    if (item.balances) for (const { currency, value, asOf, note } of item.balances) {
      section.append(line(doc, `Balance ${currency} (${asOf})`, value ?? note));
    }
    section.append(line(doc, 'Income', item.income), line(doc, 'Transfers', item.transfers),
      line(doc, 'Card payments', item.cardPayments), line(doc, 'Spending', item.spending));
    if (item.partial) section.append(el(doc, 'p', `Partial: ${item.note ?? ''}`));
    return section;
  };
  for (const account of data.accounts) box.append(block(account.name, account));
  box.append(block('All accounts', data.totals));
}
