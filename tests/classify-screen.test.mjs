import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderClassify } from '../app/classify-screen.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  fire(type) { return this.listeners[type]?.(); }
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
const buttons = (root) => root.find((node) => node.tag === 'button');
const labels = (root) => buttons(root).map((node) => node.textContent);
const press = (root, label) => buttons(root)
  .find((node) => node.attributes['aria-label'] === label).fire('click');
const handlers = (calls) => ({ onFind: () => calls.push('find'),
  onToggle: (...args) => calls.push(['toggle', ...args]), onSelectAll: (on) => calls.push(['all', on]),
  onSend: () => calls.push('send'), onCancel: () => calls.push('cancel') });
const view = (extra = {}) => ({ items: [{ text: 'LIDL BRUSSELS', count: 2 }, { text: 'UBER TRIP', count: 1 }],
  notes: ['1 transaction from bank accounts stays on this device.'], ...extra });
const state = (extra = {}) => ({ view: null, selected: new Set(), busy: false, message: '', ...extra });

test('idle: only the find button', () => {
  const root = makeRoot(), calls = [];
  renderClassify(root, state(), handlers(calls));
  assert.deepEqual(labels(root), ['Find merchants to categorise']);
  press(root, 'Find merchants to categorise');
  assert.deepEqual(calls, ['find']);
});

test('a list shows names with counts, ticked boxes, the privacy sentence and the notes', () => {
  const root = makeRoot(), calls = [];
  renderClassify(root, state({ view: view(), selected: new Set(['LIDL BRUSSELS']) }), handlers(calls));
  assert.match(root.textContent, /2 merchant names from your credit-card accounts have no category/);
  assert.match(root.textContent, /Only the name is sent: no amounts, dates or account details\./);
  assert.match(root.textContent, /LIDL BRUSSELS \(2\)/);
  assert.match(root.textContent, /1 transaction from bank accounts stays on this device\./);
  const boxes = root.find((node) => node.tag === 'input');
  assert.deepEqual(boxes.map((box) => [box.attributes['aria-label'], box.checked]),
    [['Send LIDL BRUSSELS', true], ['Send UBER TRIP', false]]);
  boxes[1].checked = true; boxes[1].fire('change');
  assert.deepEqual(calls, [['toggle', 'UBER TRIP', true]]);
  assert.deepEqual(labels(root), ['Find merchants to categorise', 'Select all', 'Select none',
    'Send 1 selected to the classifier', 'Cancel']);
  press(root, 'Select none'); press(root, 'Select all'); press(root, 'Send 1 selected to the classifier');
  press(root, 'Cancel');
  assert.deepEqual(calls.slice(1), [['all', false], ['all', true], 'send', 'cancel']);
});

test('nothing selected disables send, and busy disables everything', () => {
  const none = makeRoot();
  renderClassify(none, state({ view: view() }), handlers([]));
  const send = buttons(none)
    .find((node) => node.attributes['aria-label'] === 'Send 0 selected to the classifier');
  assert.equal(send.disabled, true);
  const busy = makeRoot();
  renderClassify(busy, state({ view: view(), selected: new Set(['UBER TRIP']), busy: true }), handlers([]));
  assert.ok(buttons(busy).every((node) => node.disabled));
  assert.ok(busy.find((node) => node.tag === 'input').every((box) => box.disabled));
});

test('an empty list and the singular wording', () => {
  const empty = makeRoot();
  renderClassify(empty, state({ view: { items: [], notes: [] } }), handlers([]));
  assert.match(empty.textContent, /No merchant names are waiting for a category\./);
  assert.deepEqual(labels(empty), ['Find merchants to categorise', 'Cancel']);
  const one = makeRoot();
  renderClassify(one, state({ view: { items: [{ text: 'UBER TRIP', count: 1 }], notes: [] } }), handlers([]));
  assert.match(one.textContent, /1 merchant name from your credit-card accounts/);
});

test('a message is a status paragraph, and the module never uses innerHTML or imports', async () => {
  const root = makeRoot();
  renderClassify(root, state({ message: 'Saved 2 categories.' }), handlers([]));
  const [status] = root.find((node) => node.tag === 'p');
  assert.equal(status.attributes.role, 'status');
  assert.equal(status.textContent, 'Saved 2 categories.');
  for (const file of ['classify-screen.js', 'classify-data.js']) {
    const source = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML/, file);
    assert.doesNotMatch(source, /^import /m, file);
  }
});
