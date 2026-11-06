/**
 * The AI credit ledger (add-on spec §5.2–§5.3, §6.1, §8.2–§8.3, §16, §17.2).
 *
 * One lot per source (`AiCreditGrant`) and an append-only list of signed changes (`AiCreditEntry`).
 * A lot's balance is `units + SUM(entries)`, where a RESERVE entry counts only while its
 * `AiBudgetReservation` is live (RESERVED | DISPATCHED | UNRESOLVED) — the ADR 0013 rule "no second
 * counter that could drift". So a cancel, the lazy sweep and an operator release free credit by the
 * reservation status they already write; only settlement adds a CONSUME entry.
 *
 * Lock rule (spec §8.3): every writer that LOWERS available credit (a hold, a revoke, a new cycle)
 * runs under `partner-ocr-config:<company>` (L1), which `reserveAiBudgetStep` already takes first. A
 * settlement only turns part of a hold into use, so it keeps the month lock alone.
 */
import { createHash } from 'node:crypto';
import { appendPackageInterval } from '../../billing/domain/billing-package';
import { readAiCreditCycle, type AiCreditCycle } from './ai-credit-cycles';

export type AiCreditSourceKind = 'INCLUDED_CYCLE' | 'ADD_ON_PAID' | 'ADD_ON_ADMIN' | 'SALES_EVENT';
/** Why a funded call was refused. Internal only: the gateway still sees the existing refusal code. */
export type AiCreditRefusalCause = 'PACKAGE_REQUIRED' | 'EXHAUSTED' | 'INSUFFICIENT';
export type AiCreditAllowanceSource = 'DEFAULT' | 'SALES_DEAL' | 'ADMIN_CHAT_CREDIT' | 'SPLIT_CHAT_CAP';

const LIVE_HOLD = ['RESERVED', 'DISPATCHED', 'UNRESOLVED'] as const;
/** Spec §5.2 / D8: package, then team-given (admin gift, sales event), then purchased. */
const GROUP_RANK: Record<AiCreditSourceKind, number> = { INCLUDED_CYCLE: 0, ADD_ON_ADMIN: 1, SALES_EVENT: 1, ADD_ON_PAID: 2 };

export type AiCreditLot = { id: string; sourceKind: string; availableAt: Date; expiresAt: Date; available: number };

/** Inside a group: earliest expiry, then earliest added, then the stable id (spec §5.2). */
export function aiCreditLotOrder(a: Omit<AiCreditLot, 'available'>, b: Omit<AiCreditLot, 'available'>): number {
  return (GROUP_RANK[a.sourceKind as AiCreditSourceKind] ?? 9) - (GROUP_RANK[b.sourceKind as AiCreditSourceKind] ?? 9)
    || a.expiresAt.getTime() - b.expiresAt.getTime()
    || a.availableAt.getTime() - b.availableAt.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Splits `units` across lots in spend order, or null when they do not cover it. Pure. */
export function planAiCreditAllocation(lots: readonly AiCreditLot[], units: number): Array<{ grantId: string; units: number }> | null {
  let left = units;
  const plan: Array<{ grantId: string; units: number }> = [];
  for (const lot of [...lots].sort(aiCreditLotOrder)) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, lot.available));
    if (take > 0) { plan.push({ grantId: lot.id, units: take }); left -= take; }
  }
  return left > 0 ? null : plan;
}

/** `units + SUM(entries)` per lot, a RESERVE counting only while its hold is live. */
export async function aiCreditLotBalances(tx: any, companyId: string, lots: ReadonlyArray<{ id: string; units: number }>): Promise<Map<string, number>> {
  const balance = new Map(lots.map(lot => [lot.id, lot.units] as [string, number]));
  if (!lots.length) return balance;
  const grantId = { in: lots.map(lot => lot.id) };
  const settled = await tx.aiCreditEntry.groupBy({ by: ['grantId'], where: { grantId, kind: { not: 'RESERVE' } }, _sum: { units: true } });
  // Live holds of the company are few (in-flight calls plus stranded ones), whatever their month.
  const live = await tx.aiBudgetReservation.findMany({ where: { companyId, status: { in: [...LIVE_HOLD] } }, select: { id: true } });
  const held = live.length ? await tx.aiCreditEntry.groupBy({ by: ['grantId'],
    where: { grantId, kind: 'RESERVE', reservationId: { in: live.map((row: { id: string }) => row.id) } }, _sum: { units: true } }) : [];
  for (const row of [...settled, ...held]) balance.set(row.grantId, (balance.get(row.grantId) ?? 0) + (row._sum.units ?? 0));
  return balance;
}

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export type AiCreditAllowance = { units: number; source: AiCreditAllowanceSource };

