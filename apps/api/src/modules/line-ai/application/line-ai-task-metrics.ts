import Decimal from 'decimal.js';
import type { AiBudgetReservation, AiUsageEvent, PrismaClient } from '../../../generated/prisma/client';
import { deliveryHash } from '../domain/logic/line-delivery-plan.logic';

type JsonRecord = Record<string, any>;
const object = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

/** Pinned prices only. Provider decimals stay separate from the rounded customer ledger. */
export function summarizeLineTaskCost(reservations: AiBudgetReservation[], usage: AiUsageEvent[]) {
  const byInvocation = new Map(usage.map(row => [row.invocationKey, row]));
  let provider = new Decimal(0), customerSatang = 0, companyAbsorbedSatang = 0, modelCalls = 0, classifierTimeouts = 0;
  let measured = false, estimated = false, costPending = false;
  for (const row of reservations) {
    const evidence = object(row.evidenceJson), snapshot = object(row.pricingSnapshot), actual = byInvocation.get(row.invocationKey);
    const pending = ['RESERVED', 'DISPATCHED', 'UNRESOLVED'].includes(row.status);
    costPending ||= pending;
    customerSatang += Number(evidence.customerChargedSatang ?? 0);
    companyAbsorbedSatang += Number(evidence.companyAbsorbedSatang ?? 0);
    if (actual || evidence.reason === 'COMPANY_ABSORBED' || ['DISPATCHED', 'SETTLED', 'UNRESOLVED'].includes(row.status)) modelCalls++;
    if (/classif/iu.test(row.stepKind) && /timeout|deadline/iu.test(String(evidence.errorCode ?? ''))) classifierTimeouts++;
    // An unused cancelled hold is not provider spend.
    if (row.status === 'CANCELLED' && !actual && evidence.reason !== 'COMPANY_ABSORBED') continue;
    const basis = row.usageBasis === 'COMPANY_ABSORBED' ? evidence.providerUsageBasis : row.usageBasis;
    const tariff = object(snapshot.tariff), priced = object(actual?.pricingSnapshot);
    const rates = object(priced.usdPerMTok ?? tariff.usdPerMTok);
    const fx = priced.thbPerUsd ?? tariff.thbPerUsd;
    const counters = [actual?.inputTokens ?? evidence.inputTokens, actual?.outputTokens ?? evidence.outputTokens,
      actual?.cacheReadInputTokens ?? evidence.cacheReadInputTokens, actual?.cacheWriteInputTokens ?? evidence.cacheWriteInputTokens];
    const units = evidence.externalUnits ?? (snapshot.externalUnitBound > 0 ? undefined : 0);
    const complete = basis !== 'OPERATOR_CHARGED_AT_BOUND' && counters.every(value => Number.isSafeInteger(value) && value >= 0)
      && ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => Number.isFinite(rates[key]) && rates[key] >= 0)
      && Number.isFinite(fx) && fx > 0 && Number.isSafeInteger(units) && units >= 0
      && (units === 0 || Number.isFinite(tariff.externalUsdPerUnit));
    if (complete) {
      const tokenUsd = counters.reduce<Decimal>((sum, count, index) => sum.plus(new Decimal(count)
        .mul(rates[['input', 'output', 'cacheRead', 'cacheWrite'][index]!])), new Decimal(0))
        .plus(new Decimal(units).mul(tariff.searchContentInputTokensPerUnit ?? 0).mul(rates.input));
      provider = provider.plus(tokenUsd.div(1_000_000).plus(new Decimal(units).mul(tariff.externalUsdPerUnit ?? 0)).mul(fx).mul(100));
      if (basis === 'PROVIDER_REPORTED') measured = true;
      else estimated = true;
    } else if (Number.isSafeInteger(row.upperBoundSatang) && row.upperBoundSatang >= 0) {
      provider = provider.plus(row.upperBoundSatang); estimated = true;
    } else costPending = true;
  }
  return { modelCalls, providerCostExactSatang: provider.toFixed(), customerSatang, companyAbsorbedSatang,
    costBasis: measured && estimated ? 'mixed' : estimated ? 'estimated' : costPending ? 'unknown' : 'measured', costPending, classifierTimeouts };
}

