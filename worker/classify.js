import { CATEGORIES } from '../src/categories.js';
import { reduceForClassifier } from '../src/merchant.js';

// Pinned, not the moving jev-latest alias, because MIN_CONFIDENCE is tuned to a version.
export const MODEL = 'jev-1.14.0';
export const MIN_CONFIDENCE = 0.6;
export const UPSTREAM_URL = 'https://api.typesafe.ai/v1/systemone';
export const MAX_TEXTS = 50;

export const CATEGORY_HINTS = Object.freeze({
  Groceries: 'Supermarkets, food markets, bakeries, butchers and other shops selling food for home cooking',
  'Eating out': 'Restaurants, cafes, bars, fast food, takeaway and food delivery apps',
  Transport: 'Local travel: fuel, parking, tolls, taxis, ride hailing, public transport, car services',
  Shopping: 'Retail goods: clothing, electronics, home goods, books, department stores and online shops',
  Subscriptions: 'Recurring digital services and memberships: streaming, software, cloud storage, news, apps',
  Health: 'Pharmacies, doctors, dentists, opticians, hospitals, therapy, gyms and wellness',
  Housing: 'Rent, mortgage, furniture, home repair, building supplies and household maintenance',
  Utilities: 'Electricity, gas, water, internet, mobile phone and other bills for running a home',
  Insurance: 'Life, health, travel, car, home and other insurance premiums and instalments',
  Travel: 'Trips away from home: airlines, hotels, booking sites, tours, rental cars, visas',
  Entertainment: 'Cinemas, concerts, events, museums, games, hobbies and leisure activities',
  Fees: 'Bank and card fees, interest, currency conversion and other charges for financial services',
  Other: 'Anything that fits none of the other categories',
});

const failure = (code, status) => Object.assign(new Error(code), { code, status });

// Privacy gate: letters, combining marks and single spaces only, so a number never gets through, and the
// browser's merchant reducer must accept the text (it returns null for transfers, names and the like).
// Not "unchanged by the reducer": it strips one leading terminal word per call, so a second pass can differ.
const NAME = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const accepted = (text) => reduceForClassifier(text, { accountKind: 'credit_card' }) !== null;

export function validTexts(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= MAX_TEXTS
    && value.every((text) => typeof text === 'string' && text.length >= 2 && text.length <= 80
      && NAME.test(text) && accepted(text)) && new Set(value).size === value.length;
}

export function buildRequest(texts) {
  const questions = {};
  texts.forEach((_text, index) => {
    questions[`q${index}`] = { type: 'choice', criteria: CATEGORY_HINTS,
      instructions: `Which spending category best fits the card merchant named in \`merchants[${index}]\`? `
        + 'It is a shortened merchant name from a card statement; judge by what the merchant sells.' };
  });
  return { model: MODEL, state: { merchants: texts }, questions };
}

export function readAnswers(texts, body) {
  if (body === null || typeof body !== 'object' || body.answers === null
    || typeof body.answers !== 'object') throw failure('upstream');
  const categories = {};
  texts.forEach((text, index) => {
    const answer = body.answers[`q${index}`];
    if (answer && answer.type === 'choice' && CATEGORIES.includes(answer.choice)
      && Number.isFinite(answer.confidence) && answer.confidence >= MIN_CONFIDENCE) {
      categories[text] = answer.choice;
    }
  });
  return categories;
}

// Errors carry only a code and the upstream status number, never merchant text, the credential or a message.
export async function classify({ texts, credential, fetch = globalThis.fetch }) {
  let upstream;
  try {
    upstream = await fetch(UPSTREAM_URL, { method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(texts)), signal: AbortSignal.timeout(20000) });
  } catch { throw failure('upstream'); }
  if (upstream.status === 429 || upstream.status === 529) throw failure('busy', upstream.status);
  if (upstream.status !== 200) throw failure('upstream', upstream.status);
  let body;
  try { body = await upstream.json(); } catch { throw failure('upstream'); }
  return readAnswers(texts, body);
}
