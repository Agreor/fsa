import { rowIdentity } from './contracts.js';

export const ORDINARY_DAYS = 3;
export const CARD_DAYS = 10;
export const KINDS = ['ordinary', 'card_payment', 'broker_deposit', 'broker_withdrawal'];
export const PAYMENT_WORDS = ['payment', 'paiement', 'bill pay', 'thank you'];
export const TRANSFER_WORDS = ['virement', 'transfer', 'transfert', 'overschrijving', 'top up',
  'topup', 'own account', 'moving money'];
export const NEGATIVE_WORDS = ['fee', 'fees', 'charge', 'charges', 'commission', 'interest', 'tax',
  'taxes', 'insurance', 'subscription'];
export const REFUND_WORDS = ['refund', 'remboursement', 'return', 'reversal', 'chargeback',
  'credit note', 'cashback'];
export const NON_FUNDING_WORDS = ['dividend', 'dividends', 'interest', 'fee', 'fees', 'commission',
  'tax', 'taxes', 'sale', 'sold', 'buy', 'bought', 'trade', 'settlement', 'coupon', 'withholding',
  'bonus', 'promotion', 'rebate', 'referral', 'reward', 'cashback', 'adjustment'];
export const FUNDING_WORDS = ['deposit', 'withdrawal', 'funding', 'wire', 'incoming transfer',
  'virement', 'transfer', 'cash in', 'cash out'];

const transferKey = (id) => `transfer:${id}`;
const encodedRowId = (id) => encodeURIComponent(id).replace(/~/g, '%7E');
const transferId = (ids) => ids.slice().sort().map(encodedRowId).join('~');
const rowId = (row) => rowIdentity(row);
const normalise = (value) => value.toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const matches = (description, words) => {
  const text = ` ${normalise(description ?? '')} `;
  return words.some((word) => {
    const hint = normalise(word);
    return hint.length > 0 && text.includes(` ${hint} `);
  });
};
const dayDistance = (left, right) => Math.abs(Date.parse(left) - Date.parse(right)) / 86400000;
const byDate = (left, right) => left.date.localeCompare(right.date)
  || rowId(left).localeCompare(rowId(right));
const byId = (left, right) => left.rowId.localeCompare(right.rowId);
const sameAmount = (left, right) => Math.abs(left.amount) === Math.abs(right.amount);
const evidence = (row) => matches(row.description, TRANSFER_WORDS)
  && !matches(row.description, NEGATIVE_WORDS);
const vetoed = (row) => matches(row.description, NEGATIVE_WORDS)
  || matches(row.description, REFUND_WORDS);
const hintMatch = (row, account) => matches(row.description, account?.hints ?? []);
const hintEvidence = (row, account) => account?.hintsAreEvidence === true && hintMatch(row, account);
const isBankSide = (account) => ['bank', 'debit_card'].includes(account?.kind);
const stable = (value) => JSON.stringify(value);

function makeRecord(kind, legs) {
  const sorted = legs.map((row) => ({ rowId: rowId(row), account: row.account, date: row.date,
    amount: row.amount, currency: row.currency })).sort(byId);
  const id = transferId(sorted.map((leg) => leg.rowId));
  const matched = sorted.length === 2;
  const fee = !matched ? { known: false }
    : sorted[0].currency === sorted[1].currency ? { known: true, amount: 0 } : { known: false };
  return { id, kind, state: matched ? 'matched' : 'provisional', legs: sorted, fee };
}

