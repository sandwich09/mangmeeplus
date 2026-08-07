import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { RequestContext, SourceRef, ToolResult } from '@watchdog-bms/contracts';
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
            description: line.description, quantity: line.quantity,
            unitPrice: line.unitPrice, lineTotalAmount: line.lineTotalAmount,
          })),
          attachmentCount: expense.attachments.length,
        },
        sourceRefs: [source(ctx, asOf, expense.expenseNumber ?? 'ค่าใช้จ่าย', 'expenses', 'expense', expense.id, `/companies/${ctx.companyId}/expenses/${expense.id}`)],
      };
    }, source(ctx, asOf, 'ข้อมูลค่าใช้จ่าย', 'expenses', 'expense_query', undefined, `/companies/${ctx.companyId}/expenses`));
  }
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
