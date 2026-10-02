BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
-- pre-release-checks.sql : run on the PRODUCTION schema (build 908e7aab9) BEFORE the release.
-- One READ ONLY transaction closed by ROLLBACK: SELECT statements only. No temp table, no row lock,
-- no sequence call, no function with a side effect, no COPY. Rules read from the new build 19fe51537.
-- Prints no personal data: counts, sums, months, statuses, claim numbers, role keys and names,
-- permission keys, setting values, and ids cut to 8 characters. An account is "admin #n".
--
-- What each block reads:
--   1  pay-right back-fill          Role, RolePermission, Permission, AuditLog (by requestId), MembershipRole, CompanyMembership, User, Company
--      (1d: the 22 older back-fill keys the same task adds, counts per key)
--   2  System Admins who sign in    CompanyMembership, User, UserCredential, ExternalIdentity, Company, MembershipRole, Role
--   3  deals with a bare parent     PackageChangeRequest (kind SALES_DEAL), CompanyFeatureEntitlement, BillingAccount, BillingAttempt, CompanyPlanTerm
--   4  expense.delete, no update    Role, RolePermission, Permission, memberships, CompanyFeatureEntitlement
--   5  sales attribution flags      SalesAttribution
--   6  refunds and disputes         BillingInvoice, AuditLog (by targetType + targetId), BillingOperation, BillingProviderEvent, SalesAttribution
--   7  tax of package sales         BillingSettings, BillingPolicyRevision, BillingInvoice, BillingAccount
--   8  notification rules           WorkflowRule, WorkflowRuleVersion, WorkflowTemplate, NotificationRule, Company
--   9  claims in flight             ReimbursementRequest, ...ApprovalStep, ...Line, ...ClaimSignature, ...Payment, ...Policy, AttachmentLink, AttachmentObject
--   10 claim settings per company   Company, ReimbursementPolicy, ReimbursementRequest, memberships and their roles
--   11 closing                      _prisma_migrations, count(*) of the claim tables
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
\echo '##### pre-release-checks.sql : production schema, before the release #####'
SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS run_at_bangkok,
       current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout;

\echo
\echo '=== 1. Roles the pay-right back-fill will change ==='
\echo '--- 1a. pay-right table: one line per role that gains reimbursement.payment.record and/or .void ---'
WITH :co, :gain
SELECT COALESCE(co.co8, left(g."companyId", 8), '(none)') AS company, g.key AS role_key, g.name AS role_name,
       CASE WHEN EXISTS (SELECT 1 FROM "Role" s WHERE s."scopeKey" = 'system' AND s.key = g.key)
            THEN 'system role, edited by the company' ELSE 'made by the company' END AS kind,
       g.role_status,
       concat_ws('+', CASE WHEN g.gains_record THEN 'record' END, CASE WHEN g.gains_void THEN 'void' END) AS back_fill,
       (SELECT count(*) FROM "MembershipRole" mr JOIN "CompanyMembership" m ON m.id = mr."membershipId"
          JOIN "User" u ON u.id = m."userId" JOIN "Company" c ON c.id = m."companyId"
         WHERE mr."roleId" = g.role_id AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND c.status = 'ACTIVE') AS active_members
FROM gain g LEFT JOIN co ON co.id = g."companyId"
WHERE g.gains_record OR g.gains_void
ORDER BY 1, g.key, g.name, g.role_id;
\echo '--- end of pay-right table ---'

\echo '--- 1b. totals ---'
WITH :gain, :act
SELECT count(*) FILTER (WHERE g.gains_record OR g.gains_void) AS roles_changed,
       count(DISTINCT g."companyId") FILTER (WHERE g.gains_record OR g.gains_void) AS companies_changed,
       count(*) FILTER (WHERE g.gains_record) AS gain_record,
       count(*) FILTER (WHERE g.gains_void) AS gain_void,
       (SELECT count(DISTINCT a.membership_id) FROM act a JOIN "MembershipRole" mr ON mr."membershipId" = a.membership_id
          JOIN gain x ON x.role_id = mr."roleId" WHERE x.gains_record OR x.gains_void) AS active_members_changed,
       count(*) AS company_roles_that_approve
