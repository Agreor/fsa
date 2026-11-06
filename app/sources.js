export const SOURCE_DEFAULTS = {
  s1: { label: 'S1', kind: 'bank' },
  s2: { label: 'S2', kind: 'debit_card' },
  s3: { label: 'S3', kind: 'broker' },
  s5: { label: 'S5', kind: 'credit_card' },
  s6: { label: 'Trip list', kind: 'trips' },
};

export const defaultsFor = (id) => ({ kind: SOURCE_DEFAULTS[id]?.kind ?? 'bank' });

export function createSources(modules) {
  return {
    sourceModule: (id) => Object.hasOwn(SOURCE_DEFAULTS, id) ? modules[id] : undefined,
    defaultsFor,
  };
}
