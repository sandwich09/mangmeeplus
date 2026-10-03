-- P1-P9: counts only. Also valid after all ten release migrations.
-- Run against the intended production database with a read-only database role.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL TIME ZONE 'UTC';

-- P1. Migration ledger. Names are predicates, never result columns.
WITH required(name) AS (VALUES
  ('20261001100000_reimbursement_payout_account'),
  ('20261001110000_reimbursement_payout_snapshot_delete_guard'),
  ('20261001130000_reimbursement_payment_slip'),
  ('20261001150000_reimbursement_payment_payout_confirmation'),
  ('20261002100000_reimbursement_payout_correction'),
  ('20261002100000_sales_credit_deductions'),
  ('20261002120000_data_rights_single_admin_mode'),
  ('20261002230000_company_web_entry_setting'),
  ('20261003090000_company_report_labels'),
  ('20261003091000_executive_report_summary')
)
SELECT (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS completed_migrations,
       (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished_migrations,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "_prisma_migrations" m WHERE m.migration_name = required.name AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) AS release_migrations_applied,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" m WHERE m.migration_name = required.name AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) AS release_migrations_pending
FROM required;

-- P2. Rows exposed to DDL locks/scans; eligible signup labels before the label job.
SELECT (SELECT count(*) FROM "Company") AS companies,
       (SELECT count(*) FROM "Company" WHERE status = 'ACTIVE') AS active_companies,
       (SELECT count(*) FROM "Company" WHERE id <> 'seed-watchdog-system-company' AND EXISTS (SELECT 1 FROM "CompanySignupRequest" s WHERE s."companyId" = "Company".id)) AS signup_linked_nonplatform_companies,
       (SELECT count(*) FROM "ReimbursementRequest") AS claims,
       (SELECT count(*) FROM "ReimbursementPayment") AS claim_payments,
       (SELECT count(*) FROM "CompanyMembership") AS memberships,
       (SELECT count(*) FROM "SalesAttribution") AS sales_attributions,
       (SELECT count(*) FROM "DataRightsCase") AS data_rights_cases,
       (SELECT count(*) FROM "DataRightsEvidenceRecord") AS data_rights_evidence;

-- P3. Newly added payment backfills: once-only audit exceptions are intentional.
WITH required(key) AS (VALUES ('reimbursement.payment.record'), ('reimbursement.payment.void')),
eligible AS (
  SELECT r.id, required.key,
         EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = required.key) AS has_grant,
         EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."requestId" = 'sync-permissions:' || required.key AND a.action = 'access.role.update' AND a."targetType" = 'Role' AND a."targetId" = r.id) AS granted_before
  FROM "Role" r CROSS JOIN required
  WHERE r."scopeKey" <> 'system'
    AND EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = 'reimbursement.approve')
)
SELECT count(*) AS eligible_role_permission_pairs,
       count(*) FILTER (WHERE has_grant) AS pairs_already_granted,
       count(*) FILTER (WHERE NOT has_grant AND NOT granted_before) AS pairs_to_backfill,
       count(*) FILTER (WHERE NOT has_grant AND granted_before) AS pairs_removed_after_prior_grant
FROM eligible;

-- P4. New catalog entries and missing active-company rules. Any existing status counts as present.
WITH required(key, sibling) AS (VALUES
  ('reimbursement_finance_blocked_requester', 'reimbursement_decision_requester'),
  ('reimbursement_payment_voided', 'reimbursement_payment_recorded'),
  ('reimbursement_payment_sla_breach', 'approval_sla_breach'),
  ('reimbursement_payout_correction_requested', 'reimbursement_correction_requester'),
  ('reimbursement_payout_correction_submitted', 'reimbursement_pending_approval')
), missing AS (
  SELECT c.id, required.sibling
  FROM "Company" c CROSS JOIN required
  WHERE c.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = c.id AND t.key = required.key)
)
SELECT (SELECT count(*) FROM required WHERE NOT EXISTS (SELECT 1 FROM "WorkflowTemplate" t WHERE t.key = required.key)) AS missing_catalog_entries,
       count(*) AS missing_active_company_rule_pairs,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = missing.id AND t.key = missing.sibling)
         AND NOT EXISTS (SELECT 1 FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = missing.id AND t.key = missing.sibling AND r.status = 'ENABLED')) AS missing_pairs_following_switched_off_sibling
