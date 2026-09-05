import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./SystemOnboardingNewPage.tsx', import.meta.url), 'utf8');

// Review A-04. The point of the option is what it does NOT hand over: no username, no temporary
// password. A form that still sent an empty username, or still printed the attach copy, would look
// like it worked while quietly meaning something else.
test('the LINE-only option is offered and is mutually exclusive with attach-existing', () => {
  assert.match(source, /ลูกค้าใช้ LINE เท่านั้น/);
  assert.match(source, /if \(e\.target\.checked\) setOwnerLineOnly\(false\)/);
  assert.match(source, /\{!attachExistingOwner && \([\s\S]{0,600}checked=\{ownerLineOnly\}/);
});

test('a LINE-only submit omits the username instead of sending an empty one', () => {
  assert.match(source, /\.\.\.\(ownerLineOnly \? \{ ownerLineOnly: true \} : \{ ownerUsername \}\)/);
});

test('the username field is hidden when there is no username to give', () => {
  assert.match(source, /\{!ownerLineOnly && \([\s\S]{0,400}Owner Username \*/);
});

test('the handoff copy tells the truth for all three owner shapes', () => {
  // Without this branch a LINE-only shop landed on "Attached to an existing owner account", which
  // is a different thing entirely, and on "sign in with the existing username and password" — a
  // password that does not exist for an account that has no username.
  assert.match(source, /function lineOnlyHandoff\(result: HandoffResult\): boolean \{/);
  assert.match(source, /\) : lineOnlyHandoff\(result\) \? \(/);
  assert.match(source, /สแกน QR เชื่อม LINE ด้านบน/);
  // And the username row disappears rather than printing an empty value.
  assert.match(source, /\{result\.username && <HandoffField label="Login Username"/);
});
