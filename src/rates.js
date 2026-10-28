const SCALE = 10n ** 8n;
const MONEY_SCALE = 100n;

function decimal(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 8) return null;
  return BigInt(whole) * SCALE + BigInt((fraction + '0'.repeat(8)).slice(0, 8));
}

function roundHalfAway(numerator, denominator) {
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (magnitude + denominator / 2n) / denominator;
  return numerator < 0n ? -rounded : rounded;
}

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function latestDate(dates, requested, period) {
  return [...dates.keys()].filter((date) => date >= period.from && date <= requested).sort().at(-1);
}

// shortcut: assumes 2 minor decimals, upgrade when a zero-decimal currency like JPY is needed
export function createRateClient({ fetch, baseUrl, getSecret }) {
  const dates = new Map();
  const periods = [];
  return {
    async load({ from, to }) {
      const start = new Date(`${from}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 7);
      const query = new URLSearchParams({ from: start.toISOString().slice(0, 10), to });
      let response;
      try {
        response = await fetch(`${baseUrl}/rates?${query}`, {
          headers: { Authorization: `Bearer ${getSecret()}` },
        });
      } catch {
        throw makeError('offline');
      }
      if (response.status !== 200) {
        throw makeError(response.status === 401 ? 'unauthorized' : 'upstream');
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw makeError('upstream');
      }
      if (!payload?.rates || typeof payload.rates !== 'object') throw makeError('upstream');
      for (const [date, rates] of Object.entries(payload.rates)) dates.set(date, rates);
      periods.push({ from: query.get('from'), to });
    },
    convert({ amount, currency }, toCurrency, date) {
      if (currency === toCurrency) return { amount };
      const period = periods.find(({ from, to }) => date >= from && date <= to);
      if (!period) return { unavailable: true };
      const dateKey = latestDate(dates, date, period);
      if (!dateKey) return { unavailable: true };
      const rates = dates.get(dateKey);
      const fromRate = currency === 'EUR' ? SCALE : decimal(rates[currency]);
      const toRate = toCurrency === 'EUR' ? SCALE : decimal(rates[toCurrency]);
      if (fromRate === null || fromRate === undefined || !toRate) return { unavailable: true };
      const converted = roundHalfAway(BigInt(amount) * toRate * MONEY_SCALE, fromRate * MONEY_SCALE);
      return { amount: Number(converted) };
    },
  };
}

export function summarize(rows, client, displayCurrency) {
  let total = 0;
  let partial = false;
  for (const row of rows) {
    const converted = client.convert(row, displayCurrency, row.date);
    if (converted.unavailable) partial = true;
    else total += converted.amount;
  }
  return { total, partial };
}
