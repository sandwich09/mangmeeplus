import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  RequestContext,
  ResolveTransactionTaxPreviewDto,
  TransactionTaxContext,
} from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import { TransactionTaxConfigUseCase } from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import type { ExpenseLineInput } from '../../domain/models/expense.model';
import { validateExpenseLineVatTreatments } from '../../domain/logic/expense-draft-amount-validation.logic';

export type ExpenseTaxLineSelection = {
  taxCodeDefinitionId?: string;
  externalTaxCode?: string;
  transactionContext?: TransactionTaxContext;
  evidenceRefs?: string[];
  authoritativeCustomsValue?: string;
  authoritativeDutyAmount?: string;
  authoritativeExciseAmount?: string;
  authoritativeOtherTaxAmount?: string;
  authoritativeImportVatAmount?: string;
  // Client-supplied taxComponents/account ids are deliberately not part of this trust boundary.
};

@Injectable()
export class ExpenseTransactionTaxService {
  constructor(private readonly transactionTax: TransactionTaxConfigUseCase) {}

  async resolveLines(
    ctx: RequestContext,
    header: { expenseId: string; branchId?: string; expenseDate: string; currency: string; preserveAcceptedVat?: boolean },
    lines: Array<ExpenseLineInput & ExpenseTaxLineSelection>,
    mode: 'DRAFT' | 'FINAL' = 'DRAFT',
    db?: any,
  ): Promise<ExpenseLineInput[]> {
    const treatmentError = validateExpenseLineVatTreatments(lines);
    if (treatmentError) throw new BadRequestException(treatmentError);
    return Promise.all(lines.map(async (line) => {
      if (!line.taxCodeDefinitionId && !line.externalTaxCode) return line;
      const context = line.transactionContext ?? 'DOMESTIC_PURCHASE';
      const sourceLineId = line.sourceLineId ?? `line:${line.lineNumber}`;
      const evidenceRefs = line.evidenceRefs ?? (mode === 'FINAL'
        ? await this.transactionTax.listVerifiedEvidenceIdsForSource(ctx, {
          sourceType: 'expense.record', sourceId: header.expenseId, sourceLineId,
          transactionContext: context, branchId: header.branchId,
        }, db) : undefined);
      const input = {
          branchId: header.branchId,
          sourceType: 'expense.record', sourceId: header.expenseId, sourceLineId,
          transactionContext: context, documentDate: header.expenseDate, currency: header.currency,
          taxCodeDefinitionId: line.taxCodeDefinitionId, externalTaxCode: line.externalTaxCode,
          netAmount: line.taxableAmount, grossAmount: line.lineTotalAmount,
          enteredTaxAmount: line.vatAmount, evidenceRefs,
          authoritativeCustomsValue: line.authoritativeCustomsValue,
          authoritativeDutyAmount: line.authoritativeDutyAmount,
          authoritativeExciseAmount: line.authoritativeExciseAmount,
          authoritativeOtherTaxAmount: line.authoritativeOtherTaxAmount,
          authoritativeImportVatAmount: line.authoritativeImportVatAmount,
        };
      const internal = mode === 'FINAL' && header.preserveAcceptedVat && context === 'DOMESTIC_PURCHASE'
        ? { acceptedExpenseVatRate: line.vatRate ?? undefined } : undefined;
      let preview: ResolveTransactionTaxPreviewDto;
      try {
        preview = db
          ? await this.transactionTax.resolveSourceTaxInTransaction(ctx, input, mode, db, undefined, context === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT', 'expense', internal)
          : await this.transactionTax.resolveSourceTax(ctx, input, mode, undefined, context === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT', 'expense', internal);
      } catch (error) {
        const response = (error as { getResponse?: () => any }).getResponse?.();
        if (internal && response?.code === 'transaction_tax_needs_review') {
          const errors: string[] = response.preview?.errors ?? [];
          if (errors.includes('accepted_expense_vat_rate_conflict')) {
            throw new BadRequestException({ code: 'EXPENSE_VAT_TAX_RATE_CONFLICT', message: 'The expense VAT rate conflicts with its Tax Code. Correct the rate or Tax Code first.' });
          }
          if (errors.includes('entered_tax_amount_outside_tolerance')) {
            throw new BadRequestException({ code: 'EXPENSE_VAT_TAX_TOLERANCE_REQUIRED', message: 'Document VAT exceeds the Tax Code tolerance. Review the document and Tax Code; accepting document VAT cannot bypass this tax rule.' });
          }
        }
        throw error;
      }
      const isVat = preview.snapshot.taxRegime === 'VAT' || preview.snapshot.taxRegime === 'IMPORT_VAT';
      if (line.vatTreatment && isVat) {
        const expectedTreatments = line.vatTreatment === 'NON_VAT' ? ['NON_TAXABLE', 'OUTSIDE_SCOPE'] : [line.vatTreatment];
        if (!new Decimal(preview.snapshot.taxRate).isZero() || !expectedTreatments.includes(preview.snapshot.taxTreatment ?? '')) {
          throw new BadRequestException(`Line ${line.lineNumber} VAT treatment conflicts with the selected Tax Code.`);
        }
      }
      return {
        ...line,
        vatRate: isVat
          // Expense's legacy/source contract stores VAT as a fraction (0.07),
          // while item 11B Tax Code snapshots store the percentage (7).
          ? new Decimal(preview.snapshot.taxRate).div(100).toString() : line.vatRate,
        taxSnapshot: preview.snapshot,
        taxComponents: preview.components,
      };
    }));
  }
}
