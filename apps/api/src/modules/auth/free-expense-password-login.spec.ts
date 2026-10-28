import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { hashPassword } from './domain/logic/password-credential.logic';
import { PasswordLoginUseCase } from './application/use-cases/password-login.use-case';

const password = 'free-expense-password', passwordHash = hashPassword(password);
function fixture() {
  const state = { paid: false, admin: false, unavailable: false, issued: 0, policyReads: 0 };
  const company = { status: 'DISABLED', archivedAt: null, disabledAt: new Date(0), planTerm: {
    tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), termDisabledAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null,
  } };
  const prisma = { client: {
    user: { findFirst: async () => ({ id: 'user', status: 'ACTIVE', credential: { status: 'ACTIVE', passwordHash,
      mustChangePassword: false, expiresAt: null, updatedAt: new Date(0) } }) },
    companyMembership: { findFirst: async () => ({ id: 'member', companyId: 'co', company,
      roles: [{ role: { key: state.admin ? 'SYSTEM_ADMIN' : 'OWNER' } }] }) },
    company: { findUnique: async () => { state.policyReads++; return company; } },
    auditLog: { findFirst: async () => ({ actorUserId: null, metadataJson: { toStatus: 'DISABLED', reason: 'no_package' } }) },
    billingAccount: { findMany: async () => { if (state.unavailable) throw new Error('policy unavailable'); return []; } },
    billingInvoice: { findFirst: async () => state.paid ? { id: 'historical-paid' } : null },
    billingReceiptGrant: { findFirst: async () => null }, packageChangeRequest: { findFirst: async () => null }, salesAttribution: { findUnique: async () => null },
  } } as any;
  const login = new PasswordLoginUseCase(prisma, { execute: async () => { state.issued++; return { accessToken: 'token', refreshToken: 'refresh', expiresIn: 900 }; } } as any,
    { getStatus: async () => ({ required: false }) } as any);
  return { state, login };
}

describe('free expense password login destination', () => {
  it('starts verified free members at expenses and preserves paid/admin defaults', async () => {
    const free = fixture();
    assert.equal((await free.login.execute('owner', password)).redirectPath, '/companies/co/expenses');
    assert.equal(free.state.issued, 1);
    const paid = fixture(); paid.state.paid = true;
    assert.equal((await paid.login.execute('owner', password)).redirectPath, '/companies/co/dashboard');
    const admin = fixture(); admin.state.admin = true; admin.state.unavailable = true;
    assert.equal((await admin.login.execute('admin', password)).redirectPath, '/system/partners');
    assert.equal(admin.state.policyReads, 0, 'SYSTEM_ADMIN retains its console without company free policy');
  });
  it('refuses policy-read failure before issuing any session', async () => {
    const { login, state } = fixture(); state.unavailable = true;
    await assert.rejects(() => login.execute('owner', password), ServiceUnavailableException);
    assert.equal(state.issued, 0);
  });
});
