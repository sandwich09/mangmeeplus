ALTER TABLE "AccountingCounterparty" ADD CONSTRAINT "AccountingCounterparty_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankReconciliationMatch" ADD CONSTRAINT "BankReconciliationMatch_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankAdjustment" ADD CONSTRAINT "BankAdjustment_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "BankReconciliationSession" ADD CONSTRAINT "BankReconciliationSession_companyId_id_key" UNIQUE ("companyId", "id");

ALTER TABLE "AccountingDocument" DROP CONSTRAINT "AccountingDocument_counterpartyId_fkey";
ALTER TABLE "AccountingDocument"
  ADD CONSTRAINT "AccountingDocument_companyId_counterpartyId_fkey"
  FOREIGN KEY ("companyId", "counterpartyId") REFERENCES "AccountingCounterparty"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingDocument"
  ADD CONSTRAINT "AccountingDocument_companyId_branchId_fkey"
  FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountingDocumentLine" DROP CONSTRAINT "AccountingDocumentLine_documentId_fkey";
ALTER TABLE "AccountingDocumentLine"
  ADD CONSTRAINT "AccountingDocumentLine_companyId_documentId_fkey"
  FOREIGN KEY ("companyId", "documentId") REFERENCES "AccountingDocument"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountingPayment" DROP CONSTRAINT "AccountingPayment_counterpartyId_fkey";
ALTER TABLE "AccountingPayment"
  ADD CONSTRAINT "AccountingPayment_companyId_counterpartyId_fkey"
  FOREIGN KEY ("companyId", "counterpartyId") REFERENCES "AccountingCounterparty"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingPayment"
  ADD CONSTRAINT "AccountingPayment_companyId_branchId_fkey"
  FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountingPaymentAllocation" DROP CONSTRAINT "AccountingPaymentAllocation_paymentId_fkey";
ALTER TABLE "AccountingPaymentAllocation" DROP CONSTRAINT "AccountingPaymentAllocation_documentId_fkey";
ALTER TABLE "AccountingPaymentAllocation"
  ADD CONSTRAINT "AccountingPaymentAllocation_companyId_paymentId_fkey"
  FOREIGN KEY ("companyId", "paymentId") REFERENCES "AccountingPayment"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingPaymentAllocation"
  ADD CONSTRAINT "AccountingPaymentAllocation_companyId_documentId_fkey"
  FOREIGN KEY ("companyId", "documentId") REFERENCES "AccountingDocument"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_companyId_branchId_fkey"
  FOREIGN KEY ("companyId", "branchId") REFERENCES "Branch"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankStatementImport" DROP CONSTRAINT "BankStatementImport_bankAccountId_fkey";
ALTER TABLE "BankStatementImport"
  ADD CONSTRAINT "BankStatementImport_companyId_bankAccountId_fkey"
  FOREIGN KEY ("companyId", "bankAccountId") REFERENCES "BankAccount"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankStatementLine" DROP CONSTRAINT "BankStatementLine_bankAccountId_fkey";
ALTER TABLE "BankStatementLine" DROP CONSTRAINT "BankStatementLine_importId_fkey";
ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_companyId_bankAccountId_fkey"
  FOREIGN KEY ("companyId", "bankAccountId") REFERENCES "BankAccount"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementLine"
  ADD CONSTRAINT "BankStatementLine_companyId_importId_fkey"
  FOREIGN KEY ("companyId", "importId") REFERENCES "BankStatementImport"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankReconciliationMatch" DROP CONSTRAINT "BankReconciliationMatch_bankAccountId_fkey";
ALTER TABLE "BankReconciliationMatch" DROP CONSTRAINT "BankReconciliationMatch_statementLineId_fkey";
ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_companyId_bankAccountId_fkey"
  FOREIGN KEY ("companyId", "bankAccountId") REFERENCES "BankAccount"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_companyId_statementLineId_fkey"
  FOREIGN KEY ("companyId", "statementLineId") REFERENCES "BankStatementLine"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankAdjustment" DROP CONSTRAINT "BankAdjustment_bankAccountId_fkey";
ALTER TABLE "BankAdjustment"
  ADD CONSTRAINT "BankAdjustment_companyId_bankAccountId_fkey"
  FOREIGN KEY ("companyId", "bankAccountId") REFERENCES "BankAccount"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankReconciliationSession" DROP CONSTRAINT "BankReconciliationSession_bankAccountId_fkey";
ALTER TABLE "BankReconciliationSession"
  ADD CONSTRAINT "BankReconciliationSession_companyId_bankAccountId_fkey"
  FOREIGN KEY ("companyId", "bankAccountId") REFERENCES "BankAccount"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankReconciliationSessionLine" DROP CONSTRAINT "BankReconciliationSessionLine_sessionId_fkey";
ALTER TABLE "BankReconciliationSessionLine" DROP CONSTRAINT "BankReconciliationSessionLine_statementLineId_fkey";
ALTER TABLE "BankReconciliationSessionLine"
  ADD CONSTRAINT "BankReconciliationSessionLine_companyId_sessionId_fkey"
  FOREIGN KEY ("companyId", "sessionId") REFERENCES "BankReconciliationSession"("companyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationSessionLine"
  ADD CONSTRAINT "BankReconciliationSessionLine_companyId_statementLineId_fkey"
  FOREIGN KEY ("companyId", "statementLineId") REFERENCES "BankStatementLine"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankReconciliationEvidenceExport" DROP CONSTRAINT "BankReconciliationEvidenceExport_sessionId_fkey";
ALTER TABLE "BankReconciliationEvidenceExport"
  ADD CONSTRAINT "BankReconciliationEvidenceExport_companyId_sessionId_fkey"
  FOREIGN KEY ("companyId", "sessionId") REFERENCES "BankReconciliationSession"("companyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