export async function lineTaskSummary(client: PrismaClient, taskRunId: string) {
  const task = await client.lineAiTaskRun.findUniqueOrThrow({ where: { id: taskRunId } });
  const events = await client.lineWebhookEventLog.findMany({ where: { companyId: task.companyId, taskRunId }, select: { webhookEventId: true } });
  const attemptKeys = events.flatMap(event => [deliveryHash(['line-turn-v2', event.webhookEventId]), deliveryHash(['line-classify-v2', event.webhookEventId])]);
  const reservations = await client.aiBudgetReservation.findMany({ where: { companyId: task.companyId, attemptKey: { in: attemptKeys } } });
  const usage = await client.aiUsageEvent.findMany({ where: { companyId: task.companyId, invocationKey: { in: reservations.map(row => row.invocationKey) } } });
  return { taskRunId, kind: task.kind, entry: task.entry, status: task.status, deadEnd: task.deadEnd,
    eventCount: task.eventCount, pressCount: task.pressCount, typedCount: task.typedCount,
    ...summarizeLineTaskCost(reservations, usage), durationMs: (task.endedAt ?? new Date()).getTime() - task.startedAt.getTime() };
}

export type LineTaskObservation = {
  webhookEventId: string; companyId: string; membershipId: string; chatKeyHash: string;
  kind: string; entry: 'BUTTON' | 'NOTIFICATION' | 'TYPED_CLASSIFIED' | 'TYPED_FULL'; pressed: boolean;
  status: 'OPEN' | 'COMPLETED' | 'DECLINED' | 'REFUSED'; deadEnd: boolean;
  sourceType?: string; sourceId?: string; resultType?: string; resultId?: string;
};

/** The event's conditional link is the counter fence, including retries after a worker crash. */
export async function recordLineTaskEvent(client: PrismaClient, input: LineTaskObservation): Promise<string | null> {
  return client.$transaction(async tx => {
    const event = await tx.lineWebhookEventLog.findUnique({ where: { webhookEventId: input.webhookEventId } });
    if (!event || event.companyId !== input.companyId || event.taskRunId) return null;
    const now = new Date();
    const existing = await tx.lineAiTaskRun.findFirst({ where: { companyId: input.companyId, membershipId: input.membershipId,
      chatKeyHash: input.chatKeyHash, kind: input.kind, status: 'OPEN', updatedAt: { gte: new Date(now.getTime() - 30 * 60_000) },
      ...(input.sourceId ? { OR: [{ sourceId: input.sourceId }, { sourceId: null }] } : {}) }, orderBy: { startedAt: 'desc' } });
    const id = existing?.id ?? deliveryHash(['line-ai-task-run-v1', input.companyId, input.membershipId, input.webhookEventId]);
    // ON CONFLICT DO NOTHING: a concurrent replay of the same event may create the row first (upsert is not atomic).
    if (!existing) await tx.lineAiTaskRun.createMany({ data: [{
      id, companyId: input.companyId, membershipId: input.membershipId, chatKeyHash: input.chatKeyHash, kind: input.kind, entry: input.entry,
    }], skipDuplicates: true });
    const claimed = await tx.lineWebhookEventLog.updateMany({ where: { id: event.id, companyId: input.companyId, taskRunId: null }, data: { taskRunId: id } });
    if (claimed.count !== 1) return null;
    await tx.lineAiTaskRun.update({ where: { id }, data: {
      eventCount: { increment: 1 }, pressCount: { increment: Number(input.pressed) }, typedCount: { increment: Number(!input.pressed) },
      status: input.status, deadEnd: input.deadEnd || existing?.deadEnd,
      ...(input.status !== 'OPEN' ? { endedAt: now } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId, sourceType: input.sourceType } : {}),
      ...(input.resultId ? { resultId: input.resultId, resultType: input.resultType } : {}),
    } });
    return input.status === 'OPEN' ? null : id;
  });
}
