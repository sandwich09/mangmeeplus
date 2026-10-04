-- Q1-Q15: counts only; requires the 12 integrated migrations. PostgreSQL 16/18.
-- Q15 also tests the conditional range migration; interpret facts only with all six columns installed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';

-- Q1. Re-run P1 for migration ledger. Expected release tables 9, payout guards 2.
SELECT count(*) AS installed_release_tables FROM information_schema.tables
WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  AND table_name IN ('MemberPayoutAccount', 'ReimbursementPayoutDestination', 'SalesAttributionDeduction', 'CompanyWebEntrySetting',
                     'ExecutiveReportBuild', 'ExecutiveReportMonth', 'ExecutiveCompanyMonth', 'ExecutiveCompanyProfile', 'CompanyTeamNote');
SELECT count(*) AS installed_payout_guards FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND c.relname = 'ReimbursementPayoutDestination' AND NOT t.tgisinternal AND t.tgenabled <> 'D';

-- Q2. Legacy claims are retained; snapshot/payment checks do not reveal even account suffixes.
SELECT (SELECT count(*) FROM "ReimbursementRequest" WHERE status <> 'DRAFT' AND "payoutMethod" IS NULL) AS legacy_submitted_claims,
       (SELECT count(*) FROM "ReimbursementRequest" r WHERE r."payoutMethod" = 'BANK_TRANSFER' AND r.status NOT IN ('DRAFT', 'CANCELLED', 'VOIDED', 'REJECTED')
         AND NOT EXISTS (SELECT 1 FROM "ReimbursementPayoutDestination" d WHERE d."companyId" = r."companyId" AND d."reimbursementRequestId" = r.id AND d.version = r."payoutDestinationVersion" AND d."frozenAt" IS NOT NULL)) AS submitted_bank_claims_without_frozen_destination,
       (SELECT count(*) FROM "ReimbursementPayment" p WHERE p."payoutDestinationVersion" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "ReimbursementPayoutDestination" d WHERE d."companyId" = p."companyId" AND d."reimbursementRequestId" = p."reimbursementRequestId" AND d.version = p."payoutDestinationVersion")) AS payments_with_missing_destination,
       (SELECT count(*) FROM "ReimbursementPayment" WHERE ("slipAttachmentId" IS NULL) <> ("slipChecksumSha256" IS NULL)) AS incomplete_slip_pointer_pairs,
       (SELECT count(*) FROM "ReimbursementRequest" WHERE "payoutCorrectionRequestedAt" IS NOT NULL AND "payoutCorrectionSubmittedAt" IS NULL) AS rounds_waiting_for_requester,
       (SELECT count(*) FROM "ReimbursementRequest" WHERE "payoutCorrectionRequestedAt" IS NOT NULL AND "payoutCorrectionSubmittedAt" IS NOT NULL) AS rounds_waiting_for_approval,
       (SELECT count(*) FROM "ReimbursementPayment" WHERE status = 'RECORDED' AND "postingStatus" = 'posting_error') AS payments_with_posting_error;

-- Q3. Exact stale-task predicate also includes a correction round waiting for its requester.
SELECT count(*) AS stale_approval_tasks
FROM "WorkflowTask" task JOIN "WorkflowRun" run ON run.id = task."workflowRunId"
JOIN "WorkflowRule" rule ON rule.id = run."ruleId" JOIN "WorkflowTemplate" template ON template.id = rule."templateId"
LEFT JOIN "ReimbursementRequest" claim ON claim.id = task."sourceId" AND claim."companyId" = task."companyId"
WHERE task."sourceType" = 'reimbursement_request' AND task."sourceId" IS NOT NULL AND task.status IN ('OPEN', 'SNOOZED')
  AND template.key IN ('reimbursement_pending_approval', 'approval_sla_breach')
  AND (claim.id IS NULL OR claim.status <> 'PENDING_APPROVAL'
       OR (claim."payoutCorrectionRequestedAt" IS NOT NULL AND claim."payoutCorrectionSubmittedAt" IS NULL));

-- Q4. No row means hidden. Stored true is not evidence of entitlement or effective visibility.
SELECT count(*) AS companies,
       count(*) FILTER (WHERE setting.id IS NULL) AS companies_hidden_without_setting_row,
       count(*) FILTER (WHERE setting.id IS NOT NULL AND NOT setting."manualExpenseEntryEnabled") AS companies_with_explicit_hidden_setting,
       count(*) FILTER (WHERE setting."manualExpenseEntryEnabled") AS companies_with_explicit_shown_setting,
       count(*) FILTER (WHERE setting."manualExpenseEntryEnabled" AND setting."updatedBySystemAdminUserId" IS NULL) AS shown_settings_without_recorded_admin
