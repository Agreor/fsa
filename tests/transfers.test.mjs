import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransfers, ORDINARY_DAYS, TRANSFER_WORDS, REFUND_WORDS, NEGATIVE_WORDS,
  NON_FUNDING_WORDS }
  from '../src/transfers.js';
import { rowIdentity } from '../src/contracts.js';
import { memoryBackend } from '../src/store.js';

const row = (account, amount, date, description = '', currency = 'USD') => ({
  account, amount, date, description, currency, occurrence: 1,
});
const setup = async (accounts, rows = []) => {
  const backend = memoryBackend();
  await backend.commit(rows.map((value) => ({ key: `row:${rowIdentity(value)}`, value })));
  return { backend, transfers: createTransfers({ backend, accounts }) };
};
const cardAccounts = { bank: { kind: 'bank', hints: [] },
  uob: { kind: 'credit_card', hints: ['uob'], hintsAreEvidence: true } };
const ids = (record) => record.legs.map((leg) => leg.rowId);
const fuzzSeed = 734921;
const mulberry32 = (seed) => () => {
  let value = seed += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / (2 ** 32);
};
const pick = (random, values) => values[Math.floor(random() * values.length)];

test('opted-in broker hints cannot override bank-side vetoes', async () => {
  const accounts = { bk: { kind: 'bank', hints: [] },
    br: { kind: 'broker', hints: ['interactive brokers'], hintsAreEvidence: true } };
  const fee = row('bk', -1000, '2026-01-01', 'Interactive Brokers market data subscription fee');
  const deposit = row('br', 1000, '2026-01-02', 'Cash deposit');
  const paired = await setup(accounts, [fee, deposit]);
  await paired.transfers.reconcile();
  assert.deepEqual(await paired.transfers.listTransfers(), []);
  assert.equal((await paired.transfers.transferRowIds()).size, 0);
  const lone = await setup(accounts, [fee]);
  await lone.transfers.reconcile();
  assert.deepEqual(await lone.transfers.listTransfers(), []);
  assert.equal((await lone.transfers.transferRowIds()).size, 0);
});

test('broker foreign-currency counterparts require funding language', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    mexem: { kind: 'broker', hints: ['mexem'], hintsAreEvidence: true } };
  const rows = [row('bank', -100000, '2026-01-01', 'Transfer to Mexem'),
    row('mexem', 5000, '2026-01-01', 'Referral bonus', 'EUR'),
    row('mexem', 100000, '2026-01-02', 'Cash deposit')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.deepEqual(ids(records.find((record) => record.state === 'matched')),
    [rowIdentity(rows[0]), rowIdentity(rows[2])].sort());
  assert.equal(records.some((record) => ids(record).includes(rowIdentity(rows[1]))), false);
});

test('an exact same-currency broker counterpart wins over a nearer foreign-currency row', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    br: { kind: 'broker', hints: ['mexem'] } };
  const rows = [row('bank', -100000, '2026-01-01', 'Transfer to Mexem'),
    row('br', 5000, '2026-01-01', 'Cash deposit', 'EUR'),
    row('br', 100000, '2026-01-02', 'Cash deposit')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  const [match] = records;
  assert.equal(records.length, 1);
  assert.equal(match.kind, 'broker_deposit');
  assert.equal(match.state, 'matched');
  assert.deepEqual(ids(match), [rowIdentity(rows[0]), rowIdentity(rows[2])].sort());
  assert.deepEqual(match.fee, { known: true, amount: 0 });
  assert.equal(records.some((record) => ids(record).includes(rowIdentity(rows[1]))), false);
});

test('an exact same-currency broker withdrawal wins over a nearer foreign-currency row', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    br: { kind: 'broker', hints: ['mexem'] } };
  const rows = [row('bank', 100000, '2026-01-01', 'Transfer from Mexem'),
    row('br', -5000, '2026-01-01', 'Cash withdrawal', 'EUR'),
    row('br', -100000, '2026-01-02', 'Cash withdrawal')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  const [match] = records;
  assert.equal(records.length, 1);
  assert.equal(match.kind, 'broker_withdrawal');
  assert.equal(match.state, 'matched');
  assert.deepEqual(ids(match), [rowIdentity(rows[0]), rowIdentity(rows[2])].sort());
  assert.deepEqual(match.fee, { known: true, amount: 0 });
  assert.equal(records.some((record) => ids(record).includes(rowIdentity(rows[1]))), false);
});

test('broker pairs a foreign-currency funding counterpart when no exact match exists', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    br: { kind: 'broker', hints: ['mexem'] } };
  const rows = [row('bank', -100000, '2026-01-01', 'Transfer to Mexem'),
    row('br', 5000, '2026-01-01', 'Cash deposit', 'EUR')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const [match] = await transfers.listTransfers();
  assert.equal(match.kind, 'broker_deposit');
  assert.equal(match.state, 'matched');
  assert.deepEqual(ids(match), rows.map(rowIdentity).sort());
  assert.deepEqual(match.fee, { known: false });
});

test('supported savings pair wins before unsupported card suggestion', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    savings: { kind: 'bank', hints: ['chase savings'], hintsAreEvidence: true },
    card: { kind: 'credit_card', hints: ['chase'] } };
  const rows = [row('bank', -10000, '2026-01-01', 'Chase savings'),
    row('savings', 10000, '2026-01-02', 'Deposit'),
    row('card', 10000, '2026-01-03', 'Payment thank you')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.ok(records.some((record) => record.kind === 'ordinary' && record.state === 'matched'
    && ids(record).includes(rowIdentity(rows[0])) && ids(record).includes(rowIdentity(rows[1]))));
  assert.ok(!records.some((record) => record.state === 'suggested'
    && ids(record).includes(rowIdentity(rows[0]))));
});

