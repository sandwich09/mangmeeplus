import { Injectable } from '@nestjs/common';
import { LINE_AI_CONTEXT_WINDOW_MINUTES, type LineAiReadMemory } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { deliveryHash, lineDeliveryPlanId, parseDeliveryBatchStates, parseLineDeliveryPlan, type DeliveryPlanV2 } from '../domain/logic/line-delivery-plan.logic';
import { LINE_RECENT_CAPTURE_WINDOW_MS } from '../../expenses/application/services/line-recent-capture';

export type LineQuotedRecord = { tool: 'expense.get_detail' | 'reimbursement.get_detail' | 'voucher.get_detail' | 'counterparty.get_detail'; id: string };
export type LineQuoteOwner = { companyId: string; userId: string; membershipId: string; chatKeyHash: string; channelId: string;
  recipientHash: string; accessFingerprint: string; conversationId?: string; ownerEpoch?: number };
const TOOLS = new Set(['expense.get_detail', 'reimbursement.get_detail', 'voucher.get_detail', 'counterparty.get_detail']);
export function quoteRecordsFromReads(reads: readonly LineAiReadMemory[]): LineQuotedRecord[] {
  return reads.flatMap(read => {
    const tool = read.tool.startsWith('expense.') ? 'expense.get_detail' : read.tool.startsWith('reimbursement.') ? 'reimbursement.get_detail'
      : read.tool.startsWith('voucher.') ? 'voucher.get_detail' : read.tool.startsWith('counterparty.') ? 'counterparty.get_detail' : null;
    return tool ? (read.shownItems ?? []).filter(item => !item.kind).map(item => ({ tool, id: item.id } as LineQuotedRecord)) : [];
  });
}
export function validQuoteRecords(value: unknown): LineQuotedRecord[] {
  if (!Array.isArray(value) || value.length > 30) return [];
  if (!value.every(row => row && typeof row === 'object' && TOOLS.has(row.tool) && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 200)) return [];
  return [...new Map(value.map(row => [`${row.tool}:${row.id}`, { tool: row.tool, id: row.id } as LineQuotedRecord])).values()];
}
export function quoteRecordsFromPlan(plan: DeliveryPlanV2, batchIndex?: number, messageIndex?: number): LineQuotedRecord[] {
  if (plan.authorization.kind !== 'PRIVATE') return [];
  if (batchIndex !== undefined && messageIndex !== undefined) {
    const proof = plan.authorization.proofs.find(proof => proof.kind === 'QUOTE_REFERENCES');
    if (proof && Array.isArray(proof.items)) {
      const spans = plan.batches[batchIndex]?.spans.filter(span => span.messageIndex === messageIndex) ?? [];
      return spans.length ? validQuoteRecords(proof.items.flatMap(item => item && spans.some(span => span.itemId === item.itemId) ? validQuoteRecords(item.records) : []))
        : validQuoteRecords(proof.controlRecords);
    }
  }
  return validQuoteRecords(plan.authorization.proofs.flatMap(proof => proof.kind === 'QUOTE_REFERENCES' ? validQuoteRecords(proof.records)
    : proof.kind === 'EXPENSE_REVISION' && Array.isArray(proof.records) ? proof.records.map(row => ({ tool: 'expense.get_detail', id: row?.id }))
      : proof.kind === 'CAPTURE_RESULT' && typeof proof.expenseId === 'string' ? [{ tool: 'expense.get_detail', id: proof.expenseId }] : []));
}
export function quoteReadMemory(records: LineQuotedRecord[]): LineAiReadMemory[] {
  return [...new Set(records.map(record => record.tool))].map(tool => ({ tool, answerShape: 'list', asOf: new Date().toISOString(),
    shownItems: records.filter(record => record.tool === tool).map((record, i) => ({ id: record.id, ordinal: i + 1, label: 'รายการที่อ้างตอบ' })) }));
}
function sameOwner(saved: Record<string, unknown>, owner: LineQuoteOwner): boolean {
  return Object.entries(owner).every(([key, value]) => value === undefined || saved[key] === value);
}

