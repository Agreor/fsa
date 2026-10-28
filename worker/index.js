const ECB_RECENT = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const ECB_ALL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

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

function scanFeed(xml) {
  const rates = {};
  let date;
  for (const match of xml.matchAll(/<Cube\b([^>]*)\/?\s*>/g)) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]),
    );
    if (attrs.time) {
      if (rates[attrs.time] || !dateIsValid(attrs.time)) throw new Error('invalid feed');
      date = attrs.time;
      rates[date] = {};
    } else if (attrs.currency && date) {
      if (rates[date][attrs.currency]) throw new Error('invalid feed');
      rates[date][attrs.currency] = attrs.rate;
    }
  }
  if (!Object.keys(rates).length) throw new Error('empty feed');
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
  const parsed = scanFeed(await upstream.text());
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