async function assertFuzzScenario(accounts, rows, scenario) {
  const first = await setup(accounts, rows);
  await first.transfers.reconcile();
  const records = await first.transfers.listTransfers();
  const rowCounts = new Map();
  for (const record of records) for (const leg of record.legs) {
    rowCounts.set(leg.rowId, (rowCounts.get(leg.rowId) ?? 0) + 1);
  }
  const prefix = `scenario ${scenario}, seed ${fuzzSeed}`;
  assert.ok([...rowCounts.values()].every((count) => count <= 1), prefix);
  for (const record of records.filter((item) => item.state === 'matched')) {
    assert.equal(record.legs.length, 2, prefix);
    assert.notEqual(record.legs[0].account, record.legs[1].account, prefix);
    if (record.legs[0].currency === record.legs[1].currency) {
      assert.equal(record.legs[0].amount + record.legs[1].amount, 0, prefix);
    }
  }
  assert.deepEqual(await first.transfers.reconcile(), { matched: records.filter((item) =>
    item.state === 'matched').length, provisional: records.filter((item) =>
    item.state === 'provisional').length, suggested: records.filter((item) =>
    item.state === 'suggested').length, added: 0, removed: 0 }, prefix);
  const reversed = await setup(accounts, rows.slice().reverse());
  await reversed.transfers.reconcile();
  assert.deepEqual(await reversed.transfers.listTransfers(), records, prefix);
  const matchedIds = new Set(records.filter((item) => item.state !== 'suggested')
    .flatMap(ids));
  assert.deepEqual(await first.transfers.transferRowIds(), matchedIds, prefix);
  if (rows.length) {
    const deleted = rows[scenario % rows.length];
    await first.backend.commit([{ key: `row:${rowIdentity(deleted)}`, value: undefined }]);
    await first.transfers.reconcile();
    assert.ok((await first.transfers.listTransfers()).every((record) =>
      !ids(record).includes(rowIdentity(deleted))), prefix);
  }
  const confirmed = await setup(accounts, rows);
  await confirmed.transfers.reconcile();
  for (const suggestion of await confirmed.transfers.listTransfers()) {
    if (suggestion.state === 'suggested') await confirmed.transfers.confirmTransfer(suggestion.id);
  }
  await confirmed.transfers.reconcile();
  const confirmedCounts = new Map();
  for (const record of await confirmed.transfers.listTransfers()) for (const leg of record.legs) {
    confirmedCounts.set(leg.rowId, (confirmedCounts.get(leg.rowId) ?? 0) + 1);
  }
  assert.ok([...confirmedCounts.values()].every((count) => count <= 1), prefix);
}

test('matches card payments within five days, conserves amounts, and excludes day eleven', async () => {
  const { backend, transfers } = await setup(cardAccounts, [
    row('bank', -100, '2026-01-02', 'payment to uob'),
    row('uob', 100, '2026-01-07', 'payment thank you'),
  ]);
  assert.deepEqual(await transfers.reconcile(), { matched: 1, provisional: 0, suggested: 0,
    added: 1, removed: 0 });
  const [match] = await transfers.listTransfers();
  assert.equal(match.kind, 'card_payment');
  assert.equal(match.fee.amount, 0);
  assert.equal(match.legs.reduce((sum, leg) => sum + leg.amount, 0), 0);
  const tooLate = await setup(cardAccounts, [row('bank', -100, '2026-01-02', 'payment to uob'),
    row('uob', 100, '2026-01-13')]);
  await tooLate.transfers.reconcile();
  const lateMatches = (await tooLate.transfers.listTransfers())
    .filter((item) => item.state === 'matched');
  assert.equal(lateMatches.length, 0);
});

test('veto words block hints and same-currency card candidates take priority', async () => {
  const brokerAccounts = { bank: { kind: 'bank', hints: [] },
    broker: { kind: 'broker', hints: ['interactive brokers'], hintsAreEvidence: true } };
  const fee = row('bank', -1000, '2026-01-01',
    'Interactive Brokers market data subscription fee');
  const deposit = row('broker', 1000, '2026-01-02', 'Cash deposit');
  const paired = await setup(brokerAccounts, [fee, deposit]);
  await paired.transfers.reconcile();
  assert.deepEqual(await paired.transfers.listTransfers(), []);
  assert.equal((await paired.transfers.transferRowIds()).size, 0);
  const lone = await setup(brokerAccounts, [fee]);
  await lone.transfers.reconcile();
  assert.deepEqual(await lone.transfers.listTransfers(), []);
  assert.equal((await lone.transfers.transferRowIds()).size, 0);

  const accounts = { bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['uob'], hintsAreEvidence: true } };
  const credit = row('card', 10000, '2026-01-02', 'PAYMENT THANK YOU');
  const usdDebit = row('bank', -10000, '2026-01-01', 'Transfer to UOB', 'USD');
  const eurDebit = row('bank', -500, '2026-01-02', 'Transfer to UOB', 'EUR');
  const card = await setup(accounts, [credit, eurDebit, usdDebit]);
  await card.transfers.reconcile();
  assert.deepEqual(ids((await card.transfers.listTransfers())
    .find((item) => item.state === 'matched')), [rowIdentity(credit), rowIdentity(usdDebit)].sort());
  assert.ok((await card.transfers.listTransfers()).some((item) => item.state === 'provisional'
    && ids(item).includes(rowIdentity(eurDebit))));
  await card.backend.commit([{ key: `row:${rowIdentity(eurDebit)}`, value: undefined }]);
  await card.transfers.reconcile();
  await card.backend.commit([{ key: `row:${rowIdentity(eurDebit)}`, value: eurDebit }]);
  await card.transfers.reconcile();
  assert.ok((await card.transfers.listTransfers()).some((item) => item.state === 'matched'
    && ids(item).includes(rowIdentity(usdDebit)) && ids(item).includes(rowIdentity(credit))));
  const feeCard = await setup(accounts, [row('bank', -50, '2026-01-01', 'Transfer fee UOB'),
    row('card', 50, '2026-01-01', 'PAYMENT THANK YOU')]);
  await feeCard.transfers.reconcile();
  assert.equal((await feeCard.transfers.listTransfers()).length, 1);
  assert.equal((await feeCard.transfers.listTransfers())[0].legs.length, 1);
});

test('a reserved card credit cannot be reused as a suggestion anchor', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['uob'] } };
  const { transfers } = await setup(accounts, [
    row('bank', -100, '2026-01-01', 'transfer uob'),
    row('bank', -100, '2026-01-02', 'uob purchase'),
    row('card', 100, '2026-01-01', 'payment thank you'),
  ]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'matched');
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(
    row('card', 100, '2026-01-01', 'payment thank you')))
    && record.state === 'suggested'));
});