export function createTransfers({ backend, accounts }) {
  const listTransfers = async () => (await backend.list('transfer:'))
    .sort((a, b) => a.id.localeCompare(b.id));

  async function reconcile() {
    return backend.withLock(async () => {
      const [rows, existing, marks, confirmations] = await Promise.all([
        backend.list('row:'), backend.list('transfer:'), backend.list('notransfer:'),
        backend.list('confirm:'),
      ]);
      const marked = new Set(marks.map((mark) => mark.rowId));
      // Keep orphan marks: a later re-import may restore their row.
      const eligible = rows.filter((row) => accounts[row.account] && !marked.has(rowId(row))
        && (!vetoed(row) || (accounts[row.account].kind === 'credit_card' && row.amount > 0
          && normalise(row.description) === 'payment thank you'
          && !matches(row.description, REFUND_WORDS))))
        .sort(byDate);
      const used = new Set();
      const records = new Map();
      const suggestions = [];
      const provisionals = [];
      const rowsById = new Map(rows.map((row) => [rowId(row), row]));
      for (const mark of confirmations) {
        const [leftId, rightId] = mark.legs ?? [];
        const left = rowsById.get(leftId);
        const right = rowsById.get(rightId);
        if (!Array.isArray(mark.legs) || mark.legs.length !== 2 || !left || !right
          || marked.has(leftId) || marked.has(rightId)
          || used.has(leftId) || used.has(rightId) || left.account === right.account) continue;
        const pair = [left, right];
        records.set(transferId([leftId, rightId]), makeRecord('ordinary', pair));
        used.add(leftId);
        used.add(rightId);
      }
      const add = (kind, legs) => {
        const record = makeRecord(kind, legs);
        if (legs.length === 1) {
          provisionals.push(record);
          return;
        }
        if (record.state === 'matched' && kind === 'ordinary') {
          const [left, right] = legs;
          const bilateral = matches(left.description, TRANSFER_WORDS)
            && matches(right.description, TRANSFER_WORDS)
            && !matches(left.description, NEGATIVE_WORDS)
            && !matches(right.description, NEGATIVE_WORDS);
          const supported = bilateral
            || hintEvidence(left, accounts[right.account])
            || hintEvidence(right, accounts[left.account]);
          if (!supported) record.state = 'suggested';
        }
        if (record.state === 'matched' && kind === 'card_payment') {
          const bankRow = legs.find((row) => isBankSide(accounts[row.account]));
          const card = legs.find((row) => accounts[row.account]?.kind === 'credit_card');
          const supported = (matches(bankRow.description, TRANSFER_WORDS)
            && !matches(bankRow.description, NEGATIVE_WORDS))
            || hintEvidence(bankRow, accounts[card.account]);
          if (!supported || (bankRow.currency !== card.currency
            && !hintEvidence(bankRow, accounts[card.account]))) record.state = 'suggested';
        }
        if (record.state === 'matched' && kind.startsWith('broker_')) {
          const bankRow = legs.find((row) => isBankSide(accounts[row.account]));
          if (!((matches(bankRow.description, TRANSFER_WORDS)
            && !matches(bankRow.description, NEGATIVE_WORDS))
            || hintEvidence(bankRow, accounts[legs.find((row) => row.account !== bankRow.account)
              .account]))) {
            record.state = 'suggested';
          }
        }
        if (record.state === 'suggested') {
          suggestions.push(record);
          return;
        }
        records.set(record.id, record);
        for (const leg of legs) used.add(rowId(leg));
      };
      const available = (row) => !used.has(rowId(row));
      const pairCandidates = (source, candidates, predicate, days) => {
        const found = candidates.filter((candidate) => available(candidate)
          && dayDistance(source.date, candidate.date) <= days && predicate(candidate))
          .sort((a, b) => dayDistance(source.date, a.date) - dayDistance(source.date, b.date)
            || rowId(a).localeCompare(rowId(b)));
        return found[0];
      };
      const namedAccounts = (row) => {
        const matchesByAccount = Object.entries(accounts).filter(([accountId, account]) =>
          accountId !== row.account && account.hintsAreEvidence === true && hintMatch(row, account));
        const longest = Math.max(0, ...matchesByAccount.flatMap(([, account]) =>
          account.hints.map(normalise).filter((hint) => hint.length && matches(row.description, [hint]))
            .map((hint) => hint.length)));
        return new Set(matchesByAccount.filter(([, account]) => account.hints.some((hint) =>
          normalise(hint).length === longest && matches(row.description, [hint])))
          .map(([accountId]) => accountId));
      };
      const destinationAllowed = (row, counterpart) => {
        const named = namedAccounts(row);
        return !named.size || named.has(counterpart.account);
      };

      const cardAccounts = Object.entries(accounts).filter(([, account]) => account.kind === 'credit_card');
      for (const currencyPass of [true, false]) for (const supportedPass of [true, false]) {
        const candidates = [];
        for (const [accountId, account] of cardAccounts) {
          const credits = eligible.filter((row) => row.account === accountId && row.amount > 0
            && matches(row.description, PAYMENT_WORDS) && !matches(row.description, REFUND_WORDS));
          const debits = eligible.filter((row) => isBankSide(accounts[row.account]) && row.amount < 0
            && destinationAllowed(row, { account: accountId }));
          for (const credit of credits) for (const debit of debits) {
            const supported = (matches(debit.description, TRANSFER_WORDS)
              && !matches(debit.description, NEGATIVE_WORDS))
              || hintEvidence(debit, account);
            const crossCurrencySupported = debit.currency === credit.currency || hintEvidence(debit, account);
            if (hintMatch(debit, account) && (supportedPass
              ? supported && crossCurrencySupported : !supported || !crossCurrencySupported)
              && destinationAllowed(credit, debit)
              && (debit.currency === credit.currency ? sameAmount(debit, credit) : !currencyPass)
              && dayDistance(credit.date, debit.date) <= CARD_DAYS) {
              candidates.push({ credit, debit });
            }
          }
        }
        candidates.sort((a, b) => dayDistance(a.credit.date, a.debit.date)
          - dayDistance(b.credit.date, b.debit.date) || rowId(a.credit).localeCompare(rowId(b.credit))
          || rowId(a.debit).localeCompare(rowId(b.debit)));
        for (const { credit, debit } of candidates) {
          if (available(credit) && available(debit)) add('card_payment', [debit, credit]);
        }
      }
      const cardSingles = cardAccounts.flatMap(([accountId, account]) => eligible.filter((row) =>
        row.amount > 0 && row.account === accountId && matches(row.description, PAYMENT_WORDS)
        && !matches(row.description, REFUND_WORDS) || isBankSide(accounts[row.account])
        && row.amount < 0 && destinationAllowed(row, { account: accountId }) && hintMatch(row, account)
        && ((matches(row.description, TRANSFER_WORDS) && !matches(row.description, NEGATIVE_WORDS))
          || hintEvidence(row, account))));
      for (const row of [...new Map(cardSingles.map((item) => [rowId(item), item])).values()]
        .sort((a, b) => rowId(a).localeCompare(rowId(b)))) {
        if (available(row)) add('card_payment', [row]);
      }

      const brokers = Object.entries(accounts).filter(([, account]) => account.kind === 'broker');
      for (const supportedPass of [true, false]) {
        const exact = [];
        const foreign = [];
        const singles = [];
        for (const [accountId, account] of brokers) for (const bankRow of eligible.filter((row) =>
          isBankSide(accounts[row.account]) && destinationAllowed(row, { account: accountId })
          && hintMatch(row, account) && (supportedPass
            ? evidence(row) || hintEvidence(row, account)
            : !(evidence(row) || hintEvidence(row, account))) && row.amount !== 0)) {
          const candidates = eligible.filter((row) => row.account === accountId
            && !matches(row.description, NON_FUNDING_WORDS)
            && Math.sign(row.amount) === -Math.sign(bankRow.amount));
          const matching = candidates.filter((row) => row.currency === bankRow.currency
            && sameAmount(row, bankRow) && destinationAllowed(row, bankRow));
          const funding = candidates.filter((row) => row.currency !== bankRow.currency
            && matches(row.description, FUNDING_WORDS) && destinationAllowed(row, bankRow));
          const mk = (row) => ({ bankRow, row });
          exact.push(...matching.map(mk));
          foreign.push(...funding.map(mk));
          if (!matching.length && !funding.length && ((matches(bankRow.description, TRANSFER_WORDS)
            && !matches(bankRow.description, NEGATIVE_WORDS)) || hintEvidence(bankRow, account))) {
            singles.push(bankRow);
          }
        }
        const order = (a, b) => dayDistance(a.bankRow.date, a.row.date)
          - dayDistance(b.bankRow.date, b.row.date) || rowId(a.row).localeCompare(rowId(b.row))
          || rowId(a.bankRow).localeCompare(rowId(b.bankRow));
        for (const { bankRow, row } of [...exact.sort(order), ...foreign.sort(order)]) {
          if (available(bankRow) && available(row)) add(bankRow.amount < 0 ? 'broker_deposit'
            : 'broker_withdrawal', [bankRow, row]);
        }
        for (const bankRow of [...new Map(singles.map((row) => [rowId(row), row])).values()]
          .sort((a, b) => rowId(a).localeCompare(rowId(b)))) {
          if (available(bankRow)) add(bankRow.amount < 0 ? 'broker_deposit' : 'broker_withdrawal',
            [bankRow]);
        }
      }

      const ordinaryRows = eligible.filter((row) => available(row)
        && ['bank', 'debit_card', 'cash'].includes(accounts[row.account].kind));
      const amountIndex = new Map();
      const accountIndex = new Map();
      for (const row of ordinaryRows) {
        const key = `${row.currency}|${Math.abs(row.amount)}`;
        if (!amountIndex.has(key)) amountIndex.set(key, []);
        amountIndex.get(key).push(row);
        if (!accountIndex.has(row.account)) accountIndex.set(row.account, []);
        accountIndex.get(row.account).push(row);
      }
      const ordinaryDebits = ordinaryRows.filter((row) => row.amount < 0);
      const supportedOrdinary = (debit, credit) => {
        const bilateral = matches(debit.description, TRANSFER_WORDS)
          && matches(credit.description, TRANSFER_WORDS)
          && !matches(debit.description, NEGATIVE_WORDS)
          && !matches(credit.description, NEGATIVE_WORDS);
        const hinted = hintEvidence(debit, accounts[credit.account])
          || hintEvidence(credit, accounts[debit.account]);
        return bilateral || hinted;
      };
      for (const debit of ordinaryDebits) {
        if (!available(debit)) continue;
        const candidates = amountIndex.get(`${debit.currency}|${Math.abs(debit.amount)}`) ?? [];
        const credit = pairCandidates(debit, candidates, (row) => row.amount > 0
          && row.account !== debit.account && destinationAllowed(debit, row)
          && destinationAllowed(row, debit)
          && supportedOrdinary(debit, row), ORDINARY_DAYS);
        if (credit) add('ordinary', [debit, credit]);
      }
      const hintRows = new Map();
      for (const row of ordinaryRows) for (const [accountId, account] of Object.entries(accounts)) {
        if (accountId !== row.account && account.hintsAreEvidence === true && hintMatch(row, account)) {
          if (!hintRows.has(accountId)) hintRows.set(accountId, []);
          hintRows.get(accountId).push(row);
        }
      }
      for (const debit of ordinaryRows.filter((row) => available(row) && row.amount < 0)) {
        const targets = Object.entries(accounts).filter(([accountId, account]) => accountId !== debit.account
          && ['bank', 'debit_card', 'cash'].includes(account.kind)
          && hintEvidence(debit, account)).flatMap(([accountId]) => accountIndex.get(accountId) ?? []);
        const sources = hintRows.get(debit.account) ?? [];
        const credit = pairCandidates(debit, [...targets, ...sources].filter((row) => row.amount > 0
          && row.account !== debit.account && row.currency !== debit.currency
          && destinationAllowed(debit, row) && destinationAllowed(row, debit)
          && (hintEvidence(debit, accounts[row.account])
            || hintEvidence(row, accounts[debit.account]))), () => true, ORDINARY_DAYS);
        if (credit) add('ordinary', [debit, credit]);
      }
      for (const debit of ordinaryDebits) {
        if (!available(debit)) continue;
        const candidates = amountIndex.get(`${debit.currency}|${Math.abs(debit.amount)}`) ?? [];
        const credit = pairCandidates(debit, candidates, (row) => row.amount > 0
          && row.account !== debit.account
          && destinationAllowed(debit, row) && destinationAllowed(row, debit)
          && !supportedOrdinary(debit, row), ORDINARY_DAYS);
        if (credit) add('ordinary', [debit, credit]);
      }
      for (const row of ordinaryRows.filter((item) => available(item))) {
        const otherHints = Object.entries(accounts).filter(([accountId, account]) => accountId !== row.account
          && ['bank', 'debit_card', 'cash'].includes(account.kind)).flatMap(([, account]) => account.hints);
        const targets = Object.entries(accounts).filter(([accountId, account]) => accountId !== row.account
          && ['bank', 'debit_card', 'cash'].includes(account.kind) && hintMatch(row, account)
          && destinationAllowed(row, { account: accountId }));
        if (targets.length && ((matches(row.description, TRANSFER_WORDS)
          && !matches(row.description, NEGATIVE_WORDS))
          || targets.some(([, account]) => hintEvidence(row, account)))) {
          add('ordinary', [row]);
        }
      }

      for (const suggestion of suggestions) {
        if (suggestion.legs.every((leg) => available(rowsById.get(leg.rowId)))) {
          records.set(suggestion.id, suggestion);
          for (const leg of suggestion.legs) used.add(leg.rowId);
        }
      }
      for (const record of provisionals) {
        if (record.legs.every((leg) => available(rowsById.get(leg.rowId)))) {
          records.set(record.id, record);
          for (const leg of record.legs) used.add(leg.rowId);
        }
      }

      const old = new Map(existing.map((record) => [transferKey(record.id), record]));
      const next = new Map([...records.values()].map((record) => [transferKey(record.id), record]));
      const operations = [];
      for (const [key, record] of next) {
        if (!old.has(key) || stable(old.get(key)) !== stable(record)) operations.push({ key, value: record });
      }
      for (const key of old.keys()) if (!next.has(key)) operations.push({ key, value: undefined });
      for (const mark of confirmations) {
        const [leftId, rightId] = mark.legs ?? [];
        const left = rowsById.get(leftId);
        const right = rowsById.get(rightId);
        if (Array.isArray(mark.legs) && mark.legs.length === 2
          && left && right && !marked.has(leftId) && !marked.has(rightId)
          && left.account !== right.account && records.has(transferId([leftId, rightId]))) continue;
        const id = mark.id ?? transferId(mark.legs ?? []);
        operations.push({ key: `confirm:${id}`, value: undefined });
      }
      await backend.commit(operations);
      return { matched: [...records.values()].filter((record) => record.state === 'matched').length,
        provisional: [...records.values()].filter((record) => record.state === 'provisional').length,
        suggested: [...records.values()].filter((record) => record.state === 'suggested').length,
        added: operations.filter((operation) => operation.value !== undefined).length,
        removed: operations.filter((operation) => operation.value === undefined).length };
    });
  }

  return {
    reconcile,
    listTransfers,
    async transferRowIds() {
      return new Set((await listTransfers()).filter((record) => record.state !== 'suggested')
        .flatMap((record) => record.legs.map((leg) => leg.rowId)));
    },
    async confirmTransfer(id) {
      const record = (await listTransfers()).find((item) => item.id === id && item.state === 'suggested');
      if (record) {
        const pairId = transferId(record.legs.map((leg) => leg.rowId));
        await backend.commit([{ key: `confirm:${pairId}`,
          value: { legs: record.legs.map((leg) => leg.rowId) } }]);
      }
    },
    async markNotTransfer(id) { await backend.commit([{ key: `notransfer:${id}`, value: { rowId: id } }]); },
    async clearNotTransfer(id) { await backend.commit([{ key: `notransfer:${id}`, value: undefined }]); },
  };
}
