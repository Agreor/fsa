import { el, shares, tiles } from './charts.js';

export function renderCards(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#cards-list');
  box.replaceChildren();
  if (!data.cards.length) { box.append(el(doc, 'p', 'No credit cards yet.')); return; }
  for (const card of data.cards) {
    const section = el(doc, 'div', undefined, 'block');
    section.append(el(doc, 'h3', card.name));
    const count = card.note ? card.note.split('; ').length : 0;
    const atLeast = card.partial ? 'at least ' : '';
    section.append(tiles(doc, [
      { label: 'Charges this month', value: atLeast + card.charges, note: card.partial ? `${count} not converted` : undefined },
      { label: 'Payments this month', value: atLeast + card.payments },
      { label: card.statement ? `Statement debt (${card.statement.asOf})` : 'Statement',
        value: card.statement ? card.statement.debt : 'none imported' },
      { label: 'Owed now', value: card.owed ?? 'unavailable', note: card.owed ? undefined : 'needs a statement' },
    ]));
    if (card.categories.length) {
      section.append(shares(doc, card.categories.map(({ category, amount, value }) => ({ label: category, amount, text: value })),
        { caption: `${card.name}: charges by category` }));
    }
    if (card.partial) section.append(el(doc, 'p', `Partial: ${card.note ?? ''}`, 'note'));
    box.append(section);
  }
}
