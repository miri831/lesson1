import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYemot, renderYemotMessage } from '../src/ivr/yemot.js';
import { createTwilio, renderTwiml, twilioSignature } from '../src/ivr/twilio.js';
import { createTranzilaPayments, parseTranzilaResponse } from '../src/payments/tranzila.js';

test('Yemot: message parts are rendered and special characters stripped', () => {
  const msg = renderYemotMessage([{ text: 'שלום, כאן "הגן".' }, { number: 25 }, { digits: '1234' }, { text: '' }]);
  assert.equal(msg, 't-שלום כאן הגן.n-25.d-1234');
});

test('Yemot: each question gets a new variable and the answer is fed back', async () => {
  const seen = [];
  const ivr = {
    async handle(callId, args) {
      seen.push(args.input);
      return seen.length < 3 ? { say: [{ text: 'הקישו' }], gather: { max: 1, min: 1, timeout: 7 } } : { say: [{ text: 'שלום' }], hangup: true };
    },
    hangup() {},
  };
  const y = createYemot({}, ivr);
  const base = { ApiCallId: 'c1', ApiPhone: '0527654321' };
  assert.equal(await y.handleRequest(base), 'read=t-הקישו=k1,no,1,1,7,No,yes,no');
  assert.equal(await y.handleRequest({ ...base, k1: '1' }), 'read=t-הקישו=k2,no,1,1,7,No,yes,no');
  assert.equal(await y.handleRequest({ ...base, k1: '1', k2: '4' }), 'id_list_message=t-שלום&go_to_folder=hangup');
  assert.deepEqual(seen, [undefined, '1', '4']);
});

test('Yemot: dial calls RunCampaign and reports API errors', async () => {
  let calledUrl;
  const fetchOk = async (url) => {
    calledUrl = url;
    return { status: 200, json: async () => ({ responseStatus: 'OK', campaignId: 77 }) };
  };
  const y = createYemot({ number: '0771234567', password: 'pw', templateId: '9' }, {}, fetchOk);
  assert.deepEqual(await y.dial(['0527654321', '0548888888']), { ok: true, ref: '77' });
  const u = new URL(calledUrl);
  assert.equal(u.pathname, '/ym/api/RunCampaign');
  assert.equal(u.searchParams.get('phones'), '0527654321,0548888888');

  const fetchErr = async () => ({ status: 200, json: async () => ({ responseStatus: 'ERROR', message: 'bad token' }) });
  assert.deepEqual(await createYemot({ number: '1', password: '2', templateId: '3' }, {}, fetchErr).dial(['0527654321']), {
    ok: false,
    error: 'bad token',
  });
  assert.equal((await createYemot({}, {}).dial(['0527654321'])).ok, false);
});

test('Twilio: TwiML gather and hangup, XML-escaped', () => {
  const twiml = renderTwiml({ say: [{ text: 'a<b' }], gather: { max: 1, min: 1, timeout: 7 } }, 'https://x/ivr/twilio/voice');
  assert.match(twiml, /<Gather input="dtmf" numDigits="1"/);
  assert.match(twiml, /a&lt;b/);
  assert.match(renderTwiml({ say: [{ text: 'bye' }], hangup: true }, ''), /<Hangup\/>/);
});

test('Twilio: request signature validation', async () => {
  const t = createTwilio({ authToken: 'secret' }, {}, 'https://x');
  const params = { CallSid: 'CA1', Digits: '1' };
  const sig = twilioSignature('secret', 'https://x/ivr/twilio/voice', params);
  assert.equal(t.validSignature('https://x/ivr/twilio/voice', params, sig), true);
  assert.equal(t.validSignature('https://x/ivr/twilio/voice', { ...params, Digits: '2' }, sig), false);
  assert.equal(t.validSignature('https://x/ivr/twilio/voice', params, undefined), false);
});

test('Tranzila: parses key=value responses and maps the Response code', async () => {
  assert.deepEqual(parseTranzilaResponse('Response=000&ConfirmationCode=0123456&index=5'), {
    Response: '000',
    ConfirmationCode: '0123456',
    index: '5',
  });
  let sentBody;
  const ok = createTranzilaPayments({ supplier: 's', password: 'p' }, async (url, init) => {
    sentBody = new URLSearchParams(init.body);
    return { status: 200, text: async () => 'Response=000\nConfirmationCode=0123456' };
  });
  const card = { number: '4580000000000000', expiry: '1230', id: '000000018', cvv: '123' };
  assert.deepEqual(await ok.charge({ amountAgorot: 2550, card }), { approved: true, responseCode: '000', confirmation: '0123456' });
  assert.equal(sentBody.get('sum'), '25.50');
  assert.equal(sentBody.get('currency'), '1');

  const declined = createTranzilaPayments({ supplier: 's', password: 'p' }, async () => ({
    status: 200,
    text: async () => 'Response=004',
  }));
  assert.equal((await declined.charge({ amountAgorot: 100, card })).approved, false);
});
