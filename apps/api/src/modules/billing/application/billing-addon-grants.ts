import type { BillingAddOnProductKind } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import { hashBilling } from '../domain/billing-policy';
import { appendPackageInterval } from '../domain/billing-package';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { applyAiCreditGrant } from '../../line-ai/application/ai-credit-ledger';

/** Where an add-on lot came from (spec §6.1): a verified payment, an approved team grant, a sales-event credit. */
export type AddOnGrantSourceKind = 'ADD_ON_PAID' | 'ADD_ON_ADMIN' | 'SALES_EVENT';
const SOURCE_KINDS: readonly AddOnGrantSourceKind[] = ['ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT'];

export type AddOnGrantInput = {
  companyId: string;
  billingAccountId: string;
  productKind: BillingAddOnProductKind;
  sourceKind: AddOnGrantSourceKind;
  /** Unique per billing account: `addon-admin:<operationId>`, `sales-event:<ticketId>:<productKind>`, the paid invoice's key. */
  sourceKey: string;
  /** The caller's sha256 of the source it verified (payment evidence, approved operation, ticket). */
  sourceHash: string;
  /** Integer units of the product: 0.01 credit for CHAT_CREDIT, whole images for RECEIPT_IMAGE. */
  units: number;
  /** paidAt for a purchase, the committed approval for the team, the claim for a sales event. */
  at: Date;
};

export type AddOnGrant = { productKind: BillingAddOnProductKind; lotId: string; units: number; availableAt: Date; expiresAt: Date;
  /** True when this source was granted before: the first result is returned, nothing is added. */
  replayed: boolean };

/**
 * Whether the company's consumer can see a lot of this product today (spec §8.4, §15.3, §16 item 9). A lot
 * nobody can read is never sold or given. RECEIPT_IMAGE: receipts already come from the billing account's
 * lots. CHAT_CREDIT: admission funds from AI credit lots once the company is cut over (plan PR C, spec §11).
 */
export async function addOnGrantReady(db: Pick<Prisma.TransactionClient, 'companyPlanTerm' | 'companyAiConfiguration'>, companyId: string,
  billingAccountId: string, productKind: BillingAddOnProductKind): Promise<boolean> {
  const term = await db.companyPlanTerm.findUnique({ where: { companyId }, select: { billingReceiptAccountId: true } });
  if (term?.billingReceiptAccountId !== billingAccountId) return false;
  if (productKind === 'RECEIPT_IMAGE') return true;
  const config = await db.companyAiConfiguration.findUnique({ where: { companyId }, select: { aiCreditCutoverAt: true } });
  return !!config?.aiCreditCutoverAt && config.aiCreditCutoverAt <= new Date();
}

/**
 * The one add-on grant command (spec §16 item 1, D6): the final mutation for a purchase (plan PR E), a team
 * grant (PR B admin, PR C for AI credit) and a sales-event credit (sales-event plan SD-F). It runs inside
 * the caller's transaction and takes L1 partner-ocr-config → L4 Company (spec §8.3); both locks are
 * re-entrant, so a caller that already holds them keeps its own order. A caller that locks anything else
 * first (a sales-event ticket, an invoice row) must take L1 → L4 before that. The caller verifies its own source
 * and writes its own audit; this checks the account, the consumer and the payload, and it never writes
 * `CompanyPlanTerm`, never extends a package and never calls `grantPaidPackageReceipts`. Expiry is always
 * 12 months from `at` (D1/D8, C03) — no caller chooses it. The same source key with the same payload
 * returns the first lot and its first dates (§18.2); a different payload under that key throws.
 */
export async function applyAddOnGrant(tx: Prisma.TransactionClient, input: AddOnGrantInput): Promise<AddOnGrant> {
  if (!SOURCE_KINDS.includes(input.sourceKind) || !input.sourceKey || input.sourceKey.length > 200 || !/^[a-f0-9]{64}$/.test(input.sourceHash)
    || !Number.isSafeInteger(input.units) || input.units < 1 || input.units > 2_147_483_647 || !Number.isSafeInteger(input.at.getTime())) {
    throw new Error('billing.addon_grant_invalid');
  }
  const expiresAt = appendPackageInterval(input.at, 'year');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${input.companyId}`}))`;
  await lockPlanTermCompany(tx, input.companyId);
  const account = await tx.billingAccount.findUnique({ where: { id: input.billingAccountId }, select: { companyId: true } });
  if (account?.companyId !== input.companyId) throw new Error('billing.addon_account_mismatch');
  const sourceHash = hashBilling([input.sourceHash, input.companyId, input.billingAccountId, input.productKind, input.sourceKind, input.sourceKey, input.units]);
  if (input.productKind === 'CHAT_CREDIT') {
    // Plan PR C: the AI credit lot. The key is per billing account, like a receipt lot, and never collides
    // with a cycle lot (`cycle:…`). A replay returns the first lot even if readiness changed since.
    const sourceKey = `addon:${input.billingAccountId}:${input.sourceKey}`;
    const replay = await tx.aiCreditGrant.findUnique({ where: { sourceKey }, select: { id: true } });
    if (!replay && !await addOnGrantReady(tx, input.companyId, input.billingAccountId, input.productKind)) throw new Error('billing.addon_consumer_not_ready');
    return { productKind: 'CHAT_CREDIT', ...await applyAiCreditGrant(tx, { companyId: input.companyId, billingAccountId: input.billingAccountId,
      sourceKind: input.sourceKind, sourceKey, sourceHash, units: input.units, at: input.at }) };
  }
  const existing = await tx.billingReceiptGrant.findUnique({ where: {
    billingAccountId_sourceKey: { billingAccountId: input.billingAccountId, sourceKey: input.sourceKey } } });
  if (existing) {
    if (existing.sourceHash !== sourceHash || existing.kind !== input.sourceKind) throw new Error('billing.addon_source_changed');
    return { productKind: 'RECEIPT_IMAGE', lotId: existing.id, units: existing.units, availableAt: existing.availableAt, expiresAt: existing.expiresAt, replayed: true };
  }
  if (!await addOnGrantReady(tx, input.companyId, input.billingAccountId, input.productKind)) throw new Error('billing.addon_consumer_not_ready');
  const lot = await tx.billingReceiptGrant.create({ data: {
    companyId: input.companyId, billingAccountId: input.billingAccountId, sourceKey: input.sourceKey, sourceHash, kind: input.sourceKind,
    units: input.units, serviceStart: input.at, serviceEnd: expiresAt, availableAt: input.at, expiresAt,
    // An add-on lot is not priced by a package policy; its invoice or operation is the source of record.
    policyRevisionId: input.sourceKind,
  } });
  return { productKind: 'RECEIPT_IMAGE', lotId: lot.id, units: lot.units, availableAt: lot.availableAt, expiresAt: lot.expiresAt, replayed: false };
}