/**
 * The lot of a cycle, created on first use (spec §5.1: lazy and idempotent, never back-filled for
 * months nobody used). A pending renewal that got paid keeps its cycleKey and becomes PAID — no second
 * allowance. Creating a cycle closes the company's older cycle lots (they were already unusable: only
 * the current or a turn's pinned cycle funds a call); the close is audited once. Caller holds L1.
 */
export async function ensureAiCreditCycleGrant(tx: any, input: {
  companyId: string; cycle: AiCreditCycle; allowance: () => AiCreditAllowance; now: Date;
}): Promise<{ id: string; units: number; sourceKind: string; availableAt: Date; expiresAt: Date }> {
  const { cycle } = input;
  const sourceKey = `cycle:${cycle.cycleKey}`;
  const select = { id: true, units: true, sourceKind: true, availableAt: true, expiresAt: true, cycleState: true };
  const existing = await tx.aiCreditGrant.findUnique({ where: { sourceKey }, select });
  if (existing) {
    if (existing.cycleState === 'RENEWAL_PENDING' && cycle.state === 'PAID') {
      return tx.aiCreditGrant.update({ where: { id: existing.id }, data: { cycleState: 'PAID', invoiceId: cycle.invoiceId, expiresAt: cycle.end }, select });
    }
    return existing;
  }
  const allowance = input.allowance();
  const created = await tx.aiCreditGrant.create({ data: {
    companyId: input.companyId, billingAccountId: cycle.billingAccountId, sourceKind: 'INCLUDED_CYCLE', sourceKey,
    sourceHash: sha([cycle.cycleKey, cycle.state, cycle.invoiceId, allowance.units, allowance.source]),
    units: allowance.units, availableAt: cycle.start, expiresAt: cycle.end,
    cycleKey: cycle.cycleKey, cycleState: cycle.state, allowanceSource: allowance.source, invoiceId: cycle.invoiceId,
  }, select });
  const closed = await tx.aiCreditGrant.updateMany({
    // Only EARLIER cycles: a late turn that opens the previous cycle's lot must not close the current one.
    where: { companyId: input.companyId, sourceKind: 'INCLUDED_CYCLE', closedAt: null, availableAt: { lt: cycle.start } },
    data: { cycleState: 'CLOSED', closedAt: input.now },
  });
  if (closed.count > 0) {
    await tx.auditLog.create({ data: { companyId: input.companyId, actorType: 'SERVICE', actorRefId: 'ai-credit-cycles',
      action: 'ai_credit.cycle.opened', targetType: 'AiCreditGrant', targetId: created.id, requestId: `ai-credit-cycle:${created.id}`,
      result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { cycleKey: cycle.cycleKey, cycleState: cycle.state, allowanceUnits: allowance.units,
        allowanceSource: allowance.source, closedPreviousCycles: closed.count } } });
  }
  return created;
}

export type AiCreditFunding =
  | { ok: true; cycleKey: string; allocations: Array<{ grantId: string; units: number }> }
  | { ok: false; cause: AiCreditRefusalCause; availableUnits: number };

/**
 * Chooses the lots that hold `units` for one call (spec §5.3). A turn that already holds credit
 * keeps its `pinnedCycleKey`, so a turn crossing a cycle boundary stays on the cycle it was admitted
 * in (A36); lots are judged valid `asOf` the turn's admission. Writes only the cycle lot, if new.
 * DEMO is the exception to the paid-cycle rule: added lots only, even if a cycle exists.
 * Caller holds L1.
 */
