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

test('a local validation failure focuses the first error rather than leaving the user at the button', () => {
  // The submit button sits at the bottom of a long mobile form: colouring a field the applicant
  // has already scrolled past is the same as saying nothing.
  assert.match(source, /const firstLocalError = firstSignupErrorField\(errors\)/);
  assert.match(source, /focusField\(firstLocalError\)/);
  assert.match(source, /scrollIntoView/);
});
