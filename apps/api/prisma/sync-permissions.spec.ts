import assert from 'node:assert/strict';
import { it } from 'node:test';
import { syncPermissions } from './sync-permissions';
import { PERMISSIONS, REIMBURSEMENT_SELF_SERVICE_PERMISSIONS } from '../src/modules/auth/permission-registry';
import { COMPANY_ROLE_BACKFILLS } from '../src/modules/employee-access/domain/registries/company-role-backfill.registry';
import { PrismaPermissionResolverRepository } from '../src/modules/access-control/infrastructure/prisma-permission-resolver.repository';
import { CAPABILITY_PACK_BY_KEY } from '../src/modules/employee-access/domain/registries/capability-pack.registry';
import { RecordReimbursementPaymentUseCase } from '../src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case';

type CompanyRole = { id: string; key: string; scopeKey: string; companyId?: string };

it('syncs the global WHT catalog key to SYSTEM_ADMIN only and preserves that result on retry', async () => {
  const { prisma, grants } = fakeDb([{ id: 'custom-owner', key: 'CUSTOM_OWNER', scopeKey: 'co-1', holds: ['tax.config.manage'] }]);
  for (let run = 0; run < 2; run++) {
    await syncPermissions(prisma, () => undefined);
    assert.deepEqual([...grants].filter(([, held]) => held.has('system.wht_income_category.manage')).map(([id]) => id), ['SYSTEM_ADMIN']);
  }
});

it('syncs disbursement keys and system grants without backfilling existing company roles', async () => {
  const keys = [
    'expense.disbursement.read', 'expense.disbursement.prepare', 'expense.disbursement.approve',
    'expense.disbursement.pay', 'expense.disbursement.issue',
  ];
  const { prisma, permissions, grants } = fakeDb([
    { id: 'custom-expense-role', key: 'CUSTOM_EXPENSE', scopeKey: 'co-1', holds: ['expense.confirm', 'expense.payment.record'] },
  ]);
  await syncPermissions(prisma, () => undefined);
  for (const key of keys) assert.ok(permissions.has(key), `${key} was not registered in the permission table`);
  for (const role of ['OWNER', 'ADMIN', 'FINANCE']) for (const key of keys) assert.ok(grants.get(role)?.has(key), `${role}: ${key}`);
  for (const role of ['MANAGER']) for (const key of ['expense.disbursement.read', 'expense.disbursement.approve']) assert.ok(grants.get(role)?.has(key), `${role}: ${key}`);
  for (const role of ['ACCOUNTANT']) for (const key of ['expense.disbursement.read', 'expense.disbursement.issue']) assert.ok(grants.get(role)?.has(key), `${role}: ${key}`);
  assert.equal(keys.some((key) => grants.get('custom-expense-role')?.has(key)), false);
});

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
    // The read of who gains a key, the grant and its audit rows share one serializable transaction.
    $transaction: async (work: (tx: unknown) => Promise<unknown>, options: any) => {
      assert.equal(options.isolationLevel, 'Serializable');
      return work(tx);
    },
  };
  // Where the company roles are read from: the transaction that grants, or the bare client before it.
  const roleReads = { outside: 0, inside: 0 };
  const findRoles = prisma.role.findMany;
  prisma.role.findMany = async (args: any) => { roleReads.outside += 1; return findRoles(args); };
  const tx = {
    ...prisma,
    role: { ...prisma.role, findMany: async (args: any) => { roleReads.inside += 1; return findRoles(args); } },
    // The record of earlier grants is read in the granting transaction only: the bare client has no such read.
    auditLog: { ...prisma.auditLog, findMany: async ({ where, select }: any) => {
      assert.deepEqual([Object.keys(where).sort(), select], [['action', 'requestId', 'targetType'], { targetId: true }]);
      return audits.filter((row) => row.requestId === where.requestId && row.action === where.action && row.targetType === where.targetType)
        .map((row) => ({ targetId: row.targetId }));
    } },
  };
  return { prisma: prisma as any, roles, grants, audits, roleReads, permissions };
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
        company: { findUnique: async () => null },
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
      company: { findUnique: async () => null },
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
      findRequestById: async () => claim, findPolicy: async () => null, assertClaimPaymentReady: async () => undefined, assertPaymentRecordInput: async () => undefined, listOpenDuplicateCandidates: async () => [],
      getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [],
      recordPaymentAtomic: async (data: any) => ({ created: true, payment: { id: 'pay-1', ...data, status: 'RECORDED', postingStatus: 'pending' },
        request: { ...claim, status: 'PAID', paymentStatus: 'PAID' } }),
    };
    const paid = await new RecordReimbursementPaymentUseCase(repo as any, { log: async () => undefined } as any,
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
    companyId: 'co-1', actorType: 'SYSTEM', actorRefId: 'sync-permissions', action: 'access.role.update', targetType: 'Role', targetId: 'approver-old',
    requestId: 'sync-permissions:reimbursement.payment.record', result: 'SUCCESS', riskLevel: 'HIGH',
    metadataJson: { source: 'sync-permissions', addedPermissionKeys: ['reimbursement.payment.record'], anchor: 'reimbursement.approve' },
  });
  // Before: every row said HIGH. The void right is CRITICAL in the registry, and so is the row that grants it.
  assert.deepEqual([...new Set(payAudits.filter((row) => row.metadataJson.addedPermissionKeys[0] === PAY[1]).map((row) => row.riskLevel))], ['CRITICAL']);

  // A second deploy grants nothing and writes no audit row.
  const auditCount = audits.length;
  report.length = 0;
  await syncPermissions(prisma, (line) => report.push(line));
  assert.deepEqual([...grants].map(([id, held]) => [id, [...held].sort()]), first);
  assert.equal(audits.length, auditCount);
  assert.match(report.join('\n'), /reimbursement\.payment\.record: \+0 of 3 matching company roles/);
});

