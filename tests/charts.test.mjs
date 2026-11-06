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

test('three or more categories become a pie, fewer stay bars', () => {
  assert.equal(shares(doc, rows(4)).className, 'donut-wrap');
  assert.equal(shares(doc, rows(2)).className, 'bars');
  assert.equal(shares(doc, rows(8)).className, 'donut-wrap');
});

test('six categories show four coloured slices and a grey Other', () => {
  const arcs = all(shares(doc, rows(6))).filter((n) => n.attrs.class?.startsWith('slice '));
  assert.deepEqual(arcs.map((a) => a.attrs.class), ['slice slice-1', 'slice slice-2', 'slice slice-3', 'slice slice-4', 'slice slice-other']);
});

test('legend shares add up to 100 and the folded row shows its money', () => {
  const r = Array.from({ length: 7 }, (_, i) => ({ label: `C${i}`, amount: 10, text: `${10}.00 EUR` }));
  const legend = all(shares(doc, r));
  const pcts = legend.filter((n) => n.tag === 'strong').map((n) => Number(n.textContent.replace('%', '')));
  assert.equal(pcts.reduce((a, b) => a + b, 0), 100);
  assert.equal(legend.filter((n) => n.className === 'donut-value').at(-1).textContent, '30.00 EUR');
});

test('pie: true keeps one category a pie; a real Other is not duplicated', () => {
  assert.equal(shares(doc, rows(1), { pie: true }).className, 'donut-wrap');
  const r = [...rows(5), { label: 'Other', amount: 5, text: '5' }];
  r.unshift({ label: 'Other', amount: 500, text: '500' });
  const names = all(shares(doc, r)).filter((n) => n.className === 'donut-name').map((n) => n.textContent);
  assert.equal(new Set(names).size, names.length);
});
