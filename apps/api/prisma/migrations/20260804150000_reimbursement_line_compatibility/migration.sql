-- Deterministic insert-time defense for the quiesced upgrade wave. Existing headers without a line
-- are repaired; every later header insert receives the same fallback in its transaction. This does
-- not synchronize a later legacy header UPDATE, so no old writer may serve after migration starts.
-- The release controller must retire old tasks while writes remain quiesced; the final writer then
-- replaces the fallback with its submitted lines before committing.

INSERT INTO "ReimbursementLine" (
  "id", "companyId", "reimbursementRequestId", "lineNo", "incurredDate", "description",
  "purpose", "categoryKey", "categoryLabelSnapshot", "amount", "attachmentId", "linkedExpenseId",
  "createdAt", "updatedAt"
)
SELECT
  'rbl_' || request."id",
  request."companyId",
  request."id",
  1,
  request."incurredDate",
  COALESCE(NULLIF(btrim(request."title"), ''), NULLIF(btrim(request."reason"), ''), 'รายการเบิก'),
  NULL,
  request."categoryKey",
  request."categoryLabelSnapshot",
  request."amount",
  request."primaryAttachmentId",
  request."linkedExpenseId",
  request."createdAt",
  request."updatedAt"
FROM "ReimbursementRequest" request
WHERE NOT EXISTS (
  SELECT 1 FROM "ReimbursementLine" line WHERE line."reimbursementRequestId" = request."id"
);

CREATE OR REPLACE FUNCTION public."ensure_reimbursement_request_fallback_line"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public."ReimbursementLine" (
    "id", "companyId", "reimbursementRequestId", "lineNo", "incurredDate", "description",
    "purpose", "categoryKey", "categoryLabelSnapshot", "amount", "attachmentId", "linkedExpenseId",
    "createdAt", "updatedAt"
  ) VALUES (
    'rbl_' || NEW."id",
    NEW."companyId",
    NEW."id",
    1,
    NEW."incurredDate",
    COALESCE(NULLIF(btrim(NEW."title"), ''), NULLIF(btrim(NEW."reason"), ''), 'รายการเบิก'),
    NULL,
    NEW."categoryKey",
    NEW."categoryLabelSnapshot",
    NEW."amount",
    NEW."primaryAttachmentId",
    NEW."linkedExpenseId",
    NEW."createdAt",
    NEW."updatedAt"
  )
  ON CONFLICT ("reimbursementRequestId", "lineNo") DO NOTHING;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "ReimbursementRequest_fallback_line" ON "ReimbursementRequest";
CREATE TRIGGER "ReimbursementRequest_fallback_line"
AFTER INSERT ON "ReimbursementRequest"
FOR EACH ROW
EXECUTE FUNCTION public."ensure_reimbursement_request_fallback_line"();
