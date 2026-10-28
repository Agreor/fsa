import test from 'node:test';
import assert from 'node:assert/strict';
import {
  merchantKey, reduceForClassifier, PROCESSOR_PREFIXES, CITY_WORDS,
  PERSONAL_RISK_PROCESSORS,
} from '../src/merchant.js';

test('exports processor and city word sets', () => {
  assert.deepEqual([...PROCESSOR_PREFIXES], [
    'linepay', 'lpth', 'sq', 'sp', 'tst', 'paypal', 'paddle', 'stripe', 'gumroad',
  ]);
  assert.ok(CITY_WORDS.has('bangkok'));
  assert.deepEqual(PERSONAL_RISK_PROCESSORS,
    ['paypal', 'sq', 'sp', 'tst', 'stripe', 'paddle', 'gumroad', 'venmo', 'verqs', 'wise',
      'revolut', 'truemoney', 'kplus', 'scb', 'promptpay', 'zelle', 'cashapp',
      'alipay', 'wechat', 'bizum', 'twint', 'bancontact', 'payconiq', 'tikkie', 'ideal']);
});

test('processor references reduce to a stable merchant key', () => {
  for (const text of ['GRAB*A-123', 'GRAB*B-456', 'Grab*A-9']) {
    assert.equal(merchantKey(text), 'grab');
  }
  assert.equal(merchantKey('LINEPAY*PF_LINE MAN WO BANGKOK'), 'linepay line man');
  assert.equal(merchantKey('SQ*BLUE BOTTLE'), 'sq blue bottle');
  assert.equal(merchantKey('SQ*BLUE ELEPHANT'), 'sq blue elephant');
  assert.equal(merchantKey('SHOP AB123'), 'shop');
  assert.equal(merchantKey('SHOP CD456'), 'shop');
  assert.equal(merchantKey('LPTH*PF_LM_1234567P89P Bangkok'), 'lpth lm');
  assert.equal(merchantKey('LPTH*PF_LM_7654321Q12Q Bangkok'), 'lpth lm');
});

test('non-processor descriptors keep the first two useful words', () => {
  assert.equal(merchantKey('WWW.GRAB.COM BANGKOK'), 'grab');
  assert.equal(merchantKey('OPENAI *CHATGPT SUBSCR SAN FRANCISCO'), 'openai');
  assert.equal(merchantKey('EA *ELECTRONIC ARTS GENEVA'), 'electronic arts');
  assert.equal(merchantKey('EXAMPLE SHOP BANGKOK 123'), 'example shop');
  assert.equal(merchantKey('Café de Flore Paris'), 'cafe de');
  assert.equal(merchantKey('ร้านอิ่ม'), 'ร้านอิ่ม');
  assert.equal(merchantKey('ร้านอุ้ม'), 'ร้านอุ้ม');
  assert.equal(merchantKey('THE COFFEE CLUB*123'), 'the coffee');
  assert.equal(merchantKey('CAFE PARIS STORE'), 'cafe');
  assert.equal(merchantKey('ร้านอิ่ม '), 'ร้านอิ่ม');
  assert.equal(
    merchantKey('ร้านอาหาร กรุงเทพมหานคร').split(' ').length,
    2,
  );
});

