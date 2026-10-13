// Basic card-input validation, done before anything is sent to the processor.

export function luhnValid(number) {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let d = Number(number[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function validCardNumber(number) {
  if (!/^\d+$/.test(number)) return false;
  // Local Isracard cards are 8-9 digits and don't follow Luhn.
  if (number.length === 8 || number.length === 9) return true;
  return number.length >= 13 && number.length <= 19 && luhnValid(number);
}

// MMYY, not in the past.
export function validExpiry(mmyy, now = new Date()) {
  if (!/^\d{4}$/.test(mmyy)) return false;
  const month = Number(mmyy.slice(0, 2));
  const year = 2000 + Number(mmyy.slice(2));
  if (month < 1 || month > 12) return false;
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  return year > thisYear || (year === thisYear && month >= thisMonth);
}

// Israeli ID (teudat zehut) check digit.
export function validIsraeliId(id) {
  if (!/^\d{5,9}$/.test(id)) return false;
  const padded = id.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(padded[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}
