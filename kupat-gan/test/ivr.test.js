import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIvr } from '../src/ivr/flow.js';
import { createMockPayments } from '../src/payments/mock.js';
import { seed, VALID_CARD } from './helpers.js';

const now = () => new Date('2026-10-13T10:00:00+03:00');
const spoken = (res) => res.say.map((p) => p.text ?? p.number ?? p.digits).join(' ');

function setup() {
  const s = seed();
  const charges = [];
  const payments = createMockPayments();
  const recording = {
    name: 'mock',
    async charge(args) {
      charges.push(args);
      return payments.charge(args);
    },
  };
  const ivr = createIvr({ db: s.db, payments: recording, now });
  const call = (id, phone) => {
    return {
      start: () => ivr.handle(id, { phone }),
      press: (input) => ivr.handle(id, { phone, input }),
    };
  };
  return { ...s, ivr, call, charges };
}

async function payWithCard(c, card = VALID_CARD) {
  await c.press('1');
  await c.press(card.number);
  await c.press(card.expiry);
  await c.press(card.id);
  await c.press(card.cvv);
  return c.press('1');
}

test('parent of twins hears both and pays the total in one charge', async () => {
  const { db, collection, call, charges } = setup();
  const c = call('call-1', '052-7654321');
  const menu = await c.start();
  assert.match(spoken(menu), /משה/);
  assert.match(spoken(menu), /יוסף/);
  assert.match(spoken(menu), /סך הכל לתשלום/);
  assert.equal(menu.gather.max, 1);

  const done = await payWithCard(c);
  assert.equal(done.hangup, true);
  assert.match(spoken(done), /התשלום התקבל בהצלחה/);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amountAgorot, 5000);

  const rows = db.listCharges(collection.id);
  assert.deepEqual(rows.map((r) => [r.child_name, r.status]).sort(), [
    ['יוסף', 'paid'],
    ['משה', 'paid'],
    ['שרה', 'pending'],
  ]);
  assert.equal(rows.find((r) => r.child_name === 'משה').card_last4, '0000');
});

test('second parent phone works too, and paid debts are not offered again', async () => {
  const { call } = setup();
  const first = call('a', '0527654321');
  await first.start();
  await payWithCard(first);
  const again = await call('b', '0501234567').start();
  assert.equal(again.hangup, true);
  assert.match(spoken(again), /לא נמצאו תשלומים פתוחים/);
});

test('declined card offers a retry and leaves the debt open', async () => {
  const { db, collection, call } = setup();
  const c = call('call-2', '0548888888');
  await c.start();
  const res = await payWithCard(c, { ...VALID_CARD, number: '4580000000080002' });
  assert.match(spoken(res), /לא אושרה/);
  assert.equal(res.hangup, undefined);
  assert.equal(db.listCharges(collection.id).find((r) => r.child_name === 'שרה').status, 'pending');
  assert.equal(db.listPayments()[0].status, 'declined');

  // Retry with a good card.
  await c.press('1');
  await c.press(VALID_CARD.number);
  await c.press(VALID_CARD.expiry);
  await c.press(VALID_CARD.id);
  await c.press(VALID_CARD.cvv);
  const ok = await c.press('1');
  assert.match(spoken(ok), /התקבל בהצלחה/);
});

test('invalid card input is asked again, and the call ends after 3 errors', async () => {
  const { call, charges } = setup();
  const c = call('call-3', '0548888888');
  await c.start();
  await c.press('1');
  const retry = await c.press('1234567890123');
  assert.match(spoken(retry), /מספר הכרטיס שגוי/);
  await c.press('1111');
  const end = await c.press('2222');
  assert.equal(end.hangup, true);
  assert.equal(charges.length, 0);
});

test('"paid in cash" marks the debt for the organizer to verify', async () => {
  const { db, collection, call } = setup();
  const c = call('call-4', '0548888888');
  await c.start();
  const res = await c.press('2');
  assert.equal(res.hangup, true);
  assert.equal(db.listCharges(collection.id).find((r) => r.child_name === 'שרה').status, 'claimed_cash');
});

test('unknown caller is asked for the registered phone number', async () => {
  const { call } = setup();
  const c = call('call-5', '0539999999');
  const first = await c.start();
  assert.match(spoken(first), /אינו רשום/);
  assert.equal(first.gather.max, 10);
  const menu = await c.press('0548888888');
  assert.match(spoken(menu), /שרה/);
});

test('cancelling at the confirmation step returns to the menu without charging', async () => {
  const { call, charges } = setup();
  const c = call('call-6', '0548888888');
  await c.start();
  await c.press('1');
  await c.press(VALID_CARD.number);
  await c.press(VALID_CARD.expiry);
  await c.press(VALID_CARD.id);
  const confirm = await c.press(VALID_CARD.cvv);
  assert.match(spoken(confirm), /0000/);
  const menu = await c.press('2');
  assert.match(spoken(menu), /לתשלום בכרטיס אשראי/);
  assert.equal(charges.length, 0);
});

test('amounts with agorot are read correctly', async () => {
  const { db, group, call } = setup();
  const k = db.createCollection(group.id, { title: 'מתנה', amountAgorot: 1250 });
  db.updateCollection(k.id, { status: 'active' });
  const menu = await call('call-7', '0548888888').start();
  const nums = menu.say.filter((p) => p.number !== undefined).map((p) => p.number);
  assert.deepEqual(nums, [25, 12, 50, 37, 50]); // 25, 12.50, total 37.50
});
