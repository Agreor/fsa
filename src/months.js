import { rowIdentity } from './contracts.js';
import { UNCATEGORISED } from './categories.js';
import { REFUND_WORDS } from './transfers.js';
import { recurringLookup } from './recurring.js';

const roles = (backend) => backend.list('role:');
const roleKey = (id) => `role:${id}`;
export const matchesRefund = (description) => {
  const text = ` ${(description ?? '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()} `;
  return REFUND_WORDS.some((word) => {
    const hint = word.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
    return text.includes(` ${hint} `);
  });
};

export function createMonths({ backend, accounts, categories, transfers, client }) {
  const mark = async (rowId, role, purchaseRowId) => backend.commit([{
    key: roleKey(rowId), value: { rowId, role, ...(purchaseRowId ? { purchaseRowId } : {}) },
  }]);
  return {
    async markIncome(rowId) { await mark(rowId, 'income'); },
    async markNotIncome(rowId) { await mark(rowId, 'not_income'); },
    async markRefund(rowId, purchaseRowId) { await mark(rowId, 'refund', purchaseRowId); },
    async clearRole(rowId) { await backend.commit([{ key: roleKey(rowId), value: undefined }]); },
    async monthView(month, currency) {
      if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
        || typeof currency !== 'string' || !currency.trim()) throw new TypeError('invalid month or currency');
      const rows = await backend.list('row:');
      const ids = new Map(rows.map((row) => [rowIdentity(row), row]));
      const overrides = new Map((await roles(backend)).map((item) => [item.rowId, item]));
      const transfersSet = await transfers.transferRowIds();
      // Moves between the reader's own accounts are not cash flow; a card bill or a broker deposit paid from a bank is.
      const internalRows = new Set(transfers.listTransfers
        ? (await transfers.listTransfers()).filter((record) => record.kind === 'ordinary')
          .flatMap((record) => record.legs.map((leg) => leg.rowId)) : []);
      const suggestedRows = new Set(transfers.listTransfers
        ? (await transfers.listTransfers()).filter((record) => record.state === 'suggested')
          .flatMap((record) => record.legs.map((leg) => leg.rowId)) : []);
      const pendingRows = new Set();
      const recurring = recurringLookup(await backend.list('recurring:'));
      const result = { month, currency, income: 0, spending: 0, saved: 0, net: 0,
        byCategory: [], uncategorised: 0, hasBank: false, cashMovement: { out: 0, in: 0, net: 0 }, partial: false,
        pendingSuggestions: { count: 0, amount: 0 } };
      const categoryTotals = new Map();
      for (const row of rows) {
        if (!row.date?.startsWith(`${month}-`) || !accounts[row.account]) continue;
        const kind = accounts[row.account].kind;
        const cash = ['bank', 'debit_card', 'cash'].includes(kind);
        const id = rowIdentity(row);
        // A suggested pair is left out like a confirmed one, so a card bill paid from a bank is not counted twice;
        // the month view reports how many are waiting.
        const transfer = transfersSet.has(id) || suggestedRows.has(id);
        if (row.amount === 0) continue;
        const override = overrides.get(rowIdentity(row));
        if (kind === 'broker' && (row.amount < 0
          || !['income', 'not_income', 'refund'].includes(override?.role))) continue;
        const converted = await client.convert(row, currency, row.date);
        if (converted?.unavailable) { result.partial = true; continue; }
        const amount = converted.amount;
        if (suggestedRows.has(id) && !overrides.has(id)) {
          pendingRows.add(id);
          result.pendingSuggestions.amount += Math.abs(amount);
        }
        if (['bank', 'debit_card'].includes(kind)) result.hasBank = true; // income and savings come from these accounts
        if (cash && !internalRows.has(id)) {
          if (row.amount < 0) result.cashMovement.out += Math.abs(amount);
          else if (row.amount > 0) result.cashMovement.in += amount;
        }
        if ((transfer && (row.amount < 0
          || !['income', 'not_income', 'refund'].includes(override?.role))) || row.amount === 0) continue;
        let classification;
        if (row.amount < 0) classification = 'spending';
        else if (override?.role === 'refund') classification = 'refund';
        else if (override?.role === 'income') classification = 'income';
        else if (override?.role === 'not_income') continue;
        else if (matchesRefund(row.description) || kind === 'credit_card') classification = 'refund';
        else classification = 'income';
        const rule = recurring(row);
        // Fixed payments marked saved or invested left the bank but are not spending; they stay in the cash flow.
        if (classification === 'spending' && rule?.saved) { result.saved += Math.abs(amount); continue; }
        if (classification === 'income') result.income += amount;
        if (classification === 'spending' || classification === 'refund') {
          const purchase = classification === 'refund' && override?.purchaseRowId
            ? ids.get(override.purchaseRowId) : undefined;
          const found = await categories.categoryOf(purchase ?? row);
          const category = rule?.category && found.category === UNCATEGORISED ? rule.category : found.category;
          const value = classification === 'refund' ? -Math.abs(amount) : Math.abs(amount);
          result.spending += value;
          categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + value);
          if (classification === 'spending' && category === UNCATEGORISED) result.uncategorised++;
        }
      }
      result.pendingSuggestions.count = pendingRows.size;
      result.net = result.income - result.spending;
      result.cashMovement.net = result.cashMovement.in - result.cashMovement.out;
      result.byCategory = [...categoryTotals].filter(([, amount]) => amount !== 0)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
      return result;
    },
  };
}
