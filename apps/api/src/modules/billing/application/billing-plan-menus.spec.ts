/**
 * Phase 7 — the one decision `movePlanMenus` makes before it touches a shop's rights: which menu
 * set the tier the shop now pays for is entitled to, and when that answer is "not mine to move".
 *
 * Both refusals are the ones that would cost a customer real menus: a shop on a live deal carries
 * the deal's own snapshot (its RETURN is what puts it back on the base tier, spec §20.4), and a
 * term with no paid tier has no preset at all. Everything else is the tier table of §20.1, which
 * is also why a STARTER→PRO change must resolve to the SAME set and move nothing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { PLAN_MENUS_STALE_MS, planMenuRetryable, planMenuTarget } from './billing-plan-menus';

test('a paid tier resolves to its own menu set (§20.1)', () => {
  assert.deepEqual(planMenuTarget('STARTER_249', false), FEATURE_PACKAGE_PRESETS.starter.featureKeys);
  assert.deepEqual(planMenuTarget('ENTERPRISE_1999', false), FEATURE_PACKAGE_PRESETS.full.featureKeys);
  // The gap §20.5 named: only a change that crosses into or out of ENTERPRISE moves any menu.
  assert.deepEqual(planMenuTarget('BASIC_499', false), planMenuTarget('PRO_999', false));
  assert.notDeepEqual(planMenuTarget('PRO_999', false), planMenuTarget('ENTERPRISE_1999', false));
});

test('a live deal keeps its own snapshot, whatever the base tier says', () => {
  assert.equal(planMenuTarget('ENTERPRISE_1999', true), null);
  assert.equal(planMenuTarget('STARTER_249', true), null);
});

test('a term with no paid tier has nothing to move to', () => {
  assert.equal(planMenuTarget('FREE_TRIAL_15', false), null);
  assert.equal(planMenuTarget(null, false), null);
  assert.equal(planMenuTarget(undefined, false), null);
  // A tier key this build does not sell is a review, never a silent fall back to the smallest set.
  assert.equal(planMenuTarget('LEGACY_99', false), null);
  // And never a prototype-chain key either.
  assert.equal(planMenuTarget('toString', false), null);
});

test('the sweep retries a failure always, and a QUEUED row only once it is abandoned', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const at = (ms: number) => ({ createdAt: new Date(now.getTime() - ms) });
  // A move whose ledger row was written with the tier change but never ran — the crash window the
  // row exists for. Nothing else ever leaves a row QUEUED, so age is the whole test.
  assert.equal(planMenuRetryable({ state: 'QUEUED', ...at(PLAN_MENUS_STALE_MS) }, now), true);
  // Still young: another process is very probably running this exact move right now.
  assert.equal(planMenuRetryable({ state: 'QUEUED', ...at(PLAN_MENUS_STALE_MS - 1) }, now), false);
  assert.equal(planMenuRetryable({ state: 'QUEUED', ...at(0) }, now), false);
  // A recorded failure is retried whatever its age; the 30-day expiry is what ends it.
  assert.equal(planMenuRetryable({ state: 'BLOCKED', ...at(0) }, now), true);
  // Anything already settled is never touched again.
  assert.equal(planMenuRetryable({ state: 'APPLIED', ...at(30 * 86_400_000) }, now), false);
});
