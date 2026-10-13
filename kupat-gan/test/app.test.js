import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { quietLog } from './helpers.js';

let server;
let base;
let cookie = '';

const config = {
  publicUrl: 'http://localhost',
  adminPassword: 'secret-pw',
  appSecret: 'test-secret',
  appSecretIsEphemeral: false,
  calling: { start: '00:00', end: '23:59', erevCutoff: '23:59', blockedDates: [] },
  phoneProvider: 'mock',
  paymentProvider: 'mock',
};

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  const app = createApp({ config, db: openDb(':memory:'), log: quietLog });
  server = createServer(app.handle);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('API requires login', async () => {
  assert.equal((await call('GET', '/api/groups')).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'wrong' })).status, 401);
  const ok = await call('POST', '/api/login', { password: 'secret-pw' });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/groups')).status, 200);
});

test('full organizer flow: group, import, collection, simulated parent payment, export', async () => {
  const group = (await call('POST', '/api/groups', { name: 'גן חבצלת', teacherName: 'לאה' })).data;

  const preview = await call('POST', `/api/groups/${group.id}/import`, {
    text: 'משה, אבא, 0527654321\nרחל, 0548888888\nשגוי',
    dryRun: true,
  });
  assert.equal(preview.data.rows.length, 2);
  assert.equal(preview.data.errors.length, 1);
  assert.equal((await call('GET', `/api/groups/${group.id}/children`)).data.length, 0);

  await call('POST', `/api/groups/${group.id}/import`, { text: 'משה, אבא, 0527654321\nרחל, 0548888888' });
  assert.equal((await call('GET', `/api/groups/${group.id}/children`)).data.length, 2);

  const col = (await call('POST', `/api/groups/${group.id}/collections`, { title: 'מתנת סוף שנה', amount: '30' })).data;
  assert.equal(col.amount_agorot, 3000);
  assert.equal(col.status, 'draft');
  assert.equal(col.pending, 2);
  await call('PUT', `/api/collections/${col.id}`, { status: 'active' });

  // The parent "calls" via the simulator.
  const sim = (input) => call('POST', '/api/simulator', { callId: 'x1', phone: '0527654321', input });
  await sim();
  for (const d of ['1', '4580000000000000', '1230', '000000018', '123']) await sim(d);
  const done = await sim('1');
  assert.equal(done.data.hangup, true);

  const charges = (await call('GET', `/api/collections/${col.id}/charges`)).data;
  assert.equal(charges.find((c) => c.child_name === 'משה').status, 'paid');

  // Organizer marks the other family as paid in cash.
  const rachel = charges.find((c) => c.child_name === 'רחל');
  await call('POST', `/api/charges/${rachel.id}/status`, { status: 'cash' });
  const summary = (await call('GET', `/api/collections/${col.id}`)).data;
  assert.equal(summary.paid_card, 1);
  assert.equal(summary.paid_cash, 1);

  // Card payments can't be overridden manually, and the collection can't be deleted.
  const moshe = charges.find((c) => c.child_name === 'משה');
  assert.equal((await call('POST', `/api/charges/${moshe.id}/status`, { status: 'pending' })).status, 409);
  assert.equal((await call('DELETE', `/api/collections/${col.id}`)).status, 409);

  const csv = await call('GET', `/api/collections/${col.id}/export.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /משה,אבא,0527654321,,שולם באשראי/);
});

test('validation errors are returned in Hebrew', async () => {
  const r = await call('POST', '/api/groups/1/children', { name: 'דוד', phone1: '123' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'מספר טלפון ראשי לא תקין');
});

test('non-JSON posts are rejected (CSRF protection)', async () => {
  const res = await fetch(base + '/api/groups', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=x',
  });
  assert.equal(res.status, 415);
});

test('telephony webhooks of inactive providers are not exposed', async () => {
  assert.equal((await call('POST', '/ivr/twilio/voice', {})).status, 404);
});

test('admin UI is served', async () => {
  const r = await call('GET', '/');
  assert.match(r.data, /קופת גן/);
});