// Review follow-up 2026-10-01: the audit claim covers every back-fill, not only the two pay keys. Whatever key the
// sync adds to a company role is audited once, by the system, at the level the registry gives that key.
it('audits every key it adds to a company role: one row per role and key, the registry\'s risk level, the system as actor, read inside the transaction', async () => {
  const before: Array<CompanyRole & { holds: string[] }> = [
    // Saved long ago: gains every universal key, and nothing anchored.
    { id: 'custom-old', key: 'CUSTOM_ADMIN', scopeKey: 'co-1', companyId: 'co-1', holds: ['account.session.read'] },
    // Holds three anchors: gains their keys too.
    { id: 'finance-old', key: 'CUSTOM_FINANCE', scopeKey: 'co-2', companyId: 'co-2',
      holds: ['account.session.read', 'expense.read', 'expense.void', 'reimbursement.approve', 'dashboard.read'] },
    { id: 'orphan', key: 'CUSTOM_ADMIN', scopeKey: 'co-gone', companyId: 'co-gone', holds: ['reimbursement.approve'] },
  ];
  const { prisma, grants, audits, roleReads } = fakeDb(before, ['co-1', 'co-2']);
  await syncPermissions(prisma, () => undefined);

  const added = before.flatMap((role) => [...grants.get(role.id)!].filter((key) => !role.holds.includes(key)).map((key) => `${role.id} ${key}`));
  assert.ok(added.includes('custom-old dashboard.read') && added.includes('finance-old expense.delete') && added.includes('orphan reimbursement.payment.void'));
  assert.equal(added.includes('finance-old dashboard.read'), false, 'a key the role already held is not granted again');
  // One audit row for each grant, and none for anything else.
  assert.deepEqual(audits.map((row) => `${row.targetId} ${row.metadataJson.addedPermissionKeys.join(',')}`).sort(), [...added].sort());
  const riskLevels = new Map(PERMISSIONS.map((permission) => [permission.key, permission.riskLevel]));
  const companyOf = Object.fromEntries(before.map((role) => [role.id, role.companyId === 'co-gone' ? null : role.companyId]));
  for (const row of audits) {
    const key = row.metadataJson.addedPermissionKeys[0];
    assert.deepEqual(
      [row.actorType, row.actorRefId, row.actorUserId, row.action, row.targetType, row.result, row.riskLevel, row.companyId, row.requestId, row.metadataJson.source],
      ['SYSTEM', 'sync-permissions', undefined, 'access.role.update', 'Role', 'SUCCESS', riskLevels.get(key), companyOf[row.targetId], `sync-permissions:${key}`, 'sync-permissions'],
      `${row.targetId} ${key}`,
    );
  }
  // The levels really differ by key: the same HIGH for all would pass nothing here.
  const levelOf = (key: string) => audits.find((row) => row.metadataJson.addedPermissionKeys[0] === key)!.riskLevel;
  assert.deepEqual([levelOf('reimbursement.payment.void'), levelOf('reimbursement.payment.record'), levelOf('account.password.change'), levelOf('dashboard.read')],
    ['CRITICAL', 'HIGH', 'MEDIUM', riskLevels.get('dashboard.read')]);
  assert.equal(levelOf('expense.delete'), 'CRITICAL');

  // Who gains a key is read inside the transaction that grants it: one read per back-fill, none before it.
  assert.deepEqual(roleReads, { outside: 0, inside: COMPANY_ROLE_BACKFILLS.length });

  // A second deploy grants nothing and audits nothing.
  const auditCount = audits.length;
  await syncPermissions(prisma, () => undefined);
  assert.equal(audits.length, auditCount);
});