test('merchant keys handle exclusions, city overrides, and idempotence', () => {
  for (const value of ['', null, undefined, '   ', '12345', '***', 42, '!!!']) {
    assert.equal(merchantKey(value), null);
  }
  assert.equal(merchantKey('PF POS PAY PAYMENT PURCHASE CARD WWW COM CO TH'), null);
  assert.equal(merchantKey('Bangkok'), 'bangkok');
  assert.equal(merchantKey('A BANGKOK'), null);
  assert.equal(merchantKey('H&M BANGKOK'), 'hm');
  assert.equal(merchantKey('H&M LONDON'), 'hm');
  assert.equal(merchantKey('AT&T BANGKOK'), 'att');
  assert.equal(merchantKey('EXAMPLE SHOP ROME', { cities: ['rome'] }), 'example shop');
  assert.equal(merchantKey('Same Store'), merchantKey('SAME STORE'));
  const idempotent = [
    'GRAB*A-123', 'WWW.GRAB.COM BANGKOK', 'EA *ELECTRONIC ARTS GENEVA',
    'sq blue bottle', 'sq blue elephant', 'linepay line man', 'lpth lm', 'grab',
    'openai', 'electronic arts', 'hm', 'linepay', 'lpth', 'sp blue bottle',
    'tst coffee shop', 'paypal shop', 'paddle shop', 'stripe shop', 'gumroad shop',
    'coffee house', 'fresh food', 'city bakery', 'museum shop', 'ticket office',
    'hardware store', 'online service', 'train station', 'parking lot', 'music store',
    'ร้านอิ่ม', 'ร้านอุ้ม', 'THE COFFEE CLUB*123', 'CAFE PARIS STORE',
    'OPENAI *CHATGPT SUBSCR SAN FRANCISCO', 'GRAB*A-123',
    'CAFE PARIS', 'CAFE PARIS STORE', 'CITY PARIS SHOP', 'COFFEE CLUB PARIS',
    'THE COFFEE CLUB*123', 'EA *ELECTRONIC ARTS GENEVA', 'LINEPAY*PF_LINE MAN WO BANGKOK',
    'LPTH*PF_LM_1234567P89P Bangkok', 'WWW.GRAB.COM BANGKOK', 'EXAMPLE SHOP BANGKOK 123',
    'Café de Flore Paris', 'OPENAI CHATGPT', 'GRABFOOD*X1', 'BANGKOK',
    'H&M BANGKOK', 'AT&T LONDON', 'SQ*BLUE BOTTLE', 'SP*BLUE BOTTLE',
    'PADDLE*SHOP', 'STRIPE*SHOP', 'GUMROAD*SHOP', 'PAYPAL*SHOP',
    'SAN FRANCISCO', 'HONG KONG', 'KUALA LUMPUR', 'CHIANG MAI',
    'NONTHABURI SHOP', 'PHUKET CAFE', 'SINGAPORE STORE', 'TOKYO MUSEUM',
  ];
  for (const value of idempotent) {
    assert.equal(merchantKey(merchantKey(value)), merchantKey(value));
  }
  assert.notEqual(merchantKey('GRAB*A-123'), merchantKey('GRABFOOD*X1'));
});