FROM "Company" c LEFT JOIN "CompanyWebEntrySetting" setting ON setting."companyId" = c.id;

-- Q5. No migration backfill; later reads of eligible older provider events can add dated deductions.
SELECT count(*) AS sales_deductions,
       count(*) FILTER (WHERE d.kind NOT IN ('REFUND', 'DISPUTE') OR d."amountSatang" <= 0) AS invalid_deduction_rows,
       count(*) FILTER (WHERE a.id IS NULL) AS orphan_deductions,
       (SELECT count(*) FROM "SalesAttribution" attribution WHERE attribution."refundedSatang" + COALESCE((SELECT sum(x."amountSatang") FROM "SalesAttributionDeduction" x WHERE x."attributionId" = attribution.id), 0) > attribution."amountSatang") AS attributions_deducted_above_credit
FROM "SalesAttributionDeduction" d LEFT JOIN "SalesAttribution" a ON a.id = d."attributionId";

-- Q6. Single-admin markers must carry a reason; no destructive production acceptance is required.
SELECT (SELECT count(*) FROM "DataRightsCase" WHERE ("approvalSingleAdmin" AND length(btrim(COALESCE("approvalSingleAdminReason", ''))) < 20)
         OR ("executionSingleAdmin" AND length(btrim(COALESCE("executionSingleAdminReason", ''))) < 20)
         OR ("verificationSingleAdmin" AND length(btrim(COALESCE("verificationSingleAdminReason", ''))) < 20)
         OR ("completionSingleAdmin" AND length(btrim(COALESCE("completionSingleAdminReason", ''))) < 20)) AS self_steps_with_invalid_reason,
       (SELECT count(*) FROM "DataRightsEvidenceRecord" WHERE "singleAdmin" AND length(btrim(COALESCE("singleAdminReason", ''))) < 20) AS self_evidence_with_invalid_reason,
       (SELECT count(*) FROM "DataRightsCase" WHERE "approvalSingleAdmin" OR "executionSingleAdmin" OR "verificationSingleAdmin" OR "completionSingleAdmin") AS cases_with_explicit_self_step;

-- Q7. Label job has one global marker. NULL labels can be legitimate admin-created/cleared labels.
SELECT (SELECT count(*) FROM "AuditLog" WHERE "requestId" = 'report-label-backfill:v1' AND "targetId" IS NULL) AS report_label_job_markers,
       count(*) FILTER (WHERE c."reportClassification" = 'CUSTOMER') AS customer_companies,
       count(*) FILTER (WHERE c."reportClassification" = 'TEST') AS test_companies,
       count(*) FILTER (WHERE c."reportClassification" = 'INTERNAL') AS internal_companies,
       count(*) FILTER (WHERE c."reportClassification" IS NULL) AS unclassified_companies,
       count(*) FILTER (WHERE c."reportClassification" IS NOT NULL AND c."reportClassification" NOT IN ('CUSTOMER', 'TEST', 'INTERNAL')) AS invalid_classifications,
       count(*) FILTER (WHERE c.id = 'seed-watchdog-system-company' AND c."reportClassification" IS DISTINCT FROM 'INTERNAL') AS platform_classification_mismatches,
       count(*) FILTER (WHERE c.id <> 'seed-watchdog-system-company' AND c."reportClassification" IS NULL AND EXISTS (SELECT 1 FROM "CompanySignupRequest" s WHERE s."companyId" = c.id)) AS unclassified_signup_linked_companies
FROM "Company" c;
SELECT (SELECT count(*) FROM "Permission" WHERE key IN ('system.executive.read', 'system.executive.export', 'system.executive.contact.read', 'system.executive_user.manage', 'system.executive.company_note.manage')) AS executive_permission_keys,
       (SELECT count(*) FROM "Role" WHERE "scopeKey" = 'system' AND "companyId" IS NULL AND "isSystem" AND key IN ('MANGMEE_EXECUTIVE', 'MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_EXECUTIVE_CONTACT', 'MANGMEE_EXECUTIVE_COMPANY_NOTE')) AS executive_system_roles;

