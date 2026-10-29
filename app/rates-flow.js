export function createLatest() {
  let token = 0;
  return { next: () => ++token, isCurrent: (value) => value === token };
}

export function createRatesFlow({ client, hasSecret }) {
  const loaded = [];
  let pending = Promise.resolve();
  const validDate = (date) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  };
  const merge = () => {
    loaded.sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < loaded.length;) {
      const after = new Date(`${loaded[i - 1].to}T00:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 1);
      if (loaded[i].from <= after.toISOString().slice(0, 10)) {
        loaded[i - 1].to = loaded[i].to > loaded[i - 1].to ? loaded[i].to : loaded[i - 1].to;
        loaded.splice(i, 1);
      } else i++;
    }
  };
  const ensure = async (rows) => {
    const dates = rows.map(({ date }) => date).filter(validDate);
    if (!dates.length) return { status: 'nothing' };
    if (!hasSecret()) return { status: 'no_secret' };
    dates.sort();
    let from = dates[0];
    const end = dates.at(-1);
    while (from <= end) {
      const covering = loaded.find((span) => span.from <= from && span.to >= from);
      if (covering) {
        const next = new Date(`${covering.to}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        from = next.toISOString().slice(0, 10);
        continue;
      }
      let toDate = new Date(`${from}T00:00:00Z`);
      toDate.setUTCDate(toDate.getUTCDate() + 389);
      let to = toDate.toISOString().slice(0, 10);
      if (to > end) to = end;
      const nextLoaded = loaded.find((span) => span.from > from);
      if (nextLoaded && nextLoaded.from <= to) {
        toDate = new Date(`${nextLoaded.from}T00:00:00Z`);
        toDate.setUTCDate(toDate.getUTCDate() - 1);
        to = toDate.toISOString().slice(0, 10);
      }
      try {
        await client.load({ from, to });
        loaded.push({ from, to });
        merge();
      } catch (error) {
        return { status: ['offline', 'unauthorized', 'upstream'].includes(error.code)
          ? error.code : 'upstream' };
      }
      const next = new Date(`${to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      from = next.toISOString().slice(0, 10);
    }
    return { status: 'ok' };
  };
  return {
    ensure(rows) {
      const run = pending.then(() => ensure(rows));
      pending = run.catch(() => {});
      return run;
    },
    convertRows(rows, currency) {
      let partial = false;
      const items = rows.map((row) => {
        const result = client.convert(row, currency, row.date);
        if (result.unavailable) partial = true;
        return { row, amount: result.unavailable ? null : result.amount };
      });
      return { items, partial };
    },
  };
}