test('classifier normalises confusables and format characters before risk checks', () => {
  const boldVenmo = '\ud835\ude51\ud835\ude40\ud835\ude4d\ud835\ude4c\ud835\ude4e JOHN SMITH';
  assert.equal(reduceForClassifier(boldVenmo, { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('STRI\u200bPE JOHN SMITH',
    { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('p a y p a l JOHN', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('WISE CAFE', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('GRAB*A-123', { accountKind: 'credit_card' }), 'GRAB');
});

test('classifier reduction requires a card account and removes terminal noise', () => {
  assert.equal(reduceForClassifier('GRAB*A-123', { accountKind: 'credit_card' }), 'GRAB');
  assert.equal(reduceForClassifier('WWW.GRAB.COM BANGKOK', { accountKind: 'credit_card' }),
    'WWW GRAB COM BANGKOK');
  assert.equal(reduceForClassifier('OPENAI *CHATGPT SUBSCR SAN FRANCISCO', { accountKind: 'credit_card' }),
    'OPENAI CHATGPT SUBSCR SAN FRANCISCO');
  assert.equal(reduceForClassifier('GRAB*A-123', { accountKind: 'debit_card' }), null);
  assert.equal(reduceForClassifier('GRAB*A-123', { accountKind: 'card' }), null);
  assert.equal(reduceForClassifier('POS GRAB STORE', { accountKind: 'credit_card' }), 'GRAB STORE');
  for (const value of [
    'POS a Jean Dupont', 'POS pour Jean Dupont', 'POS Mme Marie Dubois',
    'POS huur oktober Jan Jansen', 'โอนให้ สมชาย ใจดี',
  ]) assert.equal(reduceForClassifier(value, { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('paypal *JOHN SMITH', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('VENMO *JOHN SMITH', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('LINEPAY*JOHN SMITH', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('LINEPAY*PF_LINE MAN WO BANGKOK',
    { accountKind: 'credit_card' }), 'LINE MAN WO BANGKOK');
  for (const value of ['TrueMoney JOHN SMITH', 'KPLUS JOHN SMITH', 'SCB EASY JOHN SMITH',
    'PromptPay JOHN SMITH']) {
    assert.equal(reduceForClassifier(value, { accountKind: 'credit_card' }), null);
  }
  assert.equal(reduceForClassifier('WISE CAFE', { accountKind: 'credit_card' }), null);
  for (const value of [
    'POS PAYPAL *JOHN SMITH', 'PAYPAL JOHN SMITH', 'paypal*JOHN',
    'SQ *BLUE BOTTLE',
  ]) assert.equal(reduceForClassifier(value, { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('WWW.SPOTIFY.COM', { accountKind: 'credit_card' }),
    'WWW SPOTIFY COM');
  assert.equal(reduceForClassifier('PAYPALX SHOP', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('GRAB*A-123', { accountKind: 'credit_card' }), 'GRAB');
});

test('classifier rejects sensitive numbers, email, and payment language', () => {
  for (const value of [
    'Payment to John Smith', 'Virement de Jean Dupont', 'communication: rent october',
    'PAYMENT THANK YOU - CROSS BANK BILL PAY', 'Transfer from J. Smith 12345678',
    'SHOP 123456 BANGKOK', 'jane@example.com', 'BE68 5390 0754 7034', // pii-ok synthetic
  ]) {
    assert.equal(reduceForClassifier(value, { accountKind: 'credit_card' }), null);
  }
});

test('classifier rejects empty, short, long, and malformed input', () => {
  for (const value of ['', null, undefined, 42, 'X', 'a'.repeat(60)]) {
    assert.equal(reduceForClassifier(value, { accountKind: 'credit_card' }), null);
  }
  assert.equal(reduceForClassifier('12345', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('***', { accountKind: 'credit_card' }), null);
  assert.equal(reduceForClassifier('AB STORE', null), null);
  assert.equal(reduceForClassifier('AB STORE', {}), null);
});

test('long input returns quickly and safely', () => {
  const input = 'SHOP '.repeat(1000);
  assert.equal(merchantKey(input), 'shop shop');
  assert.equal(reduceForClassifier(input, { accountKind: 'credit_card' }), null);
});

test('every classifier result contains only single spaced letters and has valid length', () => {
  const values = [
    'JOHN SMITH', 'JANE DOE', 'GRAB STORE', 'OPENAI CHATGPT', 'SHOP ABC', 'CAFE FLORE',
    'ร้านอาหาร ไทย', '123456', 'REF 1234', 'PAYMENT TO ALICE', 'BANK TRANSFER',
    'RENT OCTOBER',
    'SHOP 123456 BANGKOK', 'jane@example.com', 'BE68 5390 0754 7034', 'A', 'X STORE', // pii-ok synthetic
    'GOOD STORE', 'LOCAL MARKET', 'BOOK SHOP', 'COFFEE HOUSE', 'FRESH FOOD', 'CITY BAKERY',
    'MUSEUM SHOP', 'TICKET OFFICE', 'HARDWARE STORE', 'ONLINE SERVICE', 'TRAIN STATION',
    'PARKING LOT', 'MUSIC STORE',
  ];
  for (const value of values) {
    const result = reduceForClassifier(value, { accountKind: 'credit_card' });
    if (result !== null) {
      assert.match(result, /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u);
      assert.ok(result.length >= 2 && result.length <= 40);
    }
  }
  const thaiKind = { accountKind: 'credit_card' };
  assert.equal(reduceForClassifier('ร้านอิ่ม', thaiKind), 'ร้านอิ่ม');
  assert.equal(reduceForClassifier('ร้านอุ้ม', thaiKind), 'ร้านอุ้ม');
});
