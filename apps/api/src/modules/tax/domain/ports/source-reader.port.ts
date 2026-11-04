// Source reader ports: read finalized accounting documents and expenses for tax event sync.

import type { AccountingOutputTaxCode, BuyerEntityKind, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';

export type TransactionTaxSourceLineRow = {
  inputVatClaimStatus?: string;
  taxEvidenceStatus?: string;
  sourceType: 'accounting.document' | 'expense.record' | 'procurement.vendor_bill';
  sourceId: string;
  sourceLineId: string;
  companyId: string;
  branchId: string | null;
  sourceEventType: string;
  eventDate: Date;
  currency: string;
  vatMode: string | null;
  taxInvoiceNumber: string | null;
  taxComponents: TransactionTaxComponentPreview[];
  updatedAt: Date;
  confirmedAt?: Date | null;
};

export type AccountingDocumentSourceRow = {
  id: string;
  companyId: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: Date;
  vatMode: string;
  outputTaxCode: AccountingOutputTaxCode;
  vatAmount: string;
  taxableAmount: string;
  grandTotalAmount: string;
  taxInvoiceType: string | null;
  taxInvoiceId: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  /** GAP-2: `addressText` off the document's own frozen buyer snapshot, so `payeeSnapshot.address`
   *  is the address that was printed, not whatever the registry says today. */
  counterpartyAddress: string | null;
  branchCode: string | null;
  currency: string;
  updatedAt: Date;
};

export type ExpenseSourceRow = {
  id: string;
  companyId: string;
  expenseDate: Date;
  vatAmount: string;
  whtAmount: string;
  taxableAmount: string;
  grandTotalAmount: string;
  inputVatClaimStatus: string;
  taxEvidenceStatus: string;
  vatMode: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  vendorBranchCode: string | null;
  /** GAP-2 / spec §10: the seller address as printed on the expense's own document. */
  vendorAddress: string | null;
  currency: string;
  updatedAt: Date;
  confirmedAt?: Date | null;
};

// WHT events are derived from confirmed expenses with whtAmount > 0
export type ExpenseWhtSourceRow = {
  whtRemittance?: import('@watchdog-bms/contracts').WhtRemittance | null;
  paymentId?: string;
  sourceLineKey?: string;
  paymentAmount?: string;
  documentDate?: Date;
  branchId?: string | null;
  id: string;
  companyId: string;
  expenseDate: Date;
  whtAmount: string;
  grossAmount: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  vendorBranchCode: string | null;
  /** GAP-2 / spec §10: the payee address 50 ทวิ needs, as printed on the expense's own document. */
  vendorAddress: string | null;
  // Decides ภ.ง.ด.3 vs ภ.ง.ด.53. Null means the payee is not classified yet, not "juristic".
  payeeEntityKind: BuyerEntityKind | null;
  incomeCategoryCode: string | null;
  whtRate: string | null;
  currency: string;
  updatedAt: Date;
  confirmedAt?: Date | null;
};

// WHT events derived from recorded supplier payments that withheld tax. The other seam for the same
// forms: an expense records tax withheld when the cost was captured, this one when the money left.
export type SupplierPaymentWhtSourceRow = {
  id: string;
  companyId: string;
  branchId: string | null;
  paymentDate: Date;
  whtAmount: string;
  /** The income withheld on — derived from the rate, NOT the VAT-inclusive payment gross. */
  grossAmount: string | null;
  payeeName: string | null;
  payeeTaxId: string | null;
  payeeBranchCode: string | null;
  /** GAP-2 / spec §10: a payment has no printed document of its own, so this comes from the
   *  counterparty registry (`SupplierProfile.counterparty.billingAddressJson`) — never
   *  `SupplierProfile.addressJson`, which is free-form procurement data (CON-9). */
  payeeAddress: string | null;
  /** Decides ภ.ง.ด.3 vs ภ.ง.ด.53. Null or an unmapped class means unclassified, not "juristic". */
  supplierType: string | null;
  incomeCategoryCode: string | null;
  /** PERCENT ('3.0000' = 3%) — already the unit every WHT consumer expects. */
  whtRate: string | null;
  currency: string;
  updatedAt: Date;
};

export interface AccountingDocumentSourcePort {
  findIssuedWithVatByCompany(companyId: string, since?: Date): Promise<AccountingDocumentSourceRow[]>;
  findFinalizedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]>;
  findVoidedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]>;
}

export interface ExpenseSourcePort {
  findConfirmedWithVatByCompany(companyId: string, since?: Date): Promise<ExpenseSourceRow[]>;
  findConfirmedWithWhtByCompany(companyId: string, since?: Date, filter?: { expenseIds?: string[] }): Promise<ExpenseWhtSourceRow[]>;
  findFinalizedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]>;
  findVoidedTransactionTaxLines(companyId: string, since?: Date): Promise<TransactionTaxSourceLineRow[]>;
}

export interface SupplierPaymentSourcePort {
  findRecordedWithWhtByCompany(companyId: string, since?: Date): Promise<SupplierPaymentWhtSourceRow[]>;
}
