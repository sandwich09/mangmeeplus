/**
 * Editing a draft over LINE, in two beats (draft-control spec §5.4).
 *
 * **PREVIEW** answers "what would this change?" and writes nothing to the business record. It does
 * that by running the REAL `UpdateExpenseDraftUseCase` inside a transaction it then rolls back —
 * not by re-deriving the arithmetic. Re-deriving is how a card ends up promising a total the apply
 * would not produce; a rolled-back run of the actual write path cannot disagree with itself, and it
 * proves the validators, the VAT reconciliation, the tax-code resolution and the §5.1 totals
 * identity all pass BEFORE the user is asked anything.
 *
 * **APPLY** is reachable only from a confirm postback. It re-derives everything from the chat: the
 * postback carries an intent and no ids (SEC-04), the stored preview is looked up by
 * company+chat, its binding is re-checked, and the record's `updatedAt` must still be the one the
 * preview was computed against. Then the same use case runs for real, in one transaction, with the
 * audit row inside it.
 *
 * Nothing a model says can reach APPLY. The tool surface is PREVIEW only.
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ExpenseLineChargeKind,
  ExpenseVatMode,
  LineDraftUpdateBlockedReason,
  LineDraftUpdatePreview,
  LineDraftUpdateTool,
  LineDraftUpdateTotals,
  RequestContext,
} from '@watchdog-bms/contracts';
import { EXPENSE_LINE_CHARGE_KIND_LABELS, EXPENSE_STATUS_LABELS, scrubRecordText } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../../common/security/redis-rate-limit.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import {
  appendNote,
  existingChargeLikeProductLine,
  groundingFailure,
  parseLineDraftPatch,
  projectLineDraftPatch,
  recordAmountValues,
  type DraftLineInput,
  type LineDraftPatch,
} from '../../domain/logic/line-draft-update.logic';
import type { CorrectionEvidence } from '../../domain/logic/line-correction.logic';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { LINE_DRAFT_PREVIEW_TTL_SECONDS, LineDraftPreviewStore, type StoredDraftPreview } from '../services/line-draft-preview.store';
import { UpdateExpenseDraftUseCase } from './expense-draft.use-case';

/** Spec §2: LINE may edit only these. CONFIRMED and VOIDED are the web's, and say so. */
const EDITABLE_STATUSES = new Set(['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION']);
/** Same limiter family the LINE AI lanes already use. Editing is cheap but not free: a loop of
 *  previews is a loop of rolled-back transactions on the same row. */
const PREVIEW_RATE_SCOPE = 'line-draft-preview-user';
const PREVIEW_MAX_PER_WINDOW = 20;
const PREVIEW_WINDOW_SECONDS = 300;

export type LineDraftUpdateBlocked = {
  status: 'blocked';
  reason: LineDraftUpdateBlockedReason;
  /** Present for `mutation_blocked` so the reply can link the record the web must handle. */
  expenseId?: string;
  detail?: string;
};

/** J3.3: the receipt already prints this charge as an ordinary product line (an OCR read from
 *  before slice B). Adding a second row would double the bill, so the honest answer is to offer the
 *  MOVE and let the user confirm that instead. */
export type LineDraftMoveSuggestion = {
  status: 'move_suggestion';
  expenseId: string;
  lineNumber: number;
  chargeKind: ExpenseLineChargeKind;
  chargeLabel: string;
};

export type LineDraftPreviewOutcome =
  | { status: 'preview'; preview: LineDraftUpdatePreview }
  | LineDraftMoveSuggestion
  | LineDraftUpdateBlocked;

export type LineDraftApplyOutcome =
  | { status: 'applied'; preview: LineDraftUpdatePreview; expenseId: string; replayed?: boolean }
  | { status: 'cancelled' }
  | { status: 'expired' }
  | { status: 'changed'; expenseId: string }
  | LineDraftUpdateBlocked;

export type LineDraftPreviewInput = {
  tool: LineDraftUpdateTool;
  input: Record<string, unknown>;
  /** The one chat this preview belongs to; also the store key. */
  chatKeyHash: string;
  /** Turn id, so a card is only attached to the turn that produced the preview. */
  requestId: string;
  /** Grounding material: this message plus the clarifications it resolved (correction-lane rule). */
  evidence: CorrectionEvidence[];
  /** Server-resolved target. Absent means "the record this chat just captured", resolved by the
   *  caller through the shared recent-capture rule before calling in. */
  expenseId?: string;
};

