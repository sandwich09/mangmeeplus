/**
 * The model-reachable half of S-4 (draft-control spec §5.4): five tools that PREVIEW a change to
 * the expense draft this chat just captured, and cannot write.
 *
 * Every one of them is the same five steps — resolve the record through the ONE shared chat
 * provenance rule, hand the proposal to `LineDraftUpdateUseCase.preview`, and return the resulting
 * `LineDraftUpdatePreview` as tool data. The apply lives on the confirm postback, in the webhook,
 * behind a path no tool call can reach. That is the whole security story of this file: a model can
 * cause a QUESTION to be asked, never an edit to happen.
 *
 * Statuses map to the read tools' existing vocabulary so the gateway needs no new handling:
 * `forbidden` for a caller who cannot edit, `unsupported_module` when the feature is off or the
 * record is past LINE's boundary, and an honest `ok` + `found: false` when this chat has no
 * editable record — never a different answer for "another tenant's record" than for "no record".
 */
import { Injectable } from '@nestjs/common';
import type { LineDraftUpdateTool, RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
import { listRecentLineCaptureCandidates } from '../../../expenses/application/services/line-recent-capture';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { LineDraftUpdateUseCase } from '../../../expenses/application/use-cases/line-draft-update.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

/** A write proposal needs an unambiguous target, so more than one candidate is a refusal — unlike
 *  the read-only explain tool, which may take the newest and name the bill it is describing. */
const DRAFT_CANDIDATE_LIMIT = 2;

function toRequestContext(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: ctx.roles ?? [],
    permissions: ctx.permissions,
    scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    // The LINE chat is who is asking; the draft use case checks `expense.update` either way.
    authProvider: 'line',
  };
}

/**
 * One base class for the five tools: they differ only in their name and in the argument shape the
 * pure parser already owns, so five copies of this method would be five places to forget a guard.
 */
abstract class ExpenseDraftUpdateTool implements ErpReadToolPort {
  abstract toolName: LineDraftUpdateTool;

  constructor(
    protected readonly draftUpdate: LineDraftUpdateUseCase,
    protected readonly repo: PrismaExpenseRepository,
  ) {}

  async execute(ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const listRef: SourceRef = {
      label: 'ข้อมูลค่าใช้จ่าย', module: 'expenses', entityType: 'expense_query',
      asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses`,
    };
    if (!this.draftUpdate.enabled) {
      return { toolName: this.toolName, status: 'unsupported_module', sourceRefs: [], asOf, errorCode: 'LINE_DRAFT_EDIT_DISABLED' };
    }

    const candidates = ctx.chatKeyHash
      ? await listRecentLineCaptureCandidates(this.repo, {
          companyId: ctx.companyId,
          userId: ctx.userId,
          chatKeyHash: ctx.chatKeyHash,
          scopes: { ...(ctx.branchIds ? { branchIds: ctx.branchIds } : {}) },
          take: DRAFT_CANDIDATE_LIMIT,
        })
      : [];
    if (candidates.length !== 1) {
      return {
        toolName: this.toolName,
        status: 'ok',
        data: { found: false, reason: candidates.length === 0 ? 'no_recent_record' : 'ambiguous_record' },
        sourceRefs: [listRef],
        asOf,
        errorCode: 'EXPENSE_NOT_FOUND',
      };
    }

    const outcome = await this.draftUpdate.preview(toRequestContext(ctx), {
      tool: this.toolName,
      input,
      chatKeyHash: ctx.chatKeyHash!,
      requestId: ctx.requestId ?? '',
      // Grounding material for the value guards: the message the gateway is answering, forwarded
      // verbatim by the API that received it. DATA only — it authorises nothing and is never
      // stored; without it the record's own numbers remain the only grounding source.
      evidence: ctx.groundingText
        ? [{ text: ctx.groundingText, todayIso: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) }]
        : [],
      expenseId: candidates[0]!.id,
    });

    if (outcome.status === 'preview') {
      return {
        toolName: this.toolName,
        status: 'ok',
        data: { found: true, preview: outcome.preview },
        sourceRefs: [{
          label: 'ค่าใช้จ่าย', module: 'expenses', entityType: 'expense', entityId: outcome.preview.expenseId,
          asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/expenses/${outcome.preview.expenseId}`,
        }],
        asOf,
      };
    }
    if (outcome.status === 'move_suggestion') {
      // J3.3: the answer is a different proposal, not a refusal. The gateway renders it as the
      // "ย้ายเป็นช่องค่าบริการ" suggestion; nothing is pending until the user asks for the move.
      return {
        toolName: this.toolName,
        status: 'ok',
        data: {
          found: true,
          moveSuggestion: {
            lineNumber: outcome.lineNumber,
            chargeKind: outcome.chargeKind,
            chargeLabel: outcome.chargeLabel,
          },
        },
        sourceRefs: [listRef],
        asOf,
      };
    }
    if (outcome.reason === 'forbidden') {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: 'ERP_PERMISSION_DENIED' };
    }
    if (outcome.reason === 'feature_disabled') {
      return { toolName: this.toolName, status: 'unsupported_module', sourceRefs: [], asOf, errorCode: 'LINE_DRAFT_EDIT_DISABLED' };
    }
    // Everything else is a real, explainable answer about THIS record: the record is past LINE's
    // edit boundary, the numbers were not grounded, or the patch is not a legal change. The
    // gateway renders it deterministically; nothing was written either way.
    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        found: true,
        blocked: outcome.reason,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
        ...(outcome.expenseId ? { expenseId: outcome.expenseId } : {}),
      },
      sourceRefs: [listRef],
      asOf,
    };
  }
}

@Injectable()
export class ExpenseDraftSetHeaderTool extends ExpenseDraftUpdateTool {
  toolName = 'expense.draft.set_header' as const;
}

@Injectable()
export class ExpenseDraftSetLineTool extends ExpenseDraftUpdateTool {
  toolName = 'expense.draft.set_line' as const;
}

@Injectable()
export class ExpenseDraftAddChargeTool extends ExpenseDraftUpdateTool {
  toolName = 'expense.draft.add_charge' as const;
}

@Injectable()
export class ExpenseDraftRemoveLineTool extends ExpenseDraftUpdateTool {
  toolName = 'expense.draft.remove_line' as const;
}

@Injectable()
export class ExpenseDraftSetVatModeTool extends ExpenseDraftUpdateTool {
  toolName = 'expense.draft.set_vat_mode' as const;
}
