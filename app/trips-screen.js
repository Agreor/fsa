const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// state: { view: null | { matches: [{ date, amount, currency, service, category }], unmatchedTrips, unmatchedRows,
//   skipped, usable }, message }; handlers: onPreview(), onApply().
export function renderTrips(root, state, handlers, format) {
  const doc = root.ownerDocument;
  const box = root.querySelector('[data-region="trips"]');
  box.replaceChildren();
  const preview = el(doc, 'button', 'Preview matches');
  preview.addEventListener('click', () => handlers.onPreview());
  box.append(preview);
  const { view } = state;
  if (view) {
    box.append(el(doc, 'p', `${many(view.matches.length, 'card charge')} matched a trip. `
      + `${many(view.unmatchedTrips, 'trip')} had no card charge in your data`
      + `${view.unmatchedRows ? `, and ${many(view.unmatchedRows, 'card charge')} had no trip` : ''}`
      + `${view.skipped ? `. ${many(view.skipped, 'line')} could not be read` : ''}.`));
    const table = el(doc, 'table');
    const body = el(doc, 'tbody');
    for (const item of view.matches) {
      const row = el(doc, 'tr');
      for (const text of [item.date, format(item.amount, item.currency), item.service,
        item.category ? `→ ${item.category}` : 'no category for this service']) {
        const cell = el(doc, 'td', text);
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    box.append(table);
    const apply = el(doc, 'button', `Set ${view.usable} ${view.usable === 1 ? 'category' : 'categories'}`);
    apply.disabled = view.usable === 0;
    apply.addEventListener('click', () => handlers.onApply());
    box.append(apply);
  }
  if (state.message) {
    const message = el(doc, 'p', state.message);
    message.setAttribute('role', 'status');
    box.append(message);
  }
}