/** IDs only. Both storage paths inherit the existing outcome/plan PDPA purge; lookups expire with read context. */
@Injectable()
export class LineQuotedMessageService {
  constructor(private readonly prisma: PrismaService) {}
  async recentRecords(owner: LineQuoteOwner): Promise<LineQuotedRecord[]> {
    const now = new Date();
    const rows = await this.prisma.client.lineDeliveryPlan.findMany({ where: { companyId: owner.companyId, userId: owner.userId,
      createdAt: { gte: new Date(now.getTime() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000) }, purgeAt: { gt: now },
      planJson: { path: ['authorization', 'actor', 'chatKeyHash'], equals: owner.chatKeyHash } }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { planJson: true, planHash: true, batchStateJson: true } });
    for (const row of rows) {
      const plan = parseLineDeliveryPlan(row.planJson);
      if (!plan || row.planHash !== deliveryHash(plan) || plan.authorization.kind !== 'PRIVATE'
        || !sameOwner(plan.authorization.actor, owner)
        || !parseDeliveryBatchStates(row.batchStateJson, plan)?.every(state => state.status === 'ACCEPTED')) continue;
      const records = quoteRecordsFromPlan(plan);
      if (records.length) return records;
    }
    return [];
  }
  /** The latest delivered claim read or draft receipt supplies a follow-up locator, never financial facts. */
  async recentReimbursementDraft(owner: LineQuoteOwner): Promise<LineQuotedRecord[]> {
    const now = new Date();
    const rows = await this.prisma.client.lineDeliveryPlan.findMany({ where: { companyId: owner.companyId, userId: owner.userId,
      createdAt: { gte: new Date(now.getTime() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000) }, purgeAt: { gt: now } }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { planJson: true, planHash: true, batchStateJson: true } });
    for (const row of rows) {
      const plan = parseLineDeliveryPlan(row.planJson);
      if (!plan || row.planHash !== deliveryHash(plan) || plan.authorization.kind !== 'PRIVATE'
        || !sameOwner(plan.authorization.actor, owner)
        || !parseDeliveryBatchStates(row.batchStateJson, plan)?.every(state => state.status === 'ACCEPTED')) continue;
      const records = quoteRecordsFromPlan(plan);
      if (!records.length) continue;
      // A later expense/voucher is a different target; never silently select an older claim.
      return records.every(record => record.tool === 'reimbursement.get_detail') ? records : [];
    }
    return [];
  }
  async rememberLegacy(webhookEventId: string, owner: LineQuoteOwner, messageIds: string[], records: LineQuotedRecord[], perMessageRecords?: LineQuotedRecord[][]): Promise<void> {
    if (!messageIds.length || !records.length) return;
    const row = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId }, select: { id: true, authorizationJson: true } });
    if (!row) return;
    const root = row.authorizationJson && typeof row.authorizationJson === 'object' && !Array.isArray(row.authorizationJson) ? row.authorizationJson : {};
    const previous = (root as Record<string, unknown>).quote as Record<string, unknown> | undefined;
    const sent = messageIds.map((messageId, i) => ({ messageId, records: validQuoteRecords(perMessageRecords?.length === messageIds.length ? perMessageRecords[i] : records) }));
    if (previous && sameOwner(previous, owner) && Array.isArray(previous.sent)) sent.unshift(...previous.sent.slice(-15));
    if (previous && sameOwner(previous, owner) && Array.isArray(previous.messageIds)) messageIds = [...new Set([...previous.messageIds.filter((id): id is string => typeof id === 'string'), ...messageIds])].slice(-15);
    await this.prisma.client.lineTurnOutcome.updateMany({ where: { id: row.id, companyId: owner.companyId },
      data: { authorizationJson: { ...root, quote: { ...owner, messageIds, records: validQuoteRecords(records), sent: sent.slice(-15) } } as Prisma.InputJsonValue } });
  }
  async resolve(owner: LineQuoteOwner, quotedMessageId: string | undefined): Promise<LineQuotedRecord[]> {
    if (!quotedMessageId || !/^[A-Za-z0-9_-]{1,200}$/u.test(quotedMessageId)) return [];
    const now = new Date(), since = new Date(now.getTime() - LINE_AI_CONTEXT_WINDOW_MINUTES * 60_000);
    const plans = await this.prisma.client.lineDeliveryPlan.findMany({ where: { companyId: owner.companyId, userId: owner.userId,
      createdAt: { gte: since }, purgeAt: { gt: now }, planJson: { path: ['authorization', 'actor', 'chatKeyHash'], equals: owner.chatKeyHash } },
      orderBy: { createdAt: 'desc' }, take: 50, select: { planJson: true, planHash: true, batchStateJson: true } });
    for (const row of plans) {
      const plan = parseLineDeliveryPlan(row.planJson);
      if (!plan || row.planHash !== deliveryHash(plan) || plan.authorization.kind !== 'PRIVATE' || !sameOwner(plan.authorization.actor, owner)) continue;
      const states = parseDeliveryBatchStates(row.batchStateJson, plan);
      const batchIndex = states?.findIndex(state => state.status === 'ACCEPTED' && state.sentMessageIds?.includes(quotedMessageId)) ?? -1;
      if (batchIndex >= 0) return quoteRecordsFromPlan(plan, batchIndex, states![batchIndex]!.sentMessageIds!.indexOf(quotedMessageId));
    }
    const outcomes = await this.prisma.client.lineTurnOutcome.findMany({ where: { companyId: owner.companyId, deliveredAt: { gte: since },
      authorizationJson: { path: ['quote', 'chatKeyHash'], equals: owner.chatKeyHash } }, orderBy: { deliveredAt: 'desc' }, take: 50,
      select: { authorizationJson: true } });
    for (const row of outcomes) {
      const quote = (row.authorizationJson as Record<string, unknown> | null)?.quote as Record<string, unknown> | undefined;
      if (quote && sameOwner(quote, owner) && Array.isArray(quote.messageIds) && quote.messageIds.includes(quotedMessageId)) {
        const sent = Array.isArray(quote.sent) ? quote.sent.find(row => row?.messageId === quotedMessageId) : null;
        return validQuoteRecords(sent ? sent.records : quote.records);
      }
    }
    const expense = await this.prisma.client.expenseRecord.findFirst({ where: {
      companyId: owner.companyId, createdByUserId: owner.userId, captureSource: 'LINE_UPLOAD',
      createdAt: { gte: new Date(now.getTime() - LINE_RECENT_CAPTURE_WINDOW_MS) },
      AND: [
        { sourceChannelMetadataJson: { path: ['chatKeyHash'], equals: owner.chatKeyHash } },
        { sourceChannelMetadataJson: { path: ['lineMessageId'], equals: quotedMessageId } },
      ],
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
    if (expense) return [{ tool: 'expense.get_detail', id: expense.id }];

    const event = await this.prisma.client.lineWebhookEventLog.findFirst({ where: {
      lineMessageId: quotedMessageId, companyId: owner.companyId, createdAt: { gte: since },
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { webhookEventId: true } });
    if (!event) return [];
    const planId = lineDeliveryPlanId('WEBHOOK', deliveryHash(['line-outcome-v2', event.webhookEventId]));
    const row = await this.prisma.client.lineDeliveryPlan.findUnique({ where: { id: planId, companyId: owner.companyId,
      userId: owner.userId, purgeAt: { gt: now } }, select: { planJson: true, planHash: true, batchStateJson: true } });
    const plan = row && parseLineDeliveryPlan(row.planJson);
    if (plan && plan.planId === planId && row.planHash === deliveryHash(plan) && plan.authorization.kind === 'PRIVATE'
      && sameOwner(plan.authorization.actor, owner)
      && parseDeliveryBatchStates(row.batchStateJson, plan)?.every(state => state.status === 'ACCEPTED')) return quoteRecordsFromPlan(plan);

    const outcome = await this.prisma.client.lineTurnOutcome.findUnique({ where: { webhookEventId: event.webhookEventId,
      companyId: owner.companyId, deliveredAt: { gte: since } }, select: { authorizationJson: true } });
    const quote = (outcome?.authorizationJson as Record<string, unknown> | null)?.quote as Record<string, unknown> | undefined;
    return quote && sameOwner(quote, owner) ? validQuoteRecords(quote.records) : [];
  }
}
