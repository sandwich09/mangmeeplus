import assert from 'node:assert/strict';
import { it } from 'node:test';
import { syncPermissions } from './sync-permissions';
import { REIMBURSEMENT_SELF_SERVICE_PERMISSIONS } from '../src/modules/auth/permission-registry';
import { PrismaPermissionResolverRepository } from '../src/modules/access-control/infrastructure/prisma-permission-resolver.repository';
import { CAPABILITY_PACK_BY_KEY } from '../src/modules/employee-access/domain/registries/capability-pack.registry';
import { RecordReimbursementPaymentUseCase } from '../src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case';

type CompanyRole = { id: string; key: string; scopeKey: string; companyId?: string };

/** In-memory materialized RolePermission rows, not a database connection. A permission's id is its key. */
function fakeDb(companyRoles: Array<CompanyRole & { holds: string[] }>, companies = ['co-1']) {
  const permissions = new Map<string, { id: string; key: string }>();
  const roles = new Map<string, CompanyRole>(companyRoles.map(({ holds: _holds, ...role }) => [role.id, role]));
  const grants = new Map(companyRoles.map((role) => [role.id, new Set(role.holds)]));
  const audits: any[] = [];
  const prisma = {
    permission: {
      upsert: async ({ create }: any) => { permissions.set(create.key, { id: create.key, key: create.key }); },
      findMany: async () => [...permissions.values()],
    },
    role: {
      upsert: async ({ create }: any) => {
        roles.set(create.key, { id: create.key, key: create.key, scopeKey: create.scopeKey });
        if (!grants.has(create.key)) grants.set(create.key, new Set());
      },
      findUniqueOrThrow: async ({ where }: any) => roles.get(where.scopeKey_key.key),
      findMany: async ({ where, select }: any) => [...roles.values()].filter((role) => role.scopeKey !== where.scopeKey.not
        && (!where.permissions || grants.get(role.id)!.has(where.permissions.some.permissionId)))
        .map((role) => ({ id: role.id, companyId: role.companyId ?? null,
          permissions: grants.get(role.id)!.has(select.permissions.where.permissionId) ? [{ permissionId: select.permissions.where.permissionId }] : [] })),
    },
    rolePermission: {
      upsert: async ({ create }: any) => { grants.get(create.roleId)!.add(create.permissionId); },
      deleteMany: async ({ where }: any) => {
        const held = grants.get(where.roleId)!;
        const removed = [...held].filter((key) => !where.permissionId.notIn.includes(key));
        for (const key of removed) held.delete(key);
        return { count: removed.length };
      },
      createMany: async ({ data, skipDuplicates }: any) => {
        assert.equal(skipDuplicates, true);
        let count = 0;
        for (const { roleId, permissionId } of data) {
          const held = grants.get(roleId)!;
          if (!held.has(permissionId)) { held.add(permissionId); count += 1; }
        }
        return { count };
      },
    },
    company: { findMany: async ({ where }: any) => companies.filter((id) => where.id.in.includes(id)).map((id) => ({ id })) },
    auditLog: { createMany: async ({ data }: any) => { audits.push(...data); return { count: data.length }; } },
    // The grant and its audit rows go in one batch transaction.
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return { prisma: prisma as any, roles, grants, audits };
}

it('backfills old custom/read-only roles idempotently and resolves feature-gated own service without new approval/payment authority', async () => {
  const { prisma, roles, grants } = fakeDb([
    { id: 'custom-old', key: 'CUSTOM_ADMIN', scopeKey: 'co-1', holds: ['account.session.read'] },
    { id: 'readonly-old', key: 'CUSTOM_READONLY', scopeKey: 'co-1', holds: ['account.session.read'] },
  ]);
  await syncPermissions(prisma as any, () => undefined);
  const first = [...grants].map(([id, held]) => [id, [...held].sort()]);
  await syncPermissions(prisma as any, () => undefined);
  assert.deepEqual([...grants].map(([id, held]) => [id, [...held].sort()]), first);

  for (const roleId of ['ADMIN', 'COMPANY_VIEW', 'AUDITOR_READONLY', 'custom-old', 'readonly-old']) {
    const held = grants.get(roleId)!;
    for (const key of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) assert.ok(held.has(key), `${roleId}: ${key}`);
    for (const enabled of [true, false]) {
      const resolver = new PrismaPermissionResolverRepository({ client: {
        companyMembership: { findFirst: async ({ where }: any) => {
          assert.deepEqual(where, { userId: 'u-1', companyId: 'co-1', status: 'ACTIVE' });
          return { id: 'm-1', companyId: 'co-1', company: { status: 'ACTIVE' },
            branchScopeMode: 'ALL_BRANCHES', branchScopes: [],
            // The resolver authorizes only ACTIVE roles (since 2026-09-12); a role row always carries its status.
            roles: [{ role: { key: roles.get(roleId)!.key, status: 'ACTIVE', permissions: [...held].map((key) => ({ permission: { key } })) } }],
          };
        } },
        companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'reimbursement', enabled }] },
      } } as any);
      const result = await resolver.resolveForUser({ userId: 'u-1', companyId: 'co-1' });
      assert.ok(result.permissions.includes('reimbursement.read_own'));
      for (const key of ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.cancel_own']) {
        assert.equal(result.permissions.includes(key), enabled, `${roleId} ${key}, feature=${enabled}`);
        if (!enabled) assert.equal(result.entitlementDeniedPermissions?.[key], 'reimbursement');
      }
    }
    if (roleId !== 'ADMIN') {
      for (const key of ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.finance_review',
        'reimbursement.payment.record', 'reimbursement.payment.void', 'reimbursement.policy.manage']) {
        assert.equal(held.has(key), false, `${roleId}: ${key}`);
      }
    }
    if (roleId.endsWith('-old')) assert.equal(held.has('reimbursement.read'), false);
  }
  for (const key of REIMBURSEMENT_SELF_SERVICE_PERMISSIONS) assert.equal(grants.get('SYSTEM_ADMIN')!.has(key), false);
});

