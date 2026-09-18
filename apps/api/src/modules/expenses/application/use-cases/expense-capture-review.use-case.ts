/**
 * Capture group — human facts, the reviewed allocation and accepting it (appendix §9, W04a).
 *
 * The three mutations that decide money. Each one is `expectedRevision` → permission → group lock
 * → compute → persist → audit, in that order, because every one of them can be raced by a second
 * tab (A10/A11/A48) and the snapshot they write is what W05 hands to the expense ledger.
 *
 * NOTHING here decides an amount: `computeCaptureAllocation` does, from facts and a selection.
 * This file decides who may ask, against which revision, and what the answer is stored as.
 */
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EXPENSE_CAPTURE_ALLOCATION_POLICY,
  EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
  INPUT_VAT_CLAIM_STATUSES,
  type CaptureAllocationResult,
  type CaptureAllocationSelection,
  type CaptureExpenseDateChoice,
  type CaptureFactsPatch,
  type CaptureTaxReviewEntry,
  type CaptureTaxReviewRecord,
  type ExpenseCaptureBusinessUse,
  type ExpenseCaptureFundingRoute,
  type ExpenseCaptureReviewResultDto,
  type InputVatClaimStatus,
  type RequestContext,
  type TaxEvidenceStatus,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { computeCaptureAllocation } from '../../domain/logic/expense-capture-allocation.logic';
import {
  applyCaptureFactsPatch,
  assembleCaptureFacts,
  CaptureFactsPatchError,
  selectCaptureObservations,
} from '../../domain/logic/expense-capture-facts.logic';
import {
  PrismaExpenseCaptureRepository,
  type CaptureGroupRow,
} from '../../infrastructure/prisma-expense-capture.repository';
import { ExpenseCaptureAccessService } from './expense-capture-group.use-case';

const conflict = (code: string, message: string) => new ConflictException({ code, message });

const revisionConflict = () => conflict(
  'expense_capture_group_revision_conflict',
  'งานรับหลักฐานนี้เปลี่ยนไปแล้ว กรุณาเปิดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง',
);

const handoffActive = () => conflict(
  'expense_capture_handoff_active',
  'งานนี้สร้างรายการค่าใช้จ่ายไปแล้ว กรุณาจัดการที่รายการค่าใช้จ่ายนั้น',
);

function assertRevision(expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new BadRequestException('expectedRevision must be the revision you last read.');
  }
}

/**
 * OPEN and not handed off: once derived sources exist, correction belongs to the expense (§9).
 *
 * ONE exception, added by W05 (§9 regenerate / §3.2 "มีของส่วนตัวด้วย"): a group whose derived
 * sources are ALL still unused may be divided again, and the next handoff rewrites them in place.
 * The moment any of them is paid, posted, claimed or certified — or the group handed off without
 * producing one at all — this closes for good and the correction is made at that expense.
 */
async function assertReviewable(
  capture: PrismaExpenseCaptureRepository,
  ctx: RequestContext,
  group: CaptureGroupRow,
): Promise<void> {
  if (group.handoffState === 'ACTIVE') {
    if (!await capture.isReopenableAfterHandoff(capture.client, ctx.companyId, group.id)) throw handoffActive();
    return;
  }
  if (group.status !== 'OPEN') {
    throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว ไม่สามารถแก้ไขได้');
  }
}

const invalid = (message: string) => new BadRequestException({ code: 'expense_capture_review_input_invalid', message });

const MAX_SELECTION_ROWS = 2_000;
const MAX_SCOPES = 200;
const QUANTITY = /^\d{1,13}(\.\d{1,4})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const VAT_MODES = ['NO_VAT', 'VAT_INCLUDED', 'VAT_EXCLUDED', 'EXEMPT', 'NEEDS_REVIEW'];
const TAX_EVIDENCE_STATUSES = ['USABLE_FOR_TAX', 'SUPPORTING_ONLY', 'NOT_TAX_EVIDENCE', 'NEEDS_REVIEW'];

const record = (value: unknown, where: string, max: number): Record<string, unknown> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid(`${where} must be an object.`);
  const entries = value as Record<string, unknown>;
  if (Object.keys(entries).length > max) throw invalid(`${where} has more than ${max} entries.`);
  return entries;
};

