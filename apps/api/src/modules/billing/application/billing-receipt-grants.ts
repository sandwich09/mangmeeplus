import type { Prisma } from '../../../generated/prisma/client';
import { hashBilling } from '../domain/billing-policy';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';

type GrantDb = Pick<Prisma.TransactionClient, 'billingReceiptGrant'>;

/** The caller holds partner-ocr-config when reserving, applying, revoking or extending grants. */
export async function paidReceiptBalance(db: GrantDb, companyId: string, billingAccountId: string, now = new Date()) {
  const grants = await db.billingReceiptGrant.findMany({
    where: { companyId, billingAccountId, availableAt: { lte: now }, expiresAt: { gt: now }, revokedAt: null },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, units: true, expiresAt: true, _count: { select: { admissions: true } } },
  });
  const limit = grants.reduce((sum, grant) => sum + grant.units, 0);
  const used = grants.reduce((sum, grant) => sum + grant._count.admissions, 0);
  if (!Number.isSafeInteger(limit) || grants.some((grant) => grant._count.admissions > grant.units)) throw new Error('billing.receipt_balance_corrupt');
  const next = grants.find((grant) => grant._count.admissions < grant.units);
  return { limit, used, remaining: limit - used, nextGrantId: next?.id ?? null,
    expiresAt: (next ?? grants[0])?.expiresAt ?? null };
}

/** Internal apply seam, after financial evidence validation, in the invoice/term/audit transaction. */
export async function grantPaidPackageReceipts(tx: Prisma.TransactionClient, input: {
  companyId: string; billingAccountId: string; sourceKey: string; policyRevisionId: string;
  kind: 'INITIAL' | 'RENEWAL' | 'REPEAT' | 'UPGRADE'; units: number;
  serviceStart: Date; serviceEnd: Date; availableAt: Date; expiresAt: Date;
}) {
  if (!Number.isInteger(input.units) || input.units < 0 || input.units > 2_147_483_647
    || ![input.serviceStart, input.serviceEnd, input.availableAt, input.expiresAt].every((d) => Number.isSafeInteger(d.getTime()))
    || input.serviceStart >= input.serviceEnd || input.availableAt >= input.expiresAt
    || input.expiresAt < input.serviceEnd || !input.sourceKey || !input.policyRevisionId) throw new Error('billing.invalid_receipt_grant');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
  // Lock before any term writes, after OCR's advisory lock: admission inserts hold a Company FK lock.
  await lockPlanTermCompany(tx, input.companyId);
  const account = await tx.billingAccount.findUniqueOrThrow({ where: { id: input.billingAccountId }, select: { companyId: true } });
  if (account.companyId !== input.companyId) throw new Error('billing.receipt_account_mismatch');
  const sourceHash = hashBilling([input.companyId, input.billingAccountId, input.sourceKey, input.policyRevisionId,
    input.kind, input.units, input.serviceStart, input.serviceEnd, input.availableAt, input.expiresAt]);
  const existing = await tx.billingReceiptGrant.findUnique({ where: {
    billingAccountId_sourceKey: { billingAccountId: input.billingAccountId, sourceKey: input.sourceKey },
  } });
  if (existing) {
    if (existing.sourceHash !== sourceHash) throw new Error('billing.receipt_source_changed');
    return existing;
  }
  if (input.kind === 'REPEAT') {
    // Carry only still-valid paid units; lapse/revocation cannot be undone by a later purchase.
    await tx.billingReceiptGrant.updateMany({ where: {
      companyId: input.companyId, billingAccountId: input.billingAccountId, revokedAt: null, kind: { not: 'ADMIN_ADJUSTMENT' },
      availableAt: { lte: input.availableAt }, expiresAt: { gt: input.availableAt, lt: input.expiresAt },
    }, data: { expiresAt: input.expiresAt } });
  }
  const grant = await tx.billingReceiptGrant.create({ data: { ...input, sourceHash } });
  await tx.companyPlanTerm.update({ where: { companyId: input.companyId }, data: {
    billingReceiptAccountId: input.billingAccountId, quotaNoticeSentMonthKey: null,
  } });
  return grant;
}