test('seeded transfer invariants hold across 300 generated scenarios', async () => {
  const random = mulberry32(fuzzSeed);
  const kinds = ['bank', 'debit_card', 'credit_card', 'broker', 'cash'];
  const descriptions = ['transfer uob', 'payment thank you', 'refund', 'dividend',
    'mexem deposit', 'ordinary purchase', 'virement', 'plain text', 'transfer fee uob',
    'interactive brokers subscription fee', 'refund transfer'];
  const amounts = [-100, -50, -20, 20, 50, 100];
  for (let scenario = 0; scenario < 300; scenario += 1) {
    const accountCount = 2 + Math.floor(random() * 3);
    const accounts = {};
    for (let index = 0; index < accountCount; index += 1) {
      const kind = pick(random, kinds);
      accounts[`a${index}`] = { kind,
        hints: random() < 0.45 ? [kind === 'broker' ? 'mexem' : 'uob'] : [],
        hintsAreEvidence: random() < 0.5 };
    }
    const count = Math.floor(random() * 26);
    const rows = Array.from({ length: count }, (_, index) => ({
      ...row(pick(random, Object.keys(accounts)), pick(random, amounts),
        `2026-03-${String(1 + Math.floor(random() * 20)).padStart(2, '0')}`,
        pick(random, descriptions), pick(random, ['USD', 'EUR'])),
      occurrence: index + 1,
    }));
    await assertFuzzScenario(accounts, rows, scenario);
  }
});

test('overlapping hints pick the longest match whatever the account order', async () => {
  const accounts = { checking: { kind: 'bank', hints: [] },
    savingsA: { kind: 'bank', hints: ['Savings'], hintsAreEvidence: true },
    savingsB: { kind: 'bank', hints: ['Savings 5678'], hintsAreEvidence: true } };
  const rows = [row('checking', -10000, '2026-01-01', 'Transfer to Savings 5678'),
    row('savingsA', 10000, '2026-01-02', 'Consulting income'),
    row('savingsB', 10000, '2026-01-02', 'Deposit')];
  let firstRecords;
  for (const ordered of [accounts, Object.fromEntries(Object.entries(accounts).reverse())]) {
    const { transfers } = await setup(ordered, rows);
    await transfers.reconcile();
    const records = await transfers.listTransfers();
    const ordinary = records.filter((item) => item.kind === 'ordinary');
    assert.equal(ordinary.length, 1);
    assert.deepEqual(ordinary[0].legs.map((leg) => leg.account).sort(), ['checking', 'savingsB']);
    assert.ok(!records.some((item) => item.legs.some((leg) => leg.account === 'savingsA')));
    if (firstRecords) assert.deepEqual(records, firstRecords);
    firstRecords = records;
  }
});

test('equally long hints on two accounts allow either whatever the account order', async () => {
  const accounts = { checking: { kind: 'bank', hints: [] },
    savingsA: { kind: 'bank', hints: ['Savings 5678'], hintsAreEvidence: true },
    savingsB: { kind: 'bank', hints: ['Savings 5678'], hintsAreEvidence: true } };
  const rows = [row('checking', -10000, '2026-01-01', 'Transfer to Savings 5678'),
    row('savingsA', 10000, '2026-01-02', 'Deposit'),
    row('savingsB', 10000, '2026-01-02', 'Deposit')];
  let firstRecords;
  for (const ordered of [accounts, Object.fromEntries(Object.entries(accounts).reverse())]) {
    const { transfers } = await setup(ordered, rows);
    await transfers.reconcile();
    const records = await transfers.listTransfers();
    const ordinary = records.filter((item) => item.kind === 'ordinary');
    assert.equal(ordinary.length, 1);
    assert.ok(ordinary[0].legs.some((leg) => leg.account === 'checking'));
    assert.ok(['savingsA', 'savingsB'].some((account) =>
      ordinary[0].legs.some((leg) => leg.account === account)));
    if (firstRecords) assert.deepEqual(records, firstRecords);
    firstRecords = records;
  }
});

test('generated rows keep the destination, uniqueness and order invariants', async () => {
  const seed = 98245165;
  const random = mulberry32(seed);
  const hintPool = ['savings', 'savings 5678', '4411', 'uob', 'uob card'];
  const descriptions = ['transfer savings', 'payment to savings 5678', '4411 transfer',
    'uob payment', 'transfer uob card', 'payment thank you', 'ordinary purchase',
    'refund transfer', 'virement', 'plain text'];
  const kinds = ['bank', 'debit_card', 'credit_card', 'broker'];
  const currencies = ['USD', 'EUR', 'THB'];
  const amounts = [-100, -50, -20, 20, 50, 100];
  const normaliseHint = (value) => value.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
  const names = (description, accountId, accounts) => Object.entries(accounts)
    .filter(([id, account]) => id !== accountId && account.hintsAreEvidence === true
      && account.hints.some((hint) => {
        const text = ` ${normaliseHint(description)} `;
        return text.includes(` ${normaliseHint(hint)} `);
      })).map(([id]) => id);
  const compare = (records) => records.slice().sort((left, right) => left.id.localeCompare(right.id));

  for (let scenario = 0; scenario < 300; scenario += 1) {
    const caseSeed = `${seed} scenario ${scenario}`;
    const accounts = {};
    const accountCount = 3 + Math.floor(random() * 3);
    for (let index = 0; index < accountCount; index += 1) {
      const kind = pick(random, kinds);
      accounts[`a${index}`] = { kind,
        hints: kind === 'broker' && random() < 0.7 ? ['savings']
          : Array.from({ length: 1 + Math.floor(random() * 2) }, () => pick(random, hintPool)),
        hintsAreEvidence: random() < 0.5 };
    }
    if (accountCount > 3 && random() < 0.7) {
      for (const id of ['a0', 'a1']) accounts[id] = { kind: 'credit_card', hints: ['uob'],
        hintsAreEvidence: random() < 0.5 };
    }
    const rows = Array.from({ length: 4 + Math.floor(random() * 9) }, (_, index) => {
      const account = pick(random, Object.keys(accounts));
      const description = ['bank', 'debit_card', 'cash'].includes(accounts[account].kind)
        && random() < 0.5 ? 'transfer savings' : pick(random, descriptions);
      return { ...row(account, pick(random, amounts),
        `2026-04-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}`,
        description, pick(random, currencies)), occurrence: index + 1 };
    });
    const context = `${caseSeed}; rows=${JSON.stringify(rows)}`;
    const run = async (orderedAccounts, orderedRows) => {
      const { transfers } = await setup(orderedAccounts, orderedRows);
      await transfers.reconcile();
      return compare(await transfers.listTransfers());
    };
    const records = await run(accounts, rows);
    const rowsById = new Map(rows.map((item) => [rowIdentity(item), item]));
    const rowCounts = new Map();
    for (const record of records) for (const leg of record.legs) {
      rowCounts.set(leg.rowId, (rowCounts.get(leg.rowId) ?? 0) + 1);
    }
    assert.ok([...rowCounts.values()].every((count) => count === 1), context);
    for (const record of records.filter((item) => item.legs.length === 2)) {
      const [left, right] = record.legs;
      const leftNames = names(rowsById.get(left.rowId).description, left.account, accounts);
      const rightNames = names(rowsById.get(right.rowId).description, right.account, accounts);
      if (leftNames.length) assert.ok(leftNames.includes(right.account), context);
      if (rightNames.length) assert.ok(rightNames.includes(left.account), context);
    }
    assert.deepEqual(await run(Object.fromEntries(Object.entries(accounts).reverse()), rows),
      records, context);
    assert.deepEqual(await run(accounts, rows.slice().reverse()), records, context);
  }
});

