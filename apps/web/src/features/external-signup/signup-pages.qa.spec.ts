/**
 * Review F1. Provisioning writes `FREE_TRIAL_15` — 1 branch, 2 staff, 15 receipts a month, with a
 * first-week ceiling on top — while these pages advertised the PRO package at ฿999 with 5/10/100.
 * The promise a shop owner reads has to be the one the system keeps.
 *
 * Source-text assertions, the same shape `SignupQueuePage.qa.spec.ts` uses: these strings live in
 * JSX that no unit test renders, and the cost of getting them wrong is a customer told they bought
 * something they did not.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pages, AND the module that writes their copy: a retired offer survives longest in prose that
 * no scanner reads, and `signup.logic.ts` is where every string on those pages comes from.
 */
const PAGES = [
  'SignupPage.tsx', 'SignupWelcomePage.tsx', 'SignupStatusPage.tsx', 'ClaimAccountPage.tsx',
  'SignupChrome.tsx', 'signup.logic.ts',
];

/** Only user-visible package wording — `PROVISIONING` and friends are code, not a promise. */
const PACKAGE_CLAIMS = [/แพ็กเกจ\s*PRO/, /มืออาชีพ/, /฿\s*999/, /PRO ฟรี/];

describe('the signup pages never sell a package the shop does not get (F1)', () => {
  // The list is what does the work here, so a file quietly leaving it would retire the guard
  // rather than fail — which is how the retired price survived in `signup.logic.ts` comments in
  // the first place. Every page and copy module in this directory is scanned, or this fails.
  it('scans every page and copy module in the feature', () => {
    const present = readdirSync(__dirname).filter((name) => (
      (name.endsWith('.tsx') || name === 'signup.logic.ts') && !name.includes('.spec.')
    ));
    assert.deepEqual([...PAGES].sort(), present.sort());
  });

  for (const page of PAGES) {
    it(`${page} names no PRO package and quotes no PRO price`, () => {
      const source = readFileSync(join(__dirname, page), 'utf8');
      for (const claim of PACKAGE_CLAIMS) {
        assert.doesNotMatch(source, claim, `${page} still advertises ${claim}`);
      }
    });
  }
});
