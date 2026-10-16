import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./SignupStatusPage.tsx', import.meta.url), 'utf8');

test('R11: a queued resend is reported as queued, not as a delivered email', () => {
  // `POST resend-claim` answers when the outbox row is written. Between that and a mailbox there
  // are a worker, SES and the applicant's provider — "ส่งอีเมลใหม่ให้แล้ว" claimed all three.
  assert.match(source, /รับคำขอส่งอีเมลใหม่แล้ว/);
  assert.doesNotMatch(source, /ส่งอีเมลใหม่ให้แล้ว/);
});

test('R11: an outage on the way to the status is offered a retry, never called a dead link', () => {
  assert.match(source, /isTransientLoadFailure/);
  assert.match(source, /ลองอีกครั้ง/);
  // The "this link is wrong" sentence may only be reached when the server actually said so.
  assert.doesNotMatch(source, /\{loadError \? \([\s\S]{0,200}ไม่พบคำขอนี้/);
});

test('R12: the status page hands back a link the applicant can keep', () => {
  // The id lives in the URL and nowhere else, so the page has to be able to hand that URL over.
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /คัดลอกลิงก์/);
});