/** Thrown to unwind the dry run. Carries the totals the real write path produced. */
class DraftPreviewRollback extends Error {
  constructor(readonly totals: LineDraftUpdateTotals) {
    super('line-draft-preview-rollback');
  }
}

@Injectable()
export class LineDraftUpdateUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PrismaExpenseRepository,
    private readonly updateDraft: UpdateExpenseDraftUseCase,
    private readonly audit: AuditService,
    private readonly previews: LineDraftPreviewStore,
    private readonly config: AppConfigService,
    @Optional() private readonly rateLimits?: RedisRateLimitService,
  ) {}

  get enabled(): boolean {
    return this.config.lineAiDraftEditEnabled === true;
  }

  /**
   * Beat one. Resolves and guards the record, validates the proposal, computes the result by
   * rolling back a real write, and stores the preview against this chat.
   */
  async preview(ctx: RequestContext, input: LineDraftPreviewInput): Promise<LineDraftPreviewOutcome> {
    if (!this.enabled) return { status: 'blocked', reason: 'feature_disabled' };
    // Editing is its own permission: the same one the web PATCH takes. A capture-only role reaches
    // the honest "open it in web" reply instead.
    if (!ctx.permissions.includes('expense.update')) return { status: 'blocked', reason: 'forbidden' };
    if (!input.expenseId) return { status: 'blocked', reason: 'no_recent_record' };

    const limited = await this.rateLimited(ctx);
    if (limited) return { status: 'blocked', reason: 'rate_limited' };

    // The record is read and guarded BEFORE the arguments are validated, so a CONFIRMED record is
    // answered with `mutation_blocked` rather than with whatever happened to be wrong about the
    // proposal — the status boundary is the more important fact for the user, and for the eval.
    const record = await this.repo.findByIdWithRelations(ctx.companyId, input.expenseId, undefined, ctx.scopes ?? {});
    const guard = this.guardRecord(ctx, record);
    if (guard) return guard;
    const target = record!;

    // Spec §5.4: a bare "แก้ยอดเป็น 500" edits THE line when there is exactly one, and otherwise
    // asks which — the same rule the correction lane's `amountOnlyLine` used to encode, now stated
    // once, where the record is actually in hand.
    const resolved = { ...input.input };
    if (input.tool === 'expense.draft.set_line' && resolved['lineNumber'] === undefined) {
      if (target.lines.length !== 1) return { status: 'blocked', reason: 'ambiguous_line' };
      resolved['lineNumber'] = target.lines[0]!.lineNumber;
    }
    const parsed = parseLineDraftPatch(input.tool, resolved);
    if (!parsed.ok) return { status: 'blocked', reason: 'invalid_patch', detail: parsed.reason };

    const grounding = groundingFailure(parsed.patch, input.evidence, recordAmountValues(target.lines));
    if (grounding) return { status: 'blocked', reason: 'ungrounded_value', detail: grounding };

    if (parsed.patch.tool === 'expense.draft.add_charge') {
      // Before adding anything: a bill whose OCR wrote "service charge" as a product row already
      // carries this money. Proposing the move keeps the total honest; proposing an add would
      // silently bill it twice.
      const duplicate = existingChargeLikeProductLine(target.lines, parsed.patch.kind);
      if (duplicate) {
        return {
          status: 'move_suggestion',
          expenseId: target.id,
          lineNumber: duplicate.lineNumber,
          chargeKind: parsed.patch.kind,
          chargeLabel: EXPENSE_LINE_CHARGE_KIND_LABELS[parsed.patch.kind],
        };
      }
    }

    const projected = projectLineDraftPatch(target, parsed.patch);
    if ('error' in projected) return { status: 'blocked', reason: 'invalid_patch', detail: projected.error };

    let totalsAfter: LineDraftUpdateTotals;
    try {
      totalsAfter = await this.dryRun(ctx, target, parsed.patch, projected.lines);
    } catch (err) {
      // The write path's own refusal — a broken totals identity, an out-of-range amount, a VAT rule.
      // It is a 400 at PREVIEW, exactly as the web form would see it, and nothing was written.
      if (err instanceof BadRequestException) return { status: 'blocked', reason: 'invalid_patch', detail: refusalDetail(err) };
      if (err instanceof ForbiddenException) return { status: 'blocked', reason: 'forbidden' };
      throw err;
    }

    const preview: LineDraftUpdatePreview = {
      previewId: randomUUID(),
      recordType: 'expense',
      expenseId: target.id,
      record: recordFields(target),
      tool: input.tool,
      diff: projected.diff,
      totalsBefore: totalsOf(target),
      totalsAfter,
      warnings: projected.warnings,
      // One source of truth: the card must promise exactly the window the store enforces.
      expiresAt: new Date(Date.now() + LINE_DRAFT_PREVIEW_TTL_SECONDS * 1_000).toISOString(),
    };

    const stored: StoredDraftPreview = {
      previewId: preview.previewId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      chatKeyHash: input.chatKeyHash,
      expenseId: target.id,
      expenseUpdatedAt: target.updatedAt.toISOString(),
      patch: parsed.patch,
      preview,
      requestId: input.requestId,
    };
    // No shared store ⇒ the confirm would reach a task that never saw this preview. Say nothing
    // rather than show a button that cannot work.
    if (!(await this.previews.save(stored))) return { status: 'blocked', reason: 'feature_disabled', detail: 'preview_store_unavailable' };

    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.line_ai.draft_preview',
      targetType: 'expense_record',
      targetId: target.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { previewId: preview.previewId, tool: input.tool, fields: preview.diff.map((entry) => entry.field) },
    });
    return { status: 'preview', preview };
  }

  /** The pending preview this chat is holding, when it belongs to this user and this turn. */
  async pendingPreview(
    ctx: RequestContext,
    chatKeyHash: string,
    requestId?: string,
  ): Promise<LineDraftUpdatePreview | null> {
    if (!this.enabled || !ctx.permissions.includes('expense.update')) return null;
    const stored = await this.previews.load(ctx.companyId, chatKeyHash);
    if (!stored || stored.companyId !== ctx.companyId || stored.userId !== ctx.userId || stored.chatKeyHash !== chatKeyHash) return null;
    if (requestId && stored.requestId !== requestId) return null;
    const record = await this.repo.findByIdWithRelations(ctx.companyId, stored.expenseId, undefined, ctx.scopes ?? {});
    if (this.guardRecord(ctx, record) || record!.updatedAt.toISOString() !== stored.expenseUpdatedAt) return null;
    return stored.preview;
  }

  /** Read only: delivery and double-tap recovery must never execute the edit again. */
  async appliedResult(ctx: RequestContext, chatKeyHash: string): Promise<LineDraftApplyOutcome> {
    if (!this.enabled) return { status: 'blocked', reason: 'feature_disabled' };
    if (!ctx.permissions.includes('expense.update')) return { status: 'blocked', reason: 'forbidden' };
    const applied = await this.previews.loadApplied(ctx.companyId, chatKeyHash);
    if (!applied || applied.companyId !== ctx.companyId || applied.userId !== ctx.userId || applied.chatKeyHash !== chatKeyHash)
      return { status: 'expired' };
    const record = await this.repo.findByIdWithRelations(ctx.companyId, applied.expenseId, undefined, ctx.scopes ?? {});
    const guard = this.guardRecord(ctx, record);
    if (guard) return guard;
    if (!applied.appliedExpenseUpdatedAt || record!.updatedAt.toISOString() !== applied.appliedExpenseUpdatedAt)
      return { status: 'changed', expenseId: record!.id };
    return { status: 'applied', preview: applied.preview, expenseId: applied.expenseId, replayed: true };
  }

  /** Beat two, confirm. Everything is re-derived from the chat; the postback proves only intent. */
  async apply(ctx: RequestContext, chatKeyHash: string, webhookEventId: string): Promise<LineDraftApplyOutcome> {
    if (!this.enabled) return { status: 'blocked', reason: 'feature_disabled' };
    if (!ctx.permissions.includes('expense.update')) return { status: 'blocked', reason: 'forbidden' };
    const stored = await this.previews.load(ctx.companyId, chatKeyHash);
    // Wrong user, wrong chat, wrong company, or simply gone: all one answer, because telling them
    // apart would confirm that some other chat holds a pending edit.
    if (!stored || stored.companyId !== ctx.companyId || stored.userId !== ctx.userId || stored.chatKeyHash !== chatKeyHash) {
      // ONLY with nothing pending is this a second tap on a card already confirmed. Checking the
      // applied memory first was a real bug: within its window, a SECOND edit would preview
      // normally, the user would press ยืนยัน, nothing would be written, and the reply would
      // restate the FIRST edit — J3.2 followed by J3.3, which is the ordinary journey.
      return this.appliedResult(ctx, chatKeyHash);
    }
    const record = await this.repo.findByIdWithRelations(ctx.companyId, stored.expenseId, undefined, ctx.scopes ?? {});
    const guard = this.guardRecord(ctx, record);
    if (guard) {
      await this.previews.discard(ctx.companyId, chatKeyHash);
      return guard;
    }
    const target = record!;
    if (target.updatedAt.toISOString() !== stored.expenseUpdatedAt) {
      // Someone edited it in web between the card and the button. The proposal described a
      // different record than the one that exists now, so it is dropped, not re-based.
      await this.previews.discard(ctx.companyId, chatKeyHash);
      return { status: 'changed', expenseId: target.id };
    }

    const projected = projectLineDraftPatch(target, stored.patch);
    if ('error' in projected) {
      await this.previews.discard(ctx.companyId, chatKeyHash);
      return { status: 'blocked', reason: 'invalid_patch', detail: projected.error };
    }

    const before = totalsOf(target);
    const client = this.prisma.client as any;
    let appliedExpenseUpdatedAt: string | undefined;
    try {
      appliedExpenseUpdatedAt = await client.$transaction(async (tx: any) => {
      const updated = await this.updateDraft.execute(
        ctx,
        target.id,
        this.buildInput(target, stored.patch, projected.lines),
        { db: tx, suppressGenericAudit: true, requireExpectedUpdatedAt: true },
      );
      // In the same transaction as the mutation: an audit row that survived a rollback would claim
      // an edit that never happened, and this row is the durable provenance of a LINE-made change.
      await this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'expense.line_ai.draft_update',
        targetType: 'expense_record',
        targetId: target.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: {
          previewId: stored.previewId,
          webhookEventId,
          tool: stored.patch.tool,
          before,
          after: stored.preview.totalsAfter,
          diff: stored.preview.diff,
        },
      }, tx);
      return updated.updatedAt.toISOString();
      });
    } catch (err) {
      // The row moved between our own re-read and the write — the same race the `updatedAt` compare
      // above catches, just lost by a smaller margin. Same answer either way: drop the proposal and
      // ask the user to look again, never re-base it onto a record they have not seen.
      if (err instanceof ConflictException) {
        await this.previews.discard(ctx.companyId, chatKeyHash);
        return { status: 'changed', expenseId: target.id };
      }
      throw err;
    }

    await this.previews.discard(ctx.companyId, chatKeyHash);
    // Remembered briefly so a SECOND tap on the same card answers "แก้ไปแล้วค่ะ" rather than
    // "there is nothing pending" — a double tap is the commonest thing a person does to a button
    // whose reply is slow, and telling them nothing happened would be a lie about their own edit.
    await this.previews.remember(ctx.companyId, chatKeyHash, { ...stored, appliedExpenseUpdatedAt });
    return { status: 'applied', preview: stored.preview, expenseId: target.id };
  }

  /** Beat two, cancel. Drops the proposal; touches nothing else. */
  async cancel(ctx: Pick<RequestContext, 'companyId' | 'userId'>, chatKeyHash: string): Promise<'cancelled' | 'expired'> {
    const stored = await this.previews.load(ctx.companyId, chatKeyHash);
    if (!stored || stored.userId !== ctx.userId) return 'expired';
    await this.previews.discard(ctx.companyId, chatKeyHash);
    return 'cancelled';
  }

  /** Status, ownership and branch scope, re-checked at both beats — routing decided no authority. */
  private guardRecord(ctx: RequestContext, record: ExpenseRecordWithRelations | null): LineDraftUpdateBlocked | null {
    if (!record) return { status: 'blocked', reason: 'no_recent_record' };
    if (!isBranchInScope(ctx.scopes ?? {}, record.branchId)) return { status: 'blocked', reason: 'forbidden' };
    if (!EDITABLE_STATUSES.has(record.status)) {
      return { status: 'blocked', reason: 'mutation_blocked', expenseId: record.id, detail: record.status };
    }
    return null;
  }

  /**
   * Run the real write path and unwind it. The totals returned are the ones the record WOULD carry,
   * produced by the same code the confirm will run — never a second implementation of the sums.
   */
  private async dryRun(
    ctx: RequestContext,
    record: ExpenseRecordWithRelations,
    patch: LineDraftPatch,
    lines: DraftLineInput[],
  ): Promise<LineDraftUpdateTotals> {
    const client = this.prisma.client as any;
    try {
      await client.$transaction(async (tx: any) => {
        const updated = await this.updateDraft.execute(
          ctx,
          record.id,
          this.buildInput(record, patch, lines),
          { db: tx, suppressGenericAudit: true, requireExpectedUpdatedAt: true },
        );
        throw new DraftPreviewRollback({
          subtotalAmount: updated.subtotalAmount,
          discountAmount: updated.discountAmount,
          chargesAmount: chargesTotal(lines),
          taxableAmount: updated.taxableAmount,
          vatAmount: updated.vatAmount,
          grandTotalAmount: updated.grandTotalAmount,
        });
      });
    } catch (err) {
      if (err instanceof DraftPreviewRollback) return err.totals;
      throw err;
    }
    // `$transaction` cannot return here: the callback always throws.
    throw new Error('LINE_DRAFT_PREVIEW_NOT_ROLLED_BACK');
  }

  /** The one place a patch becomes an `UpdateExpenseDraftInput`, so preview and apply are the same
   *  request twice. */
  private buildInput(
    record: ExpenseRecordWithRelations,
    patch: LineDraftPatch,
    lines: DraftLineInput[],
  ): Parameters<UpdateExpenseDraftUseCase['execute']>[2] {
    const header = patch.tool === 'expense.draft.set_header' ? patch : undefined;
    const vat = patch.tool === 'expense.draft.set_vat_mode' ? patch : undefined;
    return {
      expectedUpdatedAt: record.updatedAt.toISOString(),
      lines,
      ...(header?.expenseDate ? { expenseDate: header.expenseDate } : {}),
      ...(header?.vendorName ? { vendorNameSnapshot: header.vendorName } : {}),
      ...(header?.documentNumber ? { vendorDocumentNumber: header.documentNumber } : {}),
      ...(header?.noteAppend ? { note: appendNote(record.note, header.noteAppend) } : {}),
      ...(vat ? { vatMode: vat.vatMode as ExpenseVatMode } : {}),
    };
  }

  private async rateLimited(ctx: RequestContext): Promise<boolean> {
    if (!this.rateLimits) return false;
    const decision = await this.rateLimits.consume(
      PREVIEW_RATE_SCOPE,
      `${ctx.companyId}:${ctx.userId}`,
      PREVIEW_MAX_PER_WINDOW,
      PREVIEW_WINDOW_SECONDS,
      // A preview spends no model tokens and writes nothing, so losing the shared counter is not
      // worth refusing the edit; the per-task counter still bounds it.
      'degrade-to-local',
    );
    return !decision.allowed;
  }
}

