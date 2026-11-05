import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
import {
  expenseEvidenceAssessment, expenseEvidenceImageMissing, civilDate, EXPENSE_STATUS_LABELS, REIMBURSEMENT_PAYOUT_ROUND_TEXTS, REIMBURSEMENT_SYSTEM_WAIT_LABEL, reimbursementPayoutHeld, reimbursementPayoutRoundStatus, reimbursementDuplicateBlockNotice, reimbursementDuplicateWait,
} from '@watchdog-bms/contracts';
import { listRecentLineCaptureCandidates } from '../../../expenses/application/services/line-recent-capture';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { LineDraftUpdateUseCase } from '../../../expenses/application/use-cases/line-draft-update.use-case';
import { GetProductUseCase } from '../../../inventory/application/use-cases/list-products.use-case';
import { GetDocumentUseCase, ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { GetExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { parseLineExpenseDraftContinuation } from '../../../expenses/domain/logic/line-expense-draft-conversation.logic';
import { GetReimbursementDetailUseCase, mayCancelReimbursement } from '../../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { GetReimbursementAiSummaryUseCase } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';
import { PAYOUT_CORRECTION_STEP_REASON } from '../../../reimbursements/domain/logic/reimbursement.logic';
import { lineExpenseEvidenceNotes } from '../../domain/logic/line-language.logic';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import {
  BUSINESS_READ_BASIS_VERSION,
  appliedQuery,
  completeResult,
  fact,
  sourceRefId,
} from '../../domain/logic/business-read-source.logic';

function now(): string { return new Date().toISOString(); }

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

function source(ctx: ErpToolContext, asOf: string, label: string, module: string, entityType: string, entityId?: string, webPath?: string): SourceRef {
  return { label, module, entityType, ...(entityId && { entityId }), asOf, permissionChecked: true, ...(webPath && { webPath }) };
}

function unavailable(toolName: string, asOf: string, errorCode: string): ToolResult {
  return { toolName, status: 'unavailable', sourceRefs: [], asOf, errorCode };
}

function forbidden(toolName: string, asOf: string): ToolResult {
  return { toolName, status: 'forbidden', sourceRefs: [], asOf };
}

async function safely(
  toolName: string,
  asOf: string,
  notFoundCode: string,
  run: () => Promise<ToolResult>,
  notFoundRef?: SourceRef,
): Promise<ToolResult> {
  try { return await run(); }
  catch (error) {
    if (error instanceof ForbiddenException) return forbidden(toolName, asOf);
    if (error instanceof NotFoundException) return notFoundRef
      ? { toolName, status: 'ok', data: { found: false }, sourceRefs: [notFoundRef], asOf, errorCode: notFoundCode }
      : unavailable(toolName, asOf, notFoundCode);
    throw error;
  }
}

@Injectable()
export class InventoryGetProductDetailTool implements ErpReadToolPort<{ productId?: string }> {
  toolName = 'inventory.get_product_detail';
  constructor(private readonly getProduct: GetProductUseCase) {}

  async execute(ctx: ErpToolContext, input: { productId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    const productId = typeof input.productId === 'string' ? input.productId.trim().slice(0, 200) : '';
    if (!productId) return unavailable(this.toolName, asOf, 'PRODUCT_ID_REQUIRED');
    return safely(this.toolName, asOf, 'PRODUCT_NOT_FOUND', async () => {
      const product = await this.getProduct.execute(toCtx(ctx), productId);
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: product.id, sku: product.sku, name: product.name, description: product.description ?? null,
          category: product.category ?? null, unit: product.unit, kind: product.kind,
          reorderPoint: product.reorderPoint ?? null, salePrice: product.salePrice ?? null,
          bookingDurationMinutes: product.bookingDurationMinutes ?? null,
          customerVisible: product.customerVisible, status: product.status,
          barcodes: product.barcodes.slice(0, 10).map((barcode) => ({ type: barcode.type, value: barcode.value, status: barcode.status })),
        },
        sourceRefs: [source(ctx, asOf, product.name, 'inventory', 'product', product.id, `/companies/${ctx.companyId}/inventory/products/${product.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลสินค้า', 'inventory', 'product_query', undefined, `/companies/${ctx.companyId}/inventory/products`));
  }
}

@Injectable()
export class AccountingGetDocumentDetailTool implements ErpReadToolPort<{ documentId?: string }> {
  toolName = 'accounting.get_document_detail';
  constructor(private readonly getDocument: GetDocumentUseCase) {}

  async execute(ctx: ErpToolContext, input: { documentId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    const documentId = typeof input.documentId === 'string' ? input.documentId.trim().slice(0, 200) : '';
    if (!documentId) return unavailable(this.toolName, asOf, 'DOCUMENT_ID_REQUIRED');
    return safely(this.toolName, asOf, 'DOCUMENT_NOT_FOUND', async () => {
      const doc = await this.getDocument.execute(toCtx(ctx), documentId);
      const counterparty = doc.counterpartySnapshotJson;
      const counterpartyName = typeof counterparty?.['displayName'] === 'string'
        ? counterparty['displayName']
        : typeof counterparty?.['name'] === 'string' ? counterparty['name'] : null;
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: doc.id, documentType: doc.documentType, documentNumber: doc.documentNumber ?? null,
          status: doc.status, documentDate: doc.documentDate.toISOString(), dueDate: doc.dueDate?.toISOString() ?? null,
          counterpartyName, currency: doc.currency, vatMode: doc.vatMode,
          subtotalAmount: doc.subtotalAmount, discountAmount: doc.discountAmount, taxableAmount: doc.taxableAmount,
          vatAmount: doc.vatAmount, whtAmount: doc.whtAmount, grandTotalAmount: doc.grandTotalAmount,
          paidAmount: doc.paidAmount, outstandingAmount: doc.outstandingAmount,
          paymentStatus: doc.paymentStatus ?? null, postingStatus: doc.postingStatus,
          lines: (doc.lines ?? []).map((line) => ({
            description: line.description, quantity: line.quantity, unit: line.unitName ?? null,
            unitPrice: line.unitPrice, lineTotalAmount: line.lineTotalAmount,
          })),
        },
        sourceRefs: [source(ctx, asOf, doc.documentNumber ?? 'เอกสารบัญชี', 'accounting-documents', 'accounting_document', doc.id, `/companies/${ctx.companyId}/accounting/documents/${doc.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลเอกสารบัญชี', 'accounting-documents', 'accounting_document_query', undefined, `/companies/${ctx.companyId}/accounting`));
  }
}

@Injectable()
export class AccountingGetReceivableSummaryTool implements ErpReadToolPort {
  toolName = 'accounting.get_receivable_summary';
  constructor(private readonly listDocuments: ListDocumentsUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    let asOf = now();
    return safely(this.toolName, asOf, 'RECEIVABLE_UNAVAILABLE', async () => {
      const aggregate = await this.listDocuments.aggregateOpenReceivables(toCtx(ctx));
      asOf = aggregate.asOf.toISOString();
      const sourceRefs = [source(ctx, asOf, 'ลูกหนี้คงค้าง', 'accounting-documents', 'receivable_summary', undefined, `/companies/${ctx.companyId}/accounting`)];
      const queryApplied = appliedQuery(undefined, {
        branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'accounting_document_due_date',
        statusBasis: 'issued_non_void_invoices_with_positive_outstanding', dataset: 'operational_accounts_receivable',
      });
      const completeness = completeResult(aggregate.items.length, aggregate.hasMore, aggregate.totalsByCurrency.length, false);
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          basis: 'issued_non_void_invoices_with_positive_outstanding', openCount: aggregate.openCount,
          totalsByCurrency: aggregate.totalsByCurrency,
          items: aggregate.items.map((item) => ({ ...item, documentNumber: item.documentNumber ?? item.id, dueDate: item.dueDate?.toISOString() ?? null })),
          queryApplied,
          completeness,
        },
        sourceRefs,
        queryApplied,
        basisVersion: BUSINESS_READ_BASIS_VERSION,
        facts: aggregate.totalsByCurrency.map((row) => fact({
          id: `accounting.receivable.${row.currency}`, metric: 'receivable_outstanding', value: row.outstandingAmount,
          unit: 'money', currency: row.currency, period: null, dateBasis: queryApplied.dateBasis,
          statusBasis: queryApplied.statusBasis, sourceRefIds: sourceRefs.map(sourceRefId), asOf,
          state: row.count === 0 ? 'empty' : 'known',
        })),
        completeness,
      };
    });
  }
}

@Injectable()
export class ExpenseGetDetailTool implements ErpReadToolPort<{ expenseId?: string }> {
  toolName = 'expense.get_detail';
  constructor(private readonly getExpense: GetExpenseUseCase) {}

  async execute(ctx: ErpToolContext, input: { expenseId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    const expenseId = typeof input.expenseId === 'string' ? input.expenseId.trim().slice(0, 200) : '';
    if (!expenseId) return unavailable(this.toolName, asOf, 'EXPENSE_ID_REQUIRED');
    return safely(this.toolName, asOf, 'EXPENSE_NOT_FOUND', async () => {
      const expense = await this.getExpense.execute(toCtx(ctx), expenseId);
      const recorded = expense.payments.filter((payment) => payment.status === 'RECORDED');
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: expense.id, expenseNumber: expense.expenseNumber, status: expense.status,
          captureSource: expense.captureSource, branchId: expense.branchId,
          vendorCounterpartyId: expense.vendorCounterpartyId ?? null,
          vendorName: expense.vendorNameSnapshot, vendorDocumentNumber: expense.vendorDocumentNumber,
          // What the record and payment cards print beside the amounts (design lock contexts 5 and 7): the
          // category's name, why a closed record was closed, and the recorded payments as a card can state
          // them — how many, the company's day of the latest, and each way paid (null where none was
          // recorded). A payment's bank reference is never projected.
          categoryName: await this.getExpense.categoryName(toCtx(ctx), expense),
          rejectReason: expense.rejectReason ?? null, voidReason: expense.voidReason ?? null,
          payments: {
            count: recorded.length,
            lastPaidOn: recorded.length ? civilDate(new Date(Math.max(...recorded.map((payment) => payment.paidAt.getTime())))) : null,
            methods: [...new Set(recorded.map((payment) => payment.paymentMethod ?? null))],
          },
          expenseDate: expense.expenseDate.toISOString(), dueDate: expense.dueDate?.toISOString() ?? null,
          currency: expense.currency, vatMode: expense.vatMode, inputVatClaimStatus: expense.inputVatClaimStatus,
          subtotalAmount: expense.subtotalAmount, discountAmount: expense.discountAmount,
          taxableAmount: expense.taxableAmount, vatAmount: expense.vatAmount, whtAmount: expense.whtAmount,
          grandTotalAmount: expense.grandTotalAmount, netPayableAmount: expense.netPayableAmount,
          paidAmount: expense.paidAmount, outstandingAmount: expense.outstandingAmount,
          paymentStatus: expense.paymentStatus, duplicateStatus: expense.duplicateStatus,
          taxEvidenceStatus: expense.taxEvidenceStatus, postingStatus: expense.postingStatus,
          lines: expense.lines.map((line) => ({
            description: line.description, chargeKind: line.chargeKind ?? null, quantity: line.quantity,
            unitPrice: line.unitPrice, lineTotalAmount: line.lineTotalAmount,
          })),
          // Spec §5.1: the additional charges as their own group, so an answer about a bill can say
          // "ค่าบริการ 152.00" instead of reading a charge back as one more product line.
          charges: expense.charges,
          attachmentCount: expense.attachments.length,
          originalDocumentAvailable: expenseEvidenceAssessment(expense)?.originalDocumentAvailable === true,
          documentImageMissing: expenseEvidenceImageMissing(expense),
          evidenceNotes: lineExpenseEvidenceNotes(expense, ctx.locale.startsWith('en') ? 'en' : 'th'),
        },
        sourceRefs: [source(ctx, asOf, expense.expenseNumber ?? 'ค่าใช้จ่าย', 'expenses', 'expense', expense.id, `/companies/${ctx.companyId}/expenses/${expense.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลค่าใช้จ่าย', 'expenses', 'expense_query', undefined, `/companies/${ctx.companyId}/expenses`));
  }
}

/** Spec §5.5 record reference. `recent` needs no value; `id`/`documentNumber` do. */
export type ExplainRecordRef = { kind: 'recent' | 'id' | 'documentNumber'; value?: string };

/**
 * Read the reference out of an input that may arrive in either of the two shapes this tool has to
 * live with: the spec's nested `{ recordRef: { kind, value } }` (used by the API's own callers and
 * any caller that can send an object), or the FLAT `recordRefKind`/`recordRefValue` pair the model
 * wire must use — the orchestrator's tool-input sanitizer keeps whitelisted PRIMITIVES only, so a
 * nested object never survives it. Anything unrecognised means "the record from this chat".
 */
export function readExplainRecordRef(input: Record<string, unknown>): ExplainRecordRef {
  const nested = input['recordRef'];
  const raw = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : undefined;
  const kind = String(raw?.['kind'] ?? input['recordRefKind'] ?? 'recent');
  const value = raw?.['value'] ?? input['recordRefValue'];
  const trimmed = typeof value === 'string' ? value.trim().slice(0, 200) : '';
  return kind === 'id' || kind === 'documentNumber'
    ? { kind, ...(trimmed ? { value: trimmed } : {}) }
    : { kind: 'recent' };
}

/** How many of this chat's recent captures the `recent`/`documentNumber` resolver may look at. */
const EXPLAIN_CANDIDATE_LIMIT = 5;

/**
 * `expense.explain_record` (spec §5.5, evidence E4): answer "ทำไมยอดนี้ถึงเป็นแบบนี้" about ONE
 * record the caller captured through LINE, from real numbers only.
 *
 * It returns the header, the line groups (products / additional charges / discount), the totals
 * identity as numbers, the values the reader ASSUMED or could not verify, and what can still be
 * changed over LINE today. Every number comes from the permission-checked record; the renderer on
 * the gateway side copies them and adds none.
 *
 * `recordType` is accepted and pinned to `expense`: the contract reserves it for income/receipt
 * drafts (spec §4), which this release does not explain.
 */
@Injectable()
export class ExpenseExplainRecordTool implements ErpReadToolPort {
  toolName = 'expense.explain_record';
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    // Typed as the repository (the DI token) but used only through the narrow reader surface.
    private readonly recentCaptures: PrismaExpenseRepository,
    // S-4: the ONE fact this read tool needs from the draft lane — whether money can be edited over
    // LINE at all in this deployment. `@Optional()` so an older wiring simply reports the pre-S-4
    // answer rather than failing to boot.
    @Optional() private readonly draftUpdate?: LineDraftUpdateUseCase,
  ) {}

  private get draftEditEnabled(): boolean {
    return this.draftUpdate?.enabled === true;
  }

  async execute(ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const asOf = now();
    const recordType = typeof input['recordType'] === 'string' ? input['recordType'] : 'expense';
    if (recordType !== 'expense') return unavailable(this.toolName, asOf, 'RECORD_TYPE_NOT_SUPPORTED');
    const ref = readExplainRecordRef(input);
    const listRef = source(ctx, asOf, 'ข้อมูลค่าใช้จ่าย', 'expenses', 'expense_query', undefined, `/companies/${ctx.companyId}/expenses`);

    return safely(this.toolName, asOf, 'EXPENSE_NOT_FOUND', async () => {
      const expenseId = ref.kind === 'id' ? ref.value : await this.resolveFromChat(ctx, ref);
      // Same shape `expense.get_detail` uses for an id that resolves to nothing IN THIS TENANT:
      // an honest `found: false`, never a different answer for "another company's record exists"
      // than for "no such record" (the tenant filter lives in findByIdWithRelations).
      if (!expenseId) return { toolName: this.toolName, status: 'ok', data: { found: false }, sourceRefs: [listRef], asOf, errorCode: 'EXPENSE_NOT_FOUND' };

      const expense = await this.getExpense.execute(toCtx(ctx), expenseId);
      const mayEditThisLineRecord = ref.kind !== 'id'
        && ctx.permissions.includes('expense.update')
        && this.draftEditEnabled
        && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status);
      const products = expense.lines.filter((line) => line.chargeKind == null);
      const chargeTotal = expense.charges.reduce((sum, charge) => sum.plus(new Decimal(charge.amount)), new Decimal(0));
      // A LINE text-note draft keeps what the user said (e.g. "สามร้อย", then "350") in its collection
      // until the item is complete enough to become a line; without it the record reads as 0 (NAT-12).
      const collection = parseLineExpenseDraftContinuation(expense.sourceChannelMetadataJson?.['lineExpenseDraftContinuation']);
      const staged = collection ? collection.items.filter((item) => !item.description || !item.quantity || (!item.unitPrice && !item.totalAmount)) : [];
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          found: true,
          header: {
            id: expense.id,
            vendorName: expense.vendorNameSnapshot,
            expenseDate: expense.expenseDate.toISOString(),
            documentNumber: expense.vendorDocumentNumber,
            status: expense.status,
            statusLabel: EXPENSE_STATUS_LABELS[expense.status],
            currency: expense.currency,
          },
          lineGroups: {
            products: products.map((line) => ({
              description: line.description, quantity: line.quantity,
              unitPrice: line.unitPrice, amount: line.lineSubtotalAmount,
            })),
            productCount: products.length,
            charges: expense.charges,
            discountAmount: expense.discountAmount,
          },
          // The §5.1 identity as real numbers, so the answer can state the arithmetic rather than
          // assert a total: subtotal − discount + Σ charges = taxable base, + VAT = grand total.
          totals: {
            subtotalAmount: expense.subtotalAmount,
            discountAmount: expense.discountAmount,
            chargesAmount: chargeTotal.toFixed(2),
            taxableAmount: expense.taxableAmount,
            vatAmount: expense.vatAmount,
            grandTotalAmount: expense.grandTotalAmount,
          },
          ...(staged.length ? { lineDraftItemsNotYetOnDocument: staged.map((item) => ({
            description: item.description ?? item.sourceText, quantity: item.quantity ?? null,
            unitPrice: item.unitPrice ?? null, totalAmount: item.totalAmount ?? null,
          })), lineDraftStillAsks: [...new Set(collection!.unresolvedQuestions.map((question) => question.field))],
          // The user stopped filling it in over LINE; what they said stays on the draft, not on the document.
          ...(collection!.status === 'CANCELLED' ? { lineDraftCollectionStopped: true } : {}) } : {}),
          assumptions: explainAssumptions(expense),
          // Slice B's stored-header-vs-stored-lines check, computed by the detail mapper for every
          // record. A record whose own totals do not reconcile must SAY SO before it explains an
          // arithmetic the reader would otherwise take as verified.
          totalsIdentity: expense.totalsIdentity,
          // What the LINE lanes can actually change TODAY (spec §5.3/§5.4).
          //
          // With S-4 OFF this is the correction lane's four text fields and nothing else. `amount`
          // is excluded and deliberately NOT computed from `canCorrectAmount`, even though that
          // predicate is the authority: it reads `taxCodeDefinitionId` and
          // `externalTaxCodeSnapshot`, which `ExpenseLineSummary` does not carry, so evaluating it
          // here would come out MORE permissive than the lane really is and could tell a user to
          // type a correction the lane then refuses — exactly the E3 dishonesty this slice removes.
          //
          // With S-4 ON the draft tools really do change money, on exactly the receipts this tool
          // explains, so the answer says so. The flag decides; the copy never guesses.
          editableOverLine: mayEditThisLineRecord
            ? ['expenseDate', 'vendorName', 'documentNumber', 'note', 'amount', 'charges', 'vat']
            : [],
          amountEditableOverLine: mayEditThisLineRecord,
        },
        sourceRefs: [source(ctx, asOf, expense.expenseNumber ?? 'ค่าใช้จ่าย', 'expenses', 'expense', expense.id, `/companies/${ctx.companyId}/expenses/${expense.id}`)],
      };
    }, listRef);
  }

  /** `recent` and `documentNumber` both resolve inside the ONE shared chat-provenance window, so a
   *  read can never reach a record the correction lane would refuse to see. No chat, no answer. */
  private async resolveFromChat(ctx: ErpToolContext, ref: ExplainRecordRef): Promise<string | undefined> {
    if (!ctx.chatKeyHash) return undefined;
    const rows = await listRecentLineCaptureCandidates(this.recentCaptures, {
      companyId: ctx.companyId, userId: ctx.userId, chatKeyHash: ctx.chatKeyHash,
      scopes: { ...(ctx.branchIds ? { branchIds: ctx.branchIds } : {}) }, take: EXPLAIN_CANDIDATE_LIMIT,
    });
    if (ref.kind === 'documentNumber') {
      return ref.value ? rows.find((row) => row.vendorDocumentNumber === ref.value)?.id : undefined;
    }
    // ponytail: newest-first, so "บิลเมื่อกี้" is row 0. Unlike the correction lane there is no
    // ambiguity refusal — this is a read, and the answer names the vendor/date/number it explains.
    return rows[0]?.id;
  }
}

/**
 * The values a reader must be told were ASSUMED rather than read (spec §5.2/§5.5). Sourced from the
 * OCR provenance the apply service stores verbatim (`aiVerifiedFieldsJson` = the raw model output,
 * `aiVerificationSummaryJson` = the record's own summary), so it reports what the pipeline actually
 * recorded and never re-derives a judgement of its own.
 *
 * `dateUnverified` is read from either JSON because S-0 writes that flag; until it ships, a receipt
 * whose OCR produced no usable `expenseDate` is already detectable here — the record then carries a
 * date nobody read off the document, which is exactly what the reader must be told.
 */
export function explainAssumptions(expense: {
  aiVerifiedFieldsJson: Record<string, unknown> | null;
  aiVerificationSummaryJson: Record<string, unknown> | null;
}): Array<{ field: string; reason: 'unverified' | 'missing' }> {
  const fields = expense.aiVerifiedFieldsJson ?? {};
  const summary = expense.aiVerificationSummaryJson ?? {};
  const out: Array<{ field: string; reason: 'unverified' | 'missing' }> = [];
  const dateUnverified = summary['dateUnverified'] === true || fields['dateUnverified'] === true;
  const dateRead = typeof fields['expenseDate'] === 'string' && fields['expenseDate'].trim() !== '';
  // Only a record that went through the AI reader can have an unread field; a hand-typed one has
  // no `aiVerifiedFieldsJson` at all and must not be reported as "assumed".
  const aiRead = Object.keys(fields).length > 0;
  if (dateUnverified || (aiRead && !dateRead)) out.push({ field: 'expenseDate', reason: dateUnverified ? 'unverified' : 'missing' });
  const missing = Array.isArray(fields['missingFields']) ? fields['missingFields'] : [];
  for (const field of missing) {
    if (typeof field === 'string' && field !== 'expenseDate' && !out.some((item) => item.field === field)) {
      out.push({ field: field.slice(0, 60), reason: 'missing' });
    }
  }
  return out.slice(0, 8);
}

@Injectable()
export class ReimbursementGetSummaryTool implements ErpReadToolPort {
  toolName = 'reimbursement.get_summary';
  constructor(private readonly getSummary: GetReimbursementAiSummaryUseCase) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    return safely(this.toolName, asOf, 'REIMBURSEMENT_SUMMARY_UNAVAILABLE', async () => ({
      toolName: this.toolName, status: 'ok', data: await this.getSummary.execute(toCtx(ctx)), asOf,
      sourceRefs: [source(ctx, asOf, 'สรุปเบิกจ่าย', 'reimbursements', 'reimbursement_summary', undefined, `/companies/${ctx.companyId}/reimbursements`)],
    }));
  }
}

@Injectable()
export class ReimbursementGetDetailTool implements ErpReadToolPort<{ reimbursementId?: string }> {
  toolName = 'reimbursement.get_detail';
  constructor(private readonly getDetail: GetReimbursementDetailUseCase) {}

  async execute(ctx: ErpToolContext, input: { reimbursementId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    const reimbursementId = typeof input.reimbursementId === 'string' ? input.reimbursementId.trim().slice(0, 200) : '';
    if (!reimbursementId) return unavailable(this.toolName, asOf, 'REIMBURSEMENT_ID_REQUIRED');
    return safely(this.toolName, asOf, 'REIMBURSEMENT_NOT_FOUND', async () => {
      const item = await this.getDetail.execute(toCtx(ctx), reimbursementId);
      // Payout spec §14: a claim sent back from the pay step is PENDING_APPROVAL by its status, with the approval it
      // stood on set aside. It reads here as `reimbursement.get_approval_backlog` reads it: the claim page's status
      // label in place of the status (the gateway's fixed reply prints `status` as it comes), the Thai day that wait
      // began, and nothing of the account, the reason or who sent it back. The label follows what the claim holds
      // while it is with its requester and what was answered while it waits for approval, as on the claim page: a
      // claim with no account is not said to have one under correction, nor a kept account to be new. A claim being cancelled is
      // asked for no account, so the round is not said of it. It waits for no approver and no payer either
      // (both are refused meanwhile): its status reads as the system's wait, the words of the claim page and
      // of the backlog tool for the same claim, never as the status it has not left yet.
      const round = item.cancellationPending ? undefined : item.payoutCorrection;
      const paymentBlockNotice = item.duplicateBlocksPayment ? reimbursementDuplicateBlockNotice(item.duplicateReasons, item.status === 'FINANCE_REVIEW', {
        status: item.status, canCancel: mayCancelReimbursement(toCtx(ctx), item),
        cancellationPending: item.cancellationPending,
        canResumeCancellation: item.pendingCancellation?.canResume,
      }) : undefined;
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: item.id, requestNo: item.requestNo ?? null, requesterDisplayName: item.requesterDisplayNameSnapshot,
          title: item.title ?? null, reason: item.reason, category: item.categoryLabelSnapshot ?? item.categoryKey,
          amount: item.amount, currency: item.currency, incurredDate: item.incurredDate,
          status: item.cancellationPending ? REIMBURSEMENT_SYSTEM_WAIT_LABEL
            : reimbursementDuplicateWait(item)?.status ?? (round && reimbursementPayoutRoundStatus({ payoutCorrectionPhase: round.phase, payoutMethod: item.payoutMethod, payoutCorrectionAnswer: item.payoutCorrectionAnswer }))
              ?? item.status,
          ...(round?.phase === 'AWAITING_REQUESTER' && {
            sentBackOn: civilDate(new Date(round.requestedAt)), note: REIMBURSEMENT_PAYOUT_ROUND_TEXTS.held[reimbursementPayoutHeld(item)].assistantNote,
          }),
          ...(round?.phase === 'AWAITING_APPROVAL' && round.submittedAt && { resubmittedOn: civilDate(new Date(round.submittedAt)) }),
          financeReviewStatus: item.financeReviewStatus, paymentStatus: item.paymentStatus,
          receiptRequirementStatus: item.receiptRequirementStatus, postingStatus: item.postingStatus,
          paymentTotalAmount: item.paymentTotalAmount, outstandingAmount: item.outstandingAmount,
          // Count only: line detail would blow up a LINE payload for no read value.
          lineCount: item.lineCount,
          // A step a correction round set aside is history: it is not the approval the claim stands on.
          approvalSteps: item.approvalSteps.filter((step) => step.invalidatedReason !== PAYOUT_CORRECTION_STEP_REASON).slice(0, 10)
            .map((step) => ({ status: step.status, sequence: step.sequenceNo, actedAt: step.decidedAt ?? null })),
          payments: item.payments.map((payment) => ({ paymentNo: payment.paymentNo, status: payment.status, paidAmount: payment.paidAmount, paidAt: payment.paidAt })),
          duplicateCount: item.duplicateCandidates.length,
          ...(item.duplicateBlocksPayment && {
            duplicateBlocksPayment: true,
            paymentBlockNotice,
            // The general accounting reader consumes message; the compiled claim reply consumes paymentBlockNotice.
            message: paymentBlockNotice,
          }),
        },
        sourceRefs: [source(ctx, asOf, item.requestNo ?? 'รายการเบิกจ่าย', 'reimbursements', 'reimbursement', item.id, `/companies/${ctx.companyId}/reimbursements/${item.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลเบิกจ่าย', 'reimbursements', 'reimbursement_query', undefined, `/companies/${ctx.companyId}/reimbursements`));
  }
}