test('cards from one issuer pair nearest first whatever the account order', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    cardA: { kind: 'credit_card', hints: ['chase'], hintsAreEvidence: true },
    cardB: { kind: 'credit_card', hints: ['chase'], hintsAreEvidence: true } };
  const rows = [row('bank', -100, '2026-01-01', 'Transfer to Chase'),
    row('cardA', 100, '2026-01-05', 'PAYMENT THANK YOU'),
    row('cardB', 100, '2026-01-01', 'PAYMENT THANK YOU')];
  let firstRecords;
  for (const ordered of [accounts, Object.fromEntries(Object.entries(accounts).reverse())]) {
    const { transfers } = await setup(ordered, rows);
    await transfers.reconcile();
    const records = await transfers.listTransfers();
    const paired = records.find((record) => record.legs.length === 2);
    assert.deepEqual(paired.legs.map((leg) => leg.account).sort(), ['bank', 'cardB']);
    assert.ok(records.some((record) => record.state === 'provisional'
      && record.kind === 'card_payment' && record.legs[0].account === 'cardA'));
    if (firstRecords) assert.deepEqual(records, firstRecords);
    firstRecords = records;
  }
});

test('brokers sharing a hint pair nearest first whatever the account order', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    brA: { kind: 'broker', hints: ['mexem'], hintsAreEvidence: true },
    brB: { kind: 'broker', hints: ['mexem'], hintsAreEvidence: true } };
  const rows = [row('bank', -100000, '2026-01-01', 'Transfer to Mexem'),
    row('brA', 100000, '2026-01-03', 'Cash deposit'),
    row('brB', 100000, '2026-01-01', 'Cash deposit')];
  for (const ordered of [accounts, Object.fromEntries(Object.entries(accounts).reverse())]) {
    const { transfers } = await setup(ordered, rows);
    await transfers.reconcile();
    const records = await transfers.listTransfers();
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].legs.map((leg) => leg.account).sort(), ['bank', 'brB']);
  }
});

test('matches partial card payments one to one and picks nearest candidate then row id', async () => {
  const rows = [row('bank', -100, '2026-01-02', 'payment to uob'),
    row('bank', -50, '2026-01-03', 'payment to uob'),
    row('uob', 100, '2026-01-04', 'payment'), row('uob', 50, '2026-01-05', 'payment')];
  const { transfers } = await setup(cardAccounts, rows);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers()).length, 2);
  assert.equal((await transfers.transferRowIds()).size, 4);
});

test('provisional card debit rematches to a new id when its credit arrives', async () => {
  const debit = row('bank', -40, '2026-01-02', 'UOB card transfer');
  const { backend, transfers } = await setup(cardAccounts, [debit]);
  await transfers.reconcile();
  const prior = (await transfers.listTransfers())[0];
  assert.equal(prior.state, 'provisional');
  const credit = row('uob', 40, '2026-01-03', 'payment');
  await backend.commit([{ key: `row:${rowIdentity(credit)}`, value: credit }]);
  await transfers.reconcile();
  const [current] = await transfers.listTransfers();
  assert.equal(current.state, 'matched');
  assert.notEqual(current.id, prior.id);
});

test('refunds are ignored while payment thank you and cross-currency payments are kept', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, uob: { kind: 'credit_card', hints: ['uob'] } };
  const { transfers } = await setup(accounts, [row('uob', 30, '2026-01-01', 'refund'),
    row('uob', 35, '2026-01-02', 'PAYMENT THANK YOU'),
    row('bank', -60, '2026-01-02', 'payment to uob card', 'EUR'),
    row('uob', 70, '2026-01-03', 'payment', 'THB')]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.equal(records.length, 2);
  assert.deepEqual(records.find((item) => item.state === 'suggested').fee, { known: false });
  assert.equal(records.find((item) => item.state === 'provisional').kind, 'card_payment');
});

test('a suggested pair keeps its rows and the competing credit waits provisionally', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, uob: { kind: 'credit_card', hints: ['uob'] } };
  const { transfers } = await setup(accounts, [row('uob', 30, '2026-01-01', 'refund'),
    row('uob', 35, '2026-01-02', 'PAYMENT THANK YOU'),
    row('bank', -60, '2026-01-02', 'payment to uob card', 'EUR'),
    row('uob', 70, '2026-01-03', 'payment', 'THB')]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.equal(records.reduce((sum, record) => sum + record.legs.length, 0), 3);
  const rowIds = records.flatMap(ids);
  assert.equal(new Set(rowIds).size, rowIds.length);
  assert.deepEqual(await transfers.reconcile().then(({ added, removed }) => ({ added, removed })),
    { added: 0, removed: 0 });
});

test('broker deposit waits provisionally and matches when broker credit arrives', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, mexem: { kind: 'broker', hints: ['mexem'] } };
  const debit = row('bank', -75, '2026-01-01', 'transfer to Mexem');
  const { backend, transfers } = await setup(accounts, [debit]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].kind, 'broker_deposit');
  const credit = row('mexem', 75, '2026-01-03');
  await backend.commit([{ key: `row:${rowIdentity(credit)}`, value: credit }]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
});

