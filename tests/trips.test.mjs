import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrips, matchTrips, tripCategory } from '../src/trips.js';

const rowIdentity = (row) => `${row.account}|${row.date}|${row.amount}|${row.description}`;
const row = (date, amount, description = 'SHOP BANGKOK', currency = 'THB') => ({ account: 'c1', date, amount, currency, description });
const isMerchant = (text) => /shop/i.test(text);

test('services map to categories by their words; unknown ones get none', () => {
  assert.equal(tripCategory('GrabFood'), 'Eating out');
  for (const service of ['Standard Bike', 'Saver Bike', 'Standard | Taxi', 'Standard | Car only']) {
    assert.equal(tripCategory(service), 'Transport', service);
  }
  assert.equal(tripCategory('GrabMart'), 'Groceries');
  assert.equal(tripCategory('Parcel'), null);
});

test('a trip list reads tab, semicolon, comma and long-date lines and counts the unreadable ones', () => {
  const text = ['Date\tType\tAmount', '2026-10-02 10:10\tGrabFood\t155.00', '2026-10-03;Standard Bike;30,00;thb',
    '27 Oct 2026, 10:25AM,GrabFood,289.00', 'nonsense line', '', '2026-10-04\tStandard | Taxi\t155.00'].join('\n');
  const { trips, skipped } = parseTrips(text);
  assert.deepEqual(trips.map(({ date, service, amount, currency }) => [date, service, amount, currency]), [
    ['2026-10-02', 'GrabFood', 15500, null], ['2026-10-03', 'Standard Bike', 3000, 'THB'],
    ['2026-10-27', 'GrabFood', 28900, null], ['2026-10-04', 'Standard | Taxi', 15500, null]]);
  assert.equal(skipped, 2); // the header and the nonsense line
});

test('a trip pairs with one charge of the same amount within two days, nearest first, each charge once', () => {
  const trips = [{ date: '2026-10-02', amount: 15500, currency: null, service: 'GrabFood', category: 'Eating out' },
    { date: '2026-10-02', amount: 15500, currency: null, service: 'Standard Bike', category: 'Transport' },
    { date: '2026-10-09', amount: 100, currency: null, service: 'GrabFood', category: 'Eating out' },
    { date: '2026-10-02', amount: 0, currency: null, service: 'GrabFood', category: 'Eating out' }];
  const rows = [row('2026-10-04', -15500), row('2026-10-02', -15500), row('2026-10-02', -15500, 'OTHER'),
    row('2026-10-02', -9999), row('2026-10-02', 15500)];
  const out = matchTrips({ trips, rows, rowIdentity, isMerchant });
  assert.deepEqual(out.matches.map(({ row: r, trip }) => [r.date, trip.service]),
    [['2026-10-02', 'GrabFood'], ['2026-10-04', 'Standard Bike']]);
  assert.equal(out.unmatchedTrips.length, 1); // the 1.00 trip; the zero-amount trip is ignored
  assert.deepEqual(out.unmatchedRows.map((r) => r.amount), [-9999]);
});

test('a trip with a currency only matches charges in that currency', () => {
  const trips = [{ date: '2026-10-02', amount: 100, currency: 'EUR', service: 'GrabFood', category: 'Eating out' }];
  assert.equal(matchTrips({ trips, rows: [row('2026-10-02', -100)], rowIdentity, isMerchant }).matches.length, 0);
});

test('the trip-list source reads a list into a batch with no rows, coverage and trips; unreadable text is refused', async () => {
  const { parse, input } = await import('../src/sources/s6.js');
  const { validateParsed } = await import('../src/contracts.js');
  assert.equal(input, 'text');
  const out = parse('2026-10-02 10:10\tGrabFood\t155.00\n2026-09-30 11:45\tStandard Bike\t30.00');
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.coverage, { from: '2026-09-30', to: '2026-10-02' });
  assert.deepEqual(validateParsed(out), []);
  assert.match(parse('nothing here').reason, /No trips could be read/);
});
