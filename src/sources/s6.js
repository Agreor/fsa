// A trip list: what each ride or delivery was for. It holds no transactions; its trips are matched
// to card charges afterwards. Text input, one trip per line (see ../trips.js).
import { parseTrips } from '../trips.js';

export const input = 'text';

export function parse(text) {
  const { trips, skipped } = parseTrips(text);
  if (!trips.length) return { reason: 'No trips could be read. Use date, trip type, amount on each line.' };
  const dates = trips.map(({ date }) => date).sort();
  return { rows: [], coverage: { from: dates[0], to: dates.at(-1) }, balances: [], trips, skipped };
}
