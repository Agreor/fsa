import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stacked } from '../app/charts.js';

class Node {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; this.textContent = ''; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { this.children.push(...kids); }
}
const doc = { createElement: (t) => new Node(t), createElementNS: (_ns, t) => new Node(t) };
const all = (n) => [n, ...n.children.flatMap(all)];

test('stacked bar names four slices and folds the rest into Other', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((label, i) => ({ label, amount: 60 - i * 10, text: `${60 - i * 10}`, share: '' }));
  const arcs = all(stacked(doc, rows)).filter((n) => n.className.startsWith('stack-seg'));
  assert.deepEqual(arcs.map((a) => a.className), ['stack-seg slice-1', 'stack-seg slice-2', 'stack-seg slice-3', 'stack-seg slice-4', 'stack-seg slice-other']);
  assert.equal(all(stacked(doc, rows)).filter((n) => n.className === 'share-name').at(-1).textContent, 'Other');
});
