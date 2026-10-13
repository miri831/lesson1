// Israeli phone numbers: normalize to local format (e.g. 0527654321).

const VALID = /^0(?:5\d{8}|7\d{8}|[23489]\d{7})$/;

export function normalizePhone(input) {
  if (input == null) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00972')) digits = digits.slice(5);
  else if (digits.startsWith('972')) digits = digits.slice(3);
  // Spreadsheets often drop the leading zero (527654321).
  if (!digits.startsWith('0')) digits = '0' + digits;
  return VALID.test(digits) ? digits : null;
}

export function looksLikePhone(input) {
  return normalizePhone(input) !== null;
}

// 0527654321 -> 972527654321 (international, for providers that need it)
export function toInternational(phone) {
  return '972' + phone.slice(1);
}

export function formatPhone(phone) {
  if (!phone) return '';
  return phone.length === 10
    ? `${phone.slice(0, 3)}-${phone.slice(3)}`
    : `${phone.slice(0, 2)}-${phone.slice(2)}`;
}
