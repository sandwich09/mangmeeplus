import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The public form is a client component whose whole behaviour lives behind `useState`/`useEffect`,
// so these guards assert the WIRING the pure logic module cannot own: which decision the page
// actually calls, and where the applicant is put afterwards.
const source = readFileSync(new URL('./SignupPage.tsx', import.meta.url), 'utf8');

test('R07: a definite validation rejection mints a fresh idempotency key', () => {
  // The submit use-case receives durably before it checks MX, so the 422 leaves a row holding the
  // mistyped address's payload hash. Reusing the key for the corrected form is a 409 the applicant
  // cannot get past; keeping it for an UNKNOWN outcome is what stops a timeout opening two shops.
  assert.match(source, /const \[externalSignupId, setExternalSignupId\] = useState/);
  assert.match(source, /if \(rotateSignupKeyAfter\(cause\)\) setExternalSignupId\(crypto\.randomUUID\(\)\)/);
});

test('R07: the MX rejection lands under the email input, with focus', () => {
  assert.match(source, /const rejection = signupFieldRejection\(cause\)/);
  assert.match(source, /setFieldErrors\(\{ \[rejection\.field\]: rejection\.message \}\)/);
  assert.match(source, /focusField\(rejection\.field\)/);
});

test('R12: a successful submit puts the request id in the URL', () => {
  // The id used to live only in React state while the URL still said `/signup`, so the page that
  // told the applicant to "keep this link" was a form. A reload gave them a blank one.
  assert.match(source, /router\.replace\(`\/signup\/status\/\$\{encodeURIComponent\(result\.requestId\)\}`\)/);
});

test('the received page does not promise a password to someone who already has an account', () => {
  // The claim page offers both lanes — set a password, or sign in with an existing account — so
  // "the email will have a link to set a password" told half the applicants the wrong story.
  assert.match(source, /เมื่ออนุมัติ เราจะส่งลิงก์เปิดใช้งานทางอีเมล ตั้งรหัสใหม่หรือใช้บัญชีเดิมได้/);
  assert.doesNotMatch(source, /ในอีเมลจะมีลิงก์สำหรับตั้งรหัสผ่าน/);
});

test('R12: the received view does not offer a resend that does not exist yet', () => {
  // Nothing can be re-sent before an approval: `canResendClaim` is false in PENDING_REVIEW, so the
  // "ask for a new email in 2 days" line pointed at a button that is not rendered.
  assert.doesNotMatch(source, /2 วัน/);
  assert.match(source, /เมื่ออนุมัติแล้วจึงขอส่งลิงก์ใหม่ได้/);
});

test('R11: an availability outage is not reported as "we closed signups"', () => {
  // The availability call failing says nothing about whether the product is taking applications.
  // Painting the closed notice over an outage turned a five-second blip into a lost customer.
  assert.match(source, /'loading' \| 'open' \| 'closed' \| 'unavailable'/);
  assert.match(source, /setAvailability\('unavailable'\)/);
  assert.match(source, /SignupUnavailableNotice/);
});

test('a local validation failure focuses the first error rather than leaving the user at the button', () => {
  // The submit button sits at the bottom of a long mobile form: colouring a field the applicant
  // has already scrolled past is the same as saying nothing.
  assert.match(source, /const firstLocalError = firstSignupErrorField\(errors\)/);
  assert.match(source, /focusField\(firstLocalError\)/);
  assert.match(source, /scrollIntoView/);
});
