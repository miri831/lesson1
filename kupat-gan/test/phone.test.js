import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/phone.js';

test('normalizes common Israeli phone formats', () => {
  assert.equal(normalizePhone('052-765-4321'), '0527654321');
  assert.equal(normalizePhone('+972 52 765 4321'), '0527654321');
  assert.equal(normalizePhone('00972527654321'), '0527654321');
  assert.equal(normalizePhone('527654321'), '0527654321'); // Excel dropped the zero
  assert.equal(normalizePhone('03-6181234'), '036181234');
  assert.equal(normalizePhone('077-1234567'), '0771234567');
});

test('rejects invalid numbers', () => {
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('05276543210'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});
