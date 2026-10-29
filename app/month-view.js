import { createMonths } from './src/months.js';
import { createCategories, CATEGORIES, UNCATEGORISED } from './src/categories.js';
import { merchantKey } from './src/merchant.js';
import { createTransfers } from './src/transfers.js';
import { rowIdentity } from './src/contracts.js';
import { listAccounts, transferAccounts } from './accounts.js';

const money = (minor) => (minor / 100).toFixed(2);
// Only same-currency rows convert: no rate lookup leaves the device; others make the view partial.
const client = { async convert(row, currency) {
  return row.currency === currency ? { amount: row.amount } : { unavailable: true };
} };

export function createMonthView({ backend, $ }) {
  const categories = createCategories({ backend });
  const root = $('#month-view');
  const month = $('#month'), currency = $('#currency');
  const figures = $('#month-figures'), note = $('#month-note');
  const list = $('#import-categories');
  let batchId;
  const lines = (pairs) => pairs.map(([label, value]) => {
    const p = document.createElement('p'); p.textContent = `${label} ${value}`; return p;
  });
  async function refresh() {
    const accounts = Object.fromEntries(listAccounts().map((a) => [a.id, { kind: a.kind }]));
    const service = createMonths({ backend, accounts, categories, client,
      transfers: createTransfers({ backend, accounts: transferAccounts(listAccounts()) }) });
    let view;
    try { view = await service.monthView(month.value.trim(), currency.value.trim().toUpperCase()); }
    catch {
      figures.replaceChildren(); note.textContent = 'Enter a month as YYYY-MM and a currency such as EUR.';
      return;
    }
    const cm = view.cashMovement;
    const empty = !view.income && !view.spending && !cm.in && !cm.out && !view.partial;
    const uncat = view.byCategory.find((c) => c.category === UNCATEGORISED)?.amount ?? 0;
    const ul = document.createElement('ul');
    ul.append(...(view.byCategory.length ? view.byCategory.map(({ category, amount }) => {
      const li = document.createElement('li'); li.textContent = `${category} ${money(amount)}`; return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'No categories' })]));
    const heading = Object.assign(document.createElement('h3'), { textContent: 'Categories' });
    figures.replaceChildren(...lines([['Income', money(view.income)], ['Spending', money(view.spending)],
      ['Net', money(view.net)], ['Cash in', money(cm.in)], ['Cash out', money(cm.out)],
      ['Cash net', money(cm.net)]]), heading, ul,
    ...lines([['Uncategorised', `${money(uncat)} (${view.uncategorised} ${view.uncategorised === 1 ? 'row' : 'rows'})`]]));
    note.textContent = [empty ? 'No transactions in this month.' : '',
      view.partial ? 'Partial figures: some rows are in another currency and are left out.' : '']
      .filter(Boolean).join(' ');
  }
  async function renderImport() {
    if (!batchId) { list.replaceChildren(); return; }
    const rows = (await backend.list('row:')).filter((r) => r.batches?.includes(batchId) && r.amount < 0);
    const items = [];
    for (const row of rows) {
      const current = (await categories.categoryOf(row)).category;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Category for ${row.description}`);
      select.append(...[UNCATEGORISED, ...CATEGORIES].map((c) =>
        Object.assign(document.createElement('option'), { value: c, textContent: c, selected: c === current })));
      select.addEventListener('change', async () => {
        const key = merchantKey(row.description);
        if (select.value === UNCATEGORISED) await categories.forget(key);
        else await categories.correct(row, select.value);
        await renderImport(); await refresh();
      });
      const li = document.createElement('li'); li.append(`${row.date} ${row.description} ${money(row.amount)} `, select);
      items.push(li);
    }
    list.replaceChildren(...items);
  }
  for (const el of [month, currency]) el.addEventListener('change', refresh);
  $('#month-form').addEventListener('submit', (e) => { e.preventDefault(); refresh(); });
  refresh();
  return {
    refresh,
    // After a save: show that batch's spending rows and jump to the month of its first row.
    async afterImport(id) {
      batchId = id;
      const first = (await backend.list('row:')).find((r) => r.batches?.includes(id));
      if (first) { month.value = first.date.slice(0, 7); currency.value = first.currency; }
      await renderImport(); await refresh();
    },
  };
}
