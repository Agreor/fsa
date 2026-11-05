import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/sources/s3.js';
import { validateParsed } from '../src/contracts.js';

const csv = ({ period = 'March 3, 2026 - March 28, 2026', base = 'EUR', prior = '1000.005', cash = '300.5',
  stock = '900.25', total = '1200.75', start = prior, end = total, drop = [] } = {}) => [
  'Statement,Header,Field Name,Field Value',
  'Statement,Data,Title,Activity Statement',
  `Statement,Data,Period,"${period}"`,
  'Account Information,Header,Field Name,Field Value',
  `Account Information,Data,Base Currency,${base}`,
  'Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change',
  `Net Asset Value,Data,Cash ,0,${cash},0,${cash},0`,
  `Net Asset Value,Data,Stock,0,${stock},0,${stock},0`,
  `Net Asset Value,Data,Total,${prior},${total},0,${total},0`,
  'Change in NAV,Data,Starting Value,' + start,
  'Change in NAV,Data,Ending Value,' + end,
  'Codes,Data,"A, quoted ""code""",x',
].filter((line) => !drop.some((word) => line.includes(word))).join('\r\n');

test('reads the dated net asset value anchors in minor units, rounding half away from zero', () => {
  const result = parse('﻿' + csv(), { account: 'b1' });
  assert.deepEqual(result, { rows: [], coverage: { from: '2026-03-03', to: '2026-03-28' }, balances: [
    { currency: 'EUR', asOf: '2026-03-02', amount: 100001 },
    { currency: 'EUR', asOf: '2026-03-28', amount: 120075 }] });
  assert.equal(validateParsed(result).reason, undefined);
});

test('the day before a statement that starts on the first of a month, and a one-day period', () => {
  assert.equal(parse(csv({ period: 'March 1, 2026 - March 1, 2026' }), {}).balances[0].asOf, '2026-02-28');
  assert.deepEqual(parse(csv({ period: 'March 5, 2026' }), {}).coverage,
    { from: '2026-03-05', to: '2026-03-05' });
});

test('rejects what is not a usable activity statement', () => {
  for (const [name, input] of [['empty', ''], ['not csv', 'hello'],
    ['bad period', csv({ period: 'Marsh 3, 2026' })],
    ['reversed period', csv({ period: 'March 9, 2026 - March 3, 2026' })],
    ['bad currency', csv({ base: 'EURO' })],
    ['missing total', csv({ drop: ['Data,Total'] })], ['classes do not add up', csv({ stock: '800' })],
    ['change in NAV differs', csv({ end: '1200.00' })], ['cut short', csv().slice(0, 120)]]) {
    assert.equal(typeof parse(input, {}).reason, 'string', name);
  }
  assert.equal(parse(undefined, {}).reason, 'Not an activity statement');
});
