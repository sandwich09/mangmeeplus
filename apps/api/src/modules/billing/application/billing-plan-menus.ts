/**
 * Phase 7 (มติ Owner 2026-09-21) — เปลี่ยนแพ็กเกจกลางคันแล้วชุดเมนูย้ายตามทันทีที่การเปลี่ยนมีผล.
 *
 * spec §20.5 listed four reasons the mid-term change never moved menus. Three of them are about
 * the INVOICE seam: a plan-change invoice is a `RENEWAL`, the one-time path has no invoice at the
 * boundary at all, and a `featurePlan` pinned at request time is re-checked by `sourceHash` a whole
 * cycle later — one admin entitlement edit in between would HELD money the customer already paid.
 * So this is deliberately NOT on the invoice seam. It is one boundary operation, modelled on
 * `SCHEDULE_PRICE_RETURN` (billing-price-return.ts) minus the provider round trip, that runs
 * straight AFTER the commit that moved the term, reads the tier the shop now pays for, and moves
 * the menus to that tier's preset under the entitlement lock.
 *
 * Why after rather than inside that commit (R5): the package, the price and the term have already
 * changed and the customer has already paid. A menu move that cannot run is a retryable operation,
 * never a reason to hold the money or leave the shop on the old limits. Failure blocks only this
 * row — `BLOCKED` + a `PLAN_MENU_MOVE_REVIEW` issue — and the billing worker's next pass retries it.
 *
 * ponytail — no fresh snapshot is frozen ahead of the boundary because there is nothing to freeze
 * against: the plan is built inside the applying transaction, under the same lock, so the
 * `sourceHash` `applyBillingFeaturePlan` re-checks is seconds old and can never drift. That is the
 * same answer `SCHEDULE_PRICE_RETURN` reaches by queuing late, without the second mechanism.
 */
import { TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../common/database/prisma.service';
import { exclusiveEntitlementLock } from '../../feature-launch/application/execution-attempt.service';
import { completeRunoffIfDrained } from '../../feature-launch/application/runoff-lifecycle';
import { lockPlanTermCompany } from '../../system-partner-management/application/lock-plan-term-company';
import { DEAL_KIND } from '../../sales-console/domain/sales-deal.logic';
import { hashBilling } from '../domain/billing-policy';
import { applyBillingFeaturePlan, billingFeaturePlan } from './billing-feature-entitlements';
import { detectBillingIssue, resolveBillingIssue } from './billing-issues';

export const PLAN_MENUS_TYPE = 'APPLY_PLAN_MENUS';
export const PLAN_MENUS_ISSUE = 'PLAN_MENU_MOVE_REVIEW';
/**
 * How long a `QUEUED` row may sit before the sweep treats it as abandoned. `movePlanMenus` always
 * leaves the row `APPLIED` or `BLOCKED`, so a `QUEUED` row older than this is one whose post-commit
 * run never happened — the process died between the commit that moved the term and the move itself.
 */
export const PLAN_MENUS_STALE_MS = 120_000;
/** Everything the retry needs; the row itself carries it, so a later pass needs no caller. */
export type PlanMenuMove = { companyId: string; invoiceId: string; actorUserId: string;
  stripeAccountId: string; livemode: boolean; accountVersion: number };

const planMenuKey = (move: PlanMenuMove) => ({ stripeAccountId_livemode_idempotencyKey: {
  stripeAccountId: move.stripeAccountId, livemode: move.livemode, idempotencyKey: `plan-menus:${move.invoiceId}` } });
const planMenuRow = (move: PlanMenuMove) => ({ stripeAccountId: move.stripeAccountId, livemode: move.livemode,
  companyId: move.companyId, type: PLAN_MENUS_TYPE, state: 'QUEUED', referenceId: move.invoiceId,
  proposedJson: move as unknown as Prisma.InputJsonValue, sourceVersion: move.accountVersion,
  reason: 'plan_change_menu_move', initiatorUserId: move.actorUserId,
  idempotencyKey: `plan-menus:${move.invoiceId}`, requestHash: hashBilling([move.companyId, move.invoiceId]),
  expiresAt: new Date(Date.now() + 30 * 86_400_000) });

/**
 * Write the ledger row in the SAME transaction that moves the tier, so the move survives a deploy
 * restart or a killed worker between that commit and `movePlanMenus`. Without it a crash in that
 * window leaves the shop on the old menus with nothing to retry and nothing to see.
 */
export async function queuePlanMenuMove(tx: Prisma.TransactionClient, move: PlanMenuMove): Promise<void> {
  await tx.billingOperation.upsert({ where: planMenuKey(move), update: {}, create: planMenuRow(move) });
}

/**
 * The sweep's rule, pure so both halves are a test: a failure is always retried, and a `QUEUED` row
 * is retried only once it is too old to be a move that is still running in another process.
 */
export function planMenuRetryable(row: { state: string; createdAt: Date }, now: Date): boolean {
  return row.state === 'BLOCKED' ||
    (row.state === 'QUEUED' && now.getTime() - row.createdAt.getTime() >= PLAN_MENUS_STALE_MS);
}

/**
 * The menu set a shop is entitled to once `tierKey` is what it pays for, or null when its menus
 * are not the catalog's to move. Pure, so the two exclusions are a test rather than a code read:
 * a shop on a live deal keeps the deal's own snapshot (Phase 5/6 — the deal RETURN puts it back on
 * the base tier), and a term with no paid tier has no preset to move to.
 */
export function planMenuTarget(tierKey: string | null | undefined, dealActive: boolean): readonly string[] | null {
  if (dealActive || !tierKey || !Object.hasOwn(TIER_FEATURE_PRESETS, tierKey)) return null;
  return TIER_FEATURE_PRESETS[tierKey as keyof typeof TIER_FEATURE_PRESETS];
}

/**
 * Move this shop onto its current tier's menus. Called right after the commit that changed the
 * term, and again by `retryPlanMenuMoves` for anything that failed. Never throws at its caller:
 * the operation row IS the answer.
 */
export async function movePlanMenus(prisma: PrismaService, move: PlanMenuMove): Promise<void> {
  let disabled: string[] = [], operationId = '';
  try {
    // The call sites queue this row inside their own transaction; the upsert is kept so a retry
    // (and any future caller) still works on its own.
    const row = await prisma.client.billingOperation.upsert({ where: planMenuKey(move), update: {}, create: planMenuRow(move) });
    operationId = row.id;
    if (row.state === 'APPLIED') return;
    disabled = await prisma.client.$transaction(async tx => {
      // Same lock order as `applyInvoice`: entitlements, then the plan term.
      await tx.$executeRaw(exclusiveEntitlementLock(move.companyId));
      await lockPlanTermCompany(tx, move.companyId);
      const term = await tx.companyPlanTerm.findUnique({ where: { companyId: move.companyId }, select: { tierKey: true } });
      const deal = await tx.packageChangeRequest.findFirst({ where: { companyId: move.companyId, kind: DEAL_KIND,
        status: 'APPLIED', returnAt: { gt: new Date() } }, select: { id: true } });
      const target = planMenuTarget(term?.tierKey, !!deal);
      const plan = target ? await billingFeaturePlan(tx, move.companyId, target) : null;
      // A no-op is the normal case: STARTER/BASIC/PRO share one menu set (spec §20.1), a deal keeps
      // its own, and a retry after a move that already landed sees the target already in place.
      const moved = !!plan && (plan.impact.added.length > 0 || plan.impact.removed.length > 0);
      const result = moved ? await applyBillingFeaturePlan(tx, move.companyId, move.invoiceId, move.actorUserId, plan!.plan) : [];
      await tx.billingOperation.update({ where: { id: row.id }, data: { state: 'APPLIED', errorCode: null,
        observedAt: new Date(), version: { increment: 1 },
        resultJson: { tierKey: term?.tierKey ?? null, moved, dealSnapshot: !!deal } } });
      await resolveBillingIssue(tx, { stripeAccountId: move.stripeAccountId, livemode: move.livemode,
        companyId: move.companyId, kind: PLAN_MENUS_ISSUE, referenceId: move.invoiceId }, move.invoiceId);
      await tx.auditLog.create({ data: { companyId: move.companyId, actorUserId: move.actorUserId,
        action: 'billing.plan_menus.moved', targetType: 'BillingOperation', targetId: row.id, requestId: row.id,
        result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { invoiceId: move.invoiceId, tierKey: term?.tierKey ?? null,
          moved, dealSnapshot: !!deal, added: plan?.impact.added.map(item => item.featureKey) ?? [], disabled: result } } });
      return result;
    });
  } catch {
    // R5: the term and the money already moved. Record the failure where the retry can find it.
    await prisma.client.$transaction(async tx => {
      await tx.billingOperation.updateMany({ where: { ...(operationId ? { id: operationId } :
        { stripeAccountId: move.stripeAccountId, livemode: move.livemode,
          idempotencyKey: `plan-menus:${move.invoiceId}` }), state: { not: 'APPLIED' } },
        data: { state: 'BLOCKED', errorCode: PLAN_MENUS_ISSUE, version: { increment: 1 } } });
      // Keyed on the invoice, not the row: an upsert that never landed still has to be visible to
      // the team, because nothing would retry a move whose ledger row does not exist.
      await detectBillingIssue(tx, { stripeAccountId: move.stripeAccountId, livemode: move.livemode,
        companyId: move.companyId, kind: PLAN_MENUS_ISSUE, referenceId: move.invoiceId });
    }).catch(() => { /* the next pass re-reads the row and tries the whole move again */ });
    return;
  }
  for (const featureKey of disabled) {
    try { await completeRunoffIfDrained(prisma, move.companyId, featureKey); }
    catch { /* The durable runoff sweep completes missed post-commit transitions. */ }
  }
}

/**
 * The billing worker's pass over moves that failed or were never run; each row carries everything
 * it needs. Oldest first, so a burst of rows still running elsewhere can never crowd out real work.
 */
export async function retryPlanMenuMoves(prisma: PrismaService, now = new Date()): Promise<void> {
  const rows = await prisma.client.billingOperation.findMany({
    where: { type: PLAN_MENUS_TYPE, state: { in: ['BLOCKED', 'QUEUED'] }, expiresAt: { gt: now } },
    select: { state: true, createdAt: true, proposedJson: true }, orderBy: { createdAt: 'asc' }, take: 50 });
  for (const row of rows) {
    if (!planMenuRetryable(row, now)) continue;
    try { await movePlanMenus(prisma, row.proposedJson as unknown as PlanMenuMove); }
    catch { /* one shop never stops the batch; the next pass has the rest of the window */ }
  }
}

/**
 * What a customer confirming a plan change is shown: the menus the target tier opens and closes.
 * Display only — the move itself always rebuilds the plan at the boundary — so a shop whose menu
 * rows still need a team review can still buy.
 */
export async function planMenuImpact<T extends { targetOffer?: { offerKey: string } }>(
  tx: Prisma.TransactionClient, companyId: string, operation: T): Promise<T> {
  const target = operation.targetOffer ? planMenuTarget(operation.targetOffer.offerKey, false) : null;
  if (!target) return operation;
  const preview = await billingFeaturePlan(tx, companyId, target).catch(() => null);
  return preview ? { ...operation, featureImpact: preview.impact } : operation;
}