export async function planAiCreditFunding(tx: any, input: {
  companyId: string; units: number; asOf: Date; now: Date; pinnedCycleKey?: string;
  allowance: (cycle: AiCreditCycle) => AiCreditAllowance;
}): Promise<AiCreditFunding> {
  const { companyId, asOf } = input;
  let cycleKey: string;
  let cycleLot: { id: string; units: number; sourceKind: string; availableAt: Date; expiresAt: Date } | null;
  const demo = (await tx.company.findUnique({ where: { id: companyId }, select: { reportClassification: true } }))?.reportClassification === 'DEMO';
  if (demo) {
    cycleKey = `demo:${companyId}`;
    cycleLot = null;
  } else if (input.pinnedCycleKey) {
    cycleKey = input.pinnedCycleKey;
    cycleLot = await tx.aiCreditGrant.findFirst({ where: { companyId, sourceKey: `cycle:${cycleKey}`, revokedAt: null },
      select: { id: true, units: true, sourceKind: true, availableAt: true, expiresAt: true } });
  } else {
    const cycle = await readAiCreditCycle(tx, companyId, asOf);
    // D2: added credit is kept but usable only while a paid package is in force.
    if (!cycle) return { ok: false, cause: 'PACKAGE_REQUIRED', availableUnits: 0 };
    cycleKey = cycle.cycleKey;
    cycleLot = await ensureAiCreditCycleGrant(tx, { companyId, cycle, allowance: () => input.allowance(cycle), now: input.now });
  }
  const added: Array<{ id: string; units: number; sourceKind: string; availableAt: Date; expiresAt: Date }> = await tx.aiCreditGrant.findMany({
    where: { companyId, sourceKind: { not: 'INCLUDED_CYCLE' }, revokedAt: null, availableAt: { lte: asOf }, expiresAt: { gt: asOf } },
    select: { id: true, units: true, sourceKind: true, availableAt: true, expiresAt: true },
  });
  const lots = cycleLot ? [cycleLot, ...added] : added;
  const balance = await aiCreditLotBalances(tx, companyId, lots);
  const withBalance = lots.map(lot => ({ ...lot, available: balance.get(lot.id) ?? 0 }));
  const availableUnits = withBalance.reduce((sum, lot) => sum + Math.max(0, lot.available), 0);
  const allocations = planAiCreditAllocation(withBalance, input.units);
  if (!allocations) return { ok: false, cause: availableUnits === 0 ? 'EXHAUSTED' : 'INSUFFICIENT', availableUnits };
  return { ok: true, cycleKey, allocations };
}

/** RESERVE entries for a hold that was just created, in the same transaction. */
export async function writeAiCreditHold(tx: any, input: {
  companyId: string; reservationId: string; allocations: ReadonlyArray<{ grantId: string; units: number }>;
}): Promise<void> {
  await tx.aiCreditEntry.createMany({ data: input.allocations.map(({ grantId, units }) => ({
    companyId: input.companyId, grantId, kind: 'RESERVE', units: -units, reservationId: input.reservationId,
    operationKey: `reserve:${input.reservationId}:${grantId}`,
  })) });
}

/**
 * Settlement consumes held lots in spend order. Owner 2026-10-19: a successful v2 overrun may use
 * additional unheld eligible credit, never another call's hold. The company absorbs the shortfall.
 * Held amounts can still settle after expiry (A07). Idempotent per operation key.
 */
export async function consumeAiCreditHold(tx: any, input: {
  companyId: string; reservationId: string; costSatang: number;
  /** V2 successful overrun only; caller holds company config -> month locks, hold still live. */
  overrun?: { cycleKey: string; asOf: Date };
}): Promise<number> {
  const holds = await tx.aiCreditEntry.findMany({ where: { reservationId: input.reservationId, kind: 'RESERVE' },
    select: { grantId: true, units: true, grant: { select: { id: true, sourceKind: true, availableAt: true, expiresAt: true } } } });
  const held = new Map<string, number>(holds.map((hold: any) => [hold.grantId, -hold.units]));
  const eligible = input.overrun ? await tx.aiCreditGrant.findMany({ where: {
    companyId: input.companyId, revokedAt: null, availableAt: { lte: input.overrun.asOf }, expiresAt: { gt: input.overrun.asOf },
    OR: [{ sourceKey: `cycle:${input.overrun.cycleKey}` }, { sourceKind: { not: 'INCLUDED_CYCLE' } }],
  }, select: { id: true, units: true, sourceKind: true, availableAt: true, expiresAt: true } }) : [];
  const balance = input.overrun ? await aiCreditLotBalances(tx, input.companyId, eligible) : new Map<string, number>();
  const lots = new Map<string, any>(holds.map((hold: any) => [hold.grantId, hold.grant]));
  for (const lot of eligible) lots.set(lot.id, lot);
  let left = Math.max(0, input.costSatang);
  const data: Array<Record<string, unknown>> = [];
  for (const lot of [...lots.values()].sort(aiCreditLotOrder)) {
    // Balance excludes this still-live hold and every competing hold. Only add our own back.
    const available = (held.get(lot.id) ?? 0) + Math.max(0, balance.get(lot.id) ?? 0);
    const take = Math.min(left, available);
    if (take <= 0) continue;
    left -= take;
    data.push({ companyId: input.companyId, grantId: lot.id, kind: 'CONSUME', units: -take,
      reservationId: input.reservationId, operationKey: `consume:${input.reservationId}:${lot.id}` });
  }
  if (data.length) await tx.aiCreditEntry.createMany({ data, skipDuplicates: true });
  return Math.max(0, input.costSatang) - left;
}

