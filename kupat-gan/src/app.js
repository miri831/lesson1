import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HttpError, readBody, send, parseCookies, createRouter, serveStatic } from './http.js';
import { normalizePhone } from './phone.js';
import { parseChildrenList } from './importer.js';
import { createIvr } from './ivr/flow.js';
import { createYemot } from './ivr/yemot.js';
import { createTwilio } from './ivr/twilio.js';
import { createMockPhone } from './ivr/mock.js';
import { createDialer } from './dialer.js';
import { createPayments } from './payments/index.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_DAYS = 14;
const CHARGE_STATUSES = ['pending', 'paid', 'cash', 'exempt', 'claimed_cash'];
const COLLECTION_STATUSES = ['draft', 'active', 'paused', 'closed'];

function sign(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function id(params) {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'מזהה לא תקין');
  return n;
}

function requireText(value, label) {
  const s = String(value ?? '').trim();
  if (!s) throw new HttpError(400, `חסר ${label}`);
  if (s.length > 200) throw new HttpError(400, `${label} ארוך מדי`);
  return s;
}

function toAgorot(shekels) {
  const n = Number(shekels);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) throw new HttpError(400, 'סכום לא תקין');
  return Math.round(n * 100);
}

function intInRange(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} לא תקין`);
  return n;
}

function childInput(body) {
  const phone1 = normalizePhone(body.phone1);
  if (!phone1) throw new HttpError(400, 'מספר טלפון ראשי לא תקין');
  let phone2 = null;
  if (body.phone2) {
    phone2 = normalizePhone(body.phone2);
    if (!phone2) throw new HttpError(400, 'מספר טלפון נוסף לא תקין');
  }
  return {
    name: requireText(body.name, 'שם הילד'),
    parentName: String(body.parentName ?? '').trim().slice(0, 200),
    phone1,
    phone2: phone2 === phone1 ? null : phone2,
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_LABELS = {
  pending: 'טרם שולם',
  paid: 'שולם באשראי',
  cash: 'שולם במזומן',
  exempt: 'פטור',
  claimed_cash: 'דיווח על מזומן - לאימות',
};

export function createApp({ config, db, now = () => new Date(), log = console, phone, payments }) {
  payments ??= createPayments(config);
  const ivr = createIvr({ db, payments, now });

  if (!phone) {
    if (config.phoneProvider === 'yemot') phone = createYemot(config.yemot, ivr);
    else if (config.phoneProvider === 'twilio') phone = createTwilio(config.twilio, ivr, config.publicUrl);
    else if (config.phoneProvider === 'mock') phone = createMockPhone();
    else throw new Error(`Unknown PHONE_PROVIDER: ${config.phoneProvider}`);
  }

  const dialer = createDialer({ db, phone, callingConfig: config.calling, now, log });
  const ivrToken = sign(config.appSecret, 'ivr-path').slice(0, 24);
  const cookieSecure = config.publicUrl.startsWith('https://');
  const loginFailures = new Map(); // ip -> { count, until }

  // ---- auth ----
  function sessionCookie() {
    const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
    const value = `${expires}.${sign(config.appSecret, `session.${expires}`)}`;
    return `kg_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${cookieSecure ? '; Secure' : ''}`;
  }

  function isLoggedIn(req) {
    const value = parseCookies(req).kg_session;
    if (!value) return false;
    const [expires, mac] = value.split('.');
    return Number(expires) > Date.now() && safeEqual(mac, sign(config.appSecret, `session.${expires}`));
  }

  const router = createRouter();
  const api = (method, path, handler) => router.add(method, path, handler);

  api('POST', '/api/login', async ({ req, body }) => {
    const ip = req.socket.remoteAddress;
    const f = loginFailures.get(ip);
    if (f && f.until > Date.now()) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות');
    if (!config.adminPassword) throw new HttpError(503, 'לא הוגדרה סיסמת ניהול (ADMIN_PASSWORD)');
    if (!safeEqual(body.password ?? '', config.adminPassword)) {
      const count = (f?.count || 0) + 1;
      loginFailures.set(ip, { count, until: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      throw new HttpError(401, 'סיסמה שגויה');
    }
    loginFailures.delete(ip);
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': sessionCookie() } };
  });

  api('POST', '/api/logout', async () => ({
    status: 200,
    body: { ok: true },
    headers: { 'Set-Cookie': 'kg_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' },
  }));

  // ---- status ----
  api('GET', '/api/status', async () => ({
    phoneProvider: phone.name,
    paymentProvider: payments.name,
    calling: dialer.status(),
    callingHours: config.calling,
    ephemeralSecret: config.appSecretIsEphemeral,
    simulatorEnabled: payments.name === 'mock',
    ivrUrls: {
      yemot: `${config.publicUrl}/ivr/yemot/${ivrToken}`,
      twilioVoice: `${config.publicUrl}/ivr/twilio/voice`,
      twilioStatus: `${config.publicUrl}/ivr/twilio/status`,
    },
  }));

  // ---- groups ----
  api('GET', '/api/groups', async () => db.listGroups());
  api('POST', '/api/groups', async ({ body }) =>
    db.createGroup({ name: requireText(body.name, 'שם הגן'), teacherName: String(body.teacherName ?? '').trim() }),
  );
  api('GET', '/api/groups/:id', async ({ params }) => {
    const g = db.getGroup(id(params));
    if (!g) throw new HttpError(404, 'הגן לא נמצא');
    return g;
  });
  api('PUT', '/api/groups/:id', async ({ params, body }) =>
    db.updateGroup(id(params), { name: requireText(body.name, 'שם הגן'), teacherName: String(body.teacherName ?? '').trim() }),
  );
  api('DELETE', '/api/groups/:id', async ({ params }) => {
    db.deleteGroup(id(params));
    return { ok: true };
  });

  // ---- children ----
  api('GET', '/api/groups/:id/children', async ({ params }) => db.listChildren(id(params)));
  api('POST', '/api/groups/:id/children', async ({ params, body }) => {
    const [childId] = db.addChildren(id(params), [childInput(body)]);
    return db.getChild(childId);
  });
  api('POST', '/api/groups/:id/import', async ({ params, body }) => {
    const groupId = id(params);
    const { rows, errors } = parseChildrenList(body.text);
    if (body.dryRun) return { rows, errors };
    const ids = db.addChildren(groupId, rows);
    return { imported: ids.length, errors };
  });
  api('PUT', '/api/children/:id', async ({ params, body }) => db.updateChild(id(params), childInput(body)));
  api('DELETE', '/api/children/:id', async ({ params }) => {
    db.deleteChild(id(params));
    return { ok: true };
  });

  // ---- collections ----
  api('GET', '/api/groups/:id/collections', async ({ params }) => db.listCollections(id(params)));
  api('POST', '/api/groups/:id/collections', async ({ params, body }) =>
    db.createCollection(id(params), {
      title: requireText(body.title, 'שם הגבייה'),
      amountAgorot: toAgorot(body.amount),
      maxAttempts: intInRange(body.maxAttempts ?? 3, 1, 10, 'מספר ניסיונות'),
      retryHours: intInRange(body.retryHours ?? 24, 1, 168, 'מרווח בין ניסיונות'),
      dueDate: body.dueDate || null,
    }),
  );
  api('GET', '/api/collections/:id', async ({ params }) => {
    const c = db.getCollection(id(params));
    if (!c) throw new HttpError(404, 'הגבייה לא נמצאה');
    return c;
  });
  api('PUT', '/api/collections/:id', async ({ params, body }) => {
    const fields = {};
    if (body.title !== undefined) fields.title = requireText(body.title, 'שם הגבייה');
    if (body.amount !== undefined) fields.amountAgorot = toAgorot(body.amount);
    if (body.maxAttempts !== undefined) fields.maxAttempts = intInRange(body.maxAttempts, 1, 10, 'מספר ניסיונות');
    if (body.retryHours !== undefined) fields.retryHours = intInRange(body.retryHours, 1, 168, 'מרווח בין ניסיונות');
    if (body.dueDate !== undefined) fields.dueDate = body.dueDate || null;
    if (body.status !== undefined) {
      if (!COLLECTION_STATUSES.includes(body.status)) throw new HttpError(400, 'סטטוס לא תקין');
      fields.status = body.status;
    }
    return db.updateCollection(id(params), fields);
  });
  api('DELETE', '/api/collections/:id', async ({ params }) => {
    const c = db.getCollection(id(params));
    if (c && (c.paid_card > 0 || c.paid_cash > 0)) {
      throw new HttpError(409, 'לא ניתן למחוק גבייה שכבר התקבלו בה תשלומים. אפשר לסגור אותה');
    }
    db.deleteCollection(id(params));
    return { ok: true };
  });

  api('GET', '/api/collections/:id/charges', async ({ params }) => db.listCharges(id(params)));

  api('GET', '/api/collections/:id/export.csv', async ({ params }) => {
    const c = db.getCollection(id(params));
    if (!c) throw new HttpError(404, 'הגבייה לא נמצאה');
    const lines = [['שם הילד', 'שם ההורה', 'טלפון', 'טלפון נוסף', 'סטטוס', 'מספר אישור', 'ספרות אחרונות', 'ניסיונות חיוג']];
    for (const ch of db.listCharges(c.id)) {
      lines.push([
        ch.child_name,
        ch.parent_name,
        ch.phone1,
        ch.phone2,
        STATUS_LABELS[ch.status],
        ch.confirmation,
        ch.card_last4,
        ch.attempts,
      ]);
    }
    const csv = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
    return {
      status: 200,
      raw: csv,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="collection-${c.id}.csv"`,
      },
    };
  });

  // ---- charges ----
  api('POST', '/api/charges/:id/status', async ({ params, body }) => {
    if (!CHARGE_STATUSES.includes(body.status) || body.status === 'paid') {
      throw new HttpError(400, 'סטטוס לא תקין');
    }
    const ch = db.getCharge(id(params));
    if (!ch) throw new HttpError(404, 'לא נמצא');
    if (ch.status === 'paid') throw new HttpError(409, 'התשלום בוצע באשראי. ביטול עסקה נעשה מול חברת הסליקה');
    return db.setChargeStatus(ch.id, body.status);
  });
  api('POST', '/api/charges/:id/reset', async ({ params }) => db.resetChargeAttempts(id(params)));
  api('POST', '/api/charges/:id/call', async ({ params }) => dialer.callNow(id(params)));

  // ---- dialer / logs ----
  api('POST', '/api/dialer/run', async () => dialer.tick());
  api('GET', '/api/calls', async () => db.listCalls());
  api('GET', '/api/payments', async () => db.listPayments());

  // ---- phone simulator (only with the test payment processor) ----
  api('POST', '/api/simulator', async ({ body }) => {
    if (payments.name !== 'mock') throw new HttpError(403, 'הסימולטור זמין רק במצב סליקת בדיקה');
    const callId = `sim-${String(body.callId || '').slice(0, 40)}`;
    if (body.hangup) {
      ivr.hangup(callId);
      return { ok: true };
    }
    return ivr.handle(callId, { phone: body.phone, input: body.input, provider: 'simulator', direction: 'inbound' });
  });

  // ---- telephony webhooks ----
  async function handleYemot(url, body) {
    const params = { ...Object.fromEntries(url.searchParams), ...(body.raw ? {} : body) };
    const text = await phone.handleRequest(params);
    return { status: 200, raw: text, headers: { 'Content-Type': 'text/plain; charset=utf-8' } };
  }

  async function handleTwilio(req, url, body, which) {
    const fullUrl = config.publicUrl + url.pathname + url.search;
    if (!phone.validSignature(fullUrl, body, req.headers['x-twilio-signature'])) {
      throw new HttpError(403, 'Invalid signature');
    }
    if (which === 'status') {
      phone.handleStatus(body);
      return { status: 204, raw: '' };
    }
    const twiml = await phone.handleVoice(body);
    return { status: 200, raw: twiml, headers: { 'Content-Type': 'text/xml; charset=utf-8' } };
  }

  // ---- request entry point ----
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      let result;
      if (path === `/ivr/yemot/${ivrToken}` && (req.method === 'GET' || req.method === 'POST')) {
        if (phone.name !== 'yemot') throw new HttpError(404, 'Not found');
        result = await handleYemot(url, req.method === 'POST' ? await readBody(req) : {});
      } else if ((path === '/ivr/twilio/voice' || path === '/ivr/twilio/status') && req.method === 'POST') {
        if (phone.name !== 'twilio') throw new HttpError(404, 'Not found');
        result = await handleTwilio(req, url, await readBody(req), path.endsWith('status') ? 'status' : 'voice');
      } else if (path.startsWith('/api/')) {
        const match = router.match(req.method, path);
        if (!match) throw new HttpError(404, 'לא נמצא');
        if (path !== '/api/login' && !isLoggedIn(req)) throw new HttpError(401, 'נדרשת התחברות');
        if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) {
          // JSON-only API: blocks cross-site form posts (on top of the SameSite cookie).
          throw new HttpError(415, 'נדרש JSON');
        }
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = await match.handler({ req, params: match.params, body, url });
        result = out && out.status && (out.body !== undefined || out.raw !== undefined) ? out : { status: 200, body: out };
      } else if (req.method === 'GET' && (await serveStatic(res, PUBLIC_DIR, path))) {
        return;
      } else {
        throw new HttpError(404, 'לא נמצא');
      }
      send(res, result.status, result.raw ?? result.body, result.headers);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) log.error?.('[http]', req.method, path, err);
      send(res, status, { error: status === 500 ? 'שגיאת שרת' : err.message });
    }
  }

  return { handle, dialer, ivr, ivrToken };
}
