// Tranzila direct (server-to-server) charge.
// Card details collected over the phone are sent straight to Tranzila and never stored.
// Note: this puts the server in PCI-DSS scope - see README.

const ENDPOINT = 'https://secure5.tranzila.com/cgi-bin/tranzila31.cgi';

// Tranzila answers with key=value pairs separated by '&' or newlines - not JSON.
export function parseTranzilaResponse(text) {
  const out = {};
  for (const pair of String(text).trim().split(/[&\n]/)) {
    const i = pair.indexOf('=');
    if (i > 0) out[decodeURIComponent(pair.slice(0, i).trim())] = decodeURIComponent(pair.slice(i + 1).trim().replace(/\+/g, ' '));
  }
  return out;
}

export function createTranzilaPayments({ supplier, password }, fetchImpl = fetch) {
  if (!supplier || !password) throw new Error('TRANZILA_SUPPLIER / TRANZILA_PASSWORD are required');
  return {
    name: 'tranzila',
    async charge({ amountAgorot, card, description }) {
      const body = new URLSearchParams({
        supplier,
        TranzilaPW: password,
        sum: (amountAgorot / 100).toFixed(2),
        currency: '1', // ILS
        cred_type: '1', // regular credit
        tranmode: 'A',
        ccno: card.number,
        expdate: card.expiry, // MMYY
        mycvv: card.cvv,
        myid: card.id,
        pdesc: description || '',
      });
      let res;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(30000),
        });
      } catch (err) {
        return { approved: false, responseCode: 'NETWORK', message: err.message };
      }
      // HTTP 200 does not mean approved - the Response field decides.
      const data = parseTranzilaResponse(await res.text());
      const code = data.Response ?? '';
      if (code === '000') {
        return { approved: true, responseCode: code, confirmation: data.ConfirmationCode || data.index || '' };
      }
      return { approved: false, responseCode: code || `HTTP${res.status}`, message: data.error_msg || '' };
    },
  };
}
