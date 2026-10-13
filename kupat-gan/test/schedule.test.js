import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callingStatus } from '../src/schedule.js';
import { callingConfig } from './helpers.js';

const at = (s) => callingStatus(new Date(s), callingConfig);

test('weekday within hours is allowed', () => {
  assert.equal(at('2026-10-13T10:00:00+03:00').allowed, true); // Tuesday
});

test('night hours are blocked', () => {
  assert.equal(at('2026-10-13T08:00:00+03:00').allowed, false);
  assert.equal(at('2026-10-13T21:00:00+03:00').allowed, false);
});

test('Friday after cutoff and all of Shabbat are blocked', () => {
  assert.equal(at('2026-10-16T10:00:00+03:00').allowed, true);
  assert.deepEqual(at('2026-10-16T13:00:00+03:00'), { allowed: false, reason: 'ערב שבת' });
  assert.deepEqual(at('2026-10-17T15:00:00+03:00'), { allowed: false, reason: 'שבת קודש' });
});

test('Yom Tov, Erev Yom Tov and Tisha BAv are blocked', () => {
  assert.equal(at('2026-09-21T11:00:00+03:00').reason, 'יום טוב'); // Yom Kippur
  assert.equal(at('2027-04-22T11:00:00+03:00').reason, 'יום טוב'); // Pesach
  assert.equal(at('2026-09-20T10:00:00+03:00').allowed, true); // Erev Yom Kippur morning
  assert.equal(at('2026-09-20T13:00:00+03:00').reason, 'ערב יום טוב');
  assert.equal(at('2027-08-12T11:00:00+03:00').reason, 'תשעה באב');
});

test('dates blocked in the settings', () => {
  const r = callingStatus(new Date('2026-10-13T10:00:00+03:00'), { ...callingConfig, blockedDates: ['2026-10-13'] });
  assert.equal(r.allowed, false);
});
