-- Retain monthly rows and their number FKs/idempotency keys. The new yearly counter only moves forward.
WITH used AS (
  SELECT "companyId", left("periodKey", 4) AS year, ("nextNumber" - 1)::numeric AS value
  FROM "DocumentSequence"
  WHERE "documentType" = 'tax.wht_certificate' AND "periodKey" ~ '^[0-9]{4}(-[0-9]{2})?$'
  UNION ALL
  SELECT "companyId", substring("documentNumber" FROM '^WHT-([0-9]{4})-'),
    substring("documentNumber" FROM '^WHT-[0-9]{4}-([0-9]+)$')::numeric
  FROM "DocumentNumber"
  WHERE "documentType" = 'tax.wht_certificate' AND "documentNumber" ~ '^WHT-[0-9]{4}-[0-9]+$'
  UNION ALL
  SELECT "companyId", substring("certificateNumber" FROM '^WHT-([0-9]{4})-'),
    substring("certificateNumber" FROM '^WHT-[0-9]{4}-([0-9]+)$')::numeric
  FROM "WhtCertificate" WHERE "certificateNumber" ~ '^WHT-[0-9]{4}-[0-9]+$'
), maxima AS (
  SELECT "companyId", year, greatest(1, max(value) + 1)::integer AS next_number
  FROM used GROUP BY "companyId", year
)
INSERT INTO "DocumentSequence" (
  id, "companyId", "branchScopeKey", "documentType", "periodKey", "prefixTemplate", "nextNumber",
  padding, "resetPolicy", status, "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"
)
SELECT 'wht-year-' || md5(m."companyId" || ':' || m.year), m."companyId", 'GLOBAL', 'tax.wht_certificate', m.year,
  coalesce(config."prefixTemplate", 'WHT-{YYYY}-{SEQ}'), m.next_number, coalesce(config.padding, 5),
  'YEARLY'::"DocumentResetPolicy", coalesce(config.status, 'ACTIVE'::"DocumentSequenceStatus"),
  config."createdByUserId", config."updatedByUserId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM maxima m
LEFT JOIN LATERAL (
  SELECT * FROM "DocumentSequence" s
  WHERE s."companyId" = m."companyId" AND s."documentType" = 'tax.wht_certificate'
  ORDER BY s."periodKey" DESC, s."createdAt" DESC LIMIT 1
) config ON true
ON CONFLICT ("companyId", "branchScopeKey", "documentType", "periodKey") DO UPDATE
SET "nextNumber" = greatest("DocumentSequence"."nextNumber", EXCLUDED."nextNumber"),
  "resetPolicy" = 'YEARLY'::"DocumentResetPolicy", "updatedAt" = CURRENT_TIMESTAMP;
