import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { CreateReimbursementRequestInput, RequestContext, ReimbursementLineInput, UpdateReimbursementDraftInput } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type {
  ReimbursementDraftActionOwner,
  ReimbursementDraftActionRecord,
  ReimbursementDraftPreparedCommand,
  ReimbursementLineRecord,
  ReimbursementLineWriteData,
  ReimbursementRequestRecord,
} from '../../domain/models/reimbursement.model';
import { computeReceiptRequirement, deriveHeaderFromLines, validateRequestFields } from '../../domain/logic/reimbursement.logic';
import { assertReimbursementBranchInScope } from './reimbursement-branch-scope';
import { loadReimbursementPolicy, prepareReimbursementLineWrites } from './reimbursement-request.use-case';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { assertReimbursementWriteAvailable } from '../../presentation/http/reimbursement-write-quiesce.guard';
import { RedisRateLimitService } from '../../../../common/security/redis-rate-limit.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ACTION_BYTES = 128 * 1024;
const COLLECTION_TTL_MS = 2 * 60 * 60_000;
const COLLECTION_MAX_MS = 24 * 60 * 60_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEW_RATE_SCOPE = 'line-draft-preview-user';
const PREVIEW_RATE_MAX = 20;
const PREVIEW_RATE_WINDOW_SECONDS = 300;
const MONEY = /^\d{1,14}(?:\.\d{1,4})?$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type LineReimbursementDraftPreview = {
  schemaVersion: 1;
  actionId: string;
  previewRevision: number;
  operation: 'CREATE' | 'UPDATE';
  expiresAt: string;
  expectedRequestUpdatedAt?: string;
  targetRef?: string;
  before?: LineReimbursementDraftSnapshot;
  after: LineReimbursementDraftSnapshot;
  diff: Array<{ fieldPath: string; before?: unknown; after?: unknown }>;
  warnings: string[];
  confirmationDigest: string;
};

export type LineReimbursementDraftSnapshot = {
  requesterUserId: string;
  requesterDisplayName: string;
  branchId: string;
  currency: string;
  title?: string;
  reason: string;
  missingReceiptReason?: string;
  lines: Array<{
    lineRef: string; lineNo: number; incurredDate: string; description: string; purpose?: string;
    categoryKey: string; categoryLabel?: string; amount: string; attachmentId?: string;
    linkedExpenseId?: string; sourceExpenseSnapshot?: unknown;
  }>;
  amount: string;
  categoryKey: string;
  categoryLabel?: string;
  incurredDate: string;
  receiptRequirementStatus: string;
  status: 'DRAFT';
  signatureImpact: 'NONE' | 'INVALIDATED';
};

export type LineReimbursementDraftResult =
  | { status: 'needs_fields'; actionId: string; fieldPaths: string[]; actionRevision: number }
  | { status: 'needs_target'; actionId: string; actionRevision: number }
  | { status: 'preview'; preview: LineReimbursementDraftPreview }
  | { status: 'applied'; receipt: Record<string, unknown> }
  | { status: 'cancelled'; actionId: string }
  | { status: 'expired'; actionId: string }
  | { status: 'stale'; actionId: string; errorCode?: 'source_changed' | 'state_not_editable' }
  | { status: 'blocked'; errorCode: string; fieldPaths?: string[]; limit?: number; retryAfter?: number }
  | { status: 'result_unknown'; actionId: string };

export type LineReimbursementActionKey = {
  actionId: string;
  taskId: string;
  actionOrdinal: number;
  operation: 'CREATE' | 'UPDATE';
};

