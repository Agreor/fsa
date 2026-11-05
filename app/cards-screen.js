const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  node.textContent = text;
  return node;
};
const line = (doc, label, value) => el(doc, 'p', `${label}: ${value}`);

export function renderCards(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#cards-list');
  box.replaceChildren();
  if (!data.cards.length) { box.append(el(doc, 'p', 'No credit cards yet.')); return; }
  for (const card of data.cards) {
    const section = el(doc, 'div', '');
    section.append(el(doc, 'h3', card.name));
    for (const { category, value } of card.categories) section.append(line(doc, category, value));
    section.append(line(doc, 'Charges this month', card.charges),
      line(doc, 'Payments this month', card.payments));
    section.append(card.statement
      ? line(doc, `Statement debt (${card.statement.asOf})`, card.statement.debt)
      : line(doc, 'Statement', 'none imported'));
    section.append(line(doc, 'Owed now', card.owed ?? 'unavailable without a statement'));
    if (card.partial) section.append(el(doc, 'p', `Partial: ${card.note ?? ''}`));
    box.append(section);
  }
}