/** The client sends what a person chose; every value is re-checked here before it touches money. */
export function validateCaptureSelection(value: unknown): CaptureAllocationSelection {
  const selection: CaptureAllocationSelection = {};
  for (const [itemId, entry] of Object.entries(record(value, 'selection', MAX_SELECTION_ROWS))) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid(`selection.${itemId} must be an object.`);
    const quantity = (entry as { companyQuantity?: unknown }).companyQuantity;
    if (typeof quantity !== 'string' || !QUANTITY.test(quantity)) {
      throw invalid(`selection.${itemId}.companyQuantity must be a non-negative number.`);
    }
    selection[itemId] = { companyQuantity: quantity };
  }
  return selection;
}

export function validateCaptureTaxReview(value: unknown): Record<string, CaptureTaxReviewEntry> {
  const review: Record<string, CaptureTaxReviewEntry> = {};
  for (const [scopeKey, entry] of Object.entries(record(value, 'taxReview', MAX_SCOPES))) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid(`taxReview.${scopeKey} must be an object.`);
    const { vatMode, inputVatClaimStatus, taxEvidenceStatus } = entry as Record<string, unknown>;
    if (typeof vatMode !== 'string' || !VAT_MODES.includes(vatMode)) throw invalid(`taxReview.${scopeKey}.vatMode is not a VAT mode.`);
    if (typeof inputVatClaimStatus !== 'string' || !(INPUT_VAT_CLAIM_STATUSES as readonly string[]).includes(inputVatClaimStatus)) {
      throw invalid(`taxReview.${scopeKey}.inputVatClaimStatus is not a claim status.`);
    }
    if (typeof taxEvidenceStatus !== 'string' || !TAX_EVIDENCE_STATUSES.includes(taxEvidenceStatus)) {
      throw invalid(`taxReview.${scopeKey}.taxEvidenceStatus is not an evidence status.`);
    }
    review[scopeKey] = {
      vatMode: vatMode as CaptureTaxReviewEntry['vatMode'],
      inputVatClaimStatus: inputVatClaimStatus as InputVatClaimStatus,
      taxEvidenceStatus: taxEvidenceStatus as TaxEvidenceStatus,
    };
  }
  return review;
}

export function validateCaptureExpenseDateChoice(value: unknown): Record<string, CaptureExpenseDateChoice> {
  const choices: Record<string, CaptureExpenseDateChoice> = {};
  for (const [scopeKey, entry] of Object.entries(record(value, 'expenseDateChoice', MAX_SCOPES))) {
    if (entry === 'payment' || entry === 'document' || entry === 'order') { choices[scopeKey] = entry; continue; }
    const date = (entry as { date?: unknown } | null)?.date;
    if (typeof date !== 'string' || !ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
      throw invalid(`expenseDateChoice.${scopeKey} must be payment, document, order or { date }.`);
    }
    choices[scopeKey] = { date };
  }
  return choices;
}

/**
 * `POST /v1/companies/{c}/expenses/capture-groups/{g}/facts` — a person correcting what the
 * machine read. The correction is a NEW observation (never an overwrite: A12/A48 need both), and
 * because it can move a number, it invalidates the allocation computed from the old one.
 */
