import type { Prisma } from '../../../generated/prisma/client';
import { hashBilling } from '../domain/billing-policy';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';

type GrantDb = Pick<Prisma.TransactionClient, 'billingReceiptGrant' | 'receiptUnitEntry'>;

/**
 * Add-on spec §6.1 / D8 (plan PR B): the cut group of every lot kind — package, then what the team gave,
 * then what the shop bought; oldest expiry first inside a group. A kind this binary does not know fails
 * closed instead of being guessed into a group.
 */
const RECEIPT_LOT_GROUP: Readonly<Record<string, 0 | 1 | 2>> = {
  INITIAL: 0, RENEWAL: 0, REPEAT: 0, UPGRADE: 0, TRIAL_CARRYOVER: 0, PROMOTION: 0,
  ADMIN_ADJUSTMENT: 1, ADD_ON_ADMIN: 1, SALES_EVENT: 1,
  ADD_ON_PAID: 2,
};
/** Lots the add-on grant seam writes: one-page images only (D4), never package balance carried forward. */
export const RECEIPT_ADDON_KINDS = ['ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT'] as const;
export const isReceiptAddOnKind = (kind: string): boolean => (RECEIPT_ADDON_KINDS as readonly string[]).includes(kind);
/** "จากแพ็กเกจ" (spec §17.1); every other group is "ยอดเพิ่มเติม". */
export const isReceiptPackageKind = (kind: string): boolean => RECEIPT_LOT_GROUP[kind] === 0;

export type ReceiptLot = { id: string; kind: string; units: number; availableAt: Date; expiresAt: Date; revokedAt: Date | null;
  createdAt: Date; reserved: number; consumed: number; revoked: number; remaining: number };

/** The lots a company's receipt admission can see: its account's lots plus a manual Admin gift. */
export function visibleReceiptLots(companyId: string, billingAccountId: string | null, now: Date): Prisma.BillingReceiptGrantWhereInput {
  return { companyId, ...(billingAccountId === null ? { billingAccountId: null, kind: 'ADMIN_ADJUSTMENT' }
    : { OR: [{ billingAccountId }, { billingAccountId: null, kind: 'ADMIN_ADJUSTMENT' }] }),
    availableAt: { lte: now }, expiresAt: { gt: now }, revokedAt: null };
}

/**
 * The one projection behind admission, balances and the operator view (spec §15.3, §17.2). Entries are
 * the truth; an admission written before the ledger (null generation) still counts from its event, so
 * nothing is backfilled and a rolling deploy cannot hand out a unit twice.
 */
export async function receiptLots(db: GrantDb, where: Prisma.BillingReceiptGrantWhereInput): Promise<ReceiptLot[]> {
  const rows = await db.billingReceiptGrant.findMany({ where, orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, kind: true, units: true, availableAt: true, expiresAt: true, revokedAt: true, createdAt: true,
      _count: { select: { admissions: { where: { receiptUnitGeneration: null } } } } } });
  if (rows.length === 0) return [];
  const sums = await db.receiptUnitEntry.groupBy({ by: ['grantId', 'kind'], where: { grantId: { in: rows.map((row) => row.id) } }, _sum: { units: true } });
  const sum = (grantId: string, kind: string) => sums.find((row) => row.grantId === grantId && row.kind === kind)?._sum.units ?? 0;
  const lots = rows.map(({ _count, ...row }) => {
    const reserve = sum(row.id, 'RESERVE'), consumed = sum(row.id, 'CONSUME'), released = sum(row.id, 'RELEASE'), revoked = sum(row.id, 'REVOKE');
    const reserved = reserve - consumed - released, used = _count.admissions + consumed;
    const remaining = row.units - used - reserved - revoked;
    if (RECEIPT_LOT_GROUP[row.kind] === undefined || reserved < 0 || remaining < 0 || !Number.isSafeInteger(row.units)) throw new Error('billing.receipt_balance_corrupt');
    return { ...row, reserved, consumed: used, revoked, remaining };
  });
  // Array#sort is stable, so the FEFO order of the query (expiresAt, createdAt, id) survives inside each group. Promotion
  // spec Q1: on an equal expiry the bonus lot goes before the base one, so a later repeat carries the base and not the bonus.
  const bonus = (lot: ReceiptLot) => (lot.kind === 'PROMOTION' ? 0 : 1);
  return lots.sort((a, b) => RECEIPT_LOT_GROUP[a.kind]! - RECEIPT_LOT_GROUP[b.kind]! || a.expiresAt.getTime() - b.expiresAt.getTime() || bonus(a) - bonus(b));
}

function receiptBalance(lots: ReceiptLot[], eligible: (lot: ReceiptLot) => boolean) {
  const limit = lots.reduce((total, lot) => total + lot.units - lot.revoked, 0);
  const remaining = lots.reduce((total, lot) => total + lot.remaining, 0);
  if (!Number.isSafeInteger(limit)) throw new Error('billing.receipt_balance_corrupt');
  const next = lots.find((lot) => lot.remaining > 0 && eligible(lot));
  return { limit, used: limit - remaining, remaining, nextGrantId: next?.id ?? null,
    expiresAt: (next ?? lots[0])?.expiresAt ?? null };
}

