// Ride-and-delivery trip lists: each trip says what a card charge was for, so the charge can take
// its category from the trip. Pure; no storage. A trip list is text with one trip per line:
// date [time], service, amount [, currency] separated by tabs, else semicolons, else commas (so 30,00 works with semicolons).
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = 86400000;

// shortcut: services are matched by words; an unknown service gets no category and is left for the user.
export function tripCategory(service) {
  if (/food/i.test(service)) return 'Eating out';
  if (/mart|grocer/i.test(service)) return 'Groceries';
  if (/bike|car|taxi|ride|saver|standard|premium|transport/i.test(service)) return 'Transport';
  return null;
}

function parseDate(text) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(text.trim());
  const month = long && MONTHS.indexOf(long[2].toLowerCase());
  return long && month >= 0 ? `${long[3]}-${String(month + 1).padStart(2, '0')}-${long[1].padStart(2, '0')}` : null;
}

// parseAmount(text) -> minor units or null; injected so this module has no imports.
export function parseTrips(text, parseAmount) {
  const trips = [];
  let skipped = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split(['\t', ';'].find((mark) => line.includes(mark)) ?? ',').map((part) => part.trim());
    if (/^\d{1,2}:\d{2}\s*([ap]m)?$/i.test(fields[1] ?? '')) fields.splice(1, 1); // a separate time column
    const date = parseDate(fields[0] ?? '');
    const amount = parseAmount(fields[2] ?? '');
    if (!date || amount === null || !fields[1]) { skipped++; continue; }
    trips.push({ date, service: fields[1], amount, currency: /^[A-Za-z]{3}$/.test(fields[3] ?? '')
      ? fields[3].toUpperCase() : null, category: tripCategory(fields[1]) });
  }
  return { trips, skipped };
}

const days = (date) => Date.parse(`${date}T00:00:00Z`) / DAY;

// Pairs each trip with one card charge of the same amount within `window` days (nearest first).
// rows: stored rows; isMerchant(description) says whether a row belongs to the trip service's merchant.
export function matchTrips({ trips, rows, rowIdentity, isMerchant, window = 2 }) {
  const candidates = rows.filter((row) => row.amount < 0 && isMerchant(row.description));
  const taken = new Set();
  const matches = [], unmatchedTrips = [];
  for (const trip of trips.filter((item) => item.amount > 0)) {
    let best = null;
    for (const row of candidates) {
      if (taken.has(rowIdentity(row)) || -row.amount !== trip.amount
        || (trip.currency && row.currency !== trip.currency)) continue;
      const gap = Math.abs(days(row.date) - days(trip.date));
      if (gap <= window && (!best || gap < best.gap)) best = { row, gap };
    }
    if (best) { taken.add(rowIdentity(best.row)); matches.push({ row: best.row, trip }); } else unmatchedTrips.push(trip);
  }
  const unmatchedRows = candidates.filter((row) => !taken.has(rowIdentity(row)));
  return { matches, unmatchedTrips, unmatchedRows };
}
