// When is it appropriate to call parents?
// No calls at night, on Shabbat and Yom Tov (Israel), on Tisha B'Av,
// and not on Friday / Erev Yom Tov after the cutoff hour.

const TZ = 'Asia/Jerusalem';

const localFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const hebrewFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: TZ,
  month: 'long',
  day: 'numeric',
});

function parts(fmt, date) {
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

export function localTime(date) {
  const p = parts(localFmt, date);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: p.weekday, // Sun..Sat
  };
}

// Hebrew date of the civil day `date` falls on (in Israel time).
// Noon is used so the result reflects the daytime, not the evening after sunset.
export function hebrewDate(date) {
  const { date: ymd } = localTime(date);
  const noon = new Date(`${ymd}T12:00:00+02:00`);
  const p = parts(hebrewFmt, noon);
  return { month: p.month, day: Number(p.day) };
}

// Israel Yom Tov days (one day each).
const YOM_TOV = {
  Tishri: [1, 2, 10, 15, 22],
  Nisan: [15, 21],
  Sivan: [6],
};

// Day before a Yom Tov: calls stop at the cutoff hour, like Friday.
const EREV_YOM_TOV = {
  Elul: [29],
  Tishri: [9, 14, 21],
  Nisan: [14, 20],
  Sivan: [5],
};

function inTable(table, { month, day }) {
  return (table[month] || []).includes(day);
}

function isTishaBav(h, weekday) {
  // 9 Av, or 10 Av when 9 Av falls on Shabbat (nidche).
  if (h.month !== 'Av') return false;
  return (h.day === 9 && weekday !== 'Sat') || (h.day === 10 && weekday === 'Sun');
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Returns { allowed: boolean, reason: string }
export function callingStatus(date, opts) {
  const { start, end, erevCutoff, blockedDates = [] } = opts;
  const t = localTime(date);
  const h = hebrewDate(date);

  if (blockedDates.includes(t.date)) return { allowed: false, reason: 'תאריך חסום בהגדרות' };
  if (t.weekday === 'Sat') return { allowed: false, reason: 'שבת קודש' };
  if (inTable(YOM_TOV, h)) return { allowed: false, reason: 'יום טוב' };
  if (isTishaBav(h, t.weekday)) return { allowed: false, reason: 'תשעה באב' };
  if (t.minutes < toMinutes(start) || t.minutes >= toMinutes(end)) {
    return { allowed: false, reason: `מחוץ לשעות החיוג (${start}-${end})` };
  }
  if (t.minutes >= toMinutes(erevCutoff)) {
    if (t.weekday === 'Fri') return { allowed: false, reason: 'ערב שבת' };
    if (inTable(EREV_YOM_TOV, h)) return { allowed: false, reason: 'ערב יום טוב' };
  }
  return { allowed: true, reason: '' };
}
