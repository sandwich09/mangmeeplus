import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service';

function serviceFor(member: any) {
  const service = Object.create(BillingService.prototype) as any;
  const queries: any[] = [];
  service.prisma = { client: { companyMembership: { findUnique: async (query: any) => {
    queries.push(query);
    return member;
  } } } };
  return { service, queries };
}

const context = { companyId: 'company-1', userId: 'user-1' } as any;

describe('BillingService company.plan.manage authorization', () => {
  it('allows an active custom-named role that carries the permission', async () => {
    const { service, queries } = serviceFor({
      status: 'ACTIVE', user: { status: 'ACTIVE' },
      roles: [{ role: { permissions: [{ permission: { key: 'company.plan.manage' } }] } }],
    });

    await service.assertOwner(context);

    assert.deepEqual(queries[0].where, { companyId_userId: { companyId: 'company-1', userId: 'user-1' } });
    assert.equal(queries[0].include.roles.where.role.status, 'ACTIVE');
  });

  it('denies missing permissions and inactive membership or user', async () => {
    for (const member of [
      { status: 'ACTIVE', user: { status: 'ACTIVE' }, roles: [{ role: { permissions: [] } }] },
      { status: 'SUSPENDED', user: { status: 'ACTIVE' }, roles: [{ role: { permissions: [{ permission: { key: 'company.plan.manage' } }] } }] },
      { status: 'ACTIVE', user: { status: 'DISABLED' }, roles: [{ role: { permissions: [{ permission: { key: 'company.plan.manage' } }] } }] },
      null,
    ]) {
      const { service } = serviceFor(member);
      await assert.rejects(service.assertOwner(context), ForbiddenException);
    }
  });
});
