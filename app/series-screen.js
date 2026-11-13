import { line } from './charts.js';

const el = (doc, tag, text) => {
  const node = doc.createElement(tag);
  node.textContent = text;
  return node;
};

export function renderSeries(root, data) {
  const doc = root.ownerDocument;
  const box = root.querySelector('#series-body');
  box.replaceChildren();
  if (!data.accounts.length) { box.append(el(doc, 'p', 'No broker accounts yet.')); return; }
  for (const account of data.accounts) {
    box.append(el(doc, 'h3', account.name));
    if (!account.periods.length && !account.notes.length) box.append(el(doc, 'p', 'No statements imported yet.'));
    const valued = account.periods.filter(({ endAmount }) => endAmount !== null);
    if (valued.length > 1) { // value at the end of each statement period
      box.append(line(doc, valued.map((period) => ({ label: period.to.slice(2, 7), value: period.endAmount, text: period.end })),
        { caption: `${account.name}: value at the end of each period`, floor: -Infinity }));
    }
    for (const period of account.periods) {
      box.append(el(doc, 'h4', `${period.from} to ${period.to}`));
      if (period.start !== null) {
        const lines = [`Start: ${period.start}`];
        if (period.marketChange !== null) {
          lines.push(`Net deposits: ${period.deposits}`, `End: ${period.end}`,
            `Market change: ${period.marketChange}`, `Return: ${period.returnPct}`);
        } else lines.push(`End: ${period.end}`);
        box.append(el(doc, 'p', lines.join(' | ')));
      }
      if (period.note) box.append(el(doc, 'p', period.note));
    }
    for (const note of account.notes) box.append(el(doc, 'p', note));
    for (const gap of account.gaps) box.append(el(doc, 'p', `No statement covers ${gap.from} to ${gap.to}.`));
  }
}
