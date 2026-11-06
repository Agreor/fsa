import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shares } from '../app/charts.js';

class Node {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; this.textContent = ''; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { this.children.push(...kids); }
}
const doc = { createElement: (t) => new Node(t), createElementNS: (_ns, t) => new Node(t) };
const all = (n) => [n, ...n.children.flatMap(all)];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ label: `C${i}`, amount: 100 - i * 10, text: `${100 - i * 10}` }));

test('a few categories become a pie, too few or too many stay bars', () => {
  assert.equal(shares(doc, rows(4)).className, 'donut-wrap');
  assert.equal(shares(doc, rows(2)).className, 'bars');
  assert.equal(shares(doc, rows(8)).className, 'bars');
});

test('six categories show four coloured slices and a grey Other', () => {
  const arcs = all(shares(doc, rows(6))).filter((n) => n.attrs.class?.startsWith('slice '));
  assert.deepEqual(arcs.map((a) => a.attrs.class), ['slice slice-1', 'slice slice-2', 'slice slice-3', 'slice slice-4', 'slice slice-other']);
});
