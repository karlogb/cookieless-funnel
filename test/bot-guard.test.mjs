import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForm } from '../server/bot-guard.mjs';

test('human-looking submission passes', () => {
  assert.deepEqual(checkForm(new URLSearchParams('email=a%40b.c&fe=8200&fi=1&website=')), { ok: true, reason: '' });
  assert.equal(checkForm({ fe: '3000', fi: '1' }).ok, true);
});

test('bot-looking submissions fail with a reason', () => {
  assert.equal(checkForm(new URLSearchParams('email=a%40b.c')).reason, 'missing_guard_fields');
  assert.equal(checkForm({ fe: '9000', fi: '0' }).reason, 'no_field_focus');
  assert.equal(checkForm({ fe: '400', fi: '1' }).reason, 'too_fast');
  assert.equal(checkForm({ fe: 'abc', fi: '1' }).reason, 'too_fast');
  assert.equal(checkForm({ fe: '9000', fi: '1', website: 'http://spam.example' }).reason, 'honeypot');
});

test('options: threshold and honeypot name', () => {
  assert.equal(checkForm({ fe: '1500', fi: '1' }, { minMs: 1000 }).ok, true);
  assert.equal(checkForm({ fe: '9000', fi: '1', url: 'x' }, { honeypot: 'url' }).reason, 'honeypot');
  assert.equal(checkForm({ fe: '9000', fi: '1', website: 'x' }, { honeypot: '' }).ok, true);
});
