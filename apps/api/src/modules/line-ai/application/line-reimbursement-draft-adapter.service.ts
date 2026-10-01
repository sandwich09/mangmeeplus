import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  REIMBURSEMENT_MANUAL_CATEGORIES,
  extractValueCandidatesV2, lineAiRetainedTaskSourceMatchesProjection, parseLineAiTaskProjection, verifyLineAiRetainedTaskSource,
  type LineAiSourceRefV2,
  parseLineReimbursementDraftProposalV1,
  parseLineReimbursementSourceProofV1,
  type LineAiInputEvidenceV2,
  type LineAiValueCandidatesV2,
  type LineReimbursementDraftProposalV1,
  type LineReimbursementFieldProofV1,
  type LineReimbursementValidatedFieldReceiptV1,
  type ReimbursementLineInput,
  type RequestContext,
  type ToolResult,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../common/database/prisma.service';
import type { ReimbursementDraftActionRecord, ReimbursementLineRecord, ReimbursementRequestRecord } from '../../reimbursements/domain/models/reimbursement.model';
import { PrismaReimbursementRepository } from '../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { pickLineDefaultBranchId } from '../../expenses/domain/logic/line-receipt-branch.logic';
import {
  LineReimbursementDraftUseCase,
  type LineReimbursementActionKey,
  type LineReimbursementDraftResult,
} from '../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { lineConversationId, type LineConversationOwner } from './line-conversation-context.service';
import { deliveryHash } from '../domain/logic/line-delivery-plan.logic';
import { formatClaimMoney } from '../domain/logic/line-reimbursement-draft-card.logic';
import type { ErpToolContext } from '../domain/ports/erp-read-tool.port';
import { LineAiBudgetAuthorityService } from './line-ai-budget-authority.service';
import { LineReimbursementDraftService } from './line-reimbursement-draft.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPTION_TTL_MS = 10 * 60_000;
const PAGE_SIZE = 20;
const OPTION_FAMILIES = ['branch', 'requester', 'category', 'source', 'attachment', 'target', 'line'] as const;
type OptionFamily = typeof OPTION_FAMILIES[number];
type OptionKind = 'BRANCH' | 'REQUESTER' | 'CATEGORY' | 'SOURCE' | 'ATTACHMENT' | 'TARGET' | 'LINE';
type Choice = {
  choiceId: string;
  kind: OptionKind;
  label: string;
  revision: string;
  details?: Record<string, string | number | boolean | null>;
  raw: Record<string, unknown>;
};
type StoredOptions = {
  schemaVersion: 1;
  actionId: string;
  taskId: string;
  taskRevision: number;
  operation: 'CREATE' | 'UPDATE';
  revision: string;
  issuedAt: string;
  expiresAt: string;
  selected: { branchChoiceId?: string; requesterChoiceId?: string; targetRef?: string };
  choices: Choice[];
  pages: Partial<Record<OptionFamily, { returned: number; hasMore: boolean; continuation?: string }>>;
};
type Accepted = {
  schemaVersion: 1;
  options: StoredOptions;
  proposal?: LineReimbursementDraftProposalV1;
  receipts?: LineReimbursementValidatedFieldReceiptV1[];
  admission?: { requestId: string; subrequestIndex: number; taskId?: string; taskSubrequestIndex?: number };
};
type Authority = {
  ctx: RequestContext;
  owner: Awaited<ReturnType<LineAiBudgetAuthorityService['resolvePrivateOwner']>> & object;
  evidence: LineAiInputEvidenceV2;
  candidates: LineAiValueCandidatesV2;
  acceptedRequest: Record<string, unknown>;
  writeIndexes: number[];
  allowedSourceRefs?: LineAiSourceRefV2[];
  retainedTaskRef?: { taskId: string; subrequestIndex: number };
  /** The draft action the conversation task this clause continues (its router taskRef) already holds. */
  continuedActionId?: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function stableUuid(value: unknown): string {
  const bytes = Buffer.from(digest(value).slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function iso(value: string | Date): string { return (value instanceof Date ? value : new Date(value)).toISOString(); }
function validChoiceId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }

@Injectable()
export class LineReimbursementDraftAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PrismaReimbursementRepository,
    private readonly authorityService: LineAiBudgetAuthorityService,
    private readonly draftService: LineReimbursementDraftService,
    private readonly drafts: LineReimbursementDraftUseCase,
  ) {}

  /** Read-only delivery view; only options still authorized for the same current owner can be printed. */
  async readDisplayOptions(input: { ctx: RequestContext; owner: LineConversationOwner; ownerEpoch: number; actionId: string }) {
    const active = await this.drafts.active(input.ctx, this.actionOwner(input.owner, input.ownerEpoch));
    if (!active || active.id !== input.actionId || active.status !== 'COLLECTING') return null;
    const options = this.accepted(active)?.options;
    if (!options || options.actionId !== active.id || options.taskId !== active.taskId || Date.parse(options.expiresAt) <= Date.now()) return null;
    // NAT04 (2026-09-30): a bill that cannot be claimed is never offered, so it is neither re-checked nor printed.
    // Re-checking it always failed (it is not eligible), which hid every claimable bill along with it.
    const shown: StoredOptions = { ...options, choices: options.choices.filter(choice => choice.kind !== 'SOURCE' || choice.details?.['eligible'] !== false) };
    try {
      for (const choice of shown.choices) await this.currentChoice(input.ctx, choice, options);
      return this.publicOptions(shown);
    } catch { return null; }
  }

  async getOptions(ctx: ErpToolContext, raw: unknown): Promise<ToolResult> {
    const input = this.parseOptionsInput(raw);
    const authority = await this.authority(ctx);
    if (!input || !authority) return this.denied('reimbursement.draft.get_options', 'INVALID_REIMBURSEMENT_AUTHORITY');
    if (authority.writeIndexes.length !== 1) return this.denied('reimbursement.draft.get_options', 'FINANCIAL_ACTION_SELECTION_REQUIRED');
    if (!authority.writeIndexes.includes(input.subrequestIndex)) return this.denied('reimbursement.draft.get_options', 'WRITE_TASK_NOT_ADMITTED');

    const owner = authority.owner.owner;
    const actionOwner = this.actionOwner(owner, authority.owner.epoch);
    let active = await this.drafts.active(authority.ctx, actionOwner);
    let key: LineReimbursementActionKey;
    if (active) {
      if (authority.retainedTaskRef && active.taskId !== stableUuid(['reimbursement-draft-task', owner, authority.retainedTaskRef]))
        return this.denied('reimbursement.draft.get_options', 'FINANCIAL_ACTION_SELECTION_REQUIRED');
      const prior = this.accepted(active)?.admission;
      const sameTask = authority.retainedTaskRef && prior?.taskId === authority.retainedTaskRef.taskId
        && prior.taskSubrequestIndex === authority.retainedTaskRef.subrequestIndex;
      if (prior && !sameTask && active.id !== authority.continuedActionId && (prior.requestId !== authority.acceptedRequest['requestId'] || prior.subrequestIndex !== input.subrequestIndex)
        && (input.actionId !== active.id || input.taskId !== active.taskId)) return this.denied('reimbursement.draft.get_options', 'FINANCIAL_ACTION_SELECTION_REQUIRED');
      key = { actionId: active.id, taskId: active.taskId, actionOrdinal: active.actionOrdinal, operation: active.operation };
      if ((input.actionId && input.actionId !== key.actionId) || (input.taskId && input.taskId !== key.taskId)) {
        return this.domainResult('reimbursement.draft.get_options', key, { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['activeAction'] });
      }
      if (active.status === 'PREVIEW') {
        const result = await this.draftService.get({ ctx: authority.ctx, owner, ownerEpoch: authority.owner.epoch, actionId: active.id });
        return this.domainResult('reimbursement.draft.get_options', key, result);
      }
    } else {
      const taskId = stableUuid(['reimbursement-draft-task', owner, authority.retainedTaskRef
        ?? [authority.acceptedRequest['requestId'], authority.evidence.turnKey, ctx.budgetGrantV2!.attemptKey, input.subrequestIndex]]);
      key = { taskId, actionId: stableUuid(['reimbursement-draft-action', taskId, input.operation, input.subrequestIndex + 1]),
        actionOrdinal: input.subrequestIndex + 1, operation: input.operation };
      if ((input.actionId && input.actionId !== key.actionId) || (input.taskId && input.taskId !== key.taskId)) {
        return this.denied('reimbursement.draft.get_options', 'UNKNOWN_REIMBURSEMENT_ACTION');
      }
    }

    if (key.operation !== input.operation) return this.domainResult('reimbursement.draft.get_options', key,
      { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['operation'] });
    const previous = active ? this.accepted(active)?.options : undefined;
    const decodedPage = input.continuation ? this.decodeContinuation(input.continuation, key.actionId, previous?.revision) : undefined;
    if (input.continuation && !decodedPage) return this.domainResult('reimbursement.draft.get_options', key,
      { status: 'blocked', errorCode: 'source_changed', fieldPaths: ['continuation'] });
    try {
      const options = await this.buildOptions(authority.ctx, key, authority.owner.taskRevision ?? 0,
        input, previous, decodedPage ?? undefined, { owner: authority.owner.owner, epoch: authority.owner.epoch });
      const prior = active ? this.accepted(active) : undefined;
      const accepted: Accepted = { schemaVersion: 1, options, admission: { requestId: String(authority.acceptedRequest['requestId']),
        subrequestIndex: input.subrequestIndex, ...(authority.retainedTaskRef ? { taskId: authority.retainedTaskRef.taskId, taskSubrequestIndex: authority.retainedTaskRef.subrequestIndex } : {}) },
        ...(prior?.proposal ? { proposal: prior.proposal } : {}), ...(prior?.receipts ? { receipts: prior.receipts } : {}) };
      const saved = await this.drafts.saveTrustedOptions({ ctx: authority.ctx, owner: actionOwner, key, accepted,
        fieldPaths: prior?.proposal ? this.missingFields(prior.proposal) : [] });
      if (!('id' in saved)) return this.domainResult('reimbursement.draft.get_options', key, saved);
      if (saved.status === 'PREVIEW' || saved.status === 'APPLIED') {
        const result = await this.draftService.get({ ctx: authority.ctx, owner, ownerEpoch: authority.owner.epoch, actionId: saved.id });
        return this.domainResult('reimbursement.draft.get_options', key, result);
      }
      active = saved;
      return this.ok('reimbursement.draft.get_options', key, {
        reimbursementDraft: { status: 'needs_fields', actionId: key.actionId,
          fieldPaths: (active.commandJson as { fieldPaths?: string[] } | null)?.fieldPaths ?? [], actionRevision: active.previewRevision },
        actionLocator: this.locator(key), options: this.publicOptions(options),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_REIMBURSEMENT_OPTIONS';
      const result: LineReimbursementDraftResult = code === 'REIMBURSEMENT_CHOICE_STALE'
        ? { status: 'stale', actionId: key.actionId, errorCode: 'source_changed' }
        : { status: 'blocked', errorCode: code === 'REIMBURSEMENT_OPTIONS_OVERFLOW' ? 'evidence_overflow' : 'invalid_field' };
      return this.domainResult('reimbursement.draft.get_options', key, result);
    }
  }

  async preview(ctx: ErpToolContext, raw: unknown, operation: 'CREATE' | 'UPDATE'): Promise<ToolResult> {
    const toolName = operation === 'CREATE' ? 'reimbursement.draft.preview_create' : 'reimbursement.draft.preview_update';
    const authority = await this.authority(ctx);
    const wrapper = this.parsePreviewInput(raw);
    if (!authority || !wrapper || wrapper.action.operation && wrapper.action.operation !== operation) {
      return this.denied(toolName, 'INVALID_REIMBURSEMENT_AUTHORITY');
    }
    const owner = authority.owner.owner, ownerEpoch = authority.owner.epoch;
    const active = await this.drafts.active(authority.ctx, this.actionOwner(owner, ownerEpoch));
    if (!active || active.id !== wrapper.action.actionId || active.taskId !== wrapper.action.taskId || active.operation !== operation) {
      return this.denied(toolName, 'UNKNOWN_REIMBURSEMENT_ACTION');
    }
    const key: LineReimbursementActionKey = { actionId: active.id, taskId: active.taskId,
      actionOrdinal: active.actionOrdinal, operation: active.operation };
    const accepted = this.accepted(active), options = accepted?.options;
    if (!accepted || !options || options.actionId !== active.id || options.taskId !== active.taskId
      || new Date(options.expiresAt) <= new Date()) {
      return this.domainResult(toolName, key, { status: 'stale', actionId: active.id, errorCode: 'source_changed' });
    }
    if (authority.candidates.completeness !== 'complete') {
      return this.domainResult(toolName, key, { status: 'blocked', errorCode: 'evidence_overflow' });
    }
    if (operation === 'UPDATE' && (!object(wrapper.proposal) || typeof wrapper.proposal['targetRef'] !== 'string')) {
      return this.domainResult(toolName, key, { status: 'needs_target', actionId: active.id, actionRevision: active.previewRevision });
    }
    const candidateValues: Record<string, string> = {}, candidateSources: Record<string, any> = {};
    for (const item of authority.candidates.amounts) { candidateValues[item.candidateId] = item.value; candidateSources[item.candidateId] = item.source; }
    for (const item of authority.candidates.dates) { candidateValues[item.candidateId] = item.isoDate; candidateSources[item.candidateId] = item.source; }
    const parsed = parseLineReimbursementDraftProposalV1(wrapper.proposal,
      { evidence: authority.evidence, candidateValues, candidateSources });
    if (!parsed || parsed.taskId !== active.taskId || parsed.taskRevision !== options.taskRevision || parsed.operation !== operation) {
      return this.domainResult(toolName, key, { status: 'blocked', errorCode: 'invalid_provenance' });
    }
    try {
      const proposal = parseLineReimbursementDraftProposalV1(this.mergeProposal(accepted.proposal, parsed),
        { evidence: authority.evidence, candidateValues, candidateSources });
      if (!proposal || proposal.taskId !== active.taskId || proposal.taskRevision !== options.taskRevision
        || proposal.operation !== operation) throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      if (authority.allowedSourceRefs && this.proposalReceipts(proposal).some(receipt => receipt.proof.kind === 'USER_TEXT'
        && receipt.proof.refs.some(ref => !authority.allowedSourceRefs!.some(allowed => allowed.partId === ref.partId
          && allowed.rawSha256 === ref.rawSha256 && allowed.startUtf16 <= ref.startUtf16 && allowed.endUtf16 >= ref.endUtf16)))) {
        throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      }
      await this.validateProposalProofs(authority.ctx, options, proposal);
      // Rebuild from the merged proposal so UPDATE continuations keyed by stable lineRef cannot
      // overwrite a prior line's index-based receipt when the new fragment starts at index zero.
      const receipts = this.proposalReceipts(proposal);
      let result: LineReimbursementDraftResult;
      if (operation === 'CREATE') {
        const hydrated = await this.hydrateCreate(authority.ctx, options, proposal, receipts);
        const sourceProof = parseLineReimbursementSourceProofV1({ schemaVersion: 1, receipts: hydrated.receipts });
        if (!sourceProof) return this.domainResult(toolName, key, { status: 'blocked', errorCode: 'invalid_provenance' });
        result = hydrated.missing.length
          ? await this.draftService.propose({ ctx: authority.ctx, owner, ownerEpoch, proposal: { key, status: 'needs_fields',
              accepted: { schemaVersion: 1, options, proposal, receipts: hydrated.receipts, ...(accepted.admission ? { admission: accepted.admission } : {}) }, sourceProof,
              fieldPaths: hydrated.missing } })
          : await this.draftService.propose({ ctx: authority.ctx, owner, ownerEpoch,
              proposal: { key, status: 'ready', operation: 'CREATE', request: hydrated.request!, sourceProof } });
      } else {
        const hydrated = await this.hydrateUpdate(authority.ctx, options, proposal, receipts);
        const sourceProof = parseLineReimbursementSourceProofV1({ schemaVersion: 1, receipts: hydrated.receipts });
        if (!sourceProof) return this.domainResult(toolName, key, { status: 'blocked', errorCode: 'invalid_provenance' });
        result = hydrated.missing.length
          ? await this.draftService.propose({ ctx: authority.ctx, owner, ownerEpoch, proposal: { key, status: 'needs_fields',
              accepted: { schemaVersion: 1, options, proposal, receipts: hydrated.receipts, ...(accepted.admission ? { admission: accepted.admission } : {}) }, sourceProof,
              fieldPaths: hydrated.missing, ...(hydrated.requestId ? { requestId: hydrated.requestId } : {}),
              ...(hydrated.expectedRequestUpdatedAt ? { expectedRequestUpdatedAt: hydrated.expectedRequestUpdatedAt } : {}) } })
          : await this.draftService.propose({ ctx: authority.ctx, owner, ownerEpoch,
              proposal: { key, status: 'ready', operation: 'UPDATE', requestId: hydrated.requestId!,
                expectedRequestUpdatedAt: hydrated.expectedRequestUpdatedAt!, request: hydrated.request!,
                sourceProof, targetRef: proposal.targetRef } });
      }
      return this.domainResult(toolName, key, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const result: LineReimbursementDraftResult = /STALE|CHANGED/u.test(message)
        ? { status: 'stale', actionId: active.id, errorCode: 'source_changed' }
        : { status: 'blocked', errorCode: /PROVENANCE/u.test(message) ? 'invalid_provenance'
            : /SOURCE|LINKED/u.test(message) ? 'invalid_source' : 'invalid_field' };
      return this.domainResult(toolName, key, result);
    }
  }

  private async authority(ctx: ErpToolContext): Promise<Authority | null> {
    const evidence = ctx.inputEvidence, candidates = ctx.valueCandidatesV2, grant = ctx.budgetGrantV2;
    if (!evidence || !candidates || !grant || candidates.inputDigest !== evidence.joinedSha256 || !ctx.membershipId) return null;
    const owner = await this.authorityService.resolvePrivateOwner(grant, evidence.joinedSha256,
      { companyId: ctx.companyId, userId: ctx.userId, membershipId: ctx.membershipId });
    if (!owner) return null;
    const accepted = await this.acceptedLedgerRequest(grant.authorityKind, grant.authorityId, ctx.companyId, ctx.userId);
    const request = object(accepted?.['request']) ? accepted!['request'] as Record<string, unknown> : null;
    if (!request
      || !isDeepStrictEqual(request['inputEvidence'], evidence)
      || !object(request['budgetGrantV2']) || request['budgetGrantV2']['signature'] !== grant.signature
      || !object(request['userContext']) || request['userContext']['companyId'] !== ctx.companyId
      || request['userContext']['internalUserId'] !== ctx.userId || request['userContext']['membershipId'] !== ctx.membershipId) return null;
    const semantic = request['semanticSubrequests'];
    if (!Array.isArray(semantic)) return null;
    const writeIndexes = semantic.filter((item) => object(item) && item['kind'] === 'write' && Number.isSafeInteger(item['index'])
      && (item['writeIntent'] === 'REIMBURSEMENT_REQUEST_START' || request['intakeIntent'] === 'REIMBURSEMENT_REQUEST_START' && item['writeIntent'] === undefined))
      .map((item) => Number((item as Record<string, unknown>)['index']));
    if (!writeIndexes.length) return null;
    let sourceEvidence = evidence, sourceCandidates = candidates;
    let allowedSourceRefs: LineAiSourceRefV2[] | undefined;
    let retainedTaskRef: Authority['retainedTaskRef'];
    if (request['retainedTaskSource'] !== undefined) {
      const retained = await verifyLineAiRetainedTaskSource(request['retainedTaskSource']);
      const conversation = await this.prisma.client.aiConversation.findUnique({ where: { id: lineConversationId(owner.owner) } });
      const state = object(conversation?.taskStateJson) ? conversation!.taskStateJson as Record<string, unknown> : undefined;
      const projection = state && parseLineAiTaskProjection({ version: 2, lifecycleEpoch: conversation!.lifecycleEpoch,
        stateVersion: conversation!.stateVersion, expiresAtMs: conversation!.stateExpiresAt?.getTime(), tasks: state['tasks'] });
      if (!retained || !projection || projection.expiresAtMs <= Date.now() || conversation!.lifecycleEpoch !== owner.epoch
        || !lineAiRetainedTaskSourceMatchesProjection(retained, projection, 'turn')) return null;
      const task = projection.tasks.find(item => item.taskId === retained.taskRef.taskId)!;
      const locator = task.sourceRevisionLocators?.find(item => item.sourceType === `LINE_ACCEPTED_TASK_${retained.taskRef.subrequestIndex}_${retained.semanticSubrequest.index}`);
      const row = locator && await this.prisma.client.lineLedgerDelivery.findFirst({ where: { id: locator.sourceId, companyId: ctx.companyId, userId: ctx.userId } });
      const original = object(row?.acceptedRequestJson) ? row!.acceptedRequestJson as Record<string, unknown> : null;
      const originalRequest = object(original?.['request']) ? original!['request'] : null;
      if (!row || row.expiresAt.getTime() <= Date.now() || !original || !originalRequest || original['version'] !== 2
        || original['ownerEpoch'] !== owner.epoch || original['conversationId'] !== conversation!.id
        || original['channelId'] !== owner.owner.messagingChannelId || original['chatKeyHash'] !== owner.owner.chatKeyHash
        || original['digest'] !== locator!.revision || deliveryHash(Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'digest'))) !== original['digest']
        || !isDeepStrictEqual(originalRequest['inputEvidence'], retained.inputEvidence)
        || !Array.isArray(originalRequest['semanticSubrequests']) || !originalRequest['semanticSubrequests'].some(item => isDeepStrictEqual(item, retained.semanticSubrequest))) return null;
      allowedSourceRefs = retained.semanticSubrequest.evidenceRefs!;
      const today = new Date(Math.min(...allowedSourceRefs.map(ref => retained.inputEvidence.parts.find(part => part.partId === ref.partId)!.acceptedAtMs))).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      const historical = await extractValueCandidatesV2(retained.inputEvidence, today);
      if (!historical) return null;
      const contained = (ref: LineAiSourceRefV2) => allowedSourceRefs!.some(allowed => allowed.partId === ref.partId && allowed.rawSha256 === ref.rawSha256
        && allowed.startUtf16 <= ref.startUtf16 && allowed.endUtf16 >= ref.endUtf16);
      sourceEvidence = retained.inputEvidence;
      sourceCandidates = { ...historical, amounts: historical.amounts.filter(item => contained(item.source)),
        dates: historical.dates.filter(item => contained(item.source)), periods: historical.periods.filter(item => contained(item.source)) };
      retainedTaskRef = { taskId: retained.taskRef.taskId, subrequestIndex: retained.taskRef.subrequestIndex };
    }
    // NAT04 (2026-09-29): "ทำร่างจากใบที่สอง" continues the claim the previous turn left collecting. The router's
    // taskRef names that conversation task, and the task remembers its draft action; nothing else links them.
    let continuedActionId: string | undefined;
    const continued = semantic.find(item => object(item) && writeIndexes.includes(Number(item['index'])) && object(item['taskRef'])) as Record<string, unknown> | undefined;
    if (continued && !retainedTaskRef) {
      const ref = continued['taskRef'] as Record<string, unknown>;
      const conversation = await this.prisma.client.aiConversation.findUnique({ where: { id: lineConversationId(owner.owner) } });
      const tasks = conversation?.lifecycleEpoch === owner.epoch && object(conversation.taskStateJson) && Array.isArray(conversation.taskStateJson['tasks'])
        ? conversation.taskStateJson['tasks'] as Array<Record<string, unknown>> : [];
      // The revision already moved when this turn resumed the task; the router's ref was checked there.
      const task = tasks.find(item => item['taskId'] === ref['taskId']);
      const slot = object(task?.['slots']) ? task!['slots'][`reimbursementActionId${String(ref['subrequestIndex'])}`] : undefined;
      if (typeof slot === 'string' && UUID.test(slot)) continuedActionId = slot;
    }
    return { evidence: sourceEvidence, candidates: sourceCandidates, owner, acceptedRequest: request, writeIndexes, allowedSourceRefs, retainedTaskRef, continuedActionId,
      ctx: { requestId: ctx.requestId ?? grant.turnKey, authSubject: ctx.userId, userId: ctx.userId,
        companyId: ctx.companyId, membershipId: ctx.membershipId, roles: ctx.roles ?? [], permissions: ctx.permissions,
        scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds }, authProvider: 'line' } };
  }

  private async acceptedLedgerRequest(kind: string, authorityId: string, companyId: string, userId: string) {
    if (kind === 'ledger_entry') {
      return (await this.prisma.client.lineLedgerDelivery.findFirst({ where: { id: authorityId, companyId, userId },
        select: { acceptedRequestJson: true } }))?.acceptedRequestJson as Record<string, unknown> | null;
    }
    if (kind !== 'webhook_event') return null;
    const event = await this.prisma.client.lineWebhookEventLog.findUnique({ where: { id: authorityId }, select: { webhookEventId: true } });
    if (!event) return null;
    return (await this.prisma.client.lineLedgerDelivery.findFirst({ where: { companyId, userId, webhookEventId: event.webhookEventId },
      orderBy: { createdAt: 'desc' }, select: { acceptedRequestJson: true } }))?.acceptedRequestJson as Record<string, unknown> | null;
  }

  private parseOptionsInput(value: unknown) {
    if (!object(value) || Object.keys(value).some((key) => !['operation', 'subrequestIndex', 'taskId', 'actionId', 'branchChoiceId', 'requesterChoiceId', 'targetRef', 'query', 'continuation'].includes(key))
      || !['CREATE', 'UPDATE'].includes(String(value['operation'])) || !Number.isSafeInteger(value['subrequestIndex'])
      || Number(value['subrequestIndex']) < 0 || Number(value['subrequestIndex']) > 7) return null;
    for (const key of ['taskId', 'actionId'] as const) if (value[key] !== undefined && (typeof value[key] !== 'string' || !UUID.test(value[key]))) return null;
    for (const key of ['branchChoiceId', 'requesterChoiceId', 'targetRef'] as const) if (value[key] !== undefined && !validChoiceId(value[key])) return null;
    if (value['continuation'] !== undefined && (typeof value['continuation'] !== 'string' || value['continuation'].length > 500)) return null;
    let query: { family: OptionFamily; text: string } | undefined;
    if (value['query'] !== undefined) {
      if (!object(value['query']) || Object.keys(value['query']).some((key) => !['family', 'text'].includes(key))
        || !OPTION_FAMILIES.includes(value['query']['family'] as OptionFamily) || typeof value['query']['text'] !== 'string'
        || value['query']['text'].length > 100) return null;
      query = { family: value['query']['family'] as OptionFamily, text: value['query']['text'].trim() };
    }
    return { operation: value['operation'] as 'CREATE' | 'UPDATE', subrequestIndex: Number(value['subrequestIndex']),
      ...(typeof value['taskId'] === 'string' ? { taskId: value['taskId'] } : {}),
      ...(typeof value['actionId'] === 'string' ? { actionId: value['actionId'] } : {}),
      ...(typeof value['branchChoiceId'] === 'string' ? { branchChoiceId: value['branchChoiceId'] } : {}),
      ...(typeof value['requesterChoiceId'] === 'string' ? { requesterChoiceId: value['requesterChoiceId'] } : {}),
      ...(typeof value['targetRef'] === 'string' ? { targetRef: value['targetRef'] } : {}),
      ...(query ? { query } : {}), ...(typeof value['continuation'] === 'string' ? { continuation: value['continuation'] } : {}) };
  }

  private parsePreviewInput(value: unknown): { action: { taskId: string; actionId: string; operation?: 'CREATE' | 'UPDATE' }; proposal: unknown } | null {
    if (!object(value) || Object.keys(value).some((key) => !['action', 'proposal'].includes(key)) || !object(value['action'])
      || Object.keys(value['action']).some(key => !['taskId', 'actionId', 'operation'].includes(key))
      || !UUID.test(String(value['action']['taskId'])) || !UUID.test(String(value['action']['actionId']))
      || value['action']['operation'] !== undefined && !['CREATE', 'UPDATE'].includes(String(value['action']['operation']))
      || !object(value['proposal'])) return null;
    return { action: { taskId: String(value['action']['taskId']), actionId: String(value['action']['actionId']),
      ...(value['action']['operation'] ? { operation: value['action']['operation'] as 'CREATE' | 'UPDATE' } : {}) }, proposal: value['proposal'] };
  }

  private actionOwner(owner: any, epoch: number) {
    return { companyId: owner.companyId, actorUserId: owner.userId, membershipId: owner.membershipId,
      channel: 'line' as const, channelKind: 'USER' as const, messagingChannelId: owner.messagingChannelId,
      chatKeyHash: owner.chatKeyHash, ownerEpoch: epoch };
  }

  private accepted(action: ReimbursementDraftActionRecord): Accepted | undefined {
    const command = action.commandJson;
    if (!object(command) || command['schemaVersion'] !== 1 || command['kind'] !== 'COLLECTION' || !object(command['accepted'])) return undefined;
    const accepted = command['accepted'];
    if (accepted['schemaVersion'] !== 1 || !object(accepted['options'])) return undefined;
    return accepted as Accepted;
  }

  private async buildOptions(ctx: RequestContext, key: LineReimbursementActionKey, taskRevision: number,
    input: NonNullable<ReturnType<typeof this.parseOptionsInput>>,
    previous: StoredOptions | undefined, page?: { family: OptionFamily; offset: number }, stagingOwner?: { owner: LineConversationOwner; epoch: number }): Promise<StoredOptions> {
    const now = new Date(), query = input.query?.text ?? '', family = page?.family ?? input.query?.family;
    const offset = (name: OptionFamily) => family === name ? page?.offset ?? 0 : 0;
    const previousChoices = previous && new Date(previous.expiresAt) > now ? previous.choices : [];
    const previousChoice = (id: string | undefined, kind: OptionKind) => id ? previousChoices.find(item => item.choiceId === id && item.kind === kind) : undefined;
    if ((input.branchChoiceId && !previousChoice(input.branchChoiceId, 'BRANCH'))
      || (input.requesterChoiceId && !previousChoice(input.requesterChoiceId, 'REQUESTER'))
      || (input.targetRef && !previousChoice(input.targetRef, 'TARGET'))) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    const choices: Choice[] = [], pages: StoredOptions['pages'] = {};
    const addPage = (name: OptionFamily, items: Choice[], hasMore: boolean) => {
      choices.push(...items.slice(0, PAGE_SIZE));
      pages[name] = { returned: Math.min(items.length, PAGE_SIZE), hasMore };
    };
    const branchWhere = { companyId: ctx.companyId, status: 'ACTIVE' as const,
      ...(ctx.scopes.branchIds ? { id: { in: ctx.scopes.branchIds } } : {}),
      ...(family === 'branch' && query ? { OR: [{ name: { contains: query, mode: 'insensitive' as const } }, { code: { contains: query, mode: 'insensitive' as const } }] } : {}) };
    const branches = await this.prisma.client.branch.findMany({ where: branchWhere, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: offset('branch'), take: PAGE_SIZE + 1, select: { id: true, name: true, code: true, type: true, updatedAt: true } });
    const branchChoices = branches.slice(0, PAGE_SIZE).map(row => this.choice(key.actionId, 'BRANCH', `${row.name} (${row.code})`, row.updatedAt.toISOString(), { id: row.id }));
    addPage('branch', branchChoices, branches.length > PAGE_SIZE);
    // NAT04 (2026-09-29): a multi-branch member was asked for a branch before a single bill could be listed. The
    // same member-branch rule LINE capture uses (default branch, sole branch, sole head office) picks it; the
    // branch list stays offered, so naming another branch still switches.
    const memberBranchId = offset('branch') === 0 && !input.branchChoiceId && !previous?.selected.branchChoiceId && ctx.membershipId
      ? pickLineDefaultBranchId(branches, (await this.prisma.client.companyMembership.findUnique({ where: { id: ctx.membershipId }, select: { defaultBranchId: true } }))?.defaultBranchId)
      : undefined;
    let selectedBranch = previousChoice(input.branchChoiceId, 'BRANCH')
      ?? (previous?.selected.branchChoiceId ? previousChoice(previous.selected.branchChoiceId, 'BRANCH') : undefined)
      ?? (branches.length === 1 && offset('branch') === 0 ? branchChoices[0] : undefined)
      ?? branchChoices.find(item => item.raw['id'] === memberBranchId);
    if (selectedBranch) selectedBranch = await this.currentChoice(ctx, selectedBranch, previous);

    let selectedRequester: Choice | undefined;
    if (selectedBranch) {
      const requesters = await this.repo.listReimbursementRequesters(ctx.companyId, String(selectedBranch.raw['id']),
        ctx.permissions.includes('reimbursement.finance_review') ? undefined : ctx.userId);
      const filtered = family === 'requester' && query
        ? requesters.filter((row: { userId: string; displayName: string }) => row.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        : requesters;
      const slice = filtered.slice(offset('requester'), offset('requester') + PAGE_SIZE + 1);
      const requesterChoices = slice.slice(0, PAGE_SIZE).map((row: { userId: string; displayName: string }) => this.choice(key.actionId, 'REQUESTER', row.displayName,
        digest([row.userId, row.displayName, selectedBranch!.raw['id']]), { id: row.userId, branchId: selectedBranch!.raw['id'] }));
      addPage('requester', requesterChoices, slice.length > PAGE_SIZE);
      const priorRequester = previousChoice(input.requesterChoiceId, 'REQUESTER')
        ?? (previous?.selected.requesterChoiceId ? previousChoice(previous.selected.requesterChoiceId, 'REQUESTER') : undefined);
      if (priorRequester && priorRequester.raw['branchId'] !== selectedBranch.raw['id']) {
        if (input.requesterChoiceId) throw new Error('REIMBURSEMENT_CHOICE_STALE');
      } else selectedRequester = priorRequester;
      selectedRequester ??= requesterChoices.find((item: Choice) => item.raw['id'] === ctx.userId);
      if (selectedRequester) selectedRequester = await this.currentChoice(ctx, selectedRequester, previous);
    }

    const categories = REIMBURSEMENT_MANUAL_CATEGORIES.map(item => this.choice(key.actionId, 'CATEGORY', item.label,
      digest(item), { key: item.key, label: item.label }));
    addPage('category', categories, false);

    if (selectedBranch && selectedRequester) {
      const sourceRows = await this.repo.listReimbursementSources(ctx.companyId, String(selectedBranch.raw['id']),
        String(selectedRequester.raw['id']), family === 'source' ? query : '', undefined,
        { skip: offset('source'), take: PAGE_SIZE + 1 });
      const sourceChoices = sourceRows.slice(0, PAGE_SIZE).map(row => this.choice(key.actionId, 'SOURCE', row.label, row.updatedAt,
        { expenseId: row.expenseId, branchId: selectedBranch!.raw['id'], requesterUserId: selectedRequester!.raw['id'] },
        { incurredDate: row.incurredDate, description: row.description, purpose: row.purpose,
          categoryKey: row.categoryKey, categoryLabel: row.categoryLabel ?? null, amount: row.amount, currency: row.currency, eligible: row.eligible }));
      addPage('source', sourceChoices, sourceRows.length > PAGE_SIZE);
      // Fresh LINE media has no financial branch until this same owner's explicit/sole branch choice.
      // Only untouched staging objects with the exact original binding can acquire that scope.
      // Hotfix 2026-10-01: the default-branch pick above stamps the photo before the user names a branch, so a
      // still-unused photo follows the current choice. One already on it is not rewritten (its offered choice stays
      // current); one saved on a claim line (no relation, so a lookup) never moves. ponytail: that lookup is not
      // locked with the write; only a claim saved elsewhere with this photo in the same instant could slip past.
      if (stagingOwner && selectedRequester.raw['id'] === ctx.userId) {
        const branchId = String(selectedBranch.raw['id']);
        const staged = { companyId: ctx.companyId, uploadedByUserId: ctx.userId, status: 'ACTIVE' as const,
          OR: [{ branchId: null }, { branchId: { not: branchId } }],
          AND: [{ metadataJson: { path: ['lineReimbursementOwner'], equals: stagingOwner.owner } },
            { metadataJson: { path: ['lineReimbursementEpoch'], equals: stagingOwner.epoch } }],
          links: { none: {} }, captureFiles: { none: {} } };
        const ids = (await this.prisma.client.attachmentObject.findMany({ where: staged, select: { id: true } })).map(row => row.id);
        const used = ids.length ? (await this.prisma.client.reimbursementLine.findMany({ where: { companyId: ctx.companyId, attachmentId: { in: ids } },
          select: { attachmentId: true } })).map(line => line.attachmentId) : [];
        const free = ids.filter(id => !used.includes(id));
        if (free.length) await this.prisma.client.attachmentObject.updateMany({ where: { ...staged, id: { in: free } }, data: { branchId } });
      }
      const attachmentRows = await this.prisma.client.attachmentObject.findMany({ where: { companyId: ctx.companyId,
        branchId: String(selectedBranch.raw['id']), status: 'ACTIVE', OR: [
          { uploadedByUserId: String(selectedRequester.raw['id']) },
          ...(ctx.permissions.includes('reimbursement.finance_review') ? [{ uploadedByUserId: ctx.userId }] : []),
        ], ...(family === 'attachment' && query ? { originalFileName: { contains: query, mode: 'insensitive' as const } } : {}) },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }], skip: offset('attachment'), take: PAGE_SIZE + 1,
        select: { id: true, originalFileName: true, mimeType: true, checksumSha256: true, uploadedByUserId: true, branchId: true, updatedAt: true } });
      const attachmentChoices = attachmentRows.slice(0, PAGE_SIZE).map(row => this.choice(key.actionId, 'ATTACHMENT', row.originalFileName,
        row.updatedAt.toISOString(), { id: row.id, branchId: row.branchId, uploadedByUserId: row.uploadedByUserId,
          checksumSha256: row.checksumSha256, mimeType: row.mimeType, originalFileName: row.originalFileName }));
      addPage('attachment', attachmentChoices, attachmentRows.length > PAGE_SIZE);
    }

    let selectedTarget = previousChoice(input.targetRef, 'TARGET')
      ?? (previous?.selected.targetRef ? previousChoice(previous.selected.targetRef, 'TARGET') : undefined);
    if (key.operation === 'UPDATE') {
      const rows = await this.repo.listRequests({ companyId: ctx.companyId, status: 'DRAFT', scopes: ctx.scopes,
        ...(ctx.permissions.includes('reimbursement.finance_review') ? {} : { requesterUserId: ctx.userId }),
        ...(family === 'target' && query ? { search: query } : {}), skip: offset('target'), take: PAGE_SIZE + 1 });
      const targets = rows.slice(0, PAGE_SIZE).map(row => this.choice(key.actionId, 'TARGET',
        [row.requestNo, row.title, row.reason].filter(Boolean).join(' · ').slice(0, 180), row.updatedAt.toISOString(),
        { id: row.id }, { amount: row.amount, currency: row.currency, status: row.status, lines: row.lineCount ?? row.lines?.length ?? 0 }));
      addPage('target', targets, rows.length > PAGE_SIZE);
      if (selectedTarget) selectedTarget = await this.currentChoice(ctx, selectedTarget, previous);
      if (selectedTarget) {
        const request = await this.repo.findRequestById(ctx.companyId, String(selectedTarget.raw['id']), true);
        if (!request || request.status !== 'DRAFT' || request.updatedAt.toISOString() !== selectedTarget.revision) throw new Error('REIMBURSEMENT_CHOICE_STALE');
        const rows = (request.lines ?? []).slice(offset('line'), offset('line') + PAGE_SIZE + 1);
        const lineChoices = rows.slice(0, PAGE_SIZE).map(line => this.choice(key.actionId, 'LINE',
          `${line.lineNo}. ${line.description} · ${formatClaimMoney(line.amount, request.currency)}`, line.updatedAt.toISOString(),
          { id: line.id, requestId: request.id, requestUpdatedAt: request.updatedAt.toISOString(), lineNo: line.lineNo },
          { lineNo: line.lineNo, incurredDate: line.incurredDate.toISOString().slice(0, 10), description: line.description,
            categoryKey: line.categoryKey, amount: line.amount, linked: !!line.linkedExpenseId }));
        addPage('line', lineChoices, rows.length > PAGE_SIZE);
      }
    }

    // A selected parent can live on an earlier page. Keep it in the signed choice universe while
    // preserving the hard 20-per-family bound; otherwise a continuation token could make the
    // already-selected branch/requester/target impossible to echo on the next call.
    for (const pinned of [selectedBranch, selectedRequester, selectedTarget]) {
      if (!pinned || choices.some(item => item.choiceId === pinned.choiceId)) continue;
      const sameKind = choices.flatMap((item, index) => item.kind === pinned.kind ? [index] : []);
      if (sameKind.length >= PAGE_SIZE) choices.splice(sameKind.at(-1)!, 1);
      choices.push(pinned);
    }

    const issuedAt = now.toISOString(), expiresAt = new Date(now.getTime() + OPTION_TTL_MS).toISOString();
    const revision = digest([key, issuedAt, choices.map(({ choiceId, revision }) => [choiceId, revision])]);
    for (const name of Object.keys(pages) as OptionFamily[]) if (pages[name]?.hasMore) {
      pages[name]!.continuation = this.encodeContinuation(key.actionId, revision, name, offset(name) + PAGE_SIZE);
    }
    return { schemaVersion: 1, actionId: key.actionId, taskId: key.taskId, taskRevision, operation: key.operation,
      revision, issuedAt, expiresAt, selected: {
        ...(selectedBranch ? { branchChoiceId: selectedBranch.choiceId } : {}),
        ...(selectedRequester ? { requesterChoiceId: selectedRequester.choiceId } : {}),
        ...(selectedTarget ? { targetRef: selectedTarget.choiceId } : {}),
      }, choices, pages };
  }

  private choice(actionId: string, kind: OptionKind, label: string, revision: string, raw: Record<string, unknown>,
    details?: Record<string, string | number | boolean | null>): Choice {
    return { choiceId: digest(['reimbursement-choice-v1', actionId, kind, raw, revision]), kind, label, revision,
      ...(details ? { details } : {}), raw };
  }

  private publicOptions(options: StoredOptions) {
    return { schemaVersion: 1, taskRevision: options.taskRevision, expiresAt: options.expiresAt,
      revision: options.revision, selected: options.selected,
      choices: options.choices.map(({ raw: _raw, ...choice }) => choice), pages: options.pages };
  }

  private encodeContinuation(actionId: string, revision: string, family: OptionFamily, offset: number): string {
    const payload = { v: 1, actionId, revision, family, offset };
    return Buffer.from(JSON.stringify({ ...payload, checksum: digest(payload) })).toString('base64url');
  }
  private decodeContinuation(value: string, actionId: string, revision?: string): { family: OptionFamily; offset: number } | null {
    try {
      const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
      const payload = { v: raw['v'], actionId: raw['actionId'], revision: raw['revision'], family: raw['family'], offset: raw['offset'] };
      return raw['v'] === 1 && raw['actionId'] === actionId && raw['revision'] === revision
        && OPTION_FAMILIES.includes(raw['family'] as OptionFamily) && Number.isSafeInteger(raw['offset'])
        && Number(raw['offset']) >= 0 && raw['checksum'] === digest(payload)
        ? { family: raw['family'] as OptionFamily, offset: Number(raw['offset']) } : null;
    } catch { return null; }
  }

  private async currentChoice(ctx: RequestContext, choice: Choice, options?: StoredOptions): Promise<Choice> {
    if (choice.kind === 'BRANCH') {
      const row = await this.prisma.client.branch.findFirst({ where: { id: { equals: String(choice.raw['id']), ...(ctx.scopes.branchIds ? { in: ctx.scopes.branchIds } : {}) }, companyId: ctx.companyId, status: 'ACTIVE' }, select: { updatedAt: true } });
      if (!row || row.updatedAt.toISOString() !== choice.revision) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'REQUESTER') {
      const branch = String(choice.raw['branchId']), rows = await this.repo.listReimbursementRequesters(ctx.companyId, branch,
        ctx.permissions.includes('reimbursement.finance_review') ? undefined : ctx.userId);
      if (!rows.some((row: { userId: string; displayName: string }) => row.userId === choice.raw['id']
        && digest([row.userId, row.displayName, branch]) === choice.revision)) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'CATEGORY') {
      if (!REIMBURSEMENT_MANUAL_CATEGORIES.some(item => item.key === choice.raw['key'] && digest(item) === choice.revision)) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'SOURCE') {
      const rows = await this.repo.listReimbursementSources(ctx.companyId, String(choice.raw['branchId']), String(choice.raw['requesterUserId']), '', String(choice.raw['expenseId']));
      if (rows.length !== 1 || !rows[0]!.eligible || rows[0]!.updatedAt !== choice.revision) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'TARGET') {
      const request = await this.repo.findRequestById(ctx.companyId, String(choice.raw['id']), true);
      if (!request || request.status !== 'DRAFT' || request.updatedAt.toISOString() !== choice.revision || !this.canUpdate(ctx, request)) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'LINE') {
      const request = await this.repo.findRequestById(ctx.companyId, String(choice.raw['requestId']), true);
      const line = request?.lines?.find(item => item.id === choice.raw['id']);
      if (!request || request.status !== 'DRAFT' || request.updatedAt.toISOString() !== choice.raw['requestUpdatedAt']
        || !line || line.updatedAt.toISOString() !== choice.revision || !this.canUpdate(ctx, request)) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    } else if (choice.kind === 'ATTACHMENT') {
      const file = await this.prisma.client.attachmentObject.findFirst({ where: { id: String(choice.raw['id']), companyId: ctx.companyId, status: 'ACTIVE' } });
      if (!file || file.updatedAt.toISOString() !== choice.revision || file.branchId !== choice.raw['branchId']
        || file.uploadedByUserId !== choice.raw['uploadedByUserId'] || file.checksumSha256 !== choice.raw['checksumSha256']) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    }
    return choice;
  }

  private canUpdate(ctx: RequestContext, request: ReimbursementRequestRecord): boolean {
    return (request.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.update_own_draft'))
      || ctx.permissions.includes('reimbursement.finance_review');
  }

  private findChoice(options: StoredOptions, id: unknown, kind: OptionKind): Choice {
    if (!validChoiceId(id)) throw new Error('INVALID_REIMBURSEMENT_CHOICE');
    const choice = options.choices.find(item => item.choiceId === id && item.kind === kind);
    if (!choice) throw new Error('INVALID_REIMBURSEMENT_CHOICE');
    return choice;
  }

  private async validateProposalProofs(ctx: RequestContext, options: StoredOptions, proposal: LineReimbursementDraftProposalV1) {
    const values: Array<{ value: unknown; proof: LineReimbursementFieldProofV1 }> = [];
    for (const item of Object.values(proposal.fields)) if (item) values.push(item);
    for (const change of proposal.lineChanges ?? []) {
      if (change.operation === 'REMOVE') values.push({ value: null, proof: change.proof });
      else for (const item of Object.values(change.values)) if (object(item) && 'proof' in item) values.push(item as any);
    }
    for (const item of values) {
      const proof = item.proof;
      if (proof.kind === 'USER_TEXT') continue; // shared parser checked exact ordered spans/candidates.
      if (proof.kind === 'SERVER_DEFAULT') throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      if (proof.kind === 'USER_CHOICE') {
        const choice = options.choices.find(candidate => candidate.choiceId === proof.choiceId && candidate.revision === proof.choiceRevision);
        if (!choice || !isDeepStrictEqual(await this.choiceValue(ctx, choice, proof.kind, ''), item.value)) throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      } else if (proof.kind === 'RECORD') {
        const choice = options.choices.find(candidate => candidate.choiceId === proof.recordRef && candidate.revision === proof.revision);
        if (!choice || !isDeepStrictEqual(await this.choiceValue(ctx, choice, proof.kind, proof.fieldPath), item.value)) throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      } else {
        const choice = options.choices.find(candidate => candidate.choiceId === proof.attachmentRef && candidate.revision === proof.revision && candidate.kind === 'ATTACHMENT');
        if (!choice || proof.extractionRef !== 'metadata' || proof.page !== 1
          || !isDeepStrictEqual(await this.choiceValue(ctx, choice, proof.kind, proof.fieldPath), item.value)) throw new Error('INVALID_REIMBURSEMENT_PROVENANCE');
      }
    }
  }

  private async choiceValue(ctx: RequestContext, choice: Choice, proofKind: string, path: string): Promise<unknown> {
    await this.currentChoice(ctx, choice);
    if (proofKind === 'USER_CHOICE') return choice.raw['value'] ?? choice.raw['key'] ?? choice.raw['id'];
    if (choice.kind === 'SOURCE') {
      const [row] = await this.repo.listReimbursementSources(ctx.companyId, String(choice.raw['branchId']), String(choice.raw['requesterUserId']), '', String(choice.raw['expenseId']));
      return ({ incurredDate: row?.incurredDate, description: row?.description, purpose: row?.purpose,
        categoryKey: row?.categoryKey, categoryLabel: row?.categoryLabel, amount: row?.amount } as Record<string, unknown>)[path];
    }
    if (choice.kind === 'LINE') {
      const request = await this.repo.findRequestById(ctx.companyId, String(choice.raw['requestId']), true);
      const line = request?.lines?.find(item => item.id === choice.raw['id']);
      return line ? ({ incurredDate: line.incurredDate.toISOString().slice(0, 10), description: line.description,
        purpose: line.purpose, categoryKey: line.categoryKey, categoryLabel: line.categoryLabelSnapshot, amount: line.amount } as Record<string, unknown>)[path] : undefined;
    }
    if (choice.kind === 'ATTACHMENT') return choice.raw[path];
    return choice.raw[path];
  }

  private proposalReceipts(proposal: LineReimbursementDraftProposalV1): LineReimbursementValidatedFieldReceiptV1[] {
    const now = new Date().toISOString(), receipts: LineReimbursementValidatedFieldReceiptV1[] = [];
    const add = (fieldPath: string, item: { value: unknown; proof: LineReimbursementFieldProofV1 }) => receipts.push({ fieldPath,
      valueDigest: digest(item.value), proof: item.proof, validatedAt: now });
    for (const [name, item] of Object.entries(proposal.fields)) if (item) add(`fields.${name}`, item);
    for (const [index, change] of (proposal.lineChanges ?? []).entries()) {
      if (change.operation === 'REMOVE') add(`lineChanges.${index}.remove`, { value: change.lineRef, proof: change.proof });
      else for (const [name, item] of Object.entries(change.values)) if (object(item) && 'proof' in item) add(`lineChanges.${index}.${name}`, item as any);
    }
    return receipts;
  }

  private mergeReceipts(existing: LineReimbursementValidatedFieldReceiptV1[], next: LineReimbursementValidatedFieldReceiptV1[]) {
    const map = new Map(existing.map(item => [item.fieldPath, item]));
    for (const item of next) map.set(item.fieldPath, item);
    return [...map.values()];
  }

  private mergeProposal(previous: LineReimbursementDraftProposalV1 | undefined, next: LineReimbursementDraftProposalV1): LineReimbursementDraftProposalV1 {
    if (!previous) return clone(next);
    const result = clone(previous);
    result.taskRevision = Math.max(result.taskRevision, next.taskRevision);
    result.fields = { ...result.fields, ...clone(next.fields) };
    if (next.targetRef !== undefined) result.targetRef = next.targetRef;
    if (next.branchChoiceId !== undefined) result.branchChoiceId = next.branchChoiceId;
    if (next.requesterChoiceId !== undefined) result.requesterChoiceId = next.requesterChoiceId;
    if (next.lineChanges !== undefined) {
      if (next.operation === 'CREATE') {
        const old = (result.lineChanges ?? []).filter(change => change.operation === 'ADD') as Extract<NonNullable<LineReimbursementDraftProposalV1['lineChanges']>[number], { operation: 'ADD' }>[];
        result.lineChanges = next.lineChanges.map((change, index) => change.operation === 'ADD'
          ? { operation: 'ADD', values: { ...(old[index]?.values ?? {}), ...clone(change.values) } } : clone(change));
      } else {
        const changes = [...(result.lineChanges ?? [])];
        for (const change of next.lineChanges) {
          if (change.operation === 'ADD') { changes.push(clone(change)); continue; }
          const index = changes.findIndex(item => item.operation !== 'ADD' && item.lineRef === change.lineRef);
          if (index < 0) changes.push(clone(change));
          else if (change.operation === 'SET' && changes[index]!.operation === 'SET') changes[index] = { ...change, values: { ...changes[index].values, ...clone(change.values) } };
          else changes[index] = clone(change);
        }
        result.lineChanges = changes;
      }
    }
    return result;
  }

  private async hydrateCreate(ctx: RequestContext, options: StoredOptions, proposal: LineReimbursementDraftProposalV1,
    receipts: LineReimbursementValidatedFieldReceiptV1[]) {
    const missing: string[] = [];
    const branchId = proposal.branchChoiceId ?? options.selected.branchChoiceId;
    const requesterId = proposal.requesterChoiceId ?? options.selected.requesterChoiceId;
    let branch: Choice | undefined, requester: Choice | undefined;
    if (branchId) branch = await this.currentChoice(ctx, this.findChoice(options, branchId, 'BRANCH'), options); else missing.push('branchChoiceId');
    if (requesterId) requester = await this.currentChoice(ctx, this.findChoice(options, requesterId, 'REQUESTER'), options); else missing.push('requesterChoiceId');
    if (branch && requester && requester.raw['branchId'] !== branch.raw['id']) throw new Error('REIMBURSEMENT_CHOICE_STALE');
    if (!proposal.fields.reason) missing.push('fields.reason');
    const changes = (proposal.lineChanges ?? []).filter(change => change.operation === 'ADD');
    if (!changes.length) missing.push('lineChanges');
    const lines: ReimbursementLineInput[] = [];
    for (const [index, change] of changes.entries()) {
      if (change.operation !== 'ADD') continue;
      const line = await this.hydrateLine(ctx, options, change.values, undefined, index, missing);
      if (line) lines.push({ ...line, lineNo: lines.length + 1 });
    }
    const now = new Date().toISOString();
    if (branch) receipts = this.mergeReceipts(receipts, [{ fieldPath: 'branchId', valueDigest: digest(branch.raw['id']),
      proof: { kind: 'USER_CHOICE', choiceId: branch.choiceId, choiceRevision: branch.revision }, validatedAt: now }]);
    if (requester) receipts = this.mergeReceipts(receipts, [{ fieldPath: 'requesterUserId', valueDigest: digest(requester.raw['id']),
      proof: requester.raw['id'] === ctx.userId ? { kind: 'SERVER_DEFAULT', key: 'ACTOR_AS_REQUESTER' }
        : { kind: 'USER_CHOICE', choiceId: requester.choiceId, choiceRevision: requester.revision }, validatedAt: now }]);
    return { missing: [...new Set(missing)], receipts, request: missing.length ? undefined : {
      requesterUserId: String(requester!.raw['id']), branchId: String(branch!.raw['id']),
      ...(proposal.fields.title ? { title: proposal.fields.title.value } : {}), reason: proposal.fields.reason!.value,
      ...(proposal.fields.missingReceiptReason?.value ? { missingReceiptReason: proposal.fields.missingReceiptReason.value } : {}), lines,
    } };
  }

  private async hydrateUpdate(ctx: RequestContext, options: StoredOptions, proposal: LineReimbursementDraftProposalV1,
    receipts: LineReimbursementValidatedFieldReceiptV1[]) {
    if (!proposal.targetRef) return { missing: ['targetRef'], receipts };
    const target = await this.currentChoice(ctx, this.findChoice(options, proposal.targetRef, 'TARGET'), options);
    const request = await this.repo.findRequestById(ctx.companyId, String(target.raw['id']), true);
    if (!request || request.status !== 'DRAFT' || request.updatedAt.toISOString() !== target.revision || !this.canUpdate(ctx, request)) throw new Error('REIMBURSEMENT_TARGET_CHANGED');
    let lines = (request.lines ?? []).map(line => this.lineInput(line));
    const lineByRef = new Map(options.choices.filter(item => item.kind === 'LINE').map(item => [item.choiceId, item]));
    const missing: string[] = [];
    for (const [index, change] of (proposal.lineChanges ?? []).entries()) {
      if (change.operation === 'ADD') {
        const line = await this.hydrateLine(ctx, options, change.values, undefined, index, missing);
        if (line) lines.push({ ...line, lineNo: lines.length + 1 });
        continue;
      }
      const choice = lineByRef.get(change.lineRef);
      if (!choice) throw new Error('INVALID_REIMBURSEMENT_CHOICE');
      await this.currentChoice(ctx, choice, options);
      const lineIndex = lines.findIndex(item => item.lineNo === choice.raw['lineNo']);
      if (lineIndex < 0) throw new Error('REIMBURSEMENT_TARGET_CHANGED');
      if (change.operation === 'REMOVE') { lines.splice(lineIndex, 1); continue; }
      const current = lines[lineIndex]!;
      const changesLinkedFacts = !!(change.values.incurredDate || change.values.description || change.values.purpose
        || change.values.amount || change.values.categoryChoiceId || change.values.attachmentChoiceId !== undefined);
      if (current.linkedExpenseId && changesLinkedFacts && change.values.linkedExpenseChoiceId !== null) throw new Error('LINKED_SOURCE_REQUIRES_DETACH');
      const updated = await this.hydrateLine(ctx, options, change.values, current, index, missing);
      if (updated) lines[lineIndex] = { ...updated, lineNo: current.lineNo };
    }
    lines = lines.map((line, index) => ({ ...line, lineNo: index + 1 }));
    if (!lines.length) missing.push('lines');
    if (!(proposal.lineChanges?.length || Object.keys(proposal.fields).length)) missing.push('changes');
    return { missing: [...new Set(missing)], receipts, requestId: request.id,
      expectedRequestUpdatedAt: request.updatedAt.toISOString(), request: missing.length ? undefined : {
        title: proposal.fields.title ? proposal.fields.title.value : request.title,
        reason: proposal.fields.reason ? proposal.fields.reason.value : request.reason,
        ...(proposal.fields.missingReceiptReason
          ? { missingReceiptReason: proposal.fields.missingReceiptReason.value }
          : request.missingReceiptReason !== undefined ? { missingReceiptReason: request.missingReceiptReason } : {}),
        lines,
      } };
  }

  private async hydrateLine(ctx: RequestContext, options: StoredOptions, values: any, base: ReimbursementLineInput | undefined,
    index: number, missing: string[]): Promise<Omit<ReimbursementLineInput, 'lineNo'> | null> {
    let linked = base?.linkedExpenseId, sourceUpdatedAt = base?.sourceExpenseUpdatedAt;
    let incurredDate = values.incurredDate?.value ?? base?.incurredDate;
    let description = values.description?.value ?? base?.description;
    let purpose = values.purpose?.value ?? base?.purpose;
    let amount = values.amount?.value ?? base?.amount;
    let categoryKey = base?.categoryKey, categoryLabel = base?.categoryLabel;
    let attachmentId = base?.attachmentId;
    if (values.linkedExpenseChoiceId === null) { linked = null; sourceUpdatedAt = undefined; }
    else if (values.linkedExpenseChoiceId) {
      const choice = await this.currentChoice(ctx, this.findChoice(options, values.linkedExpenseChoiceId, 'SOURCE'), options);
      const [source] = await this.repo.listReimbursementSources(ctx.companyId, String(choice.raw['branchId']), String(choice.raw['requesterUserId']), '', String(choice.raw['expenseId']));
      if (!source || !source.eligible || source.updatedAt !== choice.revision) throw new Error('REIMBURSEMENT_SOURCE_CHANGED');
      const expected = { incurredDate: source.incurredDate, amount: source.amount, categoryKey: source.categoryKey };
      if (values.incurredDate && values.incurredDate.value !== expected.incurredDate || values.amount && values.amount.value !== expected.amount
        || values.categoryChoiceId && this.findChoice(options, values.categoryChoiceId, 'CATEGORY').raw['key'] !== expected.categoryKey) throw new Error('LINKED_SOURCE_OVERRIDE');
      linked = source.expenseId; sourceUpdatedAt = source.updatedAt; incurredDate = source.incurredDate; amount = source.amount;
      description = source.description; purpose = source.purpose || undefined; categoryKey = source.categoryKey; categoryLabel = source.categoryLabel;
    }
    if (values.categoryChoiceId && !linked) {
      const category = await this.currentChoice(ctx, this.findChoice(options, values.categoryChoiceId, 'CATEGORY'), options);
      categoryKey = String(category.raw['key']); categoryLabel = String(category.raw['label']);
    }
    if (values.attachmentChoiceId === null) attachmentId = null;
    else if (values.attachmentChoiceId) {
      const attachment = await this.currentChoice(ctx, this.findChoice(options, values.attachmentChoiceId, 'ATTACHMENT'), options);
      attachmentId = String(attachment.raw['id']);
    }
    const path = `lineChanges.${index}.values`;
    if (!incurredDate) missing.push(`${path}.incurredDate`);
    if (!description) missing.push(`${path}.description`);
    if (!amount) missing.push(`${path}.amount`);
    if (!categoryKey) missing.push(`${path}.categoryChoiceId`);
    return incurredDate && description && amount && categoryKey ? { incurredDate, description, ...(purpose ? { purpose } : {}),
      categoryKey, ...(categoryLabel ? { categoryLabel } : {}), amount,
      ...(attachmentId !== undefined ? { attachmentId } : {}), ...(linked !== undefined ? { linkedExpenseId: linked } : {}),
      ...(sourceUpdatedAt ? { sourceExpenseUpdatedAt: sourceUpdatedAt } : {}) } : null;
  }

  private lineInput(line: ReimbursementLineRecord): ReimbursementLineInput {
    return { lineNo: line.lineNo, incurredDate: line.incurredDate.toISOString().slice(0, 10), description: line.description,
      ...(line.purpose ? { purpose: line.purpose } : {}), categoryKey: line.categoryKey,
      ...(line.categoryLabelSnapshot ? { categoryLabel: line.categoryLabelSnapshot } : {}), amount: line.amount,
      attachmentId: line.attachmentId ?? null, linkedExpenseId: line.linkedExpenseId ?? null,
      ...(line.sourceExpenseSnapshot?.expenseUpdatedAt ? { sourceExpenseUpdatedAt: line.sourceExpenseSnapshot.expenseUpdatedAt } : {}) };
  }

  private missingFields(proposal: LineReimbursementDraftProposalV1): string[] {
    if (proposal.operation === 'UPDATE') return proposal.targetRef ? [] : ['targetRef'];
    const missing: string[] = [];
    if (!proposal.fields.reason) missing.push('fields.reason');
    if (!proposal.lineChanges?.length) missing.push('lineChanges');
    return missing;
  }

  private locator(key: LineReimbursementActionKey) {
    return { actionId: key.actionId, taskId: key.taskId, operation: key.operation };
  }
  private ok(toolName: string, key: LineReimbursementActionKey, data: Record<string, unknown>): ToolResult {
    return { toolName, status: 'ok', data, sourceRefs: [{ id: `reimbursement-action:${key.actionId}`,
      label: 'ร่างใบเบิกที่ตรวจสิทธิ์แล้ว', module: 'reimbursements', entityType: 'reimbursement_draft_action',
      entityId: key.actionId, permissionChecked: true, sourceType: 'ACTION' }], asOf: new Date().toISOString() };
  }
  private domainResult(toolName: string, key: LineReimbursementActionKey, result: LineReimbursementDraftResult): ToolResult {
    return this.ok(toolName, key, { reimbursementDraft: result, actionLocator: this.locator(key) });
  }
  private denied(toolName: string, errorCode: string): ToolResult {
    return { toolName, status: 'forbidden', sourceRefs: [], asOf: new Date().toISOString(), errorCode };
  }
}