FROM gain g;

\echo '--- 1c. system roles the code grants both keys to (OWNER, ADMIN, MANAGER, FINANCE) that lack one: the registry sync adds it (expected: 0 rows) ---'
SELECT r.key AS system_role, k.key AS missing_key
FROM "Role" r CROSS JOIN (VALUES ('reimbursement.payment.record'), ('reimbursement.payment.void')) AS k(key)
WHERE r."scopeKey" = 'system' AND r.key IN ('OWNER', 'ADMIN', 'MANAGER', 'FINANCE')
  AND NOT EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = k.key)
ORDER BY 1, 2;

\echo '--- 1d. back-fill table: every key the same release task adds to company roles (the two pay rights and the 22 older back-fill keys), roles per key ---'
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
FROM bf JOIN "Role" r ON r."scopeKey" <> 'system'
WHERE (bf.anchor IS NULL OR EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = bf.anchor))
  AND NOT EXISTS (SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = r.id AND p.key = bf.key)
  AND NOT EXISTS (SELECT 1 FROM "AuditLog" l WHERE l."requestId" = 'sync-permissions:' || bf.key AND l.action = 'access.role.update'
                    AND l."targetType" = 'Role' AND l."targetId" = r.id)
GROUP BY 1, 2 ORDER BY 1;
\echo '--- end of back-fill table ---'

\echo
\echo '=== 2. System Admins who can sign in (the count the data-rights single-admin mode uses) ==='
\echo '--- 2a. the count: membership, user and company ACTIVE, credential not DISABLED, holding the ACTIVE system role SYSTEM_ADMIN (1 = single-admin mode offered) ---'
SELECT count(DISTINCT m."userId") AS system_admins_counted
FROM "CompanyMembership" m JOIN "User" u ON u.id = m."userId" JOIN "Company" c ON c.id = m."companyId"
WHERE m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND c.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "UserCredential" uc WHERE uc."userId" = u.id AND uc.status = 'DISABLED')
  AND EXISTS (SELECT 1 FROM "MembershipRole" mr JOIN "Role" r ON r.id = mr."roleId"
               WHERE mr."membershipId" = m.id AND r.key = 'SYSTEM_ADMIN' AND r.status = 'ACTIVE'
                 AND r."isSystem" AND r."scopeKey" = 'system' AND r."companyId" IS NULL);

\echo '--- 2b. every account holding the system role SYSTEM_ADMIN: statuses and sign-in methods only ---'
WITH h AS (SELECT m."userId", bool_or(m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND r.status = 'ACTIVE') AS usable,
                  string_agg(DISTINCT m.status::text || '/' || c.status::text || '/' || r.status::text, ', ') AS membership_company_role
           FROM "MembershipRole" mr
           JOIN "Role" r ON r.id = mr."roleId" AND r.key = 'SYSTEM_ADMIN' AND r."isSystem" AND r."scopeKey" = 'system' AND r."companyId" IS NULL
           JOIN "CompanyMembership" m ON m.id = mr."membershipId" JOIN "Company" c ON c.id = m."companyId"
           GROUP BY m."userId")
SELECT 'admin #' || row_number() OVER (ORDER BY u."createdAt", u.id) AS account,
       CASE WHEN h.usable AND u.status = 'ACTIVE' AND COALESCE(uc.status::text, '') <> 'DISABLED' THEN 'yes' ELSE 'no' END AS counted,
       u.status::text AS user_status, h.membership_company_role,
       COALESCE(uc.status::text, 'no credential row') AS credential_status,
       CASE WHEN uc.id IS NULL THEN 'none' WHEN uc.status = 'DISABLED' THEN 'disabled'
            WHEN uc."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN 'temporary password expired'
            ELSE COALESCE('by ' || NULLIF(concat_ws(' or ', CASE WHEN u.username IS NOT NULL THEN 'username' END, CASE WHEN u.email IS NOT NULL THEN 'e-mail' END), ''), 'no username or e-mail') END AS password_sign_in,
       CASE WHEN u."emailLoginEnabledAt" IS NOT NULL AND u."emailVerifiedAt" IS NOT NULL THEN 'yes' ELSE 'no' END AS email_code_sign_in,
       (SELECT count(*) FROM "ExternalIdentity" e WHERE e."userId" = u.id AND e.provider = 'LINE' AND e.status = 'ACTIVE') AS line_sign_in_identities
