import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validCardNumber, validExpiry, validIsraeliId } from '../src/payments/card.js';

test('card number validation', () => {
  assert.equal(validCardNumber('4580000000000000'), true);
  assert.equal(validCardNumber('4580000000000001'), false); // Luhn
  assert.equal(validCardNumber('12312312'), true); // Isracard 8 digits
  assert.equal(validCardNumber('1234'), false);
});

test('expiry validation', () => {
  const now = new Date('2026-10-13');
  assert.equal(validExpiry('1026', now), true);
  assert.equal(validExpiry('0926', now), false);
  assert.equal(validExpiry('1330', now), false);
});

test('Israeli ID check digit', () => {
  assert.equal(validIsraeliId('000000018'), true);
  assert.equal(validIsraeliId('123456782'), true);
  assert.equal(validIsraeliId('123456789'), false);
});
