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

export function formatAmount(minor, currency) {
  const value = BigInt(minor);
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')} ${currency}`;
}
