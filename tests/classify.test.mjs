import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../src/categories.js';
import { CATEGORY_HINTS, MAX_TEXTS, MIN_CONFIDENCE, MODEL, UPSTREAM_URL, buildRequest, classify,
  readAnswers, validTexts } from '../worker/classify.js';

const placeholder = 'placeholder-not-real';
const answer = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence, probabilities: {} });
const reply = (answers, status = 200) => async () => new Response(JSON.stringify({ model: MODEL, answers }),
  { status });

test('the hints describe every category and nothing else', () => {
  assert.deepEqual(Object.keys(CATEGORY_HINTS).sort(), [...CATEGORIES].sort());
  for (const [name, hint] of Object.entries(CATEGORY_HINTS)) {
    assert.ok(hint.length > name.length + 10, name);
  }
});

test('validTexts accepts letters, marks and single spaces only', () => {
  const cardLike = ['4111111111111111']; // pii-ok synthetic
  const good = [['Lidl'], ['Cafe Rouge'], ['ร้านกาแฟ สยาม'], ['Uber Trip'], ['ab', 'cd'],
    ['POS CARD FACTORY', 'Lidl'], ['CARD FACTORY'], ['Café Müller']];
  for (const value of good) assert.equal(validTexts(value), true, JSON.stringify(value));
  const bad = [['Transfer Alice Example'], [], 'Lidl', null, undefined, {}, ['a'],
    ['x'.repeat(81)], ['Lidl 12'], ['Lidl1'], ['Li-dl'],
    ['Lidl\n'], [' Lidl'], ['Lidl '], ['Lidl  Shop'], ['Li\tdl'], cardLike, [5], ['Lidl', 'Lidl'],
    [''], ['Lidl@shop'], ['Lidl\u0000'],
    Array.from({ length: MAX_TEXTS + 1 }, (_, i) => `n${'a'.repeat(i + 2)}`)];
  for (const value of bad) assert.equal(validTexts(value), false, JSON.stringify(value));
  const letter = (n) => String.fromCharCode(97 + n);
  const fifty = Array.from({ length: MAX_TEXTS },
    (_, i) => `Shop ${letter(i % 26)}${letter(Math.floor(i / 26))}x`);
  assert.equal(validTexts(fifty), true);
});

test('buildRequest asks one choice question per merchant with the state path in it', () => {
  const request = buildRequest(['Lidl', 'Cafe Rouge']);
  assert.equal(request.model, MODEL);
  assert.deepEqual(request.state, { merchants: ['Lidl', 'Cafe Rouge'] });
  assert.deepEqual(Object.keys(request.questions), ['q0', 'q1']);
  assert.equal(request.questions.q1.type, 'choice');
  assert.ok(request.questions.q1.instructions.includes('`merchants[1]`'));
  assert.equal(request.questions.q0.criteria, CATEGORY_HINTS);
  assert.ok(!JSON.stringify(request).includes('placeholder'));
});

test('readAnswers keeps confident answers inside the category set', () => {
  const texts = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'];
  const body = { answers: { q0: answer('Groceries'), q1: answer('Groceries', MIN_CONFIDENCE - 0.01),
    q2: answer('Pizza'), q3: { type: 'noul', choice: 'Groceries', confidence: 1 },
    q4: answer('Fees', MIN_CONFIDENCE), q5: { ...answer('Fees'), confidence: '0.9' }, q6: null } };
  assert.deepEqual(readAnswers(texts, body), { a1: 'Groceries', e5: 'Fees' });
  assert.deepEqual(readAnswers(texts, { answers: {} }), {});
});

test('readAnswers refuses a body without answers', () => {
  for (const body of [null, 'x', 5, {}, { answers: null }, { answers: 'x' }]) {
    assert.throws(() => readAnswers(['a1'], body), (error) => error.code === 'upstream');
  }
});

test('classify posts the request with the bearer credential and returns the categories', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ answers: { q0: answer('Groceries') } }));
  };
  const result = await classify({ texts: ['Lidl'], credential: placeholder, fetch });
  assert.deepEqual(result, { Lidl: 'Groceries' });
  assert.equal(seen[0].url, UPSTREAM_URL);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${placeholder}`);
  assert.deepEqual(JSON.parse(seen[0].init.body), buildRequest(['Lidl']));
  assert.ok(seen[0].init.signal instanceof AbortSignal);
});

test('classify maps rate limits to busy and everything else to upstream, without leaking', async () => {
  const codes = async (fetch) => {
    try { await classify({ texts: ['Lidl'], credential: placeholder, fetch }); } catch (error) {
      assert.ok(!error.message.includes('Lidl') && !error.message.includes(placeholder));
      return error.code;
    }
    return 'none';
  };
  for (const status of [429, 529]) assert.equal(await codes(reply({}, status)), 'busy');
  for (const status of [400, 401, 422, 500, 502]) assert.equal(await codes(reply({}, status)), 'upstream');
  assert.equal(await codes(async () => new Response(null, { status: 204 })), 'upstream');
  assert.equal(await codes(async () => { throw new Error('network Lidl'); }), 'upstream');
  assert.equal(await codes(async () => new Response('not json')), 'upstream');
  assert.equal(await codes(async () => new Response('null')), 'upstream');
});
