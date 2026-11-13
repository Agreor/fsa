import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderChecks } from '../app/checks-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { this.listeners.click?.(); }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(''); }
  find(predicate, found = []) {
    if (predicate(this)) found.push(this);
    for (const child of this.children) child.find(predicate, found);
    return found;
  }
}
const makeRoot = () => {
  const root = new Element('div');
  root.ownerDocument = { createElement: (tag) => new Element(tag) };
  return root;
};
const button = (root, label) => root.find((node) => node.tag === 'button'
  && node.attributes['aria-label'] === label)[0];
const texts = (root, tag) => root.find((node) => node.tag === tag).map((node) => node.textContent);
const item = (extra) => ({ currency: 'EUR', opening: { known: false }, suggestion: null, checks: [],
  ...extra });
const account = (currencies, extra = {}) => ({ id: 'a1', name: 'One', currencies, covered: [], gaps: [],
  ...extra });

test('no accounts shows a short message', () => {
  const root = makeRoot();
  renderChecks(root, { accounts: [] }, {});
  assert.equal(root.textContent, 'No accounts yet.');
});

test('an unset opening shows the form and the suggestion, and the buttons call the handlers', () => {
  const root = makeRoot(), calls = [];
  const suggestion = { date: '2026-01-01', amount: 1000, display: '10.00 EUR' };
  renderChecks(root, { accounts: [account([item({ suggestion })])] }, {
    onSetOpening: (...args) => calls.push(['set', ...args]),
    onUseSuggestion: (...args) => calls.push(['use', ...args]), onClear: () => calls.push(['clear']) });
  assert.deepEqual(texts(root, 'h3'), ['One']);
  assert.match(root.textContent, /Starting balance missing/);
  const [date, amount] = root.find((node) => node.tag === 'input');
  assert.equal(date.attributes['aria-label'], 'Opening date for One EUR');
  assert.equal(amount.attributes['aria-label'], 'Opening amount for One EUR');
  date.value = '2026-01-01'; amount.value = '12,5';
  button(root, 'Set opening balance').click();
  button(root, 'Use the statement balance (10.00 EUR on 2026-01-01)').click();
  assert.equal(button(root, 'Clear opening balance'), undefined);
  assert.deepEqual(calls, [['set', 'a1', 'EUR', '2026-01-01', '12,5'], ['use', 'a1', 'EUR', suggestion]]);
});

test('a set opening shows its value and a clear button instead of the form', () => {
  const root = makeRoot(), calls = [];
  renderChecks(root, { accounts: [account([item({ opening: { known: true, date: '2026-01-01',
    display: '10.00 EUR' } })])] }, { onClear: (...args) => calls.push(args) });
  assert.match(root.textContent, /Starting balance: 10\.00 EUR on 2026-01-01/);
  assert.equal(root.find((node) => node.tag === 'input').length, 0);
  button(root, 'Clear opening balance').click();
  assert.deepEqual(calls, [['a1', 'EUR']]);
});

test('each check shows its status wording and coverage lists ranges and gaps', () => {
  const root = makeRoot();
  const checks = [
    { asOf: '2026-01-01', status: 'match', statement: '10.00 EUR', computed: '10.00 EUR',
      difference: '0.00 EUR' },
    { asOf: '2026-01-31', status: 'mismatch', statement: '9.00 EUR', computed: '8.50 EUR',
      difference: '-0.50 EUR' },
    { asOf: '2026-02-28', status: 'unchecked', statement: '8.00 EUR', computed: null, difference: null }];
  renderChecks(root, { accounts: [account([item({ checks })], {
    covered: [{ from: '2026-01-01', to: '2026-01-31' }],
    gaps: [{ from: '2026-02-01', to: '2026-02-01' }] })] }, {});
  const lines = texts(root, 'li');
  assert.deepEqual(lines.slice(0, 3), [
    '2026-01-01: statement 10.00 EUR, computed 10.00 EUR, matches',
    '2026-01-31: statement 9.00 EUR, computed 8.50 EUR, differs by -0.50 EUR',
    '2026-02-28: statement 8.00 EUR, computed unknown, not checked yet, set an opening balance']);
  assert.deepEqual(lines.slice(3),
    ['Covered: 2026-01-01 to 2026-01-31', 'No statement covers 2026-02-01 to 2026-02-01']);
});

test('rendering again replaces the old content and the source never uses innerHTML', async () => {
  const root = makeRoot();
  renderChecks(root, { accounts: [account([item()])] }, {});
  renderChecks(root, { accounts: [] }, {});
  assert.equal(root.textContent, 'No accounts yet.');
  const source = await readFile(new URL('../app/checks-screen.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML/);
});
