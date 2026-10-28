export const SOURCE_DEFAULTS = {
  s1: { label: 'S1', kind: 'bank' },
  s2: { label: 'S2', kind: 'debit_card' },
  s5: { label: 'S5', kind: 'credit_card' },
};

export const defaultsFor = (id) => ({ kind: SOURCE_DEFAULTS[id]?.kind ?? 'bank' });

export function createSources(modules) {
  return {
    sourceModule: (id) => Object.hasOwn(SOURCE_DEFAULTS, id) ? modules[id] : undefined,
    defaultsFor,
  };
}
