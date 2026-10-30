import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { assertFreeExpenseSourceActor, freeExpenseDraftPermissions, isFreeExpenseDraftCompany, isFreeExpenseDraftRoute } from './free-expense-access';

const now = new Date('2026-10-28T12:00:00Z');
const expired = new Date('2026-10-01T00:00:00Z');
function fixture() {
  const state = {
    company: { status: 'DISABLED', disabledAt: expired, archivedAt: null,
      planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: expired, termDisabledAt: expired, billingReceiptAccountId: null, capacityOverride: null } as any },
    lifecycle: { actorUserId: null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } } as any,
    accounts: [] as any[], invoice: null as any, grant: null as any, request: null as any, attribution: null as any,
  };
  const db = {
    company: { findUnique: async () => state.company },
    auditLog: { findFirst: async () => state.lifecycle },
    billingAccount: { findMany: async () => state.accounts },
    billingInvoice: { findFirst: async (input: any) => { assert.deepEqual(input.where.billingAccountId.in, state.accounts.map(a => a.id)); return state.invoice; } },
    billingReceiptGrant: { findFirst: async () => state.grant },
    packageChangeRequest: { findFirst: async () => state.request },
    salesAttribution: { findUnique: async () => state.attribution },
  } as any;
  return { state, db };
}

describe('free expense access', () => {
  it('opens no-package and expired trial drafts without changing the term-only lifecycle', async () => {
    const { state, db } = fixture();
    const before = structuredClone(state);
    assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), true);
    state.lifecycle.metadataJson.reason = 'term_expired';
    assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), true);
    state.lifecycle.metadataJson.reason = 'no_package';
    assert.deepEqual(state, before);
  });

  it('preserves running trials, manual terms, grandfathered and capacity overrides', async () => {
    for (const change of [
      (s: any) => { s.company.planTerm.termEndsAt = new Date(now.getTime() + 1); },
      (s: any) => { s.company.planTerm.tierKey = 'STARTER_249'; },
      (s: any) => { s.company.planTerm = null; },
      (s: any) => { s.company.planTerm.capacityOverride = { operationId: 'manual' }; },
    ]) {
      const { state, db } = fixture(); change(state);
      assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), false);
    }
  });

  it('requires proven system term-disable and rejects stale markers with admin/security holds', async () => {
    for (const change of [
      (s: any) => { s.company.status = 'SUSPENDED'; },
      (s: any) => { s.company.status = 'ARCHIVED'; },
      (s: any) => { s.company.planTerm.termDisabledAt = null; },
      (s: any) => { s.lifecycle = null; },
      (s: any) => { s.lifecycle.actorUserId = 'admin'; },
      (s: any) => { s.lifecycle.metadataJson.reason = 'security_hold'; },
      (s: any) => { s.lifecycle.metadataJson.toStatus = 'ACTIVE'; },
    ]) {
      const { state, db } = fixture(); change(state);
      assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), false);
    }
  });

  it('rejects historical paid, refunded, disputed, deal, grant and unresolved recovery evidence', async () => {
    for (const key of ['invoice', 'grant', 'request', 'attribution'] as const) {
      const { state, db } = fixture(); state[key] = { id: 'historical-refunded-paid-record' };
      assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), false, key);
    }
    for (const evidence of [{ paidThrough: expired }, { activeAttemptId: 'pending' }, { contractAttemptId: 'old-deal' }, { subscriptionState: 'UNKNOWN' }]) {
      const { state, db } = fixture(); state.accounts = [{ id: 'old-mode', renewalMode: 'NONE', subscriptionState: 'NONE', ...evidence }];
      assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), false);
    }
    const { state, db } = fixture();
    state.accounts = [{ id: 'old-mode', renewalMode: 'NONE', subscriptionState: 'NONE' }];
    assert.equal(await isFreeExpenseDraftCompany(db, 'co', now), true, 'an unused provider account is not purchase evidence');
  });

  it('fails unavailable when policy evidence cannot be read', async () => {
    const { db } = fixture(); db.billingInvoice.findFirst = async () => { throw new Error('offline'); };
    await assert.rejects(() => isFreeExpenseDraftCompany(db, 'co', now), ServiceUnavailableException);
  });

  it('rechecks current source actor, feature and scope before persistence and permits a paid upgrade only as source', async () => {
    const { state, db } = fixture();
    let enabled = true;
    let member: any = { branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [],
      roles: [{ role: { permissions: [{ permission: { key: 'expense.receipt.upload' } }] } }] };
    db.companyMembership = { findFirst: async () => member };
    db.companyFeatureEntitlement = { findMany: async () => [{ featureKey: 'expenses', enabled }] };
    db.branch = { findFirst: async () => ({ id: 'branch' }), findMany: async () => [] };
    const actor = { companyId: 'co', userId: 'u', branchId: 'branch' };
    await assertFreeExpenseSourceActor(db, actor);
    enabled = false;
    await assert.rejects(() => assertFreeExpenseSourceActor(db, actor));
    enabled = true;
    member.branchScopeMode = 'SELECTED_BRANCHES';
    await assert.rejects(() => assertFreeExpenseSourceActor(db, actor));
    member.branchScopeMode = 'ALL_BRANCHES';
    state.company.status = 'ACTIVE'; state.company.planTerm.tierKey = 'STARTER_249';
    state.company.planTerm.termDisabledAt = null; state.company.planTerm.termEndsAt = new Date(Date.now() + 60000);
    await assertFreeExpenseSourceActor(db, actor);
    member = null;
    await assert.rejects(() => assertFreeExpenseSourceActor(db, actor));
  });

  it('intersects granted permissions and allows only exact source-draft actions', () => {
    assert.deepEqual(freeExpenseDraftPermissions(['expense.update', 'expense.confirm', 'expense.create', 'expense.review', 'expense.receipt.upload', 'ledger.read']),
      ['expense.update', 'expense.receipt.upload']);
    const prefix = '/v1/companies/co/expenses';
    for (const [method, suffix] of [['GET', ''], ['GET', '/expense-id'], ['GET', '/expense-id/history?page=2'], ['PATCH', '/expense-id'], ['POST', '/expense-id/totals-preview'], ['POST', '/receipt-uploads'], ['POST', '/capture-groups/group/files/file/complete'], ['POST', '/capture-groups/group/facts']]) {
      assert.equal(isFreeExpenseDraftRoute(method!, prefix + suffix), true, method + suffix);
    }
    for (const [method, suffix] of [['POST', ''], ['POST', '/expense-id/history'], ['GET', '/expense-id/history/extra'], ['POST', '/expense-id/confirm'], ['POST', '/expense-id/payment'], ['POST', '/expense-id/mark-ready'], ['POST', '/capture-groups/group/handoff'], ['POST', '/capture-groups/group/review'], ['POST', '/capture-groups/group/allocations/a/accept'], ['GET', '/shared-evidence'], ['POST', '/accountant-package'], ['PATCH', '/expense-id/review-fields'], ['DELETE', '/expense-id']]) {
      assert.equal(isFreeExpenseDraftRoute(method!, prefix + suffix), false, method + suffix);
    }
  });
});