FROM h JOIN "User" u ON u.id = h."userId" LEFT JOIN "UserCredential" uc ON uc."userId" = u.id
ORDER BY u."createdAt", u.id;

\echo
\echo '=== 3. Sales deals stored with a parent menu only (the new salesDealFeatureKeys adds its submenus) ==='
-- par: the 9 menus that have submenus (FEATURE_CATALOG, new build), how many, and how many a deal may sell (= what the new rule adds).
-- bare: one row per deal and parent menu stored without any "<parent>.<submenu>" key.
\set bare 'par(parent, children, adds) AS (VALUES (''expenses'', 6, 6), (''employee_access'', 3, 3), (''company_settings'', 2, 2), (''dashboard_notifications'', 2, 0), (''inventory'', 3, 0), (''procurement'', 7, 0), (''bank_reconciliation'', 6, 0), (''crm'', 7, 0), (''workflow_automation'', 6, 0)), bare AS (SELECT d.id, d."companyId", d.status, d."createdAt", d."offerSnapshotJson" -> ''featureKeys'' AS keys, p.parent, p.children, p.adds FROM "PackageChangeRequest" d JOIN par p ON jsonb_typeof(d."offerSnapshotJson" -> ''featureKeys'') = ''array'' AND d."offerSnapshotJson" -> ''featureKeys'' ? p.parent WHERE d.kind = ''SALES_DEAL'' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d."offerSnapshotJson" -> ''featureKeys'') = ''array'' THEN d."offerSnapshotJson" -> ''featureKeys'' ELSE ''[]''::jsonb END) AS k WHERE k LIKE p.parent || ''.%''))'
\echo '--- 3a. counts ---'
WITH :bare, f AS (SELECT id, "companyId", status, sum(adds) AS adds FROM bare GROUP BY id, "companyId", status)
SELECT (SELECT count(*) FROM "PackageChangeRequest" WHERE kind = 'SALES_DEAL') AS sales_deals,
       count(*) AS deals_with_a_bare_parent,
       count(*) FILTER (WHERE adds > 0) AS changed_by_the_new_rule,
       count(*) FILTER (WHERE adds > 0 AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')) AS of_them_still_open,
       count(*) FILTER (WHERE adds > 0 AND status IN ('PAID', 'APPLIED')) AS of_them_paid_or_applied,
       count(DISTINCT "companyId") FILTER (WHERE adds > 0 AND status IN ('PAID', 'APPLIED')) AS companies_paid_or_applied
FROM f;

\echo '--- 3b. the deals (listed only when fewer than 50) ---'
WITH :bare
SELECT left(id, 8) AS deal, status, to_char("createdAt" + interval '7 hours', 'YYYY-MM') AS created_month,
       string_agg(parent, ', ' ORDER BY parent) AS bare_parents, sum(adds) AS submenus_the_new_rule_adds,
       (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_array_elements_text(keys) AS k) AS stored_keys
FROM bare WHERE (SELECT count(DISTINCT id) FROM bare) < 50
GROUP BY id, status, "createdAt", keys ORDER BY "createdAt", id;

\echo '--- 3c. companies whose plan or menus came from such a deal, paid or applied (listed only when fewer than 50) ---'
WITH :co, :bare
SELECT COALESCE(co.co8, left(b."companyId", 8)) AS company, left(b.id, 8) AS deal, b.status AS deal_status,
       CASE WHEN EXISTS (SELECT 1 FROM "BillingAccount" a JOIN "BillingAttempt" t ON t.id = a."contractAttemptId"
                          JOIN "CompanyPlanTerm" pt ON pt."companyId" = a."companyId" AND pt."billingReceiptAccountId" = a.id
                         WHERE a."companyId" = b."companyId" AND t."dealRequestId" = b.id) THEN 'yes' ELSE 'no' END AS deal_is_the_current_contract,
       string_agg(b.parent, ', ' ORDER BY b.parent) AS bare_parents,
       COALESCE(string_agg(b.parent, ', ' ORDER BY b.parent) FILTER (WHERE
           EXISTS (SELECT 1 FROM "CompanyFeatureEntitlement" e WHERE e."companyId" = b."companyId" AND e."featureKey" = b.parent AND e.enabled)
           AND (SELECT count(*) FROM "CompanyFeatureEntitlement" e WHERE e."companyId" = b."companyId" AND e."featureKey" LIKE b.parent || '.%' AND NOT e.enabled) >= b.children),
         'none') AS menu_on_with_every_submenu_off_today
FROM bare b LEFT JOIN co ON co.id = b."companyId"
WHERE b.adds > 0 AND b.status IN ('PAID', 'APPLIED')
  AND (SELECT count(DISTINCT "companyId") FROM bare WHERE adds > 0 AND status IN ('PAID', 'APPLIED')) < 50
GROUP BY b."companyId", co.co8, b.id, b.status ORDER BY 1, 2;

\echo
\echo '=== 4. Roles holding expense.delete without expense.update (the delete-draft route refused their holders before the fix) ==='
WITH :gain, :act, :mp,
rk AS (SELECT rp."roleId" FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId"
       WHERE p.key IN ('expense.delete', 'expense.update') GROUP BY rp."roleId"
       HAVING bool_or(p.key = 'expense.delete') AND NOT bool_or(p.key = 'expense.update')),
manual_off AS (  -- at run time expense.update is also taken away where the menu "expenses" is on and its submenu "expenses.manual" is off
  SELECT e."companyId" FROM "CompanyFeatureEntitlement" e WHERE e."featureKey" = 'expenses' AND e.enabled
     AND EXISTS (SELECT 1 FROM "CompanyFeatureEntitlement" x WHERE x."companyId" = e."companyId" AND x."featureKey" = 'expenses.manual' AND NOT x.enabled))
SELECT (SELECT count(*) FROM rk JOIN "Role" r ON r.id = rk."roleId" WHERE r."scopeKey" <> 'system') AS company_roles,
       (SELECT count(*) FROM rk JOIN "Role" r ON r.id = rk."roleId" WHERE r."scopeKey" = 'system') AS system_roles,
       (SELECT count(DISTINCT r."companyId") FROM rk JOIN "Role" r ON r.id = rk."roleId" WHERE r."scopeKey" <> 'system') AS companies,
       (SELECT count(DISTINCT a.membership_id) FROM act a JOIN "MembershipRole" mr ON mr."membershipId" = a.membership_id
          JOIN "Role" r ON r.id = mr."roleId" AND r.status = 'ACTIVE' JOIN rk ON rk."roleId" = r.id) AS active_members_holding_such_a_role,
       (SELECT count(*) FROM mp WHERE exp_delete AND NOT exp_update) AS of_them_with_no_other_role_giving_update,
       (SELECT count(*) FROM mp WHERE exp_delete AND exp_update AND "companyId" IN (SELECT "companyId" FROM manual_off)) AS members_refused_because_manual_entry_menu_is_off;

\echo
\echo '=== 5. Sales attribution rows with fraud flags, per Bangkok month of the payment ==='
SELECT to_char(s."paidAt" + interval '7 hours', 'YYYY-MM') AS paid_month,
       count(*) AS attribution_rows,
       count(*) FILTER (WHERE cardinality(s.flags) > 0 AND s."flagReviewedAt" IS NOT NULL) AS flagged_and_reviewed_cut_out_of_the_total,
       count(*) FILTER (WHERE cardinality(s.flags) > 0 AND s."flagReviewedAt" IS NULL) AS flagged_waiting_for_review,
       count(*) FILTER (WHERE cardinality(s.flags) = 0 AND s."flagReviewedAt" IS NOT NULL) AS flags_cleared_by_review_counted,
       COALESCE(sum(GREATEST(0, s."amountSatang" - s."refundedSatang")) FILTER (WHERE cardinality(s.flags) > 0 AND s."flagReviewedAt" IS NOT NULL), 0) AS satang_leaving_the_total_at_release,
       count(*) FILTER (WHERE s."refundedSatang" > 0) AS rows_carrying_a_refund,
       COALESCE(sum(s."refundedSatang"), 0) AS refunded_satang
FROM "SalesAttribution" s GROUP BY 1 ORDER BY 1;

\echo
\echo '=== 6. Refunds and disputes already in production (Bangkok months; the payment time is the invoice row''s creation, or the attribution''s paidAt) ==='
\echo '--- 6a. each change this system observed on a paid invoice (audit action billing.financial.observed), by month of the observation ---'
WITH obs AS (
  SELECT l."createdAt" AS seen_at, COALESCE(sa."paidAt", i."createdAt") AS paid_at,
         CASE WHEN l."metadataJson" #>> '{previous,refundedSatang}' ~ '^[0-9]+$' THEN (l."metadataJson" #>> '{previous,refundedSatang}')::bigint END AS was,
         CASE WHEN l."metadataJson" #>> '{observed,refundedSatang}' ~ '^[0-9]+$' THEN (l."metadataJson" #>> '{observed,refundedSatang}')::bigint END AS now,
         l."metadataJson" #>> '{previous,disputed}' AS was_disputed, l."metadataJson" #>> '{observed,disputed}' AS now_disputed
  FROM "BillingInvoice" i
  JOIN "AuditLog" l ON l."targetType" = 'BillingInvoice' AND l."targetId" = i.id AND l.action = 'billing.financial.observed'
  LEFT JOIN "SalesAttribution" sa ON sa."sourceInvoiceId" = i.id),
ev AS (SELECT seen_at, paid_at, 'refund'::text AS kind, CASE WHEN now > was THEN 'money went back' ELSE 'refunded amount fell' END AS status, now - was AS satang
       FROM obs WHERE now <> was
       UNION ALL
       SELECT seen_at, paid_at, 'dispute', CASE WHEN now_disputed = 'true' THEN 'dispute opened' ELSE 'dispute mark cleared' END, NULL
       FROM obs WHERE now_disputed <> was_disputed)
SELECT to_char(seen_at + interval '7 hours', 'YYYY-MM') AS observed_month, kind, status, count(*) AS events,
       count(*) FILTER (WHERE seen_at <= paid_at + interval '60 days') AS within_60_days_of_the_payment,
       count(*) FILTER (WHERE seen_at > paid_at + interval '60 days') AS later_than_60_days,
       sum(satang) AS satang
FROM ev GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo '--- 6b. paid invoices by month of the payment: how many carry a refund or a dispute today ---'
SELECT to_char(i."createdAt" + interval '7 hours', 'YYYY-MM') AS paid_month, i."productKind" AS product, count(*) AS paid_invoices,
       count(*) FILTER (WHERE i."refundedSatang" > 0) AS with_a_refund,
       count(*) FILTER (WHERE i."refundedSatang" > 0 AND i."refundedSatang" >= i."paidSatang") AS refunded_in_full,
       COALESCE(sum(i."refundedSatang"), 0) AS refunded_satang,
       count(*) FILTER (WHERE i.disputed) AS disputed,
       count(*) FILTER (WHERE (i."refundedSatang" > 0 OR i.disputed) AND NOT EXISTS (
           SELECT 1 FROM "AuditLog" l WHERE l."targetType" = 'BillingInvoice' AND l."targetId" = i.id AND l.action = 'billing.financial.observed')) AS of_them_not_in_6a_no_dated_observation
FROM "BillingInvoice" i WHERE i."providerStatus" = 'paid'
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '--- 6c. refunds made from the admin screens (BillingOperation type REFUND), by month and state ---'
SELECT to_char(o."createdAt" + interval '7 hours', 'YYYY-MM') AS created_month, o.state, count(*) AS refunds,
       COALESCE(sum(CASE WHEN o."proposedJson" ->> 'amountSatang' ~ '^[0-9]+$' THEN (o."proposedJson" ->> 'amountSatang')::bigint END), 0) AS satang,
       count(*) FILTER (WHERE o."createdAt" <= COALESCE(sa."paidAt", i."createdAt") + interval '60 days') AS within_60_days_of_the_payment,
       count(*) FILTER (WHERE o."createdAt" > COALESCE(sa."paidAt", i."createdAt") + interval '60 days') AS later_than_60_days
FROM "BillingOperation" o
LEFT JOIN "BillingInvoice" i ON i.id = o."referenceId"
LEFT JOIN "SalesAttribution" sa ON sa."sourceInvoiceId" = i.id
WHERE o.type = 'REFUND'
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '--- 6d. refunds and disputes the payment provider told this system about (stored events), by month first seen and status; won or lost is not stored ---'
WITH o AS (SELECT e."objectId", CASE WHEN e."eventType" LIKE 'refund.%' THEN 'refund' ELSE 'dispute' END AS kind, min(e."receivedAt") AS first_seen,
                  bool_or(e."eventType" = 'charge.dispute.closed') AS closed, bool_or(e."eventType" = 'refund.failed') AS failed,
                  bool_or(e.status <> 'PROCESSED') AS has_an_event_not_processed
           FROM "BillingProviderEvent" e
           WHERE e."eventType" IN ('refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed')
           GROUP BY 1, 2)
SELECT to_char(first_seen + interval '7 hours', 'YYYY-MM') AS first_seen_month, kind,
       CASE WHEN kind = 'dispute' AND closed THEN 'closed' WHEN kind = 'dispute' THEN 'open' WHEN failed THEN 'failed' ELSE 'made' END AS status,
       count(*) AS how_many, count(*) FILTER (WHERE has_an_event_not_processed) AS with_an_event_not_processed_yet
FROM o GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo
\echo '=== 7. Tax treatment of package sales ==='
\echo '--- 7a. the setting in force: BillingSettings.policyRevisionId -> BillingPolicyRevision.policyJson (taxTreatment, taxRateId) ---'
SELECT CASE WHEN s.livemode THEN 'LIVE' ELSE 'TEST' END AS mode, s.version AS settings_version,
       r.version AS policy_version, r.state AS policy_state,
       COALESCE(r."policyJson" ->> 'taxTreatment', '(not set)') AS tax_mode,
       CASE r."policyJson" ->> 'taxTreatment' WHEN 'EXCLUSIVE_VAT_7' THEN '7% added on top of the price'
            WHEN 'INCLUSIVE_VAT_7' THEN '7% inside the price' WHEN 'NOT_VAT_REGISTERED' THEN 'no VAT' ELSE '-' END AS rate,
       CASE WHEN COALESCE(r."policyJson" ->> 'taxRateId', '') <> '' THEN 'yes' ELSE 'no' END AS provider_tax_rate_attached
FROM "BillingSettings" s LEFT JOIN "BillingPolicyRevision" r ON r.id = s."policyRevisionId"
ORDER BY 1;

\echo '--- 7b. paid invoices by the tax mode frozen in their contract (price = offerSnapshot.priceSatang, subtotal = contractSnapshot.quote.subtotalSatang) ---'
WITH inv AS (
  SELECT CASE WHEN a.livemode THEN 'LIVE' ELSE 'TEST' END AS mode, i."productKind" AS product,
         COALESCE(i."contractSnapshot" #>> '{policy,taxTreatment}', '(no contract snapshot)') AS tax_mode,
         i."totalSatang" AS total, i."taxSatang" AS tax,
         CASE WHEN i."offerSnapshot" ->> 'priceSatang' ~ '^[0-9]+$' THEN (i."offerSnapshot" ->> 'priceSatang')::bigint END AS price,
         CASE WHEN i."contractSnapshot" #>> '{quote,subtotalSatang}' ~ '^[0-9]+$' THEN (i."contractSnapshot" #>> '{quote,subtotalSatang}')::bigint END AS subtotal
  FROM "BillingInvoice" i JOIN "BillingAccount" a ON a.id = i."billingAccountId"
  WHERE i."providerStatus" = 'paid')
SELECT mode, product, tax_mode, count(*) AS paid_invoices,
       count(*) FILTER (WHERE tax > 0) AS with_tax,
       count(*) FILTER (WHERE tax > 0 AND total = subtotal + tax) AS total_is_subtotal_plus_tax,
       count(*) FILTER (WHERE total = subtotal) AS total_is_subtotal,
       count(*) FILTER (WHERE tax > 0 AND total = price + tax) AS tax_added_on_top_of_the_price,
       count(*) FILTER (WHERE total = price) AS total_is_the_price,
       count(*) FILTER (WHERE total IS DISTINCT FROM price AND total IS DISTINCT FROM price + tax) AS another_amount,
       sum(total) AS total_satang, sum(tax) AS tax_satang
FROM inv GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo
\echo '=== 8. Notification rules an admin changed (they keep the editing user''s id) ==='
\echo '--- 8a. workflow notification rules (WorkflowRule) made or edited by a person, per trigger = template key; ALL = every trigger ---'
WITH rules AS (
  SELECT r."companyId", r.status::text AS status,
         CASE WHEN t.key LIKE 'reimbursement\_%' OR t.key = 'approval_sla_breach' THEN 'claim' ELSE 'other' END AS area,
         COALESCE(t.key, '(custom rule, no template)') AS trigger_key,
         -- the release re-pins a rule the sync made whose content still equals a version the sync wrote; any other keeps its own definition
         (r."createdByUserId" = 'system:workflow-template-sync' AND EXISTS (
            SELECT 1 FROM "WorkflowRuleVersion" v
            WHERE v."ruleId" = r.id AND v."createdByUserId" = 'system:workflow-template-sync' AND v."cooldownSeconds" = r."cooldownSeconds"
              AND v."triggerSnapshotJson" = r."triggerConfigJson" AND v."conditionSnapshotJson" = r."conditionJson"
              AND v."actionSnapshotJson" = r."actionJson")) AS repinned_by_the_release
  FROM "WorkflowRule" r LEFT JOIN "WorkflowTemplate" t ON t.id = r."templateId"
  WHERE r."createdByUserId" <> 'system:workflow-template-sync'
     OR (r."updatedByUserId" IS NOT NULL AND r."updatedByUserId" <> 'system:workflow-template-sync'))
SELECT CASE WHEN GROUPING(area) = 1 THEN 'ALL' ELSE area END AS area,
       CASE WHEN GROUPING(trigger_key) = 1 THEN '(every trigger)' ELSE trigger_key END AS trigger_key,
       count(*) AS rules_an_admin_changed,
       count(*) FILTER (WHERE status = 'ENABLED') AS enabled,
       count(*) FILTER (WHERE status = 'DISABLED') AS disabled,
       count(*) FILTER (WHERE status NOT IN ('ENABLED', 'DISABLED')) AS draft_or_archived,
       count(*) FILTER (WHERE NOT repinned_by_the_release) AS keep_their_own_definition,
       count(DISTINCT "companyId") AS companies
FROM rules GROUP BY ROLLUP (area, trigger_key)
ORDER BY GROUPING(area), area, GROUPING(trigger_key), trigger_key;

\echo '--- 8b. the four new claim notices: the release gives one to every ACTIVE company, switched off where the older notice it follows is switched off ---'
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

\echo '--- 8c. bell notification rules (NotificationRule) edited by an admin, per trigger key; ALL = every trigger ---'
SELECT CASE WHEN GROUPING(area) = 1 THEN 'ALL' ELSE area END AS area,
       CASE WHEN GROUPING("triggerKey") = 1 THEN '(every trigger)' ELSE "triggerKey" END AS trigger_key,
       count(*) AS rules_an_admin_changed,
       count(*) FILTER (WHERE status = 'ENABLED') AS enabled,
       count(*) FILTER (WHERE status = 'DISABLED') AS disabled,
       count(*) FILTER (WHERE status = 'SYSTEM') AS system_state,
       count(DISTINCT "companyId") AS companies
FROM (SELECT n.*, CASE WHEN n."triggerKey" LIKE '%reimbursement%' OR n."triggerKey" LIKE '%approval%' THEN 'claim' ELSE 'other' END AS area
      FROM "NotificationRule" n WHERE n."updatedByUserId" IS NOT NULL) x
GROUP BY ROLLUP (area, "triggerKey")
ORDER BY GROUPING(area), area, GROUPING("triggerKey"), "triggerKey";

\echo
\echo '=== 9. Claims in flight ==='
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
\echo '=== 10. Per company: claim settings that change what people see after the release ==='
WITH :co, :gain, :act, :mp,
pol AS (SELECT "companyId", "financeReviewRequired" AS finance_step, "slaHours" AS reminder_hours FROM "ReimbursementPolicy" WHERE "branchId" IS NULL),
cl AS (SELECT "companyId", count(*) FILTER (WHERE status NOT IN ('PAID', 'REJECTED', 'CANCELLED', 'VOIDED')) AS in_flight,
              count(*) FILTER (WHERE status IN ('READY_FOR_PAYMENT', 'PARTIALLY_PAID')) AS waiting_for_payment
       FROM "ReimbursementRequest" GROUP BY "companyId"),
mem AS (SELECT a."companyId", count(*) AS active_members,
               count(*) FILTER (WHERE m.can_approve) AS can_approve,
               count(*) FILTER (WHERE m.can_record) AS can_record_payment_today,
               count(*) FILTER (WHERE m.can_record OR m.gets_record) AS can_record_payment_after_back_fill
        FROM act a LEFT JOIN mp m ON m.membership_id = a.membership_id GROUP BY a."companyId")
SELECT co.co8 AS company, co.co_status AS company_status,
       CASE WHEN pol."companyId" IS NULL THEN 'off (no policy row)' WHEN pol.finance_step THEN 'on' ELSE 'off' END AS finance_review_step,
       COALESCE(pol.reminder_hours::text, 'not set') AS reminder_hours,
       COALESCE(mem.active_members, 0) AS active_members,
       COALESCE(mem.can_approve, 0) AS can_approve_claims,
       COALESCE(mem.can_record_payment_today, 0) AS can_record_payment_today,
       COALESCE(mem.can_record_payment_after_back_fill, 0) AS can_record_payment_after_back_fill,
       COALESCE(cl.in_flight, 0) AS claims_in_flight,
       COALESCE(cl.waiting_for_payment, 0) AS waiting_for_payment
FROM co
LEFT JOIN pol ON pol."companyId" = co.id
LEFT JOIN cl ON cl."companyId" = co.id
LEFT JOIN mem ON mem."companyId" = co.id
ORDER BY COALESCE(cl.in_flight, 0) DESC, co.co8
LIMIT 300;

\echo
\echo '=== 11. Closing: server, last applied migration, row counts of the claim tables ==='
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
             ('ReimbursementDraftAction',        (SELECT count(*) FROM "ReimbursementDraftAction"))) AS t(claim_table, row_count);

SELECT round(extract(epoch FROM (clock_timestamp() - transaction_timestamp()))::numeric, 2) AS script_seconds;
\echo '##### end of pre-release-checks.sql #####'
ROLLBACK;
