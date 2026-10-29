import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMonth } from '../app/month-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
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
  for (const name of ['month-picker', 'summary', 'categories', 'notice', 'suggested', 'rows']) {
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
  suggested: [{ id: 's', legs: [{ rowId: 'r1', date: '2026-03-01', description: 'Move', amount: -4,
    currency: 'EUR' }] }], rows: [
    { id: 'r1', date: '2026-03-01', description: 'Credit', amount: 10, currency: 'EUR',
      role: 'income', isTransfer: false, isSuggested: true },
    { id: 'r2', date: '2026-03-02', description: 'Debit', amount: -4, currency: 'EUR',
      isTransfer: true, isSuggested: false },
  ] };
const fmt = (amount, currency) => `${amount} ${currency}`;
const loaded = { ...data, summary: [{ label: 'Income', value: 'loaded summary' },
  { label: 'Spending', value: 'loaded signed spending' }], categories: [
  { category: 'Loaded category', value: 'loaded category value' }], notice: 'loaded notice',
  spendingNote: 'loaded refund note' };

test('renders summary, categories, notice, suggestions, rows and mark changes', () => {
  const { root, regions } = makeRoot(), calls = [];
  renderMonth(root, loaded, { onMonth: (value) => calls.push(value), onMark: (...args) => calls.push(args),
    onConfirm: (id) => calls.push(id), onNotTransfer: (ids) => calls.push(ids) });
  assert.match(regions.summary.textContent, /loaded summary/);
  assert.match(regions.categories.textContent, /Loaded category: loaded category value/);
  assert.match(regions.notice.textContent, /loaded notice/);
  assert.match(regions.summary.textContent, /loaded refund note/);
  assert.equal(regions.notice.hidden, false);
  assert.equal(regions.suggested.children.length, 1);
  const buttons = regions.suggested.children[0].children.filter((item) => item.tag === 'button');
  buttons[0].dispatch('click'); buttons[1].dispatch('click');
  assert.deepEqual(calls.slice(0, 2), ['s', ['r1']]);
  const table = regions.rows.children[0].children[0], body = table.children[1];
  assert.match(body.children[0].textContent, /Transfer \(to confirm\)/);
  assert.equal(body.children[0].children[4].children[0].tag, 'select');
  assert.equal(body.children[1].children[4].children.length, 0);
  body.children[0].children[4].children[0].value = 'refund';
  body.children[0].children[4].children[0].dispatch('change');
  assert.deepEqual(calls[2], ['r1', 'refund']);
  renderMonth(root, { empty: true }, {}, fmt);
  assert.match(regions.summary.textContent, /No transactions yet/);
  assert.equal(regions.rows.hidden, true);
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
  assert.equal(regions.rows.children.length, 1);
  assert.equal(regions.notice.hidden, true);
});

test('incompleteNote renders under the summary and is replaced on re-render', () => {
  const { root, regions } = makeRoot();
  const note = 'Some amounts could not be converted, so these totals are incomplete.';
  renderMonth(root, { ...data, incompleteNote: note }, {});
  const paragraph = regions.summary.children[1];
  assert.equal(paragraph.textContent, note);
  assert.equal(paragraph.attributes.role, 'status');
  renderMonth(root, { ...data, incompleteNote: null }, {});
  assert.doesNotMatch(regions.summary.textContent, /incomplete/);
  renderMonth(root, { ...data, incompleteNote: note }, {});
  assert.equal(regions.summary.children.filter((item) => item.attributes.role === 'status').length, 1);
});
