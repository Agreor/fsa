import { el, tiles, shares, bars } from './charts.js';

// Home is the snapshot: where you stand now. Trends and spending detail live in Money.
// data: loadHome's result plus `dashboard` (loadDashboard's result, or null) and `attention` (sentences).
export function renderHome(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#home-body');
  box.replaceChildren();
  const [cash, investments, pension] = data.lines;
  if (!data.netWorth) {
    box.append(el(doc, 'p', 'Nothing imported yet. Import a statement in the Data tab to see your totals.'));
    return;
  }

  const line = (item) => ({ label: item.label.replace('Total ', '').replace(/^./, (c) => c.toUpperCase()),
    value: item.value === null ? '-' : item.partial ? `at least ${item.value}` : item.value,
    note: [item.asOf ? `as of ${item.asOf}` : '', item.note ?? ''].filter(Boolean).join(' · ') || undefined });
  box.append(el(doc, 'h3', 'Net worth'));
  box.append(tiles(doc, [{ label: 'Net worth', value: data.netWorth.partial ? `at least ${data.netWorth.text}` : data.netWorth.text,
    note: 'cash, investments, pension and insurance' }]));
  box.append(tiles(doc, [line(cash), line(investments), line(pension)]));
  if (data.parts.length > 1) {
    box.append(shares(doc, data.parts.map(({ label, amount, text }) => ({ label, amount, text })),
      { caption: 'What your net worth is made of' }));
  }

  const dash = data.dashboard;
  if (dash?.months.length) {
    const latest = dash.months[0];
    box.append(el(doc, 'h3', `Latest month: ${latest.month}`));
    box.append(tiles(doc, [
      { label: 'Cash flow', value: latest.cashFlow, note: 'bank money in minus out' },
      { label: 'Savings rate', value: latest.savingsRate, note: latest.partial ? 'incomplete month' : undefined },
      ...(latest.savedAmount > 0 ? [{ label: 'Saved or invested', value: latest.saved, note: 'left the bank, not spending' }] : []),
    ]));
  }

  if (data.accounts.length > 1) {
    box.append(el(doc, 'h3', 'Cash by account'));
    box.append(bars(doc, data.accounts.map(({ name, amount, text }) => ({ label: name, amount, text })), { caption: 'Cash by account' }));
  }

  if (data.attention?.length) {
    box.append(el(doc, 'h3', 'Needs a look'));
    const list = el(doc, 'ul');
    for (const text of data.attention) list.append(el(doc, 'li', text));
    box.append(list);
  }
}
