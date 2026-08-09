CREATE INDEX "AccountingDocument_companyId_sourceDocumentId_idx"
ON "AccountingDocument"("companyId", "sourceDocumentId");

CREATE INDEX "AccountingDocument_companyId_convertedFromDocumentId_idx"
ON "AccountingDocument"("companyId", "convertedFromDocumentId");
