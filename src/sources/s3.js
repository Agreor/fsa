// Broker activity statement (sectioned CSV). MVP: only the dated Net Asset Value anchors are read,
// shortcut: no holdings, trades or deposits yet, add them with the investment series slice.
export const input = 'text';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'];
const reason = (message) => ({ reason: message });

function splitLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(cell); cell = ''; } else cell += char;
  }
  cells.push(cell);
  return cells;
}

// Whole minor units from a decimal string, rounded half away from zero; never a float.
function minor(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec((text ?? '').trim());
  if (!match) return null;
  const fraction = (match[3] ?? '').padEnd(3, '0');
  let value = Number(match[2]) * 100 + Number(fraction.slice(0, 2)) + (fraction[2] >= '5' ? 1 : 0);
  if (!Number.isSafeInteger(value)) return null;
  if (match[1]) value = -value;
  return value === 0 ? 0 : value;
}

function isoDate(text) {
  const match = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  return date.getUTCMonth() === month && date.getUTCDate() === Number(match[2])
    ? date.toISOString().slice(0, 10) : null;
}

export function parse(text, _context) {
  if (typeof text !== 'string' || !text.trim()) return reason('Not an activity statement');
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(splitLine);
  const data = (section) => rows.filter((row) => row[0] === section && row[1] === 'Data');
  const field = (section, name) => data(section).find((row) => row[2] === name)?.[3];
  if (field('Statement', 'Title') !== 'Activity Statement') return reason('Not an activity statement');

  const [startText, endText = startText] = (field('Statement', 'Period') ?? '').split(' - ');
  const from = isoDate(startText);
  const to = isoDate(endText);
  if (!from || !to || from > to) return reason('The statement period could not be read');
  const currency = (field('Account Information', 'Base Currency') ?? '').trim();
  if (!/^[A-Z]{3}$/.test(currency)) return reason('The base currency could not be read');

  const classes = data('Net Asset Value').filter((row) => row.length >= 8);
  const total = classes.find((row) => row[2].trim() === 'Total');
  const prior = total && minor(total[3]);
  const current = total && minor(total[6]);
  if (!total || prior === null || current === null) return reason('The net asset value total is missing');
  const parts = classes.filter((row) => row !== total).map((row) => minor(row[6]));
  if (parts.some((value) => value === null)
    || Math.abs(parts.reduce((sum, value) => sum + value, 0) - current) > parts.length) {
    return reason('Net asset value: the asset classes do not add up to the total');
  }
  const start = field('Change in NAV', 'Starting Value');
  const end = field('Change in NAV', 'Ending Value');
  if ((start !== undefined && Math.abs(minor(start) - prior) > 1)
    || (end !== undefined && Math.abs(minor(end) - current) > 1)) {
    return reason('Net asset value: it does not match the change in NAV section');
  }

  const before = new Date(`${from}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return { rows: [], coverage: { from, to }, balances: [
    { currency, asOf: before.toISOString().slice(0, 10), amount: prior },
    { currency, asOf: to, amount: current },
  ] };
}
