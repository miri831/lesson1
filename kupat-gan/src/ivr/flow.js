// The phone conversation with a parent, independent of the telephony provider.
//
// Each step returns { say: Part[], gather?: { max, min, timeout }, hangup?: true }
// where a Part is { text } | { digits } | { number }.
// Provider adapters (yemot.js, twilio.js, the web simulator) render this into
// their own format and feed the keypad input back into handle().
//
// Card details live only in this in-memory session and are wiped right after
// the charge attempt. They are never written to the database or logs.

import { normalizePhone } from '../phone.js';
import { validCardNumber, validExpiry, validIsraeliId } from '../payments/card.js';

const SESSION_TTL_MS = 20 * 60 * 1000;
const MAX_ERRORS = 3;
const SNOOZE_HOURS = 20;

function shekels(agorot) {
  const parts = [{ number: Math.floor(agorot / 100) }, { text: 'שקלים' }];
  if (agorot % 100) parts.push({ text: 'ו' }, { number: agorot % 100 }, { text: 'אגורות' });
  return parts;
}

export function createIvr({ db, payments, now = () => new Date() }) {
  const sessions = new Map();

  function cleanup() {
    const limit = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of sessions) if (s.touched < limit) sessions.delete(id);
  }
  const timer = setInterval(cleanup, 60 * 1000);
  timer.unref();

  function ask(say, max, min = max, timeout = 7) {
    return { say, gather: { max, min, timeout } };
  }
  function bye(say) {
    return { say, hangup: true };
  }

  function loadDebts(s) {
    s.charges = db.openChargesForPhone(s.phone);
    s.total = s.charges.reduce((sum, c) => sum + c.amount_agorot, 0);
  }

  function failOrRetry(s, prompt) {
    s.errors++;
    if (s.errors >= MAX_ERRORS) {
      s.card = null;
      return bye([{ text: 'מצטערים, לא הצלחנו לקלוט את הנתונים. נסו שוב מאוחר יותר. שלום' }]);
    }
    return prompt(s, true);
  }

  // ---- prompts ----
  const prompts = {
    askPhone: (s, retry) =>
      ask(
        [
          { text: retry ? 'המספר אינו רשום במערכת.' : 'שלום. מספר הטלפון שממנו התקשרתם אינו רשום במערכת.' },
          { text: 'נא הקישו את מספר הטלפון של ההורה כפי שנמסר לגן' },
        ],
        10,
        9,
      ),

    menu: (s) => {
      const say = [{ text: 'שלום. כאן מערכת הגבייה של ועד ההורים.' }];
      for (const c of s.charges) {
        say.push({ text: `${c.title} עבור ${c.child_name}:` }, ...shekels(c.amount_agorot));
      }
      if (s.charges.length > 1) say.push({ text: 'סך הכל לתשלום:' }, ...shekels(s.total));
      say.push(
        { text: 'לתשלום בכרטיס אשראי הקישו 1.' },
        { text: 'אם כבר שילמתם במזומן הקישו 2.' },
        { text: 'לשמיעה חוזרת הקישו 3.' },
        { text: 'אם אינכם יכולים כעת ותרצו שנחזור אליכם בפעם אחרת הקישו 0.' },
      );
      return ask(say, 1);
    },

    cardNumber: (s, retry) =>
      ask([{ text: retry ? 'מספר הכרטיס שגוי.' : '' }, { text: 'נא הקישו את מספר כרטיס האשראי ובסיומו סולמית' }].filter((p) => p.text), 19, 8, 15),

    expiry: (s, retry) =>
      ask([{ text: retry ? 'התוקף שגוי.' : '' }, { text: 'נא הקישו את תוקף הכרטיס: ארבע ספרות, חודש ושנה' }].filter((p) => p.text), 4),

    id: (s, retry) =>
      ask([{ text: retry ? 'מספר תעודת הזהות שגוי.' : '' }, { text: 'נא הקישו את מספר תעודת הזהות של בעל הכרטיס ובסיומו סולמית' }].filter((p) => p.text), 9, 5, 12),

    cvv: (s, retry) =>
      ask([{ text: retry ? 'הקוד שגוי.' : '' }, { text: 'נא הקישו את שלוש הספרות בגב הכרטיס' }].filter((p) => p.text), 4, 3),

    confirm: (s) =>
      ask(
        [
          { text: 'לאישור חיוב של' },
          ...shekels(s.total),
          { text: 'בכרטיס המסתיים בספרות' },
          { digits: s.card.number.slice(-4) },
          { text: 'הקישו 1. לביטול הקישו 2' },
        ],
        1,
      ),

    declined: () =>
      ask([{ text: 'העסקה לא אושרה על ידי חברת האשראי. לניסיון בכרטיס אחר הקישו 1. לסיום הקישו 2' }], 1),
  };

  function goMenu(s) {
    loadDebts(s);
    if (!s.charges.length) {
      return bye([{ text: 'שלום. לא נמצאו תשלומים פתוחים עבורכם. תודה רבה ויום טוב' }]);
    }
    s.step = 'menu';
    s.errors = 0;
    return prompts.menu(s);
  }

  function to(s, step) {
    s.step = step;
    return prompts[step](s, false);
  }

  async function doCharge(s) {
    // Re-read the debts: another call (or the organizer) may have changed them meanwhile.
    const expected = s.total;
    loadDebts(s);
    if (s.total !== expected || !s.charges.length) {
      s.card = null;
      return { say: [{ text: 'הסכום לתשלום עודכן.' }], next: goMenu(s) };
    }
    const card = s.card;
    s.card = null;
    const description = s.charges.map((c) => `${c.title} - ${c.child_name}`).join(', ');
    let result;
    try {
      result = await payments.charge({ amountAgorot: s.total, card, description });
    } catch (err) {
      result = { approved: false, responseCode: 'ERROR', message: err.message };
    }
    db.recordPayment({
      phone: s.phone,
      amountAgorot: s.total,
      provider: payments.name,
      status: result.approved ? 'approved' : 'declined',
      responseCode: result.responseCode,
      confirmation: result.confirmation,
      cardLast4: card.number.slice(-4),
      chargeIds: s.charges.map((c) => c.id),
    });
    if (result.approved) {
      return bye([
        { text: 'התשלום התקבל בהצלחה. מספר האישור:' },
        { digits: result.confirmation || '' },
        { text: 'תודה רבה, ושיהיה בשעה טובה' },
      ]);
    }
    s.step = 'declined';
    return prompts.declined(s);
  }

  async function step(s, input) {
    const digits = (input || '').replace(/\D/g, '');

    switch (s.step) {
      case 'askPhone': {
        const phone = normalizePhone(digits);
        if (phone && db.isKnownPhone(phone)) {
          s.phone = phone;
          return goMenu(s);
        }
        return failOrRetry(s, prompts.askPhone);
      }

      case 'menu':
        if (digits === '1') {
          s.card = {};
          s.errors = 0;
          return to(s, 'cardNumber');
        }
        if (digits === '2') {
          db.markClaimedCash(s.charges.map((c) => c.id));
          return bye([{ text: 'תודה. הודעה נשלחה לאחראית הגבייה לאימות התשלום במזומן. שלום' }]);
        }
        if (digits === '0') {
          db.snoozePhone(s.phone, new Date(now().getTime() + SNOOZE_HOURS * 3600 * 1000));
          return bye([{ text: 'בסדר גמור, נחזור אליכם בפעם אחרת. אפשר גם להתקשר אלינו בכל עת. שלום' }]);
        }
        if (digits === '3') return prompts.menu(s);
        return failOrRetry(s, prompts.menu);

      case 'cardNumber':
        if (!validCardNumber(digits)) return failOrRetry(s, prompts.cardNumber);
        s.card.number = digits;
        return to(s, 'expiry');

      case 'expiry':
        if (!validExpiry(digits, now())) return failOrRetry(s, prompts.expiry);
        s.card.expiry = digits;
        return to(s, 'id');

      case 'id':
        if (!validIsraeliId(digits)) return failOrRetry(s, prompts.id);
        s.card.id = digits.padStart(9, '0');
        return to(s, 'cvv');

      case 'cvv':
        if (!/^\d{3,4}$/.test(digits)) return failOrRetry(s, prompts.cvv);
        s.card.cvv = digits;
        return to(s, 'confirm');

      case 'confirm':
        if (digits === '1') {
          const r = await doCharge(s);
          if (r.next) return { ...r.next, say: [...r.say, ...r.next.say] };
          return r;
        }
        if (digits === '2') {
          s.card = null;
          return goMenu(s);
        }
        return failOrRetry(s, prompts.confirm);

      case 'declined':
        if (digits === '1') {
          s.card = {};
          s.errors = 0;
          return to(s, 'cardNumber');
        }
        return bye([{ text: 'תודה. אפשר להתקשר אלינו שוב בכל עת. שלום' }]);

      default:
        return bye([{ text: 'שלום' }]);
    }
  }

  return {
    // callId: provider's call identifier. phone: caller/callee number as reported by the provider.
    // input: keypad digits for the previous question (undefined on the first request).
    async handle(callId, { phone, input, direction = 'inbound', provider = 'unknown' } = {}) {
      let s = sessions.get(callId);
      if (!s) {
        s = { step: null, phone: normalizePhone(phone), errors: 0, card: null, touched: Date.now() };
        sessions.set(callId, s);
        db.logCall({ provider, direction, phone: s.phone || String(phone || ''), callRef: callId, result: 'answered' });
        if (s.phone && db.isKnownPhone(s.phone)) return goMenu(s);
        s.step = 'askPhone';
        return prompts.askPhone(s, false);
      }
      s.touched = Date.now();
      const res = await step(s, input);
      if (res.hangup) sessions.delete(callId);
      return res;
    },

    hangup(callId) {
      sessions.delete(callId);
    },

    activeSessions: () => sessions.size,
  };
}
