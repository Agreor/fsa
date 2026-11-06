import { test } from 'node:test';
import assert from 'node:assert/strict';
import { donut } from '../app/charts.js';

class Node {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; this.textContent = ''; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { this.children.push(...kids); }
}
const doc = { createElement: (t) => new Node(t), createElementNS: (_ns, t) => new Node(t) };
const all = (n) => [n, ...n.children.flatMap(all)];

test('donut names four slices and folds the rest into Other', () => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((label, i) => ({ label, amount: 60 - i * 10, text: `${60 - i * 10}`, share: '' }));
  const arcs = all(donut(doc, rows)).filter((n) => n.attrs.class?.startsWith('slice '));
  assert.deepEqual(arcs.map((a) => a.attrs.class), ['slice slice-1', 'slice slice-2', 'slice slice-3', 'slice slice-4', 'slice slice-other']);
  assert.equal(all(donut(doc, rows)).filter((n) => n.className === 'donut-name').at(-1).textContent, 'Other');
});
