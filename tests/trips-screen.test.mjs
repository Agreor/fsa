import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTrips } from '../app/trips-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(' '); }
  find(predicate, found = []) { if (predicate(this)) found.push(this); this.children.forEach((c) => c.find(predicate, found)); return found; }
}
const box = new Element('div');
const root = { ownerDocument: { createElement: (tag) => new Element(tag) }, querySelector: () => box };
const format = (amount, currency) => `${amount / 100} ${currency}`;
const view = { matches: [{ date: '2026-10-02', amount: 15500, currency: 'THB', service: 'GrabFood', category: 'Eating out' },
  { date: '2026-10-03', amount: 100, currency: 'THB', service: 'Parcel', category: null }],
  unmatchedTrips: 3, unmatchedRows: 1, skipped: 2, usable: 1 };

test('the preview lists each match with its category and offers to apply the usable ones', () => {
  const calls = [];
  renderTrips(root, { view, message: '' }, { onPreview: () => calls.push('preview'), onApply: () => calls.push('apply') }, format);
  const text = box.textContent;
  assert.match(text, /2 card charges matched a trip\. 3 trips had no card charge.*1 card charge had no trip.*2 lines could not be read/);
  assert.match(text, /→ Eating out/);
  assert.match(text, /no category for this service/);
  const buttons = box.find((n) => n.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Preview matches', 'Set 1 category']);
  buttons[1].listeners.click();
  assert.deepEqual(calls, ['apply']);
});

test('with nothing to apply the button is disabled; with no preview only Preview shows', () => {
  renderTrips(root, { view: { ...view, usable: 0 }, message: '' }, {}, format);
  assert.equal(box.find((n) => n.tag === 'button')[1].disabled, true);
  renderTrips(root, { view: null, message: 'Choose a non-empty trip list first.' }, {}, format);
  assert.equal(box.find((n) => n.tag === 'button').length, 1);
  assert.match(box.textContent, /Choose a non-empty trip list first\./);
});
