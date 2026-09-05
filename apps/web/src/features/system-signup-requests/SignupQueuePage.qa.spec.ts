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

test('a package decision is confirmed before it moves what a customer pays', () => {
  assert.match(source, /const accepted = await confirm\(\{[\s\S]{0,400}อนุมัติเปลี่ยนแพ็กเกจ/);
  assert.match(source, /if \(!accepted\) return;[\s\S]{0,200}decidePackageChangeRequest/);
});