type PreviewInput = {
  ctx: RequestContext;
  owner: ReimbursementDraftActionOwner;
  key: LineReimbursementActionKey;
  sourceProof: unknown;
  targetRef?: string;
} & (
  | { operation: 'CREATE'; request: CreateReimbursementRequestInput }
  | { operation: 'UPDATE'; requestId: string; expectedRequestUpdatedAt: string; request: UpdateReimbursementDraftInput }
);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isoDate(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

@Injectable()
export class LineReimbursementDraftUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly evidence: ReimbursementEvidenceService,
    private readonly config: AppConfigService,
    @Optional() private readonly rateLimits?: RedisRateLimitService,
  ) {}

  async open(ctx: RequestContext, owner: ReimbursementDraftActionOwner, key: LineReimbursementActionKey, now = new Date()): Promise<ReimbursementDraftActionRecord | LineReimbursementDraftResult> {
    const blocked = await this.assertNewWriteAllowed(ctx, owner, key.operation);
    if (blocked) return blocked;
    if (!UUID.test(key.actionId) || !UUID.test(key.taskId) || !Number.isSafeInteger(key.actionOrdinal) || key.actionOrdinal < 1) {
      return { status: 'blocked', errorCode: 'invalid_field' };
    }
    let action: ReimbursementDraftActionRecord;
    try {
      action = await this.repo.findOrCreateDraftAction({
        ...owner, id: key.actionId, taskId: key.taskId, actionOrdinal: key.actionOrdinal, operation: key.operation,
        intentKeyHash: digest(['line-reimbursement-draft-intent', owner, key.taskId, key.actionOrdinal]),
        expiresAt: new Date(now.getTime() + COLLECTION_TTL_MS),
      });
    } catch (error) {
      if (error instanceof ConflictException && error.message === 'reimbursement_active_action_exists') {
        return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['activeAction'] };
      }
      throw error;
    }
    if (action.status === 'EXPIRED' || action.expiresAt <= now) return { status: 'expired', actionId: action.id };
    if (action.status === 'CANCELLED') return { status: 'cancelled', actionId: action.id };
    if (action.status === 'STALE') return { status: 'stale', actionId: action.id };
    return action;
  }

  async collect(input: {
    ctx: RequestContext; owner: ReimbursementDraftActionOwner; key: LineReimbursementActionKey;
    accepted: unknown; sourceProof: unknown; fieldPaths: string[]; requestId?: string; expectedRequestUpdatedAt?: string; now?: Date;
  }): Promise<LineReimbursementDraftResult> {
    const now = input.now ?? new Date();
    if (input.fieldPaths.length < 1 || input.fieldPaths.length > 64
      || input.fieldPaths.some((path) => typeof path !== 'string' || path.length < 1 || path.length > 200 || !/^[A-Za-z0-9_.\[\]-]+$/.test(path))) {
      return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['fieldPaths'] };
    }
    if (input.expectedRequestUpdatedAt !== undefined && !Number.isFinite(Date.parse(input.expectedRequestUpdatedAt))) {
      return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['expectedRequestUpdatedAt'] };
    }
    if (!this.validSourceProof(input.sourceProof)) return { status: 'blocked', errorCode: 'invalid_provenance' };
    const opened = await this.open(input.ctx, input.owner, input.key, now);
    if (!('id' in opened)) return opened;
    let payload: unknown;
    let sourceProof: unknown;
    try {
      payload = jsonClone({ schemaVersion: 1, kind: 'COLLECTION', taskId: input.key.taskId, accepted: input.accepted,
        lastPreviewRevision: opened.previewRevision, fieldPaths: [...new Set(input.fieldPaths)] });
      sourceProof = jsonClone(input.sourceProof ?? null);
    } catch { return { status: 'blocked', errorCode: 'invalid_provenance' }; }
    if (!this.payloadFits(payload, undefined, sourceProof)) return { status: 'blocked', errorCode: 'evidence_overflow' };
    const expiresAt = new Date(Math.min(now.getTime() + COLLECTION_TTL_MS, opened.createdAt.getTime() + COLLECTION_MAX_MS));
    const saved = await this.repo.saveDraftActionCollection({ owner: input.owner, actionId: opened.id, expectedUpdatedAt: opened.updatedAt,
      commandJson: payload, sourceProofJson: sourceProof, requestId: input.requestId,
      expectedRequestUpdatedAt: input.expectedRequestUpdatedAt ? new Date(input.expectedRequestUpdatedAt) : undefined, expiresAt });
    if (!saved) return { status: 'stale', actionId: opened.id };
    return { status: 'needs_fields', actionId: opened.id, fieldPaths: (payload as { fieldPaths: string[] }).fieldPaths, actionRevision: saved.previewRevision };
  }

  /** Stores only API-issued option locators/snapshots. It creates no request and never makes a
   * preview confirmable; the adapter later replaces this payload with validated accepted fields. */
  async saveTrustedOptions(input: {
    ctx: RequestContext; owner: ReimbursementDraftActionOwner; key: LineReimbursementActionKey;
    accepted: unknown; fieldPaths?: string[]; now?: Date;
  }): Promise<ReimbursementDraftActionRecord | LineReimbursementDraftResult> {
    const now = input.now ?? new Date();
    const opened = await this.open(input.ctx, input.owner, input.key, now);
    if (!('id' in opened) || opened.status === 'PREVIEW' || opened.status === 'APPLIED') return opened;
    let payload: unknown;
    try {
      payload = jsonClone({ schemaVersion: 1, kind: 'COLLECTION', taskId: input.key.taskId,
        accepted: input.accepted, lastPreviewRevision: opened.previewRevision,
        fieldPaths: [...new Set(input.fieldPaths ?? [])] });
    } catch { return { status: 'blocked', errorCode: 'invalid_field' }; }
    if (!this.payloadFits(payload, undefined, null)) return { status: 'blocked', errorCode: 'evidence_overflow' };
    const expiresAt = new Date(Math.min(now.getTime() + COLLECTION_TTL_MS, opened.createdAt.getTime() + COLLECTION_MAX_MS));
    const saved = await this.repo.saveDraftActionCollection({ owner: input.owner, actionId: opened.id,
      expectedUpdatedAt: opened.updatedAt, commandJson: payload, sourceProofJson: null, expiresAt });
    return saved ?? { status: 'stale', actionId: opened.id };
  }

  async active(ctx: RequestContext, owner: ReimbursementDraftActionOwner, now = new Date()): Promise<ReimbursementDraftActionRecord | null> {
    if (!this.contextMatches(ctx, owner)
      || !await this.repo.isDraftActionOwnerCurrent(owner, this.config.lineMessagingChannelId)) return null;
    const action = await this.repo.findActiveDraftAction(owner, now);
    return action && await this.canOperate(ctx, action) ? action : null;
  }

  async preview(input: PreviewInput, now = new Date()): Promise<LineReimbursementDraftResult> {
    if (input.operation !== input.key.operation) return { status: 'blocked', errorCode: 'invalid_field' };
    if (!this.validSourceProof(input.sourceProof)) return { status: 'blocked', errorCode: 'invalid_provenance' };
    const limitError = this.inputLimitError(input.request);
    if (limitError) return limitError;
    const opened = await this.open(input.ctx, input.owner, input.key, now);
    if (!('id' in opened)) return opened;
    if (opened.status === 'APPLIED') return this.replay(input.ctx, input.owner, opened.id);
    if (opened.status === 'CANCELLED') return { status: 'cancelled', actionId: opened.id };
    if (opened.status === 'EXPIRED' || opened.expiresAt <= now) return { status: 'expired', actionId: opened.id };
    if (await this.rateLimited(input.ctx)) return { status: 'blocked', errorCode: 'rate_limited', retryAfter: PREVIEW_RATE_WINDOW_SECONDS };
    try {
      const prepared = input.operation === 'CREATE'
        ? await this.prepareCreate(input.ctx, opened.id, input.request)
        : await this.prepareUpdate(input.ctx, opened.id, input.requestId, input.expectedRequestUpdatedAt, input.request);
      const preparedCommand = jsonClone(prepared.command);
      const sourceProof = jsonClone(input.sourceProof ?? null);
      if (opened.status === 'PREVIEW' && isDeepStrictEqual(opened.commandJson, preparedCommand)
        && isDeepStrictEqual(opened.sourceProofJson, sourceProof)) {
        const existing = this.parsePreview(opened.previewJson, opened);
        if (existing) return { status: 'preview', preview: existing };
      }
      const lastPreviewRevision = opened.status === 'COLLECTING'
        ? Number((opened.commandJson as { lastPreviewRevision?: unknown } | undefined)?.lastPreviewRevision ?? 0)
        : opened.previewRevision;
      const previewRevision = Number.isSafeInteger(lastPreviewRevision) && lastPreviewRevision >= 0 ? lastPreviewRevision + 1 : opened.previewRevision + 1;
      const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
      const after = this.snapshot(opened.id, preparedCommand, prepared.afterLines, prepared.signatureImpact);
      const before = 'before' in prepared && prepared.before ? this.snapshot(opened.id, prepared.before.command, prepared.before.lines, 'NONE') : undefined;
      const confirmationDigest = digest({ schemaVersion: 1, actionId: opened.id, previewRevision, owner: input.owner,
        command: preparedCommand, sourceProof, expectedRequestUpdatedAt: preparedCommand.expectedRequestUpdatedAt ?? null, after });
      const preview: LineReimbursementDraftPreview = {
        schemaVersion: 1, actionId: opened.id, previewRevision, operation: input.operation, expiresAt: expiresAt.toISOString(),
        ...(preparedCommand.expectedRequestUpdatedAt ? { expectedRequestUpdatedAt: preparedCommand.expectedRequestUpdatedAt } : {}),
        ...(input.targetRef ? { targetRef: input.targetRef } : {}), ...(before ? { before } : {}), after,
        diff: this.diff(before, after), warnings: prepared.warnings, confirmationDigest,
      };
      if (!this.payloadFits(preparedCommand, preview, sourceProof)) return { status: 'blocked', errorCode: 'evidence_overflow' };
      const saved = await this.repo.saveDraftActionPreview({ owner: input.owner, actionId: opened.id, expectedUpdatedAt: opened.updatedAt,
        commandJson: preparedCommand, previewJson: preview, sourceProofJson: sourceProof, confirmationDigest,
        previewRevision, requestId: preparedCommand.requestId, expectedRequestUpdatedAt: preparedCommand.expectedRequestUpdatedAt ? new Date(preparedCommand.expectedRequestUpdatedAt) : undefined,
        expiresAt });
      return saved ? { status: 'preview', preview } : { status: 'stale', actionId: opened.id };
    } catch (error) {
      return this.validationResult(error, opened.id, opened.previewRevision);
    }
  }

  async get(input: { ctx: RequestContext; owner: ReimbursementDraftActionOwner; actionId: string; markWebRendered?: boolean; now?: Date }): Promise<LineReimbursementDraftResult> {
    const now = input.now ?? new Date();
    const action = await this.repo.findDraftAction(input.owner.companyId, input.actionId);
    if (!action || !this.ownerMatches(action, input.owner) || !this.contextMatches(input.ctx, input.owner)
      || !await this.repo.isDraftActionOwnerCurrent(input.owner, this.config.lineMessagingChannelId,
        ['APPLIED', 'CANCELLED', 'EXPIRED', 'STALE'].includes(action.status))) return { status: 'blocked', errorCode: 'forbidden' };
    if (action.status === 'APPLIED') return this.replay(input.ctx, input.owner, action.id);
    if (!await this.canOperate(input.ctx, action)) return { status: 'blocked', errorCode: 'forbidden' };
    if (action.status === 'CANCELLED') return { status: 'cancelled', actionId: action.id };
    if (action.status === 'EXPIRED' || action.expiresAt <= now) return { status: 'expired', actionId: action.id };
    if (action.status === 'STALE') return { status: 'stale', actionId: action.id };
    if (action.status === 'COLLECTING') {
      const fields = (action.commandJson as { fieldPaths?: unknown } | undefined)?.fieldPaths;
      return { status: 'needs_fields', actionId: action.id, fieldPaths: Array.isArray(fields) ? fields.filter((item): item is string => typeof item === 'string') : [], actionRevision: action.previewRevision };
    }
    const preview = this.parsePreview(action.previewJson, action);
    if (!preview) return { status: 'blocked', errorCode: 'store_unavailable' };
    if (!await this.previewStillCurrent(input.ctx, action)) {
      return { status: 'stale', actionId: action.id, errorCode: 'source_changed' };
    }
    if (input.markWebRendered) {
      const receiptId = `web:${digest([input.ctx.sessionId ?? input.ctx.requestId, action.id, action.previewRevision, action.confirmationDigest])}`;
      if (!await this.repo.markDraftActionWebRendered({ owner: input.owner, actionId: action.id, previewRevision: action.previewRevision,
        confirmationDigest: action.confirmationDigest!, receiptId, now })) return { status: 'stale', actionId: action.id };
    }
    return { status: 'preview', preview };
  }

  async getForWeb(ctx: RequestContext, actionId: string, now = new Date()): Promise<LineReimbursementDraftResult> {
    const owner = await this.ownerForWeb(ctx, actionId);
    return owner ? this.get({ ctx, owner, actionId, markWebRendered: true, now }) : { status: 'blocked', errorCode: 'forbidden' };
  }

  async confirmForWeb(ctx: RequestContext, actionId: string, previewRevision: number, confirmationDigest: string, now = new Date()): Promise<LineReimbursementDraftResult> {
    const owner = await this.ownerForWeb(ctx, actionId);
    return owner ? this.confirm({ ctx, owner, actionId, previewRevision, confirmationDigest, now }) : { status: 'blocked', errorCode: 'forbidden' };
  }

  async cancelForWeb(ctx: RequestContext, actionId: string, previewRevision: number, confirmationDigest: string, now = new Date()): Promise<LineReimbursementDraftResult> {
    const owner = await this.ownerForWeb(ctx, actionId);
    return owner ? this.cancel({ ctx, owner, actionId, previewRevision, confirmationDigest, now }) : { status: 'blocked', errorCode: 'forbidden' };
  }

  async markLineDelivered(input: { ctx: RequestContext; owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; deliveryPlanId: string; now?: Date }): Promise<boolean> {
    if (!this.contextMatches(input.ctx, input.owner)) return false;
    return this.repo.markDraftActionLineDelivered({ ...input, now: input.now ?? new Date() });
  }

  async confirm(input: { ctx: RequestContext; owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; now?: Date }): Promise<LineReimbursementDraftResult> {
    const now = input.now ?? new Date();
    if (!UUID.test(input.actionId) || !Number.isSafeInteger(input.previewRevision) || input.previewRevision < 1 || !HASH.test(input.confirmationDigest)) {
      return { status: 'blocked', errorCode: 'invalid_field' };
    }
    const action = await this.repo.findDraftAction(input.owner.companyId, input.actionId);
    if (!action || !this.ownerMatches(action, input.owner) || !this.contextMatches(input.ctx, input.owner)) return { status: 'blocked', errorCode: 'forbidden' };
    if (action.status === 'APPLIED') return this.replay(input.ctx, input.owner, action.id);
    if (!await this.canOperate(input.ctx, action)) return { status: 'blocked', errorCode: 'forbidden' };
    if (!this.config.lineAiReimbursementDraftWriteEnabled) return { status: 'blocked', errorCode: 'feature_disabled' };
    try { assertReimbursementWriteAvailable(this.config); } catch { return { status: 'blocked', errorCode: 'write_quiesced', retryAfter: 60 }; }
    if (!input.ctx.permissions.includes('line.ai.query') || !input.ctx.permissions.includes('ai.tool.invoke')) return { status: 'blocked', errorCode: 'forbidden' };
    try {
      const result = await this.repo.applyDraftActionAtomic({ owner: input.owner, actionId: action.id,
        previewRevision: input.previewRevision, confirmationDigest: input.confirmationDigest,
        requestId: action.operation === 'CREATE' ? action.id : action.requestId!, traceRequestId: input.ctx.requestId,
        now, sharedMessagingChannelId: this.config.lineMessagingChannelId });
      if (result.kind === 'applied' || result.kind === 'already_applied') return this.appliedResult(result.action, result.request);
      if (result.kind === 'cancelled') return { status: 'cancelled', actionId: action.id };
      if (result.kind === 'expired') return { status: 'expired', actionId: action.id };
      if (result.kind === 'needs_fields') return { status: 'needs_fields', actionId: action.id, fieldPaths: [], actionRevision: action.previewRevision };
      if (result.kind === 'not_delivered') return { status: 'blocked', errorCode: 'preview_not_fully_delivered' };
      if (result.kind === 'forbidden') return { status: 'blocked', errorCode: 'forbidden' };
      await this.repo.markDraftActionStale({ owner: input.owner, actionId: action.id,
        previewRevision: input.previewRevision, confirmationDigest: input.confirmationDigest });
      return { status: 'stale', actionId: action.id };
    } catch (error) {
      const response = this.validationResult(error, action.id, action.previewRevision, true);
      if (response.status === 'stale') await this.repo.markDraftActionStale({ owner: input.owner, actionId: action.id,
        previewRevision: input.previewRevision, confirmationDigest: input.confirmationDigest });
      if (this.isUnknownStoreError(error)) return { status: 'result_unknown', actionId: action.id };
      return response;
    }
  }

  async cancel(input: { ctx: RequestContext; owner: ReimbursementDraftActionOwner; actionId: string; previewRevision: number; confirmationDigest: string; now?: Date }): Promise<LineReimbursementDraftResult> {
    if (!this.contextMatches(input.ctx, input.owner)) return { status: 'blocked', errorCode: 'forbidden' };
    const result = await this.repo.cancelDraftAction({ ...input, now: input.now ?? new Date(), sharedMessagingChannelId: this.config.lineMessagingChannelId });
    if (result === 'cancelled') return { status: 'cancelled', actionId: input.actionId };
    if (result === 'applied') return this.replay(input.ctx, input.owner, input.actionId);
    if (result === 'expired') return { status: 'expired', actionId: input.actionId };
    if (result === 'forbidden') return { status: 'blocked', errorCode: 'forbidden' };
    return { status: 'stale', actionId: input.actionId };
  }

  async cancelCollection(input: { ctx: RequestContext; owner: ReimbursementDraftActionOwner; actionId: string }): Promise<LineReimbursementDraftResult> {
    if (!UUID.test(input.actionId) || !this.contextMatches(input.ctx, input.owner)) return { status: 'blocked', errorCode: 'forbidden' };
    const result = await this.repo.cancelDraftCollection({ owner: input.owner, actionId: input.actionId,
      sharedMessagingChannelId: this.config.lineMessagingChannelId });
    if (result === 'cancelled') return { status: 'cancelled', actionId: input.actionId };
    if (result === 'applied') return this.replay(input.ctx, input.owner, input.actionId);
    if (result === 'expired') return { status: 'expired', actionId: input.actionId };
    if (result === 'forbidden') return { status: 'blocked', errorCode: 'forbidden' };
    return { status: 'stale', actionId: input.actionId };
  }

  async replay(ctx: RequestContext, owner: ReimbursementDraftActionOwner, actionId: string): Promise<LineReimbursementDraftResult> {
    const action = await this.repo.findDraftAction(owner.companyId, actionId);
    if (!action || action.status !== 'APPLIED' || !this.ownerMatches(action, owner) || !this.contextMatches(ctx, owner)
      || !await this.repo.isDraftActionOwnerCurrent(owner, this.config.lineMessagingChannelId, true)
      || !await this.canReadApplied(ctx, action)) return { status: 'blocked', errorCode: 'forbidden' };
    const request = action.requestId ? await this.repo.findRequestById(owner.companyId, action.requestId) : null;
    if (!request) return { status: 'blocked', errorCode: 'store_unavailable' };
    return this.appliedResult(action, request);
  }

  private async prepareCreate(ctx: RequestContext, actionId: string, input: CreateReimbursementRequestInput) {
    assertReimbursementBranchInScope(ctx, input.branchId);
    const branchId = await this.repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, input.branchId);
    const errors = validateRequestFields(input);
    if (errors.length) throw new BadRequestException(errors.join(','));
    const requesterUserId = input.requesterUserId ?? ctx.userId;
    if (requesterUserId !== ctx.userId && !ctx.permissions.includes('reimbursement.finance_review')) throw new ForbiddenException();
    const member = await this.repo.assertReimbursementRequester(ctx.companyId, branchId, requesterUserId);
    const policy = await loadReimbursementPolicy(this.repo, ctx.companyId);
    if (input.currency && input.currency !== policy.currency) throw new BadRequestException('currency_not_supported');
    const resolved = await this.repo.resolveSourceLines(ctx.companyId, requesterUserId, branchId, policy.currency, input.lines);
    await this.evidence.validate(ctx, requesterUserId, resolved, branchId);
    const lines = prepareReimbursementLineWrites(resolved);
    const header = deriveHeaderFromLines(lines);
    const receipt = computeReceiptRequirement({ requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines: resolved, missingReceiptReason: input.missingReceiptReason });
    const command: ReimbursementDraftPreparedCommand = {
      schemaVersion: 1, operation: 'CREATE', requesterUserId, requesterDisplayNameSnapshot: member.displayName,
      branchId, ...(input.title !== undefined ? { title: input.title } : {}), reason: input.reason.trim(), currency: policy.currency,
      ...(input.missingReceiptReason ? { missingReceiptReason: input.missingReceiptReason } : {}), receiptRequirementStatus: receipt.status,
      header: { amount: header.amount, categoryKey: header.categoryKey, ...(header.categoryLabelSnapshot ? { categoryLabelSnapshot: header.categoryLabelSnapshot } : {}), incurredDate: header.incurredDate.toISOString() },
      lines: lines.map((line) => ({ ...line, incurredDate: line.incurredDate.toISOString() })),
      policyProof: { currency: policy.currency, requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason },
      invalidateSignatures: false,
    };
    return { command, afterLines: lines, signatureImpact: 'NONE' as const, warnings: receipt.status === 'REQUIRED' ? ['missing_receipt'] : [] };
  }

  private async prepareUpdate(ctx: RequestContext, actionId: string, requestId: string, expectedUpdatedAt: string, input: UpdateReimbursementDraftInput) {
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new ConflictException('reimbursement_target_missing');
    if (!(await this.canUpdateRequest(ctx, req)) || req.status !== 'DRAFT') throw new ConflictException('state_not_editable');
    if (req.updatedAt.toISOString() !== expectedUpdatedAt) throw new ConflictException('reimbursement_draft_changed');
    assertReimbursementBranchInScope(ctx, req.branchId);
    if (input.currency !== undefined && input.currency !== req.currency) throw new BadRequestException('currency_not_supported');
    const lineInputs = input.lines ?? this.toLineInputs(req.lines ?? []);
    const errors = validateRequestFields({ reason: input.reason ?? req.reason, lines: lineInputs });
    if (errors.length) throw new BadRequestException(errors.join(','));
    const policy = await loadReimbursementPolicy(this.repo, ctx.companyId);
    if (policy.currency !== req.currency) throw new ConflictException('reimbursement_policy_changed');
    const resolved = await this.repo.resolveSourceLines(ctx.companyId, req.requesterUserId, req.branchId!, req.currency, lineInputs);
    await this.evidence.validate(ctx, req.requesterUserId, resolved, req.branchId, new Map((req.lines ?? []).flatMap((line) => line.attachmentSnapshot ? [[line.attachmentSnapshot.id, line.attachmentSnapshot.uploadedByUserId] as const] : [])));
    const lines = prepareReimbursementLineWrites(resolved);
    const title = input.title === undefined ? req.title : input.title || undefined;
    const reason = input.reason ?? req.reason;
    const missingReceiptReason = input.missingReceiptReason === undefined ? req.missingReceiptReason : input.missingReceiptReason ?? undefined;
    const header = deriveHeaderFromLines(lines);
    const receipt = computeReceiptRequirement({ requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines: resolved, missingReceiptReason });
    const command: ReimbursementDraftPreparedCommand = {
      schemaVersion: 1, operation: 'UPDATE', requestId, expectedRequestUpdatedAt: expectedUpdatedAt,
      requesterUserId: req.requesterUserId, requesterDisplayNameSnapshot: req.requesterDisplayNameSnapshot, branchId: req.branchId!,
      ...(title ? { title } : {}),
      reason, currency: req.currency, ...(missingReceiptReason ? { missingReceiptReason } : {}), receiptRequirementStatus: receipt.status,
      header: { amount: header.amount, categoryKey: header.categoryKey, ...(header.categoryLabelSnapshot ? { categoryLabelSnapshot: header.categoryLabelSnapshot } : {}), incurredDate: header.incurredDate.toISOString() },
      lines: lines.map((line) => ({ ...line, incurredDate: line.incurredDate.toISOString() })),
      policyProof: { currency: policy.currency, requireReceipt: policy.requireReceipt, allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason },
      invalidateSignatures: !isDeepStrictEqual(this.toComparableLines(req.lines ?? []), this.toComparableWrites(lines))
        || (title ?? '') !== (req.title ?? '')
        || reason !== req.reason || (missingReceiptReason ?? '') !== (req.missingReceiptReason ?? ''),
    };
    const beforeCommand: ReimbursementDraftPreparedCommand = { ...command, title: req.title, reason: req.reason,
      missingReceiptReason: req.missingReceiptReason, receiptRequirementStatus: req.receiptRequirementStatus,
      header: { amount: req.amount, categoryKey: req.categoryKey, ...(req.categoryLabelSnapshot ? { categoryLabelSnapshot: req.categoryLabelSnapshot } : {}), incurredDate: req.incurredDate.toISOString() },
      lines: this.toLineWrites(req.lines ?? []).map((line) => ({ ...line, incurredDate: line.incurredDate.toISOString() })), invalidateSignatures: false };
    return { command, afterLines: lines, before: { command: beforeCommand, lines: this.toLineWrites(req.lines ?? []) },
      signatureImpact: command.invalidateSignatures && (req.claimSignatures?.length ?? 0) > 0 ? 'INVALIDATED' as const : 'NONE' as const,
      warnings: [receipt.status === 'REQUIRED' ? 'missing_receipt' : null, command.invalidateSignatures && (req.claimSignatures?.length ?? 0) > 0 ? 'signatures_invalidated' : null].filter((item): item is string => !!item) };
  }

  /** Delivery/read-time validation uses the same preparation path as preview. Saved JSON is never
   * treated as proof that an attachment, source expense, request revision or policy is still live. */
  private async previewStillCurrent(ctx: RequestContext, action: ReimbursementDraftActionRecord): Promise<boolean> {
    const command = action.commandJson as ReimbursementDraftPreparedCommand | undefined;
    if (!command || command.schemaVersion !== 1 || command.operation !== action.operation
      || !Array.isArray(command.lines) || command.lines.length < 1) return false;
    const lines: ReimbursementLineInput[] = command.lines.map((line) => ({
      lineNo: line.lineNo, incurredDate: String(line.incurredDate).slice(0, 10), description: line.description,
      ...(line.purpose ? { purpose: line.purpose } : {}), categoryKey: line.categoryKey,
      ...(line.categoryLabelSnapshot ? { categoryLabel: line.categoryLabelSnapshot } : {}), amount: line.amount,
      attachmentId: line.attachmentId ?? null, linkedExpenseId: line.linkedExpenseId ?? null,
      ...(line.sourceExpenseSnapshot?.expenseUpdatedAt ? { sourceExpenseUpdatedAt: line.sourceExpenseSnapshot.expenseUpdatedAt } : {}),
    }));
    try {
      const prepared = action.operation === 'CREATE'
        ? await this.prepareCreate(ctx, action.id, {
            requesterUserId: command.requesterUserId, branchId: command.branchId,
            ...(command.title !== undefined ? { title: command.title } : {}), reason: command.reason,
            ...(command.missingReceiptReason !== undefined ? { missingReceiptReason: command.missingReceiptReason } : {}), lines,
          })
        : await this.prepareUpdate(ctx, action.id, command.requestId!, command.expectedRequestUpdatedAt!, {
            title: command.title ?? '', reason: command.reason,
            missingReceiptReason: command.missingReceiptReason ?? null, lines,
          });
      // The stored command is the JSON form preview() saved; compare like with like. A line with no receipt file
      // prepares `attachmentSnapshot: undefined`, a key the stored JSON never has (NAT04 2026-09-30: every preview
      // of a bill claimed by reference read as changed the moment it was shown).
      return isDeepStrictEqual(jsonClone(prepared.command), command);
    } catch { return false; }
  }

  private snapshot(actionId: string, command: ReimbursementDraftPreparedCommand, lines: ReimbursementLineWriteData[], signatureImpact: 'NONE' | 'INVALIDATED'): LineReimbursementDraftSnapshot {
    return { requesterUserId: command.requesterUserId, requesterDisplayName: command.requesterDisplayNameSnapshot,
      branchId: command.branchId, currency: command.currency, ...(command.title ? { title: command.title } : {}), reason: command.reason,
      ...(command.missingReceiptReason ? { missingReceiptReason: command.missingReceiptReason } : {}),
      lines: lines.map((line) => ({ lineRef: digest([actionId, command.requestId ?? 'new', line.lineNo]), lineNo: line.lineNo,
        incurredDate: line.incurredDate.toISOString().slice(0, 10), description: line.description, ...(line.purpose ? { purpose: line.purpose } : {}),
        categoryKey: line.categoryKey, ...(line.categoryLabelSnapshot ? { categoryLabel: line.categoryLabelSnapshot } : {}), amount: line.amount,
        ...(line.attachmentId ? { attachmentId: line.attachmentId } : {}), ...(line.linkedExpenseId ? { linkedExpenseId: line.linkedExpenseId } : {}),
        ...(line.sourceExpenseSnapshot ? { sourceExpenseSnapshot: line.sourceExpenseSnapshot } : {}) })),
      amount: command.header.amount, categoryKey: command.header.categoryKey,
      ...(command.header.categoryLabelSnapshot ? { categoryLabel: command.header.categoryLabelSnapshot } : {}),
      incurredDate: command.header.incurredDate.slice(0, 10), receiptRequirementStatus: command.receiptRequirementStatus,
      status: 'DRAFT', signatureImpact };
  }

  private diff(before: LineReimbursementDraftSnapshot | undefined, after: LineReimbursementDraftSnapshot) {
    if (!before) return [{ fieldPath: 'request', after }];
    const result: Array<{ fieldPath: string; before?: unknown; after?: unknown }> = [];
    for (const key of ['title', 'reason', 'missingReceiptReason', 'amount', 'categoryKey', 'categoryLabel', 'incurredDate', 'receiptRequirementStatus'] as const) {
      if (!isDeepStrictEqual(before[key], after[key])) result.push({ fieldPath: key, before: before[key], after: after[key] });
    }
    if (!isDeepStrictEqual(before.lines, after.lines)) result.push({ fieldPath: 'lines', before: before.lines, after: after.lines });
    if (after.signatureImpact === 'INVALIDATED') result.push({ fieldPath: 'claimSignatures', before: 'PRESENT', after: 'INVALIDATED' });
    return result;
  }

  private parsePreview(value: unknown, action: ReimbursementDraftActionRecord): LineReimbursementDraftPreview | null {
    const preview = value as LineReimbursementDraftPreview | null;
    return preview && preview.schemaVersion === 1 && preview.actionId === action.id && preview.previewRevision === action.previewRevision
      && preview.confirmationDigest === action.confirmationDigest ? preview : null;
  }

  private payloadFits(command: unknown, preview: unknown, proof: unknown): boolean {
    return Buffer.byteLength(JSON.stringify(command ?? null), 'utf8') + Buffer.byteLength(JSON.stringify(preview ?? null), 'utf8')
      + Buffer.byteLength(JSON.stringify(proof ?? null), 'utf8') <= MAX_ACTION_BYTES;
  }

  private async assertNewWriteAllowed(ctx: RequestContext, owner: ReimbursementDraftActionOwner, operation: 'CREATE' | 'UPDATE'): Promise<LineReimbursementDraftResult | null> {
    if (!this.contextMatches(ctx, owner) || owner.channel !== 'line' || owner.channelKind !== 'USER') return { status: 'blocked', errorCode: 'unsupported_channel' };
    if (![owner.companyId, owner.actorUserId, owner.membershipId, owner.messagingChannelId].every((value) => typeof value === 'string' && value.length >= 1 && value.length <= 200)
      || !/^(?:[0-9a-f]{16}|[0-9a-f]{64})$/.test(owner.chatKeyHash) || !Number.isSafeInteger(owner.ownerEpoch) || owner.ownerEpoch < 0) return { status: 'blocked', errorCode: 'invalid_field' };
    if (!this.config.lineAiReimbursementDraftWriteEnabled) return { status: 'blocked', errorCode: 'feature_disabled' };
    try { assertReimbursementWriteAvailable(this.config); } catch { return { status: 'blocked', errorCode: 'write_quiesced', retryAfter: 60 }; }
    if (!ctx.permissions.includes('line.ai.query') || !ctx.permissions.includes('ai.tool.invoke')) return { status: 'blocked', errorCode: 'forbidden' };
    if (operation === 'CREATE' ? !ctx.permissions.includes('reimbursement.create')
      : !ctx.permissions.some((permission) => ['reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission))) return { status: 'blocked', errorCode: 'forbidden' };
    return await this.repo.isDraftActionOwnerCurrent(owner, this.config.lineMessagingChannelId) ? null : { status: 'blocked', errorCode: 'forbidden' };
  }

  private contextMatches(ctx: RequestContext, owner: ReimbursementDraftActionOwner): boolean {
    return ctx.companyId === owner.companyId && ctx.userId === owner.actorUserId && ctx.membershipId === owner.membershipId;
  }

  private ownerMatches(action: ReimbursementDraftActionRecord, owner: ReimbursementDraftActionOwner): boolean {
    return action.companyId === owner.companyId && action.actorUserId === owner.actorUserId && action.membershipId === owner.membershipId
      && action.channel === owner.channel && action.channelKind === owner.channelKind && action.messagingChannelId === owner.messagingChannelId
      && action.chatKeyHash === owner.chatKeyHash && action.ownerEpoch === owner.ownerEpoch;
  }

  private async ownerForWeb(ctx: RequestContext, actionId: string): Promise<ReimbursementDraftActionOwner | null> {
    if (!UUID.test(actionId)) return null;
    const action = await this.repo.findDraftAction(ctx.companyId, actionId);
    if (!action || action.actorUserId !== ctx.userId || action.membershipId !== ctx.membershipId) return null;
    return {
      companyId: action.companyId, actorUserId: action.actorUserId, membershipId: action.membershipId,
      channel: action.channel, channelKind: action.channelKind, messagingChannelId: action.messagingChannelId,
      chatKeyHash: action.chatKeyHash, ownerEpoch: action.ownerEpoch,
    };
  }

  private async canOperate(ctx: RequestContext, action: ReimbursementDraftActionRecord): Promise<boolean> {
    if (action.operation === 'CREATE') return ctx.permissions.includes('reimbursement.create');
    if (action.status === 'COLLECTING' && !action.requestId) {
      return ctx.permissions.some(permission => ['reimbursement.update_own_draft', 'reimbursement.finance_review'].includes(permission));
    }
    const request = action.requestId ? await this.repo.findRequestById(ctx.companyId, action.requestId) : null;
    return !!request && this.canUpdateRequest(ctx, request);
  }

  private async canUpdateRequest(ctx: RequestContext, request: ReimbursementRequestRecord): Promise<boolean> {
    return (request.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.update_own_draft'))
      || ctx.permissions.includes('reimbursement.finance_review');
  }

  private async canReadApplied(ctx: RequestContext, action: ReimbursementDraftActionRecord): Promise<boolean> {
    const request = action.requestId ? await this.repo.findRequestById(ctx.companyId, action.requestId) : null;
    if (!request) return false;
    return ctx.permissions.includes('reimbursement.read') || ctx.permissions.includes('reimbursement.finance_review')
      || (request.requesterUserId === ctx.userId && ctx.permissions.includes('reimbursement.read_own'))
      || (request.createdByUserId === ctx.userId && ctx.permissions.includes('reimbursement.read_related'));
  }

  private appliedResult(action: ReimbursementDraftActionRecord, request: ReimbursementRequestRecord): LineReimbursementDraftResult {
    const receipt = action.resultJson && typeof action.resultJson === 'object' && !Array.isArray(action.resultJson)
      ? action.resultJson as Record<string, unknown> : {};
    return { status: 'applied', receipt: { ...receipt, currentState: request.status, currentRequestUpdatedAt: request.updatedAt.toISOString() } };
  }

  private validationResult(error: unknown, actionId: string, actionRevision = 0, applying = false): LineReimbursementDraftResult {
    const response = (error as { getResponse?: () => unknown })?.getResponse?.();
    const text = typeof response === 'string' ? response : response && typeof response === 'object'
      ? String((response as Record<string, unknown>)['code'] ?? (response as Record<string, unknown>)['message'] ?? '') : error instanceof Error ? error.message : '';
    if (/target_missing/.test(text)) return { status: 'needs_target', actionId, actionRevision };
    if (/changed|stale|state_not_editable|policy/.test(text)) return { status: 'stale', actionId, errorCode: /state_not_editable/.test(text) ? 'state_not_editable' : 'source_changed' };
    if (applying && /source|attachment|evidence/.test(text)) return { status: 'stale', actionId, errorCode: 'source_changed' };
    if (/permission|forbidden|Cannot|outside your assigned/.test(text)) return { status: 'blocked', errorCode: 'forbidden' };
    if (/too_long|MaxLength/.test(text)) return { status: 'blocked', errorCode: 'field_too_long' };
    return { status: 'blocked', errorCode: /source|attachment|evidence/.test(text) ? 'invalid_source' : 'invalid_field' };
  }

  private isUnknownStoreError(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return typeof code === 'string' && ['P1001', 'P1002', 'P1017', 'P2024'].includes(code);
  }

  private inputLimitError(input: CreateReimbursementRequestInput | UpdateReimbursementDraftInput): LineReimbursementDraftResult | null {
    const tooLong = (fieldPath: string, value: unknown, limit: number) => typeof value === 'string' && value.length > limit
      ? { status: 'blocked' as const, errorCode: 'field_too_long', fieldPaths: [fieldPath], limit } : null;
    for (const [path, value, limit] of [
      ['title', input.title, 200], ['reason', input.reason, 1_000], ['missingReceiptReason', input.missingReceiptReason, 500],
    ] as const) {
      const error = tooLong(path, value, limit); if (error) return error;
    }
    if (input.reason !== undefined && !input.reason.trim()) return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['reason'] };
    if (input.currency !== undefined && (typeof input.currency !== 'string' || input.currency.length < 1 || input.currency.length > 3)) {
      return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['currency'] };
    }
    const lines = input.lines;
    if (lines !== undefined && (lines.length < 1 || lines.length > 50)) return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['lines'], limit: 50 };
    for (const [index, line] of (lines ?? []).entries()) {
      for (const [field, value, limit] of [
        ['description', line.description, 500], ['purpose', line.purpose, 500], ['categoryKey', line.categoryKey, 80], ['categoryLabel', line.categoryLabel, 160],
      ] as const) {
        const error = tooLong(`lines.${index}.${field}`, value, limit); if (error) return error;
      }
      if (!Number.isSafeInteger(line.lineNo) || line.lineNo < 1 || line.lineNo > 50 || !line.description?.trim()
        || !line.categoryKey?.trim() || !CIVIL_DATE.test(line.incurredDate) || !MONEY.test(line.amount)
        || (line.attachmentId != null && (typeof line.attachmentId !== 'string' || line.attachmentId.length < 1 || line.attachmentId.length > 64))
        || (line.linkedExpenseId != null && (typeof line.linkedExpenseId !== 'string' || line.linkedExpenseId.length < 1 || line.linkedExpenseId.length > 64))) {
        return { status: 'blocked', errorCode: 'invalid_field', fieldPaths: [`lines.${index}`] };
      }
    }
    return null;
  }

  private async rateLimited(ctx: RequestContext): Promise<boolean> {
    if (!this.rateLimits) return false;
    const decision = await this.rateLimits.consume(PREVIEW_RATE_SCOPE, `${ctx.companyId}:${ctx.userId}`,
      PREVIEW_RATE_MAX, PREVIEW_RATE_WINDOW_SECONDS, 'degrade-to-local');
    return !decision.allowed;
  }

  private validSourceProof(value: unknown): boolean {
    if (!record(value) || !exactKeys(value, ['schemaVersion', 'receipts']) || value['schemaVersion'] !== 1
      || !Array.isArray(value['receipts']) || value['receipts'].length < 1 || value['receipts'].length > 400) return false;
    const seen = new Set<string>();
    for (const receipt of value['receipts']) {
      if (!record(receipt) || !exactKeys(receipt, ['fieldPath', 'valueDigest', 'proof', 'validatedAt'])
        || typeof receipt['fieldPath'] !== 'string' || receipt['fieldPath'].length < 1 || receipt['fieldPath'].length > 200
        || !/^[A-Za-z0-9_.\[\]-]+$/.test(receipt['fieldPath']) || seen.has(receipt['fieldPath'])
        || typeof receipt['valueDigest'] !== 'string' || !HASH.test(receipt['valueDigest'])
        || typeof receipt['validatedAt'] !== 'string' || !Number.isFinite(Date.parse(receipt['validatedAt']))
        || !this.validFieldProof(receipt['proof'])) return false;
      seen.add(receipt['fieldPath']);
    }
    return true;
  }

  private validFieldProof(value: unknown): boolean {
    if (!record(value) || typeof value['kind'] !== 'string') return false;
    if (value['kind'] === 'USER_TEXT') return exactKeys(value, ['kind', 'refs', 'candidateId']) && Array.isArray(value['refs'])
      && value['refs'].length >= 1 && value['refs'].length <= 8 && value['refs'].every((ref) => record(ref)
        && exactKeys(ref, ['partId', 'startUtf16', 'endUtf16', 'rawSha256']) && typeof ref['partId'] === 'string'
        && ref['partId'].length >= 1 && ref['partId'].length <= 128 && Number.isSafeInteger(ref['startUtf16'])
        && Number.isSafeInteger(ref['endUtf16']) && Number(ref['startUtf16']) >= 0 && Number(ref['endUtf16']) > Number(ref['startUtf16'])
        && typeof ref['rawSha256'] === 'string' && HASH.test(ref['rawSha256']))
      && (value['candidateId'] === undefined || typeof value['candidateId'] === 'string' && HASH.test(value['candidateId']));
    if (value['kind'] === 'RECORD') return exactKeys(value, ['kind', 'recordRef', 'revision', 'fieldPath'])
      && ['recordRef', 'revision', 'fieldPath'].every((key) => typeof value[key] === 'string' && (value[key] as string).length >= 1 && (value[key] as string).length <= 200);
    if (value['kind'] === 'ATTACHMENT') return exactKeys(value, ['kind', 'attachmentRef', 'revision', 'page', 'extractionRef', 'fieldPath'])
      && ['attachmentRef', 'revision', 'extractionRef', 'fieldPath'].every((key) => typeof value[key] === 'string' && (value[key] as string).length >= 1 && (value[key] as string).length <= 200)
      && Number.isSafeInteger(value['page']) && Number(value['page']) >= 1 && Number(value['page']) <= 10_000;
    if (value['kind'] === 'USER_CHOICE') return exactKeys(value, ['kind', 'choiceId', 'choiceRevision'])
      && ['choiceId', 'choiceRevision'].every((key) => typeof value[key] === 'string' && (value[key] as string).length >= 1 && (value[key] as string).length <= 200);
    return value['kind'] === 'SERVER_DEFAULT' && exactKeys(value, ['kind', 'key'])
      && ['ACTOR_AS_REQUESTER', 'COMPANY_CURRENCY'].includes(String(value['key']));
  }

  private toLineInputs(lines: ReimbursementLineRecord[]): ReimbursementLineInput[] {
    return lines.map((line) => ({ lineNo: line.lineNo, incurredDate: line.incurredDate.toISOString().slice(0, 10), description: line.description,
      ...(line.purpose ? { purpose: line.purpose } : {}), categoryKey: line.categoryKey,
      ...(line.categoryLabelSnapshot ? { categoryLabel: line.categoryLabelSnapshot } : {}), amount: line.amount,
      attachmentId: line.attachmentId ?? null, linkedExpenseId: line.linkedExpenseId ?? null,
      ...(line.sourceExpenseSnapshot ? { sourceExpenseUpdatedAt: line.sourceExpenseSnapshot.expenseUpdatedAt } : {}) }));
  }

  private toLineWrites(lines: ReimbursementLineRecord[]): ReimbursementLineWriteData[] {
    return lines.map((line) => ({ lineNo: line.lineNo, incurredDate: line.incurredDate, description: line.description,
      purpose: line.purpose ?? null, categoryKey: line.categoryKey, categoryLabelSnapshot: line.categoryLabelSnapshot ?? null,
      amount: line.amount, attachmentId: line.attachmentId ?? null, linkedExpenseId: line.linkedExpenseId ?? null,
      sourceExpenseSnapshot: line.sourceExpenseSnapshot, attachmentSnapshot: line.attachmentSnapshot }));
  }

  private toComparableLines(lines: ReimbursementLineRecord[]) {
    return this.toComparableWrites(this.toLineWrites(lines));
  }

  private toComparableWrites(lines: ReimbursementLineWriteData[]) {
    return lines.map((line) => ({ ...line, incurredDate: isoDate(line.incurredDate) }));
  }
}
