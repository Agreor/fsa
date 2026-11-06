import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReview } from '../app/review-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  get firstChild() { return this.children[0]; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(''); }
  find(predicate, found = []) {
    if (predicate(this)) found.push(this);
    for (const child of this.children) child.find(predicate, found);
    return found;
  }
}
const body = new Element('div');
const root = { ownerDocument: { createElement: (tag) => new Element(tag) }, querySelector: () => body };
const format = (amount, currency) => `${amount / 100} ${currency}`;
const item = { key: 'shop', name: 'Shop', sample: 'SHOP 1', currency: 'EUR', count: 2, min: 100, max: 300,
  total: 400, person: false, charges: [{ date: '2026-01-01', amount: 100, rowId: 'r1' }] };
const data = { todo: [item], people: [{ ...item, key: 'to', name: 'To A' }], outOfRange: [], approvals: [],
  rules: [{ key: 'cafe', category: 'Fees', source: 'user', charges: 2 }],
  lineGroups: [{ key: 'grab', name: 'grab', charges: [{ date: '2026-01-02', amount: 500, currency: 'EUR',
    rowId: 'r2', category: 'Transport' }] }],
  categories: ['Uncategorised', 'Transport', 'Fees', 'Other'], currency: 'EUR' };
const calls = [];
const handlers = { onPick: (...a) => calls.push(['pick', ...a]), onPeople: () => calls.push(['people']),
  onExtend() {}, onRevoke() {}, onLine: (...a) => calls.push(['line', ...a]), onRuleChange() {},
  onRuleRemove() {}, onRuleAdd() {} };

test('every section renders, including charges set one by one, and the pickers call their handlers', () => {
  renderReview(root, data, handlers, format);
  const text = body.textContent;
  for (const part of ['To categorise (1)', 'Payments to people (1)', 'Already categorised (1 merchant)',
    'grab: 1 charge, set one by one', 'Normal amounts (0)']) assert.match(text, new RegExp(part.replace(/[()]/g, '\\$&')));
  const pickers = body.find((node) => node.tag === 'select');
  const forCharge = pickers.find((node) => node.attributes['aria-label'] === 'Category for the 2026-01-01 charge');
  forCharge.value = 'Transport';
  forCharge.listeners.change();
  assert.deepEqual(calls.at(-1), ['line', 'r1', 'Transport']);
  const forMerchant = pickers.find((node) => node.attributes['aria-label'] === 'Category for Shop');
  forMerchant.value = 'Fees';
  forMerchant.listeners.change();
  assert.equal(calls.at(-1)[0], 'pick');
});

test('with nothing to do it says so', () => {
  renderReview(root, { ...data, todo: [], people: [], rules: [], lineGroups: [] }, handlers, format);
  assert.match(body.textContent, /Nothing needs a look\./);
});
