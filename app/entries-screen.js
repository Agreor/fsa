const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

// items: [{ name, asOf, label }]; the form itself is static in index.html.
export function renderEntries(root, items, handlers) {
  const doc = root.ownerDocument;
  const list = root.querySelector('#entries-list');
  list.replaceChildren();
  for (const { name, asOf, label } of items) {
    const remove = el(doc, 'button', 'Remove');
    remove.setAttribute('aria-label', `Remove ${name} as of ${asOf}`);
    remove.addEventListener('click', () => handlers.onRemove(name, asOf));
    const item = el(doc, 'li', `${label} `);
    item.append(remove);
    list.append(item);
  }
}
