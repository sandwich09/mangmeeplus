import assert from 'node:assert/strict';
import { it } from 'node:test';
import { syncPermissions } from './sync-permissions';
import { REIMBURSEMENT_SELF_SERVICE_PERMISSIONS } from '../src/modules/auth/permission-registry';
import { PrismaPermissionResolverRepository } from '../src/modules/access-control/infrastructure/prisma-permission-resolver.repository';

it('backfills old custom/read-only roles idempotently and resolves feature-gated own service without new approval/payment authority', async () => {
  // In-memory materialized RolePermission rows, not a database connection.
  const permissions = new Map<string, { id: string; key: string }>();
  const roles = new Map([
    ['custom-old', { id: 'custom-old', key: 'CUSTOM_ADMIN', scopeKey: 'co-1' }],
    ['readonly-old', { id: 'readonly-old', key: 'CUSTOM_READONLY', scopeKey: 'co-1' }],
  ]);
  const grants = new Map([...roles.keys()].map((id) => [id, new Set(['account.session.read'])]));
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
      findMany: async ({ where }: any) => [...roles.values()].filter((role) => role.scopeKey !== where.scopeKey.not
        && (!where.permissions || grants.get(role.id)!.has(where.permissions.some.permissionId))),
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
  };
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
            roles: [{ role: { key: roles.get(roleId)!.key, permissions: [...held].map((key) => ({ permission: { key } })) } }],
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
