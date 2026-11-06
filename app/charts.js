// Small chart pieces built with the DOM: stat tiles, horizontal bars, paired columns, a segmented choice.
// Geometry is set through the style object (allowed under the page's security policy); colours and
// spacing live in style.css. Every mark also has a title (hover text) and the figures stay as text.
export const el = (doc, tag, text, className) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part * 100) / whole)) : 0);

// tiles: [{ label, value, note? }]
export function tiles(doc, items) {
  const row = el(doc, 'div', undefined, 'tiles');
  for (const { label, value, note } of items) {
    const tile = el(doc, 'div', undefined, 'tile');
    tile.append(el(doc, 'span', label, 'tile-label'), el(doc, 'strong', value, 'tile-value'));
    if (note) tile.append(el(doc, 'span', note, 'tile-note'));
    row.append(tile);
  }
  return row;
}

// rows: [{ label, amount (number, for length), text (value shown at the tip), hint? }]; one hue, biggest first.
export function bars(doc, rows, { caption } = {}) {
  const box = el(doc, 'div', undefined, 'bars');
  if (caption) box.setAttribute('aria-label', caption);
  const max = Math.max(0, ...rows.map(({ amount }) => amount));
  for (const row of rows) {
    const line = el(doc, 'div', undefined, 'bar-row');
    line.title = `${row.label}: ${row.text}${row.hint ? ` (${row.hint})` : ''}`;
    const track = el(doc, 'div', undefined, 'bar-track');
    const fill = el(doc, 'div', undefined, 'bar-fill');
    fill.style.width = `${pct(row.amount, max)}%`;
    track.append(fill);
    line.append(el(doc, 'span', row.label, 'bar-label'), track, el(doc, 'span', row.text, 'bar-value'));
    box.append(line);
  }
  return box;
}

// groups: [{ label, a (number), b (number), text }]; a = first series (context), b = second (the focus).
export function columns(doc, groups, { aName, bName }) {
  const wrap = el(doc, 'div', undefined, 'columns-chart');
  const legend = el(doc, 'div', undefined, 'legend');
  for (const [name, className] of [[aName, 'key-a'], [bName, 'key-b']]) {
    const item = el(doc, 'span', undefined, 'legend-item');
    item.append(el(doc, 'span', undefined, `key ${className}`), el(doc, 'span', name));
    legend.append(item);
  }
  wrap.append(legend);
  const max = Math.max(0, ...groups.flatMap(({ a, b }) => [a, b]));
  const plot = el(doc, 'div', undefined, 'columns');
  for (const group of groups) {
    const cell = el(doc, 'div', undefined, 'column-group');
    cell.title = group.text;
    const pair = el(doc, 'div', undefined, 'column-pair');
    for (const [value, className] of [[group.a, 'col-a'], [group.b, 'col-b']]) {
      const col = el(doc, 'div', undefined, `col ${className}`);
      col.style.height = `${pct(value, max)}%`;
      pair.append(col);
    }
    cell.append(pair, el(doc, 'span', group.label, 'column-label'));
    plot.append(cell);
  }
  wrap.append(plot);
  return wrap;
}

// options: [{ value, label }]; the chosen one is pressed. onChoose(value).
export function segmented(doc, options, chosen, onChoose) {
  const row = el(doc, 'div', undefined, 'segmented');
  row.setAttribute('role', 'group');
  for (const { value, label } of options) {
    const button = el(doc, 'button', label);
    button.setAttribute('aria-pressed', String(value === chosen));
    button.addEventListener('click', () => onChoose(value));
    row.append(button);
  }
  return row;
}
