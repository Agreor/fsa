import test from 'node:test';
import assert from 'node:assert/strict';
import { findGrid, readTripTable, amountOf, serviceOf } from '../src/ocr/trip-table.js';
import { prepareImport } from '../src/import-flow.js';
import * as s6 from '../src/sources/s6.js';

// A page picture with a grid: header band, then `rows` bands of 80px; 8 vertical lines.
function page(rows, { width = 1000, last = true } = {}) {
  const top = 200, head = 57, pitch = 80, height = top + head + pitch * rows + 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const grey = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 200; };
  const lines = [top, top + head, ...Array.from({ length: rows - (last ? 0 : 1) }, (_, i) => top + head + pitch * (i + 1))];
  for (const y of lines) for (let x = 60; x < 940; x++) grey(x, y);
  const xs = [60, 190, 300, 500, 640, 760, 840, 930];
  for (const x of xs) for (let y = top + head; y < top + head + pitch * rows; y++) grey(x, y);
  if (!last) for (let y = top + head + pitch * (rows - 1) + 20; y < top + head + pitch * rows - 20; y++) for (let x = 100; x < 160; x++) {
    const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return { width, height, data, xs, top };
}
const makeCanvas = (w, h) => { const img = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  return { width: w, height: h, getContext: () => ({ createImageData: () => img, putImageData() {} }) }; };

test('the grid gives one band per row (the header band is left out) and the column lines', () => {
  const grid = findGrid(page(5));
  assert.equal(grid.bands.length, 5);
  assert.equal(grid.xs.length, 8);
  assert.equal(grid.headerTop, 200);
});

test('a last row with no line under it is still found when it holds ink', () => {
  assert.equal(findGrid(page(5, { last: false })).bands.length, 5);
});

test('amounts, services and dates are read from noisy text', () => {
  assert.equal(amountOf('289.00'), 28900);
  assert.equal(amountOf('3200'), 3200); // a dropped point is read as whole minor units
  assert.equal(amountOf('abc'), null);
  assert.equal(serviceOf('Grabrood'), 'GrabFood');
  assert.equal(serviceOf('Standard Bike'), 'Standard Bike');
  assert.equal(serviceOf('Standard | Car only'), 'Standard | Car only');
  assert.equal(serviceOf('Zzzz Qqqq'), 'Zzzz Qqqq');
});

// Scripted recogniser: header text, amount passes, services, then three date passes (the order the reader asks).
function scripted({ header, amounts, services, dates }) {
  const queue = [header, ...amounts.flat(), ...services, ...dates.flat()];
  let at = 0;
  return async () => queue[at++] ?? '';
}
const base = (n) => ({ header: 'Total Transactions: 3 Amount: THB 40.00', services: ['GrabFood', 'Standard Bike', 'Grabrood'],
  dates: [['27 Oct 2026, 10:25AM', '25 Oct 2026, 08:07AM', '22 Oct 2026, 07:13AM'],
    ['27 Oct 2026,', '25 Oct 2028,', '22 Oct 2026,'], ['27 Oct 2026,', '25 Oct 2026,', '22 Oct 2026,']], n });

test('a trip table is read and checked against the printed count and total', async () => {
  const out = await readTripTable({ pages: [page(3)], makeCanvas,
    recognise: scripted({ ...base(), amounts: [['10.00', '25.00', '5.00']] }) });
  assert.deepEqual(out.trips.map(({ date, service, amount, category }) => [date, service, amount, category]), [
    ['2026-10-27', 'GrabFood', 1000, 'Eating out'], ['2026-10-25', 'Standard Bike', 2500, 'Transport'],
    ['2026-10-22', 'GrabFood', 500, 'Eating out']]);
  assert.equal(out.declared.total, 4000);
});

test('one misread digit is fixed by a later pass when that makes the total add up', async () => {
  const out = await readTripTable({ pages: [page(3)], makeCanvas,
    recognise: scripted({ ...base(), amounts: [['10.00', '75.00', '5.00'], ['10.00', '25.00', '5.00']] }) });
  assert.deepEqual(out.trips.map(({ amount }) => amount), [1000, 2500, 500]);
});

test('amounts that never add up to the printed total are refused', async () => {
  const wrong = ['10.00', '75.00', '5.00'];
  const out = await readTripTable({ pages: [page(3)], makeCanvas,
    recognise: scripted({ ...base(), amounts: [wrong, wrong, wrong] }) });
  assert.match(out.reason, /do not add up/);
});

test('a row count that differs from the printed count is refused before any reading', async () => {
  const out = await readTripTable({ pages: [page(3)], makeCanvas, recognise: async () => 'Total Transactions: 4 Amount: THB 40.00' });
  assert.match(out.reason, /says 4 trips but 3 rows/);
});

test('a missing printed total refuses the reading', async () => {
  const out = await readTripTable({ pages: [page(3)], makeCanvas, recognise: async () => 'nothing useful' });
  assert.match(out.reason, /cannot be checked/);
});

test('a date that breaks the newest-first order after three passes is refused', async () => {
  const dates = [['27 Oct 2026,', '29 Oct 2026,', '22 Oct 2026,'], ['27 Oct 2026,', '29 Oct 2026,', '22 Oct 2026,'],
    ['27 Oct 2026,', '29 Oct 2026,', '22 Oct 2026,']];
  const out = await readTripTable({ pages: [page(3)], makeCanvas,
    recognise: scripted({ ...base(), dates, amounts: [['10.00', '25.00', '5.00']] }) });
  assert.match(out.reason, /date of trip [12] could not be read reliably/);
});

test('import flow: a picture-only source on a PDF renders the pages and reads them; no engine means refusal', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.4 fake');
  const reader = { renderPages: async () => ['page'] };
  const source = { readPicture: async (pages, ocr) => ({ rows: [], coverage: { from: '2026-01-01', to: '2026-01-02' },
    balances: [], trips: [{ date: '2026-01-01', service: 'GrabFood', amount: 1, currency: null, category: 'Eating out' }], seen: ocr.tag }) };
  const ready = await prepareImport({ bytes: pdf, name: 'a.pdf', accountId: 'a', source, reader, ocr: { tag: 'engine', makeCanvas } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.parsed.seen, 'engine');
  assert.match(ready.fileHash, /^[0-9a-f]{64}$/);
  assert.equal((await prepareImport({ bytes: pdf, name: 'a.pdf', accountId: 'a', source, reader })).status, 'rejected');
  const refused = await prepareImport({ bytes: pdf, name: 'a.pdf', accountId: 'a', reader, ocr: {},
    source: { readPicture: async () => ({ reason: 'No.' }) } });
  assert.deepEqual([refused.status, refused.reason], ['rejected', 'No.']);
  assert.equal(typeof s6.readPicture, 'function');
});
