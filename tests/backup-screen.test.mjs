import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderBackup } from '../app/backup-screen.js';

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
const buttons = (root) => root.find((node) => node.tag === 'button').map((node) => node.textContent);
const click = (root, label) => root.find((node) => node.tag === 'button'
  && node.attributes['aria-label'] === label)[0]?.fire('click');
const handlers = (calls) => ({ onDownload: () => calls.push('download'),
  onPick: (f) => calls.push(['pick', f]), onRestore: () => calls.push('restore'),
  onCancel: () => calls.push('cancel') });

test('the idle screen offers a download and a labelled file input only', () => {
  const root = makeRoot(), calls = [];
  renderBackup(root, { pending: null, message: '' }, handlers(calls));
  assert.deepEqual(buttons(root), ['Download backup']);
  const [input] = root.find((node) => node.tag === 'input');
  assert.equal(input.type, 'file');
  assert.equal(input.attributes['aria-label'], 'Backup file');
  assert.match(input.accept, /json/);
  input.files = ['the-file']; input.fire('change');
  click(root, 'Download backup');
  assert.deepEqual(calls, [['pick', 'the-file'], 'download']);
});

test('the counts use the singular for one', () => {
  const root = makeRoot();
  const pending = { counts: { rows: 1, batches: 1, accounts: 1 }, createdAt: '2026-03-04' };
  renderBackup(root, { pending, message: '' }, handlers([]));
  assert.match(root.textContent, /This backup has 1 transaction, 1 import and 1 account, made 2026-03-04/);
});

test('a pending backup shows its counts and the three choices', () => {
  const root = makeRoot(), calls = [];
  const pending = { counts: { rows: 12, batches: 3, accounts: 2 }, createdAt: '2026-03-04T10:00:00.000Z' };
  renderBackup(root, { pending, message: '' }, handlers(calls));
  assert.match(root.textContent,
    /This backup has 12 transactions, 3 imports and 2 accounts, made 2026-03-04/);
  assert.match(root.textContent, /Restoring replaces everything in this browser\./);
  assert.deepEqual(buttons(root), ['Download backup', 'Download current data first',
    'Replace everything with this backup', 'Cancel']);
  click(root, 'Download current data first'); click(root, 'Replace everything with this backup');
  click(root, 'Cancel');
  assert.deepEqual(calls, ['download', 'restore', 'cancel']);
});

test('a message is a status paragraph and rendering again replaces the old content', async () => {
  const root = makeRoot();
  renderBackup(root, { pending: null, message: 'Cannot use this file: not a backup file.' }, handlers([]));
  const [status] = root.find((node) => node.tag === 'p');
  assert.equal(status.attributes.role, 'status');
  assert.equal(status.textContent, 'Cannot use this file: not a backup file.');
  renderBackup(root, { pending: null, message: '' }, handlers([]));
  assert.equal(root.find((node) => node.tag === 'p').length, 0);
  const source = await readFile(new URL('../app/backup-screen.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /import /);
});
