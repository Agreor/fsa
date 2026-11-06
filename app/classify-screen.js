const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (doc, text, action, disabled = false, kind = '') => {
  const node = el(doc, 'button', text);
  if (kind) node.className = kind;
  node.setAttribute('aria-label', text);
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
};

// state: { view: null | { items: [{ text, count }], notes }, selected: Set of texts, busy, message }
export function renderClassify(root, state, handlers) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  root.append(button(doc, 'Find merchants to categorise', () => handlers.onFind(), state.busy, 'primary'));
  if (state.view) {
    const { items, notes } = state.view;
    if (!items.length) {
      root.append(el(doc, 'p', 'No merchant names are waiting for a category.'));
    } else {
      root.append(el(doc, 'p', `${items.length} merchant ${items.length === 1 ? 'name' : 'names'} from your `
        + 'credit-card accounts have no category. Tick the ones to send. Only the name is sent: no '
        + 'amounts, dates or account details.'));
      const list = el(doc, 'ul');
      list.className = 'classify-list';
      for (const { text, count } of items) {
        const item = el(doc, 'li');
        const label = el(doc, 'label');
        const box = el(doc, 'input');
        box.type = 'checkbox';
        box.checked = state.selected.has(text);
        box.disabled = state.busy;
        box.setAttribute('aria-label', `Send ${text}`);
        box.addEventListener('change', () => handlers.onToggle(text, box.checked));
        label.append(box, el(doc, 'span', `${text} (${count})`));
        item.append(label);
        list.append(item);
      }
      root.append(list);
      const picked = items.filter(({ text }) => state.selected.has(text)).length;
      root.append(
        button(doc, 'Select all', () => handlers.onSelectAll(true), state.busy, 'quiet'),
        button(doc, 'Select none', () => handlers.onSelectAll(false), state.busy, 'quiet'),
        button(doc, `Send ${picked} selected to the classifier`, () => handlers.onSend(),
          state.busy || picked === 0, 'primary'));
    }
    for (const note of notes) root.append(el(doc, 'p', note));
    root.append(button(doc, 'Close', () => handlers.onCancel(), state.busy, 'quiet'));
  }
  if (state.message) {
    const message = el(doc, 'p', state.message);
    message.setAttribute('role', 'status');
    root.append(message);
  }
}