test('ordinary transfers need different accounts and choose the nearest equal candidate', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const { transfers } = await setup(accounts, [row('a', -20, '2026-01-01'),
    row('b', 20, '2026-01-02', 'z'), row('b', 20, '2026-01-02', 'a'),
    row('b', 20, '2026-01-03')]);
  await transfers.reconcile();
  const [match] = await transfers.listTransfers();
  assert.equal(match.kind, 'ordinary');
  assert.ok(ids(match).includes(rowIdentity(row('b', 20, '2026-01-02', 'a'))));
  assert.equal(ORDINARY_DAYS, 3);
});

test('a named evidenced destination wins over a nearer unrelated credit', async () => {
  const accounts = { checking: { kind: 'bank', hints: [] }, business: { kind: 'bank', hints: [] },
    savings: { kind: 'bank', hints: ['savings'], hintsAreEvidence: true } };
  const debit = row('checking', -10000, '2026-01-01', 'Transfer to savings');
  const unrelated = row('business', 10000, '2026-01-01', 'Transfer from client');
  const destination = row('savings', 10000, '2026-01-02', 'Transfer from checking');
  const { transfers } = await setup(accounts, [debit, unrelated, destination]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  const matched = records.filter((record) => record.kind === 'ordinary' && record.state === 'matched');
  assert.equal(matched.length, 1);
  assert.deepEqual(matched[0].legs.map((leg) => leg.account).sort(), ['checking', 'savings']);
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(unrelated))));
  assert.deepEqual(new Set(records.flatMap(ids)), new Set([rowIdentity(debit), rowIdentity(destination)]));
});

test('a named evidenced destination without a credit stays provisional', async () => {
  const accounts = { checking: { kind: 'bank', hints: [] }, business: { kind: 'bank', hints: [] },
    savings: { kind: 'bank', hints: ['savings'], hintsAreEvidence: true } };
  const debit = row('checking', -10000, '2026-01-01', 'Transfer to savings');
  const unrelated = row('business', 10000, '2026-01-01', 'Transfer from client');
  const { transfers } = await setup(accounts, [debit, unrelated]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.ok(records.some((record) => record.state === 'provisional'
    && ids(record).includes(rowIdentity(debit))));
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(unrelated))));
});

test('text hints use whole words, accents, and ignore empty hints', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, uob: { kind: 'credit_card', hints: ['uob'] } };
  const { transfers } = await setup(accounts, [row('bank', -20, '2026-01-01', 'subob'),
    row('bank', -21, '2026-01-01', 'uobx'), row('bank', -22, '2026-01-01', 'virement á UOB'),
    row('uob', 22, '2026-01-02')]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers()).length, 1);
});

test('marks exclude transfers until cleared; undo demotes or removes records', async () => {
  const debit = row('bank', -10, '2026-01-01', 'uob transfer');
  const credit = row('uob', 10, '2026-01-02', 'payment');
  const { backend, transfers } = await setup(cardAccounts, [debit, credit]);
  const debitId = rowIdentity(debit);
  await transfers.markNotTransfer(debitId);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers()).length, 1);
  assert.equal((await transfers.listTransfers())[0].state, 'provisional');
  await transfers.clearNotTransfer(debitId);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
  await backend.commit([{ key: `row:${rowIdentity(credit)}`, value: undefined }]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].state, 'provisional');
});

test('reconcile is idempotent, ignores unknown accounts, and storage order does not matter', async () => {
  const rows = [row('bank', -10, '2026-01-01', 'uob transfer'), row('uob', 10, '2026-01-02', 'payment'),
    row('unknown', 10, '2026-01-02')];
  const first = await setup(cardAccounts, rows);
  await first.transfers.reconcile();
  assert.deepEqual((await first.transfers.reconcile()).added, 0);
  const second = await setup(cardAccounts, [...rows].reverse());
  await second.transfers.reconcile();
  assert.deepEqual(await first.transfers.listTransfers(), await second.transfers.listTransfers());
});

test('ordinary hint provisionals, same-account rows, and concurrent reconciliation', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, other: { kind: 'cash', hints: ['bank'] } };
  const { transfers } = await setup(accounts, [row('bank', -13, '2026-01-01', 'bank transfer'),
    row('other', 13, '2026-01-02'), row('bank', 13, '2026-01-02')]);
  await Promise.all([transfers.reconcile(), transfers.reconcile()]);
  const records = await transfers.listTransfers();
  assert.equal(records.filter((item) => item.state === 'suggested').length, 1);
  assert.equal(new Set(records.flatMap(ids)).size, records.flatMap(ids).length);
});

test('ordinary cross-currency pairs require a hint and keep native amounts', async () => {
  const accounts = { a: { kind: 'bank', hints: [] },
    b: { kind: 'cash', hints: ['b'], hintsAreEvidence: true } };
  const { transfers } = await setup(accounts, [row('a', -25, '2026-01-01', 'transfer b', 'USD'),
    row('b', 30, '2026-01-02', '', 'EUR')]);
  await transfers.reconcile();
  const [record] = await transfers.listTransfers();
  assert.equal(record.state, 'matched');
  assert.deepEqual(record.fee, { known: false });
  assert.deepEqual(record.legs.map((leg) => leg.amount).sort(), [-25, 30]);
});

test('foreign-currency pairs respect a named evidenced destination', async () => {
  const accounts = { checking: { kind: 'bank', hints: ['checking'], hintsAreEvidence: true },
    savings: { kind: 'bank', hints: ['savings'], hintsAreEvidence: true },
    business: { kind: 'bank', hints: [] } };
  const debit = row('checking', -10000, '2026-01-01', 'Transfer to savings', 'USD');
  const wrong = row('business', 9000, '2026-01-02', 'Client payment from Checking', 'EUR');
  const rejected = await setup(accounts, [debit, wrong]);
  await rejected.transfers.reconcile();
  const records = await rejected.transfers.listTransfers();
  assert.ok(records.some((record) => record.state === 'provisional'
    && ids(record).includes(rowIdentity(debit))));
  // The opted-in hint 'checking' in the business row still makes that row a lone provisional leg.
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(wrong))
    && ids(record).includes(rowIdentity(debit))));

  const credit = row('savings', 9000, '2026-01-02', 'Transfer from checking', 'EUR');
  const accepted = await setup(accounts, [debit, credit]);
  await accepted.transfers.reconcile();
  const [match] = await accepted.transfers.listTransfers();
  assert.equal(match.state, 'matched');
  assert.deepEqual(match.fee, { known: false });
  assert.deepEqual(match.legs.map((leg) => leg.account).sort(), ['checking', 'savings']);
});

