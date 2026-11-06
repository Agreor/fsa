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

export function renderBackup(root, state, handlers) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  if (state.safety) root.append(el(doc, 'p', `${state.safety.storage} ${state.safety.backup}`));
  root.append(button(doc, 'Download backup', () => handlers.onDownload(), 'primary'));
  const label = el(doc, 'label', 'Backup file ');
  const input = el(doc, 'input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.setAttribute('aria-label', 'Backup file');
  input.addEventListener('change', () => handlers.onPick(input.files?.[0]));
  label.append(input);
  root.append(label);
  if (state.pending) {
    const { counts, createdAt } = state.pending;
    const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    root.append(el(doc, 'p', `This backup has ${many(counts.rows, 'transaction')}, `
      + `${many(counts.batches, 'import')} and ${many(counts.accounts, 'account')}, made ${createdAt}. `
      + 'Restoring replaces everything in this browser.'),
    button(doc, 'Download current data first', () => handlers.onDownload(), 'primary'),
    button(doc, 'Replace everything with this backup', () => handlers.onRestore(), 'danger'),
    button(doc, 'Cancel', () => handlers.onCancel(), 'quiet'));
  }
  if (state.message) {
    const message = el(doc, 'p', state.message);
    message.setAttribute('role', 'status');
    root.append(message);
  }
}