@Injectable()
export class PatchExpenseCaptureFactsUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, cmd: {
    fileId: string; patch: CaptureFactsPatch; expectedRevision: number;
  }): Promise<{ fileId: string; observationId: string; version: number; revision: number; invalidatedAllocations: number }> {
    assertRevision(cmd.expectedRevision);
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canMutate(ctx, group)) throw new ForbiddenException('Missing permission: expense.update');
    await assertReviewable(this.capture, ctx, group);
    if (group.revision !== cmd.expectedRevision) throw revisionConflict();

    return this.capture.transaction(async (tx) => {
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      const observations = await this.capture.listObservations(tx, ctx.companyId, groupId);
      const current = selectCaptureObservations(observations).get(cmd.fileId);
      if (!current) throw new NotFoundException('Capture facts not found for this file');

      let payloadJson;
      try {
        payloadJson = applyCaptureFactsPatch(
          current.payloadJson as never,
          cmd.patch,
          { userId: ctx.userId, at: new Date().toISOString(), fileId: cmd.fileId },
        );
      } catch (error) {
        if (error instanceof CaptureFactsPatchError) {
          throw new BadRequestException({ code: error.code, message: error.messageTh });
        }
        throw error;
      }

      const version = await this.capture.nextObservationVersion(tx, ctx.companyId, {
        fileId: current.fileId, expenseId: current.expenseId ?? null,
      });
      const observation = await this.capture.createObservation(tx, {
        companyId: ctx.companyId, groupId, fileId: current.fileId, expenseId: current.expenseId ?? null,
        version, source: 'HUMAN', payloadJson, createdByUserId: ctx.userId,
      });
      // The numbers moved, so any preview or acceptance built on the old ones is no longer a
      // description of this group (A48). A handed-off group never reaches here.
      const invalidatedAllocations = await this.capture.retireAllocations(tx, {
        companyId: ctx.companyId, groupId, from: ['PREVIEW', 'ACCEPTED'],
        to: 'INVALIDATED', reason: 'facts_changed',
      });
      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
        ...(invalidatedAllocations > 0 ? { data: { acceptedAllocationId: null } } : {}),
      });
      if (revision === null) throw revisionConflict();

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_FACTS_EDIT,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        // Field NAMES and ids only: a provenance entry carries transcribed document values.
        metadataJson: {
          fileId: cmd.fileId, observationId: observation.id, version, revision, invalidatedAllocations,
          fields: payloadJson.provenance.map((entry) => `${entry.target}.${entry.field}`),
        },
      }, tx);

      return { fileId: cmd.fileId, observationId: observation.id, version, revision, invalidatedAllocations };
    });
  }
}

/**
 * `POST /v1/companies/{c}/expenses/capture-groups/{g}/review` — what is the company's, who paid,
 * and what the tax review decided. Produces a PREVIEW allocation; accepting it is a second, named
 * step, because a preview is a proposal and only an acceptance is a decision (spec §5).
 */