function totalsOf(record: ExpenseRecordWithRelations): LineDraftUpdateTotals {
  return {
    subtotalAmount: record.subtotalAmount,
    discountAmount: record.discountAmount,
    chargesAmount: record.charges.reduce((sum, charge) => sum.plus(new Decimal(charge.amount)), new Decimal(0)).toFixed(2),
    taxableAmount: record.taxableAmount,
    vatAmount: record.vatAmount,
    grandTotalAmount: record.grandTotalAmount,
  };
}

/**
 * The charges figure the card prints, derived the SAME way the reconciliation derives the tax base:
 * a charge row's contribution is its subtotal MINUS its own discount, because that is what
 * `taxableAmount = subtotal - discount + charges` actually adds. Multiplying quantity by unit price
 * and stopping there quietly disagrees with the total sitting next to it on the same card as soon
 * as a discounted line becomes a charge.
 */
function chargesTotal(lines: readonly DraftLineInput[]): string {
  return lines
    .filter((line) => line.chargeKind != null)
    .reduce(
      (sum, line) => sum
        .plus(new Decimal(line.quantity).mul(line.unitPrice))
        .minus(new Decimal(line.discountAmount ?? '0')),
      new Decimal(0),
    )
    .toFixed(2);
}

/**
 * The record as TYPED fields, so a renderer can format the date for its own audience and never has
 * to guess which half of a joined string was untrusted. The vendor name is the ONE attacker-written
 * part — OCR text off a receipt — so it is scrubbed here, once, before it can reach a card, a reply
 * or an audit payload. The date and status are the server's own and are handed over verbatim.
 */
function recordFields(record: ExpenseRecordWithRelations): LineDraftUpdatePreview['record'] {
  return {
    vendorName: scrubRecordText(record.vendorNameSnapshot, 40) || null,
    expenseDate: record.expenseDate.toISOString().slice(0, 10),
    statusLabel: EXPENSE_STATUS_LABELS[record.status],
  };
}

/** Nest wraps a string or an object; either way the reply only ever shows a stable reason code. */
function refusalDetail(error: BadRequestException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response.slice(0, 200);
  const message = (response as { message?: unknown }).message;
  return typeof message === 'string' ? message.slice(0, 200) : 'invalid';
}
