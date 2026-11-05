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

// data: { newMerchants, outOfRange, approvals };
// handlers: onApprove(items), onExtend(flag), onRevoke(key, currency)
export function renderReview(root, data, handlers, format) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#review-body');
  box.replaceChildren();

  box.append(el(doc, 'h3', `New merchants (${data.newMerchants.length})`));
  if (!data.newMerchants.length) box.append(el(doc, 'p', 'Every merchant you pay has been approved.'));
  const boxes = [];
  for (const item of data.newMerchants) {
    const label = el(doc, 'label', ` ${item.sample}: ${many(item.count, 'charge')}, `
      + `${range(item.min, item.max, item.currency, format)}, total ${format(item.total, item.currency)}`);
    const check = el(doc, 'input');
    check.type = 'checkbox';
    check.checked = true;
    boxes.push([check, item]);
    label.prepend(check);
    box.append(el(doc, 'p'));
    box.lastChild.append(label);
  }
  if (data.newMerchants.length) {
    const approve = (items) => handlers.onApprove(items.map(({ key, currency, min, max }) =>
      ({ key, currency, min, max })));
    box.append(button(doc, 'Approve selected', 'Approve selected merchants',
      () => approve(boxes.filter(([check]) => check.checked).map(([, item]) => item))),
    button(doc, 'Approve all', 'Approve all new merchants', () => approve(data.newMerchants)));
  }

  box.append(el(doc, 'h3', `Unusual amounts (${data.outOfRange.length})`));
  if (!data.outOfRange.length) box.append(el(doc, 'p', 'No charge is outside its approved range.'));
  for (const flag of data.outOfRange) {
    const line = el(doc, 'p', `${flag.date} ${flag.description}: ${format(flag.amount, flag.currency)} `
      + `(approved ${range(flag.min, flag.max, flag.currency, format)}) `);
    line.append(button(doc, 'Accept this amount', `Accept ${flag.date} ${flag.description}`,
      () => handlers.onExtend(flag)));
    box.append(line);
  }

  box.append(el(doc, 'h3', `Approved merchants (${data.approvals.length})`));
  for (const approval of data.approvals) {
    const line = el(doc, 'p', `${approval.key} (${approval.currency}): `
      + `${range(approval.min, approval.max, approval.currency, format)} `);
    line.append(button(doc, 'Revoke', `Revoke ${approval.key} ${approval.currency}`,
      () => handlers.onRevoke(approval.key, approval.currency)));
    box.append(line);
  }
}
