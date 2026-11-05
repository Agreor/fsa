const ECB_RECENT = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const ECB_ALL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';
import { classify, validTexts } from './classify.js';

const MAX_BODY = 16384;

function response(status, body, headers = {}) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function dateIsValid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Only the days inside [from, to] are parsed: the full history is too heavy for a Worker's CPU and memory
// limits (error 1102). The feed has one `<Cube time="...">` block per day, so a native split is cheap.
function scanFeed(xml, from, to) {
  const rates = {};
  const days = xml.split('<Cube time="').slice(1);
  if (!days.length) throw new Error('empty feed');
  for (const day of days) {
    const date = day.slice(0, 10);
    if (!dateIsValid(date)) throw new Error('invalid feed');
    if (date < from || date > to) continue;
    if (rates[date]) throw new Error('invalid feed');
    rates[date] = {};
    for (const match of day.matchAll(/<Cube\b([^>]*)\/?\s*>/g)) {
      const attrs = Object.fromEntries(
        [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]),
      );
      if (!attrs.currency) continue;
      if (rates[date][attrs.currency]) throw new Error('invalid feed');
      rates[date][attrs.currency] = attrs.rate;
    }
  }
  return rates;
}

async function matchesSecret(provided, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([provided, expected].map((value) =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function corsHeaders(request, env) {
  const origin = env.ALLOWED_ORIGIN;
  return origin && request.headers.get('Origin') === origin
    ? { 'Access-Control-Allow-Origin': origin }
    : {};
}

function error(status, name, headers) {
  return response(status, { error: name }, headers);
}

function validQuery(from, to, currencies) {
  if (!dateIsValid(from) || !dateIsValid(to) || from > to) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  return days <= 400 && (currencies === null ||
    (currencies.length > 0 && currencies.split(',').every((value) => /^[A-Z]{3}$/.test(value))));
}

async function loadRates(request, from, to, currencies, headers) {
  const today = new Date().toISOString().slice(0, 10);
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  const upstream = await globalThis.fetch(age <= 90 ? ECB_RECENT : ECB_ALL);
  if (upstream.status !== 200) throw new Error('upstream');
  const parsed = scanFeed(await upstream.text(), from, to);
  const requested = currencies?.split(',');
  const filtered = {};
  for (const day of Object.keys(parsed).sort()) {
    if (day < from || day > to) continue;
    const dayRates = {};
    for (const [currency, value] of Object.entries(parsed[day])) {
      if (requested && !requested.includes(currency)) continue;
      if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) throw new Error('invalid rate');
      dayRates[currency] = value;
    }
    if (Object.keys(dayRates).length) filtered[day] = dayRates;
  }
  if (!Object.keys(filtered).length) throw new Error('empty range');
  return response(200, { base: 'EUR', source: 'ecb', rates: filtered }, headers);
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS' && url.pathname === '/rates') {
      return response(204, null, { ...headers, 'Access-Control-Allow-Headers': 'authorization' });
    }
    if (request.method === 'OPTIONS' && url.pathname === '/classify') {
      return response(204, null, { ...headers,
        'Access-Control-Allow-Headers': 'authorization, content-type' });
    }
    if (request.method === 'POST' && url.pathname === '/classify') {
      return classifyRoute(request, env, headers);
    }
    if (request.method !== 'GET' || url.pathname !== '/rates') {
      return error(404, 'not_found', headers);
    }
    if (!env.ACCESS_SECRET) return error(503, 'unavailable', headers);
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ') ||
        !await matchesSecret(authorization.slice(7), env.ACCESS_SECRET)) {
      return error(401, 'unauthorized', headers);
    }
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const currencies = url.searchParams.get('currencies');
    if (!validQuery(from, to, currencies)) return error(400, 'bad_request', headers);
    try {
      return await loadRates(request, from, to, currencies, headers);
    } catch {
      return error(502, 'upstream', headers);
    }
  },
};

// Counts bytes as they arrive and stops reading at the limit; null means too large.
async function readLimited(request, limit) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function classifyRoute(request, env, headers) {
  if (!env.ACCESS_SECRET) return error(503, 'unavailable', headers);
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ') ||
      !await matchesSecret(authorization.slice(7), env.ACCESS_SECRET)) {
    return error(401, 'unauthorized', headers);
  }
  if (!env.TYPESAFE_API_KEY) return error(503, 'classifier_unavailable', headers);
  const raw = await readLimited(request, MAX_BODY);
  if (raw === null) return error(413, 'too_large', headers);
  let body;
  try { body = JSON.parse(raw); } catch { return error(400, 'bad_request', headers); }
  if (body === null || typeof body !== 'object' || !validTexts(body.texts)) {
    return error(400, 'bad_request', headers);
  }
  try {
    const categories = await classify({ texts: body.texts, credential: env.TYPESAFE_API_KEY });
    return response(200, { categories }, headers);
  } catch (failure) {
    // Only the upstream status number is passed on, to tell a rejected request from an outage.
    const status = Number.isInteger(failure.status) ? { 'X-Upstream-Status': String(failure.status) } : {};
    return failure.code === 'busy'
      ? error(503, 'busy', { ...headers, ...status, 'Retry-After': '30' })
      : error(502, 'upstream', { ...headers, ...status });
  }
}
