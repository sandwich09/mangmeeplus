import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingAccount, CompanyPlanTerm } from '../../../generated/prisma/client';
import { termProjectionHash } from '../domain/paid-invoice';
import { billingPurchaseSource, initialPurchaseSource, packageMenuPurchaseSource } from './billing-purchase-source';

const now = new Date('2026-09-21T00:00:00.000Z');
const manual = { companyId: 'company', tierKey: 'BASIC_499', billingReceiptAccountId: null,
  termStartAt: new Date('2026-09-01T00:00:00.000Z'), termEndsAt: new Date('2026-10-01T00:00:00.000Z'),
  branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50, termDisabledAt: null,
  warmupUntil: null, warmupSlipLimit: null, capacityOverride: null } as CompanyPlanTerm;
const empty = { id: 'account', baseSubscriptionId: null, activeAttemptId: null, contractAttemptId: null, renewalMode: 'NONE', paidThrough: null,
  termProjectionHash: null } as BillingAccount;

test('purchase source separates unbilled legacy rows from verified paid and inconsistent mappings', () => {
  assert.equal(billingPurchaseSource(null, null, false, now), 'NO_TERM');
  assert.equal(billingPurchaseSource(null, empty, false, now), 'NO_TERM');
  assert.equal(billingPurchaseSource(manual, empty, false, now), 'ADMIN_MANUAL');
  assert.equal(billingPurchaseSource({ ...manual, tierKey: 'FREE_TRIAL_15' }, empty, false, now), 'TRIAL');
  assert.equal(billingPurchaseSource(manual, empty, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource({ ...manual, billingReceiptAccountId: 'another' }, empty, false, now), 'PAID_OTHER_MODE');
  const paid = { ...manual, billingReceiptAccountId: empty.id };
  const account = { ...empty, baseSubscriptionId: 'sub_paid', paidThrough: manual.termEndsAt,
    termProjectionHash: termProjectionHash(paid) };
  assert.equal(billingPurchaseSource(paid, account, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, renewalMode: 'CARD_AUTO' }, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, renewalMode: 'PROMPTPAY_RENEW' }, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, paidThrough: now }, true, now), 'PAID_EXPIRED_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, termProjectionHash: 'stale' }, true, now), 'SOURCE_INCONSISTENT');
  const oneTime = { ...empty, contractAttemptId: 'attempt_paid', renewalMode: 'PROMPTPAY_ONCE', paidThrough: manual.termEndsAt,
    termProjectionHash: termProjectionHash(paid) };
  assert.equal(billingPurchaseSource(paid, oneTime, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...oneTime, renewalMode: 'CARD_ONCE' }, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...oneTime, paidThrough: now }, true, now), 'PAID_EXPIRED_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, oneTime, false, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...oneTime, contractAttemptId: null }, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...oneTime, baseSubscriptionId: 'sub_wrong' }, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...oneTime, renewalMode: 'PROMPTPAY_RENEW' }, true, now), 'SOURCE_INCONSISTENT');
  const promptPayBinding = { ...oneTime, renewalMode: 'PROMPTPAY_RENEW', activeAttemptId: oneTime.contractAttemptId };
  assert.equal(billingPurchaseSource(paid, promptPayBinding, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...promptPayBinding, activeAttemptId: null }, true, now), 'SOURCE_INCONSISTENT');
  // SD-O13: a discounted CARD_AUTO first period is paid and applied before its subscription binds — the same window.
  const cardBinding = { ...promptPayBinding, renewalMode: 'CARD_AUTO' };
  assert.equal(billingPurchaseSource(paid, cardBinding, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, cardBinding, false, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...cardBinding, activeAttemptId: null }, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...cardBinding, activeAttemptId: 'another_attempt' }, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(null, { ...empty, contractAttemptId: 'orphan' }, false, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...account, renewalMode: 'CARD_ONCE' }, true, now), 'SOURCE_INCONSISTENT');
});

test('a restart decides the menu set the same way a first purchase does (Owner 2026-09-21)', () => {
  // The whole difference between the two predicates: an expired paid term. Its shop is locked and
  // the package it buys now — same tier or another — is the only thing that may decide its menus,
  // so the quote pins the plan, Checkout re-checks it and the package page warns first.
  assert.equal(initialPurchaseSource('PAID_EXPIRED_CURRENT_MODE'), false);
  assert.equal(packageMenuPurchaseSource('PAID_EXPIRED_CURRENT_MODE'), true);
  for (const source of ['NO_TERM', 'TRIAL', 'ADMIN_MANUAL'] as const) {
    assert.equal(packageMenuPurchaseSource(source), true);
  }
  // A shop whose term is still running is buying INTO a package it already has: menus move at the
  // boundary (or on upgrade) through APPLY_PLAN_MENUS, never by pinning a plan at quote time.
  assert.equal(packageMenuPurchaseSource('PAID_CURRENT_MODE'), false);
  // Nothing about a broken mapping is a purchase; those are refused before any menu question.
  assert.equal(packageMenuPurchaseSource('PAID_OTHER_MODE'), false);
  assert.equal(packageMenuPurchaseSource('SOURCE_INCONSISTENT'), false);
});
