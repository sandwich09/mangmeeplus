import { createHmac } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DATA_RIGHTS_AUTHORITY_METHODS,
  DATA_RIGHTS_CASE_STATUSES,
  DATA_RIGHTS_CASE_TYPES,
  DATA_RIGHTS_DECISION_CATEGORIES,
  DATA_RIGHTS_DISPOSITIONS,
  DATA_RIGHTS_EVIDENCE_TYPES,
  DATA_RIGHTS_IDENTITY_METHODS,
  DATA_RIGHTS_REQUEST_SOURCES,
  dataRightsAllowedDispositions,
  dataRightsCaseRequiresTenantAuthority,
  dataRightsCaseEvidenceRequirements,
  dataRightsSingleAdminReasonProblem,
  isDataRightsDispositionAllowed,
  normalizeDataRightsSingleAdminReason,
  type DataRightsAuthorityMethod,
  type DataRightsCaseStatus,
  type DataRightsCaseType,
  type DataRightsDecisionCategory,
  type DataRightsDisposition,
  type DataRightsEvidenceType,
  type DataRightsIdentityMethod,
  type DataRightsRequestSource,
  type DataRightsSingleAdminStep,
} from '@watchdog-bms/contracts';
import type { Prisma } from '../../generated/prisma/client';
import { AppConfigService } from '../../common/config/app-config.service';
import { PrismaService } from '../../common/database/prisma.service';
import { canonicalFingerprint } from '../../common/security/canonical-fingerprint';
import { AuditAction } from '../audit/domain/models/audit-action';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { PLATFORM_SEAT_EXEMPT_ROLE } from '../system-partner-management/application/plan-term-limit';

export const DATA_RIGHTS_MANAGE_PERMISSION = 'system.data_rights.manage';
export const DATA_RIGHTS_EVIDENCE_REFERENCE_PATTERN = /^(?:evidence|run|approval|case):\/\/[A-Za-z0-9][A-Za-z0-9._~:/-]{0,479}$/;

const TERMINAL_STATUSES = new Set<DataRightsCaseStatus>([
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'BLOCKED',
  'REJECTED',
  'CANCELLED',
]);
const TERMINAL_STATUS_LIST = [...TERMINAL_STATUSES];
const RESOLVED_STATUS_LIST: DataRightsCaseStatus[] = [
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'REJECTED',
  'CANCELLED',
];
export const DATA_RIGHTS_DUE_FILTERS = ['ALL', 'OVERDUE', 'OPEN', 'RESOLVED'] as const;
export type DataRightsDueFilter = typeof DATA_RIGHTS_DUE_FILTERS[number];
const HASH_REQUIRED_EVIDENCE = new Set<DataRightsEvidenceType>([
  'EXPORT_DELIVERY',
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
  'INDEPENDENT_VERIFICATION',
]);
const EXECUTION_PHASE_EVIDENCE = new Set<DataRightsEvidenceType>([
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
]);
const EVIDENCE_CATEGORY: Partial<Record<DataRightsEvidenceType, DataRightsDecisionCategory>> = {
  ACCESS_REVOCATION: 'MEMBERSHIPS_ACCESS',
  OBJECT_STORAGE_INVENTORY: 'ATTACHMENTS_OBJECT_VERSIONS',
  QUEUE_CACHE_PURGE: 'QUEUES_CACHES',
  PROCESSOR_CONFIRMATION: 'PROCESSORS',
  BACKUP_MANIFEST: 'BACKUPS',
};
const CATEGORY_REQUIRED_EVIDENCE = new Set<DataRightsEvidenceType>([
  'EXPORT_DELIVERY',
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
]);

