const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  node.textContent = text;
  return node;
};

export function renderHome(root, data) {
  const doc = root.ownerDocument;
  const list = root.querySelector('dl');
  list.replaceChildren();
  for (const line of data.lines) {
    const label = el(doc, 'dt', line.label);
    const value = line.value ?? '-';
    const detail = [line.partial ? 'partial' : '', line.asOf ? `as of ${line.asOf}` : '', line.note ?? '']
      .filter(Boolean).join(' · ');
    list.append(label, el(doc, 'dd', detail ? `${value} (${detail})` : value));
  }
}
