BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
-- post-release-checks.sql : run on the UPGRADED schema, AFTER the release (new build 19fe51537 or later).
-- One READ ONLY transaction closed by ROLLBACK: SELECT statements only. No temp table, no row lock,
-- no sequence call, no function with a side effect, no COPY.
-- Prints no personal data: counts, sums, months, statuses, claim numbers, role keys and names,
-- permission keys, setting values, and ids cut to 8 characters.
--
-- What each block reads:
--   A  the seven new migrations     _prisma_migrations
--   B  roles given the pay rights   AuditLog (by requestId), Role, RolePermission, Permission, MembershipRole, CompanyMembership, User, Company
--   C  claims held up               ReimbursementRequest (correction round, pending cancellation, waiting for the system), ReimbursementApprovalStep
--   D  payout data, counts only     MemberPayoutAccount, ReimbursementPayoutDestination, ReimbursementRequest, ReimbursementPayment
--   E  credit and data rights       SalesAttributionDeduction, DataRightsCase, DataRightsEvidenceRecord (counts only)
--   F  claims in flight             the same statements as block 9 of pre-release-checks.sql
--   G  the four new claim notices   the same statement as block 8b of pre-release-checks.sql (WorkflowRule, WorkflowTemplate, Company)
--   Z  closing                      _prisma_migrations, count(*) of the claim tables
--
-- A block that fails prints its ERROR and the script goes on (ON_ERROR_ROLLBACK: psql puts a savepoint
-- around each statement; a read-only transaction allows that). The output must hold no line with ERROR.
\set ON_ERROR_ROLLBACK on
\pset pager off
\pset null '-'

