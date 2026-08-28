import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('server-page session lookup preserves an auth outage for the existing retry boundary', () => {
  const source = readFileSync(new URL('./server-session.ts', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('export async function fetchServerSession('));
  assert.ok(/result\.status === 'unavailable'[\s\S]*throw new Error/.test(helper));
  assert.ok(helper.indexOf("result.status === 'unavailable'") < helper.indexOf("result.status === 'signed_in'"));
});

test('the retry boundary refetches the failed server page instead of replaying its cached error', () => {
  const source = readFileSync(new URL('../../../app/error.tsx', import.meta.url), 'utf8');
  assert.ok(/onClick=\{\(\) => window\.location\.reload\(\)\}/.test(source));
});
