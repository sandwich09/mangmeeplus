import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lineOnlyUser } from './UserLookupSection';

const partnerPage = readFileSync(new URL('./PartnerDetailPage.tsx', import.meta.url), 'utf8');
const lookup = readFileSync(new URL('./UserLookupSection.tsx', import.meta.url), 'utf8');

test('the shop timeline and the message box are actually mounted on the partner page', () => {
  // A section that exists as a component and is never rendered is the shape of gap this slice was
  // written to close (§8: support has one page to work from).
  assert.match(partnerPage, /<ShopTimelineSection key=\{`timeline-\$\{companyId\}`\} companyId=\{companyId\} \/>/);
  assert.match(partnerPage, /<ShopMessageSection key=\{`message-\$\{companyId\}`\}/);
});

test('the timeline reads the server assembly rather than re-deriving it in the browser', () => {
  // §8 is explicit that this comes from rows that already exist; a second derivation here would be
  // a second source of truth for the same question.
  assert.match(partnerPage, /await getPartnerTimeline\(companyId\)/);
  assert.doesNotMatch(partnerPage, /getPartnerAiUsage\([^)]*\)[\s\S]{0,200}timelineEntries/);
});

test('the message box confirms before sending, because a push cannot be unsent', () => {
  assert.match(partnerPage, /title: 'ส่งข้อความถึงร้าน'/);
  assert.match(partnerPage, /if \(!accepted\) return;[\s\S]{0,200}sendPartnerLineMessage/);
});

test('a message that reached nobody is reported as not sent', () => {
  // The API answers 200 with `delivered: 0` when no OWNER has LINE linked. Reporting that as
  // success is exactly how an operator walks away believing they answered a customer.
  assert.match(partnerPage, /result\.delivered === 0/);
  assert.match(partnerPage, /ยังไม่ได้ส่ง เพราะเจ้าของร้านยังไม่ได้ผูก LINE/);
});

test('"ตรวจแล้ว" appears only while there is a warm-up left to lift', () => {
  assert.match(partnerPage, /const warmupActive = Boolean\(term\?\.warmupUntil && new Date\(term\.warmupUntil\)\.getTime\(\) > Date\.now\(\)\)/);
  assert.match(partnerPage, /\{warmupActive && \(/);
  assert.match(partnerPage, /ตรวจแล้ว/);
});

// Review A-05. A LINE-first account is defined by what it does NOT have.
test('lineOnlyUser is exactly "no username, no email, LINE linked"', () => {
  assert.equal(lineOnlyUser({ username: undefined, email: undefined, lineLinked: true }), true);
  assert.equal(lineOnlyUser({ username: 'nid', email: undefined, lineLinked: true }), false);
  assert.equal(lineOnlyUser({ username: undefined, email: 'nid@example.com', lineLinked: true }), false);
  // Not linked yet is an ordinary account mid-setup, not a LINE-only one.
  assert.equal(lineOnlyUser({ username: undefined, email: undefined, lineLinked: false }), false);
});

test('the user lookup shows a LINE badge instead of two dashes for a LINE-only account', () => {
  assert.match(lookup, /\{lineOnlyUser\(user\) && <span className=\{greenBadge\}>LINE<\/span>\}/);
  assert.match(lookup, /เข้าใช้งานด้วย LINE เท่านั้น ไม่มีชื่อผู้ใช้และอีเมล/);
});
