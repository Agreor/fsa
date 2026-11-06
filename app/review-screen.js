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
const table = (doc) => {
  const node = el(doc, 'table');
  node.className = 'review-rows';
  node.append(el(doc, 'tbody'));
  return node;
};

// data: { todo, people, outOfRange, approvals, rules: [{ key, category, source, charges }],
//   lineCategories: Map(rowId -> category), categories: [name], currency };
// handlers: onPick(item, category), onPeople(items), onExtend(flag), onRevoke(key, currency),
//   onLine(rowId, category), onRuleChange(key, category), onRuleRemove(key), onRuleAdd({ name, category })
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

  if (!data.todo.length && !data.people.length && !data.outOfRange.length) {
    box.append(el(doc, 'p', 'Nothing needs a look.'));
  }

  if (data.todo.length) {
    box.append(el(doc, 'h3', `To categorise (${data.todo.length})`));
    box.append(el(doc, 'p', 'Pick a category. That is all: the merchant is remembered and drops off this list.'));
    const list = table(doc);
    for (const item of data.todo) {
      const row = el(doc, 'tr');
      const name = el(doc, 'details');
      name.append(el(doc, 'summary', item.name));
      name.append(el(doc, 'p', item.sample));
      for (const charge of item.charges) {
        const line = el(doc, 'p', `${charge.date}  ${format(charge.amount, item.currency)} `);
        line.append(picker(`Category for the ${charge.date} charge`, data.lineCategories.get(charge.rowId),
          (category) => handlers.onLine(charge.rowId, category)));
        name.append(line);
      }
      cell(doc, row, name);
      cell(doc, row, el(doc, 'span', `${many(item.count, 'charge')}, `
        + `${range(item.min, item.max, item.currency, format)}, total ${format(item.total, item.currency)}`));
      cell(doc, row, picker(`Category for ${item.name}`, undefined, (category) => handlers.onPick(item, category)));
      list.firstChild.append(row);
    }
    box.append(list);
  }

  if (data.people.length) {
    box.append(el(doc, 'h3', `Payments to people (${data.people.length})`));
    box.append(el(doc, 'p', 'Money sent to a person has no spending category.'));
    const list = table(doc);
    for (const item of data.people) {
      const row = el(doc, 'tr');
      cell(doc, row, el(doc, 'span', item.name));
      cell(doc, row, el(doc, 'span', `${many(item.count, 'payment')}, total ${format(item.total, item.currency)}`));
      list.firstChild.append(row);
    }
    box.append(list, button(doc, 'Set all to Other', 'Set all payments to people to Other',
      () => handlers.onPeople(data.people)));
  }

  if (data.outOfRange.length) {
    box.append(el(doc, 'h3', `Unusual amounts (${data.outOfRange.length})`));
    box.append(el(doc, 'p', 'Well above or below what you usually pay. Tick if it is fine.'));
    const list = table(doc);
    for (const flag of data.outOfRange) {
      const row = el(doc, 'tr');
      cell(doc, row, el(doc, 'span', `${flag.date} ${flag.description}`));
      cell(doc, row, el(doc, 'span',
        `${format(flag.amount, flag.currency)} (usually ${range(flag.min, flag.max, flag.currency, format)})`));
      cell(doc, row, button(doc, '✓', `Accept ${flag.date} ${flag.description}`, () => handlers.onExtend(flag)));
      list.firstChild.append(row);
    }
    box.append(list);
  }

  box.append(renderRules(doc, data, handlers, picker));

  const normal = el(doc, 'details');
  normal.append(el(doc, 'summary', `Normal amounts (${data.approvals.length})`));
  normal.append(el(doc, 'p', 'The range each merchant usually charges. A charge far outside it shows under Unusual amounts.'));
  const normalList = table(doc);
  for (const approval of data.approvals) {
    const row = el(doc, 'tr');
    cell(doc, row, el(doc, 'span', approval.key));
    cell(doc, row, el(doc, 'span', range(approval.min, approval.max, approval.currency, format)));
    cell(doc, row, button(doc, 'Remove', `Remove ${approval.key} ${approval.currency}`,
      () => handlers.onRevoke(approval.key, approval.currency)));
    normalList.firstChild.append(row);
  }
  const scroll = el(doc, 'div');
  scroll.className = 'review-scroll';
  scroll.append(normalList);
  normal.append(scroll);
  box.append(normal);
}

function renderRules(doc, data, handlers, picker) {
  const details = el(doc, 'details');
  details.append(el(doc, 'summary', `Already categorised (${many(data.rules.length, 'merchant')})`));

  const search = el(doc, 'input');
  search.type = 'search';
  search.placeholder = 'Search merchants';
  search.setAttribute('aria-label', 'Search categorised merchants');
  details.append(search);

  const form = el(doc, 'form');
  const name = el(doc, 'input');
  name.name = 'name'; name.required = true; name.placeholder = 'Merchant name';
  const category = picker('Category for the new merchant', undefined, () => {});
  category.name = 'category';
  form.append(name, category, el(doc, 'button', 'Add'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onRuleAdd({ name: name.value, category: category.value });
  });
  details.append(form);

  const list = table(doc);
  const rows = data.rules.map((rule) => {
    const row = el(doc, 'tr');
    const label = rule.source === 'classifier' ? `${rule.key} (suggested)` : rule.key;
    cell(doc, row, el(doc, 'span', label));
    cell(doc, row, el(doc, 'span', many(rule.charges, 'charge')));
    cell(doc, row, picker(`Category for ${rule.key}`, rule.category,
      (value) => handlers.onRuleChange(rule.key, value)));
    cell(doc, row, button(doc, 'Remove', `Remove the category for ${rule.key}`,
      () => handlers.onRuleRemove(rule.key)));
    list.firstChild.append(row);
    return [rule.key, row];
  });
  search.addEventListener('input', () => {
    const needle = search.value.trim().toLowerCase();
    for (const [key, row] of rows) row.hidden = needle !== '' && !key.includes(needle);
  });
  const scroll = el(doc, 'div');
  scroll.className = 'review-scroll';
  scroll.append(list);
  details.append(scroll);
  return details;
}