// Payout-account spec §13.3 F1 (AC28), owner decision 2026-10-01: a role that approves claims also records and voids
// their payment. Roles saved before pack.reimbursement.approve carried the two keys approved and could not pay.
it('adds the pay and void rights to company roles that approve reimbursements, audits each grant once, and the API then takes the approver\'s payment', async () => {
  const PAY = ['reimbursement.payment.record', 'reimbursement.payment.void'];
  const approve = CAPABILITY_PACK_BY_KEY.get('pack.reimbursement.approve')!.permissionKeys.filter((key) => !PAY.includes(key));
  assert.ok(approve.includes('reimbursement.approve'));
  const { prisma, roles, grants, audits } = fakeDb([
    { id: 'approver-old', key: 'CUSTOM_APPROVER', scopeKey: 'co-1', companyId: 'co-1', holds: approve },
    // A system role another company edited after the record right existed, before the void right did.
    { id: 'manager-fork', key: 'MANAGER', scopeKey: 'co-2', companyId: 'co-2', holds: [...approve, PAY[0]!] },
    { id: 'reviewer', key: 'CUSTOM_REVIEWER', scopeKey: 'co-1', companyId: 'co-1', holds: ['reimbursement.read', 'reimbursement.finance_review'] },
    { id: 'staff', key: 'CUSTOM_STAFF', scopeKey: 'co-1', companyId: 'co-1', holds: ['account.session.read'] },
    // The company row is gone; Role.companyId is not a foreign key, AuditLog.companyId is.
    { id: 'orphan', key: 'CUSTOM_APPROVER', scopeKey: 'co-gone', companyId: 'co-gone', holds: approve },
  ], ['co-1', 'co-2']);

  /** The API's answer for a member holding only this role: resolve as every request does, then record a payment. */
  const pays = async (roleId: string) => {
    const access = await new PrismaPermissionResolverRepository({ client: {
      companyMembership: { findFirst: async () => ({ id: 'm-1', companyId: 'co-1', company: { status: 'ACTIVE' }, branchScopeMode: 'ALL_BRANCHES', branchScopes: [],
        roles: [{ role: { key: roles.get(roleId)!.key, status: 'ACTIVE', permissions: [...grants.get(roleId)!].map((key) => ({ permission: { key } })) } }] }) },
      companyFeatureEntitlement: { findMany: async () => [] },
    } } as any).resolveForUser({ userId: 'approver-1', companyId: 'co-1' });
    const day = new Date('2026-10-01T03:00:00.000Z');
    const claim = { id: 'rb-1', companyId: 'co-1', branchId: 'b1', requestNo: 'RB-202610-000001', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'ผู้เบิก',
      createdByUserId: 'staff-1', reason: 'แท็กซี่', categoryKey: 'travel', amount: '500.0000', currency: 'THB', incurredDate: day, status: 'READY_FOR_PAYMENT',
      financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED', postingStatus: 'pending',
      paymentTotalAmount: '0.0000', outstandingAmount: '500.0000', createdAt: day, updatedAt: day, lines: [], approvalSteps: [], payments: [], duplicateCandidates: [] };
    const repo = {
      findRequestById: async () => claim, findPolicy: async () => null, assertClaimPaymentReady: async () => undefined, listOpenDuplicateCandidates: async () => [],
      getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [],
      recordPaymentAtomic: async (data: any) => ({ created: true, payment: { id: 'pay-1', ...data, status: 'RECORDED', postingStatus: 'pending' },
        request: { ...claim, status: 'PAID', paymentStatus: 'PAID' } }),
    };
    const paid = await new RecordReimbursementPaymentUseCase(repo as any, { log: async () => undefined } as any, { append: async () => undefined } as any,
      { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202610-000001' }) } as any, { execute: async () => undefined } as any,
      { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any,
    ).execute({ requestId: 'req-1', authSubject: 's', authProvider: 'dev', userId: 'approver-1', ...access } as any, 'rb-1',
      { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: day.toISOString() });
    return paid.status;
  };

  // Before the sync: the approver role is refused, which is how its claims stopped at จ่ายเงินคืน.
  await assert.rejects(pays('approver-old'), /Missing permission: reimbursement\.payment\.record/);

  const report: string[] = [];
  await syncPermissions(prisma, (line) => report.push(line));
  const first = [...grants].map(([id, held]) => [id, [...held].sort()]);
  for (const roleId of ['approver-old', 'manager-fork', 'orphan']) for (const key of PAY) assert.ok(grants.get(roleId)!.has(key), `${roleId}: ${key}`);
  // No approve, no pay: a finance reviewer and a plain member are not widened.
  for (const roleId of ['reviewer', 'staff']) for (const key of PAY) assert.equal(grants.get(roleId)!.has(key), false, `${roleId}: ${key}`);
  assert.match(report.join('\n'), /reimbursement\.payment\.record: \+2 of 3 matching company roles \(anchor reimbursement\.approve\)/);
  assert.match(report.join('\n'), /reimbursement\.payment\.void: \+3 of 3 matching company roles \(anchor reimbursement\.approve\)/);

  // The same role, resolved and used the way a request is: the API now takes the payment; a reviewer is still refused.
  assert.equal(await pays('approver-old'), 'PAID');
  await assert.rejects(pays('reviewer'), /Missing permission: reimbursement\.payment\.record/);

  // One audit row per role and key actually granted, in that role's company, made by the system.
  const payAudits = audits.filter((row) => PAY.includes(row.metadataJson.addedPermissionKeys[0]));
  assert.deepEqual(payAudits.map((row) => [row.targetId, row.metadataJson.addedPermissionKeys[0], row.companyId]).sort(), [
    ['approver-old', PAY[0], 'co-1'], ['approver-old', PAY[1], 'co-1'], ['manager-fork', PAY[1], 'co-2'],
    ['orphan', PAY[0], null], ['orphan', PAY[1], null],
  ].sort());
  assert.deepEqual(payAudits[0], {
    companyId: 'co-1', actorType: 'SYSTEM', action: 'access.role.update', targetType: 'Role', targetId: 'approver-old',
    requestId: 'sync-permissions:reimbursement.payment.record', result: 'SUCCESS', riskLevel: 'HIGH',
    metadataJson: { source: 'sync-permissions', addedPermissionKeys: ['reimbursement.payment.record'], anchor: 'reimbursement.approve' },
  });

  // A second deploy grants nothing and writes no audit row.
  const auditCount = audits.length;
  report.length = 0;
  await syncPermissions(prisma, (line) => report.push(line));
  assert.deepEqual([...grants].map(([id, held]) => [id, [...held].sort()]), first);
  assert.equal(audits.length, auditCount);
  assert.match(report.join('\n'), /reimbursement\.payment\.record: \+0 of 3 matching company roles/);
});