test('empty backend returns no transfers', async () => {
  const { transfers } = await setup({});
  assert.deepEqual(await transfers.reconcile(), { matched: 0, provisional: 0, suggested: 0,
    added: 0, removed: 0 });
});

test('five hundred invented rows reconcile promptly', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const rows = Array.from({ length: 500 }, (_, index) => row(index % 2 ? 'b' : 'a',
    index % 2 ? 15 : -15, `2026-02-${String(index % 28 + 1).padStart(2, '0')}`));
  const { transfers } = await setup(accounts, rows);
  const start = performance.now();
  await transfers.reconcile();
  assert.ok(performance.now() - start < 2000);
});

test('ordinary equal amounts without transfer evidence are suggestions until confirmed', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const debit = row('a', -5000, '2026-01-01', 'Grocery store');
  const credit = row('b', 5000, '2026-01-02', 'Consulting income');
  const { transfers } = await setup(accounts, [debit, credit]);
  assert.deepEqual(await transfers.reconcile(), { matched: 0, provisional: 0, suggested: 1,
    added: 1, removed: 0 });
  const [suggestion] = await transfers.listTransfers();
  assert.equal(suggestion.state, 'suggested');
  assert.equal((await transfers.transferRowIds()).size, 0);
  await transfers.confirmTransfer(suggestion.id);
  assert.deepEqual(await transfers.reconcile(), { matched: 1, provisional: 0, suggested: 0,
    added: 1, removed: 0 });
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
});

test('ordinary evidence must be bilateral transfer words or an evidenced account hint', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  for (const description of ['Bill payment to electricity company', 'Mobile top up',
    'Airport transfer taxi', 'Thank you']) {
    const { transfers } = await setup(accounts, [row('a', -5000, '2026-01-01', description),
      row('b', 5000, '2026-01-02', 'Consulting income')]);
    await transfers.reconcile();
    assert.equal((await transfers.listTransfers())[0].state, 'suggested');
    assert.equal((await transfers.transferRowIds()).size, 0);
  }
  const bilateral = await setup(accounts, [row('a', -20, '2026-01-01', 'Virement vers Revolut'),
    row('b', 20, '2026-01-02', 'Virement de ING')]);
  await bilateral.transfers.reconcile();
  assert.equal((await bilateral.transfers.listTransfers())[0].state, 'matched');
  const unilateral = await setup(accounts, [row('a', -20, '2026-01-01', 'Virement'),
    row('b', 20, '2026-01-02', 'Received funds')]);
  await unilateral.transfers.reconcile();
  assert.equal((await unilateral.transfers.listTransfers())[0].state, 'suggested');
});

test('confirmed ordinary pairs reserve rows and marks clear only when invalid', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const debit = row('a', -40, '2026-01-01', 'Savings');
  const credit = row('b', 40, '2026-01-03', 'Received funds');
  const { backend, transfers } = await setup(accounts, [debit, credit]);
  await transfers.reconcile();
  const [suggestion] = await transfers.listTransfers();
  await transfers.confirmTransfer(suggestion.id);
  const nearer = row('b', 40, '2026-01-02', 'Consulting income');
  await backend.commit([{ key: `row:${rowIdentity(nearer)}`, value: nearer }]);
  await transfers.reconcile();
  assert.equal((await backend.list('confirm:')).length, 1);
  assert.ok((await transfers.listTransfers()).some((record) => record.id === suggestion.id
    && record.state === 'matched'));
  assert.ok(!(await transfers.listTransfers()).some((record) => ids(record).includes(rowIdentity(nearer))
    && ids(record).includes(rowIdentity(debit))));
  await transfers.markNotTransfer(rowIdentity(debit));
  await transfers.reconcile();
  assert.equal((await backend.list('confirm:')).length, 0);
  await transfers.clearNotTransfer(rowIdentity(debit));
  await backend.commit([{ key: `row:${rowIdentity(debit)}`, value: undefined }]);
  await transfers.reconcile();
  assert.equal((await backend.list('confirm:')).length, 0);
});

test('confirmation is idempotent and disappears when its suggested pair is gone', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const debit = row('a', -40, '2026-01-01', 'food');
  const credit = row('b', 40, '2026-01-02', 'income');
  const { backend, transfers } = await setup(accounts, [debit, credit]);
  await transfers.reconcile();
  const [suggestion] = await transfers.listTransfers();
  await transfers.confirmTransfer(suggestion.id);
  await transfers.reconcile();
  assert.equal((await transfers.reconcile()).added, 0);
  await backend.commit([{ key: `row:${rowIdentity(credit)}`, value: undefined }]);
  await transfers.reconcile();
  assert.equal((await backend.list('confirm:')).length, 0);
});

test('single-leg transfer evidence and hints gate provisional records', async () => {
  assert.deepEqual(TRANSFER_WORDS, ['virement', 'transfer', 'transfert', 'overschrijving',
    'top up', 'topup', 'own account', 'moving money']);
  assert.deepEqual(NEGATIVE_WORDS, ['fee', 'fees', 'charge', 'charges', 'commission', 'interest',
    'tax', 'taxes', 'insurance', 'subscription']);
  assert.deepEqual(REFUND_WORDS, ['refund', 'remboursement', 'return', 'reversal', 'chargeback',
    'credit note', 'cashback']);
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const { transfers } = await setup(accounts, [row('a', -20, '2026-01-01', 'top up'),
    row('b', 20, '2026-01-02')]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].state, 'suggested');
  const hints = { bank: { kind: 'bank', hints: [] }, card: { kind: 'credit_card', hints: ['chase'] } };
  const debit = row('bank', -50, '2026-01-01', 'Chase Center concessions');
  const cardCase = await setup(hints, [debit]);
  await cardCase.transfers.reconcile();
  assert.equal((await cardCase.transfers.listTransfers()).length, 0);
  assert.equal((await cardCase.transfers.transferRowIds()).size, 0);
  const evidenced = await setup({ bank: hints.bank,
    card: { ...hints.card, hintsAreEvidence: true } }, [debit]);
  await evidenced.transfers.reconcile();
  assert.equal((await evidenced.transfers.listTransfers())[0].state, 'provisional');
  const chase = await setup({ bank: hints.bank, card: hints.card },
    [row('bank', -5000, '2026-01-01', 'Chase Center concessions payment')]);
  await chase.transfers.reconcile();
  assert.equal((await chase.transfers.transferRowIds()).size, 0);
  const broker = await setup({ bank: hints.bank, broker: { kind: 'broker', hints: ['interactive'] } },
    [row('bank', -5000, '2026-01-01', 'Payment to Interactive Brokers for market data')]);
  await broker.transfers.reconcile();
  assert.equal((await broker.transfers.transferRowIds()).size, 0);
  const optedBroker = await setup({ bank: hints.bank,
    broker: { kind: 'broker', hints: ['interactive'], hintsAreEvidence: true } },
  [row('bank', -5000, '2026-01-01', 'Payment to Interactive Brokers for market data')]);
  await optedBroker.transfers.reconcile();
  assert.equal((await optedBroker.transfers.listTransfers())[0].state, 'provisional');
  const virement = await setup({ bank: hints.bank, card: hints.card },
    [row('bank', -50, '2026-01-01', 'Virement Chase')]);
  await virement.transfers.reconcile();
  assert.equal((await virement.transfers.listTransfers())[0].state, 'provisional');
});

