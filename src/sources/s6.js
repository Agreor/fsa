// A trip list: what each ride or delivery was for. It holds no transactions; its trips are matched
// to card charges afterwards. Text input, one trip per line (see ../trips.js).
import { parseTrips } from '../trips.js';
import { readTripTable } from '../ocr/trip-table.js';

export const input = 'text';

export function parse(text) {
  const { trips, skipped } = parseTrips(text);
  if (!trips.length) return { reason: 'No trips could be read. Use date, trip type, amount on each line.' };
  const dates = trips.map(({ date }) => date).sort();
  return { rows: [], coverage: { from: dates[0], to: dates.at(-1) }, balances: [], trips, skipped };
}

// A statement that is a picture: ocr = { makeCanvas, recognise, onProgress } (see ../ocr/trip-table.js).
export async function readPicture(pages, ocr) {
  const out = await readTripTable({ pages, ...ocr });
  if (out.reason) return out;
  const dates = out.trips.map(({ date }) => date).sort();
  return { rows: [], coverage: { from: dates[0], to: dates.at(-1) }, balances: [], trips: out.trips };
}
