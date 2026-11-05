const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (doc, text, label, action) => {
  const node = el(doc, 'button', text);
  node.setAttribute('aria-label', label ?? text);
  node.addEventListener('click', action);
  return node;
};
const range = (min, max, currency, format) => (min === max ? format(min, currency)
  : `${format(min, currency)} to ${format(max, currency)}`);
const many = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cell = (doc, row, content) => {
  const td = el(doc, 'td');
  td.append(content);
  row.append(td);
  return td;
};

// data: { newMerchants, outOfRange, approvals, rules: Map(key -> category), categories: [name] };
// handlers: onApprove(items), onExtend(flag), onRevoke(key, currency), onCategory(key, category)
export function renderReview(root, data, handlers, format) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#review-body');
  box.replaceChildren();

  if (!data.newMerchants.length && !data.outOfRange.length) box.append(el(doc, 'p', 'Nothing needs a look.'));

  if (data.newMerchants.length) {
    box.append(el(doc, 'h3', `New merchants (${data.newMerchants.length})`));
    box.append(el(doc, 'p', 'Pick a category if it is wrong, then tick to approve.'));
    const table = el(doc, 'table');
    table.className = 'review-rows';
    const body = el(doc, 'tbody');
    for (const item of data.newMerchants) {
      const row = el(doc, 'tr');
      const name = el(doc, 'details');
      name.append(el(doc, 'summary', item.sample));
      for (const charge of item.charges) {
        name.append(el(doc, 'p', `${charge.date}  ${format(charge.amount, item.currency)}`));
      }
      cell(doc, row, name);
      cell(doc, row, el(doc, 'span', `${many(item.count, 'charge')}, ${range(item.min, item.max, item.currency, format)}`));
      const select = el(doc, 'select');
      select.setAttribute('aria-label', `Category for ${item.sample}`);
      for (const category of data.categories) {
        const option = el(doc, 'option', category);
        option.selected = category === (data.rules.get(item.key) ?? data.categories[0]);
        select.append(option);
      }
      select.addEventListener('change', () => handlers.onCategory(item.key, select.value));
      cell(doc, row, select);
      cell(doc, row, button(doc, '✓', `Approve ${item.sample}`, () => handlers.onApprove([item])));
      body.append(row);
    }
    table.append(body);
    box.append(table);
    if (data.newMerchants.length > 1) {
      box.append(button(doc, 'Approve all', 'Approve all new merchants', () => handlers.onApprove(data.newMerchants)));
    }
  }

  if (data.outOfRange.length) {
    box.append(el(doc, 'h3', `Unusual amounts (${data.outOfRange.length})`));
    box.append(el(doc, 'p', 'Well above or below what you usually pay. Tick if it is fine.'));
    const table = el(doc, 'table');
    table.className = 'review-rows';
    const body = el(doc, 'tbody');
    for (const flag of data.outOfRange) {
      const row = el(doc, 'tr');
      cell(doc, row, el(doc, 'span', `${flag.date} ${flag.description}`));
      cell(doc, row, el(doc, 'span', `${format(flag.amount, flag.currency)} (usually ${range(flag.min, flag.max, flag.currency, format)})`));
      cell(doc, row, button(doc, '✓', `Accept ${flag.date} ${flag.description}`, () => handlers.onExtend(flag)));
      body.append(row);
    }
    table.append(body);
    box.append(table);
  }

  const list = el(doc, 'details');
  list.append(el(doc, 'summary', `Approved merchants (${data.approvals.length})`));
  box.append(list);
  for (const approval of data.approvals) {
    const line = el(doc, 'p', `${approval.key} (${approval.currency}): `
      + `${range(approval.min, approval.max, approval.currency, format)} `);
    line.append(button(doc, 'Revoke', `Revoke ${approval.key} ${approval.currency}`,
      () => handlers.onRevoke(approval.key, approval.currency)));
    list.append(line);
  }
}