/**
 * The caller holds partner-ocr-config when reserving, applying, revoking or extending grants. The receipt
 * allocator: package → team → purchased, FEFO inside a group; an add-on lot only serves a one-page image,
 * which the server decides from the stored file (D4, spec §15.3).
 */
export async function paidReceiptBalance(db: GrantDb, companyId: string, billingAccountId: string | null, now = new Date(), singlePageImage = false) {
  return receiptBalance(await receiptLots(db, visibleReceiptLots(companyId, billingAccountId, now)),
    (lot) => singlePageImage || !isReceiptAddOnKind(lot.kind));
}

/** Package flows and the existing usage contract: every lot except an add-on one (spec §6.1, §17.3). */
export async function packageReceiptBalance(db: GrantDb, companyId: string, billingAccountId: string | null, now = new Date()) {
  return receiptBalance((await receiptLots(db, visibleReceiptLots(companyId, billingAccountId, now)))
    .filter((lot) => !isReceiptAddOnKind(lot.kind)), () => true);
}

/** Internal apply seam, after financial evidence validation, in the invoice/term/audit transaction. */
export async function grantPaidPackageReceipts(tx: Prisma.TransactionClient, input: {
  companyId: string; billingAccountId: string; sourceKey: string; policyRevisionId: string;
  kind: 'INITIAL' | 'RENEWAL' | 'REPEAT' | 'UPGRADE' | 'PROMOTION'; units: number;
  serviceStart: Date; serviceEnd: Date; availableAt: Date; expiresAt: Date;
}) {
  if (!Number.isInteger(input.units) || input.units < 0 || input.units > 2_147_483_647
    || ![input.serviceStart, input.serviceEnd, input.availableAt, input.expiresAt].every((d) => Number.isSafeInteger(d.getTime()))
    || input.serviceStart >= input.serviceEnd || input.availableAt >= input.expiresAt
    || input.expiresAt < input.serviceEnd || !input.sourceKey || !input.policyRevisionId
    // A bonus lot is never empty and its expiry is fixed at the end of its free time (the CHECK says the same).
    || (input.kind === 'PROMOTION' && (input.units < 1 || input.expiresAt.getTime() !== input.serviceEnd.getTime()))) throw new Error('billing.invalid_receipt_grant');
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
      companyId: input.companyId, billingAccountId: input.billingAccountId, revokedAt: null, kind: { in: ['INITIAL', 'RENEWAL', 'REPEAT', 'UPGRADE'] },
      availableAt: { lte: input.availableAt }, expiresAt: { gt: input.availableAt, lt: input.expiresAt },
    }, data: { expiresAt: input.expiresAt } });
  }
  const grant = await tx.billingReceiptGrant.create({ data: { ...input, sourceHash } });
  await tx.companyPlanTerm.update({ where: { companyId: input.companyId }, data: {
    billingReceiptAccountId: input.billingAccountId, quotaNoticeSentMonthKey: null,
  } });
  return grant;
}

export const promotionReceiptSourceKey = (invoiceId: string) => `promo:${invoiceId}`;

/**
 * Promotion spec §5 "ใบเสร็จ", same transaction as the paid apply: the base lot of the paid period and the bonus lot of
 * the free time, both usable from the verified payment and both expiring at `benefitEnd`. The base lot is an ordinary
 * package lot (a REPEAT carries still-valid paid units to `benefitEnd`, and a later repeat carries it on); the bonus lot
 * is PROMOTION, which no carry, grace or free-days list names, so its expiry never moves.
 */
export async function grantPromotionPackageReceipts(tx: Prisma.TransactionClient, input: {
  companyId: string; billingAccountId: string; invoiceId: string; policyRevisionId: string; kind: 'INITIAL' | 'REPEAT';
  baseUnits: number; bonusUnits: number; serviceStart: Date; paidEnd: Date; benefitEnd: Date; availableAt: Date;
}) {
  const { invoiceId, baseUnits, bonusUnits, paidEnd, benefitEnd, kind, serviceStart, ...common } = input;
  const base = await grantPaidPackageReceipts(tx, { ...common, sourceKey: invoiceId, kind, units: baseUnits, serviceStart, serviceEnd: paidEnd, expiresAt: benefitEnd });
  const bonus = await grantPaidPackageReceipts(tx, { ...common, sourceKey: promotionReceiptSourceKey(invoiceId), kind: 'PROMOTION', units: bonusUnits,
    serviceStart: paidEnd, serviceEnd: benefitEnd, expiresAt: benefitEnd });
  return { base, bonus };
}

/** Plan R9: the free-time segments `[paidEnd, benefitEnd)` of an account, from its non-revoked bonus lots, oldest first. */
export async function promotionSegments(db: Pick<Prisma.TransactionClient, 'billingReceiptGrant'>, billingAccountId: string) {
  const lots = await db.billingReceiptGrant.findMany({ where: { billingAccountId, kind: 'PROMOTION', revokedAt: null },
    orderBy: [{ serviceStart: 'asc' }, { id: 'asc' }], select: { id: true, sourceKey: true, serviceStart: true, serviceEnd: true } });
  return lots.map(lot => ({ lotId: lot.id, invoiceId: lot.sourceKey.slice(promotionReceiptSourceKey('').length), start: lot.serviceStart, end: lot.serviceEnd }));
}
