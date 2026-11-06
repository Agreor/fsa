// Reads a trip table from page pictures (a statement with no text layer). Pure: pictures in, trips out.
// The table has a grid: horizontal lines give the rows, vertical lines the columns (date first, trip
// type fifth, amount last). The statement prints its own trip count and total; a reading that does not
// match them is refused, so a misread digit never reaches the data.
// pages: [{ width, height, data }] (RGBA); makeCanvas(w, h) -> canvas with a 2d context;
// recognise(canvas, { whitelist, psm }) -> text (psm: 'line' | 'block'); onProgress(done, total).
import { tripCategory } from '../trips.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SERVICES = ['GrabFood', 'GrabMart', 'Standard Bike', 'Saver Bike', 'Standard | Taxi', 'Standard | Car only',
  'Premium | Car', 'GrabCar', 'GrabBike', 'GrabTaxi'];
const PASSES = [150, 125, 175]; // black/white thresholds; the first is tried alone, the rest only to fix a mismatch

export const lum = (page, x, y) => {
  const i = (y * page.width + x) * 4;
  return 0.3 * page.data[i] + 0.59 * page.data[i + 1] + 0.11 * page.data[i + 2];
};
const runs = (flags, gap = 3) => {
  const out = [];
  flags.forEach((on, at) => {
    if (!on) return;
    if (out.length && at - out.at(-1)[1] <= gap) out.at(-1)[1] = at; else out.push([at, at]);
  });
  return out.map(([a, b]) => Math.round((a + b) / 2));
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const border = (v) => v < 238 && v > 150; // the thin grey line, not text and not background

// Row bands and column lines of one page.
export function findGrid(page) {
  const { width: w, height: h } = page;
  const x0 = Math.round(0.065 * w), x1 = Math.round(0.935 * w);
  const across = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = x0; x < x1; x += 2) if (border(lum(page, x, y))) n++;
    across.push(n / ((x1 - x0) / 2) > 0.85);
  }
  const ys = runs(across);
  if (ys.length < 2) return null;
  const heights = ys.slice(1).map((y, i) => y - ys[i]);
  const pitch = median(heights);
  const bands = [];
  heights.forEach((height, i) => { // the header band is shorter than a row
    if (height >= 0.8 * pitch && height <= 2 * pitch) bands.push([ys[i], ys[i + 1]]);
  });
  if (!bands.length) return null;
  const last = ys.at(-1);
  let ink = 0; // a last row may have no line under it
  for (let y = last + 6; y < Math.min(h, last + pitch - 6); y += 2) {
    for (let x = x0; x < x1; x += 4) if (lum(page, x, y) < 120) ink++;
  }
  if (ink > 20) bands.push([last, Math.min(h - 1, last + pitch)]);
  const flags = [];
  for (let x = Math.max(0, x0 - 20); x < Math.min(w, x1 + 20); x++) {
    let n = 0, total = 0;
    for (let y = bands[0][0] + 4; y < bands.at(-1)[1] - 4; y += 3) { total++; if (border(lum(page, x, y))) n++; }
    flags[x] = n / total > 0.8;
  }
  const xs = runs(Array.from(flags, Boolean));
  return { bands, xs, headerTop: bands[0][0] === ys[0] ? null : ys[ys.indexOf(bands[0][0]) - 1] };
}

function crop(page, makeCanvas, xa, xb, ya, yb, threshold) {
  const pad = 6, cw = xb - xa - 2 * pad, ch = yb - ya - 2 * pad;
  const canvas = makeCanvas(cw, ch);
  const out = canvas.getContext('2d').createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const v = lum(page, xa + pad + x, ya + pad + y) < threshold ? 0 : 255;
      const i = (y * cw + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
    }
  }
  canvas.getContext('2d').putImageData(out, 0, 0);
  return canvas;
}

export const amountOf = (text) => {
  const t = text.replace(/\s/g, '');
  const dotted = /^(\d+)\.(\d{2})$/.exec(t);
  if (dotted) return Number(dotted[1]) * 100 + Number(dotted[2]);
  return /^\d{3,}$/.test(t) ? Number(t) : null; // the point was dropped: 3200 is 32.00
};

const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep;
    }
  }
  return row[b.length];
};
// The known service nearest to the reading, else the reading itself.
export function serviceOf(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const flat = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
  const scored = SERVICES.map((name) => [name, distance(flat(clean), flat(name)) / Math.max(flat(name).length, 1)])
    .sort((a, b) => a[1] - b[1]);
  return scored[0][1] <= 0.35 ? scored[0][0] : clean;
}

