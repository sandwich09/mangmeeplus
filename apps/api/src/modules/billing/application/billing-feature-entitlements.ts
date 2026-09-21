import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_CATALOG, FEATURE_PACKAGE_PRESETS, PLATFORM_INVARIANT_FEATURE_KEYS, parentFeatureKey, requiredFeatureKeys,
  type BillingFeatureImpact } from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { evaluateEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { isCurrentEntitlementNormalization, NORMALIZER_VERSION, SYSTEM_ACTOR } from '../../employee-access/application/normalize-entitlements';
import { buildRunoffRoots } from '../../feature-launch/application/runoff-lifecycle';
import { billingError, hashBilling } from '../domain/billing-policy';

type FeatureDb = Pick<Prisma.TransactionClient, 'companyFeatureEntitlement' | 'companyEntitlementSet' |
  'companyEntitlementNormalization' | 'entitlementTransition'>;
const VERSION = 1;
const CANONICAL = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort();
const LABELS = new Map(FEATURE_CATALOG.flatMap(feature => [
  [feature.key, feature.labelTh] as const,
  ...feature.submenus.map(submenu => [submenu.key, `${feature.labelTh} · ${submenu.labelTh}`] as const),
]));
const review = () => billingError('BILLING_ENTITLEMENT_REVIEW_REQUIRED', 'ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมงานก่อนชำระเงิน');
const billingTransition = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value) &&
  (value as Record<string, unknown>).source === 'BILLING_PACKAGE';

export type BillingFeaturePlan = {
  version: 1; sourceHash: string; planHash: string; setVersion: number | null;
  rows: { featureKey: string; enabled: boolean }[]; adminOverrideKeys: string[];
};

export function billingFeaturePlanHash(plan: Omit<BillingFeaturePlan, 'planHash'>): string {
  return hashBilling([plan.version, plan.sourceHash, plan.setVersion, plan.rows.map(row => [row.featureKey, row.enabled]), plan.adminOverrideKeys]);
}

/**
 * `targetFeatureKeys` is the menu set the package being paid for grants. A catalog purchase keeps
 * the starter preset (unchanged behaviour); a sales deal passes its own `featureKeys` (R-676-1),
 * and the plan hash pins those rows into the quote so the apply cannot drift from them.
 */
