// Adapter for "Yemot HaMashiach" (ימות המשיח) IVR - call2all.co.il.
//
// Inbound / answered calls: an extension of type "api" whose api_link points at
//   {PUBLIC_URL}/ivr/yemot/{IVR_TOKEN}
// Yemot calls that link on every step and passes back every value collected so far.
// We answer with Yemot's text commands (read= / id_list_message= / go_to_folder=).
//
// Outbound: the RunCampaign API dials a list of numbers using a campaign template
// configured in the Yemot dashboard, which sends answering parents into the api extension.
// See README for the exact setup, and verify parameter names against Yemot's current API docs.

const API_BASE = 'https://www.call2all.co.il/ym/api';

// Characters with a special meaning in Yemot command strings can't appear inside TTS text.
function cleanText(text) {
  return String(text).replace(/[.,\-"'&=:;\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderYemotMessage(parts) {
  return parts
    .map((p) => {
      if (p.number !== undefined) return `n-${p.number}`;
      if (p.digits !== undefined) return p.digits ? `d-${p.digits}` : null;
      const t = cleanText(p.text);
      return t ? `t-${t}` : null;
    })
    .filter(Boolean)
    .join('.');
}

export function renderYemotResponse(res, varName) {
  const msg = renderYemotMessage(res.say);
  if (res.hangup) return `id_list_message=${msg}&go_to_folder=hangup`;
  const { max, min, timeout } = res.gather;
  // read=MESSAGE=VAR,use_existing,max_digits,min_digits,timeout,playback,block_asterisk,block_zero
  return `read=${msg}=${varName},no,${max},${min},${timeout},No,yes,no`;
}

export function createYemot(config, ivr, fetchImpl = fetch) {
  // Per call: how many questions we asked, so each answer gets a fresh variable name.
  const counters = new Map();

  return {
    name: 'yemot',

    // params: the query/body parameters of Yemot's request.
    async handleRequest(params) {
      const callId = params.ApiCallId;
      if (!callId) return 'go_to_folder=hangup';
      if (params.hangup === 'yes') {
        counters.delete(callId);
        ivr.hangup(callId);
        return '';
      }
      const n = counters.get(callId) || 0;
      const input = n > 0 ? params[`k${n}`] : undefined;
      const res = await ivr.handle(callId, {
        phone: params.ApiPhone,
        input,
        provider: 'yemot',
        direction: params.ApiCallType === 'out' ? 'outbound' : 'inbound',
      });
      if (res.hangup) {
        counters.delete(callId);
        return renderYemotResponse(res);
      }
      counters.set(callId, n + 1);
      return renderYemotResponse(res, `k${n + 1}`);
    },

    async dial(phones) {
      const { number, password, templateId, callerId } = config;
      if (!number || !password || !templateId) {
        return { ok: false, error: 'חסרים פרטי ימות המשיח (YEMOT_NUMBER / YEMOT_PASSWORD / YEMOT_TEMPLATE_ID)' };
      }
      const qs = new URLSearchParams({
        token: `${number}:${password}`,
        templateId,
        phones: phones.join(','),
      });
      if (callerId) qs.set('callerId', callerId);
      try {
        const res = await fetchImpl(`${API_BASE}/RunCampaign?${qs}`, { signal: AbortSignal.timeout(30000) });
        const data = await res.json().catch(() => ({}));
        if (data.responseStatus !== 'OK') {
          return { ok: false, error: data.message || `Yemot error (HTTP ${res.status})` };
        }
        return { ok: true, ref: data.campaignId ? String(data.campaignId) : null };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}