-- Q8. Definition version 1 is the inspected branch's version; re-check on the final merge candidate.
WITH latest AS (SELECT * FROM "ExecutiveReportBuild" WHERE "definitionVersion" = 1 ORDER BY "asOf" DESC, id DESC LIMIT 1)
SELECT count(*) AS current_definition_builds,
       (SELECT count(*) FROM latest) AS latest_build_present,
       (SELECT count(*) FROM latest WHERE "asOf" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '2 hours') AS stale_latest_builds,
       count(*) FILTER (WHERE kind = 'FULL' AND "asOf" >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC') AS full_builds_today,
       (SELECT count(*) FROM "ExecutiveCompanyProfile") AS stored_company_profiles,
       (SELECT count(*) FROM "ExecutiveReportMonth" WHERE "definitionVersion" = 1) AS stored_month_headers,
       (SELECT count(*) FROM "ExecutiveCompanyMonth" WHERE "definitionVersion" = 1) AS stored_company_months,
       (SELECT count(*) FROM latest WHERE "companyCount" <> (SELECT count(*) FROM "ExecutiveCompanyProfile")) AS profile_population_mismatches,
       (SELECT count(*) FROM "ExecutiveCompanyProfile" p WHERE NOT EXISTS (SELECT 1 FROM "ExecutiveReportBuild" b WHERE b.id = p."buildId")) AS profiles_without_build,
       (SELECT count(*) FROM "ExecutiveReportMonth" m WHERE NOT EXISTS (SELECT 1 FROM "ExecutiveReportBuild" b WHERE b.id = m."buildId")) AS months_without_build,
       (SELECT count(*) FROM "ExecutiveCompanyMonth" m WHERE NOT EXISTS (SELECT 1 FROM "ExecutiveReportBuild" b WHERE b.id = m."buildId")) AS company_months_without_build
FROM "ExecutiveReportBuild" WHERE "definitionVersion" = 1;

-- Q9. Coverage/warnings are facts, not an assertion that every historical month is complete.
WITH latest AS (SELECT "billingSince", "asOf" FROM "ExecutiveReportBuild" WHERE "definitionVersion" = 1 ORDER BY "asOf" DESC, id DESC LIMIT 1),
months AS (
  SELECT m.*, latest."billingSince" AS billing_since, latest."asOf" AS build_as_of,
         (((m.month || '-01')::date + INTERVAL '1 month') AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC' AS month_end
  FROM "ExecutiveReportMonth" m CROSS JOIN latest WHERE m."definitionVersion" = 1
)
SELECT count(*) FILTER (WHERE billing_since IS NULL OR billing_since >= month_end) AS months_before_billing_collection,
       count(*) FILTER (WHERE billing_since IS NOT NULL AND billing_since < month_end
         AND ("billingCoveredThrough" IS NULL OR "billingCoveredThrough" < LEAST(build_as_of, month_end))) AS months_with_incomplete_payment_scan_coverage,
       count(*) FILTER (WHERE "untiedCount" > 0) AS months_with_untied_money,
       count(*) FILTER (WHERE "unsuccessfulRefundCount" > 0) AS months_with_unsuccessful_refunds,
       count(*) FILTER (WHERE "beforeFirstBuild") AS months_before_first_build,
       count(*) FILTER (WHERE revision > 0) AS revised_months
FROM months;
WITH latest_publications AS (
  SELECT DISTINCT ON ("stripeAccountId", livemode) "proposedJson"
  FROM "BillingOperation" WHERE livemode AND type = 'CONFIGURE_PROVIDER_SCANS' AND state = 'SUCCEEDED'
  ORDER BY "stripeAccountId", livemode, "sourceVersion" DESC, id DESC
)
SELECT (SELECT count(*) FROM latest_publications) AS live_published_scan_schedules,
       (SELECT count(*) FROM latest_publications WHERE "proposedJson" ->> 'enabled' = 'true') AS live_published_schedules_enabled,
       (SELECT count(*) FROM "BillingOperation" WHERE livemode AND type = 'SCAN_PROVIDER_BALANCE' AND "idempotencyKey" LIKE 'scheduled-settlement:%' AND state = 'SUCCEEDED') AS successful_live_daily_balance_scans,
       (SELECT count(*) FROM "BillingOperation" WHERE livemode AND type = 'SCAN_PROVIDER_BALANCE' AND "idempotencyKey" LIKE 'scheduled-settlement:%' AND state IN ('UNKNOWN', 'BLOCKED', 'FAILED')) AS daily_balance_scans_needing_review;

-- Q10. After migration from reported empty production catalog: total 15, ACTIVE 12, DRAFT 3, other 0.
-- Confirmation backlog is still 11 in 3 companies if nobody acted; people must review/confirm.
-- Certificates remain 0 after migration alone; legitimate subsequent issuance can increase the count.
SELECT (SELECT count(*) FROM "WhtIncomeCategory") AS income_categories,
       (SELECT count(*) FROM "WhtIncomeCategory" WHERE status = 'ACTIVE') AS active_income_categories,
       (SELECT count(*) FROM "WhtIncomeCategory" WHERE status = 'DRAFT') AS draft_income_categories,
       (SELECT count(*) FROM "WhtIncomeCategory" WHERE status NOT IN ('ACTIVE', 'DRAFT')) AS other_status_income_categories,
       (SELECT count(*) FROM "ExpenseRecord" WHERE "whtAmount" > 0 AND status NOT IN ('CONFIRMED', 'REJECTED', 'VOIDED')) AS withholding_expenses_awaiting_confirmation,
       (SELECT count(DISTINCT "companyId") FROM "ExpenseRecord" WHERE "whtAmount" > 0 AND status NOT IN ('CONFIRMED', 'REJECTED', 'VOIDED')) AS companies_with_withholding_awaiting_confirmation,
       (SELECT count(*) FROM "WhtCertificate") AS withholding_certificates;

-- Q11. Immediately after migration, before any note edit: table present 1, rows 0.
-- Later user edits/clears retain rows, so a nonzero row count is then legitimate.
SELECT CASE WHEN to_regclass('"CompanyTeamNote"') IS NULL THEN 0 ELSE 1 END AS company_team_note_table_present,
       (SELECT count(*) FROM "CompanyTeamNote") AS company_team_note_rows;

-- Q12. After sync: keys 2, role 1, required grant pairs 3, unexpected grant pairs 0.
WITH grants AS (
  SELECT r.key AS role_key, r."scopeKey", r."companyId", r."isSystem", p.key AS permission_key
  FROM "RolePermission" rp JOIN "Role" r ON r.id = rp."roleId" JOIN "Permission" p ON p.id = rp."permissionId"
  WHERE p.key IN ('system.wht_income_category.manage', 'system.executive.company_note.manage')
), required(role_key, permission_key) AS (VALUES
  ('SYSTEM_ADMIN', 'system.wht_income_category.manage'),
  ('SYSTEM_ADMIN', 'system.executive.company_note.manage'),
  ('MANGMEE_EXECUTIVE_COMPANY_NOTE', 'system.executive.company_note.manage')
)
SELECT (SELECT count(*) FROM "Permission" WHERE key IN ('system.wht_income_category.manage', 'system.executive.company_note.manage')) AS new_permission_keys,
       (SELECT count(*) FROM "Role" WHERE key = 'MANGMEE_EXECUTIVE_COMPANY_NOTE' AND "scopeKey" = 'system' AND "companyId" IS NULL AND "isSystem" AND status = 'ACTIVE') AS company_note_system_roles,
       (SELECT count(*) FROM required WHERE EXISTS (SELECT 1 FROM grants g
         WHERE g.role_key = required.role_key AND g.permission_key = required.permission_key
           AND g."scopeKey" = 'system' AND g."companyId" IS NULL AND g."isSystem")) AS required_grant_pairs_present,
       (SELECT count(*) FROM grants g WHERE NOT EXISTS (SELECT 1 FROM required
         WHERE required.role_key = g.role_key AND required.permission_key = g.permission_key
           AND g."scopeKey" = 'system' AND g."companyId" IS NULL AND g."isSystem")) AS unexpected_grant_pairs;

-- Q13. Same support inventory as P11; no automatic policy/assignment rewrite, no zero target.
WITH pending AS (
  SELECT r.id, r."companyId", r."requesterUserId", r."approvalPolicySnapshotJson", s."approverUserId",
         CASE WHEN jsonb_typeof(s."assignedApproverUserIdsJson") = 'array'
              THEN s."assignedApproverUserIdsJson" ELSE '[]'::jsonb END AS assigned
  FROM "ReimbursementRequest" r JOIN "ReimbursementApprovalStep" s
    ON s.id = r."currentApprovalStepId" AND s."reimbursementRequestId" = r.id AND s."companyId" = r."companyId"
  WHERE r.status = 'PENDING_APPROVAL' AND s.status = 'PENDING' AND s."invalidatedAt" IS NULL
), sole_requester AS (
  SELECT * FROM pending p
  WHERE (jsonb_array_length(p.assigned) > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.assigned) a(value)
                         WHERE a.value IS DISTINCT FROM to_jsonb(p."requesterUserId")))
     OR (jsonb_array_length(p.assigned) = 0 AND p."approverUserId" = p."requesterUserId")
)
SELECT (SELECT count(DISTINCT "companyId") FROM "ReimbursementPolicy" WHERE status = 'ACTIVE' AND NOT "allowSelfApproval") AS companies_with_active_self_approval_off_policy,
       count(*) AS pending_claims_assigned_only_to_requester,
       count(*) FILTER (WHERE "approvalPolicySnapshotJson" ->> 'allowSelfApproval' = 'false') AS sole_requester_claims_with_frozen_self_approval_off,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ReimbursementPolicy" policy
         WHERE policy."companyId" = sole_requester."companyId" AND policy.status = 'ACTIVE' AND NOT policy."allowSelfApproval")) AS sole_requester_claims_in_companies_with_off_policy