export async function billingFeaturePlan(db: FeatureDb, companyId: string,
  targetFeatureKeys: readonly string[] = FEATURE_PACKAGE_PRESETS.starter.featureKeys): Promise<{ plan: BillingFeaturePlan; impact: BillingFeatureImpact }> {
  const [rows, set, normalization, transitions] = await Promise.all([
    db.companyFeatureEntitlement.findMany({ where: { companyId },
      select: { featureKey: true, enabled: true, epoch: true, lastSeq: true, grantOrigin: true } }),
    db.companyEntitlementSet.findUnique({ where: { companyId }, select: { setVersion: true } }),
    db.companyEntitlementNormalization.findUnique({ where: { companyId }, select: { status: true, normalizerVersion: true, cohortKind: true } }),
    db.entitlementTransition.findMany({ where: { companyId, actorUserId: { not: SYSTEM_ACTOR } },
      orderBy: [{ featureKey: 'asc' }, { seq: 'desc' }], select: { featureKey: true, reasonJson: true } }),
  ]);
  rows.sort((a, b) => a.featureKey < b.featureKey ? -1 : a.featureKey > b.featureKey ? 1 : 0);
  const untouchedLegacy = rows.length === 0 && !normalization && !set && transitions.length === 0;
  if (!untouchedLegacy && (!isCurrentEntitlementNormalization(normalization) || !set || rows.length !== CANONICAL.length ||
    rows.some((row, index) => row.featureKey !== CANONICAL[index]))) throw review();

  const stored = new Map(rows.map(row => [row.featureKey, row]));
  const latest = new Map<string, (typeof transitions)[number]>();
  for (const transition of transitions) if (!latest.has(transition.featureKey)) latest.set(transition.featureKey, transition);
  const adminOverrideKeys = [...latest].filter(([key, transition]) => !billingTransition(transition.reasonJson) && stored.has(key))
    .map(([key]) => key).sort();
  const overrides = new Set(adminOverrideKeys);
  // Platform invariants are not sellable menus: a target that leaves them out still gets them.
  const wanted = new Set(targetFeatureKeys);
  const target = new Map(CANONICAL.map(featureKey => [featureKey,
    wanted.has(featureKey) || PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(featureKey))]));
  // A target may name a child without its parent; the package grants what the child implies.
  // (A no-op for the starter preset, which is already closed under `requiredFeatureKeys`.)
  for (const key of CANONICAL) if (target.get(key)) for (const required of requiredFeatureKeys(key)) target.set(required, true);
  for (const key of adminOverrideKeys) target.set(key, stored.get(key)!.enabled);
  // A separately granted child needs its parent; an explicit Admin deny wins and requires review.
  for (const key of adminOverrideKeys) {
    if (!target.get(key)) continue;
    const parent = parentFeatureKey(key);
    if (parent !== key && !target.get(parent)) {
      if (overrides.has(parent) || !stored.get(parent)?.enabled) throw review();
      target.set(parent, true);
    }
  }
  for (const key of CANONICAL) {
    if (!target.get(key)) continue;
    for (const required of requiredFeatureKeys(key)) {
      if (target.get(required)) continue;
      if (overrides.has(required) || !stored.get(required)?.enabled) throw review();
      target.set(required, true);
    }
  }
  if ([...target].some(([key, enabled]) => !enabled && PLATFORM_INVARIANT_FEATURE_KEYS.includes(parentFeatureKey(key)))) throw review();
  const current = evaluateEntitledFeatureKeys(rows);
  const effectiveOn = (key: string) => key === 'expense_auto_post' && !stored.get(key)?.enabled ? false :
    current === null || (current.has(key) && current.has(parentFeatureKey(key)));
  const planRows = CANONICAL.map(featureKey => ({ featureKey, enabled: target.get(featureKey) === true }));
  const removed = planRows.filter(row => !row.enabled && effectiveOn(row.featureKey))
    .map(row => ({ featureKey: row.featureKey, labelTh: LABELS.get(row.featureKey) ?? row.featureKey }));
  const added = planRows.filter(row => row.enabled && !effectiveOn(row.featureKey))
    .map(row => ({ featureKey: row.featureKey, labelTh: LABELS.get(row.featureKey) ?? row.featureKey }));
  const sourceHash = hashBilling([normalization?.status ?? null, normalization?.normalizerVersion ?? null,
    normalization?.cohortKind ?? null, set?.setVersion ?? null,
    rows.map(row => [row.featureKey, row.enabled, row.epoch, row.lastSeq, row.grantOrigin]), adminOverrideKeys]);
  const partial = { version: VERSION, sourceHash, setVersion: set?.setVersion ?? null, rows: planRows, adminOverrideKeys } as const;
  return { plan: { ...partial, rows: planRows, adminOverrideKeys, planHash: billingFeaturePlanHash(partial) },
    impact: { removed, added, preservedAdmin: adminOverrideKeys.length } };
}