// Review 2026-10-01, owner decision: a back-fill grants a key to a role once. Before, a company whose admin had
// taken the pay right off an approver role got it back on every deploy, with no way to make the removal stick.
it('grants a key to a role once: a right the company\'s admin removes afterwards is not granted again on a later deploy', async () => {
  const PAY = ['reimbursement.payment.record', 'reimbursement.payment.void'];
  const approve = CAPABILITY_PACK_BY_KEY.get('pack.reimbursement.approve')!.permissionKeys.filter((key) => !PAY.includes(key));
  const { prisma, roles, grants, audits } = fakeDb([
    { id: 'approver-old', key: 'CUSTOM_APPROVER', scopeKey: 'co-1', companyId: 'co-1', holds: approve },
  ]);
  await syncPermissions(prisma, () => undefined);
  const held = grants.get('approver-old')!;
  assert.deepEqual([...PAY, 'dashboard.read'].map((key) => held.has(key)), [true, true, true]);

  // The company's admin removes the record right and the dashboard from the role, and keeps approve and void.
  held.delete(PAY[0]!);
  held.delete('dashboard.read');
  // A role saved after that deploy, which never held the pay right, is still owed its first grant.
  roles.set('approver-new', { id: 'approver-new', key: 'CUSTOM_APPROVER_2', scopeKey: 'co-1', companyId: 'co-1' });
  grants.set('approver-new', new Set(approve));
  const before = audits.length;
  const report: string[] = [];
  await syncPermissions(prisma, (line) => report.push(line));

  // The removal is respected, for an anchored key and for a universal one alike; nothing the admin left is touched.
  assert.deepEqual([PAY[0]!, 'dashboard.read', PAY[1]!, 'reimbursement.approve'].map((key) => held.has(key)), [false, false, true, true]);
  for (const key of PAY) assert.ok(grants.get('approver-new')!.has(key), `approver-new: ${key}`);
  // Only the new role is written and audited, and the report says how many roles gained each key.
  const written = audits.slice(before);
  assert.deepEqual([...new Set(written.map((row) => row.targetId))], ['approver-new']);
  assert.equal(written.some((row) => row.metadataJson.addedPermissionKeys[0] === PAY[0]), true);
  assert.match(report.join('\n'), /reimbursement\.payment\.record: \+1 of 2 matching company roles \(anchor reimbursement\.approve\)/);

  // And it stays that way: a third deploy grants nothing and writes nothing.
  const settled = audits.length;
  await syncPermissions(prisma, () => undefined);
  assert.deepEqual([held.has(PAY[0]!), held.has('dashboard.read'), audits.length], [false, false, settled]);
});
