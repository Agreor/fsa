export const CURRENCIES = ['EUR', 'THB'];

export function convertedHeading(currency) {
  return `In ${CURRENCIES.includes(currency) ? currency : 'EUR'}`;
}

export function createCurrencySetting(storage) {
  return {
    get() {
      try {
        const value = storage.getItem('fsa.currency');
        return CURRENCIES.includes(value) ? value : 'EUR';
      } catch { return 'EUR'; }
    },
    set(currency) {
      if (!CURRENCIES.includes(currency)) throw new TypeError('Unsupported currency');
      try { storage.setItem('fsa.currency', currency); } catch {}
      return currency;
    },
  };
}

// 1234567 -> "1,234,567": a comma every three digits so large amounts can be read at a glance.
export const groupDigits = (digits) => String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function formatAmount(minor, currency) {
  const value = BigInt(minor);
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  return `${sign}${groupDigits(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, '0')} ${currency}`;
}