FROM missing;

-- P5. Baseline approval housekeeping and cancellation work. Not a complete repair eligibility test.
SELECT (SELECT count(*) FROM "ReimbursementRequest" WHERE "cancellationPendingAt" IS NOT NULL AND status NOT IN ('CANCELLED', 'VOIDED')) AS cancellation_intents,
       (SELECT count(*) FROM "ReimbursementRequest" r WHERE r.status = 'PENDING_APPROVAL' AND r."currentApprovalStepId" IS NOT NULL
         AND EXISTS (SELECT 1 FROM "ReimbursementApprovalStep" s WHERE s."reimbursementRequestId" = r.id AND s.status = 'APPROVED')
         AND NOT EXISTS (SELECT 1 FROM "ReimbursementApprovalStep" s WHERE s."reimbursementRequestId" = r.id AND s.status = 'PENDING')) AS decided_approval_candidates,
       (SELECT count(*) FROM "ReimbursementRequest" WHERE status = 'FINANCE_REVIEW' AND "financeReviewStatus" = 'APPROVED_FOR_PAYMENT' AND "financeReviewedByUserId" IS NOT NULL) AS decided_finance_candidates,
       (SELECT count(*) FROM "ReimbursementRequest" WHERE status = 'APPROVED' AND "currentApprovalStepId" IS NULL) AS policy_approval_candidates,
       (SELECT count(*) FROM "WorkflowTask" task JOIN "WorkflowRun" run ON run.id = task."workflowRunId"
         JOIN "WorkflowRule" rule ON rule.id = run."ruleId" JOIN "WorkflowTemplate" template ON template.id = rule."templateId"
         LEFT JOIN "ReimbursementRequest" claim ON claim.id = task."sourceId" AND claim."companyId" = task."companyId"
         WHERE task."sourceType" = 'reimbursement_request' AND task."sourceId" IS NOT NULL AND task.status IN ('OPEN', 'SNOOZED')
           AND template.key IN ('reimbursement_pending_approval', 'approval_sla_breach') AND (claim.id IS NULL OR claim.status <> 'PENDING_APPROVAL')) AS stale_approval_tasks,
       (SELECT count(*) FROM "ExpenseRecord" e JOIN "ReimbursementRequest" r ON r.id = e."sourceReimbursementRequestId"
         WHERE r.status NOT IN ('CANCELLED', 'VOIDED', 'REJECTED') AND e.status IN ('REJECTED', 'VOIDED')) AS nonterminal_claims_with_rejected_or_voided_expenses,
       (SELECT count(*) FROM "ReimbursementPolicy" WHERE status = 'ACTIVE' AND "financeReviewRequired") AS finance_review_policies,
       (SELECT count(*) FROM "ReimbursementPolicy" WHERE status = 'ACTIVE' AND "slaHours" IS NOT NULL) AS policies_with_configured_sla;

