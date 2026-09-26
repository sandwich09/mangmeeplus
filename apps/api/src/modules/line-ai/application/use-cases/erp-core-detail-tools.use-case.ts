import { ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
import { EXPENSE_STATUS_LABELS } from '@watchdog-bms/contracts';
import { listRecentLineCaptureCandidates } from '../../../expenses/application/services/line-recent-capture';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { LineDraftUpdateUseCase } from '../../../expenses/application/use-cases/line-draft-update.use-case';
import { GetProductUseCase } from '../../../inventory/application/use-cases/list-products.use-case';
import { GetDocumentUseCase, ListDocumentsUseCase } from '../../../accounting-documents/application/use-cases/document.use-case';
import { GetExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { GetReimbursementDetailUseCase } from '../../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { GetReimbursementAiSummaryUseCase } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';

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
          lines: (doc.lines ?? []).slice(0, 10).map((line) => ({
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
    const asOf = now();
    return safely(this.toolName, asOf, 'RECEIVABLE_UNAVAILABLE', async () => {
      let page = 1;
      let openCount = 0;
      const totals = new Map<string, Decimal>();
      const due: Array<{ id: string; documentNumber: string; dueDate: string | null; outstandingAmount: string; currency: string; paymentStatus: string }> = [];
      while (true) {
        const result = await this.listDocuments.execute(toCtx(ctx), { documentType: 'INVOICE', page, pageSize: 100 });
        for (const doc of result.data) {
          let outstanding: Decimal;
          try { outstanding = new Decimal(doc.outstandingAmount); }
          catch { continue; }
          if (doc.status === 'VOIDED' || !outstanding.isFinite() || outstanding.lte(0)) continue;
          openCount += 1;
          totals.set(doc.currency, (totals.get(doc.currency) ?? new Decimal(0)).add(outstanding));
          if (due.length < 10) due.push({
            id: doc.id, documentNumber: doc.documentNumber ?? doc.id,
            dueDate: doc.dueDate?.toISOString() ?? null, outstandingAmount: doc.outstandingAmount,
            currency: doc.currency, paymentStatus: doc.paymentStatus ?? 'UNPAID',
          });
        }
        if (page * result.pageSize >= result.total) break;
        page += 1;
      }
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          basis: 'issued_non_void_invoices_with_positive_outstanding', openCount,
          totalsByCurrency: [...totals].map(([currency, amount]) => ({ currency, outstandingAmount: amount.toFixed(2) })),
          items: due,
        },
        sourceRefs: [source(ctx, asOf, 'ลูกหนี้คงค้าง', 'accounting-documents', 'receivable_summary', undefined, `/companies/${ctx.companyId}/accounting`)],
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
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: expense.id, expenseNumber: expense.expenseNumber, status: expense.status,
          captureSource: expense.captureSource, branchId: expense.branchId,
          vendorName: expense.vendorNameSnapshot, vendorDocumentNumber: expense.vendorDocumentNumber,
          expenseDate: expense.expenseDate.toISOString(), dueDate: expense.dueDate?.toISOString() ?? null,
          currency: expense.currency, vatMode: expense.vatMode, inputVatClaimStatus: expense.inputVatClaimStatus,
          subtotalAmount: expense.subtotalAmount, discountAmount: expense.discountAmount,
          taxableAmount: expense.taxableAmount, vatAmount: expense.vatAmount, whtAmount: expense.whtAmount,
          grandTotalAmount: expense.grandTotalAmount, netPayableAmount: expense.netPayableAmount,
          paidAmount: expense.paidAmount, outstandingAmount: expense.outstandingAmount,
          paymentStatus: expense.paymentStatus, duplicateStatus: expense.duplicateStatus,
          taxEvidenceStatus: expense.taxEvidenceStatus, postingStatus: expense.postingStatus,
          lines: expense.lines.slice(0, 10).map((line) => ({
            description: line.description, chargeKind: line.chargeKind ?? null, quantity: line.quantity,
            unitPrice: line.unitPrice, lineTotalAmount: line.lineTotalAmount,
          })),
          // Spec §5.1: the additional charges as their own group, so an answer about a bill can say
          // "ค่าบริการ 152.00" instead of reading a charge back as one more product line.
          charges: expense.charges,
          attachmentCount: expense.attachments.length,
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
            products: products.slice(0, 10).map((line) => ({
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
      return {
        toolName: this.toolName, status: 'ok', asOf,
        data: {
          id: item.id, requestNo: item.requestNo ?? null, requesterDisplayName: item.requesterDisplayNameSnapshot,
          title: item.title ?? null, reason: item.reason, category: item.categoryLabelSnapshot ?? item.categoryKey,
          amount: item.amount, currency: item.currency, incurredDate: item.incurredDate,
          status: item.status, financeReviewStatus: item.financeReviewStatus, paymentStatus: item.paymentStatus,
          receiptRequirementStatus: item.receiptRequirementStatus, postingStatus: item.postingStatus,
          paymentTotalAmount: item.paymentTotalAmount, outstandingAmount: item.outstandingAmount,
          // Count only: line detail would blow up a LINE payload for no read value.
          lineCount: item.lineCount,
          approvalSteps: item.approvalSteps.slice(0, 10).map((step) => ({ status: step.status, sequence: step.sequenceNo, actedAt: step.decidedAt ?? null })),
          payments: item.payments.slice(0, 10).map((payment) => ({ paymentNo: payment.paymentNo, status: payment.status, paidAmount: payment.paidAmount, paidAt: payment.paidAt })),
          duplicateCount: item.duplicateCandidates.length,
        },
        sourceRefs: [source(ctx, asOf, item.requestNo ?? 'รายการเบิกจ่าย', 'reimbursements', 'reimbursement', item.id, `/companies/${ctx.companyId}/reimbursements/${item.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลเบิกจ่าย', 'reimbursements', 'reimbursement_query', undefined, `/companies/${ctx.companyId}/reimbursements`));
  }
}
