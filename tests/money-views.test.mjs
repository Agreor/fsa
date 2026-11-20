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

const item = (over = {}) => ({ cashIn: '0.00 THB', cashOut: '5.00 THB', income: '0.00 THB', transfers: '0.00 THB', cardPayments: '0.00 THB', spending: '5.00 THB', saved: '0.00 THB',
  opening: '10.00 THB', closing: '5.00 THB', change: '-5.00 THB', closedAsOf: null, partial: false,
  other: '0.00 THB', gap: '0.00 THB', ownMoves: '0.00 THB', amounts: { other: 0, gap: 0, ownMoves: 0 }, ...over });
const accountsData = (transfers) => ({ month: '2026-10', trend: {}, totals: item({ transfers }),
  accounts: [{ id: 'a', name: 'Bank A', balances: [{ value: '100.00 THB' }], ...item({ transfers }) },
    { id: 'b', name: 'Bank B', balances: [{ value: '20.00 THB' }, { value: null }], ...item() }] });

test('accounts table: Opening, Cash in, Cash out, Closing, Data to; the split of cash out is its own table', () => {
  const { box, root } = rootWith(); renderBanks(root, accountsData('0.00 THB'));
  const headers = all(box).filter((n) => n.tag === 'th' && n.attrs.scope === 'col').map((n) => n.textContent);
  assert.deepEqual(headers, ['Account', 'Opening', 'Cash in', 'Cash out', 'Closing', 'Account', 'Spending', 'Card payments', 'Saved']);
  assert.ok(texts(box).includes('All accounts'));
  assert.ok(texts(box).includes('Where cash out went'));
  assert.ok(!texts(box).includes('Data to')); // no account ends early
});

test('a Between your accounts column appears when own transfers moved a balance', () => {
  const { box, root } = rootWith();
  const data = accountsData('0.00 THB'); data.accounts[0].amounts = { other: 0, gap: 0, ownMoves: -5000 }; data.accounts[0].ownMoves = '-50.00 THB';
  renderBanks(root, data);
  assert.ok(all(box).some((n) => n.tag === 'th' && n.textContent === 'Between your accounts'));
});

test('an Other column appears only when some cash out is none of spending, card payments or saved', () => {
  const { box, root } = rootWith();
  const data = accountsData('0.00 THB'); data.accounts[0].amounts = { other: 500, gap: 0 }; data.accounts[0].other = '5.00 THB';
  renderBanks(root, data);
  assert.ok(all(box).some((n) => n.tag === 'th' && n.textContent === 'Other'));
});

test('cards table: one row per card, and one pie that adds the cards together', () => {
  const card = (name, amount) => ({ name, charges: `${amount / 100} THB`, payments: '0.00 THB', statement: null, owed: null, partial: false, note: null,
    categories: [{ category: 'Food', amount, value: `${amount / 100} THB` }] });
  const { box, root } = rootWith();
  renderCards(root, { month: '2026-10', cards: [card('Visa', 150000), card('Amex', 250000)] });
  assert.ok(texts(box).includes('Visa') && texts(box).includes('Amex'));
  assert.ok(texts(box).includes('4,000.00 THB')); // 1,500 + 2,500 in the one Food slice
});

test('accounts table shows where the data ends, and says once when opening plus movements is off closing', () => {
  const { box, root } = rootWith();
  const data = accountsData('0.00 THB');
  Object.assign(data.accounts[0], { closedAsOf: '2026-10-26', gap: '0.21 THB', amounts: { other: 0, gap: 21 } });
  renderBanks(root, data);
  assert.ok(texts(box).includes('Data to') && texts(box).includes('2026-10-26') && texts(box).includes('month end'));
  assert.ok(texts(box).some((text) => /off Closing by 0\.21 \(Bank A\)/.test(text)));
  const clean = rootWith(); renderBanks(clean.root, accountsData('0.00 THB'));
  assert.ok(!texts(clean.box).some((text) => /off Closing/.test(text)));
});

test('cards: the statement date is always named, and its figure only when the debt has moved', () => {
  const card = (name, debt, owed) => ({ name, charges: '1.00 THB', payments: '0.00 THB', statement: { asOf: '2026-10-11', debt }, owed, partial: false, note: null, categories: [] });
  const { box, root } = rootWith();
  renderCards(root, { month: '2026-10', cards: [card('Visa', '9.00 THB', '9.00 THB'), card('Amex', '5.00 THB', '8.00 THB')] });
  assert.ok(texts(box).includes('Visa: from the 2026-10-11 statement.'));
  assert.ok(texts(box).includes('Amex: from the 2026-10-11 statement, which showed 5.00 THB.'));
});
