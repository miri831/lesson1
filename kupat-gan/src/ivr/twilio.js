// Adapter for Twilio Programmable Voice (alternative to Yemot).
// Voice webhook: {PUBLIC_URL}/ivr/twilio/voice   Status callback: {PUBLIC_URL}/ivr/twilio/status

import { createHmac, timingSafeEqual } from 'node:crypto';
import { toInternational, normalizePhone } from '../phone.js';

function xml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function partsToSpeech(parts) {
  return parts
    .map((p) => {
      if (p.number !== undefined) return String(p.number);
      if (p.digits !== undefined) return p.digits.split('').join(' ');
      return p.text;
    })
    .filter(Boolean)
    .join(' ');
}

export function renderTwiml(res, actionUrl) {
  const say = `<Say language="he-IL" voice="Google.he-IL-Standard-A">${xml(partsToSpeech(res.say))}</Say>`;
  if (res.hangup) return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
  const { max, min, timeout } = res.gather;
  const numDigits = max === min ? ` numDigits="${max}"` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Gather input="dtmf"${numDigits} finishOnKey="#" timeout="${timeout}" action="${xml(actionUrl)}" method="POST">${say}</Gather>` +
    // No input: come back with empty Digits so the flow can repeat the question.
    `<Redirect method="POST">${xml(actionUrl)}</Redirect>` +
    '</Response>'
  );
}

// https://www.twilio.com/docs/usage/security#validating-requests
export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function createTwilio(config, ivr, publicUrl, fetchImpl = fetch) {
  const voiceUrl = `${publicUrl}/ivr/twilio/voice`;

  return {
    name: 'twilio',

    validSignature(fullUrl, params, signature) {
      if (!config.authToken || !signature) return false;
      const expected = Buffer.from(twilioSignature(config.authToken, fullUrl, params));
      const got = Buffer.from(signature);
      return expected.length === got.length && timingSafeEqual(expected, got);
    },

    async handleVoice(params) {
      const outbound = String(params.Direction || '').startsWith('outbound');
      const phone = normalizePhone(outbound ? params.To : params.From);
      // Twilio sends no Digits on the very first request and on timeouts.
      const res = await ivr.handle(params.CallSid, {
        phone,
        input: params.Digits ?? '',
        provider: 'twilio',
        direction: outbound ? 'outbound' : 'inbound',
      });
      return renderTwiml(res, voiceUrl);
    },

    handleStatus(params) {
      if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(params.CallStatus)) {
        ivr.hangup(params.CallSid);
      }
    },

    async dial(phones) {
      const { accountSid, authToken, from } = config;
      if (!accountSid || !authToken || !from) {
        return { ok: false, error: 'חסרים פרטי Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)' };
      }
      const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const errors = [];
      for (const phone of phones) {
        const body = new URLSearchParams({
          To: '+' + toInternational(phone),
          From: from,
          Url: voiceUrl,
          Method: 'POST',
          StatusCallback: `${publicUrl}/ivr/twilio/status`,
          StatusCallbackMethod: 'POST',
        });
        try {
          const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) errors.push(`${phone}: HTTP ${res.status}`);
        } catch (err) {
          errors.push(`${phone}: ${err.message}`);
        }
      }
      return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true };
    },
  };
}
