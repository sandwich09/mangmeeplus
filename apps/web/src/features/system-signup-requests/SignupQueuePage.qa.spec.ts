import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The page is a client component whose whole behaviour lives behind `useEffect`/`useState`, so the
// wiring below cannot be rendered without a browser. These are the guards that would silently rot:
// each asserts a decision the logic module cannot make on its own.
const source = readFileSync(new URL('./SignupQueuePage.tsx', import.meta.url), 'utf8');

test('a phone number in the queue is a tap-to-call link, not text to retype', () => {
  // §8: an admin reads this queue on a phone. A number that is only text costs them a retype into
  // the dialler, every time, on the one action that unblocks a stuck applicant.
  assert.match(source, /href=\{`tel:\$\{item\.phoneNumber\}`\}/);
});

test('the queue shows when the applicant accepted the terms', () => {
  // LEGAL-LIFF-01: the binding acceptance happened on LIFF before this row existed, and its time
  // is the evidence an operator may be asked for.
  assert.match(source, /item\.legalAcceptedAt && \(/);
  assert.match(source, /ยอมรับข้อกำหนด \{formatThaiDateTime\(item\.legalAcceptedAt\)\}/);
});

test('the reject dialog default comes from the rail, not from a hardcoded false', () => {
  // §4D silent for the web form, §8 notify for LINE. Hardcoding either one is wrong for the other.
  assert.match(source, /setNotifyApplicant\(rejectNotifyDefault\(item\)\)/);
  assert.doesNotMatch(source, /setNotifyApplicant\(false\);\s*\n\s*setRejectionReason/);
});

test('the rejection paragraph is offered only where it can actually travel', () => {
  // A LINE rejection sends the fixed §7 copy; the free-text reason rides the email rail only, so
  // showing the box for a LINE row would promise a message that never goes anywhere.
  assert.match(source, /notifyApplicant && rejecting && !isLineSignup\(rejecting\) && \(/);
});

test('the two extra tabs load lazily, so a missing partner permission cannot break the queue', () => {
  // The queue is gated on `system.company_onboarding.read`; the package-change routes need
  // `system.partner_company.update`. Loading them on mount would 403 the whole page for a reader.
  assert.match(source, /const selectTab = \(next: SignupQueueTab\) => \{/);
  assert.match(source, /if \(tabLoadsOwnList\(next\)\) void loadTab\(next\)/);
  assert.doesNotMatch(source, /useEffect\([\s\S]{0,120}listPackageChangeRequests/);
  // And a failure inside a tab paints inside that tab, never over the main queue's error slot.
  assert.match(source, /setTabError\(/);
});

test('an unopened tab shows no count rather than a confident zero', () => {
  assert.match(source, /\{count !== null && <span/);
});

test('R13: the tab is asked of the server, not applied to whatever 200 rows arrived', () => {
  // The queue read 200 rows and the browser filtered them, so a tab could show nothing while the
  // database held a backlog, and every count was a count of the truncation.
  assert.match(source, /const page = await listSignupRequests\(\{ tab: tabLoadsOwnList\(forTab\) \? 'ALL' : forTab \}\)/);
  assert.doesNotMatch(source, /listSignupRequests\(\)/);
  assert.doesNotMatch(source, /filterSignupQueue/);
});

test('R13: there is a way past the first page, and it continues rather than restarts', () => {
  assert.match(source, /nextCursor/);
  assert.match(source, /โหลดเพิ่ม/);
  // Appends — a "load more" that replaces the list is a pager that loses what you were reading.
  assert.match(source, /setItems\(\(current\) => \[\.\.\.current, \.\.\.page\.items\]\)/);
});

test('R13: "no applications here" is only said when the server counted zero', () => {
  assert.match(source, /const emptyForReal =/);
  assert.match(source, /ไม่มีคำขอในกลุ่มนี้/);
});

test('a tab failure does not stay up over another tab', () => {
  assert.match(source, /const selectTab = \(next: SignupQueueTab\) => \{[\s\S]{0,400}setTabError\(null\)/);
});

test('the package-change note is per row, not one box shared by every shop', () => {
  // A single box put the note typed for one shop onto whichever shop was decided next.
  assert.match(source, /const \[packageNotes, setPackageNotes\] = useState<Record<string, string>>\(\{\}\)/);
  assert.match(source, /value=\{packageNotes\[item\.id\] \?\? ''\}/);
  assert.match(source, /const note = \(packageNotes\[item\.id\] \?\? ''\)\.trim\(\)/);
});

test('the package-change tab offers the decision AND the partner page', () => {
  // The tier move sometimes needs a conversation and a term date first, which lives on the partner
  // page — the same place the writer this button calls actually lives.
  assert.match(source, /handlePackageDecision\(item, 'APPROVE'\)/);
  assert.match(source, /handlePackageDecision\(item, 'REJECT'\)/);
  assert.match(source, /href=\{`\/system\/partners\/\$\{item\.companyId\}`\}/);
});

test('R10: approving asks for the business category the mapping could not read', () => {
  // "คลินิก" maps to OTHER, so the PDPA health tripwire never fired for a Thai applicant even
  // though the operator was reading the word. The dialog defaults to the server's mapping and
  // refuses to approve while a row the mapping could not read has no choice on it.
  assert.match(source, /const \[approving, setApproving\] = useState<AdminSignupQueueItemDto \| null>\(null\)/);
  assert.match(source, /requiresCategoryChoice\(approving\)/);
  assert.match(source, /COMPANY_BUSINESS_CATEGORIES\.map/);
  assert.match(source, /setBusinessCategory\(item\.businessCategory/);
  assert.match(source, /\? \{ businessCategory \} : \{\}/);
  // F2: "อื่น ๆ" is confirmed, never refused — every Thai answer maps to OTHER, so refusing it
  // meant a genuinely-other shop could not be approved at all.
  assert.match(source, /approveBlockedOnCategory\(approving, businessCategory, confirmedOther\)/);
  assert.match(source, /ตรวจแล้ว เป็นอื่น ๆ/);
  assert.match(source, /setConfirmedOther\(false\)/);
});

test('a LINE review records one explicit outcome and only server-proven return targets', () => {
  assert.match(source, /setResolutionAction\(isLineSignup\(item\)[\s\S]{0,160}\? \(isFinishingStrandedRow/);
  assert.match(source, /setResolutionAction\('CREATE_NEW_SHOP'\)/);
  assert.match(source, /setResolutionAction\('RETURN_EXISTING'\)/);
  assert.match(source, /setResolutionAction\('REQUEST_INFO'\)/);
  assert.match(source, /eligibleExistingCompanies \?\? \[\]\)\.filter\(\(company\) => company\.canEnter\)/);
  assert.match(source, /targetCompanyId/);
  assert.match(source, /version: item\.version/);
});

test('shared contact data requires explicit recorded review, a repeat applicant no longer does', () => {
  // Owner 2026-09-20 (spec R1): there is no trial left to grant a second time, so a repeat
  // applicant is approved like everyone else and the shop opens locked. The queue neither offers
  // the grant nor warns that the row is parked — both described a decision that no longer exists.
  assert.doesNotMatch(source, /requiresRepeatTrialGrant|grantRepeatTrial|trialGrantNote|อนุญาตทดลองใช้ฟรีเพิ่ม|รอจัดแพ็กเกจ/);
  assert.match(source, /contactEmailConflict/);
  assert.match(source, /acknowledgeSharedContact/);
  assert.match(source, /sharedContactNote/);
  assert.match(source, /อีเมลนี้ไม่ใช้ยืนยันเจ้าของและไม่ย้ายบัญชี/);
});

test('recovery reuses the recorded review instead of posting fresh decision fields', () => {
  assert.match(source, /!finishing && \(resolutionAction === 'APPROVE' \|\| resolutionAction === 'CREATE_NEW_SHOP'\)/);
  assert.match(source, /!finishing && resolutionAction === 'CREATE_NEW_SHOP' && item\.contactEmailConflict/);
});

test('request info gathers all gaps together and reports queueing truthfully', () => {
  assert.match(source, /ข้อมูลที่ต้องขอทั้งหมด/);
  assert.match(source, /resolutionNote: resolutionNote\.trim\(\)/);
  assert.match(source, /decided\.customerNotification === 'QUEUED'/);
  assert.match(source, /บันทึกข้อมูลที่ต้องขอและเข้าคิวแจ้งลูกค้าทาง LINE แล้ว/);
  assert.match(source, /บันทึกข้อมูลที่ต้องขอแล้ว แต่ยังแจ้งลูกค้าทาง LINE ไม่ได้/);
});

test('the queue survives a 390px phone, which is where an operator reads it', () => {
  // §8: this queue is worked from a phone. Every table is the thing that overflows, so each one
  // scrolls inside its own box rather than pushing the page sideways.
  const tables = [...source.matchAll(/<table\b/g)].length;
  const scrollers = [...source.matchAll(/overflow-x-auto/g)].length;
  assert.ok(tables > 0 && scrollers >= tables, `${tables} tables, ${scrollers} scroll containers`);
  // The new controls are full-width-safe: no fixed pixel widths anywhere on the page.
  for (const [, , px] of source.matchAll(/\b((?:min-)?w)-\[(\d+)px\]/g)) {
    assert.ok(Number(px) <= 358, `a ${px}px fixed width does not fit a 390px screen`);
  }
  // Height is INV-10's job (src/common/styles/viewport-units.spec.ts) for the whole app; naming
  // the banned class here is what that scanner reads as a violation.
  assert.match(source, /\bmin-h-dvh\b/);
});

test('a package decision is confirmed before it moves what a customer pays', () => {
  assert.match(source, /const accepted = await confirm\(\{[\s\S]{0,400}อนุมัติเปลี่ยนแพ็กเกจ/);
  assert.match(source, /if \(!accepted\) return;[\s\S]{0,200}decidePackageChangeRequest/);
});
