import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AI_BUDGET_PROFILE_TABLE_DIGEST_V2, AI_BUDGET_PROFILES_V2, AI_BUDGET_ESTIMATOR_VERSION_V2,
  aiBudgetV2CallAllowed, aiBudgetV2OrdinalCeiling, aiGatewayClientTimeoutMs,
  parseAiBudgetGrantV2, parseAiBudgetEnvelopeV2, lineDocumentQaInputEvidenceText, parseLineDocumentQaQuestions,
  type LineDocumentQaAttachment, type LineWorkflowClassifyResponse,
  type AiBudgetGrantV2, type AiBudgetInvocationV2, type AiBudgetEnvelopeV2, type AiBudgetProfileIdV2,
} from '@watchdog-bms/contracts';
import { deliveryHash } from '../domain/logic/line-delivery-plan.logic';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { lineConversationId, type LineConversationOwner } from './line-conversation-context.service';
import { priceRenderedAiInvocationV2, validAiTariffV2, type AiTariffV2 } from './ai-model-pricing';
import { readCompanyAiCreditState, reserveAiBudgetStep, type AiBudgetReserveOutcome } from './company-ai-budget-reservation';

type PublicOwner = { companyId: string; channel: 'line'; channelKind: 'USER' | 'GROUP' | 'ROOM'; messagingChannelId: string; chatKeyHash: string };
export type AuthorityOwner = { kind: 'PRIVATE'; owner: LineConversationOwner; epoch: number; taskId?: string; taskRevision?: number }
  | { kind: 'PUBLIC_GENERAL'; owner: PublicOwner };
type BudgetAuthority = {
  version: 2; grant: AiBudgetGrantV2; owner: AuthorityOwner; tariff: AiTariffV2;
  requestKind: 'TEXT' | 'IMAGE' | 'OTHER';
  inputDigest: string; modelContextTokens: number; modelMaxOutputTokens: number; nextOrdinal: number; coalescingExtraMs?: number; narrowedLane?: string;
  profileCounts: Partial<Record<AiBudgetProfileIdV2, number>>; repairCount: number; transferredToQa?: string;
  /** Add-on spec §5.3: the AI credit cycle this turn's first funded call used. API-side only, never
   *  in the signed grant, so the Gateway/AgentCore contract is unchanged; later calls stay on it. */
  fundingContext?: { cycleKey: string };
  /** Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): work accepted before the credit ran out. Every call
   *  under this authority passes the cap (never a cap of 0). API-side only, like `fundingContext`. */
  admitOverCap?: true;
  serverRoute?: 'fixed_read';
  decision?: LineWorkflowClassifyResponse;
};
export type IssueLineAiBudgetGrant = {
  authorityKind: AiBudgetGrantV2['authorityKind']; authorityId: string; owner: AuthorityOwner;
  turnKey: string; attemptKey: string; inputDigest: string; requestKind: 'TEXT' | 'IMAGE' | 'OTHER';
  admittedAtMs: number; coalescingExtraMs: number; lane: 'general' | 'simple' | 'mixed' | 'public' | 'document_qa' | 'classify';
  model: AiBudgetGrantV2['model']; modelContextTokens: number; modelMaxOutputTokens: number; tariff: AiTariffV2;
  allowedProfileIds: AiBudgetProfileIdV2[];
  /** See `BudgetAuthority.admitOverCap`; decided by the admitted webhook producer only. */
  admitOverCap?: boolean;
  serverRoute?: 'fixed_read';
};
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const baseCeilings = { classify: 8_000, general: 10_000, simple: 15_000, mixed: 30_000, public: 40_000, document_qa: 15 * 60_000 };
export function documentQaAuthorityInputDigest(job: { questionText: string; attachmentsJson: unknown; questionsJson?: unknown }): string | null {
  if (typeof job.questionText !== 'string' || !job.questionText || !Array.isArray(job.attachmentsJson)) return null;
  const questions = job.questionsJson == null ? undefined : parseLineDocumentQaQuestions(job.questionsJson, job.questionText);
  if (job.questionsJson != null && !questions) return null;
  const attachments = job.attachmentsJson as LineDocumentQaAttachment[];
  if (!attachments.length || attachments.length > 5 || attachments.some(item => !item || typeof item.attachmentId !== 'string'
    || !/^[0-9a-f]{64}$/.test(item.contentHash) || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(item.mimeType)
    || !Array.isArray(item.requestedPages) || !item.requestedPages.length || item.requestedPages.some(page => !Number.isSafeInteger(page) || page < 1))) return null;
  const pages = attachments.flatMap(item => item.requestedPages.map(page => ({ attachmentId: item.attachmentId, page,
    sourceMimeType: item.mimeType, contentHash: item.contentHash })));
  if (pages.length > 20) return null;
  return createHash('sha256').update(lineDocumentQaInputEvidenceText(job.questionText, pages, questions)).digest('hex');
}
const MAX_AUTHORITY_BYTES = 32 * 1024;
const sameModel = (left: AiBudgetGrantV2['model'], right: AiBudgetGrantV2['model']) => left.provider === right.provider && left.modelId === right.modelId && left.region === right.region;

