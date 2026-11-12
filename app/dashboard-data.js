// Aggregates the existing monthly views into category shares, income against spending and a set-aside
// estimate. Pure: the caller supplies monthView(month) -> { income, spending, byCategory, partial }.
const previous = (month, back) => {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 - back, 1));
  return date.toISOString().slice(0, 7);
};

// Integer tenths of a percent that add up to exactly 1000 (largest remainder), so shares sum to 100%.
function shares(items, total) {
  const exact = items.map(({ amount }) => (amount * 1000) / total);
  const tenths = exact.map(Math.floor);
  let left = 1000 - tenths.reduce((sum, value) => sum + value, 0);
  [...exact.keys()].sort((a, b) => (exact[b] - tenths[b]) - (exact[a] - tenths[a]) || a - b)
    .forEach((index) => { if (left-- > 0) tenths[index]++; });
  return tenths;
}

const percent = (tenths) => `${(tenths / 10).toFixed(1)}%`;

// What is left of the money that came into the bank accounts: cash flow divided by money in. Negative when more went out than came in.
function savingsRate(cashIn, cashNet, hasBank) {
  if (hasBank === false) return 'needs a bank statement';
  if (cashIn <= 0) return 'not available';
  return percent(Math.round((cashNet * 1000) / cashIn));
}

export async function loadDashboard({ months, monthView, displayCurrency, formatAmount,
  setAsideMonths = 3 }) {
  if (!months.length) return { currency: displayCurrency, months: [], windows: [], setAside: null };
  const latest = months[0];
  const wanted = new Set(months);
  const views = new Map();
  for (const month of months.slice(0, 12)) views.set(month, await monthView(month));
  const money = (amount) => formatAmount(amount, displayCurrency);

  const rows = months.slice(0, 12).map((month) => {
    const { income, spending, partial, hasBank, cashMovement } = views.get(month);
    const { in: cashIn, out: cashOut, net: cashNet } = cashMovement;
    return { month, incomeAmount: income, spendingAmount: spending, income: money(income), spending: money(spending), net: money(income - spending),
      cashInAmount: cashIn, cashOutAmount: cashOut, cashIn: money(cashIn), cashOut: money(cashOut), cashFlow: money(cashNet),
      savingsRate: savingsRate(cashIn, cashNet, hasBank), partial };
  });

  const windows = [['Latest month', 1], ['Last 3 months', 3], ['Last 12 months', 12]].map(([label, size]) => {
    const inWindow = Array.from({ length: size }, (_, back) => previous(latest, back))
      .filter((month) => wanted.has(month));
    const totals = new Map();
    let partial = false;
    let spending = 0;
    for (const month of inWindow) {
      const view = views.get(month);
      partial ||= view.partial;
      spending += view.spending;
      for (const { category, amount } of view.byCategory) {
        totals.set(category, (totals.get(category) ?? 0) + amount);
      }
    }
    const items = [...totals].filter(([, amount]) => amount > 0)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
    const total = items.reduce((sum, { amount }) => sum + amount, 0);
    const tenths = total > 0 ? shares(items, total) : [];
    // Refunds that match no purchase make net spending lower than the category total; say so.
    return { label, months: inWindow.length, total: money(total), partial,
      otherCredits: spending === total ? null : money(spending - total),
      categories: items.map(({ category, amount }, index) => ({ category, amount, value: money(amount),
        share: percent(tenths[index]) })) };
  });

  const usable = Array.from({ length: setAsideMonths }, (_, back) => previous(latest, back))
    .filter((month) => wanted.has(month) && !views.get(month).partial);
  const surplus = usable.reduce((sum, month) => sum + views.get(month).cashMovement.net, 0);
  // Without any money in those months the cash flow is only minus the money out, which says nothing.
  const hasIncome = usable.some((month) => views.get(month).cashMovement.in > 0);
  const setAside = usable.length && hasIncome
    ? { value: money(Math.round(surplus / usable.length)), months: usable.length,
      note: 'Estimate from your imported history, not advice' } : null;
  return { currency: displayCurrency, months: rows, windows, setAside };
}
