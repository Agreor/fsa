import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCIES, convertedHeading, createCurrencySetting, formatAmount }
  from '../app/settings.js';

test('convertedHeading names the currency', () => {
  assert.equal(convertedHeading('EUR'), 'In EUR');
  assert.equal(convertedHeading('THB'), 'In THB');
  assert.equal(convertedHeading('USD'), 'In EUR');
  assert.equal(convertedHeading(''), 'In EUR');
});

test('currency setting defaults, validates and tolerates storage errors', () => {
  const values = new Map();
  const setting = createCurrencySetting({ getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value) });
  assert.deepEqual(CURRENCIES, ['EUR', 'THB']);
  assert.equal(setting.get(), 'EUR');
  assert.equal(setting.set('THB'), 'THB');
  assert.equal(setting.get(), 'THB');
  for (const value of ['USD', '', null]) {
    values.set('fsa.currency', value); assert.equal(setting.get(), 'EUR');
  }
  assert.throws(() => setting.set('USD'), TypeError);
  assert.equal(createCurrencySetting({ getItem() { throw Error(); } }).get(), 'EUR');
  assert.equal(createCurrencySetting({ setItem() { throw Error(); } }).set('EUR'), 'EUR');
});

test('formatAmount uses integer minor units', () => {
  for (const [input, output] of [[0, '0.00 EUR'], [5, '0.05 EUR'], [-5, '-0.05 EUR'],
    [1230, '12.30 EUR'], [-1230, '-12.30 EUR'], [100, '1.00 EUR'],
    [Number.MAX_SAFE_INTEGER, '90071992547409.91 EUR']]) {
    assert.equal(formatAmount(input, 'EUR'), output);
  }
  assert.equal(formatAmount(5, 'THB'), '0.05 THB');
});