@Injectable()
export class ReviewExpenseCaptureGroupUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, cmd: {
    businessUse: ExpenseCaptureBusinessUse;
    fundingRoute: ExpenseCaptureFundingRoute;
    selection?: unknown;
    payerUserId?: string | null;
    taxReview?: unknown;
    expenseDateChoice?: unknown;
    expectedRevision: number;
  }): Promise<ExpenseCaptureReviewResultDto> {
    assertRevision(cmd.expectedRevision);
    const group = await this.access.load(ctx, groupId);
    if (!this.access.canMutate(ctx, group)) throw new ForbiddenException('Missing permission: expense.update');
    await assertReviewable(this.capture, ctx, group);
    if (group.revision !== cmd.expectedRevision) throw revisionConflict();

    const reviewer = ctx.permissions.includes('expense.review');
    const selection = validateCaptureSelection(cmd.selection);
    // §6: the tax decision is a reviewer's. A non-reviewer may still review everything else, and
    // whatever a reviewer already decided stays — it is not erased by the next selection change.
    const sentTaxReview = cmd.taxReview !== undefined && cmd.taxReview !== null;
    if (sentTaxReview && !reviewer) {
      throw new ForbiddenException({
        code: 'expense_capture_tax_review_forbidden',
        message: 'การตัดสินเรื่องภาษีต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย',
      });
    }
    const payerUserId = await this.resolvePayer(ctx, group, cmd.payerUserId, reviewer);

    const storedTaxReview = (group.taxReviewJson ?? {}) as Record<string, CaptureTaxReviewRecord>;
    const taxReview = sentTaxReview
      ? Object.fromEntries(Object.entries(validateCaptureTaxReview(cmd.taxReview)).map(([scopeKey, entry]) => [
        scopeKey, { ...entry, reviewedByUserId: ctx.userId, reviewedAt: new Date().toISOString() } satisfies CaptureTaxReviewRecord,
      ]))
      : storedTaxReview;
    const expenseDateChoice = cmd.expenseDateChoice !== undefined && cmd.expenseDateChoice !== null
      ? validateCaptureExpenseDateChoice(cmd.expenseDateChoice)
      : validateCaptureExpenseDateChoice(group.expenseDateSourceJson);

    const observations = await this.capture.listObservations(this.capture.client, ctx.companyId, groupId);
    const facts = assembleCaptureFacts(observations);
    const result = computeCaptureAllocation({
      facts, businessUse: cmd.businessUse, selection, fundingRoute: cmd.fundingRoute, payerUserId,
      taxReview, expenseDateChoice, policy: EXPENSE_CAPTURE_ALLOCATION_POLICY,
      todayIso: new Date().toISOString(),
    });

    return this.capture.transaction(async (tx) => {
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      // A11: the previous proposal described a selection nobody is asking for any more, and a
      // previous acceptance was an acceptance of it — neither may be handed off after this.
      await this.capture.retireAllocations(tx, {
        companyId: ctx.companyId, groupId, from: ['PREVIEW'], to: 'SUPERSEDED',
      });
      await this.capture.retireAllocations(tx, {
        companyId: ctx.companyId, groupId, from: ['ACCEPTED'], to: 'INVALIDATED', reason: 'review_recomputed',
      });
      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
        data: {
          businessUse: cmd.businessUse, fundingRoute: cmd.fundingRoute, payerUserId,
          taxReviewJson: taxReview, expenseDateSourceJson: expenseDateChoice,
          acceptedAllocationId: null,
        },
      });
      if (revision === null) throw revisionConflict();

      const allocation = await this.capture.createAllocation(tx, {
        companyId: ctx.companyId, groupId, groupRevision: revision,
        policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
        selectionJson: selection,
        // What the snapshot was computed FROM, so a later read can tell whether it still applies.
        inputJson: {
          businessUse: cmd.businessUse, fundingRoute: cmd.fundingRoute, payerUserId,
          taxReview, expenseDateChoice,
          observations: facts.files.map((file) => ({ fileId: file.fileId, version: file.version, source: file.source })),
        },
        resultJson: result,
        fundingRoute: cmd.fundingRoute, payerUserId, computedByUserId: ctx.userId,
      });

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_REVIEW,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
        metadataJson: {
          allocationId: allocation.id, revision, businessUse: cmd.businessUse, fundingRoute: cmd.fundingRoute,
          payerUserId, taxReviewed: sentTaxReview, outcome: result.outcome,
          companyAmount: result.summary.companyAmount, personalAmount: result.summary.personalAmount,
          blockers: result.blockers.map((entry) => entry.code),
        },
      }, tx);

      return {
        allocationId: allocation.id, groupRevision: revision, revision, status: 'PREVIEW' as const, result,
      };
    });
  }

  /**
   * §5/A32: a payer is a person the server can verify, not a name on a parcel or whoever
   * uploaded the picture. Naming somebody else is a reviewer's act.
   */
  private async resolvePayer(
    ctx: RequestContext,
    group: CaptureGroupRow,
    payerUserId: string | null | undefined,
    reviewer: boolean,
  ): Promise<string | null> {
    if (payerUserId === undefined) return group.payerUserId;
    if (payerUserId === null) return null;
    if (payerUserId !== ctx.userId && !reviewer) {
      throw new ForbiddenException({
        code: 'expense_capture_payer_forbidden',
        message: 'การระบุผู้จ่ายเป็นคนอื่นต้องใช้สิทธิ์ผู้ตรวจสอบค่าใช้จ่าย',
      });
    }
    const member = await this.capture.isActiveCompanyMember(this.capture.client, {
      companyId: ctx.companyId, userId: payerUserId, branchId: group.branchId,
    });
    if (!member) {
      throw new UnprocessableEntityException({
        code: 'expense_capture_payer_invalid',
        message: 'ผู้จ่ายต้องเป็นสมาชิกที่ใช้งานอยู่ของบริษัทและอยู่ในสาขาของงานนี้',
      });
    }
    return payerUserId;
  }
}

/**
 * `POST …/allocations/{a}/accept` — the decision. From here the allocation is what W05 turns into
 * derived expense sources, so it is fenced on the revision it was computed against and refuses
 * anything still blocked.
 */
