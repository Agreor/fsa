import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grid } from '../app/charts.js';
import { renderBanks } from '../app/banks-screen.js';
import { renderCards } from '../app/cards-screen.js';

class Node {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.className = ''; this.textContent = ''; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  addEventListener() {}
}
const doc = { createElement: (t) => new Node(t), createElementNS: (_n, t) => new Node(t) };
const all = (n) => [n, ...n.children.flatMap(all)];
const texts = (n) => all(n).filter((x) => x.textContent).map((x) => x.textContent);
const rootWith = (id) => { const box = new Node('div'); return { box, root: { ownerDocument: doc, querySelector: () => box } }; };

test('grid has a header row, row headers, numeric columns and a marked total row', () => {
  const table = all(grid(doc, ['A', 'B'], [{ cells: ['x', '1'] }, { cells: ['All', '2'], total: true }])).filter((n) => n.tag === 'tr');
  assert.equal(table.length, 3);
  assert.equal(table[1].children[0].tag, 'th');
  assert.equal(table[1].children[1].className, 'num');
  assert.equal(table[2].className, 'grid-total');
});

const item = (over = {}) => ({ income: '0.00 THB', transfers: '0.00 THB', cardPayments: '0.00 THB', spending: '5.00 THB', saved: '0.00 THB',
  opening: '10.00 THB', closing: '5.00 THB', change: '-5.00 THB', closedAsOf: null, partial: false, ...over });
const accountsData = (transfers) => ({ month: '2026-10', trend: {}, totals: item({ transfers }),
  accounts: [{ id: 'a', name: 'Bank A', balances: [{ value: '100.00 THB' }], ...item({ transfers }) },
    { id: 'b', name: 'Bank B', balances: [{ value: '20.00 THB' }, { value: null }], ...item() }] });

test('accounts table: one row per account and a total; Transfers only appears once a transfer exists', () => {
  const quiet = rootWith(); renderBanks(quiet.root, accountsData('0.00 THB'));
  const headers = all(quiet.box).filter((n) => n.tag === 'th' && n.attrs.scope === 'col').map((n) => n.textContent);
  assert.deepEqual(headers, ['Account', 'Opening', 'Closing', 'Change', 'Income', 'Card payments', 'Spending', 'Saved']);
  assert.ok(texts(quiet.box).includes('All accounts'));
  const busy = rootWith(); renderBanks(busy.root, accountsData('3.00 THB'));
  assert.ok(all(busy.box).some((n) => n.textContent === 'Transfers'));
});

test('cards table: one row per card, and one pie that adds the cards together', () => {
  const card = (name, amount) => ({ name, charges: `${amount / 100} THB`, payments: '0.00 THB', statement: null, owed: null, partial: false, note: null,
    categories: [{ category: 'Food', amount, value: `${amount / 100} THB` }] });
  const { box, root } = rootWith();
  renderCards(root, { month: '2026-10', cards: [card('Visa', 150000), card('Amex', 250000)] });
  assert.ok(texts(box).includes('Visa') && texts(box).includes('Amex'));
  assert.ok(texts(box).includes('4,000.00 THB')); // 1,500 + 2,500 in the one Food slice
});

test('accounts table says when the data ends before the month does', () => {
  const { box, root } = rootWith();
  const data = accountsData('0.00 THB'); data.accounts[0].closedAsOf = '2026-10-26';
  renderBanks(root, data);
  assert.ok(texts(box).some((text) => text === 'Bank A: the data ends 2026-10-26, so Closing is as of that date.'));
});
