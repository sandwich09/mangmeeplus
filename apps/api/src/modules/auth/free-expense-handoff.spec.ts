import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { resolveLineHandoffTarget } from './domain/logic/line-handoff.logic';
import { ExchangeLineHandoffTokenUseCase } from './application/use-cases/exchange-line-handoff-token.use-case';
import { ExchangeLiffSessionUseCase } from './application/use-cases/exchange-liff-session.use-case';

const companyId = 'free-company', userId = 'free-user', lineUserId = `U${'a'.repeat(32)}`;
const expenses = `/companies/${companyId}/expenses`;
function fixture(targetPath = `${expenses}/draft-1?channel=line#source`) {
  const company = { name: 'ร้านฟรี', status: 'DISABLED', archivedAt: null, disabledAt: new Date(0),
    planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), termDisabledAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null } } as any;
  const state = { paid: false, unavailable: false, sessions: 0, claims: 0, minted: [] as any[] };
  const token = { id: 'handoff', userId, companyId, lineUserId, targetPath, surface: 'expense_draft', status: 'PENDING',
    expiresAt: new Date(Date.now() + 60000), freeExpenseDrafts: true };
  const prisma = { client: {
    lineWebHandoffToken: { findUnique: async () => token, updateMany: async () => { state.claims++; return { count: 1 }; } },
    externalIdentity: { findFirst: async () => ({ id: 'identity', userId, status: 'ACTIVE', user: { status: 'ACTIVE' } }) },
    user: { findUnique: async () => ({ status: 'ACTIVE', credential: null }) },
    companyMembership: { findFirst: async () => ({ id: 'member' }), findMany: async () => [{ companyId, company, roles: [] }] },
    company: { findUnique: async () => company },
    auditLog: { findFirst: async () => ({ actorUserId: null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } }) },
    billingAccount: { findMany: async () => { if (state.unavailable) throw new Error('offline'); return []; } },
    billingInvoice: { findFirst: async () => state.paid ? { id: 'historical-paid-invoice' } : null },
    billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
    lineCompanyContext: { findUnique: async () => null },
  } } as any;
  const handoff = new ExchangeLineHandoffTokenUseCase(prisma,
    { execute: async () => { state.sessions++; return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }; } } as any,
    { getStatus: async () => ({ required: false }) } as any);
  const liff = new ExchangeLiffSessionUseCase(prisma, { lineWebHandoffEnabled: true, sesWebBaseUrl: 'https://example.test' } as any,
    { verify: async () => ({ providerUserId: lineUserId, channelId: 'channel' }) } as any,
    { assertLineLiffSessionAllowed: async () => undefined } as any,
    { execute: async (input: any) => { state.minted.push(input); return { rawToken: 'new-token' }; } } as any,
    { log: async () => undefined } as any);
  return { company, state, handoff, liff };
}

describe('verified free expense LINE browser destinations', () => {
  it('keeps the exact source draft destination through handoff and defaults LIFF to expenses', async () => {
    const { handoff, liff, state } = fixture();
    assert.equal((await handoff.execute({ token: 'opaque' })).targetPath, `${expenses}/draft-1?channel=line#source`);
    await liff.execute({ idToken: 'signed-line-token', companyId });
    assert.equal(state.minted[0].targetPath, expenses);
    const dashboard = fixture(`/companies/${companyId}/dashboard`);
    assert.equal((await dashboard.handoff.execute({ token: 'opaque' })).targetPath, expenses);
  });
  it('uses historical purchase proof at each exchange and ignores a token free flag', async () => {
    const { handoff, liff, state } = fixture(); state.paid = true;
    assert.equal((await handoff.execute({ token: 'opaque' })).targetPath, `/companies/${companyId}/renew`);
    await liff.execute({ idToken: 'signed-line-token' });
    assert.equal(state.minted[0].targetPath, `/companies/${companyId}/renew`);
  });
  it('retains admin/security refusal and fails closed before claim or mint on policy failure', async () => {
    const held = fixture(); held.company.planTerm.termDisabledAt = null;
    await assert.rejects(() => held.handoff.execute({ token: 'opaque' }), ForbiddenException);
    assert.deepEqual(await held.liff.execute({ idToken: 'signed-line-token' }), { reason: 'suspended' });
    assert.equal(held.state.sessions, 0); assert.equal(held.state.claims, 0);
    const failed = fixture(); failed.state.unavailable = true;
    await assert.rejects(() => failed.handoff.execute({ token: 'opaque' }), ServiceUnavailableException);
    await assert.rejects(() => failed.liff.execute({ idToken: 'signed-line-token' }), ServiceUnavailableException);
    assert.equal(failed.state.claims, 0); assert.equal(failed.state.minted.length, 0);
  });
  it('accepts only exact source pages for free landing and preserves recovery, tenant and hold boundaries', () => {
    const { company } = fixture(); const now = new Date();
    for (const path of [expenses, `${expenses}/upload`, `${expenses}/draft-1?channel=line#source`, `/companies/${companyId}/billing?channel=line`, `/companies/${companyId}/renew?attempt=one`]) {
      assert.equal(resolveLineHandoffTarget(companyId, path, company, now, true), path);
    }
    for (const tail of ['manual', 'evidence', 'signatures', 'categories', 'substitute-receipts', 'draft-1/payment', 'capture/group-1', '%6Danual']) {
      assert.equal(resolveLineHandoffTarget(companyId, `${expenses}/${tail}`, company, now, true), expenses);
    }
    assert.equal(resolveLineHandoffTarget(companyId, '/companies/foreign/expenses/draft-1', company, now, true), null);
    assert.equal(resolveLineHandoffTarget(companyId, expenses, { ...company, status: 'SUSPENDED' }, now, true), null);
    assert.equal(resolveLineHandoffTarget(companyId, expenses, { ...company, archivedAt: new Date(), status: 'ACTIVE' }, now, true), null);
    assert.equal(resolveLineHandoffTarget(companyId, expenses, { ...company, planTerm: null }, now, true), null);
    assert.equal(resolveLineHandoffTarget(companyId, expenses, company, now), `/companies/${companyId}/renew`);
  });
});
