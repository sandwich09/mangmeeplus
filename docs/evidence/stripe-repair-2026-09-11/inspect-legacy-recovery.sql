-- R01: diagnostic only. No row is approved for activation by this report.
-- Run on an explicitly selected database after its environment operations protocol.
-- A future term with DISABLED status may be a legitimate admin/security hold.
BEGIN TRANSACTION READ ONLY;
SELECT c.id AS "companyId", c.status, t."termEndsAt", t."termDisabledAt",
       r.id AS "lastRenewalAuditId", r."createdAt" AS "lastRenewedAuditAt",
       l.id AS "lastLifecycleAuditId", l."createdAt" AS "lastLifecycleAuditAt",
       l."metadataJson"->>'toStatus' AS "lastLifecycleTarget",
       CASE WHEN r.id IS NULL THEN 'INSUFFICIENT_EVIDENCE'
            WHEN l."createdAt" >= r."createdAt"
                 AND l."metadataJson"->>'toStatus' IN ('DISABLED', 'SUSPENDED', 'ARCHIVED')
                 AND l."actorUserId" IS NOT NULL THEN 'LATER_ADMIN_HOLD_REVIEW'
            ELSE 'REVIEW_RENEWAL_AND_HOLD_HISTORY'
       END AS "reviewReason"
FROM "Company" c
JOIN "CompanyPlanTerm" t ON t."companyId" = c.id
LEFT JOIN LATERAL (
  SELECT id, "createdAt" FROM "AuditLog"
  WHERE "targetId" = c.id AND action = 'system.company_plan_term.renew' AND result = 'SUCCESS'
  ORDER BY "createdAt" DESC, id DESC LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT id, "createdAt", "metadataJson", "actorUserId" FROM "AuditLog"
  WHERE "targetId" = c.id AND action = 'system.partner_company.lifecycle.transition' AND result = 'SUCCESS'
  ORDER BY "createdAt" DESC, id DESC LIMIT 1
) l ON true
WHERE c.status = 'DISABLED' AND t."termEndsAt" > CURRENT_TIMESTAMP
ORDER BY c.id;
ROLLBACK;
