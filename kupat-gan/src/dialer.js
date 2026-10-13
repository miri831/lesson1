// Periodically calls families that still owe money, within allowed calling hours.

import { callingStatus } from './schedule.js';

export function createDialer({ db, phone, callingConfig, now = () => new Date(), log = console }) {
  let running = false;

  async function dialCharges(rows, at) {
    // One call per family: twins / siblings sharing a parent phone are covered by the same call.
    const families = new Map();
    for (const row of rows) {
      if (!families.has(row.phone1)) families.set(row.phone1, []);
      families.get(row.phone1).push(row);
    }
    // Primary number first, then alternate with the second parent's number.
    const byPhone = new Map();
    for (const [phone1, members] of families) {
      const attempts = Math.min(...members.map((r) => r.attempts));
      const alt = members.find((r) => r.phone2)?.phone2;
      const target = alt && attempts % 2 === 1 ? alt : phone1;
      if (!byPhone.has(target)) byPhone.set(target, []);
      byPhone.get(target).push(...members.map((r) => r.id));
    }
    const phones = [...byPhone.keys()];
    if (!phones.length) return { dialed: 0 };
    const result = await phone.dial(phones);
    if (!result.ok) {
      log.error?.(`[dialer] dial failed: ${result.error}`);
      return { dialed: 0, error: result.error };
    }
    db.markCalled([...byPhone.values()].flat(), at);
    for (const p of phones) {
      db.logCall({ provider: phone.name, direction: 'outbound', phone: p, callRef: result.ref ?? null, result: 'dialed' });
    }
    return { dialed: phones.length };
  }

  async function tick() {
    if (running) return { skipped: 'busy' };
    running = true;
    try {
      const at = now();
      const status = callingStatus(at, callingConfig);
      if (!status.allowed) return { skipped: status.reason };
      return await dialCharges(db.chargesDueForCall(at), at);
    } finally {
      running = false;
    }
  }

  // Organizer pressed "call now" for one family. Still respects Shabbat / night hours.
  async function callNow(chargeId) {
    const at = now();
    const status = callingStatus(at, callingConfig);
    if (!status.allowed) return { dialed: 0, error: `לא ניתן לחייג כעת: ${status.reason}` };
    const row = db.raw
      .prepare(
        `SELECT ch.id, ch.attempts, c.phone1, c.phone2 FROM charges ch
         JOIN children c ON c.id = ch.child_id WHERE ch.id = ? AND ch.status = 'pending'`,
      )
      .get(chargeId);
    if (!row) return { dialed: 0, error: 'אין חוב פתוח לילד זה' };
    return dialCharges([row], at);
  }

  function start(intervalSeconds) {
    const timer = setInterval(() => tick().catch((err) => log.error?.('[dialer]', err)), intervalSeconds * 1000);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { tick, callNow, start, status: () => callingStatus(now(), callingConfig) };
}
