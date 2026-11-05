const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderDashboard(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#dashboard-body');
  box.replaceChildren();
  if (!data.months.length) { box.append(el(doc, 'p', 'No months yet.')); return; }
  for (const window of data.windows) {
    box.append(el(doc, 'h3', `${window.label} (${window.months} with data): ${window.total}`));
    for (const { category, value, share } of window.categories) {
      box.append(el(doc, 'p', `${category}: ${value} (${share})`));
    }
    if (window.otherCredits) {
      box.append(el(doc, 'p', `Refunds and credits outside these categories: ${window.otherCredits}`));
    }
    if (window.partial) box.append(el(doc, 'p', 'Incomplete: some amounts could not be converted.'));
  }
  box.append(el(doc, 'h3', 'Income against spending'));
  for (const month of data.months) {
    box.append(el(doc, 'p', `${month.month}: income ${month.income}, spending ${month.spending}, `
      + `net ${month.net}, savings rate ${month.savingsRate}${month.partial ? ' (incomplete)' : ''}`));
  }
  box.append(el(doc, 'h3', 'Could set aside per month'));
  box.append(el(doc, 'p', data.setAside
    ? `${data.setAside.value} (average of ${data.setAside.months} complete month`
      + `${data.setAside.months === 1 ? '' : 's'}). ${data.setAside.note}.`
    : 'Not available: it needs complete months that include income.'));
}