FROM sole_requester;

-- Q14. Same surviving-history count as P12; legacy nonzero does not fail release.
-- New BLOCK_PAYMENT recordings must not pass an unresolved duplicate. Counts alone cannot date the fix.
WITH payments_with_observable_open_candidate AS (
  SELECT p.id, p."reimbursementRequestId", p.status, r."approvalPolicySnapshotJson"
  FROM "ReimbursementPayment" p JOIN "ReimbursementRequest" r
    ON r.id = p."reimbursementRequestId" AND r."companyId" = p."companyId"
  WHERE EXISTS (
    SELECT 1 FROM "ExpenseRecord" e JOIN "ExpenseDuplicateCandidate" d
      ON d."expenseId" = e.id AND d."companyId" = e."companyId"
    WHERE e."sourceReimbursementRequestId" = r.id AND e."companyId" = r."companyId"
      AND d."createdAt" <= p."createdAt"
      AND (d."resolvedAt" > p."createdAt" OR (d."resolvedAt" IS NULL AND d.status = 'OPEN'))
  )
)
SELECT count(DISTINCT "reimbursementRequestId") AS claims_paid_during_observable_open_expense_duplicate,
       count(*) AS payment_records_during_observable_open_expense_duplicate,
       count(*) FILTER (WHERE status = 'VOIDED') AS subsequently_voided_payment_records,
       count(DISTINCT "reimbursementRequestId") FILTER (WHERE "approvalPolicySnapshotJson" ->> 'duplicatePolicy' = 'BLOCK_PAYMENT') AS affected_claims_with_frozen_block_payment