test('confirmed pair ids round-trip special characters and discard old marks', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const debit = row('a', -50, '2026-01-01', 'Lunch ~ % | expense');
  const credit = row('b', 50, '2026-01-01', 'Lunch ~ % | income');
  const { backend, transfers } = await setup(accounts, [debit, credit]);
  await transfers.reconcile();
  const suggestion = (await transfers.listTransfers())[0];
  await transfers.confirmTransfer(suggestion.id);
  assert.deepEqual((await backend.list('confirm:'))[0].legs,
    [rowIdentity(debit), rowIdentity(credit)].sort());
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers())[0].state, 'matched');
  assert.equal((await transfers.reconcile()).added, 0);
  assert.equal((await backend.list('confirm:')).length, 1);
  await backend.commit([{ key: 'confirm:legacy~mark', value: { id: 'legacy~mark' } }]);
  await transfers.reconcile();
  assert.equal((await backend.list('confirm:')).length, 1);
});

test('card payments reject refunds and only use payment evidence on card credits', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, card: { kind: 'credit_card', hints: ['uob'] } };
  const rows = [row('bank', -5000, '2026-01-01', 'Payment to UOB'),
    row('card', 5000, '2026-01-02', 'Amazon refund'),
    row('card', 5000, '2026-01-03', 'PAYMENT THANK YOU'),
    row('card', 20, '2026-01-04', 'Cashback'),
    row('card', 30, '2026-01-05', 'payment refund')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.equal(records.length, 1);
  assert.deepEqual(ids(records[0]), [rowIdentity(rows[0]), rowIdentity(rows[2])].sort());
});

test('broker hints match counterparts but need transfer evidence to remain provisional', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] }, broker: { kind: 'broker', hints: ['mexem'] } };
  const debit = row('bank', -75, '2026-01-01', 'Mexem');
  const { transfers } = await setup(accounts, [debit]);
  await transfers.reconcile();
  assert.equal((await transfers.listTransfers()).length, 0);
  const paired = await setup(accounts, [debit, row('broker', 75, '2026-01-02')]);
  await paired.transfers.reconcile();
  assert.equal((await paired.transfers.listTransfers())[0].state, 'suggested');
});

test('veto words exclude rows while unvetoed hints only suggest pairs', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: ['chase'] } };
  for (const description of ['Transfer fee', 'Interest payment']) {
    const setupResult = await setup(accounts, [row('a', -5000, '2026-01-01', description),
      row('b', 5000, '2026-01-02', 'Consulting income')]);
    await setupResult.transfers.reconcile();
    assert.equal((await setupResult.transfers.listTransfers()).length, 0);
    assert.equal((await setupResult.transfers.transferRowIds()).size, 0);
  }
  const hintOnly = await setup({ a: { kind: 'bank', hints: [] },
    b: { kind: 'bank', hints: ['chase'] } }, [row('a', -5000, '2026-01-01',
    'Chase Center concessions'), row('b', 5000, '2026-01-02', 'Consulting income')]);
  await hintOnly.transfers.reconcile();
  assert.equal((await hintOnly.transfers.listTransfers())[0].state, 'suggested');
  const virement = await setup({ a: { kind: 'bank', hints: [] },
    b: { kind: 'bank', hints: ['uob'] } }, [row('a', -5000, '2026-01-01', 'Virement UOB'),
    row('b', 5000, '2026-01-02', 'Consulting income')]);
  await virement.transfers.reconcile();
  assert.equal((await virement.transfers.listTransfers())[0].state, 'suggested');
});

test('hints that differ only by digits stay distinct', async () => {
  const accounts = { checking: { kind: 'bank', hints: [] },
    savings1234: { kind: 'bank', hints: ['Savings 1234'], hintsAreEvidence: true },
    savings5678: { kind: 'bank', hints: ['Savings 5678'], hintsAreEvidence: true } };
  const checking = row('checking', -10000, '2026-01-01', 'Transfer to Savings 5678');
  const consulting = row('savings1234', 10000, '2026-01-02', 'Consulting income');
  const savings = row('savings5678', 10000, '2026-01-02', 'Deposit');
  const { transfers } = await setup(accounts, [checking, consulting, savings]);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.equal(records.filter((record) => record.kind === 'ordinary'
    && ids(record).includes(rowIdentity(checking))
    && ids(record).includes(rowIdentity(savings))).length, 1);
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(consulting))));
});

test('digits in a description do not hide a hint word', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    uob: { kind: 'bank', hints: ['uob'], hintsAreEvidence: true },
    numeric: { kind: 'bank', hints: ['4411'], hintsAreEvidence: true } };
  const description = 'expense to uob card 4411';
  const uob = await setup(accounts, [row('bank', -5000, '2026-01-01', description),
    row('uob', 5000, '2026-01-02', 'expense')]);
  await uob.transfers.reconcile();
  assert.ok((await uob.transfers.listTransfers()).some((record) => record.kind === 'ordinary'));
  const numeric = await setup(accounts, [row('bank', -5000, '2026-01-01', description),
    row('numeric', 5000, '2026-01-02', 'expense')]);
  await numeric.transfers.reconcile();
  assert.ok((await numeric.transfers.listTransfers()).some((record) => record.kind === 'ordinary'));
  const near = await setup({ bank: { kind: 'bank', hints: [] },
    numeric: { kind: 'bank', hints: ['4411'], hintsAreEvidence: true } },
  [row('bank', -5001, '2026-01-01', 'expense to uob card 44110'),
    row('numeric', 5000, '2026-01-02', 'expense')]);
  await near.transfers.reconcile();
  assert.equal((await near.transfers.listTransfers()).length, 0);
});

