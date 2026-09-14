import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LINE_TOOL_REGISTRY, hasToolFeature, hasToolPermissions, type ToolResult, type LineAiTurnRequest, type LineAiTurnResponse } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { PermissionResolverService } from '../../access-control/application/permission-resolver.service';
import { loadEntitledFeatureKeys } from '../../employee-access/application/entitlement.helper';
import { ERP_READ_TOOL_REGISTRY, type ErpReadToolPort, type ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { lineDeliveryRecipientHash, parseLineReadDeliveryAuthorization, resolvedLineDeliveryAccessFingerprint } from './line-delivery-access';

export const LINE_READ_EVIDENCE_MAX = 64;
export const LINE_READ_EVIDENCE_MAX_INPUT_BYTES = 8192;
export const LINE_READ_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1000;
const READ_CATEGORIES = new Set(['read_summary', 'read_detail', 'report', 'suggestion']);

export const isLineEvidenceRead = (toolName: string) => READ_CATEGORIES.has(LINE_TOOL_REGISTRY.find(tool => tool.name === toolName)?.category ?? '');

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Ignore only read-observation timestamps; preserve business values, references and result order. */
export function lineReadResultHash(result: ToolResult): string {
  const material = { toolName: result.toolName, status: result.status, data: result.data,
    sourceRefs: result.sourceRefs.map(({ asOf: _observation, ...source }) => source) };
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(material))))).digest('hex');
}

