import { Injectable } from '@nestjs/common';
import { billingProductKind, type BillingProductKind, type BillingPurchaseSource } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { billingPurchaseSource } from './billing-purchase-source';

/**
 * Money facts for the executive report (executive spec §14.1–§14.2).
 *
 * The balance scan (`billing-settlement.service.ts`, job SCAN_PROVIDER_BALANCE) already writes one
 * OBSERVE_PROVIDER_BALANCE row per provider movement it read. This is the one reader of those rows
 * for anything outside billing: no caller parses `BillingOperation` JSON itself, nothing here calls
 * the provider, and `paid-invoice.ts` / `billing-schedule.ts` are not involved.
 *
 * ponytail: reads the scan's own rows instead of keeping a projection table. A finding row is never
 * deleted and carries everything the report needs, so a second table would only be a copy to keep in
 * step. The query walks every finding row of this account and mode; move to a projection (or an
 * expression index on the movement id and time) when that walk shows up in the build's duration.
 */

/** How a payment is grouped in the report. Derived from what the invoice writers persisted, never stored. */
export type BillingPurchaseKind = 'FIRST_PURCHASE' | 'RENEWAL' | 'RETURN' | 'UPGRADE' | 'ADD_ON' | 'UNKNOWN';
export type BillingCashMovement = {
  /** The provider's balance-transaction id: one movement, however many scan jobs read it. */
  providerTransactionId: string;
  /** The provider's own time of the movement. Never periodStart, createdAt, financialObservedAt or webhook time. */
  occurredAt: Date;
  kind: 'RECEIPT' | 'REFUND' | 'PAYOUT' | 'OTHER';
  /**
   * COMPANY: counted for `companyId`. UNTIED: real money no company answers for yet (no local
   * invoice, or the scan left it for a manual check). EXCLUDED: in no total — a payout to Mangmee's
   * own bank account, or a refund that did not succeed.
   */
  tie: 'COMPANY' | 'UNTIED' | 'EXCLUDED';
  /** Upper case. Only THB amounts are satang; anything else must not be added to a satang total. */
  currency: string;
  /** RECEIPT and REFUND: the positive amount received or refunded. PAYOUT and OTHER: the provider's signed amount. */
  amountSatang: number;
  /** The provider's fee of this movement, signed as the provider reports it. */
  feeSatang: number;
  /** The provider's signed net of this movement. */
  netSatang: number;
  /** Set exactly when `tie` is COMPANY. */
  companyId: string | null;
  invoiceId: string | null;
  /** The invoice's tax, on a RECEIPT counted for a company; null everywhere else. */
  taxSatang: number | null;
  productKind: BillingProductKind | null;
  purchaseKind: BillingPurchaseKind;
  /** The matched invoice is disputed right now (`BillingInvoice.disputed`). */
  invoiceDisputed: boolean;
};
export type BillingCashRange = { start: Date; end: Date };
/**
 * `ranges`: the time successful balance scans cover, merged and ascending. `dataThrough`: where the
 * latest one ends. `since`: when the first billing account of this mode was created — no online
 * payment can be older — or null when there is none.
 */
export type BillingCashCoverage = { ranges: BillingCashRange[]; dataThrough: Date | null; since: Date | null };
/** What the invoices of one company say today, in the mode this system runs in (executive spec §13.2). */
export type BillingCompanyPayment = {
  /** A verified invoice with money paid exists: the company has paid, whenever that was. */
  paidInvoice: boolean;
  /** Cumulative over those invoices, undated: what was paid and what went back. */
  invoicePaidSatang: number;
  invoiceRefundedSatang: number;
  /** `billingPurchaseSource()` for a company with no paid invoice; a paid shape here is a case for review. */
  sourceWithoutInvoice: BillingPurchaseSource;
};

const PAYOUT_TYPES = ['payout', 'payout_failure', 'payout_cancel'];
const QUOTE_KIND: Record<string, BillingPurchaseKind> = {
  INITIAL: 'FIRST_PURCHASE', REPEAT: 'RENEWAL', ADVANCE_DEAL: 'RENEWAL', RESTART: 'RETURN',
  UPGRADE: 'UPGRADE', FULL_PACKAGE_UPGRADE: 'UPGRADE',
};

/**
 * Executive spec §14.1 table, read from the invoice row and the purchase attempt it came from.
 *
 * - `sourceAttemptId` is null only on a subscription's own later cycle (`applyInvoice`, the one
 *   writer that leaves it null): a renewal. Its `contractSnapshot` may still say INITIAL, because it
 *   is the contract the subscription started with, so the snapshot is never read for these.
 * - Every other invoice was paid through one Checkout attempt, whose quote names the purchase.
 * - UNKNOWN is a coverage gap, not a guess: SCHEDULED_CHANGE is a change to a lower tier or another
 *   billing interval paid ahead (never the same-interval upgrade the table files it under), and a
 *   deal that replaces a live subscription is quoted INITIAL although the shop paid before.
 */