test('round five evidence, reserving, and funding exclusions', async () => {
  assert.deepEqual(NON_FUNDING_WORDS, ['dividend', 'dividends', 'interest', 'fee', 'fees',
    'commission', 'tax', 'taxes', 'sale', 'sold', 'buy', 'bought', 'trade', 'settlement',
    'coupon', 'withholding', 'bonus', 'promotion', 'rebate', 'referral', 'reward', 'cashback',
    'adjustment']);
  const brokerAccounts = { bank: { kind: 'bank', hints: [] },
    broker: { kind: 'broker', hints: ['interactive'] } };
  const bank = row('bank', -1000, '2026-01-01', 'Payment to Interactive Brokers for market data');
  const dividend = row('broker', 1000, '2026-01-02', 'Cash dividend');
  const broker = await setup(brokerAccounts, [bank, dividend]);
  await broker.transfers.reconcile();
  assert.equal((await broker.transfers.transferRowIds()).size, 0);

  const cardAccountsWithHint = { bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['chase'] } };
  const cardRows = [row('bank', -1000, '2026-01-01', 'Chase Center concessions payment'),
    row('card', 1000, '2026-01-02', 'PAYMENT THANK YOU')];
  const card = await setup(cardAccountsWithHint, cardRows);
  await card.transfers.reconcile();
  assert.equal((await card.transfers.listTransfers())[0].state, 'suggested');
  const opted = await setup({ ...cardAccountsWithHint,
    card: { ...cardAccountsWithHint.card, hintsAreEvidence: true } }, cardRows);
  await opted.transfers.reconcile();
  assert.equal((await opted.transfers.listTransfers())[0].state, 'matched');

  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const grocery = row('a', -10000, '2026-01-01', 'Groceries');
  const debit = row('a', -10000, '2026-01-02', 'Transfer to savings');
  const credit = row('b', 10000, '2026-01-02', 'Transfer from checking');
  const ordinary = await setup(accounts, [grocery, debit, credit]);
  await ordinary.transfers.reconcile();
  const records = await ordinary.transfers.listTransfers();
  assert.ok(records.some((record) => ids(record).includes(rowIdentity(debit))
    && ids(record).includes(rowIdentity(credit)) && record.state === 'matched'));
  assert.ok(!records.some((record) => ids(record).includes(rowIdentity(grocery))));

  const cardRowsForHint = [row('bank', -20, '2026-02-01', 'Payment to UOB'),
    row('card', 20, '2026-02-02', 'PAYMENT THANK YOU')];
  const uob = await setup({ bank: { kind: 'bank', hints: [] },
    card: { kind: 'credit_card', hints: ['uob'], hintsAreEvidence: true } }, cardRowsForHint);
  await uob.transfers.reconcile();
  assert.equal((await uob.transfers.listTransfers())[0].state, 'matched');
  const virement = await setup({ bank: { kind: 'bank', hints: [] },
    broker: { kind: 'broker', hints: ['uob'] } }, [row('bank', -20, '2026-02-01', 'Virement UOB'),
    row('broker', 20, '2026-02-02', 'Cash transfer')]);
  await virement.transfers.reconcile();
  assert.equal((await virement.transfers.listTransfers())[0].state, 'matched');
});

test('a debit naming another evidenced account is not a card payment', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    savings: { kind: 'bank', hints: ['chase savings'], hintsAreEvidence: true },
    card: { kind: 'credit_card', hints: ['chase'] } };
  const rows = [row('bank', -10000, '2026-01-01', 'Transfer to Chase savings'),
    row('savings', 10000, '2026-01-02', 'Deposit'),
    row('card', 10000, '2026-01-03', 'PAYMENT THANK YOU')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.ok(records.some((record) => record.kind === 'ordinary'
    && record.legs.some((leg) => leg.account === 'bank')
    && record.legs.some((leg) => leg.account === 'savings')));
  assert.ok(records.some((record) => record.kind === 'card_payment'
    && record.state === 'provisional' && record.legs.some((leg) => leg.account === 'card')));
  assert.equal((await transfers.transferRowIds()).size, 3);
});

test('a debit naming another evidenced account is not a broker deposit', async () => {
  const accounts = { bank: { kind: 'bank', hints: [] },
    savings: { kind: 'bank', hints: ['chase savings'], hintsAreEvidence: true },
    broker: { kind: 'broker', hints: ['chase'] } };
  const rows = [row('bank', -10000, '2026-01-01', 'Transfer to Chase savings'),
    row('savings', 10000, '2026-01-02', 'Deposit'),
    row('broker', 10000, '2026-01-03', 'Deposit')];
  const { transfers } = await setup(accounts, rows);
  await transfers.reconcile();
  const records = await transfers.listTransfers();
  assert.ok(records.some((record) => record.kind === 'ordinary'
    && record.legs.some((leg) => leg.account === 'bank')
    && record.legs.some((leg) => leg.account === 'savings')));
  assert.ok(!records.some((record) => record.kind === 'broker_deposit'
    && record.legs.some((leg) => leg.account === 'bank')));
});

test('ten thousand unique rows reconcile quickly and storage order is irrelevant', async () => {
  const accounts = { a: { kind: 'bank', hints: [] }, b: { kind: 'bank', hints: [] } };
  const rows = Array.from({ length: 10000 }, (_, index) => row(index % 2 ? 'a' : 'b',
    -(index + 1), `2026-01-${String((index % 28) + 1).padStart(2, '0')}`, 'expense'));
  const first = await setup(accounts, rows);
  const start = performance.now();
  await first.transfers.reconcile();
  assert.ok(performance.now() - start < 2000);
  const reversed = await setup(accounts, rows.slice().reverse());
  await reversed.transfers.reconcile();
  assert.deepEqual(await first.transfers.listTransfers(), await reversed.transfers.listTransfers());
});
