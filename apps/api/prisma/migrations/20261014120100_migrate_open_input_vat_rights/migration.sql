DO $$
DECLARE waiting_count BIGINT; evidence_count BIGINT;
BEGIN
  UPDATE "ExpenseRecord" e SET "inputVatClaimStatus" = 'NEEDS_REVIEW',
    "sourceChannelMetadataJson" = COALESCE(e."sourceChannelMetadataJson", '{}'::jsonb) || '{"inputVatPresetReasonCode":"INPUT_VAT_REVIEW_REQUIRED"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE e.status IN ('DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION')
    AND e."sourceDocumentType" = 'TAX_INVOICE' AND e."vatMode" <> 'NO_VAT' AND e."vatAmount" > 0
    AND e."inputVatClaimStatus" = 'NON_CLAIMABLE'
    AND e."buyerAsPrintedJson"->>'claimStatusBeforeMark' IS NULL
    AND e."sourceReimbursementRequestId" IS NULL
    AND COALESCE(e."aiVerificationSummaryJson" #>> '{documentEvidenceDraft,route}', e."aiVerificationSummaryJson" #>> '{documentReview,assessment,route}', 'SOURCE_DOCUMENT') NOT IN ('SUBSTITUTE_RECEIPT', 'ALTERNATIVE_EVIDENCE')
    AND NOT EXISTS (SELECT 1 FROM "ExpenseSubstituteReceiptEvidence" s WHERE s."companyId" = e."companyId" AND s."expenseId" = e.id AND s.status <> 'SUPERSEDED')
    AND NOT EXISTS (SELECT 1 FROM "ExpenseInputVatDecision" d WHERE d."companyId" = e."companyId" AND d."expenseId" = e.id)
    AND NOT EXISTS (SELECT 1 FROM "ReimbursementLine" l WHERE l."companyId" = e."companyId" AND l."linkedExpenseId" = e.id)
    AND NOT EXISTS (SELECT 1 FROM "ReimbursementRequest" r WHERE r."companyId" = e."companyId" AND r."linkedExpenseId" = e.id)
    AND COALESCE((SELECT f.status::text FROM "CompanyVatRegistrationFact" f WHERE f."companyId" = e."companyId"
      AND f."supersededAt" IS NULL AND f."effectiveFrom" <= e."expenseDate"::date
      AND (f."effectiveTo" IS NULL OR f."effectiveTo" > e."expenseDate"::date)
      ORDER BY f."effectiveFrom" DESC, f."answeredAt" DESC, f.id DESC LIMIT 1), 'UNKNOWN') <> 'NOT_REGISTERED';
  GET DIAGNOSTICS waiting_count = ROW_COUNT;
  UPDATE "ExpenseRecord" SET "taxEvidenceStatus" = 'USABLE_FOR_TAX', "taxEvidenceReasonCode" = 'VALID_RECEIPT_FIELDS',
    "sourceChannelMetadataJson" = COALESCE("sourceChannelMetadataJson", '{}'::jsonb) || '{"inputVatPresetReasonCode":"ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE status IN ('DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION') AND "sourceDocumentType" = 'ABBREVIATED_TAX_INVOICE'
    AND "taxEvidenceStatus" = 'SUPPORTING_ONLY' AND "taxEvidenceReasonCode" = 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE';
  GET DIAGNOSTICS evidence_count = ROW_COUNT;
  RAISE NOTICE 'input VAT migration: % open invoices moved to NEEDS_REVIEW; % abbreviated invoices moved to usable evidence; 0 decision rows invented', waiting_count, evidence_count;
END $$;
