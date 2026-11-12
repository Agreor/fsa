// Manual dated values for pension funds and insurance contracts. One record per name and as-of date;
// the latest per name counts. shortcut: the value is typed in, no fund units or price feed yet.
export const ENTRY_KINDS = ['pension', 'insurance'];

const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const entryKey = (name, asOf) => `entry:${name}|${asOf}`;

// null when the entry is usable, else why not. `key`, when given, must match the entry.
export function entryProblem(entry, key) {
  if (entry === null || typeof entry !== 'object') return 'an entry is not an object';
  const { name, kind, amount, currency, asOf, payoutAge } = entry;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 60
    || name.includes('|')) return 'enter a name of up to 60 characters, without |';
  if (!ENTRY_KINDS.includes(kind)) return 'choose pension or insurance';
  if (!Number.isSafeInteger(amount) || amount < 0) return 'the value must be zero or more';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return 'enter a 3-letter currency such as EUR';
  }
  if (!validDate(asOf)) return 'enter a valid as-of date';
  if (payoutAge !== null && !(Number.isInteger(payoutAge) && payoutAge >= 0 && payoutAge <= 120)) {
    return 'enter the payout age as a whole number from 0 to 120, or leave it empty';
  }
  return key !== undefined && key !== entryKey(name, asOf) ? 'an entry key does not match its content' : null;
}

export function createEntries({ backend }) {
  return {
    async list() {
      return (await backend.list('entry:')).sort((a, b) =>
        a.name.localeCompare(b.name) || b.asOf.localeCompare(a.asOf));
    },
    async add({ name, kind, amount, currency, asOf, payoutAge = null }) {
      const entry = { name: typeof name === 'string' ? name.trim() : name, kind, amount, currency, asOf,
        payoutAge };
      const problem = entryProblem(entry);
      if (problem) throw new TypeError(problem);
      const existing = await backend.get(entryKey(entry.name, entry.asOf));
      if (existing && existing.kind !== entry.kind) {
        throw new TypeError(`there is already a ${existing.kind} named "${entry.name}" on this date; change the date or the name`);
      }
      await backend.commit([{ key: entryKey(entry.name, entry.asOf), value: entry }]);
      return entry;
    },
    async remove(name, asOf) {
      await backend.commit([{ key: entryKey(name, asOf), value: undefined }]);
    },
  };
}