FROM payments_with_observable_open_candidate;

-- Q15. Conditional range branch ONLY: expected columns 6, missing profile facts 0,
-- missing built-month history boundary 0 after a FULL under the range build.
-- JSON row projection avoids parse-time column references when only the 12-migration batch is installed.
-- With fewer than 6 columns, the fact counts are NOT acceptance evidence.
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
         AND ((table_name = 'ExecutiveCompanyMonth' AND column_name IN ('lastActivityAt', 'activityHistorySince', 'activitySnapshotReady'))
           OR (table_name = 'ExecutiveCompanyProfile' AND column_name IN ('sheetFacts', 'businessTypeCode', 'businessTypeOther')))) AS installed_company_sheet_columns,
       (SELECT count(*) FROM "ExecutiveCompanyProfile" p JOIN "ExecutiveReportBuild" b ON b.id = p."buildId"
         WHERE b."definitionVersion" = 1 AND (to_jsonb(p) -> 'sheetFacts' IS NULL OR to_jsonb(p) -> 'sheetFacts' = 'null'::jsonb)) AS built_profiles_missing_sheet_facts,
       (SELECT count(*) FROM "ExecutiveCompanyMonth" m
         WHERE m."definitionVersion" = 1 AND EXISTS (SELECT 1 FROM "ExecutiveReportMonth" h WHERE h.month = m.month AND h."definitionVersion" = m."definitionVersion")
           AND to_jsonb(m) ->> 'activityHistorySince' IS NULL) AS built_company_months_missing_activity_history_boundary;
-- lastActivityAt/businessTypeCode/businessTypeOther may truthfully be NULL; snapshotReady=false may
-- truthfully mean purged activity dates. None of those is treated as a failed backfill.

ROLLBACK;
