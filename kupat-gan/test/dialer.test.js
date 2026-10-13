import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialer } from '../src/dialer.js';
import { seed, callingConfig, quietLog } from './helpers.js';

function setup(startAt = '2026-10-13T10:00:00+03:00') {
  const s = seed();
  let current = new Date(startAt);
  const dialed = [];
  const phone = {
    name: 'test',
    async dial(phones) {
      dialed.push([...phones].sort());
      return { ok: true };
    },
  };
  const dialer = createDialer({ db: s.db, phone, callingConfig, now: () => current, log: quietLog });
  return { ...s, dialer, dialed, advance: (h) => (current = new Date(current.getTime() + h * 3600e3)) };
}

test('calls each family once - twins share a call', async () => {
  const { dialer, dialed } = setup();
  const r = await dialer.tick();
  assert.equal(r.dialed, 2);
  assert.deepEqual(dialed[0], ['0527654321', '0548888888']);
});

test('waits retry_hours between attempts, alternates to the second phone, and stops at max attempts', async () => {
  const { dialer, dialed, advance } = setup();
  await dialer.tick();
  assert.equal((await dialer.tick()).dialed, 0); // too soon
  advance(24);
  await dialer.tick();
  assert.ok(dialed[1].includes('0501234567')); // second parent's phone on attempt 2
  advance(24);
  await dialer.tick();
  advance(24);
  assert.equal((await dialer.tick()).dialed, 0); // 3 attempts used up
});

test('does not call on Shabbat', async () => {
  const { dialer, dialed } = setup('2026-10-17T11:00:00+03:00');
  const r = await dialer.tick();
  assert.equal(r.skipped, 'שבת קודש');
  assert.equal(dialed.length, 0);
});

test('skips paid, exempt and paused', async () => {
  const { db, collection, dialer, children } = setup();
  const charges = db.listCharges(collection.id);
  db.setChargeStatus(charges.find((c) => c.child_id === children.sara).id, 'exempt');
  db.setChargeStatus(charges.find((c) => c.child_id === children.moshe).id, 'cash');
  db.setChargeStatus(charges.find((c) => c.child_id === children.yosef).id, 'cash');
  assert.equal((await dialer.tick()).dialed, 0);

  db.setChargeStatus(charges.find((c) => c.child_id === children.sara).id, 'pending');
  db.updateCollection(collection.id, { status: 'paused' });
  assert.equal((await dialer.tick()).dialed, 0);
});

test('a parent who asked to be called later is skipped until then', async () => {
  const { db, dialer, advance } = setup();
  db.snoozePhone('0548888888', new Date('2026-10-14T09:00:00+03:00'));
  assert.equal((await dialer.tick()).dialed, 1);
  advance(24);
  assert.equal((await dialer.tick()).dialed, 2);
});
