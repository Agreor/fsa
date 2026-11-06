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

// data: { newMerchants, outOfRange, approvals, rules: Map(key -> category), categories: [name],
// lines: Map(rowId -> category) };
// handlers: onApprove(items), onExtend(flag), onRevoke(key, currency), onCategory(key, category),
// onLine(rowId, category), onAdd({ name, currency, min, max })
export function renderReview(root, data, handlers, format) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#review-body');
  box.replaceChildren();
  const picker = (label, current, onChange) => {
    const select = el(doc, 'select');
    select.setAttribute('aria-label', label);
    for (const category of data.categories) {
      const option = el(doc, 'option', category);
      option.selected = category === (current ?? data.categories[0]);
      select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  };

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
        const line = el(doc, 'p', `${charge.date}  ${format(charge.amount, item.currency)} `);
        line.append(picker(`Category for the ${charge.date} charge`,
          data.lines.get(charge.rowId) ?? data.rules.get(item.key),
          (category) => handlers.onLine(charge.rowId, category)));
        name.append(line);
      }
      cell(doc, row, name);
      cell(doc, row, el(doc, 'span', `${many(item.count, 'charge')}, ${range(item.min, item.max, item.currency, format)}`));
      cell(doc, row, picker(`Category for ${item.sample}`, data.rules.get(item.key),
        (category) => handlers.onCategory(item.key, category)));
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
  list.append(el(doc, 'summary', `Approved merchants (${data.approvals.length}): tap to see the list or add one`));
  const form = el(doc, 'form');
  const field = (label, name, value = '') => {
    const input = el(doc, 'input');
    input.name = name; input.value = value; input.required = true;
    const wrap = el(doc, 'label', label);
    wrap.append(input);
    form.append(wrap);
  };
  field('Merchant', 'name'); field('Currency', 'currency', data.currency ?? 'EUR');
  field('Lowest charge', 'min'); field('Highest charge', 'max');
  form.append(el(doc, 'button', 'Add merchant'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onAdd(Object.fromEntries(new FormData(form)));
  });
  list.append(form);
  const table = el(doc, 'table');
  table.className = 'review-rows';
  const body = el(doc, 'tbody');
  for (const approval of data.approvals) {
    const row = el(doc, 'tr');
    cell(doc, row, el(doc, 'span', approval.key));
    cell(doc, row, el(doc, 'span',
      `${range(approval.min, approval.max, approval.currency, format)}`));
    cell(doc, row, button(doc, 'Remove', `Remove ${approval.key} ${approval.currency}`,
      () => handlers.onRevoke(approval.key, approval.currency)));
    body.append(row);
  }
  table.append(body);
  const scroll = el(doc, 'div');
  scroll.className = 'review-scroll';
  scroll.append(table);
  list.append(scroll);
  box.append(list);
}
