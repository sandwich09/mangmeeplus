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

// The states themselves are rendered in SupportRowActions.spec.ts; what stays here is that the
// page actually hands the body the flags it decides from.
test('the page tells the body what it knows: loading, error, and the rows', () => {
  assert.match(page, /loading=\{loading\}/);
  assert.match(page, /items=\{items\}/);
});

// The error-vs-table decision itself is a RENDER assertion in SupportRowActions.spec.ts
// (`SupportInboxBody`). What only the source can show is the other half of that bug: rows from a
// previous successful read surviving the failure that followed them.
test('a failed read clears the rows it could not replace', () => {
  assert.match(page, /setItems\(\[\]\);/);
  assert.match(page, /error=\{error\}/, 'and the body is the one thing that decides what to show');
});

// Two overlapping reads (a tab switch during a post-action reload) used to let the SLOWER one
// win, painting the previous tab's rows under the new tab's heading.
test('only the newest read may write state', () => {
  assert.match(page, /const seq = \+\+readSeq\.current;/);
  assert.match(page, /inFlight\.current\?\.abort\(\);/);
  // Both exit paths, asserted where they actually are: the success path is the one that paints
  // rows, so a guard present only in `catch` would still let a stale response repaint the table.
  assert.match(
    page,
    /await listSupportRequests\(next, cursor, \{ signal: controller\.signal \}\);\s*\n\s*if \(seq !== readSeq\.current\) return;/,
    'the resolved read checks its own sequence before setting any state',
  );
  assert.match(page, /\} catch \(err\) \{\s*\n\s*if \(seq !== readSeq\.current\) return;/);
  assert.equal((page.match(/if \(seq !== readSeq\.current\) return;/g) ?? []).length, 2);
});

// One number, one source: answering a request must not leave the header badge above this very
// page still claiming somebody is waiting.
test('every count the page reads is published to the nav badge', () => {
  assert.match(page, /publishSupportOpenCount\(result\.openCount\);/);
});

// The clamp itself is a RENDER assertion in SupportRowActions.spec.ts — a source regex is what
// let `line-clamp-2 block break-words` ship, since the string was right and the CSS was not.
// What stays here is the page-level rule the render cannot see.
test('only the table scrolls sideways; the page body never does', () => {
  assert.match(page, /overflow-x-auto/);
  assert.equal(/overflow-x-scroll/.test(page), false);
  assert.match(page, /min-h-dvh/);
});

// A settled request that keeps counting reads as a customer still waiting.
test('the waiting clock stops, and the column renames itself when it does', () => {
  assert.match(page, /waitedLabelTh\(item\)/);
  assert.match(page, /waitedForTh\(item\)/);
  assert.equal(/waitedForTh\(item\.requestedAt\)/.test(page), false);
});

// UAT 2026-09-06: a request the customer wrote back to returns to รอตอบ, where it looked exactly
// like a first ask — and the stamp under the duration still read the original tap, so the row said
// "รอมานาน 2 นาที · 5 กันยายน" at once. The chip itself is a RENDER assertion next door.
test('a reopened request says so, and its stamp is the one the clock counts from', () => {
  assert.match(page, /supportReopenedChip\(item\)/);
  assert.match(page, /\{reopened && <ChipBadge chip=\{reopened\} \/>\}/);
  assert.match(page, /formatThaiDateTime\(item\.lastMessageAt\)/);
  assert.equal(/formatThaiDateTime\(item\.requestedAt\)/.test(page), false,
    'the stamp beside a restarted clock may not be the original ask');
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
  assert.match(header, /ขอความช่วยเหลือ/);
  assert.match(header, /setOpenCount\(null\)/, 'a failure renders no badge, never a confident zero');
  assert.match(header, /openSupportCount !== null && openSupportCount > 0/);
});

// The badge is the primary notification channel, so it may not go stale the moment somebody acts:
// `[pathname]` alone never fires when a request is answered from this very page.
test('the badge listens to the page as well as to navigation, and asks the cheap endpoint', () => {
  assert.match(header, /subscribeSupportOpenCount\(setOpenCount\)/);
  assert.match(header, /getSupportOpenCount\(/);
  assert.equal(/listSupportRequests/.test(header), false, 'a 200-row read is not a badge');
});