/**
 * Chat credit side of the shared add-on grant seam (spec §16 item 1; plan PR B4/C7). Call the seam
 * (`billing-addon-grants.ts` `applyAddOnGrant`), not this: the seam validates, takes L1 → L4, checks the
 * account and readiness, then delegates its CHAT_CREDIT branch here. Same key + same payload returns the
 * first lot (§16 item 6); a different payload under the key throws. Expiry is 12 months from `at` (D1/D8, C03).
 */
export type AiCreditGrantInput = {
  companyId: string; billingAccountId: string | null;
  sourceKind: Exclude<AiCreditSourceKind, 'INCLUDED_CYCLE'>;
  sourceKey: string; sourceHash: string; units: number; at: Date;
  invoiceId?: string | null; operationId?: string | null;
};

export async function applyAiCreditGrant(tx: any, input: AiCreditGrantInput): Promise<{
  lotId: string; units: number; availableAt: Date; expiresAt: Date; replayed: boolean;
}> {
  if (!Number.isSafeInteger(input.units) || input.units < 1 || input.units > 2_147_483_647 || !input.sourceKey || !input.sourceHash
    || !Number.isSafeInteger(input.at.getTime())) throw new Error('billing.addon_grant_invalid');
  const select = { id: true, companyId: true, sourceKind: true, sourceHash: true, units: true, availableAt: true, expiresAt: true };
  const existing = await tx.aiCreditGrant.findUnique({ where: { sourceKey: input.sourceKey }, select });
  if (existing) {
    if (existing.companyId !== input.companyId || existing.sourceHash !== input.sourceHash || existing.sourceKind !== input.sourceKind) {
      throw new Error('billing.addon_source_changed');
    }
    return { lotId: existing.id, units: existing.units, availableAt: existing.availableAt, expiresAt: existing.expiresAt, replayed: true };
  }
  const lot = await tx.aiCreditGrant.create({ data: {
    companyId: input.companyId, billingAccountId: input.billingAccountId, sourceKind: input.sourceKind,
    sourceKey: input.sourceKey, sourceHash: input.sourceHash, units: input.units, availableAt: input.at,
    expiresAt: appendPackageInterval(input.at, 'year'), invoiceId: input.invoiceId ?? null, operationId: input.operationId ?? null,
  }, select });
  return { lotId: lot.id, units: lot.units, availableAt: lot.availableAt, expiresAt: lot.expiresAt, replayed: false };
}

/**
 * Withdraws what is still unused and unheld of an added lot (spec §16 item 8: admin revoke; PR E
 * reuses it for a confirmed refund). Live holds keep settling against the lot; `revokedAt` stops it
 * funding new work, so what a hold returns afterwards stays withdrawn. Never makes a lot negative and
 * never touches what was used. Caller holds L1. Returns the units withdrawn now (0 on a replay).
 */
export async function revokeAiCreditGrant(tx: any, input: { companyId: string; grantId: string; operationKey: string; now: Date }): Promise<number> {
  const lot = await tx.aiCreditGrant.findFirst({ where: { id: input.grantId, companyId: input.companyId, sourceKind: { not: 'INCLUDED_CYCLE' } },
    select: { id: true, units: true, revokedAt: true } });
  if (!lot) throw new Error('ai_credit.grant_not_found');
  const done = await tx.aiCreditEntry.findUnique({ where: { operationKey: input.operationKey }, select: { units: true } });
  if (done) return -done.units;
  const available = Math.max(0, (await aiCreditLotBalances(tx, input.companyId, [lot])).get(lot.id) ?? 0);
  if (!lot.revokedAt) await tx.aiCreditGrant.update({ where: { id: lot.id }, data: { revokedAt: input.now } });
  await tx.aiCreditEntry.create({ data: { companyId: input.companyId, grantId: lot.id, kind: 'REVOKE', units: -available, operationKey: input.operationKey } });
  return available;
}

