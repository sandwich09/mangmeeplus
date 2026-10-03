-- Q1-Q9: counts only; requires all ten migrations and the executive branch's schema.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';

-- Q1. Re-run P1 from pre-release-checks.sql for the migration ledger. Installed new tables and guards.
SELECT count(*) AS installed_release_tables FROM information_schema.tables
WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  AND table_name IN ('MemberPayoutAccount', 'ReimbursementPayoutDestination', 'SalesAttributionDeduction', 'CompanyWebEntrySetting',
                     'ExecutiveReportBuild', 'ExecutiveReportMonth', 'ExecutiveCompanyMonth', 'ExecutiveCompanyProfile');
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
SELECT (SELECT count(*) FROM "Permission" WHERE key IN ('system.executive.read', 'system.executive.export', 'system.executive.contact.read', 'system.executive_user.manage')) AS executive_permission_keys,
       (SELECT count(*) FROM "Role" WHERE "scopeKey" = 'system' AND "companyId" IS NULL AND "isSystem" AND key IN ('MANGMEE_EXECUTIVE', 'MANGMEE_EXECUTIVE_EXPORT', 'MANGMEE_EXECUTIVE_CONTACT')) AS executive_system_roles;

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

ROLLBACK;
