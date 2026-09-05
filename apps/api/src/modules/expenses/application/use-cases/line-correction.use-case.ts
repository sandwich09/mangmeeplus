/**
 * Applies one LINE correction to a draft this assistant captured (spec §8 atomic apply unit).
 *
 * Everything that decides the outcome happens inside ONE transaction, in a fixed lock order:
 * message → company reconciliation → expense. The message lock serialises two deliveries of the
 * same LINE message even when the model picked different targets, which is what makes the
 * idempotency check sound; the company lock is taken before any expense lock so two duplicate
 * writers can never hold disjoint expense locks while waiting on each other.
 *
 * Idempotency is keyed on the MESSAGE, not the target: a redelivery that resolves to a different
 * record must still find the first apply. The marker rides the same transaction, so a rolled-back
 * apply leaves no trace claiming it happened.
 */
import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../../common/config/app-config.service';
import type { ExpenseLineVatTreatment, LineCorrectionField, LineIntakeCorrectionCandidate, LineIntakeCorrectionHints, RequestContext } from '@watchdog-bms/contracts';
import { LINE_CORRECTION_FIELDS } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import {
  correctionMarkerKey,
  markClarificationsConsumed,
  type ClarificationConsumption,
} from '../../../line-ai/application/line-ai-consumption-marker';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { appendUserNote, canCorrectAmount, evaluateCorrectionHints, type CorrectionEvidence } from '../../domain/logic/line-correction.logic';
import { reconcileExpenseDuplicateCandidates } from '../services/expense-duplicate-detection';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';