export type AiCreditLotView = {
  id: string; sourceKind: string; units: number; availableUnits: number; reservedUnits: number; consumedUnits: number;
  revokedUnits: number; availableAt: Date; expiresAt: Date; revokedAt: Date | null; cycleKey: string | null; cycleState: string | null;
};

export type AiCreditBalance = {
  /** The cycle in force, or null when no paid package cycle exists (the lot of a cycle nobody used yet
   *  is shown at its allowance). */
  cycle: AiCreditCycle | null;
  packageRemainingUnits: number;
  additionalRemainingUnits: number;
  totalRemainingUnits: number;
  /** Admin projection only (spec §5.2): customers never see holds or sources (D10, §17). */
  lots: AiCreditLotView[];
};

/**
 * One read of a company's AI credit (spec §17.2): the same lots and the same net as admission, so
 * the operator, readiness and later the customer summary agree. Read-only — a cycle nobody has used
 * yet is projected at `allowance`, not created. Package credit counts only for the cycle in force;
 * added credit only while a paid package is in force (D2), otherwise it is kept but not available.
 * DEMO uses added credit without a cycle and never projects a package allowance.
 */
export async function readAiCreditBalance(tx: any, input: {
  companyId: string; at: Date; allowance: (cycle: AiCreditCycle) => AiCreditAllowance;
}): Promise<AiCreditBalance> {
  const demo = (await tx.company.findUnique({ where: { id: input.companyId }, select: { reportClassification: true } }))?.reportClassification === 'DEMO';
  const cycle = demo ? null : await readAiCreditCycle(tx, input.companyId, input.at);
  const grants = await tx.aiCreditGrant.findMany({
    where: { companyId: input.companyId, OR: [
      ...(cycle ? [{ sourceKey: `cycle:${cycle.cycleKey}` }] : []),
      { sourceKind: { not: 'INCLUDED_CYCLE' }, expiresAt: { gt: input.at } },
    ] },
    select: { id: true, sourceKind: true, units: true, availableAt: true, expiresAt: true, revokedAt: true, cycleKey: true, cycleState: true },
  });
  const ids = grants.map((grant: { id: string }) => grant.id);
  const byKind = ids.length ? await tx.aiCreditEntry.groupBy({ by: ['grantId', 'kind'], where: { grantId: { in: ids } }, _sum: { units: true } }) : [];
  const balance = await aiCreditLotBalances(tx, input.companyId, grants);
  const sumOf = (id: string, kind: string) => -(byKind.find((row: any) => row.grantId === id && row.kind === kind)?._sum.units ?? 0);
  const lots: AiCreditLotView[] = grants.map((grant: any) => {
    const available = balance.get(grant.id) ?? grant.units;
    const consumed = sumOf(grant.id, 'CONSUME'), revoked = sumOf(grant.id, 'REVOKE');
    return { id: grant.id, sourceKind: grant.sourceKind, units: grant.units, availableUnits: grant.revokedAt ? 0 : Math.max(0, available),
      reservedUnits: Math.max(0, grant.units - consumed - revoked - available), consumedUnits: consumed, revokedUnits: revoked,
      availableAt: grant.availableAt, expiresAt: grant.expiresAt, revokedAt: grant.revokedAt, cycleKey: grant.cycleKey, cycleState: grant.cycleState };
  });
  const cycleLot = lots.find(lot => lot.sourceKind === 'INCLUDED_CYCLE');
  const packageRemainingUnits = cycle ? cycleLot?.availableUnits ?? input.allowance(cycle).units : 0;
  const additionalRemainingUnits = cycle || demo
    ? lots.filter(lot => lot.sourceKind !== 'INCLUDED_CYCLE' && lot.availableAt <= input.at).reduce((sum, lot) => sum + lot.availableUnits, 0) : 0;
  return { cycle, packageRemainingUnits, additionalRemainingUnits, totalRemainingUnits: packageRemainingUnits + additionalRemainingUnits, lots };
}
