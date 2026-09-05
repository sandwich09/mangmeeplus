import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const page = readFileSync(new URL('./SupportRequestsPage.tsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../../common/components/app-shell/SystemHeader.tsx', import.meta.url), 'utf8');

// line-support-request-spec-th §3. The whole point of `askerRef` is that the operator surface
// never holds a LINE identifier; a page that printed one would undo the contract that removed it.
test('the page shows a hash fragment, never a LINE id or a LINE display name', () => {
  assert.match(page, /item\.askerRef/);
  assert.equal(/lineUserId/.test(page), false);
  assert.equal(/lineDisplayName/.test(page), false);
});

// Owner 2026-09-05: no operator has LINE linked, so a request must be visible and actionable here
// whether or not any notification went anywhere.
test('every row is actionable from this page alone', () => {
  assert.match(page, /ตอบแล้ว/);
  assert.match(page, /ให้ AI ทำงานต่อ/);
  // The destination itself is decided in `support-requests.logic.ts` (and asserted there); what
  // this page must not do is drop the link, leaving an operator with no route to the message box.
  assert.match(page, /supportAnswerHref\(item\)/);
  assert.match(page, /<a\s+href=\{href\}/);
});

test('a 403 says so in Thai instead of leaking the API error', () => {
  assert.match(page, /e\.status === 403 \? 'คุณไม่มีสิทธิ์ดูคำขอคุยกับเจ้าหน้าที่' : apiErrorMessage\(err\)/);
});

test('loading and empty states exist, so an empty inbox never reads as a broken page', () => {
  assert.match(page, /SkeletonRow/);
  assert.match(page, /ไม่มีคำขอในกลุ่มนี้/);
});

// The customer's chat changes the moment "ให้ AI ทำงานต่อ" lands.
test('resuming the assistant asks first', () => {
  assert.match(page, /const ok = await confirm\(\{/);
  assert.match(page, /if \(!ok\) return;/);
});

test('the table scrolls inside its own box rather than widening the page on a phone', () => {
  assert.match(page, /overflow-x-auto/);
  assert.match(page, /min-h-dvh/);
});

// §2.2 delta: this badge is the primary notification channel, so it must fail silent rather than
// blank the header, and must never render a confident zero it has not actually measured.
test('the system nav carries an OPEN count that tolerates its own 403', () => {
  assert.match(header, /คำขอคุยกับเจ้าหน้าที่/);
  assert.match(header, /\.catch\(\(\) => \{ if \(!cancelled\) setOpenCount\(null\); \}\)/);
  assert.match(header, /openSupportCount !== null && openSupportCount > 0/);
});