-- P6. Legacy sales history is deliberately not rewritten; counts are review inputs.
SELECT count(*) AS sales_attributions,
       count(*) FILTER (WHERE "refundedSatang" > 0) AS attributions_with_legacy_refunds,
       count(*) FILTER (WHERE cardinality(flags) > 0 AND "flagReviewedAt" IS NULL) AS waiting_review_attributions,
       count(*) FILTER (WHERE cardinality(flags) > 0 AND "flagReviewedAt" IS NOT NULL) AS reviewed_excluded_attributions,
       count(*) FILTER (WHERE source = 'REFERRAL' AND EXISTS (SELECT 1 FROM "BillingInvoice" i WHERE i.id = "SalesAttribution"."sourceInvoiceId" AND i."contractSnapshot" #>> '{policy,taxTreatment}' = 'EXCLUSIVE_VAT_7')) AS legacy_exclusive_vat_referral_candidates
FROM "SalesAttribution";

-- P7. Match the application's active-System-Admin predicate, including missing credentials.
WITH admins AS (
  SELECT DISTINCT u.id, credential.id AS credential_id, credential."expiresAt", credential.status AS credential_status
  FROM "User" u JOIN "CompanyMembership" membership ON membership."userId" = u.id
  JOIN "Company" c ON c.id = membership."companyId"
  JOIN "MembershipRole" mr ON mr."membershipId" = membership.id JOIN "Role" r ON r.id = mr."roleId"
  LEFT JOIN "UserCredential" credential ON credential."userId" = u.id
  WHERE u.status = 'ACTIVE' AND membership.status = 'ACTIVE' AND c.status = 'ACTIVE'
    AND (credential.id IS NULL OR credential.status <> 'DISABLED')
    AND r.key = 'SYSTEM_ADMIN' AND r.status = 'ACTIVE' AND r."isSystem" AND r."scopeKey" = 'system' AND r."companyId" IS NULL
)
SELECT count(*) AS active_system_admins_under_application_rule,
       count(*) FILTER (WHERE credential_id IS NULL) AS counted_admins_without_password_credential,
       count(*) FILTER (WHERE "expiresAt" <= CURRENT_TIMESTAMP) AS counted_admins_with_expired_credential
FROM admins;

-- P8. Payment-source and AI-meter history; no money amounts or provider identifiers returned.
SELECT (SELECT count(*) FROM "BillingAccount" WHERE livemode) AS live_billing_accounts,
       (SELECT count(*) FROM "BillingOperation" WHERE livemode AND type = 'SCAN_PROVIDER_BALANCE' AND state = 'SUCCEEDED') AS successful_live_balance_scans,
       (SELECT count(*) FROM "BillingOperation" WHERE livemode AND type = 'SCAN_PROVIDER_BALANCE' AND state IN ('QUEUED', 'RUNNING', 'UNKNOWN', 'BLOCKED')) AS outstanding_live_balance_scans,
       (SELECT count(*) FROM "BillingOperation" WHERE livemode AND type = 'OBSERVE_PROVIDER_BALANCE') AS live_balance_observations,
       (SELECT count(*) FROM "AiUsageEvent") AS ai_meter_rows,
       (SELECT count(*) FROM "AiUsageEvent" WHERE "usageBasis" IS NULL) AS ai_rows_with_unknown_basis,
       (SELECT count(*) FROM "AiUsageEvent" WHERE "usageBasis" = 'CONSERVATIVE_ESTIMATE') AS ai_rows_with_estimated_basis,
       (SELECT count(*) FROM "AiUsageEvent" WHERE "eventKind" = 'COST_ADJUSTMENT') AS ai_cost_adjustment_rows;

-- P9. Pre-migration same-person histories would conflict with the new false-default marker CHECK.
-- After new explicit self-steps are used these can be legitimate; use Q6 after migration instead.
SELECT (SELECT count(*) FROM "DataRightsCase" WHERE "approvedByUserId" = "createdByUserId"
         OR "executionStartedByUserId" = "approvedByUserId"
         OR "verificationStartedByUserId" = "executionStartedByUserId"
         OR "completedByUserId" = "executionStartedByUserId") AS cases_with_same_person_steps,
       (SELECT count(*) FROM "DataRightsEvidenceRecord" e JOIN "DataRightsCase" c ON c.id = e."caseId"
         WHERE e."evidenceType" = 'INDEPENDENT_VERIFICATION' AND e."recordedByUserId" = c."executionStartedByUserId") AS verification_evidence_by_executor;

ROLLBACK;