-- >>> shared definitions: pieces of SQL text pasted into the statements below by psql (nothing is created in the database)
-- co   : a company's label = first 8 characters of its id; "#n" is added only when two companies share them.
\set co 'co AS (SELECT c.id, left(c.id, 8) || CASE WHEN count(*) OVER (PARTITION BY left(c.id, 8)) > 1 THEN ''#'' || dense_rank() OVER (PARTITION BY left(c.id, 8) ORDER BY c.id)::text ELSE '''' END AS co8, c.status::text AS co_status FROM "Company" c)'
-- gain : the back-fill rule (prisma/sync-permissions.ts, company-role-backfill.registry.ts): a role outside the
--        ''system'' scope, of any status, that holds reimbursement.approve gains each of .payment.record / .payment.void
--        it lacks, unless an audit row of an earlier grant of that key exists for the role.
\set gain 'gain AS (SELECT r.id AS role_id, r."companyId", r.key, r.name, r.status::text AS role_status, (NOT h.rec AND NOT EXISTS (SELECT 1 FROM "AuditLog" l WHERE l."requestId" = ''sync-permissions:reimbursement.payment.record'' AND l.action = ''access.role.update'' AND l."targetType" = ''Role'' AND l."targetId" = r.id)) AS gains_record, (NOT h.vd AND NOT EXISTS (SELECT 1 FROM "AuditLog" l WHERE l."requestId" = ''sync-permissions:reimbursement.payment.void'' AND l.action = ''access.role.update'' AND l."targetType" = ''Role'' AND l."targetId" = r.id)) AS gains_void FROM "Role" r JOIN (SELECT rp."roleId", bool_or(p.key = ''reimbursement.approve'') AS appr, bool_or(p.key = ''reimbursement.payment.record'') AS rec, bool_or(p.key = ''reimbursement.payment.void'') AS vd FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE p.key IN (''reimbursement.approve'', ''reimbursement.payment.record'', ''reimbursement.payment.void'') GROUP BY rp."roleId") h ON h."roleId" = r.id WHERE r."scopeKey" <> ''system'' AND h.appr)'
-- act  : an active member as the permission resolver admits one: membership, user and company all ACTIVE.
\set act 'act AS (SELECT m.id AS membership_id, m."companyId", m."userId" FROM "CompanyMembership" m JOIN "User" u ON u.id = m."userId" JOIN "Company" c ON c.id = m."companyId" WHERE m.status = ''ACTIVE'' AND u.status = ''ACTIVE'' AND c.status = ''ACTIVE'')'
-- mp   : what an active member holds through ACTIVE roles (disabled roles give nothing), and whether one of
--        those roles gains the record right in the back-fill. Needs gain and act before it.
\set mp 'mp AS (SELECT a.membership_id, a."companyId", a."userId", bool_or(p.key = ''reimbursement.approve'') AS can_approve, bool_or(p.key = ''reimbursement.payment.record'') AS can_record, bool_or(p.key = ''expense.delete'') AS exp_delete, bool_or(p.key = ''expense.update'') AS exp_update, bool_or(COALESCE(g.gains_record, false)) AS gets_record FROM act a JOIN "MembershipRole" mr ON mr."membershipId" = a.membership_id JOIN "Role" r ON r.id = mr."roleId" AND r.status = ''ACTIVE'' JOIN "RolePermission" rp ON rp."roleId" = r.id JOIN "Permission" p ON p.id = rp."permissionId" LEFT JOIN gain g ON g.role_id = r.id WHERE p.key IN (''reimbursement.approve'', ''reimbursement.payment.record'', ''expense.delete'', ''expense.update'') GROUP BY a.membership_id, a."companyId", a."userId")'

-- <<< shared definitions

\echo '##### post-release-checks.sql : upgraded schema, after the release #####'
SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS run_at_bangkok,
       current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout;

\echo
\echo '=== A. The seven new migrations (expected: seven lines, all "applied"; a line with expected = no is a migration this list does not know) ==='
WITH want(migration_name) AS (VALUES
    ('20261001100000_reimbursement_payout_account'), ('20261001110000_reimbursement_payout_snapshot_delete_guard'),
    ('20261001130000_reimbursement_payment_slip'), ('20261001150000_reimbursement_payment_payout_confirmation'),
    ('20261002100000_reimbursement_payout_correction'), ('20261002100000_sales_credit_deductions'),
    ('20261002120000_data_rights_single_admin_mode'))
SELECT COALESCE(w.migration_name, m.migration_name) AS migration,
       CASE WHEN m.migration_name IS NULL THEN 'MISSING' WHEN m.rolled_back_at IS NOT NULL THEN 'ROLLED BACK'
            WHEN m.finished_at IS NULL THEN 'NOT FINISHED' ELSE 'applied' END AS state,
       CASE WHEN w.migration_name IS NULL THEN 'no' ELSE 'yes' END AS expected,
       to_char(m.started_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS started_bangkok,
       to_char(m.finished_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS finished_bangkok,
       m.applied_steps_count AS steps
FROM want w
FULL JOIN (SELECT * FROM "_prisma_migrations" WHERE migration_name > '20260930150000_signup_discovery_source_sales') m
       ON m.migration_name = w.migration_name
ORDER BY 1, m.started_at;

\echo
\echo '=== B. Roles holding record and void now ==='
-- since: when this release began = the finish time of its first migration; only audit rows from then on are read,
--        so a grant made by an earlier or later release is not mistaken for one of this release's pay-right grants.
-- g:     the roles the back-fill gave a pay right to in this release, from the audit row it writes with each grant.
\set since '(SELECT min(finished_at) AT TIME ZONE ''UTC'' FROM "_prisma_migrations" WHERE migration_name = ''20261001100000_reimbursement_payout_account'')'
\set g 'g AS (SELECT l."targetId" AS role_id, bool_or(l."requestId" = ''sync-permissions:reimbursement.payment.record'') AS gains_record, bool_or(l."requestId" = ''sync-permissions:reimbursement.payment.void'') AS gains_void FROM "AuditLog" l WHERE l."requestId" IN (''sync-permissions:reimbursement.payment.record'', ''sync-permissions:reimbursement.payment.void'') AND l.action = ''access.role.update'' AND l."targetType" = ''Role'' AND l."createdAt" >= ' :since ' GROUP BY l."targetId")'
\echo '--- B1. pay-right table: one line per role the back-fill gave a pay right to, same columns as block 1a ---'
WITH :co, :g
SELECT COALESCE(co.co8, left(r."companyId", 8), '(none)') AS company, r.key AS role_key, r.name AS role_name,
       CASE WHEN EXISTS (SELECT 1 FROM "Role" s WHERE s."scopeKey" = 'system' AND s.key = r.key)
            THEN 'system role, edited by the company' ELSE 'made by the company' END AS kind,
       r.status::text AS role_status,
       concat_ws('+', CASE WHEN g.gains_record THEN 'record' END, CASE WHEN g.gains_void THEN 'void' END) AS back_fill,
       (SELECT count(*) FROM "MembershipRole" mr JOIN "CompanyMembership" m ON m.id = mr."membershipId"
          JOIN "User" u ON u.id = m."userId" JOIN "Company" c ON c.id = m."companyId"
         WHERE mr."roleId" = r.id AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND c.status = 'ACTIVE') AS active_members
FROM g JOIN "Role" r ON r.id = g.role_id LEFT JOIN co ON co.id = r."companyId"
ORDER BY 1, r.key, r.name, r.id;
\echo '--- end of pay-right table ---'

\echo '--- B2. totals (same columns as block 1b) ---'
WITH :act, :g
SELECT count(*) AS roles_changed, count(DISTINCT r."companyId") AS companies_changed,
       count(*) FILTER (WHERE g.gains_record) AS gain_record, count(*) FILTER (WHERE g.gains_void) AS gain_void,
       (SELECT count(DISTINCT a.membership_id) FROM act a JOIN "MembershipRole" mr ON mr."membershipId" = a.membership_id
          JOIN g x ON x.role_id = mr."roleId") AS active_members_changed,
       (SELECT count(*) FROM "Role" cr WHERE cr."scopeKey" <> 'system' AND EXISTS (
          SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId"
          WHERE rp."roleId" = cr.id AND p.key = 'reimbursement.approve')) AS company_roles_that_approve
FROM g JOIN "Role" r ON r.id = g.role_id;

\echo '--- B3. roles that approve claims but lack a pay right now (expected: 0 rows, unless block 1 left a role out because a right was granted before, or an admin took it away since) ---'
SELECT CASE WHEN r."scopeKey" = 'system' THEN 'system' ELSE left(r."companyId", 8) END AS company, r.key AS role_key, r.name AS role_name,
       r.status::text AS role_status, k.key AS lacks
FROM "Role" r CROSS JOIN (VALUES ('reimbursement.payment.record'), ('reimbursement.payment.void')) AS k(key)
WHERE (EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = 'reimbursement.approve')
       OR (r."scopeKey" = 'system' AND r.key IN ('OWNER', 'ADMIN', 'MANAGER', 'FINANCE')))
  AND NOT EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = k.key)
ORDER BY 1, 2, 3, 5;

\echo '--- B4. back-fill table: every key the release task added to company roles (its audit rows), roles per key; same columns as block 1d ---'
WITH bf(key, anchor) AS (VALUES
    ('company.branch.read', NULL), ('attachment.read', NULL), ('attachment.create', NULL), ('reimbursement.read_own', NULL),
    ('reimbursement.create', NULL), ('reimbursement.update_own_draft', NULL), ('reimbursement.submit', NULL), ('reimbursement.cancel_own', NULL),
    ('account.password.change', NULL), ('dashboard.read', NULL), ('accounting.document.read_related', NULL), ('expense.read_related', NULL),
    ('reimbursement.read_related', NULL), ('procurement.purchase_request.read_related', NULL), ('procurement.purchase_order.read_related', NULL),
    ('procurement.goods_receipt.read_related', NULL), ('procurement.vendor_bill.read_related', NULL), ('procurement.supplier_payment.read_related', NULL),
    ('expense.evidence.read', 'expense.read'), ('expense.delete', 'expense.void'), ('expense.signature.self_manage', 'expense.create'),
    ('reimbursement.payment.record', 'reimbursement.approve'), ('reimbursement.payment.void', 'reimbursement.approve'),
    ('report.snapshot.read', 'report.query.run'))
SELECT bf.key AS permission_key, COALESCE('roles holding ' || bf.anchor, 'every company role') AS given_to, count(*) AS roles_that_gain_it
FROM bf JOIN "AuditLog" l ON l."requestId" = 'sync-permissions:' || bf.key AND l.action = 'access.role.update' AND l."targetType" = 'Role'
                         AND l."createdAt" >= :since
GROUP BY 1, 2 ORDER BY 1;
\echo '--- end of back-fill table ---'

\echo
\echo '=== C. Claims held up ==='
\echo '--- C1. claims in a payout-correction round, by phase (the ALL line must be 0 before any rollback: the old build reads such a claim as waiting for approval) ---'
SELECT CASE WHEN GROUPING(p.phase) = 1 THEN 'ALL claims in a round' ELSE p.phase END AS phase,
       count(r.id) AS claims, count(DISTINCT r."companyId") AS companies,
       to_char(min(r."payoutCorrectionRequestedAt") + interval '7 hours', 'YYYY-MM-DD HH24:MI') AS oldest_sent_back_bangkok
FROM (VALUES (false, '1 waiting for the requester to give the account'), (true, '2 waiting for the approver again')) AS p(submitted, phase)
LEFT JOIN "ReimbursementRequest" r ON r.status = 'PENDING_APPROVAL' AND r."payoutCorrectionRequestedAt" IS NOT NULL
                                  AND (r."payoutCorrectionSubmittedAt" IS NOT NULL) = p.submitted
GROUP BY ROLLUP (p.phase) ORDER BY GROUPING(p.phase), p.phase;

\echo '--- C2. claims with a pending cancellation, and claims decided and waiting for the system (pendingProjectionIntent); "since" = oldest, Bangkok time ---'
SELECT x.what, x.claims, x.since
FROM (SELECT 1 AS o, 'pending cancellation (started, not completed)' AS what, count(*) AS claims,
             to_char(min(r."cancellationPendingAt") + interval '7 hours', 'YYYY-MM-DD HH24:MI') AS since
      FROM "ReimbursementRequest" r WHERE r."cancellationPendingAt" IS NOT NULL AND r.status NOT IN ('CANCELLED', 'VOIDED')
      UNION ALL
      SELECT 2, 'waiting for the system: approved, not moved on yet', count(*), to_char(min(r."updatedAt") + interval '7 hours', 'YYYY-MM-DD HH24:MI')
      FROM "ReimbursementRequest" r
      WHERE r."cancellationPendingAt" IS NULL AND r.status = 'PENDING_APPROVAL' AND r."payoutCorrectionRequestedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "ReimbursementApprovalStep" s WHERE s.id = r."currentApprovalStepId" AND s.status = 'APPROVED' AND s."decisionByUserId" IS NOT NULL)
      UNION ALL
      SELECT 3, 'waiting for the system: passed by finance, not moved to payment yet', count(*), to_char(min(r."updatedAt") + interval '7 hours', 'YYYY-MM-DD HH24:MI')
      FROM "ReimbursementRequest" r
      WHERE r."cancellationPendingAt" IS NULL AND r.status = 'FINANCE_REVIEW' AND r."financeReviewStatus" = 'APPROVED_FOR_PAYMENT' AND r."financeReviewedByUserId" IS NOT NULL
      UNION ALL
      SELECT 4, 'waiting for the system: needed no approval, not moved to payment yet', count(*), to_char(min(r."updatedAt") + interval '7 hours', 'YYYY-MM-DD HH24:MI')
      FROM "ReimbursementRequest" r
      WHERE r."cancellationPendingAt" IS NULL AND r.status = 'APPROVED' AND r."currentApprovalStepId" IS NULL
        AND r."approvalPolicySnapshotJson" ->> 'requiresApproval' = 'false' AND r."approvalPolicySnapshotJson" ->> 'financeReviewRequired' = 'false') x
ORDER BY x.o;

\echo
\echo '=== D. Payout data, counts only ==='
SELECT x.what, x.detail, x.n
FROM (SELECT 1 AS o, 'default payout accounts (MemberPayoutAccount)' AS what, "payoutMethod"::text || COALESCE(' / ' || "payoutKind", '') AS detail, count(*) AS n
      FROM "MemberPayoutAccount" GROUP BY 3
      UNION ALL
      SELECT 2, 'claims by payout method (ReimbursementRequest.payoutMethod)', COALESCE("payoutMethod"::text, 'none: claim of before the release'), count(*)
      FROM "ReimbursementRequest" GROUP BY 3
      UNION ALL
      SELECT 3, 'claim payout snapshots (ReimbursementPayoutDestination)',
             "payoutKind" || ' / ' || source || CASE WHEN "frozenAt" IS NULL THEN ' / not frozen' ELSE ' / frozen' END || CASE WHEN "verifiedAt" IS NULL THEN '' ELSE ' / verified' END, count(*)
      FROM "ReimbursementPayoutDestination" GROUP BY 3
      UNION ALL
      SELECT 4, 'payments (ReimbursementPayment)', 'all', count(*) FROM "ReimbursementPayment"
      UNION ALL
      SELECT 4, 'payments (ReimbursementPayment)', 'with a slip', count(*) FROM "ReimbursementPayment" WHERE "slipAttachmentId" IS NOT NULL
      UNION ALL
      SELECT 4, 'payments (ReimbursementPayment)', 'with a payer confirmation of the account', count(*) FROM "ReimbursementPayment" WHERE "payoutConfirmedAt" IS NOT NULL
      UNION ALL
      SELECT 4, 'payments (ReimbursementPayment)', 'paid by another method than asked (a reason is stored)', count(*) FROM "ReimbursementPayment" WHERE "methodMismatchReason" IS NOT NULL
      UNION ALL
      SELECT 4, 'payments (ReimbursementPayment)', 'voided', count(*) FROM "ReimbursementPayment" WHERE status = 'VOIDED') x
ORDER BY x.o, x.detail;

\echo
\echo '=== E. Sales credit deductions and data-rights self-steps, counts only ==='
\echo '--- E1. sales credit deduction rows (SalesAttributionDeduction) by Bangkok month of recording and kind ---'
SELECT to_char(d."createdAt" + interval '7 hours', 'YYYY-MM') AS recorded_month, d.kind, count(*) AS deduction_rows, sum(d."amountSatang") AS satang
FROM "SalesAttributionDeduction" d GROUP BY 1, 2 ORDER BY 1, 2;

\echo '--- E2. data-rights steps one person took alone (single-admin markers) ---'
SELECT (SELECT count(*) FROM "DataRightsCase") AS cases,
       (SELECT count(*) FROM "DataRightsCase" WHERE "approvalSingleAdmin") AS approval_self_steps,
       (SELECT count(*) FROM "DataRightsCase" WHERE "executionSingleAdmin") AS execution_self_steps,
       (SELECT count(*) FROM "DataRightsCase" WHERE "verificationSingleAdmin") AS verification_self_steps,
       (SELECT count(*) FROM "DataRightsCase" WHERE "completionSingleAdmin") AS completion_self_steps,
       (SELECT count(*) FROM "DataRightsEvidenceRecord" WHERE "singleAdmin") AS evidence_self_steps;

\echo
\echo '=== F. Claims in flight (the same statements as block 9 before the release) ==='
\echo '--- claims-in-flight table: every claim not finished (finished = PAID, REJECTED, CANCELLED, VOIDED), by company and status ---'
WITH :co
SELECT COALESCE(co.co8, left(r."companyId", 8)) AS company, r.status::text AS status, r."paymentStatus"::text AS payment_status,
       r."financeReviewStatus"::text AS finance_review, count(*) AS claims, sum(r.amount)::numeric(18,2) AS amount,
       count(*) FILTER (WHERE r."cancellationPendingAt" IS NOT NULL) AS cancellation_pending
FROM "ReimbursementRequest" r LEFT JOIN co ON co.id = r."companyId"
WHERE r.status NOT IN ('PAID', 'REJECTED', 'CANCELLED', 'VOIDED')
GROUP BY r."companyId", co.co8, r.status, r."paymentStatus", r."financeReviewStatus"
ORDER BY 1, r.status, r."paymentStatus", r."financeReviewStatus";

\echo '--- each claim waiting for payment (READY_FOR_PAYMENT, PARTIALLY_PAID): its shape ---'
WITH :co, :gain, :act, :mp,
pol AS (SELECT "companyId", "financeReviewRequired" AS finance_step, "slaHours" AS reminder_hours FROM "ReimbursementPolicy" WHERE "branchId" IS NULL)
SELECT w."requestNo" AS claim, COALESCE(co.co8, left(w."companyId", 8)) AS company, w.status::text AS status,
       to_char(w."approvedAt" + interval '7 hours', 'YYYY-MM-DD') AS approved_on,
       w.amount::numeric(18,2) AS amount, w."outstandingAmount"::numeric(18,2) AS to_pay,
       COALESCE(st.steps, 'none') AS approval_steps,
       COALESCE(ln.receipts, 'no line') AS line_receipts,
       COALESCE(fl.files, 'none') AS files_on_the_claim,
       CASE WHEN COALESCE(fl.signed_copy, false) THEN 'yes' ELSE 'no' END AS signed_copy,
       COALESCE(sg.signatures, '0') AS signatures,
       CASE WHEN ap.user_id IS NULL THEN 'no approver' WHEN payer.can_record THEN 'yes' ELSE 'no' END AS approver_can_pay_today,
       CASE WHEN ap.user_id IS NULL THEN 'no approver' WHEN payer.can_record OR payer.gets_record THEN 'yes' ELSE 'no' END AS approver_can_pay_after_back_fill,
       CASE WHEN COALESCE(pol.finance_step, false) THEN 'on' ELSE 'off' END AS company_finance_step,
       CASE w."approvalPolicySnapshotJson" ->> 'financeReviewRequired' WHEN 'true' THEN 'on' WHEN 'false' THEN 'off' ELSE 'no snapshot' END AS claim_finance_step,
       CASE WHEN w."cancellationPendingAt" IS NOT NULL THEN 'yes' ELSE 'no' END AS cancellation_pending,
       COALESCE(py.payments, '-') AS payments,
       CASE WHEN sla.hours IS NULL OR sla.hours <= 0 THEN 'not set'
            WHEN (now() AT TIME ZONE 'UTC') - GREATEST(COALESCE(GREATEST(w."financeReviewedAt", w."approvedAt"), w."submittedAt"), py.last_void) >= make_interval(hours => sla.hours)
            THEN sla.hours || ' h, OVERDUE' ELSE sla.hours || ' h, not due' END AS payment_reminder
FROM "ReimbursementRequest" w
LEFT JOIN co ON co.id = w."companyId"
LEFT JOIN pol ON pol."companyId" = w."companyId"
LEFT JOIN LATERAL (SELECT string_agg(s.status::text, '>' ORDER BY s."sequenceNo", s."createdAt", s.id) AS steps
                   FROM "ReimbursementApprovalStep" s WHERE s."reimbursementRequestId" = w.id) st ON true
LEFT JOIN LATERAL (SELECT s."decisionByUserId" AS user_id FROM "ReimbursementApprovalStep" s
                   WHERE s."reimbursementRequestId" = w.id AND s.status = 'APPROVED' AND s."decisionByUserId" IS NOT NULL
                   ORDER BY s."decidedAt" DESC NULLS LAST, s."sequenceNo" DESC LIMIT 1) ap ON true
LEFT JOIN mp payer ON payer."companyId" = w."companyId" AND payer."userId" = ap.user_id
LEFT JOIN LATERAL (SELECT count(*)::text || ' (' || string_agg(g.role::text, '+' ORDER BY g.role) || ')' AS signatures
                   FROM "ReimbursementClaimSignature" g WHERE g."reimbursementRequestId" = w.id HAVING count(*) > 0) sg ON true
LEFT JOIN LATERAL (SELECT concat_ws(', ', 'image ' || NULLIF(count(*) FILTER (WHERE o."mimeType" LIKE 'image/%'), 0),
                                          'PDF ' || NULLIF(count(*) FILTER (WHERE o."mimeType" = 'application/pdf'), 0),
                                          'other file ' || NULLIF(count(*) FILTER (WHERE o."mimeType" NOT LIKE 'image/%' AND o."mimeType" <> 'application/pdf'), 0),
                                          'no file ' || NULLIF(count(*) FILTER (WHERE o.id IS NULL), 0)) AS receipts
                   FROM "ReimbursementLine" l LEFT JOIN "AttachmentObject" o ON o.id = l."attachmentId"
                   WHERE l."reimbursementRequestId" = w.id HAVING count(*) > 0) ln ON true
LEFT JOIN LATERAL (SELECT string_agg(k.purpose || ': ' || k.types, '; ' ORDER BY k.purpose) AS files, bool_or(k.purpose = 'claim_form.signed') AS signed_copy
                   FROM (SELECT regexp_replace(al.purpose, '^reimbursement\.', '') AS purpose,
                                concat_ws(', ', 'image ' || NULLIF(count(*) FILTER (WHERE o."mimeType" LIKE 'image/%'), 0),
                                                'PDF ' || NULLIF(count(*) FILTER (WHERE o."mimeType" = 'application/pdf'), 0),
                                                'other file ' || NULLIF(count(*) FILTER (WHERE o."mimeType" NOT LIKE 'image/%' AND o."mimeType" <> 'application/pdf'), 0)) AS types
                         FROM "AttachmentLink" al JOIN "AttachmentObject" o ON o.id = al."attachmentId"
                         WHERE al."companyId" = w."companyId" AND al."targetType" = 'reimbursement_request' AND al."targetId" = w.id AND o.status = 'ACTIVE'
                         GROUP BY al.purpose) k) fl ON true
LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE p.status = 'RECORDED')::text || ' recorded, ' || count(*) FILTER (WHERE p.status = 'VOIDED')::text || ' voided' AS payments,
                          max(p."voidedAt") AS last_void
                   FROM "ReimbursementPayment" p WHERE p."companyId" = w."companyId" AND p."reimbursementRequestId" = w.id HAVING count(*) > 0) py ON true
LEFT JOIN LATERAL (SELECT CASE WHEN w."approvalPolicySnapshotJson" IS NULL THEN pol.reminder_hours
                                WHEN w."approvalPolicySnapshotJson" ->> 'slaHours' ~ '^[0-9]+$' THEN (w."approvalPolicySnapshotJson" ->> 'slaHours')::int END AS hours) sla ON true
WHERE w.status IN ('READY_FOR_PAYMENT', 'PARTIALLY_PAID')
ORDER BY 2, w."requestNo", w.id;
\echo '--- end of claims-in-flight ---'

\echo
\echo '=== G. The four new claim notices (the same statement as block 8b before the release) ==='
\echo '--- every ACTIVE company should now have each of them: switched on, or switched off where block 8b predicted it ---'
WITH pairs(new_notice, follows) AS (VALUES
    ('reimbursement_payment_voided', 'reimbursement_payment_recorded'), ('reimbursement_payment_sla_breach', 'approval_sla_breach'),
    ('reimbursement_payout_correction_requested', 'reimbursement_correction_requester'),
    ('reimbursement_payout_correction_submitted', 'reimbursement_pending_approval')),
c AS (SELECT p.new_notice, p.follows,
             (SELECT count(*) FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = a.id AND t.key = p.follows) AS sib,
             (SELECT count(*) FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = a.id AND t.key = p.follows AND r.status = 'ENABLED') AS sib_on,
             (SELECT count(*) FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = a.id AND t.key = p.new_notice AND r.status = 'ENABLED') AS new_on,
             (SELECT count(*) FROM "WorkflowRule" r JOIN "WorkflowTemplate" t ON t.id = r."templateId" WHERE r."companyId" = a.id AND t.key = p.new_notice AND r.status <> 'ENABLED') AS new_off
      FROM pairs p CROSS JOIN "Company" a WHERE a.status = 'ACTIVE')
SELECT new_notice, follows, count(*) AS active_companies,
       count(*) FILTER (WHERE new_on + new_off = 0 AND NOT (sib > 0 AND sib_on = 0)) AS to_be_created_switched_on,
       count(*) FILTER (WHERE new_on + new_off = 0 AND sib > 0 AND sib_on = 0) AS to_be_created_switched_off,
       count(*) FILTER (WHERE new_on > 0) AS have_it_switched_on,
       count(*) FILTER (WHERE new_on = 0 AND new_off > 0) AS have_it_switched_off
FROM c GROUP BY 1, 2 ORDER BY 1;


\echo
\echo '=== Z. Closing: server, last applied migration, row counts of the claim tables ==='
SELECT current_setting('server_version') AS server_version,
       (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations_applied,
       (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS not_finished_or_rolled_back,
       (SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1) AS last_applied_migration;

SELECT t.claim_table, t.row_count
FROM (VALUES ('ReimbursementRequest',            (SELECT count(*) FROM "ReimbursementRequest")),
             ('ReimbursementLine',               (SELECT count(*) FROM "ReimbursementLine")),
             ('ReimbursementApprovalStep',       (SELECT count(*) FROM "ReimbursementApprovalStep")),
             ('ReimbursementClaimSignature',     (SELECT count(*) FROM "ReimbursementClaimSignature")),
             ('ReimbursementPayment',            (SELECT count(*) FROM "ReimbursementPayment")),
             ('ReimbursementPolicy',             (SELECT count(*) FROM "ReimbursementPolicy")),
             ('ReimbursementInternalNote',       (SELECT count(*) FROM "ReimbursementInternalNote")),
             ('ReimbursementDuplicateCandidate', (SELECT count(*) FROM "ReimbursementDuplicateCandidate")),
             ('ReimbursementDraftAction',        (SELECT count(*) FROM "ReimbursementDraftAction")),
             ('MemberPayoutAccount (new)',            (SELECT count(*) FROM "MemberPayoutAccount")),
             ('ReimbursementPayoutDestination (new)', (SELECT count(*) FROM "ReimbursementPayoutDestination"))) AS t(claim_table, row_count);

SELECT round(extract(epoch FROM (clock_timestamp() - transaction_timestamp()))::numeric, 2) AS script_seconds;
\echo '##### end of post-release-checks.sql #####'
ROLLBACK;
