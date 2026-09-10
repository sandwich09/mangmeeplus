import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { ReimbursementRequestRecord, MaterializeClaimExpenseItem } from '../../domain/models/reimbursement.model';
import { normalizeReimbursementAmount } from '../../domain/logic/reimbursement.logic';
import type { ExpenseLineChargeKind } from '@watchdog-bms/contracts';
import { calcDocumentTotals, expenseTotalsIdentityError } from '../../../expenses/domain/logic/expense-totals.logic';

/**
 * Pure mapping for the caller-owned projection transaction. Every claim line
 * gets its own employee-payable projection. A pre-linked company expense stays
 * evidence only; reusing it would silently change its accounting identity.
 */
@Injectable()
export class MaterializeClaimExpensesService {
  buildItems(request: ReimbursementRequestRecord): MaterializeClaimExpenseItem[] {
    const vendorNameSnapshot = `เบิกคืนพนักงาน: ${request.requesterDisplayNameSnapshot}`;
    const lineCount = (request.lines ?? []).length;
    return (request.lines ?? []).map((line): MaterializeClaimExpenseItem => {
      // Single line, no VAT: Decimal-safe satang normalization keeps the claim
      // and its expense projection byte-equivalent even at storage boundaries.
      const amount = normalizeReimbursementAmount(line.amount);
      const zero = '0.0000';
      const description = line.purpose ? `${line.description} (${line.purpose})` : line.description;
      return {
        reimbursementLineId: line.id,
        branchId: request.branchId ?? null,
        currency: request.currency,
        expenseDate: line.incurredDate,
        description,
        vendorNameSnapshot,
        attachmentId: line.sourceExpenseSnapshot ? null : line.attachmentId ?? null,
        // No receipt on this line: carry the request's missing-receipt reason so
        // finance does not retype it. Lines with an attachment leave it null.
        missingReceiptReason: line.attachmentId || line.sourceExpenseSnapshot ? null : (request.missingReceiptReason ?? null),
        // Created READY_FOR_CONFIRMATION so finance confirms it on the normal
        // expense path (numbering/outbox/postingStatus behave identically to a
        // manual confirm). captureSource API_INTERNAL: no user upload happened.
        //
        // Born review-complete (owner decision 2026-08-10): the projection is confirmed
        // in the same finance-approval saga, and a CONFIRMED expense is immutable — any
        // NEEDS_REVIEW left here would be un-resolvable forever, flag the accountant
        // hand-off screen red, and block auto-post (TAX_EVIDENCE_NEEDS_REVIEW). The
        // claim's legal instrument is the signed ใบเบิก: gross amount, no VAT split,
        // input VAT non-claimable (employee-held receipts are not company tax invoices;
        // the exceptional claimable case is void-and-rebook as a normal bill).
        status: 'READY_FOR_CONFIRMATION',
        captureSource: 'API_INTERNAL',
        vatMode: 'NO_VAT',
        inputVatClaimStatus: 'NON_CLAIMABLE',
        sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT',
        taxEvidenceStatus: 'SUPPORTING_ONLY',
        // The claim form's own number is the expense's reference document. Suffix the
        // line number on multi-line claims so sibling projections never share a vendor
        // document number (the duplicate scorer treats an exact match as +30).
        vendorDocumentNumber: request.requestNo
          ? (lineCount > 1 ? `${request.requestNo}-${line.lineNo}` : request.requestNo)
          : null,
        sourceChannelMetadataJson: { cc2VatClaimClassification: 'EXTERNAL_OR_UNRESOLVED', ...(line.sourceExpenseSnapshot ? { reimbursementSource: line.sourceExpenseSnapshot } : {}) },
        ...(line.sourceExpenseSnapshot && { sourceCostLines: line.sourceExpenseSnapshot.lines.map(sourceLine => ({
          description: String(sourceLine.description ?? line.description), chargeKind: (sourceLine.chargeKind as ExpenseLineChargeKind | null) ?? null, amount: String(sourceLine.lineTotalAmount),
          expenseCategoryId: (sourceLine.expenseCategoryId as string | null) ?? line.sourceExpenseSnapshot!.classification.expenseCategoryId,
          accountHintKey: (sourceLine.accountHintKey as string | null) ?? line.sourceExpenseSnapshot!.classification.accountHintKey,
          taxCategory: (sourceLine.taxCategory as string | null) ?? line.sourceExpenseSnapshot!.classification.taxCategory,
        })) }),
        subtotalAmount: amount,
        discountAmount: zero,
        taxableAmount: amount,
        vatAmount: zero,
        whtAmount: zero,
        grandTotalAmount: amount,
        netPayableAmount: amount,
        outstandingAmount: amount,
        line: {
          quantity: '1',
          unitPrice: amount,
          discountAmount: zero,
          taxableAmount: amount,
          vatAmount: zero,
          whtAmount: zero,
          lineSubtotalAmount: amount,
          lineTotalAmount: amount,
        },
      };
    })
      // Keep additional charges/rounding out of the goods subtotal while retaining
      // the full gross cost and original account classification on each source row.
      .map((item) => {
        const lines = item.sourceCostLines ? item.sourceCostLines.map(cost => ({
          chargeKind: cost.chargeKind, lineSubtotalAmount: cost.amount, discountAmount: '0',
          taxableAmount: cost.amount, vatAmount: '0', whtAmount: '0', lineTotalAmount: cost.amount,
        })) : [{ ...item.line, chargeKind: null }];
        if (item.sourceCostLines) {
          const totals = calcDocumentTotals({ lines });
          if (totals.netPayableAmount !== item.netPayableAmount) throw new UnprocessableEntityException('reimbursement_source_fields_mismatch');
          item.subtotalAmount = totals.subtotalAmount;
        }
        const error = expenseTotalsIdentityError({
          vatMode: 'NO_VAT',
          totals: item,
          lines,
        });
        if (error) throw new UnprocessableEntityException(`reimbursement_projection_totals_mismatch: ${error}`);
        return item;
      });
  }
}
