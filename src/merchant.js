export const PROCESSOR_PREFIXES = new Set([
  'linepay', 'lpth', 'sq', 'sp', 'tst', 'paypal', 'paddle', 'stripe', 'gumroad',
]);

export const CITY_WORDS = new Set([
  'bangkok', 'nonthaburi', 'phuket', 'singapore', 'london', 'geneva', 'brussels',
  'antwerp', 'amsterdam', 'paris', 'berlin', 'dublin', 'tokyo', 'san francisco',
  'hong kong', 'kuala lumpur', 'chiang mai',
]);

const NOISE = new Set(['pf', 'pos', 'pay', 'payment', 'purchase', 'card', 'www', 'com', 'co', 'th']);
const PRIVATE_WORDS = new Set([
  'virement', 'transfer', 'transfert', 'payment', 'paiement', 'to', 'from', 'de', 'du',
  'communication', 'reference', 'ref', 'remboursement', 'refund', 'salary', 'rent',
  'loyer', 'invoice', 'facture', 'thank', 'you', 'bill', 'pay', 'wise', 'revolut',
  'a', 'au', 'aux', 'pour', 'par', 'mr', 'mrs', 'mme', 'mlle', 'madame', 'monsieur',
  'mevrouw', 'meneer', 'huur', 'huurder', 'betaling', 'overschrijving', 'mijn', 'ma',
  'mon', 'for', 'โอน', 'ให้',
]);
export const PERSONAL_RISK_PROCESSORS = [
  // shortcut: blocks ordinary uses such as WISE CAFE; upgrade with merchant-aware context.
  'paypal', 'sq', 'sp', 'tst', 'stripe', 'paddle', 'gumroad', 'venmo', 'verqs', 'wise', 'revolut',
  'truemoney', 'kplus', 'scb', 'promptpay', 'zelle', 'cashapp', 'alipay', 'wechat',
  'bizum', 'twint', 'bancontact', 'payconiq', 'tikkie', 'ideal',
];

function normalise(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f\p{Cf}\u00ad\u200b-\u200f\u2060\ufeff]/gu, '')
    .normalize('NFC').toLowerCase();
}

function tokens(value) {
  return normalise(value).replace(/[^\p{L}\p{M}]+/gu, ' ').trim().split(/\s+/u).filter(Boolean);
}

function letters(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f\p{Cf}\u00ad\u200b-\u200f\u2060\ufeff]/gu, '')
    .normalize('NFC').replace(/[^\p{L}\p{M}]+/gu, ' ');
}

function useful(token) {
  return !NOISE.has(token) && [...token].length > 1;
}

function cityTokens(cities) {
  return [...cities].map((city) => tokens(city)).filter((parts) => parts.length);
}

export function merchantKey(description, options = {}) {
  if (typeof description !== 'string') return null;
  const originalTokens = tokens(description);
  description = description.replace(/(?<=\p{L})&(?=\p{L})/gu, '');
  description = description.split('*').map((part) =>
    part.split(/[\s_\-]+/u).filter((token) => !/\d/u.test(token)).join(' '),
  ).join('*');
  const star = description.indexOf('*');
  if (star !== -1) {
    const before = tokens(description.slice(0, star));
    const after = tokens(description.slice(star + 1));
    if (before.length === 1 && PROCESSOR_PREFIXES.has(before[0])) {
      return canonical(after, { processor: before[0], cities: options?.cities });
    }
    if (before.join(' ').length >= 3) return canonical(before, { cities: options?.cities });
    return canonical(after, { cities: options?.cities });
  }

  const kept = tokens(description).filter(useful);
  const cities = cityTokens(options?.cities ?? CITY_WORDS);
  if (originalTokens.length > 1 && kept.length === 1
    && cities.some((city) => city.length === 1 && city[0] === kept[0])) return null;
  return canonical(kept, { cities: options?.cities });
}

function canonical(input, { processor, cities: cityWords } = {}) {
  const cities = cityTokens(cityWords ?? CITY_WORDS);
  let kept = input.filter(useful);
  if (!processor && PROCESSOR_PREFIXES.has(kept[0])) processor = kept.shift();
  for (let iteration = 0; iteration < 5; iteration++) {
    const previous = kept.join(' ');
    for (const city of cities) {
      const start = kept.length - city.length;
      if (start > 0 && city.every((word, index) => kept[start + index] === word)) {
        kept.splice(start, city.length);
        break;
      }
    }
    kept = kept.slice(0, 2);
    if (kept.join(' ') === previous) break;
  }
  if (processor) kept = [processor, ...kept.slice(0, 2)];
  return kept.join(' ') || null;
}

// shortcut: first two words after processor and city removal; upgrade with per-merchant override rules
function sensitive(description) {
  return /\d{6,}/u.test(description)
    || description.includes('@')
    || /\b[A-Z]{2}\d{2}[A-Z\d]{10,}\b/u.test(description)
    || /\d(?:[ -]?\d){12,}/u.test(description);
}

function stripLeadingTerminal(value) {
  return value.replace(/^(?:paiement\s+par\s+carte|pos|purchase|achat|card)\b\s*/iu, '');
}

export function reduceForClassifier(description, context) {
  // this minimises text, it does not prove it is safe; the credit_card gate and the blocklist are the guards
  if (context?.accountKind !== 'credit_card' || typeof description !== 'string') return null;
  const riskText = normalise(description);
  if (tokens(riskText).some((word) => PERSONAL_RISK_PROCESSORS.includes(word))) return null;
  // shortcut: contained processor names can block ordinary merchants such as WISECO;
  // upgrade with merchant context.
  const squashed = riskText.replace(/[^\p{L}\p{M}]/gu, '');
  if (PERSONAL_RISK_PROCESSORS.some((word) => [...word].length >= 5
    && squashed.includes(word))) {
    return null;
  }
  if (sensitive(description)) return null;
  if (description.includes('โอน') || description.includes('ให้')) return null;

  let source = description;
  const star = source.indexOf('*');
  if (star !== -1) {
    const prefix = tokens(source.slice(0, star)).join(' ');
    if (prefix === 'linepay' && !/^\s*PF(?:_|\s)/iu.test(source.slice(star + 1))) return null;
    if (PERSONAL_RISK_PROCESSORS.includes(prefix)) return null;
    if (PROCESSOR_PREFIXES.has(prefix)) {
      source = source.slice(star + 1);
      if (prefix === 'linepay') source = source.replace(/^\s*PF(?:_|\s)/iu, '');
    }
  }
  source = stripLeadingTerminal(source);
  const words = letters(source).trim().replace(/\s+/gu, ' ').split(' ')
    .filter((word) => !(word.toLowerCase() === 'a' && /\*a-\d/iu.test(description)));
  if (words.some((word) => PRIVATE_WORDS.has(word.toLowerCase()))) return null;
  const result = words.filter((word) => [...word].length > 1).join(' ');
  if (result.length < 2 || result.length > 40) return null;
  return result;
}