const CASE_SELECT = {
  id: true,
  requestKey: true,
  caseType: true,
  status: true,
  requestSource: true,
  targetUserId: true,
  companyId: true,
  membershipId: true,
  receivedAt: true,
  dueAt: true,
  createdByUserId: true,
  identityVerifiedAt: true,
  identityVerifiedByUserId: true,
  authorityVerifiedAt: true,
  authorityVerifiedByUserId: true,
  approvedAt: true,
  approvedByUserId: true,
  executionStartedAt: true,
  executionStartedByUserId: true,
  verificationStartedAt: true,
  verificationStartedByUserId: true,
  completedAt: true,
  completedByUserId: true,
  outcomeSummary: true,
  approvalSingleAdmin: true,
  approvalSingleAdminReason: true,
  executionSingleAdmin: true,
  executionSingleAdminReason: true,
  verificationSingleAdmin: true,
  verificationSingleAdminReason: true,
  completionSingleAdmin: true,
  completionSingleAdminReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Tx = Prisma.TransactionClient;
type CaseRow = Prisma.DataRightsCaseGetPayload<{ select: typeof CASE_SELECT }>;
type LatestDecision = {
  disposition: DataRightsDisposition;
  retentionUntil: Date | null;
  accessRestriction: string | null;
};
type LatestDecisions = Map<DataRightsDecisionCategory, LatestDecision>;
type EvidenceRequirement = {
  evidenceType: DataRightsEvidenceType;
  category: DataRightsDecisionCategory | null;
};
/** A step its previous actor took again in single-admin mode (P31 §8). */
type SelfStep = { step: DataRightsSingleAdminStep; reason: string };

export type CreateDataRightsCaseCommand = {
  commandId: string;
  requestKey: string;
  caseType: DataRightsCaseType;
  requestSource: DataRightsRequestSource;
  requesterContact?: string;
  targetUserId?: string;
  companyId?: string;
  membershipId?: string;
  receivedAt?: string;
  dueAt: string;
  priorCaseReference?: string;
};

export type VerificationEvidenceCommand = {
  commandId: string;
  reference: string;
  sha256?: string;
  note?: string;
};

export type VerifyIdentityCommand = VerificationEvidenceCommand & { method: DataRightsIdentityMethod };
export type VerifyAuthorityCommand = VerificationEvidenceCommand & { method: DataRightsAuthorityMethod };

export type RecordDecisionCommand = {
  commandId: string;
  category: DataRightsDecisionCategory;
  disposition: DataRightsDisposition;
  legalBasisCode: string;
  rationale: string;
  retentionUntil?: string;
  accessRestriction?: string;
};

export type RecordEvidenceCommand = VerificationEvidenceCommand & {
  evidenceType: DataRightsEvidenceType;
  category?: DataRightsDecisionCategory;
  /** Only with INDEPENDENT_VERIFICATION recorded by the executor: the explicit single-admin step. */
  singleAdminReason?: string;
};

export type CompleteCaseCommand = {
  commandId: string;
  outcome: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTION';
  outcomeSummary: string;
  singleAdminReason?: string;
};

export type CloseCaseCommand = {
  commandId: string;
  outcome: 'REJECTED' | 'CANCELLED' | 'BLOCKED';
  reason: string;
};

export type ListDataRightsCasesQuery = {
  status?: DataRightsCaseStatus;
  caseType?: DataRightsCaseType;
  companyId?: string;
  targetUserId?: string;
  cursor?: string;
  pageSize?: number;
  dueFilter?: DataRightsDueFilter;
};

type CommandResult = { caseId: string; replayed: boolean; case: Awaited<ReturnType<DataRightsService['readCase']>> };

@Injectable()
export class DataRightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async createCase(ctx: RequestContext, input: CreateDataRightsCaseCommand): Promise<CommandResult> {
    this.assertOperator(ctx);
    this.assertCommandId(input.commandId);
    this.assertOpaqueRequestKey(input.requestKey);
    if (!DATA_RIGHTS_CASE_TYPES.includes(input.caseType)) this.invalid('caseType is invalid');
    if (!DATA_RIGHTS_REQUEST_SOURCES.includes(input.requestSource)) this.invalid('requestSource is invalid');

    const receivedAtInput = input.receivedAt ? this.date(input.receivedAt, 'receivedAt') : null;
    const dueAt = this.date(input.dueAt, 'dueAt');
    const target = this.normalizedTarget(input);
    const priorCaseId = this.priorCaseId(input.priorCaseReference);
    const priorCaseReference = priorCaseId ? `case://${priorCaseId}` : null;
    const requesterContactHashes = this.requesterContactHashes(input.requesterContact);
    const requesterContactHash = requesterContactHashes[0] ?? null;
    const fingerprints = (requesterContactHashes.length ? requesterContactHashes : [null]).map((contactHash) =>
      canonicalFingerprint({
        requestKey: input.requestKey,
        caseType: input.caseType,
        requestSource: input.requestSource,
        requesterContactHash: contactHash,
        ...target,
        // Omitted means "server receipt time"; hashing the generated clock value would make a retry conflict.
        receivedAt: receivedAtInput?.toISOString() ?? null,
        dueAt: dueAt.toISOString(),
        priorCaseReference,
      }));
    const fingerprint = fingerprints[0]!;

    let result: { caseId: string; replayed: boolean };
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        await this.lock(tx, `command:${input.commandId}`);
        const replay = await tx.dataRightsCaseActionRecord.findUnique({ where: { commandId: input.commandId } });
        if (replay) {
          this.assertReplay(replay, ctx, 'CASE_CREATED', fingerprints);
          return { caseId: replay.caseId, replayed: true };
        }

        const receivedAt = receivedAtInput ?? new Date();
        if (dueAt <= receivedAt) this.invalid('dueAt must be after receivedAt');
        if (receivedAt.getTime() > Date.now() + 5 * 60_000) this.invalid('receivedAt cannot be in the future');

        await this.lock(tx, `request:${input.requestKey}`);
        if (await tx.dataRightsCase.findUnique({ where: { requestKey: input.requestKey }, select: { id: true } })) {
          throw new ConflictException({ code: 'data_rights_request_key_conflict', message: 'requestKey is already in use.' });
        }
        for (const key of this.scopeLockKeys(input.caseType, target)) await this.lock(tx, key);
        const activeTargetCase = await tx.dataRightsCase.findFirst({
          where: await this.activeConflictWhere(tx, input.caseType, target),
          select: { id: true, caseType: true },
        });
        if (activeTargetCase) {
          throw new ConflictException({
            code: 'data_rights_active_target_conflict',
            message: 'An overlapping active case already owns this user, membership, or company scope.',
            activeCaseId: activeTargetCase.id,
            activeCaseType: activeTargetCase.caseType,
          });
        }
        await this.assertTargetExists(tx, input.caseType, target);
        if (priorCaseId) {
          await this.lock(tx, `case:${priorCaseId}`);
          const priorCase = await tx.dataRightsCase.findUnique({ where: { id: priorCaseId }, select: CASE_SELECT });
          if (
            !priorCase
            || priorCase.status !== 'BLOCKED'
            || priorCase.caseType !== input.caseType
            || !this.sameTarget(priorCase, target)
          ) {
            throw new UnprocessableEntityException({
              code: 'data_rights_prior_case_invalid',
              message: 'priorCaseReference must identify a BLOCKED case with the same case type and exact target.',
            });
          }
        }

        const created = await tx.dataRightsCase.create({
          data: {
            requestKey: input.requestKey,
            caseType: input.caseType,
            requestSource: input.requestSource,
            requesterContactHash,
            ...target,
            receivedAt,
            dueAt,
            createdByUserId: ctx.userId,
          },
          select: { id: true },
        });
        await this.appendAction(tx, {
          caseId: created.id,
          commandId: input.commandId,
          action: 'CASE_CREATED',
          fromStatus: null,
          toStatus: 'RECEIVED',
          ctx,
          fingerprint,
          metadata: priorCaseReference ? { priorCaseReference } : undefined,
        });
        return { caseId: created.id, replayed: false };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const targetColumns = this.uniqueTargetColumns(error);
        if (targetColumns.includes('requestKey')) {
          throw new ConflictException({ code: 'data_rights_request_key_conflict', message: 'requestKey is already in use.' });
        }
        throw new ConflictException({
          code: 'data_rights_active_target_conflict',
          message: 'An overlapping active case already owns this user, membership, or company scope.',
        });
      }
      throw error;
    }

    return { ...result, case: await this.readCase(result.caseId) };
  }

  async listCases(ctx: RequestContext, query: ListDataRightsCasesQuery) {
    this.assertOperator(ctx);
    if (query.status && !DATA_RIGHTS_CASE_STATUSES.includes(query.status)) this.invalid('status is invalid');
    if (query.caseType && !DATA_RIGHTS_CASE_TYPES.includes(query.caseType)) this.invalid('caseType is invalid');
    if (query.dueFilter && !DATA_RIGHTS_DUE_FILTERS.includes(query.dueFilter)) this.invalid('dueFilter is invalid');
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 100);
    const dueFilter = query.dueFilter ?? 'ALL';
    const filters: Prisma.DataRightsCaseWhereInput[] = [
      ...(query.status ? [{ status: query.status }] : []),
      ...(query.caseType ? [{ caseType: query.caseType }] : []),
      ...(query.companyId ? [{ companyId: query.companyId }] : []),
      ...(query.targetUserId ? [{ targetUserId: query.targetUserId }] : []),
    ];
    if (dueFilter === 'OPEN') filters.push({ status: { notIn: RESOLVED_STATUS_LIST } });
    if (dueFilter === 'OVERDUE') {
      filters.push({ status: { notIn: RESOLVED_STATUS_LIST }, dueAt: { lt: new Date() } });
    }
    if (dueFilter === 'RESOLVED') filters.push({ status: { in: RESOLVED_STATUS_LIST } });
    const rows = await this.prisma.client.dataRightsCase.findMany({
      where: filters.length ? { AND: filters } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: CASE_SELECT,
    });
    const items = rows.slice(0, pageSize);
    return { items, nextCursor: rows.length > pageSize ? items.at(-1)?.id ?? null : null };
  }

  async getCase(ctx: RequestContext, caseId: string) {
    this.assertOperator(ctx);
    return this.readCase(caseId);
  }

  async verifyIdentity(ctx: RequestContext, caseId: string, input: VerifyIdentityCommand): Promise<CommandResult> {
    if (!DATA_RIGHTS_IDENTITY_METHODS.includes(input.method)) this.invalid('identity verification method is invalid');
    const evidence = this.verificationEvidence(input);
    return this.caseCommand(ctx, caseId, input.commandId, 'IDENTITY_VERIFIED', {
      method: input.method,
      ...evidence.fingerprint,
    }, async (tx, row) => {
      this.assertStatus(row, ['RECEIVED']);
      await tx.dataRightsEvidenceRecord.create({ data: {
        caseId,
        evidenceType: 'IDENTITY_VERIFICATION',
        reference: evidence.reference,
        sha256: evidence.sha256,
        note: evidence.note,
        recordedByUserId: ctx.userId,
      } });
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        status: 'IDENTITY_VERIFIED',
        identityVerifiedAt: new Date(),
        identityVerifiedByUserId: ctx.userId,
      } });
      return { toStatus: 'IDENTITY_VERIFIED' as const, metadata: { method: input.method } };
    });
  }

  async verifyAuthority(ctx: RequestContext, caseId: string, input: VerifyAuthorityCommand): Promise<CommandResult> {
    if (!DATA_RIGHTS_AUTHORITY_METHODS.includes(input.method) || input.method === 'NOT_REQUIRED') {
      this.invalid('a tenant authority verification method is required');
    }
    const evidence = this.verificationEvidence(input);
    return this.caseCommand(ctx, caseId, input.commandId, 'AUTHORITY_VERIFIED', {
      method: input.method,
      ...evidence.fingerprint,
    }, async (tx, row) => {
      this.assertStatus(row, ['IDENTITY_VERIFIED']);
      if (!dataRightsCaseRequiresTenantAuthority(row.caseType as DataRightsCaseType)) {
        this.invalid('tenant authority verification is not required for this case type');
      }
      if (row.authorityVerifiedAt) throw new ConflictException('Tenant authority is already verified.');
      await tx.dataRightsEvidenceRecord.create({ data: {
        caseId,
        evidenceType: 'AUTHORITY_VERIFICATION',
        reference: evidence.reference,
        sha256: evidence.sha256,
        note: evidence.note,
        recordedByUserId: ctx.userId,
      } });
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        authorityVerifiedAt: new Date(),
        authorityVerifiedByUserId: ctx.userId,
      } });
      return { toStatus: row.status, metadata: { method: input.method } };
    });
  }

  async beginRetentionReview(ctx: RequestContext, caseId: string, commandId: string): Promise<CommandResult> {
    return this.caseCommand(ctx, caseId, commandId, 'RETENTION_REVIEW_STARTED', {}, async (tx, row) => {
      this.assertStatus(row, ['IDENTITY_VERIFIED']);
      if (!row.identityVerifiedAt) this.invalid('identity verification is required');
      if (dataRightsCaseRequiresTenantAuthority(row.caseType as DataRightsCaseType) && !row.authorityVerifiedAt) {
        this.invalid('tenant authority verification is required');
      }
      await tx.dataRightsCase.update({ where: { id: caseId }, data: { status: 'RETENTION_REVIEW' } });
      return { toStatus: 'RETENTION_REVIEW' as const };
    });
  }

  async recordDecision(ctx: RequestContext, caseId: string, input: RecordDecisionCommand): Promise<CommandResult> {
    if (!DATA_RIGHTS_DECISION_CATEGORIES.includes(input.category)) this.invalid('decision category is invalid');
    if (!DATA_RIGHTS_DISPOSITIONS.includes(input.disposition)) this.invalid('disposition is invalid');
    const legalBasisCode = this.requiredText(input.legalBasisCode, 'legalBasisCode', 120);
    const rationale = this.requiredText(input.rationale, 'rationale', 4_000);
    const keepsData = input.disposition === 'RETAIN' || input.disposition === 'RESTRICT';
    const retentionUntil = input.retentionUntil ? this.date(input.retentionUntil, 'retentionUntil') : null;
    const accessRestriction = input.accessRestriction?.trim() || null;
    if (keepsData && (!retentionUntil || !accessRestriction)) {
      this.invalid('RETAIN and RESTRICT decisions require retentionUntil and accessRestriction');
    }
    if (keepsData && retentionUntil! <= new Date()) {
      this.invalid('retentionUntil must be a future review/end date');
    }
    if (!keepsData && (retentionUntil || accessRestriction)) {
      this.invalid('retentionUntil and accessRestriction are only valid for RETAIN or RESTRICT decisions');
    }

    return this.caseCommand(ctx, caseId, input.commandId, 'DECISION_RECORDED', {
      category: input.category,
      disposition: input.disposition,
      legalBasisCode,
      rationale,
      retentionUntil: retentionUntil?.toISOString() ?? null,
      accessRestriction,
    }, async (tx, row) => {
      this.assertStatus(row, ['RETENTION_REVIEW']);
      this.assertDecisionAllowed(row.caseType as DataRightsCaseType, input.category, input.disposition);
      const latest = await tx.dataRightsDecisionRecord.findFirst({
        where: { caseId, category: input.category },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      const revision = (latest?.revision ?? 0) + 1;
      await tx.dataRightsDecisionRecord.create({ data: {
        caseId,
        revision,
        category: input.category,
        disposition: input.disposition,
        legalBasisCode,
        rationale,
        retentionUntil,
        accessRestriction,
        recordedByUserId: ctx.userId,
      } });
      return { toStatus: row.status, metadata: { category: input.category, revision } };
    });
  }

  async recordEvidence(ctx: RequestContext, caseId: string, input: RecordEvidenceCommand): Promise<CommandResult> {
    if (!DATA_RIGHTS_EVIDENCE_TYPES.includes(input.evidenceType)) this.invalid('evidenceType is invalid');
    if (input.evidenceType === 'IDENTITY_VERIFICATION' || input.evidenceType === 'AUTHORITY_VERIFICATION') {
      this.invalid('identity and authority evidence must use their dedicated atomic verification commands');
    }
    if (input.category && !DATA_RIGHTS_DECISION_CATEGORIES.includes(input.category)) this.invalid('category is invalid');
    const requiredCategory = EVIDENCE_CATEGORY[input.evidenceType];
    if (requiredCategory && input.category !== requiredCategory) {
      this.invalid(`${input.evidenceType} evidence requires category ${requiredCategory}`);
    }
    if (CATEGORY_REQUIRED_EVIDENCE.has(input.evidenceType) && !input.category) {
      this.invalid(`${input.evidenceType} evidence requires category`);
    }
    if (input.evidenceType === 'INDEPENDENT_VERIFICATION' && input.category) {
      this.invalid('INDEPENDENT_VERIFICATION evidence must not have a category');
    }
    const evidence = this.verificationEvidence(input);
    if (HASH_REQUIRED_EVIDENCE.has(input.evidenceType) && !evidence.sha256) {
      this.invalid(`${input.evidenceType} evidence requires sha256`);
    }
    return this.caseCommand(ctx, caseId, input.commandId, 'EVIDENCE_RECORDED', {
      evidenceType: input.evidenceType,
      category: input.category ?? null,
      ...evidence.fingerprint,
      ...this.singleAdminFingerprint(input.singleAdminReason),
    }, async (tx, row) => {
      if (TERMINAL_STATUSES.has(row.status as DataRightsCaseStatus)) {
        throw new ConflictException(`Case ${caseId} is already terminal.`);
      }
      if (input.evidenceType === 'EXPORT_DELIVERY') {
        this.assertStatus(row, ['RETENTION_REVIEW', 'APPROVED', 'EXECUTING']);
      } else if (EXECUTION_PHASE_EVIDENCE.has(input.evidenceType)) {
        this.assertStatus(row, ['EXECUTING']);
      } else if (input.evidenceType === 'INDEPENDENT_VERIFICATION') {
        this.assertStatus(row, ['VERIFICATION']);
      }
      const selfStep = await this.selfStep(
        tx, ctx, 'INDEPENDENT_VERIFICATION',
        input.evidenceType === 'INDEPENDENT_VERIFICATION' && row.executionStartedByUserId === ctx.userId,
        input.singleAdminReason, 'The executor cannot record independent verification.',
      );
      const decisions = await this.latestDecisions(tx, caseId);
      this.assertEvidenceMatchesDecision(
        row.caseType as DataRightsCaseType,
        input.evidenceType,
        input.category ?? null,
        decisions,
      );
      await tx.dataRightsEvidenceRecord.create({ data: {
        caseId,
        evidenceType: input.evidenceType,
        category: input.category ?? null,
        reference: evidence.reference,
        sha256: evidence.sha256,
        note: evidence.note,
        recordedByUserId: ctx.userId,
        ...(selfStep && { singleAdmin: true, singleAdminReason: selfStep.reason }),
      } });
      return {
        toStatus: row.status,
        metadata: { evidenceType: input.evidenceType, category: input.category ?? null },
        selfStep,
      };
    });
  }

  async approve(ctx: RequestContext, caseId: string, commandId: string, singleAdminReason?: string): Promise<CommandResult> {
    return this.caseCommand(ctx, caseId, commandId, 'APPROVED', this.singleAdminFingerprint(singleAdminReason), async (tx, row) => {
      this.assertStatus(row, ['RETENTION_REVIEW']);
      if (!row.identityVerifiedAt) this.invalid('identity verification is required');
      if (dataRightsCaseRequiresTenantAuthority(row.caseType as DataRightsCaseType) && !row.authorityVerifiedAt) {
        this.invalid('tenant authority verification is required');
      }
      const decisions = await this.latestDecisions(tx, caseId);
      const missing = DATA_RIGHTS_DECISION_CATEGORIES.filter((category) => !decisions.has(category));
      if (missing.length) {
        throw new UnprocessableEntityException({
          code: 'data_rights_decisions_incomplete',
          message: 'Every data category needs a current retention/disposition decision before approval.',
          missingCategories: missing,
        });
      }
      for (const [category, decision] of decisions) {
        this.assertDecisionAllowed(row.caseType as DataRightsCaseType, category, decision.disposition);
      }
      this.assertRetentionDatesCurrent(decisions);
      const selfStep = await this.selfStep(
        tx, ctx, 'APPROVAL', row.createdByUserId === ctx.userId, singleAdminReason,
        'The case creator cannot approve the data-rights case.',
      );
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        status: 'APPROVED', approvedAt: new Date(), approvedByUserId: ctx.userId,
        ...(selfStep && { approvalSingleAdmin: true, approvalSingleAdminReason: selfStep.reason }),
      } });
      return { toStatus: 'APPROVED' as const, selfStep };
    });
  }

  /**
   * A control point, not an execution engine: it stamps the operator and opens the evidence phase.
   * Nothing here or in any later step reads, moves or removes the target's data.
   */
  async startExecution(ctx: RequestContext, caseId: string, commandId: string, singleAdminReason?: string): Promise<CommandResult> {
    return this.caseCommand(ctx, caseId, commandId, 'EXECUTION_STARTED', this.singleAdminFingerprint(singleAdminReason), async (tx, row) => {
      this.assertStatus(row, ['APPROVED']);
      const decisions = await this.latestDecisions(tx, caseId);
      for (const [category, decision] of decisions) {
        this.assertDecisionAllowed(row.caseType as DataRightsCaseType, category, decision.disposition);
      }
      this.assertRetentionDatesCurrent(decisions);
      const selfStep = await this.selfStep(
        tx, ctx, 'EXECUTION', row.approvedByUserId === ctx.userId, singleAdminReason,
        'The approver cannot execute the data-rights case.',
      );
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        status: 'EXECUTING', executionStartedAt: new Date(), executionStartedByUserId: ctx.userId,
        ...(selfStep && { executionSingleAdmin: true, executionSingleAdminReason: selfStep.reason }),
      } });
      return { toStatus: 'EXECUTING' as const, selfStep };
    });
  }

  async startVerification(ctx: RequestContext, caseId: string, commandId: string, singleAdminReason?: string): Promise<CommandResult> {
    return this.caseCommand(ctx, caseId, commandId, 'VERIFICATION_STARTED', this.singleAdminFingerprint(singleAdminReason), async (tx, row) => {
      this.assertStatus(row, ['EXECUTING']);
      await this.assertExecutionEvidence(tx, row, false);
      const selfStep = await this.selfStep(
        tx, ctx, 'VERIFICATION', row.executionStartedByUserId === ctx.userId, singleAdminReason,
        'The executor cannot start verification of the data-rights case.',
      );
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        status: 'VERIFICATION', verificationStartedAt: new Date(), verificationStartedByUserId: ctx.userId,
        ...(selfStep && { verificationSingleAdmin: true, verificationSingleAdminReason: selfStep.reason }),
      } });
      return { toStatus: 'VERIFICATION' as const, selfStep };
    });
  }

  async complete(ctx: RequestContext, caseId: string, input: CompleteCaseCommand): Promise<CommandResult> {
    if (!['COMPLETED', 'COMPLETED_WITH_EXCEPTION'].includes(input.outcome)) this.invalid('completion outcome is invalid');
    const outcomeSummary = this.requiredText(input.outcomeSummary, 'outcomeSummary', 4_000);
    return this.caseCommand(ctx, caseId, input.commandId, 'CASE_COMPLETED', {
      outcome: input.outcome,
      outcomeSummary,
      ...this.singleAdminFingerprint(input.singleAdminReason),
    }, async (tx, row) => {
      this.assertStatus(row, ['VERIFICATION']);
      const { evidence, decisions } = await this.assertExecutionEvidence(tx, row, true);
      const hasRetentionException = [...decisions.values()].some(
        (decision) => decision.disposition === 'RETAIN' || decision.disposition === 'RESTRICT',
      );
      if (hasRetentionException && input.outcome !== 'COMPLETED_WITH_EXCEPTION') {
        this.invalid('retained or restricted data requires COMPLETED_WITH_EXCEPTION');
      }
      if (!hasRetentionException && input.outcome === 'COMPLETED_WITH_EXCEPTION') {
        this.invalid('COMPLETED_WITH_EXCEPTION requires a current RETAIN or RESTRICT decision');
      }
      const selfStep = await this.selfStep(
        tx, ctx, 'COMPLETION', row.executionStartedByUserId === ctx.userId, input.singleAdminReason,
        'The executor cannot complete verification of the data-rights case.',
      );
      if (!evidence.some((item) =>
        item.evidenceType === 'INDEPENDENT_VERIFICATION'
        && item.category === null
        && item.recordedByUserId === ctx.userId,
      )) {
        this.invalid('the completing verifier must record INDEPENDENT_VERIFICATION evidence');
      }
      await tx.dataRightsCase.update({ where: { id: caseId }, data: {
        status: input.outcome,
        completedAt: new Date(),
        completedByUserId: ctx.userId,
        outcomeSummary,
        ...(selfStep && { completionSingleAdmin: true, completionSingleAdminReason: selfStep.reason }),
      } });
      return { toStatus: input.outcome, metadata: { outcome: input.outcome }, selfStep };
    });
  }

  async close(ctx: RequestContext, caseId: string, input: CloseCaseCommand): Promise<CommandResult> {
    if (!['REJECTED', 'CANCELLED', 'BLOCKED'].includes(input.outcome)) this.invalid('close outcome is invalid');
    const reason = this.requiredText(input.reason, 'reason', 4_000);
    return this.caseCommand(ctx, caseId, input.commandId, `CASE_${input.outcome}`, {
      outcome: input.outcome,
      reason,
    }, async (tx, row) => {
      const allowed: DataRightsCaseStatus[] = input.outcome === 'REJECTED'
        ? ['RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW']
        : input.outcome === 'CANCELLED'
          ? ['RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW', 'APPROVED']
          : ['APPROVED', 'EXECUTING', 'VERIFICATION'];
      this.assertStatus(row, allowed);
      await tx.dataRightsCase.update({ where: { id: caseId }, data: { status: input.outcome, outcomeSummary: reason } });
      return { toStatus: input.outcome, metadata: { outcome: input.outcome } };
    });
  }

  private async caseCommand(
    ctx: RequestContext,
    caseId: string,
    commandId: string,
    action: string,
    payload: Record<string, unknown>,
    mutate: (tx: Tx, row: CaseRow) => Promise<{
      toStatus: DataRightsCaseStatus;
      metadata?: Record<string, unknown>;
      selfStep?: SelfStep | null;
    }>,
  ): Promise<CommandResult> {
    this.assertOperator(ctx);
    this.assertCommandId(commandId);
    const fingerprint = canonicalFingerprint(payload);
    const result = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx, `command:${commandId}`);
      const replay = await tx.dataRightsCaseActionRecord.findUnique({ where: { commandId } });
      if (replay) {
        this.assertReplay(replay, ctx, action, fingerprint, caseId);
        return { caseId, replayed: true };
      }
      await this.lock(tx, `case:${caseId}`);
      const row = await tx.dataRightsCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
      if (!row) throw new NotFoundException(`Data-rights case ${caseId} was not found.`);
      const mutation = await mutate(tx, row);
      const selfStep = mutation.selfStep ?? null;
      // Written last, once the step itself has succeeded: its own audit row, and the label the
      // case history shows.
      if (selfStep) {
        await tx.auditLog.create({ data: {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: AuditAction.SYSTEM_DATA_RIGHTS_SINGLE_ADMIN_STEP,
          targetType: 'DataRightsCase',
          targetId: caseId,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'CRITICAL',
          metadataJson: { step: selfStep.step, reason: selfStep.reason, commandId },
        } });
      }
      await this.appendAction(tx, {
        caseId,
        commandId,
        action,
        fromStatus: row.status as DataRightsCaseStatus,
        toStatus: mutation.toStatus,
        ctx,
        fingerprint,
        metadata: selfStep
          ? { ...mutation.metadata, singleAdmin: true, singleAdminReason: selfStep.reason }
          : mutation.metadata,
      });
      return { caseId, replayed: false };
    });
    return { ...result, case: await this.readCase(caseId) };
  }

  private async readCase(caseId: string) {
    const row = await this.prisma.client.dataRightsCase.findUnique({
      where: { id: caseId },
      select: {
        ...CASE_SELECT,
        decisions: { orderBy: [{ category: 'asc' }, { revision: 'desc' }], select: {
          id: true, revision: true, category: true, disposition: true, legalBasisCode: true,
          rationale: true, retentionUntil: true, accessRestriction: true, recordedByUserId: true, recordedAt: true,
        } },
        evidence: { orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }], select: {
          id: true, evidenceType: true, category: true, reference: true, sha256: true, note: true,
          recordedByUserId: true, recordedAt: true, singleAdmin: true, singleAdminReason: true,
        } },
        actions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: {
          id: true, commandId: true, action: true, fromStatus: true, toStatus: true,
          actorUserId: true, requestId: true, metadataJson: true, createdAt: true,
        } },
      },
    });
    if (!row) throw new NotFoundException(`Data-rights case ${caseId} was not found.`);
    // Tells the page which control to offer for a step the reader took before: the explicit
    // self-step, or the refusal that names a second person. The step itself re-checks in its
    // own transaction.
    const singleAdminAvailable = (await this.activeSystemAdminUserIds(this.prisma.client)).length === 1;
    return { ...row, singleAdminAvailable };
  }

  /**
   * Everyone who could be the second pair of eyes: an active person holding the SYSTEM-owned System
   * Admin role through an active membership of an active company. A company role that merely carries
   * the key is not one (`PLATFORM_SEAT_EXEMPT_ROLE`).
   *
   * An account whose sign-in was disabled is not a person who could take the step. The System Admin
   * cutover retires an admin exactly that way: the protected user, membership and role rows stay and
   * the credential becomes DISABLED (`prisma/system-admin-cutover.ts`). Production has such an
   * account, so counting it would close the single-admin path for the one admin who is left.
   */
  private async activeSystemAdminUserIds(db: Pick<Tx, 'companyMembership'>): Promise<string[]> {
    const rows = await db.companyMembership.findMany({
      where: {
        status: 'ACTIVE',
        user: { status: 'ACTIVE', credential: { isNot: { status: 'DISABLED' } } },
        company: { status: 'ACTIVE' },
        roles: { some: { role: PLATFORM_SEAT_EXEMPT_ROLE } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  /** A retry must carry the same reason: it is part of what the command did. */
  private singleAdminFingerprint(reason: string | undefined): { singleAdminReason?: string } {
    return reason === undefined ? {} : { singleAdminReason: normalizeDataRightsSingleAdminReason(reason) };
  }

  /**
   * P31 §8 single-admin mode. Five steps are refused to the person who took the step before.
   * While that person is the platform's ONE active System Admin they may take the step as an
   * explicit self-step: a reason that says something, a marker stored with the step and an audit
   * row of its own (`caseCommand` writes that row and the history label once the step succeeds).
   * With a second active System Admin the separation rule stands, because the second person
   * exists and takes the step. Every caller gets here only after the completeness checks of its
   * step, so a self-step never skips what a second person would have looked at.
   *
   * Returns null for two different people, and the reason to store for a self-step. The database
   * repeats the rule: it refuses a same-person step whose row lacks the marker and reason.
   */
  private async selfStep(
    tx: Tx,
    ctx: RequestContext,
    step: DataRightsSingleAdminStep,
    samePerson: boolean,
    reasonInput: string | undefined,
    separationRule: string,
  ): Promise<SelfStep | null> {
    if (!samePerson) {
      if (reasonInput !== undefined) {
        throw new UnprocessableEntityException({
          code: 'data_rights_single_admin_not_applicable',
          message: 'A single-admin reason is only accepted for a step taken by the person who took the step before.',
        });
      }
      return null;
    }
    const admins = await this.activeSystemAdminUserIds(tx);
    if (admins.length !== 1 || admins[0] !== ctx.userId) {
      throw new ForbiddenException({ code: 'data_rights_second_admin_required', message: separationRule, step });
    }
    const problem = dataRightsSingleAdminReasonProblem(reasonInput);
    if (problem === 'REQUIRED') {
      throw new UnprocessableEntityException({
        code: 'data_rights_single_admin_reason_required',
        message: 'The only active System Admin may take this step alone, as an explicit single-admin step with a reason.',
        step,
      });
    }
    if (problem) {
      throw new UnprocessableEntityException({
        code: 'data_rights_single_admin_reason_invalid',
        message: 'The single-admin reason must be a real sentence of 20 to 1000 characters.',
        step,
        problem,
      });
    }
    return { step, reason: normalizeDataRightsSingleAdminReason(reasonInput!) };
  }

  private async latestDecisions(tx: Tx, caseId: string) {
    const rows = await tx.dataRightsDecisionRecord.findMany({
      where: { caseId },
      orderBy: { revision: 'desc' },
      select: { category: true, disposition: true, retentionUntil: true, accessRestriction: true },
    });
    const latest: LatestDecisions = new Map();
    for (const row of rows) {
      const category = row.category as DataRightsDecisionCategory;
      if (!latest.has(category)) latest.set(category, {
        disposition: row.disposition as DataRightsDisposition,
        retentionUntil: row.retentionUntil,
        accessRestriction: row.accessRestriction,
      });
    }
    return latest;
  }

  private assertDecisionAllowed(
    caseType: DataRightsCaseType,
    category: DataRightsDecisionCategory,
    disposition: DataRightsDisposition,
  ) {
    if (!isDataRightsDispositionAllowed(caseType, category, disposition)) {
      throw new UnprocessableEntityException({
        code: 'data_rights_disposition_out_of_scope',
        message: `${disposition} is outside the ${caseType} scope for ${category}.`,
        caseType,
        category,
        disposition,
        allowedDispositions: dataRightsAllowedDispositions(caseType, category),
      });
    }
  }

  private assertRetentionDatesCurrent(decisions: LatestDecisions) {
    const now = new Date();
    const expired = [...decisions.entries()]
      .filter(([, decision]) => decision.disposition === 'RETAIN' || decision.disposition === 'RESTRICT')
      .filter(([, decision]) => !decision.retentionUntil || decision.retentionUntil <= now || !decision.accessRestriction?.trim())
      .map(([category]) => category);
    if (expired.length) {
      throw new UnprocessableEntityException({
        code: 'data_rights_retention_review_expired',
        message: 'Retained/restricted categories require a future review/end date and a non-blank access restriction.',
        categories: expired,
      });
    }
  }

  private assertEvidenceMatchesDecision(
    caseType: DataRightsCaseType,
    evidenceType: DataRightsEvidenceType,
    category: DataRightsDecisionCategory | null,
    decisions: LatestDecisions,
  ) {
    if (evidenceType === 'INDEPENDENT_VERIFICATION') return;
    const valid = category !== null && dataRightsCaseEvidenceRequirements(
      caseType,
      [...decisions].map(([decisionCategory, decision]) => ({ category: decisionCategory, disposition: decision.disposition })),
    ).some((requirement) => requirement.evidenceType === evidenceType && requirement.category === category);
    if (!valid) {
      this.invalid(`${evidenceType} evidence does not match the latest decision for ${category ?? 'no category'}`);
    }
  }

  private async assertExecutionEvidence(tx: Tx, row: CaseRow, completing: boolean) {
    const [decisions, evidence] = await Promise.all([
      this.latestDecisions(tx, row.id),
      tx.dataRightsEvidenceRecord.findMany({
        where: { caseId: row.id },
        select: { evidenceType: true, category: true, sha256: true, recordedByUserId: true },
      }),
    ]);
    this.assertRetentionDatesCurrent(decisions);
    const required: EvidenceRequirement[] = dataRightsCaseEvidenceRequirements(
      row.caseType as DataRightsCaseType,
      [...decisions].map(([category, decision]) => ({ category, disposition: decision.disposition })),
    );
    if (completing) required.push({ evidenceType: 'INDEPENDENT_VERIFICATION', category: null });
    const missing = required.filter((requirement) => !evidence.some((item) =>
      item.evidenceType === requirement.evidenceType
      && (item.category ?? null) === requirement.category
      && typeof item.sha256 === 'string'
      && /^[0-9a-f]{64}$/.test(item.sha256),
    ));
    if (missing.length) {
      throw new UnprocessableEntityException({
        code: completing ? 'data_rights_completion_evidence_incomplete' : 'data_rights_execution_evidence_incomplete',
        message: 'Required evidence is incomplete for this transition.',
        missingEvidence: missing,
      });
    }
    return { evidence, decisions };
  }

  private async assertTargetExists(
    tx: Tx,
    caseType: DataRightsCaseType,
    target: { targetUserId: string | null; companyId: string | null; membershipId: string | null },
  ) {
    if (caseType === 'USER_ACCOUNT_ERASURE') {
      if (!await tx.user.findUnique({ where: { id: target.targetUserId! }, select: { id: true } })) {
        throw new NotFoundException('Target user was not found.');
      }
      return;
    }
    if (!await tx.company.findUnique({ where: { id: target.companyId! }, select: { id: true } })) {
      throw new NotFoundException('Target company was not found.');
    }
    if (caseType === 'MEMBERSHIP_EXIT') {
      const membership = await tx.companyMembership.findUnique({
        where: { id: target.membershipId! }, select: { id: true, companyId: true, userId: true },
      });
      if (!membership || membership.companyId !== target.companyId || membership.userId !== target.targetUserId) {
        this.invalid('membershipId must belong to the target user and company');
      }
    }
  }

  private normalizedTarget(input: CreateDataRightsCaseCommand) {
    const targetUserId = input.targetUserId?.trim() || null;
    const companyId = input.companyId?.trim() || null;
    const membershipId = input.membershipId?.trim() || null;
    if (input.caseType === 'USER_ACCOUNT_ERASURE' && (!targetUserId || companyId || membershipId)) {
      this.invalid('user erasure requires targetUserId only');
    }
    if (input.caseType === 'MEMBERSHIP_EXIT' && (!targetUserId || !companyId || !membershipId)) {
      this.invalid('membership exit requires targetUserId, companyId and membershipId');
    }
    if (input.caseType === 'COMPANY_WORKSPACE_OFFBOARDING' && (!companyId || targetUserId || membershipId)) {
      this.invalid('company workspace offboarding requires companyId only');
    }
    return { targetUserId, companyId, membershipId };
  }

  private scopeLockKeys(
    caseType: DataRightsCaseType,
    target: { targetUserId: string | null; companyId: string | null; membershipId: string | null },
  ): string[] {
    const keys = caseType === 'USER_ACCOUNT_ERASURE'
      ? ['scope:global', `scope:user:${target.targetUserId}`]
      : caseType === 'MEMBERSHIP_EXIT'
        ? [
            'scope:global',
            `scope:company:${target.companyId}`,
            `scope:membership:${target.membershipId}`,
            `scope:user:${target.targetUserId}`,
          ]
        : ['scope:global', `scope:company:${target.companyId}`];
    return keys.sort();
  }

  private async activeConflictWhere(
    tx: Tx,
    caseType: DataRightsCaseType,
    target: { targetUserId: string | null; companyId: string | null; membershipId: string | null },
  ): Promise<Prisma.DataRightsCaseWhereInput> {
    let overlappingScopes: Prisma.DataRightsCaseWhereInput[];
    if (caseType === 'USER_ACCOUNT_ERASURE') {
      const memberships = await tx.companyMembership.findMany({
        where: { userId: target.targetUserId! },
        select: { companyId: true },
      });
      const companyIds = memberships.map((membership) => membership.companyId);
      overlappingScopes = [
        { caseType: 'USER_ACCOUNT_ERASURE', targetUserId: target.targetUserId },
        { caseType: 'MEMBERSHIP_EXIT', targetUserId: target.targetUserId },
        ...(companyIds.length
          ? [{ caseType: 'COMPANY_WORKSPACE_OFFBOARDING' as const, companyId: { in: companyIds } }]
          : []),
      ];
    } else if (caseType === 'MEMBERSHIP_EXIT') {
      overlappingScopes = [
        { caseType: 'USER_ACCOUNT_ERASURE', targetUserId: target.targetUserId },
        { caseType: 'MEMBERSHIP_EXIT', membershipId: target.membershipId },
        { caseType: 'COMPANY_WORKSPACE_OFFBOARDING', companyId: target.companyId },
      ];
    } else {
      const memberships = await tx.companyMembership.findMany({
        where: { companyId: target.companyId! },
        select: { userId: true },
      });
      const userIds = memberships.map((membership) => membership.userId);
      overlappingScopes = [
        { caseType: 'COMPANY_WORKSPACE_OFFBOARDING', companyId: target.companyId },
        { caseType: 'MEMBERSHIP_EXIT', companyId: target.companyId },
        ...(userIds.length
          ? [{ caseType: 'USER_ACCOUNT_ERASURE' as const, targetUserId: { in: userIds } }]
          : []),
      ];
    }
    return { status: { notIn: TERMINAL_STATUS_LIST }, OR: overlappingScopes };
  }

  private sameTarget(
    row: Pick<CaseRow, 'targetUserId' | 'companyId' | 'membershipId'>,
    target: { targetUserId: string | null; companyId: string | null; membershipId: string | null },
  ) {
    return row.targetUserId === target.targetUserId
      && row.companyId === target.companyId
      && row.membershipId === target.membershipId;
  }

  private priorCaseId(reference?: string) {
    if (reference === undefined) return null;
    const normalized = reference.trim();
    const match = /^case:\/\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(normalized);
    if (!match) this.invalid('priorCaseReference must be an opaque case://<case-id> reference');
    return match[1];
  }

  private verificationEvidence(input: VerificationEvidenceCommand) {
    const reference = this.requiredText(input.reference, 'reference', 500);
    if (
      !DATA_RIGHTS_EVIDENCE_REFERENCE_PATTERN.test(reference)
      || reference.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      this.invalid('reference must be an opaque evidence://, run://, approval:// or case:// reference without credentials, query, fragment or whitespace');
    }
    const sha256 = input.sha256?.trim().toLowerCase() || null;
    if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) this.invalid('sha256 must be 64 lowercase hexadecimal characters');
    const note = input.note?.trim() || null;
    if (note && note.length > 2_000) this.invalid('note must be at most 2000 characters');
    return { reference, sha256, note, fingerprint: { reference, sha256, note } };
  }

  private assertOperator(ctx: RequestContext) {
    if (!ctx.roles.includes('SYSTEM_ADMIN') || !ctx.permissions.includes(DATA_RIGHTS_MANAGE_PERMISSION)) {
      throw new ForbiddenException({
        code: 'data_rights_operator_required',
        message: `SYSTEM_ADMIN with ${DATA_RIGHTS_MANAGE_PERMISSION} is required.`,
      });
    }
  }

  private assertReplay(
    record: { caseId: string; action: string; actorUserId: string; metadataJson: unknown },
    ctx: RequestContext,
    action: string,
    fingerprint: string | readonly string[],
    caseId?: string,
  ) {
    const metadata = record.metadataJson && typeof record.metadataJson === 'object' && !Array.isArray(record.metadataJson)
      ? record.metadataJson as Record<string, unknown>
      : {};
    if (
      record.action !== action
      || record.actorUserId !== ctx.userId
      || (caseId !== undefined && record.caseId !== caseId)
      || !(Array.isArray(fingerprint) ? fingerprint : [fingerprint]).includes(metadata['fingerprint'] as string)
    ) {
      throw new ConflictException({
        code: 'data_rights_command_conflict',
        message: 'commandId was already used for a different actor, case, action, or payload.',
      });
    }
  }

  private isUniqueViolation(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: unknown }).code;
    return code === 'P2002' || code === '23505';
  }

  private requesterContactHashes(contact?: string) {
    const normalized = contact?.trim().toLocaleLowerCase('en-US');
    if (!normalized) return [];
    const keyContext = 'watchdog-bms\0data-rights\0requester-contact\0pseudonymization-key\0v1';
    const valueContext = `data-rights-requester-contact-v1\0${normalized}`;
    const keyRing = this.config.pdpaPseudonymizationKeyRing;
    return [keyRing.current, ...keyRing.previous].map((rootKey) => {
      if (rootKey.length !== 32) throw new Error('PDPA pseudonymization root key must be 32 bytes');
      const derivedKey = createHmac('sha256', rootKey).update(keyContext).digest();
      return createHmac('sha256', derivedKey).update(valueContext).digest('hex');
    });
  }

  private uniqueTargetColumns(error: unknown) {
    if (!error || typeof error !== 'object') return [] as string[];
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return Array.isArray(target) ? target.filter((item): item is string => typeof item === 'string') : [];
  }

  private async appendAction(tx: Tx, input: {
    caseId: string;
    commandId: string;
    action: string;
    fromStatus: DataRightsCaseStatus | null;
    toStatus: DataRightsCaseStatus;
    ctx: RequestContext;
    fingerprint: string;
    metadata?: Record<string, unknown>;
  }) {
    await tx.dataRightsCaseActionRecord.create({ data: {
      caseId: input.caseId,
      commandId: input.commandId,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorUserId: input.ctx.userId,
      requestId: input.ctx.requestId,
      metadataJson: { fingerprint: input.fingerprint, ...(input.metadata ?? {}) },
    } });
  }

  private assertStatus(row: CaseRow, allowed: DataRightsCaseStatus[]) {
    if (!allowed.includes(row.status as DataRightsCaseStatus)) {
      throw new ConflictException({
        code: 'data_rights_invalid_status',
        message: `Case ${row.id} is ${row.status}; expected ${allowed.join(' or ')}.`,
      });
    }
  }

  private async lock(tx: Tx, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`data-rights:${key}`}))::text`;
  }

  private assertCommandId(commandId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(commandId)) {
      this.invalid('commandId must be an opaque 1-128 character key');
    }
  }

  private assertOpaqueRequestKey(requestKey: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestKey)) {
      this.invalid('requestKey must be an opaque 1-128 character key');
    }
  }

  private date(value: string, field: string) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) this.invalid(`${field} must be a valid ISO-8601 date`);
    return date;
  }

  private requiredText(value: string, field: string, max: number) {
    const text = value?.trim();
    if (!text) this.invalid(`${field} is required`);
    if (text.length > max) this.invalid(`${field} must be at most ${max} characters`);
    return text;
  }

  private invalid(message: string): never {
    throw new UnprocessableEntityException({ code: 'data_rights_invalid_input', message });
  }
}
