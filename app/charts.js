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

// slices: [{ label, amount, text, share }] largest first. The four biggest get a colour of their own, the rest fold into Other.
const SVG = 'http://www.w3.org/2000/svg';
const NAMED = 4;
export function donut(doc, slices, { caption } = {}) {
  const shown = slices.slice(0, NAMED);
  const rest = slices.slice(NAMED);
  const total = slices.reduce((sum, { amount }) => sum + amount, 0);
  if (rest.length) {
    const amount = rest.reduce((sum, slice) => sum + slice.amount, 0);
    shown.push({ label: 'Other', amount, text: `${rest.length} more categor${rest.length === 1 ? 'y' : 'ies'}`, share: `${Math.round(pct(amount, total))}%`, other: true });
  }
  const wrap = el(doc, 'div', undefined, 'donut-wrap');
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 42 42');
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');
  if (caption) svg.setAttribute('aria-label', caption);
  const list = el(doc, 'ul', undefined, 'donut-legend');
  let offset = 0; // the ring has a circumference of 100, so a share is its own dash length
  shown.forEach((slice, index) => {
    const share = pct(slice.amount, total);
    const kind = slice.other ? 'slice-other' : `slice-${index + 1}`;
    const arc = doc.createElementNS(SVG, 'circle');
    arc.setAttribute('class', `slice ${kind}`);
    arc.setAttribute('cx', '21'); arc.setAttribute('cy', '21'); arc.setAttribute('r', '15.9155');
    arc.setAttribute('stroke-dasharray', `${Math.max(0, share - 0.6)} ${100 - Math.max(0, share - 0.6)}`);
    arc.setAttribute('stroke-dashoffset', String(25 - offset)); // start at the top
    const title = doc.createElementNS(SVG, 'title');
    title.textContent = `${slice.label}: ${slice.text} (${slice.share})`;
    arc.append(title);
    svg.append(arc);
    offset += share;
    const item = el(doc, 'li');
    item.append(el(doc, 'span', undefined, `key ${kind}`), el(doc, 'span', slice.label, 'donut-name'),
      el(doc, 'strong', slice.share), el(doc, 'span', slice.text, 'donut-value'));
    list.append(item);
  });
  wrap.append(svg, list);
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
