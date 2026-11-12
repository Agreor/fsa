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
const field = (doc, tag, label) => {
  const node = el(doc, tag);
  node.setAttribute('aria-label', label);
  return node;
};
const STATUS = {
  match: () => 'matches',
  mismatch: (check) => `differs by ${check.difference}`,
  unchecked: () => 'not checked yet, set an opening balance',
};

export function renderChecks(root, data, handlers) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  if (!data.accounts.length) { root.append(el(doc, 'p', 'No accounts yet.')); return; }
  for (const account of data.accounts) {
    const block = el(doc, 'div');
    block.append(el(doc, 'h3', account.name));
    for (const item of account.currencies) {
      const part = el(doc, 'div');
      part.append(el(doc, 'h4', item.currency));
      if (item.opening.known) {
        part.append(el(doc, 'p', `Opening balance: ${item.opening.display} on ${item.opening.date}`),
          button(doc, 'Clear opening balance', () => handlers.onClear(account.id, item.currency), 'danger'));
      } else {
        part.append(el(doc, 'p', 'Opening balance missing'));
        const date = field(doc, 'input', `Opening date for ${account.name} ${item.currency}`);
        date.type = 'date';
        const amount = field(doc, 'input', `Opening amount for ${account.name} ${item.currency}`);
        amount.inputMode = 'decimal';
        part.append(date, amount, button(doc, 'Set opening balance', () =>
          handlers.onSetOpening(account.id, item.currency, date.value, amount.value), 'primary'));
      }
      if (item.suggestion) {
        part.append(button(doc, `Use the statement balance (${item.suggestion.display} on `
          + `${item.suggestion.date})`, () => handlers.onUseSuggestion(account.id, item.currency,
          item.suggestion)));
      }
      const list = el(doc, 'ul');
      for (const check of item.checks) {
        list.append(el(doc, 'li', `${check.asOf}: statement ${check.statement}, computed `
          + `${check.computed ?? 'unknown'}, ${STATUS[check.status](check)}`));
      }
      part.append(list);
      block.append(part);
    }
    const coverage = el(doc, 'ul');
    for (const range of account.covered) {
      coverage.append(el(doc, 'li', `Covered: ${range.from} to ${range.to}`));
    }
    for (const gap of account.gaps) {
      coverage.append(el(doc, 'li', `No statement covers ${gap.from} to ${gap.to}`));
    }
    block.append(coverage);
    root.append(block);
  }
}
