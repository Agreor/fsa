const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const label = (month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ? `${names[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : month;
const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (doc, text, action) => {
  const node = el(doc, 'button', text);
  node.setAttribute('aria-label', text);
  node.addEventListener('click', action);
  return node;
};

export function renderMonth(root, data, handlers) {
  const doc = root.ownerDocument;
  const regions = Object.fromEntries([...root.children]
    .map((region) => [region.getAttribute('data-region'), region]));
  for (const region of Object.values(regions)) region.replaceChildren();
  if (data.empty) {
    regions.summary.textContent = 'No transactions yet. Import a statement above.';
    for (const key of ['month-picker', 'categories', 'notice', 'suggested', 'rows']) {
      regions[key].hidden = true;
    }
    return;
  }
  for (const region of Object.values(regions)) region.hidden = false;
  const select = el(doc, 'select');
  select.setAttribute('aria-label', 'Choose month');
  for (const month of data.months) {
    const option = el(doc, 'option', label(month)); option.value = month;
    option.selected = month === data.month; select.append(option);
  }
  select.addEventListener('change', () => handlers.onMonth(select.value));
  regions['month-picker'].append(select);
  const definition = el(doc, 'dl');
  for (const item of data.summary) definition.append(el(doc, 'dt', item.label), el(doc, 'dd', item.value));
  regions.summary.append(definition);
  if (data.incompleteNote) {
    const note = el(doc, 'p', data.incompleteNote);
    note.setAttribute('role', 'status');
    regions.summary.append(note);
  }
  if (data.spendingNote) regions.summary.append(el(doc, 'p', data.spendingNote));
  const categories = el(doc, 'ul');
  for (const item of data.categories) categories.append(el(doc, 'li', `${item.category}: ${item.value}`));
  regions.categories.append(categories);
  if (!data.categories.length) regions.categories.textContent = 'No spending in this month.';
  regions.notice.hidden = !data.notice;
  if (data.notice) regions.notice.textContent = data.notice;
  regions.suggested.hidden = !data.suggested.length;
  for (const record of data.suggested) {
    const block = el(doc, 'section');
    for (const leg of record.legs) block.append(el(doc, 'p',
      `${leg.date} ${leg.description} ${leg.displayAmount}`));
    block.append(button(doc, 'Confirm transfer', () => handlers.onConfirm(record.id)));
    block.append(button(doc, 'Not a transfer', () => handlers.onNotTransfer(
      record.legs.map((leg) => leg.rowId))));
    regions.suggested.append(block);
  }
  const table = el(doc, 'table'), head = el(doc, 'thead'), header = el(doc, 'tr');
  for (const name of ['Date', 'Description', 'Amount', 'Status', 'Treat as']) {
    header.append(el(doc, 'th', name));
  }
  head.append(header); table.append(head);
  const body = el(doc, 'tbody');
  for (const row of data.rows) {
    const tr = el(doc, 'tr');
    for (const value of [row.date, row.description, row.displayAmount,
      row.isTransfer ? 'Transfer' : row.isSuggested ? 'Transfer (to confirm)' : '']) {
      tr.append(el(doc, 'td', value));
    }
    const cell = el(doc, 'td');
    if (row.amount > 0) {
      const choices = [{ value: 'auto', label: 'Automatic' }, { value: 'income', label: 'Income' },
        { value: 'not_income', label: 'Not income' }, { value: 'refund', label: 'Refund' }];
      const control = el(doc, 'select');
      control.setAttribute('aria-label', `Treat ${row.description} as`);
      for (const choice of choices) {
        const option = el(doc, 'option', choice.label); option.value = choice.value;
        option.selected = (row.role ?? 'auto') === choice.value; control.append(option);
      }
      control.addEventListener('change', () => handlers.onMark(row.id, control.value));
      cell.append(control);
    }
    tr.append(cell); body.append(tr);
  }
  table.append(body);
  const wrapper = el(doc, 'div'); wrapper.className = 'month-rows-scroll'; wrapper.append(table);
  regions.rows.append(wrapper);
}
