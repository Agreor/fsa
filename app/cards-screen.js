import { el, grid, shares } from './charts.js';

// One table for every credit card, then one pie of the month's charges across all cards.
export function renderCards(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#cards-list');
  box.replaceChildren();
  if (!data.cards.length) { box.append(el(doc, 'p', 'No credit cards yet.')); return; }
  const rows = data.cards.map((card) => {
    const atLeast = card.partial ? 'at least ' : '';
    return { cells: [card.name, atLeast + card.charges, atLeast + card.payments,
      card.statement ? `${card.statement.debt} (${card.statement.asOf})` : 'none imported', card.owed ?? 'needs a statement'] };
  });
  box.append(grid(doc, ['Card', 'Charges this month', 'Payments this month', 'Statement debt', 'Owed now'], rows,
    { caption: `Credit cards, ${data.month}` }));
  for (const card of data.cards.filter(({ partial, note }) => partial && note)) box.append(el(doc, 'p', `${card.name}: ${card.note}`, 'note'));
  const sums = new Map();
  for (const card of data.cards) for (const { category, amount } of card.categories) sums.set(category, (sums.get(category) ?? 0) + amount);
  const slices = [...sums].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  if (slices.length) {
    const currency = data.cards[0].charges.split(' ').at(-1); // the display currency, as the figures show it
    const decimals = (data.cards[0].charges.match(/\.(\d+)/)?.[1] ?? '00').length;
    const fmt = (amount) => `${(amount / 10 ** decimals).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${currency}`;
    box.append(el(doc, 'h3', 'Charges by category'));
    box.append(shares(doc, slices.map(({ label, amount }) => ({ label, amount, text: fmt(amount) })), { caption: 'Credit card charges by category' }));
  }
}