export class LineAiBudgetDeadlineExceededError extends Error {
  readonly code = 'DEADLINE_EXCEEDED';
  constructor() { super('LINE_AI_BUDGET_DEADLINE_EXCEEDED'); this.name = 'LineAiBudgetDeadlineExceededError'; }
}

/** Durable event/ledger authority, independent of the 15-minute conversational projection.
 * The existing admitted webhook path is the only caller of issue(); HTTP exposes only reserve(). */
@Injectable()
export class LineAiBudgetAuthorityService {
  constructor(private readonly prisma: PrismaService, private readonly config: AppConfigService) {}

  async creditState(companyId: string, now = new Date()) {
    return this.prisma.client.$transaction(tx => readCompanyAiCreditState(tx, this.config, companyId, now),
      { isolationLevel: 'RepeatableRead' });
  }

  private sign(unsigned: Omit<AiBudgetGrantV2, 'signature'>): string {
    if (!this.config.aiGatewayInternalSecret) throw new Error('AI_BUDGET_ISSUER_UNAVAILABLE');
    return createHmac('sha256', this.config.aiGatewayInternalSecret).update('line-ai-budget-grant-v2\0').update(canonical(unsigned)).digest('hex');
  }
  private authentic(grant: AiBudgetGrantV2): boolean {
    const { signature, ...unsigned } = grant;
    try { return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(this.sign(unsigned), 'hex')); } catch { return false; }
  }
  private parent(tx: any, kind: AiBudgetGrantV2['authorityKind']) {
    if (kind === 'webhook_event' || kind === 'webhook_classify') return tx.lineWebhookEventLog;
    if (kind === 'ledger_entry') return tx.lineLedgerDelivery;
    if (kind === 'qa_job') return tx.lineDocumentQaJob;
    throw new Error('AI_BUDGET_AUTHORITY_UNSUPPORTED');
  }
  private columns(kind: AiBudgetGrantV2['authorityKind']) {
    return kind === 'webhook_classify'
      ? { json: 'classifyAuthorityJson', revision: 'classifyAuthorityRevision' }
      : { json: 'budgetAuthorityJson', revision: 'budgetAuthorityRevision' };
  }
  private async ownerCurrent(tx: any, owner: AuthorityOwner): Promise<boolean> {
    const scope = owner.owner;
    const sharedEmployeeChannel = owner.kind === 'PRIVATE' && scope.messagingChannelId === this.config.lineMessagingChannelId;
    const channel = sharedEmployeeChannel || await tx.lineChannelBinding.findFirst({ where: { companyId: scope.companyId, messagingChannelId: scope.messagingChannelId,
      status: 'ACTIVE', company: { status: 'ACTIVE' } }, select: { id: true } });
    if (!channel) return false;
    // Group/general admission never reads a private conversation or membership.
    if (owner.kind === 'PUBLIC_GENERAL') return true;
    const privateScope = owner.owner;
    const member = await tx.companyMembership.findFirst({ where: { id: privateScope.membershipId, companyId: privateScope.companyId, userId: privateScope.userId,
      status: 'ACTIVE', user: { status: 'ACTIVE', aiAssistantOptOutAt: null }, company: { status: 'ACTIVE' } }, select: { id: true } });
    if (!member) return false;
    const context = await tx.aiConversation.findFirst({ where: { id: lineConversationId(privateScope), ...privateScope, lifecycleEpoch: owner.epoch },
      select: { id: true, taskStateJson: true } });
    if (!context) return false;
    if (owner.taskRevision !== undefined) {
      const tasks = (context.taskStateJson as { tasks?: Array<{ taskId?: string; revision?: number }> } | null)?.tasks ?? [];
      if (!owner.taskId || !tasks.some((task) => task.taskId === owner.taskId && task.revision === owner.taskRevision)) return false;
    }
    return true;
  }
  private parentCurrent(row: any, kind: AiBudgetGrantV2['authorityKind'], owner: AuthorityOwner, now: Date): boolean {
    if (!row || row.companyId !== owner.owner.companyId) return false;
    if (kind === 'webhook_classify' && owner.kind !== 'PRIVATE') return false;
    if (kind === 'qa_job') return owner.kind === 'PRIVATE'
      && row.userId === owner.owner.userId
      && row.ownerMembershipId === owner.owner.membershipId
      && row.ownerEpoch === owner.epoch
      && row.channelKind === owner.owner.channelKind
      && row.messagingChannelId === owner.owner.messagingChannelId
      && row.chatKeyHash === owner.owner.chatKeyHash
      && row.jobDeadlineAt > now
      && ['QUEUED', 'READING'].includes(row.status);
    if (kind === 'ledger_entry') return owner.kind === 'PRIVATE' && row.userId === owner.owner.userId
      && row.expiresAt > now && row.status === 'PREPARING';
    // processedAt is the existing webhook claim timestamp, not a completion marker.
    return ['received', 'processing'].includes(row.status);
  }
  async issue(input: IssueLineAiBudgetGrant, now = new Date()): Promise<AiBudgetGrantV2 | null> {
    // QA must transfer the original turn counter; fresh issuance would buy two extra calls.
    if (input.authorityKind === 'qa_job') return null;
    const classify = input.authorityKind === 'webhook_classify';
    if (classify ? input.owner.kind !== 'PRIVATE' || input.lane !== 'classify' || input.requestKind !== 'TEXT'
      || input.allowedProfileIds.length !== 1 || input.allowedProfileIds[0] !== 'line-classify/2'
      || input.admitOverCap || input.serverRoute !== undefined
      : input.lane === 'classify' || input.allowedProfileIds.includes('line-classify/2')) return null;
    if (!validAiTariffV2(input.tariff) || !sameModel(input.model, input.tariff)
      || !['TEXT', 'IMAGE', 'OTHER'].includes(input.requestKind)
      || !this.config.approvedAiModelIds.includes(input.model.modelId)
      || !Number.isSafeInteger(input.admittedAtMs) || input.admittedAtMs < 0 || input.admittedAtMs > now.getTime()
      || !Number.isSafeInteger(input.modelContextTokens) || input.modelContextTokens <= 0
      || !Number.isSafeInteger(input.modelMaxOutputTokens) || input.modelMaxOutputTokens < 1
      || !Number.isSafeInteger(input.coalescingExtraMs) || input.coalescingExtraMs < 0 || input.coalescingExtraMs > 6000
      || !/^[0-9a-f]{64}$/.test(input.inputDigest) || !baseCeilings[input.lane]) return null;
    if (input.authorityKind === 'webhook_event' && input.owner.kind === 'PRIVATE'
      && input.allowedProfileIds.some(id => id !== 'line-intake-text/2' && id !== 'line-intake-image/2')) return null;
    if (input.owner.kind === 'PUBLIC_GENERAL'
      && input.allowedProfileIds.some(id => id !== 'line-answer/2' && id !== 'public-lookup/2')) return null;
    const ceiling = input.requestKind === 'IMAGE' && input.allowedProfileIds.includes('line-intake-image/2')
      ? Math.max(baseCeilings[input.lane], aiGatewayClientTimeoutMs(2)) : baseCeilings[input.lane];
    const finalDeadlineAtMs = input.admittedAtMs + ceiling + input.coalescingExtraMs;
    const unsigned: Omit<AiBudgetGrantV2, 'signature'> = {
      version: 2, turnKey: input.turnKey, authorityKind: input.authorityKind, authorityId: input.authorityId,
      channelOwnerDigest: digest(input.owner), attemptKey: input.attemptKey,
      monthKey: new Date(input.admittedAtMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7),
      payerCompanyId: input.owner.owner.companyId, model: { ...input.model },
      allowedProfileIds: [...input.allowedProfileIds], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
      maxTurnSlots: classify || input.owner.kind === 'PUBLIC_GENERAL' && input.lane === 'general' ? 2 : 4, maxRepairs: 1, admittedAtMs: input.admittedAtMs, workDeadlineAtMs: finalDeadlineAtMs - 3000,
      finalDeadlineAtMs, nonce: randomUUID(), nextOrdinal: 0, issuerVersion: 'line-budget-issuer:2',
      ...(input.owner.kind === 'PRIVATE' ? { membershipEpoch: input.owner.epoch, taskRevision: input.owner.taskRevision } : {}),
    };
    // Omit absent fields before canonical signing; JSON transport never preserves undefined.
    if (unsigned.taskRevision === undefined) delete unsigned.taskRevision;
    if (!classify && unsigned.workDeadlineAtMs <= now.getTime()) return null;
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-budget-authority:${input.authorityKind}:${input.authorityId}`}))`;
      const delegate = this.parent(tx, input.authorityKind);
      const row = await delegate.findUnique({ where: { id: input.authorityId } });
      const columns = this.columns(input.authorityKind);
      const currentParent = classify && row?.[columns.json]
        ? row.companyId === input.owner.owner.companyId
        : this.parentCurrent(row, input.authorityKind, input.owner, now);
      if (!currentParent || !await this.ownerCurrent(tx, input.owner)) return null;
      if (classify) unsigned.attemptKey = deliveryHash(['line-classify-v2', row.webhookEventId]);
      const grant = parseAiBudgetGrantV2({ ...unsigned, signature: this.sign(unsigned) });
      if (!grant) return null;
      if (row[columns.json]) {
        const existing = row[columns.json] as BudgetAuthority;
        // Replays return the original deadline, tariff and count; no grant refresh.
        return existing.version === 2 && !existing.transferredToQa && existing.inputDigest === input.inputDigest && existing.grant.turnKey === input.turnKey
          && existing.grant.channelOwnerDigest === digest(input.owner) && this.authentic(existing.grant) ? existing.grant : null;
      }
      if (grant.workDeadlineAtMs <= now.getTime()) return null;
      const authority: BudgetAuthority = { version: 2, grant, owner: input.owner, tariff: structuredClone(input.tariff),
        requestKind: input.requestKind, inputDigest: input.inputDigest, modelContextTokens: input.modelContextTokens, modelMaxOutputTokens: input.modelMaxOutputTokens,
        coalescingExtraMs: input.coalescingExtraMs, nextOrdinal: 0, profileCounts: {}, repairCount: 0,
        ...(input.admitOverCap ? { admitOverCap: true as const } : {}),
        ...(input.serverRoute === 'fixed_read' ? { serverRoute: input.serverRoute } : {}) };
      if (Buffer.byteLength(JSON.stringify(authority)) > MAX_AUTHORITY_BYTES) return null;
      const updated = await delegate.updateMany({ where: { id: row.id, [columns.revision]: row[columns.revision], [columns.json]: { equals: Prisma.DbNull } },
        data: { [columns.json]: authority as unknown as Prisma.InputJsonValue, [columns.revision]: { increment: 1 } } });
      return updated.count === 1 ? grant : null;
    });
  }

  /** Authenticates the original immutable input at the API transport seam. Reserve rechecks the
   * authority under lock immediately before spending, so this read grants no mutation authority. */
  async validate(grant: AiBudgetGrantV2, inputDigest: string, scope: { companyId: string; userId?: string; membershipId?: string;
    publicAdmission?: { channelKind: 'USER' | 'GROUP' | 'ROOM'; channelKeyHash: string; admissionId: string } }): Promise<boolean> {
    if (!this.authentic(grant) || grant.workDeadlineAtMs <= Date.now() || scope.companyId !== grant.payerCompanyId) return false;
    const row = await this.parent(this.prisma.client, grant.authorityKind).findUnique({ where: { id: grant.authorityId } });
    const state = row?.[this.columns(grant.authorityKind).json] as BudgetAuthority | undefined;
    if (!state || state.version !== 2 || state.transferredToQa || state.inputDigest !== inputDigest || state.grant.signature !== grant.signature
      || !this.parentCurrent(row, grant.authorityKind, state.owner, new Date())) return false;
    if (state.owner.kind === 'PRIVATE' && (scope.userId !== state.owner.owner.userId
      || scope.membershipId !== undefined && scope.membershipId !== state.owner.owner.membershipId)) return false;
    if (state.owner.kind === 'PUBLIC_GENERAL') {
      if (!scope.publicAdmission || scope.userId || scope.membershipId
        || scope.publicAdmission.admissionId !== grant.authorityId
        || scope.publicAdmission.channelKind !== state.owner.owner.channelKind
        || scope.publicAdmission.channelKeyHash !== state.owner.owner.chatKeyHash) return false;
    } else if (scope.publicAdmission) return false;
    return this.ownerCurrent(this.prisma.client, state.owner);
  }

  /** Read-only identity resolution for permission-checked API tools; never trust Gateway owner JSON. */
  async resolvePrivateOwner(grant: AiBudgetGrantV2, inputDigest: string,
    scope: { companyId: string; userId: string; membershipId?: string }): Promise<Extract<AuthorityOwner, { kind: 'PRIVATE' }> | null> {
    if (!await this.validate(grant, inputDigest, scope)) return null;
    const row = await this.parent(this.prisma.client, grant.authorityKind).findUnique({ where: { id: grant.authorityId } });
    const state = row?.[this.columns(grant.authorityKind).json] as BudgetAuthority | undefined;
    return state?.owner.kind === 'PRIVATE' && !state.transferredToQa && state.grant.signature === grant.signature
      ? structuredClone(state.owner) : null;
  }

  /** A cached decision survives webhook completion and the spend deadline. No decision after a
   * dispatch means Tier 2, never another classifier call. Owner revocation still fences replay. */
  async readClassifyState(grant: AiBudgetGrantV2, inputDigest: string,
    scope: { companyId: string; userId: string; membershipId?: string }): Promise<{
      decision: LineWorkflowClassifyResponse | null; used: boolean;
    } | null> {
    if (grant.authorityKind !== 'webhook_classify' || !this.authentic(grant)) return null;
    const row = await this.parent(this.prisma.client, grant.authorityKind).findUnique({ where: { id: grant.authorityId } });
    const state = row?.classifyAuthorityJson as BudgetAuthority | undefined;
    if (!state || state.version !== 2 || state.grant.signature !== grant.signature || state.inputDigest !== inputDigest
      || row.companyId !== scope.companyId || grant.payerCompanyId !== scope.companyId || state.owner.kind !== 'PRIVATE'
      || state.owner.owner.userId !== scope.userId
      || scope.membershipId !== undefined && state.owner.owner.membershipId !== scope.membershipId
      || !await this.ownerCurrent(this.prisma.client, state.owner)) return null;
    return { decision: state.decision ? structuredClone(state.decision) : null, used: state.nextOrdinal > 0 };
  }

  /** First decision wins under the same authority lock as issuance. Storing a result cannot
   * refresh a grant or its dispatch counter, including after a timed-out provider call. */
  async storeClassifyDecision(grant: AiBudgetGrantV2, inputDigest: string,
    decision: LineWorkflowClassifyResponse, now = new Date()): Promise<LineWorkflowClassifyResponse | null> {
    if (grant.authorityKind !== 'webhook_classify' || !this.authentic(grant)) return null;
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-budget-authority:${grant.authorityKind}:${grant.authorityId}`}))`;
      const parent = this.parent(tx, grant.authorityKind);
      const row = await parent.findUnique({ where: { id: grant.authorityId } });
      const state = row?.classifyAuthorityJson as BudgetAuthority | undefined;
      if (!state || state.version !== 2 || state.grant.signature !== grant.signature || state.inputDigest !== inputDigest
        || row.companyId !== grant.payerCompanyId || state.owner.kind !== 'PRIVATE'
        || !await this.ownerCurrent(tx, state.owner)) return null;
      if (state.decision) return structuredClone(state.decision);
      if (!this.parentCurrent(row, grant.authorityKind, state.owner, now)
        || decision.status === 'CLASSIFIED' && state.profileCounts['line-classify/2'] !== 1) return null;
      const next = { ...state, decision: structuredClone(decision) };
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_AUTHORITY_BYTES) return null;
      const changed = await parent.updateMany({ where: { id: row.id, classifyAuthorityRevision: row.classifyAuthorityRevision },
        data: { classifyAuthorityJson: next as unknown as Prisma.InputJsonValue, classifyAuthorityRevision: { increment: 1 } } });
      return changed.count === 1 ? structuredClone(decision) : null;
    });
  }

  /** Admission-only replay identity; a sealed grant remains unspendable by reserve/tools. */
  async resolveDocumentQaAdmissionOwner(grant: AiBudgetGrantV2, inputDigest: string): Promise<Extract<AuthorityOwner, { kind: 'PRIVATE' }> | null> {
    if (grant.authorityKind !== 'webhook_event' || !this.authentic(grant)) return null;
    const row = await this.parent(this.prisma.client, grant.authorityKind).findUnique({ where: { id: grant.authorityId } });
    const state = row?.budgetAuthorityJson as BudgetAuthority | undefined;
    if (!state || state.owner.kind !== 'PRIVATE' || state.inputDigest !== inputDigest || state.grant.signature !== grant.signature
      || !await this.ownerCurrent(this.prisma.client, state.owner)) return null;
    if (state.transferredToQa) {
      const job = await this.parent(this.prisma.client, 'qa_job').findUnique({ where: { id: state.transferredToQa } });
      if (!job || job.turnId !== grant.turnKey || job.jobDeadlineAt <= new Date()) return null;
    } else if (grant.workDeadlineAtMs <= Date.now() || !this.parentCurrent(row, grant.authorityKind, state.owner, new Date())) return null;
    return structuredClone(state.owner);
  }

  /** One atomic handoff, retaining the original intake cost/cursor/model/tariff and admission time.
   * CAS of the old parent fences a concurrent reserve; failure rolls back BOTH parents. */
  async transferToDocumentQa(grant: AiBudgetGrantV2, jobId: string, inputDigest: string, now = new Date()): Promise<AiBudgetGrantV2 | null> {
    if (grant.authorityKind !== 'webhook_event' || !this.authentic(grant) || !/^[0-9a-f]{64}$/.test(inputDigest)) return null;
    try {
      return await this.prisma.client.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-budget-authority:${grant.authorityKind}:${grant.authorityId}`}))`;
        const parent = this.parent(tx, grant.authorityKind);
        const row = await parent.findUnique({ where: { id: grant.authorityId } });
        const state = row?.budgetAuthorityJson as BudgetAuthority | undefined;
        const job = await this.parent(tx, 'qa_job').findUnique({ where: { id: jobId } });
        if (!state || state.version !== 2 || state.owner.kind !== 'PRIVATE' || state.grant.signature !== grant.signature
          || !this.parentCurrent(job, 'qa_job', state.owner, now) || !await this.ownerCurrent(tx, state.owner)
          || job.turnId !== grant.turnKey || job.inputDigest !== inputDigest || documentQaAuthorityInputDigest(job) !== inputDigest) return null;
        if (state.transferredToQa) {
          const saved = job.budgetAuthorityJson as BudgetAuthority | undefined;
          return state.transferredToQa === jobId && saved?.inputDigest === inputDigest && this.authentic(saved.grant)
            && saved.grant.attemptKey === grant.attemptKey ? saved.grant : null;
        }
        if (job.budgetAuthorityJson || grant.workDeadlineAtMs <= now.getTime()
          || !this.parentCurrent(row, grant.authorityKind, state.owner, now)
          || state.nextOrdinal > 1 || state.repairCount > 0
          || (state.profileCounts['line-intake-text/2'] ?? 0) + (state.profileCounts['line-intake-image/2'] ?? 0) !== state.nextOrdinal) return null;
        const running = await tx.aiBudgetReservation.count({ where: { companyId: grant.payerCompanyId, attemptKey: grant.attemptKey,
          stepKind: 'provider-v2', status: { in: ['RESERVED', 'DISPATCHED', 'UNRESOLVED'] } } });
        if (running) return null;
        const finalDeadlineAtMs = grant.admittedAtMs + baseCeilings.document_qa;
        if (job.jobDeadlineAt.getTime() !== finalDeadlineAtMs || job.foregroundDeadlineAt.getTime() !== grant.admittedAtMs + 40_000) return null;
        const { signature: _, ...unsigned } = grant;
        const nextUnsigned = { ...unsigned, authorityKind: 'qa_job' as const, authorityId: jobId,
          allowedProfileIds: ['document-qa/2' as const], maxTurnSlots: 2 as const, nextOrdinal: state.nextOrdinal,
          finalDeadlineAtMs, workDeadlineAtMs: finalDeadlineAtMs - 3000 };
        const nextGrant = parseAiBudgetGrantV2({ ...nextUnsigned, signature: this.sign(nextUnsigned) });
        if (!nextGrant || nextGrant.workDeadlineAtMs <= now.getTime()) return null;
        const sealed = { ...state, transferredToQa: jobId };
        if ((await parent.updateMany({ where: { id: row.id, budgetAuthorityRevision: row.budgetAuthorityRevision },
          data: { budgetAuthorityJson: sealed as unknown as Prisma.InputJsonValue, budgetAuthorityRevision: { increment: 1 } } })).count !== 1) throw new Error('QA_TRANSFER_RACED');
        // A queued document question was accepted with its turn, so its later calls pass the cap (Owner 2026-09-30).
        const moved: BudgetAuthority = { ...state, grant: nextGrant, inputDigest, narrowedLane: 'document_qa', admitOverCap: true };
        if ((await this.parent(tx, 'qa_job').updateMany({ where: { id: jobId, budgetAuthorityRevision: job.budgetAuthorityRevision,
          budgetAuthorityJson: { equals: Prisma.DbNull } },
          data: { budgetAuthorityJson: moved as unknown as Prisma.InputJsonValue, budgetAuthorityRevision: { increment: 1 } } })).count !== 1) throw new Error('QA_TRANSFER_RACED');
        return nextGrant;
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'QA_TRANSFER_RACED') return null;
      throw error;
    }
  }

  /** Called only by the admitted API producer after validating classification. Once narrowed,
   * retries return the same authority; they never refresh deadlines, counts or paid invocations. */
  async narrow(grant: AiBudgetGrantV2, lane: 'general' | 'simple' | 'mixed' | 'public', allowedProfileIds: AiBudgetProfileIdV2[], now = new Date()): Promise<AiBudgetGrantV2 | null> {
    if (grant.authorityKind === 'webhook_classify' || !this.authentic(grant) || !baseCeilings[lane] || !allowedProfileIds.length
      || allowedProfileIds.some(id => !['line-control/2', 'line-answer/2', 'public-lookup/2'].includes(id))) return null;
    return this.prisma.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`line-budget-authority:${grant.authorityKind}:${grant.authorityId}`}))`;
      const delegate = this.parent(tx, grant.authorityKind);
      const row = await delegate.findUnique({ where: { id: grant.authorityId } });
      const state = row?.budgetAuthorityJson as BudgetAuthority | undefined;
      if (!state || state.transferredToQa || !this.authentic(state.grant)
        || !this.parentCurrent(row, grant.authorityKind, state.owner, now) || !await this.ownerCurrent(tx, state.owner)) return null;
      if (state.narrowedLane) {
        if (state.grant.nonce !== grant.nonce || state.narrowedLane !== lane
          || canonical(state.grant.allowedProfileIds) !== canonical(allowedProfileIds)) return null;
        if (state.grant.workDeadlineAtMs <= now.getTime()) throw new LineAiBudgetDeadlineExceededError();
        return state.grant;
      }
      if (state.owner.kind === 'PUBLIC_GENERAL' && allowedProfileIds.includes('line-control/2')) return null;
      const fixedRead = state.serverRoute === 'fixed_read' && lane === 'simple'
        && allowedProfileIds.length === 1 && allowedProfileIds[0] === 'line-answer/2';
      if (state.grant.signature !== grant.signature || state.nextOrdinal < (fixedRead ? 0 : 1) || state.nextOrdinal > 2) return null;
      if (state.grant.workDeadlineAtMs <= now.getTime()) throw new LineAiBudgetDeadlineExceededError();
      const maxTurnSlots = lane === 'general' || lane === 'simple' ? 2 : 4;
      const { signature: _, ...unsigned } = state.grant;
      const nextUnsigned = { ...unsigned, nextOrdinal: state.nextOrdinal, allowedProfileIds: [...allowedProfileIds], maxTurnSlots: maxTurnSlots as 2 | 4 };
      const nextGrant = parseAiBudgetGrantV2({ ...nextUnsigned, signature: this.sign(nextUnsigned) });
      if (!nextGrant) return null;
      const next = { ...state, grant: nextGrant, narrowedLane: lane };
      const changed = await delegate.updateMany({ where: { id: row.id, budgetAuthorityRevision: row.budgetAuthorityRevision },
        data: { budgetAuthorityJson: next as unknown as Prisma.InputJsonValue, budgetAuthorityRevision: { increment: 1 } } });
      return changed.count === 1 ? nextGrant : null;
    });
  }

  async reserve(invocation: AiBudgetInvocationV2, repair = false, now = new Date()): Promise<
    { ok: true; envelope: AiBudgetEnvelopeV2 } | Exclude<AiBudgetReserveOutcome, { ok: true }>
  > {
    const startedWallMs = Date.now();
    const refused = () => ({ ok: false as const, reason: 'unavailable' as const, budgetScope: 'TOTAL' as const, detail: 'authority_invalid' });
    const grant = parseAiBudgetGrantV2(invocation?.grant);
    if (!grant || !this.authentic(grant) || grant.workDeadlineAtMs <= now.getTime() || typeof repair !== 'boolean') return refused();
    const candidate = parseAiBudgetEnvelopeV2({ ...invocation, grant, version: 2,
      reservationId: 'pre-reserve', invocationKey: `${grant.payerCompanyId}#${grant.attemptKey}#provider-v2#${invocation.ordinal}`, tariffVersion: 'pre-reserve' });
    if (!candidate || invocation.estimatorVersion !== AI_BUDGET_ESTIMATOR_VERSION_V2) return refused();
    const delegate = this.parent(this.prisma.client, grant.authorityKind);
    const row = await delegate.findUnique({ where: { id: grant.authorityId } });
    const columns = this.columns(grant.authorityKind);
    const initial = row?.[columns.json] as BudgetAuthority | undefined;
    if (!initial || initial.version !== 2 || initial.decision || initial.transferredToQa || initial.grant.signature !== grant.signature || !sameModel(grant.model, initial.tariff)) return refused();
    const profile = AI_BUDGET_PROFILES_V2[invocation.profileId];
    const priced = priceRenderedAiInvocationV2(initial.tariff, invocation.inputTokenBound, invocation.requestedOutputTokens,
      'hostedToolUnits' in profile ? profile.hostedToolUnits : 0);
    if (!priced || invocation.requestedOutputTokens > initial.modelMaxOutputTokens || invocation.inputTokenBound + invocation.requestedOutputTokens > initial.modelContextTokens || initial.inputDigest !== invocation.inputDigest) return refused();
    const result = await reserveAiBudgetStep(this.prisma, this.config, {
      companyId: grant.payerCompanyId, monthKey: grant.monthKey, bucket: 'CHAT', stepKind: 'provider-v2', attemptKey: grant.attemptKey,
      ordinal: invocation.ordinal, sourceRoute: 'line-ai-v2', requestKind: initial.requestKind, modelId: grant.model.modelId,
      thbPerUsd: initial.tariff.thbPerUsd, thbPerUsdSource: 'pinned-grant', now,
      ...(initial.admitOverCap ? { admitOverCap: true } : {}),
    }, {
      upperBoundSatang: priced.upperBoundSatang, maxCalls: aiBudgetV2OrdinalCeiling(grant),
      // Plan C4: an image intake keeps its CHAT cost bucket but never spends AI credit (spec §5.4;
      // audit N-1 still waits for the LINE AI owner to confirm the v2 bucket).
      fundsAiCredit: invocation.profileId !== 'line-intake-image/2',
      fundingAsOf: new Date(grant.admittedAtMs), pinnedCycleKey: initial.fundingContext?.cycleKey,
      snapshot: { ...priced.snapshot, profileId: invocation.profileId, inputDigest: invocation.inputDigest, payloadDigest: invocation.payloadDigest,
        schemaDigest: invocation.schemaDigest, estimatorVersion: invocation.estimatorVersion, promptVersion: invocation.promptVersion,
        profileTableDigest: grant.profileTableDigest, grantSignature: grant.signature, repair },
      authorizeAndClaim: async (tx, funding) => {
        const parent = this.parent(tx, grant.authorityKind);
        const current = await parent.findUnique({ where: { id: grant.authorityId } });
        const authority = current?.[columns.json] as BudgetAuthority | undefined;
        if (grant.workDeadlineAtMs <= now.getTime() + Date.now() - startedWallMs) return false;
        if (!authority || authority.decision || authority.transferredToQa || !this.parentCurrent(current, grant.authorityKind, authority.owner, now)
          || authority.grant.signature !== grant.signature || digest(authority.tariff) !== digest(initial.tariff)
          || authority.nextOrdinal !== invocation.ordinal || (authority.profileCounts[invocation.profileId] ?? 0) >= profile.maxCalls
          // A repair never spends an answer slot, and an answer never spends the repair (UAT 2026-09-29).
          || !aiBudgetV2CallAllowed(grant, invocation.ordinal, repair, authority.repairCount) || !await this.ownerCurrent(tx, authority.owner)) return false;
        // An unresolved prior paid call may still be executing; a new worker cannot overlap it.
        const running = await tx.aiBudgetReservation.count({ where: { companyId: grant.payerCompanyId, attemptKey: grant.attemptKey,
          stepKind: 'provider-v2', status: { in: ['RESERVED', 'DISPATCHED', 'UNRESOLVED'] } } });
        if (running) return false;
        // A turn funds every call from ONE cycle: a different one means the pin raced (A36).
        if (funding && authority.fundingContext && authority.fundingContext.cycleKey !== funding.cycleKey) return false;
        const next: BudgetAuthority = { ...authority, nextOrdinal: authority.nextOrdinal + 1,
          repairCount: authority.repairCount + Number(repair), profileCounts: { ...authority.profileCounts, [invocation.profileId]: (authority.profileCounts[invocation.profileId] ?? 0) + 1 },
          ...(funding && !authority.fundingContext ? { fundingContext: { cycleKey: funding.cycleKey } } : {}) };
        return (await parent.updateMany({ where: { id: grant.authorityId, [columns.revision]: current[columns.revision] },
          data: { [columns.json]: next as unknown as Prisma.InputJsonValue, [columns.revision]: { increment: 1 } } })).count === 1;
      },
    });
    if (!result.ok) return result;
    return { ok: true, envelope: { ...candidate, reservationId: result.reservation.id,
      invocationKey: result.reservation.invocationKey, tariffVersion: initial.tariff.version } };
  }
}