@Injectable()
export class AcceptExpenseCaptureAllocationUseCase {
  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly access: ExpenseCaptureAccessService,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, groupId: string, allocationId: string, cmd: { expectedRevision: number }): Promise<{
    allocationId: string; status: 'ACCEPTED'; groupStatus: CaptureGroupRow['status']; revision: number; rule: string;
  }> {
    assertRevision(cmd.expectedRevision);
    const group = await this.access.load(ctx, groupId);
    const allocation = await this.capture.findAllocation(this.capture.client, ctx.companyId, groupId, allocationId);
    if (!allocation) throw new NotFoundException('Capture allocation not found');
    const result = allocation.resultJson as CaptureAllocationResult;

    // Accepting is a reviewer's act, with one exception: the creator claiming money THEY paid.
    // The claim itself is still reviewed downstream, so this shortens a form, not an approval.
    const reviewer = ctx.permissions.includes('expense.review');
    const selfClaim = !reviewer
      && this.access.canMutate(ctx, group)
      && allocation.fundingRoute === 'EMPLOYEE'
      && allocation.payerUserId === ctx.userId
      && result?.outcome === 'READY';
    if (!reviewer && !selfClaim) throw new ForbiddenException('Missing permission: expense.review');

    // W05: same reopen exception as `assertReviewable` — an untouched batch may be redecided.
    if (group.handoffState === 'ACTIVE' && !await this.capture.isReopenableAfterHandoff(this.capture.client, ctx.companyId, groupId)) {
      throw handoffActive();
    }
    if (group.handoffState !== 'ACTIVE' && group.status !== 'OPEN') {
      throw conflict('expense_capture_group_closed', 'งานรับหลักฐานนี้ปิดแล้ว ไม่สามารถยอมรับการจัดส่วนได้');
    }
    if (allocation.status !== 'PREVIEW') {
      throw conflict('expense_capture_allocation_not_current', 'การจัดส่วนนี้ไม่ใช่ฉบับล่าสุดแล้ว กรุณาตรวจใหม่อีกครั้ง');
    }
    if (allocation.groupRevision !== group.revision) {
      throw conflict('expense_capture_allocation_stale', 'ข้อมูลของงานนี้เปลี่ยนหลังคำนวณการจัดส่วน กรุณาตรวจใหม่อีกครั้ง');
    }
    if (result?.outcome === 'BLOCKED') {
      throw new UnprocessableEntityException({
        code: 'expense_capture_allocation_blocked',
        message: 'ยังมีรายการที่ต้องตรวจก่อน จึงจะยอมรับการจัดส่วนนี้ได้',
        blockers: result.blockers.map((entry) => entry.code),
      });
    }

    const rule = reviewer ? 'expense.review' : 'self_claim';
    return this.capture.transaction(async (tx) => {
      await this.capture.lockGroup(tx, ctx.companyId, groupId);
      // One ACCEPTED per group, decided under the lock (§2.2).
      await this.capture.retireAllocations(tx, {
        companyId: ctx.companyId, groupId, from: ['ACCEPTED'], to: 'SUPERSEDED', exceptId: allocationId,
      });
      const accepted = await this.capture.acceptAllocation(tx, {
        companyId: ctx.companyId, allocationId, acceptedByUserId: ctx.userId,
      });
      if (!accepted) {
        throw conflict('expense_capture_allocation_not_current', 'การจัดส่วนนี้ไม่ใช่ฉบับล่าสุดแล้ว กรุณาตรวจใหม่อีกครั้ง');
      }

      // A41: accepting "there is no company portion" IS the answer. The group closes with its
      // evidence intact and creates no expense, no claim and no certificate for 0.
      const closed = result?.outcome === 'NO_COMPANY_PORTION';
      const groupStatus: CaptureGroupRow['status'] = closed ? 'CLOSED_NO_HANDOFF' : 'OPEN';
      const revision = await this.capture.bumpRevision(tx, {
        companyId: ctx.companyId, groupId, expectedRevision: cmd.expectedRevision,
        data: {
          acceptedAllocationId: allocationId,
          ...(closed ? { status: groupStatus, closedReason: 'NO_COMPANY_PORTION', closedAt: new Date() } : {}),
        },
      });
      if (revision === null) throw revisionConflict();

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: AuditAction.EXPENSE_CAPTURE_GROUP_ALLOCATION_ACCEPT,
        targetType: 'expense_capture_group', targetId: groupId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: {
          allocationId, revision, rule, outcome: result?.outcome ?? null, groupStatus,
          companyAmount: result?.summary?.companyAmount ?? null,
          payerUserId: allocation.payerUserId, fundingRoute: allocation.fundingRoute,
        },
      }, tx);

      return { allocationId, status: 'ACCEPTED' as const, groupStatus, revision, rule };
    });
  }
}