/** Statuses a LINE correction may touch. `EXTRACTING` is excluded to match the web edit-block. */
const CORRECTABLE_STATUSES = new Set(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
/** Changing any of these can change what the record looks like to duplicate detection. */
const DUPLICATE_SENSITIVE: LineCorrectionField[] = ['expenseDate', 'amount', 'vendorName', 'documentNumber'];
/** The JSON mirror stays bounded; the audit log carries the full history. */
const CORRECTIONS_MIRROR_CAP = 20;

export type AppliedCorrectionField = { from: string | null; to: string };

export type LineCorrectionOutcome =
  | {
      status: 'applied';
      expenseId: string;
      fields: Partial<Record<LineCorrectionField, AppliedCorrectionField>>;
      replayed?: boolean;
      /** Set when the note write did not do the plain thing the reply would otherwise claim
       *  (spec §5.3): the note filled up, or this sentence was already its newest segment. */
      noteOutcome?: 'truncated' | 'duplicate';
    }
  | { status: 'clarify'; field: LineCorrectionField }
  | { status: 'guidance'; reason: string };

export type LineCorrectionInput = {
  /** Hash of the LINE message id — the idempotency key, and never the raw id. */
  lineMessageIdHash: string;
  /** Server-resolved candidates for this turn; the model may only pick from these. */
  candidates: LineIntakeCorrectionCandidate[];
  hints?: LineIntakeCorrectionHints;
  evidence: CorrectionEvidence[];
  consumption?: ClarificationConsumption;
};

/**
 * The trivial single line a text note carries. `canCorrectAmount` has already refused anything
 * richer, so rewriting it cannot destroy itemisation or a tax selection.
 *
 * Reachable ONLY while the S-4 draft lane is off. With it on, an amount correction goes to
 * `expense.draft.set_line`, which previews the resulting totals and waits for [ยืนยัน] — this
 * blind whole-line-set replacement is exactly what that replaced.
 */
function amountOnlyLine(
  record: { lines: Array<{ description?: string | null; vatRate?: { toString(): string } | null; vatTreatment?: ExpenseLineVatTreatment | null }>; note?: string | null },
  amount: string,
) {
  return [{
    lineNumber: 1,
    description: record.lines[0]?.description ?? record.note ?? 'LINE correction',
    quantity: '1',
    unitPrice: amount,
    vatRate: record.lines[0]?.vatRate?.toString(),
    vatTreatment: record.lines[0]?.vatTreatment ?? null,
  }];
}

@Injectable()
export class CorrectLineCapturedExpenseUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PrismaExpenseRepository,
    private readonly updateDraft: UpdateExpenseDraftUseCase,
    private readonly audit: AuditService,
    /** Only to read `LINE_AI_DRAFT_EDIT_ENABLED`. `@Optional()` so an older wiring keeps the
     *  pre-S-4 lane, which is also the correct answer when the flag is off. */
    @Optional() private readonly config?: Pick<AppConfigService, 'lineAiDraftEditEnabled'>,
  ) {}

  async execute(ctx: RequestContext, input: LineCorrectionInput): Promise<LineCorrectionOutcome> {
    // Editing is a permission of its own: capture-only roles reach the guidance reply instead.
    if (!ctx.permissions.includes('expense.update') && !ctx.permissions.includes('expense.review')) {
      return { status: 'guidance', reason: 'missing_update_permission' };
    }
    const target = this.resolveTarget(input);
    if (target.status !== 'resolved') return target.outcome;

    const client = this.prisma.client as any;
    return client.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:${input.lineMessageIdHash}:line-correction`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.companyId}:duplicate-reconciliation`}))`;

      const markerKey = correctionMarkerKey(ctx.companyId, input.lineMessageIdHash);
      const existing = await tx.outboxEvent.findFirst({ where: { companyId: ctx.companyId, eventKey: markerKey }, select: { payloadJson: true } });
      if (existing) {
        // Same message already applied — replay its confirmation instead of correcting twice.
        const payload = (existing.payloadJson ?? {}) as { expenseId?: string; fields?: Record<string, AppliedCorrectionField> };
        return { status: 'applied', expenseId: payload.expenseId ?? target.expenseId, fields: (payload.fields ?? {}) as never, replayed: true };
      }

      const record = await tx.expenseRecord.findFirst({
        where: { id: target.expenseId, companyId: ctx.companyId },
        include: { lines: true },
      });
      // Re-checked inside the lock: routing decided nothing about authority.
      if (!record) return { status: 'guidance', reason: 'target_not_found' };
      if (record.createdByUserId !== ctx.userId) return { status: 'guidance', reason: 'not_creator' };
      if (!CORRECTABLE_STATUSES.has(record.status)) return { status: 'guidance', reason: `status_locked:${record.status}` };
      if (!isBranchInScope(ctx.scopes ?? {}, record.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');

      // S-4 (draft-control spec §5.4): with the draft lane ON, money leaves this lane entirely —
      // it goes to the draft tools, which preview the new totals and write only on [ยืนยัน].
      //
      // With the flag OFF this lane must behave exactly as it did before S-4, or turning the flag
      // off would be a REGRESSION rather than a rollback: the single-line text-note amount
      // correction that used to apply would silently degrade to a guidance reply. So the old
      // `canCorrectAmount` gate is restored on that path, unchanged.
      const draftLaneOwnsAmount = this.config?.lineAiDraftEditEnabled === true;
      const allowedFields = LINE_CORRECTION_FIELDS.filter((field) => field !== 'amount'
        || (!draftLaneOwnsAmount && canCorrectAmount({ sourceDocumentType: record.sourceDocumentType, lines: record.lines })));
      const evaluated = evaluateCorrectionHints(input.hints, {
        expenseDate: record.expenseDate?.toISOString() ?? null,
        grandTotalAmount: record.grandTotalAmount?.toString() ?? null,
        vendorNameSnapshot: record.vendorNameSnapshot ?? null,
        vendorDocumentNumber: record.vendorDocumentNumber ?? null,
        note: record.note ?? null,
      }, input.evidence, allowedFields);
      if (evaluated.status !== 'applicable') {
        return evaluated.status === 'clarify'
          ? { status: 'clarify', field: evaluated.field }
          : { status: 'guidance', reason: evaluated.reason };
      }

      const { fields } = evaluated;
      // Spec §5.3: work out what the note append actually achieves BEFORE promising it in a reply.
      const noteAppend = fields.note ? appendUserNote(record.note, fields.note.to) : undefined;
      if (noteAppend?.outcome === 'empty') return { status: 'guidance', reason: 'empty_note' };
      await this.updateDraft.execute(ctx, target.expenseId, {
        expectedUpdatedAt: record.updatedAt.toISOString(),
        ...(fields.expenseDate ? { expenseDate: fields.expenseDate.to } : {}),
        ...(fields.vendorName ? { vendorNameSnapshot: fields.vendorName.to } : {}),
        ...(fields.documentNumber ? { vendorDocumentNumber: fields.documentNumber.to } : {}),
        // Spec §5.3 (slice A): append, never overwrite — the provenance note ("LINE receipt
        // upload") is how anyone later knows this record came from a photo in a chat.
        ...(noteAppend ? { note: noteAppend.note } : {}),
        // Reachable only while the S-4 draft lane is OFF; `allowedFields` drops `amount` entirely
        // when it is on, and money goes to the previewed, confirmed draft tools instead.
        ...(fields.amount ? { lines: amountOnlyLine(record, fields.amount.to) } : {}),
      }, { db: tx, suppressGenericAudit: true });

      await this.appendProvenance(tx, ctx, record, input.lineMessageIdHash, fields);
      if (DUPLICATE_SENSITIVE.some((field) => fields[field])) {
        // Inside the apply transaction: a committed correction whose reconciliation failed
        // afterwards would be unrepairable behind the idempotency marker.
        await reconcileExpenseDuplicateCandidates(this.repo, ctx.companyId, target.expenseId, ctx.userId, ctx.scopes ?? {}, tx);
      }

      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.line_correction.apply',
        targetType: 'expense_record', targetId: target.expenseId, requestId: ctx.requestId,
        result: 'SUCCESS', riskLevel: 'MEDIUM',
        // Spec §7: `fields.note.to` is what the user typed, not what the column now holds — the
        // audit has to say the write was an append or a reader would take it for a replacement.
        metadataJson: { lineMessageIdHash: input.lineMessageIdHash, fields, ...(noteAppend ? { noteAppend: noteAppend.outcome } : {}) },
      }, tx);

      await tx.outboxEvent.create({
        data: {
          companyId: ctx.companyId,
          eventType: 'expense.line_correction.applied',
          aggregateType: 'line_message',
          aggregateId: `${ctx.companyId}:${input.lineMessageIdHash}`,
          eventKey: markerKey,
          payloadJson: { expenseId: target.expenseId, fields },
        },
      });
      if (input.consumption) await markClarificationsConsumed(tx, input.consumption);

      return {
        status: 'applied', expenseId: target.expenseId, fields,
        ...(noteAppend && noteAppend.outcome !== 'appended' ? { noteOutcome: noteAppend.outcome } : {}),
      };
    });
  }

  /** Target matrix (spec §8): one candidate is the target; several need the model to name one
   *  FROM that list. There is deliberately no newest-record fallback. */
  private resolveTarget(input: LineCorrectionInput): { status: 'resolved'; expenseId: string } | { status: 'unresolved'; outcome: LineCorrectionOutcome } {
    if (input.candidates.length === 0) return { status: 'unresolved', outcome: { status: 'guidance', reason: 'no_candidates' } };
    if (input.candidates.length === 1) return { status: 'resolved', expenseId: input.candidates[0].id };
    const named = input.hints?.targetExpenseId;
    if (named && input.candidates.some((candidate) => candidate.id === named)) return { status: 'resolved', expenseId: named };
    return { status: 'unresolved', outcome: { status: 'guidance', reason: 'ambiguous_target' } };
  }

  /** Convenience mirror on the record; the audit row above is the durable history. */
  private async appendProvenance(
    tx: any,
    ctx: RequestContext,
    record: { id: string; aiVerificationSummaryJson: unknown },
    lineMessageIdHash: string,
    fields: Partial<Record<LineCorrectionField, AppliedCorrectionField>>,
  ): Promise<void> {
    const summary = (record.aiVerificationSummaryJson ?? {}) as Record<string, unknown>;
    const history = Array.isArray(summary['corrections']) ? (summary['corrections'] as unknown[]) : [];
    const entry = { at: new Date().toISOString(), byUserId: ctx.userId, via: 'line_correction', lineMessageIdHash, fields };
    await this.repo.updateExpense({
      id: record.id,
      companyId: ctx.companyId,
      updatedByUserId: ctx.userId,
      aiVerificationSummaryJson: { ...summary, corrections: [...history, entry].slice(-CORRECTIONS_MIRROR_CAP) },
    }, undefined, tx);
  }
}