export function billingPurchaseKind(invoice: { productKind: string; sourceAttemptId: string | null; subscriptionId: string | null;
  quoteKind: string | null; subscriptionConversion: boolean } | null): BillingPurchaseKind {
  if (!invoice) return 'UNKNOWN';
  if (invoice.productKind !== 'PACKAGE') return billingProductKind(invoice.productKind) ? 'ADD_ON' : 'UNKNOWN';
  if (!invoice.sourceAttemptId) return invoice.subscriptionId ? 'RENEWAL' : 'UNKNOWN';
  if (invoice.quoteKind === 'INITIAL' && invoice.subscriptionConversion) return 'UNKNOWN';
  return QUOTE_KIND[invoice.quoteKind ?? ''] ?? 'UNKNOWN';
}

/** Where the unbroken coverage that contains `from` ends; null when `from` itself was never read. */
export function billingCoveredThrough(ranges: readonly BillingCashRange[], from: Date): Date | null {
  return ranges.find((range) => range.start <= from && from < range.end)?.end ?? null;
}

type Row = { observation: Prisma.JsonValue; productKind: string | null; sourceAttemptId: string | null; subscriptionId: string | null;
  disputed: boolean | null; quoteKind: string | null; subscriptionConversion: boolean | null };
type Observation = { movement?: { id?: unknown; type?: unknown; currency?: unknown; amount?: unknown; fee?: unknown; net?: unknown; created?: unknown; balanceType?: unknown };
  classification?: unknown; refundState?: unknown; taxSatang?: unknown; invoiceId?: unknown; companyId?: unknown };
const invalid = () => new Error('billing.cash_movement_invalid');
const satang = (value: unknown): number => { if (!Number.isSafeInteger(value)) throw invalid(); return value as number; };

