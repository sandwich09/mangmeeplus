import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ClaimAccountPage.tsx', import.meta.url), 'utf8');

test('R11: a network or 5xx on load is a retry, not a verdict on the link', () => {
  // The old catch treated every failure as "this token is unusable" — an API restart while the
  // applicant opened their email retired a link that was perfectly good.
  assert.match(source, /isTransientLoadFailure/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\s*\n\s*if \(active\) setUnusable\(true\)/);
  assert.match(source, /ลองอีกครั้ง/);
});

test('R12: an unusable link points at the status page when the id is known', () => {
  // The claim mail carries the request id beside the token precisely so this dead end has an exit
  // that is not "go to the login page you have no password for".
  assert.match(source, /\/signup\/status\//);
  assert.match(source, /searchParams\.get\('r'\)/);
});
