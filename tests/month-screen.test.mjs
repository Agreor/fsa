import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMonth } from '../app/month-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  dispatch(type) { this.listeners[type]?.({ currentTarget: this }); }
  getAttribute(key) { return this.attributes[key]; }
  querySelectorAll() { return this.children; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(''); }
}
const makeRoot = () => {
  const doc = { createElement: (tag) => new Element(tag) };
  const root = new Element('root'); root.ownerDocument = doc;
  for (const name of ['month-picker', 'summary', 'categories', 'notice', 'suggested']) {
    const region = new Element('div'); region.setAttribute('data-region', name); root.append(region);
  }
  root.querySelectorAll = (selector) => selector === '[data-region]' ? root.children : [];
  const regions = Object.fromEntries(root.children.map((node) =>
    [node.getAttribute('data-region'), node]));
  return { root, regions };
};
const data = { empty: false, months: ['2026-03'], month: '2026-03', currency: 'EUR',
  summary: [{ label: 'Income', value: '10 EUR' }], categories: [{ category: 'Food', value: '4 EUR' }],
  notice: '1 amount is in transfer waiting for your confirmation and are still counted.',
  spendingNote: null,
  view: { income: 10, spending: 4, net: 6, uncategorised: 1, cashMovement: { out: 4, in: 10, net: 6 },
    byCategory: [{ category: 'Food', amount: 4 }], pendingSuggestions: { count: 1 } },
  categoryNames: ['Groceries', 'Housing'],
  suggested: [{ id: 's', legs: [{ rowId: 'r1', date: '2026-03-01', description: 'Move', amount: -4,
    currency: 'EUR' }] }], rows: [
    { id: 'r1', date: '2026-03-01', description: 'Credit', amount: 10, currency: 'EUR',
      role: 'income', isTransfer: false, isSuggested: true },
    { id: 'r2', date: '2026-03-02', description: 'Debit', amount: -4, currency: 'EUR',
      category: 'Uncategorised', categoryEditable: true, isTransfer: false, isSuggested: false },
    { id: 'r3', date: '2026-03-03', description: 'Terminal', amount: -2, currency: 'EUR',
      category: 'Uncategorised', categoryEditable: false, isTransfer: false, isSuggested: false },
  ] };
const fmt = (amount, currency) => `${amount} ${currency}`;
const loaded = { ...data, summary: [{ label: 'Income', value: 'loaded summary' },
  { label: 'Spending', value: 'loaded signed spending' }], categories: [
  { category: 'Loaded category', value: 'loaded category value' }], notice: 'loaded notice',
  spendingNote: 'loaded refund note' };

test('renders summary, categories, notice and suggestions', () => {
  const { root, regions } = makeRoot(), calls = [];
  renderMonth(root, loaded, { onMonth: (value) => calls.push(value), onMark: (...args) => calls.push(args),
    onCategory: (...args) => calls.push(args),
    onConfirm: (id) => calls.push(id), onNotTransfer: (ids) => calls.push(ids) });
  assert.match(regions.summary.textContent, /loaded summary/);
  assert.match(regions.categories.textContent, /Loaded category.*loaded category value/);
  assert.match(regions.notice.textContent, /loaded notice/);
  assert.match(regions.summary.textContent, /loaded refund note/);
  assert.equal(regions.notice.hidden, false);
  assert.equal(regions.suggested.children.length, 1);
  const buttons = regions.suggested.children[0].children.filter((item) => item.tag === 'button');
  buttons[0].dispatch('click'); buttons[1].dispatch('click');
  assert.deepEqual(calls.slice(0, 2), ['s', ['r1']]);
  renderMonth(root, { empty: true }, {}, fmt);
  assert.match(regions.summary.textContent, /No transactions yet/);
});

test('the screen renders the summary, categories, notice and note exactly as loaded', () => {
  const { root, regions } = makeRoot();
  const result = { ...loaded, view: undefined };
  renderMonth(root, result, {});
  assert.match(regions.summary.textContent, /loaded summary/);
  assert.match(regions.summary.textContent, /loaded signed spending/);
  assert.match(regions.categories.textContent, /loaded category value/);
  assert.equal(regions.notice.textContent, 'loaded notice');
  assert.match(regions.summary.textContent, /loaded refund note/);
});

test('re-render replaces content and empty category text is shown', () => {
  const { root, regions } = makeRoot();
  const emptyCategories = { ...data, view: { ...data.view, byCategory: [], pendingSuggestions: { count: 0 } },
    categories: [], notice: null, suggested: [], rows: [] };
  renderMonth(root, emptyCategories, {}, fmt);
  renderMonth(root, emptyCategories, {}, fmt);
  assert.equal(regions.categories.textContent, 'No spending in this month.');
  assert.equal(regions.notice.hidden, true);
});

test('incompleteNote renders under the summary and is replaced on re-render', () => {
  const { root, regions } = makeRoot();
  const note = 'Some amounts could not be converted, so these totals are incomplete.';
  renderMonth(root, { ...data, incompleteNote: note }, {});
  const paragraph = regions.summary.children.find((item) => item.attributes.role === 'status');
  assert.equal(paragraph.textContent, note);
  assert.equal(paragraph.attributes.role, 'status');
  renderMonth(root, { ...data, incompleteNote: null }, {});
  assert.doesNotMatch(regions.summary.textContent, /incomplete/);
  renderMonth(root, { ...data, incompleteNote: note }, {});
  assert.equal(regions.summary.children.filter((item) => item.attributes.role === 'status').length, 1);
});

test('a month with no bank statement says so instead of showing a made-up cash flow', () => {
  const { root, regions } = makeRoot();
  renderMonth(root, { ...data, missingBank: true, summary: [{ label: 'Spending', value: '40 EUR' },
    { label: 'Cash net', value: '0 EUR' }] }, {});
  const text = regions.summary.textContent;
  assert.match(text, /Spending.*40 EUR/);
});

test('cash flow is a headline tile next to spending; income stays out of the headline', () => {
  const { root, regions } = makeRoot();
  renderMonth(root, { ...data, summary: [{ label: 'Income', value: '1 EUR' }, { label: 'Spending', value: '2 EUR' },
    { label: 'Net', value: '-1 EUR' }, { label: 'Cash net', value: '9 EUR' }] }, {});
  assert.match(regions.summary.children[0].textContent, /Cash flow.*9 EUR.*bank money in minus out/);
  assert.doesNotMatch(regions.summary.children[0].textContent, /Income|Net\b/);
});