@Injectable()
export class BillingCashMovementsService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService) {}

  /** The account and mode this system runs in. TEST and LIVE rows are never read together. */
  private scope(): { stripeAccountId: string; livemode: boolean } | null {
    return this.config.billingMode === 'disabled' || !this.config.stripeAccountId ? null
      : { stripeAccountId: this.config.stripeAccountId, livemode: this.config.billingMode === 'live' };
  }

  /**
   * Every movement the provider dated inside `[start, end)`, once per provider transaction: two scan
   * jobs whose windows overlap both store the movement, and the row read last is the one that counts.
   */
  async movements(range: BillingCashRange): Promise<BillingCashMovement[]> {
    const scope = this.scope();
    if (!scope) return [];
    // The provider dates a movement in whole seconds, so `[start, end)` in milliseconds is this in seconds.
    const since = Math.ceil(range.start.getTime() / 1000), until = Math.ceil(range.end.getTime() / 1000);
    const rows = await this.prisma.client.$queryRaw<Row[]>(Prisma.sql`
      SELECT DISTINCT ON (o."proposedJson"->'movement'->>'id')
             o."proposedJson" AS observation, i."productKind" AS "productKind", i."sourceAttemptId" AS "sourceAttemptId",
             i."subscriptionId" AS "subscriptionId", i.disputed AS disputed,
             a."quoteSnapshot"->'quote'->'purchase'->>'kind' AS "quoteKind",
             a."quoteSnapshot"->'subscriptionConversion' IS NOT NULL AS "subscriptionConversion"
        FROM "BillingOperation" o
        LEFT JOIN "BillingInvoice" i ON i.id = o."proposedJson"->>'invoiceId'
        LEFT JOIN "BillingAttempt" a ON a.id = i."sourceAttemptId"
       WHERE o.type = 'OBSERVE_PROVIDER_BALANCE' AND o."companyId" IS NULL
         AND o."stripeAccountId" = ${scope.stripeAccountId} AND o.livemode = ${scope.livemode}
         AND (o."proposedJson"->'movement'->>'created')::bigint >= ${since}::bigint
         AND (o."proposedJson"->'movement'->>'created')::bigint < ${until}::bigint
       ORDER BY o."proposedJson"->'movement'->>'id', o."observedAt" DESC NULLS LAST, o."createdAt" DESC, o.id DESC`);
    return rows.map((row) => {
      const observed = row.observation as Observation, movement = observed.movement;
      if (!movement || typeof movement.id !== 'string' || typeof movement.type !== 'string' || typeof movement.currency !== 'string') throw invalid();
      const matched = observed.classification === 'MATCHED' && typeof observed.companyId === 'string';
      const kind = movement.type === 'charge' ? 'RECEIPT' : movement.type === 'refund' ? 'REFUND'
        : PAYOUT_TYPES.includes(movement.type) ? 'PAYOUT' : 'OTHER';
      const money = kind === 'RECEIPT' || kind === 'REFUND';
      // A refund the scan saw in any state but `succeeded` is not money refunded; one it could not look up stays untied.
      const unsuccessfulRefund = kind === 'REFUND' && typeof observed.refundState === 'string' && observed.refundState !== 'succeeded';
      const tie = kind === 'PAYOUT' || unsuccessfulRefund ? 'EXCLUDED' : money && matched ? 'COMPANY' : 'UNTIED';
      const amount = satang(movement.amount), counted = tie === 'COMPANY';
      const invoice = row.productKind === null ? null : { productKind: row.productKind, sourceAttemptId: row.sourceAttemptId,
        subscriptionId: row.subscriptionId, quoteKind: row.quoteKind, subscriptionConversion: row.subscriptionConversion === true };
      return {
        providerTransactionId: movement.id, occurredAt: new Date(satang(movement.created) * 1000), kind, tie,
        currency: movement.currency.toUpperCase(), amountSatang: kind === 'REFUND' ? -amount : amount,
        feeSatang: satang(movement.fee), netSatang: satang(movement.net),
        companyId: counted ? observed.companyId as string : null,
        invoiceId: counted && typeof observed.invoiceId === 'string' ? observed.invoiceId : null,
        taxSatang: counted && kind === 'RECEIPT' && observed.taxSatang != null ? satang(observed.taxSatang) : null,
        productKind: invoice ? billingProductKind(invoice.productKind) : null,
        purchaseKind: billingPurchaseKind(invoice), invoiceDisputed: row.disputed === true,
      };
    });
  }

  /** What the successful balance scans cover. A month they do not cover whole has incomplete money (BILLING_SCAN_NOT_COMPLETE). */
  async coverage(): Promise<BillingCashCoverage> {
    const scope = this.scope();
    const jobs = scope ? await this.prisma.client.billingOperation.findMany({
      where: { ...scope, type: 'SCAN_PROVIDER_BALANCE', companyId: null, state: 'SUCCEEDED' }, select: { proposedJson: true } }) : [];
    const windows = jobs.map((job) => {
      const window = job.proposedJson as { since?: unknown; until?: unknown };
      return { start: satang(window.since) * 1000, end: satang(window.until) * 1000 };
    }).sort((a, b) => a.start - b.start);
    const ranges: BillingCashRange[] = [];
    for (const window of windows) {
      const last = ranges.at(-1);
      if (last && window.start <= last.end.getTime()) { if (window.end > last.end.getTime()) last.end = new Date(window.end); }
      else ranges.push({ start: new Date(window.start), end: new Date(window.end) });
    }
    const first = scope ? await this.prisma.client.billingAccount.aggregate({ where: scope, _min: { createdAt: true } }) : null;
    return { ranges, dataThrough: ranges.at(-1)?.end ?? null, since: first?._min.createdAt ?? null };
  }

  /**
   * One entry per company that has a plan term or a billing account in this mode. Three set reads,
   * never one per company; the purchase source is billing's own rule, not a copy of it.
   */
  async companyPayments(): Promise<Map<string, BillingCompanyPayment>> {
    const scope = this.scope(), db = this.prisma.client;
    const [terms, accounts] = await Promise.all([
      db.companyPlanTerm.findMany(),
      scope ? db.billingAccount.findMany({ where: scope, select: { id: true, companyId: true, baseSubscriptionId: true, activeAttemptId: true,
        contractAttemptId: true, renewalMode: true, paidThrough: true, termProjectionHash: true } }) : [],
    ]);
    const paid = accounts.length ? await db.billingInvoice.groupBy({ by: ['billingAccountId'],
      where: { billingAccountId: { in: accounts.map((account) => account.id) }, providerStatus: 'paid', paidSatang: { gt: 0 } },
      _sum: { paidSatang: true, refundedSatang: true } }) : [];
    const paidOf = new Map(paid.map((row) => [row.billingAccountId, row._sum]));
    const accountOf = new Map(accounts.map((account) => [account.companyId, account]));
    const termOf = new Map(terms.map((term) => [term.companyId, term]));
    const result = new Map<string, BillingCompanyPayment>();
    for (const companyId of new Set([...termOf.keys(), ...accountOf.keys()])) {
      const account = accountOf.get(companyId) ?? null, sums = account ? paidOf.get(account.id) : undefined;
      result.set(companyId, { paidInvoice: !!sums, invoicePaidSatang: satang(sums?.paidSatang ?? 0), invoiceRefundedSatang: satang(sums?.refundedSatang ?? 0),
        sourceWithoutInvoice: billingPurchaseSource(termOf.get(companyId) ?? null, account, false) });
    }
    return result;
  }
}