/** Caller holds OCR, entitlement and Company locks; all rights and invoice writes share one transaction. */
export async function applyBillingFeaturePlan(tx: Prisma.TransactionClient, companyId: string, invoiceId: string,
  ownerUserId: string, pinned: BillingFeaturePlan): Promise<string[]> {
  if (!pinned || pinned.version !== VERSION || !Array.isArray(pinned.rows) || !Array.isArray(pinned.adminOverrideKeys) ||
    pinned.rows.length !== CANONICAL.length ||
    pinned.rows.some((row, index) => !row || row.featureKey !== CANONICAL[index] || typeof row.enabled !== 'boolean') ||
    pinned.adminOverrideKeys.some((key, index) => !CANONICAL.includes(key) || (index > 0 && key <= pinned.adminOverrideKeys[index - 1]!)) ||
    billingFeaturePlanHash(pinned) !== pinned.planHash) throw review();
  const current = await billingFeaturePlan(tx, companyId);
  if (current.plan.sourceHash !== pinned.sourceHash || current.plan.adminOverrideKeys.join('\0') !== pinned.adminOverrideKeys.join('\0')) throw review();
  const rows = await tx.companyFeatureEntitlement.findMany({ where: { companyId },
    select: { featureKey: true, enabled: true, epoch: true, lastSeq: true, grantOrigin: true } });
  const stored = new Map(rows.map(row => [row.featureKey, row]));
  const entitled = evaluateEntitledFeatureKeys(rows);
  const wasOn = (key: string) => key === 'expense_auto_post' && !stored.get(key)?.enabled ? false :
    entitled === null || (entitled.has(key) && entitled.has(parentFeatureKey(key)));
  const set = await tx.companyEntitlementSet.upsert({ where: { companyId }, create: { companyId }, update: {}, select: { setVersion: true } });
  if (set.setVersion !== (pinned.setVersion ?? 0)) throw review();
  const bumped = await tx.companyEntitlementSet.updateMany({ where: { companyId, setVersion: set.setVersion },
    data: { setVersion: { increment: 1 }, lastTransitionAt: new Date() } });
  if (bumped.count !== 1) throw review();
  const disabled: string[] = [], cutoffAt = new Date(), admin = new Set(pinned.adminOverrideKeys);
  for (const target of pinned.rows) {
    if (admin.has(target.featureKey)) continue;
    const old = stored.get(target.featureKey), seq = (old?.lastSeq ?? 0) + 1;
    const epoch = (target.enabled && !wasOn(target.featureKey) ? 1 : 0) + (old?.epoch ?? 0);
    const changed = !old || old.enabled !== target.enabled;
    if (changed) await tx.companyFeatureEntitlement.upsert({ where: { companyId_featureKey: { companyId, featureKey: target.featureKey } },
      create: { companyId, featureKey: target.featureKey, enabled: target.enabled, epoch, lastSeq: seq },
      update: { enabled: target.enabled, epoch, lastSeq: seq, grantOrigin: null, updatedBySystemAdminUserId: null } });
    else await tx.$executeRaw(Prisma.sql`UPDATE "CompanyFeatureEntitlement" SET "lastSeq"=${seq},"grantOrigin"=NULL,"updatedBySystemAdminUserId"=NULL
      WHERE "companyId"=${companyId} AND "featureKey"=${target.featureKey}`);
    const realDisable = !target.enabled && wasOn(target.featureKey);
    await tx.entitlementTransition.create({ data: { companyId, featureKey: target.featureKey, seq, epoch,
      commandId: `billing-package:${invoiceId}`, action: target.enabled ? 'ENABLE' : realDisable ? 'DISABLE_REQUESTED' : 'OFF',
      actorUserId: SYSTEM_ACTOR, reasonJson: { source: 'BILLING_PACKAGE', invoiceId, initiatingUserId: ownerUserId, fromEnabled: wasOn(target.featureKey),
        toEnabled: target.enabled, unchanged: !changed } } });
    if (realDisable) {
      disabled.push(target.featureKey);
      await tx.runoffSnapshot.create({ data: { companyId, featureKey: target.featureKey, disableSeq: seq, cutoffAt,
        rootsJson: buildRunoffRoots(target.featureKey) as unknown as Prisma.InputJsonValue } });
    }
  }
  if (pinned.setVersion === null) await tx.companyEntitlementNormalization.create({ data: { companyId, status: 'COMPLETED',
    normalizerVersion: NORMALIZER_VERSION, cohortKind: 'EXPLICIT', snapshotHash: hashBilling(pinned.rows),
    runId: `billing:${invoiceId}`, completedAt: new Date() } });
  const saved = await tx.companyFeatureEntitlement.findMany({ where: { companyId }, select: { featureKey: true, enabled: true, updatedAt: true },
    orderBy: { featureKey: 'asc' } });
  await tx.entitlementCommand.create({ data: { companyId, commandId: `billing-package:${invoiceId}`, payloadFingerprint: pinned.planHash,
    expectedSetVersion: set.setVersion, resultSetVersion: set.setVersion + 1,
    resultJson: { companyId, setVersion: set.setVersion + 1,
      features: saved.map(row => ({ featureKey: row.featureKey, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() })), cascadedOffKeys: [] } } });
  await tx.auditLog.create({ data: { companyId, actorUserId: ownerUserId, action: 'billing.entitlements.applied',
    targetType: 'BillingInvoice', targetId: invoiceId, requestId: invoiceId, result: 'SUCCESS', riskLevel: 'CRITICAL',
    metadataJson: { planHash: pinned.planHash, version: pinned.version, disabled, adminOverrideKeys: pinned.adminOverrideKeys } } });
  return disabled;
}
