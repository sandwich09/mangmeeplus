import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { applyBillingFeaturePlan, billingFeaturePlan, type BillingFeaturePlan } from './billing-feature-entitlements';

const keys = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort();
const starter = new Set<string>(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
type Row = { featureKey: string; enabled: boolean; epoch: number; lastSeq: number; grantOrigin: string | null; updatedAt: Date };
type Transition = { featureKey: string; seq: number; reasonJson: unknown; actorUserId: string; action?: string };

function featureDb(initialRows: Row[] = [], initialTransitions: Transition[] = []) {
  const rows = new Map(initialRows.map(row => [row.featureKey, { ...row }]));
  const transitions = [...initialTransitions];
  const snapshots: { featureKey: string; disableSeq: number }[] = [];
  const commands: unknown[] = [];
  let setVersion: number | null = initialRows.length ? 0 : null;
  let normalization: { status: string; normalizerVersion: number; cohortKind: string } | null = initialRows.length
    ? { status: 'COMPLETED', normalizerVersion: 1, cohortKind: 'LEGACY' } : null;
  const db = {
    companyFeatureEntitlement: {
      findMany: async () => [...rows.values()].sort((a, b) => a.featureKey.localeCompare(b.featureKey)),
      upsert: async ({ where, create, update }: any) => {
        const key = where.companyId_featureKey.featureKey;
        rows.set(key, { ...(rows.get(key) ?? { featureKey: key, grantOrigin: null, updatedAt: new Date() }),
          ...(rows.has(key) ? update : create), updatedAt: new Date() });
      },
    },
    companyEntitlementSet: {
      findUnique: async () => setVersion === null ? null : { setVersion },
      upsert: async () => { setVersion ??= 0; return { setVersion }; },
      updateMany: async ({ where }: any) => {
        if (setVersion !== where.setVersion) return { count: 0 };
        setVersion = where.setVersion + 1;
        return { count: 1 };
      },
    },
    companyEntitlementNormalization: {
      findUnique: async () => normalization,
      create: async ({ data }: any) => { normalization = data; },
    },
    entitlementTransition: {
      findMany: async () => [...transitions].filter(row => row.actorUserId !== 'SYSTEM')
        .sort((a, b) => a.featureKey.localeCompare(b.featureKey) || b.seq - a.seq),
      create: async ({ data }: any) => { transitions.push(data); },
    },
    runoffSnapshot: { create: async ({ data }: any) => { snapshots.push(data); } },
    entitlementCommand: { create: async ({ data }: any) => { commands.push(data); } },
    auditLog: { create: async () => undefined },
    $executeRaw: async () => { throw new Error('no unchanged row should need a raw update in this fixture'); },
  };
  return { db: db as unknown as Parameters<typeof applyBillingFeaturePlan>[0], rows, transitions, snapshots, commands,
    setVersion: () => setVersion, normalization: () => normalization };
}

test('first paid package materializes a zero-row legacy company and fences every removed menu', async () => {
  const state = featureDb();
  const { plan, impact } = await billingFeaturePlan(state.db, 'company');
  assert.equal(impact.removed.length, keys.length - starter.size - 1); // Auto-post was already OFF.
  assert.ok(impact.removed.some(item => item.featureKey === 'reports'));
  assert.ok(!impact.removed.some(item => item.featureKey === 'expense_auto_post'));
  const disabled = await applyBillingFeaturePlan(state.db, 'company', 'invoice', 'owner', plan);
  assert.equal(state.rows.size, keys.length);
  assert.deepEqual([...state.rows.values()].filter(row => row.enabled).map(row => row.featureKey).sort(), [...starter].sort());
  assert.deepEqual(disabled.sort(), impact.removed.map(item => item.featureKey).sort());
  assert.equal(state.snapshots.length, disabled.length);
  assert.equal(state.transitions.length, keys.length);
  assert.equal(state.setVersion(), 1);
  assert.equal(state.normalization()?.cohortKind, 'EXPLICIT');
  assert.equal(state.commands.length, 1);
  await assert.rejects(applyBillingFeaturePlan(state.db, 'company', 'another', 'owner', plan), /สิทธิ์เมนูเดิมยังไม่พร้อม/);
  assert.equal(state.commands.length, 1);
});

test('individual Admin decisions survive paid package conversion while ordinary legacy extras are removed', async () => {
  const rows = keys.map(featureKey => ({ featureKey, enabled: starter.has(featureKey) || ['reports', 'inventory'].includes(featureKey),
    epoch: 0, lastSeq: 0, grantOrigin: 'LEGACY', updatedAt: new Date() }));
  const state = featureDb(rows, [{ featureKey: 'reports', seq: 1, reasonJson: { requestId: 'admin' }, actorUserId: 'admin' }]);
  const { plan, impact } = await billingFeaturePlan(state.db, 'company');
  assert.equal(plan.rows.find(row => row.featureKey === 'reports')?.enabled, true);
  assert.equal(plan.rows.find(row => row.featureKey === 'inventory')?.enabled, false);
  assert.equal(impact.preservedAdmin, 1);
  assert.ok(impact.removed.some(row => row.featureKey === 'inventory'));
  assert.ok(!impact.removed.some(row => row.featureKey === 'reports'));
});

test('an inconsistent Admin exception requires review rather than granting a missing prerequisite', async () => {
  const rows = keys.map(featureKey => ({ featureKey, enabled: starter.has(featureKey), epoch: 0, lastSeq: 0,
    grantOrigin: null, updatedAt: new Date() }));
  rows.find(row => row.featureKey === 'expense_auto_post')!.enabled = true;
  const state = featureDb(rows, [{ featureKey: 'expense_auto_post', seq: 1, reasonJson: { requestId: 'admin' }, actorUserId: 'admin' }]);
  await assert.rejects(billingFeaturePlan(state.db, 'company'), /สิทธิ์เมนูเดิมยังไม่พร้อม/);
  rows.find(row => row.featureKey === 'expense_auto_post')!.enabled = false;
  rows.find(row => row.featureKey === 'company_settings')!.enabled = false;
  const invalidPlatform = featureDb(rows, [{ featureKey: 'company_settings', seq: 1, reasonJson: { requestId: 'old-admin' }, actorUserId: 'admin' }]);
  await assert.rejects(billingFeaturePlan(invalidPlatform.db, 'company'), /สิทธิ์เมนูเดิมยังไม่พร้อม/);
});

test('a damaged paid snapshot stays in review without writing entitlements', async () => {
  const state = featureDb();
  const { plan } = await billingFeaturePlan(state.db, 'company');
  await assert.rejects(applyBillingFeaturePlan(state.db, 'company', 'invoice', 'owner',
    { ...plan, adminOverrideKeys: null } as unknown as BillingFeaturePlan), /สิทธิ์เมนูเดิมยังไม่พร้อม/);
  assert.equal(state.rows.size, 0);
  assert.equal(state.commands.length, 0);
});