@Injectable()
export class LineReadEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionResolverService,
    @Inject(ERP_READ_TOOL_REGISTRY) private readonly tools: ReadonlyMap<string, ErpReadToolPort>,
  ) {}

  async record(ctx: ErpToolContext, input: Record<string, unknown>, result: ToolResult): Promise<string> {
    const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === result.toolName);
    if (!meta || !READ_CATEGORIES.has(meta.category) || result.status !== 'ok'
      || !ctx.requestId || !ctx.membershipId) throw new Error('LINE_READ_EVIDENCE_UNSUPPORTED');
    // Grounding text belongs to draft preview and is deliberately never persisted here.
    const snapshot = JSON.stringify({ input, locale: ctx.locale, ...(ctx.chatKeyHash ? { chatKeyHash: ctx.chatKeyHash } : {}) });
    if (Buffer.byteLength(snapshot, 'utf8') > LINE_READ_EVIDENCE_MAX_INPUT_BYTES) throw new Error('LINE_READ_EVIDENCE_INPUT_LIMIT');
    const resultHash = lineReadResultHash(result);
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-read-evidence:${ctx.companyId}:${ctx.userId}:${ctx.requestId}`}))`;
      const count = await tx.lineReadEvidence.count({ where: { companyId: ctx.companyId, userId: ctx.userId, requestId: ctx.requestId } });
      if (count >= LINE_READ_EVIDENCE_MAX) throw new Error('LINE_READ_EVIDENCE_LIMIT');
      const row = await tx.lineReadEvidence.create({ data: { companyId: ctx.companyId, userId: ctx.userId,
        membershipId: ctx.membershipId!, requestId: ctx.requestId!, toolName: result.toolName,
        inputJson: JSON.parse(snapshot) as Prisma.InputJsonValue, resultHash }, select: { id: true } });
      return row.id;
    });
  }

  async forRequest(companyId: string, userId: string, requestId: string): Promise<string[]> {
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId, userId, requestId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LINE_READ_EVIDENCE_MAX + 1, select: { id: true },
    });
    if (rows.length > LINE_READ_EVIDENCE_MAX) throw new Error('LINE_READ_EVIDENCE_LIMIT');
    return rows.map(row => row.id);
  }

  /** Telemetry can require extra proof, but can never discard a read recorded by the API. */
  async forTurn(request: LineAiTurnRequest, response: LineAiTurnResponse): Promise<string[] | null> {
    const rows = await this.prisma.client.lineReadEvidence.findMany({
      where: { companyId: request.userContext.companyId!, userId: request.userContext.internalUserId!, requestId: request.requestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: LINE_READ_EVIDENCE_MAX + 1,
      select: { id: true, toolName: true },
    });
    if (rows.length > LINE_READ_EVIDENCE_MAX) return null;
    const reported = response.toolCalls?.length
      ? response.toolCalls.filter(call => call.status === 'ok').map(call => call.name)
      : response.refused ? [] : response.toolsInvoked;
    if (reported.filter(isLineEvidenceRead).some(name => !rows.some(row => row.toolName === name))) return null;
    // Draft preview has its own current-state confirmation boundary; it is never re-executed here.
    if (response.sourceRefs.length && !rows.length && !reported.some(name => LINE_TOOL_REGISTRY.find(tool => tool.name === name)?.category === 'draft_update')) return null;
    return rows.map(row => row.id);
  }

  async verifyDelivery(value: unknown, recipient: { webhookEventId: string; lineUserId: string; chatId: string; channelId: string }): Promise<boolean> {
    const read = parseLineReadDeliveryAuthorization(value);
    if (!read || read.webhookEventId !== recipient.webhookEventId || recipient.lineUserId !== recipient.chatId
      || read.channelId !== recipient.channelId
      || read.recipientHash !== lineDeliveryRecipientHash(recipient.lineUserId, recipient.chatId, recipient.channelId)) return false;
    if (!await this.verify(read.companyId, read.userId, read.requestId, read.ids)) return false;
    // Resolve again after potentially slow source reads; source access is not actor continuity.
    const where = { provider: 'LINE' as const, status: 'ACTIVE' as const, providerUserId: recipient.lineUserId };
    const scoped = recipient.channelId ? await this.prisma.client.externalIdentity.findFirst({ where: { ...where, providerChannelId: recipient.channelId }, include: { user: true } }) : null;
    const identity = scoped ?? await this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    if (!identity || identity.userId !== read.userId || identity.user.status !== 'ACTIVE' || identity.user.aiAssistantOptOutAt) return false;
    const access = await this.resolver.resolveAccess(read.userId, read.companyId);
    const entitled = await loadEntitledFeatureKeys(this.prisma, read.companyId);
    const context = await this.prisma.client.lineCompanyContext.findUnique({ where: { lineUserId: recipient.lineUserId }, select: { companyId: true, aiPausedUntil: true } });
    return (!context?.companyId || context.companyId === read.companyId)
      && (!context?.aiPausedUntil || context.aiPausedUntil.getTime() <= Date.now())
      && read.fingerprint === resolvedLineDeliveryAccessFingerprint(read.userId, read.companyId, access, entitled);
  }

  /** Read implementations only. This never invokes a model, capture, preview, approval or mutation. */
  async verify(companyId: string, userId: string, requestId: string, ids: readonly string[], now = new Date()): Promise<boolean> {
    if (!ids.length || ids.length > LINE_READ_EVIDENCE_MAX || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) return false;
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, select: { status: true, aiAssistantOptOutAt: true } });
    if (!user || user.status !== 'ACTIVE' || user.aiAssistantOptOutAt) return false;
    const access = await this.resolver.resolveAccess(userId, companyId);
    if (access.companyId !== companyId || !access.permissions.includes('ai.tool.invoke')) return false;
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    const rows = await this.prisma.client.lineReadEvidence.findMany({ where: {
      id: { in: [...ids] }, companyId, userId, requestId, membershipId: access.membershipId,
      createdAt: { gte: new Date(now.getTime() - LINE_READ_EVIDENCE_MAX_AGE_MS), lte: new Date(now.getTime() + 30_000) },
    }, orderBy: { id: 'asc' } });
    if (rows.length !== ids.length) return false;
    for (const row of rows) {
      const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === row.toolName), tool = this.tools.get(row.toolName);
      if (!meta || !tool || !READ_CATEGORIES.has(meta.category) || !hasToolPermissions(meta, access.permissions) || !hasToolFeature(meta, entitled)) return false;
      const saved = row.inputJson as { input?: unknown; locale?: unknown; chatKeyHash?: unknown } | null;
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !saved.input
        || typeof saved.input !== 'object' || Array.isArray(saved.input) || typeof saved.locale !== 'string'
        || (saved.chatKeyHash !== undefined && typeof saved.chatKeyHash !== 'string')
        || Buffer.byteLength(JSON.stringify(saved), 'utf8') > LINE_READ_EVIDENCE_MAX_INPUT_BYTES) return false;
      const current = await tool.execute({ requestId, companyId, userId, membershipId: access.membershipId,
        permissions: access.permissions, roles: access.roles, branchIds: access.scopes.branchIds,
        locationIds: access.scopes.locationIds, locale: saved.locale, chatKeyHash: saved.chatKeyHash as string | undefined,
      }, saved.input as Record<string, unknown>);
      if (current.status !== 'ok' || lineReadResultHash(current) !== row.resultHash) return false;
    }
    return true;
  }
}