const monthOf = (text) => {
  const letters = text.replace(/[^A-Za-z0-9:]/g, '').replace(/^\d+/, '').slice(0, 3).toLowerCase();
  if (letters.length < 2) return null;
  const scored = MONTHS.map((name, index) => [index, distance(letters.replace(/[0]/g, 'o').replace(/[:]/g, 't'),
    name.toLowerCase())]).sort((a, b) => a[1] - b[1]);
  return scored[0][1] <= 1 && scored[0][1] < scored[1][1] ? scored[0][0] : null;
};
const dayMonth = (text) => {
  const match = /^\D*?(\d{1,2})\s*([A-Za-z0-9:]{2,4})/.exec(text.trim());
  if (!match) return { day: null, month: null };
  const day = Number(match[1]);
  return { day: day >= 1 && day <= 31 ? day : null, month: monthOf(match[2]) };
};
const yearOf = (texts) => {
  const counts = new Map();
  for (const text of texts) {
    const found = /(20\d{2})/.exec(text);
    if (found) counts.set(found[1], (counts.get(found[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

// Every combination of readings that reaches `total`, trying fewest changes first (at most `limit` rows).
function reconcile(base, options, total, limit = 4) {
  const sum = (values) => values.reduce((s, v) => s + (v ?? 0), 0);
  if (sum(base) === total) return base;
  const doubtful = options.map((list, at) => [at, list]).filter(([, list]) => list.length > 1).map(([at]) => at);
  const attempt = (from, changes, values) => {
    if (sum(values) === total && values.every((v) => v !== null)) return values;
    if (changes === limit) return null;
    for (let k = from; k < doubtful.length; k++) {
      for (const value of options[doubtful[k]]) {
        if (value === values[doubtful[k]]) continue;
        const next = [...values]; next[doubtful[k]] = value;
        const found = attempt(k + 1, changes + 1, next);
        if (found) return found;
      }
    }
    return null;
  };
  return attempt(0, 0, base);
}

export async function readTripTable({ pages, makeCanvas, recognise, onProgress = () => {} }) {
  const grids = pages.map(findGrid);
  if (grids.some((grid) => !grid || grid.xs.length < 8)) return { reason: 'The table in this picture could not be found.' };
  const rows = pages.flatMap((page, p) => grids[p].bands.map((band) => ({ page, grid: grids[p], band })));
  const cell = (row, column, threshold) => crop(row.page, makeCanvas, row.grid.xs[column], row.grid.xs[column + 1],
    row.band[0], row.band[1], threshold);

  // The statement's own count and total, printed above the table on the first page.
  const g0 = grids[0];
  let declared = null;
  if (g0.headerTop) {
    const top = Math.max(0, g0.headerTop - Math.round(0.05 * pages[0].height));
    const strip = crop(pages[0], makeCanvas, Math.round(0.05 * pages[0].width), Math.round(0.6 * pages[0].width),
      top - 6, g0.headerTop + 6, 150);
    const text = await recognise(strip, { whitelist: '', psm: 'block' });
    const found = /Transactions:?\s*(\d+)[^\d]*?Amount:?\s*[A-Z]{3}\s*([\d,]+\.\d{2})/is.exec(text.replace(/\s+/g, ' '));
    if (found) declared = { count: Number(found[1]), total: amountOf(found[2].replace(/,/g, '')) };
  }
  if (!declared) return { reason: 'The trip count and total printed on the statement could not be read, so the reading cannot be checked.' };
  if (rows.length !== declared.count) {
    return { reason: `The statement says ${declared.count} trips but ${rows.length} rows were found, so nothing was read.` };
  }

  const read = async (threshold, which) => {
    const out = [];
    for (const [i, row] of rows.entries()) {
      out.push(await recognise(cell(row, which.column, threshold), which.opts));
      onProgress(i + 1, rows.length);
    }
    return out;
  };
  const AMOUNT = { column: 6, opts: { whitelist: '0123456789.', psm: 'line' } };
  const DATE = { column: 0, opts: { whitelist: '', psm: 'block' } };
  const SERVICE = { column: 4, opts: { whitelist: '', psm: 'block' } };

  const amountPasses = [(await read(PASSES[0], AMOUNT)).map(amountOf)];
  const options = (values) => values.map((v, at) => [...new Set(amountPasses.map((pass) => pass[at]).filter((x) => x !== null))]);
  let amounts = reconcile(amountPasses[0], options(amountPasses[0]), declared.total);
  for (let k = 1; !amounts && k < PASSES.length; k++) {
    amountPasses.push((await read(PASSES[k], AMOUNT)).map(amountOf));
    amounts = reconcile(amountPasses[0], options(amountPasses[0]), declared.total);
  }
  if (!amounts) return { reason: 'The amounts read from the picture do not add up to the total printed on the statement, so nothing was saved.' };

  const serviceTexts = await read(PASSES[0], SERVICE);
  // Dates are read three ways and the most common reading of each row wins; ties keep the first.
  const datePasses = [];
  for (const threshold of PASSES) datePasses.push(await read(threshold, DATE));
  const dateTexts = datePasses[0];
  const year = yearOf(datePasses.flat());
  if (!year) return { reason: 'The year could not be read from the picture.' };
  const stamp = ({ day, month }) => (month === null || day === null ? null : month * 40 + day);
  const parts = rows.map((_, i) => {
    const votes = new Map();
    for (const pass of datePasses) {
      const part = dayMonth(pass[i]), key = stamp(part);
      if (key !== null) votes.set(key, { part, n: (votes.get(key)?.n ?? 0) + 1 });
    }
    const best = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    return best ? best.part : dayMonth(dateTexts[i]);
  });
  // Newest first: a date later than the row above it is a misreading.
  const wrong = () => parts.map((part, i) => {
    const here = stamp(part);
    if (here === null) return true;
    const above = i > 0 ? stamp(parts[i - 1]) : null, below = i + 1 < parts.length ? stamp(parts[i + 1]) : null;
    return (above !== null && here > above) || (below !== null && here < below);
  });
  const stillWrong = wrong().findIndex(Boolean);
  if (stillWrong >= 0) return { reason: `The date of trip ${stillWrong + 1} could not be read reliably, so nothing was saved.` };

  const trips = rows.map((_, i) => {
    const service = serviceOf(serviceTexts[i]);
    const date = `${year}-${String(parts[i].month + 1).padStart(2, '0')}-${String(parts[i].day).padStart(2, '0')}`;
    return { date, service, amount: amounts[i], currency: null, category: tripCategory(service) };
  });
  return { trips, declared };
}
