import { createHash } from 'node:crypto';
import type { ProductionA5MigrationOperationClass } from '../../src/scripts/production-a5-evidence.logic';
import { sha256, stableJson } from '../../src/scripts/a5-readonly-evidence.logic';

export type ProductionA5ReviewedQueryDefinition = {
  id: string;
  sql: string;
  queryHash: string;
  expectedResultHash: string;
};

export type ProductionA5ReviewedMigrationDefinition = {
  migrationName: string;
  operationClass: ProductionA5MigrationOperationClass;
  preconditions: ProductionA5ReviewedQueryDefinition[];
  postSchemaInvariants: ProductionA5ReviewedQueryDefinition[];
  postDataInvariants: ProductionA5ReviewedQueryDefinition[];
};

const PASS_RESULT = [{ result: 'PASS' }];

function passQuery(id: string, predicate: string): ProductionA5ReviewedQueryDefinition {
  const sql = `SELECT CASE WHEN (${predicate}) THEN 'PASS' ELSE 'FAIL' END AS result`;
  return { id, sql, queryHash: sha256(sql), expectedResultHash: sha256(stableJson(PASS_RESULT)) };
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tableExists(table: string): string {
  return `EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${literal(table)} AND c.relkind IN ('r','p')
  )`;
}

function columnExists(table: string, column: string, suffix = ''): string {
  return `EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = ${literal(table)} AND c.relkind IN ('r','p')
      AND a.attname = ${literal(column)} AND a.attnum > 0 AND NOT a.attisdropped${suffix}
  )`;
}

function indexExists(index: string): string {
  return `EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'public' AND idx.relname = ${literal(index)} AND idx.relkind = 'i'
      AND tbl.relkind IN ('r','p') AND i.indisvalid AND i.indisready
  )`;
}

function indexAbsent(index: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pg_class idx JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = 'public' AND idx.relname = ${literal(index)} AND idx.relkind = 'i'
  )`;
}

function uniqueIndexExists(table: string, index: string, columns: string[], predicateTokens: string[] = []): string {
  const predicate = predicateTokens.length === 0
    ? 'AND i.indpred IS NULL'
    : `AND i.indpred IS NOT NULL ${predicateTokens.map((token) => (
      `AND pg_get_expr(i.indpred, i.indrelid) LIKE ${literal(`%${token}%`)}`
    )).join(' ')}`;
  return `EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'public' AND tbl.relname = ${literal(table)} AND tbl.relkind IN ('r','p')
      AND idx.relname = ${literal(index)} AND idx.relkind = 'i'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = ${columns.length}
      AND (SELECT array_agg(a.attname::text ORDER BY key.ordinality)
             FROM unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality)
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum)
          = ARRAY[${columns.map(literal).join(',')} ]::text[]
      ${predicate}
  )`;
}

function exactPartialUniqueIndexExists(
  table: string,
  index: string,
  columns: string[],
  predicate: string,
): string {
  return `EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'public' AND tbl.relname = ${literal(table)} AND tbl.relkind IN ('r','p')
      AND idx.relname = ${literal(index)} AND idx.relkind = 'i'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts = ${columns.length}
      AND (SELECT array_agg(a.attname::text ORDER BY key.ordinality)
             FROM unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality)
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum)
          = ARRAY[${columns.map(literal).join(',')} ]::text[]
      AND i.indpred IS NOT NULL
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '\\s+', '', 'g')
          = regexp_replace(${literal(predicate)}, '\\s+', '', 'g')
  )`;
}

function activeDataRightsPredicate(caseType: string): string {
  return `(("caseType" = ${literal(caseType)}::"DataRightsCaseType") AND ("status" <> ALL (ARRAY[${[
    'COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED',
  ].map((status) => `${literal(status)}::"DataRightsCaseStatus"`).join(', ')}])))`;
}

function constraintExists(table: string, constraint: string, suffix = ''): string {
  return `EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${literal(table)} AND c.relkind IN ('r','p')
      AND con.conname = ${literal(constraint)} AND con.convalidated${suffix}
  )`;
}

function enumValueExists(type: string, value: string): string {
  return `EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${literal(type)} AND e.enumlabel = ${literal(value)}
  )`;
}

function enumValuesEqual(type: string, values: readonly string[]): string {
  const valuesHash = createHash('md5').update(values.join(',')).digest('hex');
  return `(SELECT COUNT(*) = ${values.length}
      AND md5(COALESCE(string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder), '')) = ${literal(valuesHash)}
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${literal(type)})`;
}

function exactTriggerFunctionExists(
  table: string,
  trigger: string,
  functionName: string,
  triggerType: number,
  functionBodyMd5: string,
): string {
  return `EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class tbl ON tbl.oid = tg.tgrelid
    JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_proc fn ON fn.oid = tg.tgfoid
    JOIN pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
    JOIN pg_language lang ON lang.oid = fn.prolang
    WHERE tbl_ns.nspname = 'public' AND tbl.relname = ${literal(table)} AND tbl.relkind IN ('r','p')
      AND fn_ns.nspname = 'public' AND fn.proname = ${literal(functionName)}
      AND tg.tgname = ${literal(trigger)} AND NOT tg.tgisinternal AND tg.tgenabled = 'O'
      AND tg.tgtype = ${triggerType} AND tg.tgnargs = 0 AND tg.tgqual IS NULL
      AND tg.tgattr = ''::int2vector
      AND lang.lanname = 'plpgsql' AND fn.prorettype = 'trigger'::regtype AND fn.pronargs = 0
      AND NOT fn.prosecdef AND fn.provolatile = 'v'
      AND fn.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
      AND md5(fn.prosrc) = ${literal(functionBodyMd5)}
  )`;
}

function triggerFunctionExists(
  table: string,
  trigger: string,
  functionName: string,
  functionBodyMd5: string,
): string {
  return `EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class tbl ON tbl.oid = tg.tgrelid
    JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_proc fn ON fn.oid = tg.tgfoid
    JOIN pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
    JOIN pg_language lang ON lang.oid = fn.prolang
    WHERE tbl_ns.nspname = 'public' AND tbl.relname = ${literal(table)} AND tbl.relkind IN ('r','p')
      AND fn_ns.nspname = 'public' AND fn.proname = ${literal(functionName)}
      AND tg.tgname = ${literal(trigger)} AND NOT tg.tgisinternal AND tg.tgenabled = 'O' AND tg.tgtype = 5
      AND tg.tgnargs = 0 AND tg.tgqual IS NULL
      AND lang.lanname = 'plpgsql' AND fn.prorettype = 'trigger'::regtype AND fn.pronargs = 0
      AND NOT fn.prosecdef AND fn.provolatile = 'v'
      AND fn.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
      AND md5(fn.prosrc) = ${literal(functionBodyMd5)}
  )`;
}

function all(...predicates: string[]): string {
  return predicates.map((predicate) => `(${predicate})`).join(' AND ');
}

function migrationNotApplied(migrationName: string): ProductionA5ReviewedQueryDefinition {
  return passQuery(
    `${migrationName}:PRE_NOT_APPLIED`,
    `NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ${literal(migrationName)} AND finished_at IS NOT NULL AND rolled_back_at IS NULL)`,
  );
}

function migration(
  migrationName: string,
  operationClass: ProductionA5MigrationOperationClass,
  postSchemaPredicate: string,
  options: { pre?: Array<[id: string, predicate: string]>; postData?: Array<[id: string, predicate: string]> } = {},
): ProductionA5ReviewedMigrationDefinition {
  const byId = (left: ProductionA5ReviewedQueryDefinition, right: ProductionA5ReviewedQueryDefinition) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  return {
    migrationName,
    operationClass,
    preconditions: [
      migrationNotApplied(migrationName),
      ...(options.pre ?? []).map(([id, predicate]) => passQuery(`${migrationName}:${id}`, predicate)),
    ].sort(byId),
    postSchemaInvariants: [passQuery(`${migrationName}:POST_SCHEMA`, postSchemaPredicate)],
    postDataInvariants: (options.postData ?? [])
      .map(([id, predicate]) => passQuery(`${migrationName}:${id}`, predicate)).sort(byId),
  };
}

const attachmentTenantClean = `NOT EXISTS (
  SELECT 1 FROM "AttachmentLink" link
  LEFT JOIN "AttachmentObject" object
    ON object."companyId" = link."companyId" AND object."id" = link."attachmentId"
  WHERE object."id" IS NULL
)`;

const branchTenantClean = `NOT EXISTS (
  SELECT 1 FROM (
    SELECT d."id" FROM "AccountingDocument" d LEFT JOIN "AccountingCounterparty" c ON c."companyId" = d."companyId" AND c."id" = d."counterpartyId" WHERE d."counterpartyId" IS NOT NULL AND c."id" IS NULL
    UNION ALL SELECT d."id" FROM "AccountingDocument" d LEFT JOIN "Branch" b ON b."companyId" = d."companyId" AND b."id" = d."branchId" WHERE d."branchId" IS NOT NULL AND b."id" IS NULL
    UNION ALL SELECT l."id" FROM "AccountingDocumentLine" l LEFT JOIN "AccountingDocument" d ON d."companyId" = l."companyId" AND d."id" = l."documentId" WHERE d."id" IS NULL
    UNION ALL SELECT p."id" FROM "AccountingPayment" p LEFT JOIN "AccountingCounterparty" c ON c."companyId" = p."companyId" AND c."id" = p."counterpartyId" WHERE p."counterpartyId" IS NOT NULL AND c."id" IS NULL
    UNION ALL SELECT p."id" FROM "AccountingPayment" p LEFT JOIN "Branch" b ON b."companyId" = p."companyId" AND b."id" = p."branchId" WHERE p."branchId" IS NOT NULL AND b."id" IS NULL
    UNION ALL SELECT a."id" FROM "AccountingPaymentAllocation" a LEFT JOIN "AccountingPayment" p ON p."companyId" = a."companyId" AND p."id" = a."paymentId" WHERE p."id" IS NULL
    UNION ALL SELECT a."id" FROM "AccountingPaymentAllocation" a LEFT JOIN "AccountingDocument" d ON d."companyId" = a."companyId" AND d."id" = a."documentId" WHERE d."id" IS NULL
    UNION ALL SELECT b."id" FROM "BankAccount" b LEFT JOIN "Branch" branch ON branch."companyId" = b."companyId" AND branch."id" = b."branchId" WHERE b."branchId" IS NOT NULL AND branch."id" IS NULL
    UNION ALL SELECT i."id" FROM "BankStatementImport" i LEFT JOIN "BankAccount" b ON b."companyId" = i."companyId" AND b."id" = i."bankAccountId" WHERE b."id" IS NULL
    UNION ALL SELECT l."id" FROM "BankStatementLine" l LEFT JOIN "BankAccount" b ON b."companyId" = l."companyId" AND b."id" = l."bankAccountId" WHERE b."id" IS NULL
    UNION ALL SELECT l."id" FROM "BankStatementLine" l LEFT JOIN "BankStatementImport" i ON i."companyId" = l."companyId" AND i."id" = l."importId" WHERE l."importId" IS NOT NULL AND i."id" IS NULL
    UNION ALL SELECT m."id" FROM "BankReconciliationMatch" m LEFT JOIN "BankAccount" b ON b."companyId" = m."companyId" AND b."id" = m."bankAccountId" WHERE b."id" IS NULL
    UNION ALL SELECT m."id" FROM "BankReconciliationMatch" m LEFT JOIN "BankStatementLine" l ON l."companyId" = m."companyId" AND l."id" = m."statementLineId" WHERE l."id" IS NULL
    UNION ALL SELECT a."id" FROM "BankAdjustment" a LEFT JOIN "BankAccount" b ON b."companyId" = a."companyId" AND b."id" = a."bankAccountId" WHERE b."id" IS NULL
    UNION ALL SELECT s."id" FROM "BankReconciliationSession" s LEFT JOIN "BankAccount" b ON b."companyId" = s."companyId" AND b."id" = s."bankAccountId" WHERE b."id" IS NULL
    UNION ALL SELECT l."id" FROM "BankReconciliationSessionLine" l LEFT JOIN "BankReconciliationSession" s ON s."companyId" = l."companyId" AND s."id" = l."sessionId" WHERE s."id" IS NULL
    UNION ALL SELECT l."id" FROM "BankReconciliationSessionLine" l LEFT JOIN "BankStatementLine" s ON s."companyId" = l."companyId" AND s."id" = l."statementLineId" WHERE s."id" IS NULL
    UNION ALL SELECT e."id" FROM "BankReconciliationEvidenceExport" e LEFT JOIN "BankReconciliationSession" s ON s."companyId" = e."companyId" AND s."id" = e."sessionId" WHERE s."id" IS NULL
  ) invalid
)`;

const validBankLedgerLinks = `NOT EXISTS (
  SELECT 1 FROM "BankAccount" bank
  LEFT JOIN "ChartOfAccount" account
    ON account."companyId" = bank."companyId" AND account."id" = bank."ledgerAccountId"
  WHERE bank."ledgerAccountId" IS NOT NULL AND (
    account."id" IS NULL OR account."status" <> 'ACTIVE' OR account."isPosting" = FALSE
    OR account."isControlled" = TRUE OR account."accountClass" <> 'ASSET'
    OR account."normalBalance" <> 'DEBIT' OR NOT (
      UPPER(TRIM(COALESCE(account."cashFlowCategory", ''))) IN ('BANK','CASH','CASH_AND_BANK','CASH_OR_BANK')
      OR LOWER(TRIM(COALESCE(account."reportGroup", ''))) = 'cash'
      OR account."code" ~ '^111[1-4]-[0-9]{2}$'
    )
  )
)`;

const bookingBoundsClean = `NOT EXISTS (
  SELECT 1 FROM "Company" WHERE "bookingBufferMinutes" IS NOT NULL AND "bookingBufferMinutes" NOT IN (0,30,60,90,120)
) AND NOT EXISTS (
  SELECT 1 FROM "Product" WHERE "bookingDurationMinutes" IS NOT NULL
    AND NOT ("bookingDurationMinutes" BETWEEN 60 AND 180 AND "bookingDurationMinutes" % 30 = 0)
)`;

const attemptIdentityClean = `NOT EXISTS (
  SELECT 1 FROM "ExecutionAttempt"
  GROUP BY COALESCE("companyId", '__platform__'), "sourceType", "sourceId", "attemptSeq"
  HAVING count(*) > 1
)`;

const remoteReleaseClean = `NOT EXISTS (
  SELECT 1 FROM "RemoteReleaseOperation"
  WHERE "sourceBranch" IS NULL OR "controllerKind" IS NULL
    OR "controllerKind" NOT IN ('GITHUB_ACTIONS','MANUAL')
    OR (("controllerKind" = 'GITHUB_ACTIONS') <> (
      "githubRunId" IS NOT NULL AND "githubRunAttempt" IS NOT NULL
      AND "githubActor" IS NOT NULL AND "githubActorId" IS NOT NULL
      AND "githubWorkflowRef" IS NOT NULL AND "githubRepository" IS NOT NULL
      AND "manualActorRef" IS NULL
    ))
    OR (("controllerKind" = 'MANUAL') <> (
      "manualActorRef" IS NOT NULL AND "githubRunId" IS NULL AND "githubRunAttempt" IS NULL
      AND "githubActor" IS NULL AND "githubActorId" IS NULL
      AND "githubWorkflowRef" IS NULL AND "githubRepository" IS NULL
    ))
    OR ("status" = 'UNKNOWN' AND ("unknownAt" IS NULL OR "outcomeReason" IS NULL))
    OR ("manualActorRef" = 'legacy-bootstrap:unknown' AND (
      "sourceBranch" <> CASE WHEN "targetEnvironment" = 'uat' THEN 'develop' ELSE 'main' END
      OR "status" = 'RUNNING' OR "outcomeReason" IS NULL
    ))
)`;

const reimbursementBackfillFixedPoint = `NOT EXISTS (
  SELECT 1 FROM "ReimbursementRequest" request
  WHERE NOT EXISTS (
    SELECT 1 FROM "ReimbursementLine" line WHERE line."reimbursementRequestId" = request."id"
  )
) AND NOT EXISTS (
  SELECT 1 FROM "ReimbursementLine" line
  LEFT JOIN "ReimbursementRequest" request ON request."id" = line."reimbursementRequestId"
  WHERE request."id" IS NULL OR request."companyId" <> line."companyId"
) AND NOT EXISTS (
  SELECT 1 FROM "ReimbursementRequest" request
  JOIN LATERAL (
    SELECT SUM(line."amount") AS total,
           MIN(line."incurredDate") AS "earliestDate",
           COUNT(*)::int AS "lineCount",
           MIN(line."lineNo") AS "minLineNo",
           MAX(line."lineNo") AS "maxLineNo",
           COUNT(DISTINCT line."categoryKey")::int AS "categoryCount",
           MAX(line."categoryKey") FILTER (WHERE line."lineNo" = 1) AS "firstCategoryKey",
           MAX(line."categoryLabelSnapshot") FILTER (WHERE line."lineNo" = 1) AS "firstCategoryLabel"
      FROM "ReimbursementLine" line
    WHERE line."reimbursementRequestId" = request."id"
  ) lines ON TRUE
  WHERE request."amount" IS DISTINCT FROM lines.total
     OR request."incurredDate" IS DISTINCT FROM lines."earliestDate"
     OR lines."minLineNo" <> 1 OR lines."maxLineNo" <> lines."lineCount"
     OR request."categoryKey" IS DISTINCT FROM lines."firstCategoryKey"
     OR request."categoryLabelSnapshot" IS DISTINCT FROM CASE
       WHEN lines."categoryCount" = 1 THEN lines."firstCategoryLabel"
       ELSE 'หลายหมวด (' || lines."lineCount" || ' รายการ)'
     END
) AND NOT EXISTS (
  SELECT 1 FROM "ReimbursementRequest" request
  JOIN "ReimbursementLine" line ON line."reimbursementRequestId" = request."id"
  WHERE line."id" = 'rbl_' || request."id" AND (
    line."companyId" IS DISTINCT FROM request."companyId"
    OR line."lineNo" <> 1
    OR line."incurredDate" IS DISTINCT FROM request."incurredDate"
    OR line."description" IS DISTINCT FROM COALESCE(
      NULLIF(btrim(request."title"), ''), NULLIF(btrim(request."reason"), ''), 'รายการเบิก'
    )
    OR line."purpose" IS NOT NULL
    OR line."categoryKey" IS DISTINCT FROM request."categoryKey"
    OR line."categoryLabelSnapshot" IS DISTINCT FROM request."categoryLabelSnapshot"
    OR line."amount" IS DISTINCT FROM request."amount"
    OR line."attachmentId" IS DISTINCT FROM request."primaryAttachmentId"
    OR line."linkedExpenseId" IS DISTINCT FROM request."linkedExpenseId"
  )
)`;

export const PRODUCTION_A5_REVIEWED_MIGRATIONS: readonly ProductionA5ReviewedMigrationDefinition[] = [
  migration('20260712090000_crm_campaign_broadcast', 'ADDITIVE', all(
    tableExists('CrmCampaign'), tableExists('CrmCampaignRecipient'),
    enumValueExists('CrmCampaignStatus', 'CANCELLED'),
  )),
  migration('20260712103000_company_business_policy', 'ADDITIVE', tableExists('CompanyBusinessPolicy')),
  migration('20260712120000_company_retention_consent_policy', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('CompanyBusinessPolicy', 'retentionPolicyJson'),
    columnExists('CompanyBusinessPolicy', 'consentPolicyJson'),
  )),
  migration('20260712130000_employee_profile_email', 'ADDITIVE', columnExists('EmployeeAccessProfile', 'email')),
  migration('20260726120000_add_reimbursement_line', 'DATA_BACKFILL', all(
    tableExists('ReimbursementLine'), uniqueIndexExists(
      'ReimbursementLine', 'ReimbursementLine_reimbursementRequestId_lineNo_key',
      ['reimbursementRequestId', 'lineNo'],
    ),
  ), {
    postData: [['POST_DATA_FIXED_POINT', reimbursementBackfillFixedPoint]],
  }),
  migration('20260726120000_crm_booking_deposit_amounts', 'ADDITIVE', all(
    columnExists('CrmBooking', 'depositAmount'), columnExists('CrmBooking', 'totalAmount'),
  )),
  migration('20260726160000_add_reimbursement_claim_signature', 'ADDITIVE', all(
    tableExists('ReimbursementClaimSignature'),
    uniqueIndexExists(
      'ReimbursementClaimSignature', 'ReimbursementClaimSignature_reimbursementRequestId_role_key',
      ['reimbursementRequestId', 'role'],
    ),
  )),
  migration('20260728120000_m03_crm_ai_outbound_policy', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('CrmMessageTemplate', 'aiApprovedVersion'),
    constraintExists('CrmMessageTemplate', 'CrmMessageTemplate_ai_approval_metadata_check', " AND con.contype = 'c'"),
  )),
  migration('20260728120000_stock_movement_single_reversal', 'BLOCKING_CONTRACT',
    uniqueIndexExists('StockMovement', 'StockMovement_reversesMovementId_key', ['reversesMovementId']), {
      pre: [['PRE_NO_DUPLICATE_REVERSALS', `NOT EXISTS (
        SELECT 1 FROM "StockMovement" WHERE "reversesMovementId" IS NOT NULL
        GROUP BY "reversesMovementId" HAVING count(*) > 1
      )`]],
    }),
  migration('20260728150000_p1_pdpa_durable_cases', 'ADDITIVE', all(
    tableExists('CrmDataSubjectRequest'), uniqueIndexExists(
      'CrmDataSubjectRequest', 'CrmDataSubjectRequest_requestKey_key', ['requestKey'],
    ),
  )),
  migration('20260728160000_p1_attachment_link_tenant_fk', 'BLOCKING_CONTRACT',
    constraintExists('AttachmentLink', 'AttachmentLink_companyId_attachmentId_fkey', " AND con.contype = 'f'"), {
      pre: [['PRE_TENANT_LINKS_VALID', attachmentTenantClean]],
    }),
  migration('20260728170000_p1_branch_tenant_integrity', 'BLOCKING_CONTRACT', all(
    constraintExists('AccountingDocument', 'AccountingDocument_companyId_counterpartyId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingDocument', 'AccountingDocument_companyId_branchId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingDocumentLine', 'AccountingDocumentLine_companyId_documentId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingPayment', 'AccountingPayment_companyId_counterpartyId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingPayment', 'AccountingPayment_companyId_branchId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingPaymentAllocation', 'AccountingPaymentAllocation_companyId_paymentId_fkey', " AND con.contype = 'f'"),
    constraintExists('AccountingPaymentAllocation', 'AccountingPaymentAllocation_companyId_documentId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankAccount', 'BankAccount_companyId_branchId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankStatementImport', 'BankStatementImport_companyId_bankAccountId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankStatementLine', 'BankStatementLine_companyId_bankAccountId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankStatementLine', 'BankStatementLine_companyId_importId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationMatch', 'BankReconciliationMatch_companyId_bankAccountId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationMatch', 'BankReconciliationMatch_companyId_statementLineId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankAdjustment', 'BankAdjustment_companyId_bankAccountId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationSession', 'BankReconciliationSession_companyId_bankAccountId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationSessionLine', 'BankReconciliationSessionLine_companyId_sessionId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationSessionLine', 'BankReconciliationSessionLine_companyId_statementLineId_fkey', " AND con.contype = 'f'"),
    constraintExists('BankReconciliationEvidenceExport', 'BankReconciliationEvidenceExport_companyId_sessionId_fkey', " AND con.contype = 'f'"),
  ), { pre: [['PRE_CROSS_TENANT_REFERENCES_VALID', branchTenantClean]] }),
  migration('20260728180000_p1_ai_lineage', 'ADDITIVE', all(
    columnExists('AiTurn', 'modelLineageJson'), columnExists('ReceiptExtraction', 'processingRegion'),
    columnExists('ReceiptAiVerification', 'processingPurpose'),
  )),
  migration('20260728190000_l01_refresh_token_reuse_detection', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('AuthSession', 'previousTokenId'),
    uniqueIndexExists('AuthSession', 'AuthSession_previousTokenId_key', ['previousTokenId']),
  )),
  migration('20260728191000_l15_tombstone_durability', 'BLOCKING_CONTRACT',
    constraintExists(
      'CrmDataSubjectRequest', 'CrmDataSubjectRequest_companyId_customerId_fkey',
      " AND con.contype = 'f' AND con.confdeltype = 'r'",
    ), {
      pre: [['PRE_CUSTOMER_PRESENT_REQUEST_TABLE_ABSENT', all(
        `to_regclass('"CrmDataSubjectRequest"') IS NULL`, tableExists('CrmCustomer'),
      )]],
    }),
  migration('20260728192000_l01_refresh_token_family', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('AuthSession', 'familyId'),
    uniqueIndexExists('AuthSession', 'AuthSession_familyId_key', ['familyId']),
  )),
  migration('20260728200000_user_ai_assistant_opt_out', 'ADDITIVE', columnExists('User', 'aiAssistantOptOutAt')),
  migration('20260728210000_add_expense_source_reimbursement', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('ExpenseRecord', 'sourceReimbursementRequestId'),
    indexExists('ExpenseRecord_companyId_sourceReimbursementRequestId_idx'),
  )),
  migration('20260728210000_company_business_category', 'ADDITIVE', all(
    columnExists('Company', 'businessCategory'), enumValueExists('CompanyBusinessCategory', 'CLINIC'),
  )),
  migration('20260729120000_ai_usage_ledger', 'ADDITIVE', all(
    tableExists('AiUsageEvent'), tableExists('CompanyAiMonthlyUsage'),
    uniqueIndexExists(
      'CompanyAiMonthlyUsage', 'CompanyAiMonthlyUsage_companyId_monthKey_key', ['companyId', 'monthKey'],
    ),
  )),
  migration('20260729183000_attachment_perceptual_hash', 'ADDITIVE', columnExists('AttachmentObject', 'perceptualHash')),
  migration('20260730120000_company_ai_monthly_budget', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('CompanyAiConfiguration', 'monthlyBudgetSatang'),
    `EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"CompanyAiConfiguration"') AND attname = 'modelId' AND NOT attnotnull)`,
  )),
  migration('20260731120000_ai_fx_and_platform_budget', 'DATA_BACKFILL', all(
    columnExists(
      'AiUsageEvent', 'thbPerUsd',
      " AND format_type(a.atttypid, a.atttypmod) = 'numeric(10,4)' AND a.attnotnull",
    ), tableExists('AiFxRate'), tableExists('PlatformAiBudgetConfig'),
  ), {
    postData: [['POST_DATA_FX_PRESENT', `NOT EXISTS (SELECT 1 FROM "AiUsageEvent" WHERE "thbPerUsd" IS NULL)`]],
  }),
  migration('20260731130000_ai_usage_fx_source', 'DATA_BACKFILL', columnExists(
    'AiUsageEvent', 'thbPerUsdSource', " AND format_type(a.atttypid, a.atttypmod) = 'text' AND a.attnotnull",
  ), {
    postData: [['POST_DATA_SOURCE_PRESENT', `NOT EXISTS (SELECT 1 FROM "AiUsageEvent" WHERE "thbPerUsdSource" IS NULL)`]],
  }),
  migration('20260801120000_chart_of_accounts_master_bootstrap', 'BLOCKING_CONTRACT', all(
    columnExists('Company', 'chartOfAccountsTemplateChecksum'),
    uniqueIndexExists('ChartOfAccount', 'ChartOfAccount_companyId_id_key', ['companyId', 'id']),
    constraintExists('BankAccount', 'BankAccount_companyId_ledgerAccountId_fkey', " AND con.contype = 'f'"),
  ), { pre: [['PRE_BANK_LEDGER_LINKS_VALID', validBankLedgerLinks]] }),
  migration('20260801130000_feature_launch_control_plane_additive', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    tableExists('EntitlementTransition'), tableExists('RunoffSnapshot'),
    tableExists('CompanyEntitlementNormalization'), tableExists('FeatureLaunchGate'),
    tableExists('FeatureLaunchGateTransition'), tableExists('ExecutionAttempt'), tableExists('BackfillRun'),
  )),
  migration('20260801150000_drift_forward_fix', 'BLOCKING_CONTRACT', all(
    enumValueExists('AiTurnIntent', 'EVIDENCE_CAPTURE'),
    enumValueExists('AiTurnIntent', 'SIGNATURE_REQUEST'),
    enumValueExists('AiTurnIntent', 'CLARIFY'),
    constraintExists(
      'Company', 'Company_bookingBufferMinutes_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%ARRAY[0, 30, 60, 90, 120]%'",
    ),
    constraintExists(
      'Product', 'Product_bookingDurationMinutes_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%bookingDurationMinutes%>= 60%' AND pg_get_constraintdef(con.oid, true) LIKE '%bookingDurationMinutes%<= 180%' AND pg_get_constraintdef(con.oid, true) LIKE '% 30%=%0%'",
    ),
    columnExists('CrmDataSubjectRequest', 'updatedAt', ' AND d.adbin IS NULL'),
    columnExists('ThaiAddressMaster', 'updatedAt', ' AND d.adbin IS NULL'),
    constraintExists(
      'CrmCampaignRecipient', 'CrmCampaignRecipient_companyId_fkey',
      " AND con.contype = 'f' AND con.confupdtype = 'c'",
    ),
    constraintExists(
      'CrmCampaign', 'CrmCampaign_companyId_fkey', " AND con.contype = 'f' AND con.confupdtype = 'c'",
    ),
    constraintExists(
      'CrmCampaign', 'CrmCampaign_channelId_fkey', " AND con.contype = 'f' AND con.confupdtype = 'c'",
    ),
    constraintExists(
      'CrmCampaignRecipient', 'CrmCampaignRecipient_campaignId_fkey',
      " AND con.contype = 'f' AND con.confupdtype = 'c'",
    ),
    constraintExists(
      'CrmCampaignRecipient', 'CrmCampaignRecipient_channelIdentityId_fkey',
      " AND con.contype = 'f' AND con.confupdtype = 'c'",
    ),
    constraintExists(
      'ExpenseSubstituteReceiptEvidence', 'ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachme_fkey',
      " AND con.contype = 'f'",
    ),
    indexExists('ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmen_key'),
    indexExists('ExpenseSubstituteReceiptEvidence_companyId_expenseId_idempo_key'),
    indexExists('ExpenseSubstituteReceiptEvidence_companyId_expenseId_versio_key'),
    indexExists('ExpenseSubstituteReceiptEvidence_companyId_payerUserId_stat_idx'),
    indexExists('Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_evid_key'),
    indexExists('ReimbursementClaimSignature_companyId_reimbursementRequestI_idx'),
    indexExists('ReportDrilldownAccessLog_companyId_sourceModule_sourceType__idx'),
    indexAbsent('ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_'),
    indexAbsent('ExpenseSubstituteReceiptEvidence_companyId_expenseId_idempotenc'),
    indexAbsent('ExpenseSubstituteReceiptEvidence_companyId_expenseId_version_ke'),
    indexAbsent('ExpenseSubstituteReceiptEvidence_companyId_payerUserId_status_i'),
    indexAbsent('Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_evidence'),
    indexAbsent('ReimbursementClaimSignature_companyId_reimbursementRequest_idx'),
    indexAbsent('ReportDrilldownAccessLog_companyId_sourceModule_sourceType_s_id'),
  ), { pre: [['PRE_BOOKING_BOUNDS_VALID', bookingBoundsClean]] }),
  migration('20260801200000_p0_hardening', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('OutboxEvent', 'claimToken'), columnExists('ExecutionAttempt', 'identityFingerprint'),
  )),
  migration('20260802100000_attempt_identity_lease', 'DATA_BACKFILL', all(
    columnExists('ExecutionAttempt', 'companyScope'),
    constraintExists('ExecutionAttempt', 'ExecutionAttempt_companyScope_check', " AND con.contype = 'c'"),
    uniqueIndexExists(
      'ExecutionAttempt', 'ExecutionAttempt_scope_source_seq_key',
      ['companyScope', 'sourceType', 'sourceId', 'attemptSeq'],
    ),
    uniqueIndexExists(
      'ExecutionAttempt', 'ExecutionAttempt_companyScope_attemptKey_key', ['companyScope', 'attemptKey'],
    ),
  ), {
    pre: [['PRE_SOURCE_TABLE_ABSENT', `to_regclass('"ExecutionAttempt"') IS NULL`]],
    postData: [['POST_DATA_SCOPE_FIXED_POINT', `NOT EXISTS (
      SELECT 1 FROM "ExecutionAttempt"
      WHERE "companyScope" IS NULL OR "companyScope" <> COALESCE("companyId", '__platform__')
        OR left("attemptKey", length("companyScope" || '::' || "attemptSeq"::text || '::'))
          IS DISTINCT FROM "companyScope" || '::' || "attemptSeq"::text || '::'
    ) AND ${attemptIdentityClean}`]],
  }),
  migration('20260802150000_attempt_fence_hardening', 'ADDITIVE', all(
    columnExists('ExecutionAttempt', 'targetEnvironment'), columnExists('ExecutionAttempt', 'buildReleaseId'),
    enumValueExists('ExecutionAttemptStatus', 'FAILED_CONFIRMED'),
  )),
  migration('20260803100000_launch_command_results', 'ADDITIVE', all(
    tableExists('FeatureLaunchCommandResult'),
    uniqueIndexExists(
      'FeatureLaunchCommandResult', 'FeatureLaunchCommandResult_gateKey_routeKey_commandId_key',
      ['gateKey', 'routeKey', 'commandId'],
    ),
  )),
  migration('20260803110000_normalizer_version', 'BACKWARD_COMPATIBLE_NONADDITIVE',
    columnExists(
      'CompanyEntitlementNormalization', 'normalizerVersion',
      " AND format_type(a.atttypid, a.atttypmod) = 'integer' AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '0'",
    )),
  migration('20260803150000_normalizer_cohort', 'ADDITIVE',
    columnExists('CompanyEntitlementNormalization', 'cohortKind')),
  migration('20260803160000_cohort_kind_check', 'BACKWARD_COMPATIBLE_NONADDITIVE',
    constraintExists(
      'CompanyEntitlementNormalization', 'CompanyEntitlementNormalization_cohortKind_check',
      " AND con.contype = 'c'",
    ), {
      pre: [['PRE_COHORT_TABLE_ABSENT', `to_regclass('"CompanyEntitlementNormalization"') IS NULL`]],
    }),
  migration('20260804100000_wht_certificate_handoff', 'ADDITIVE', all(
    tableExists('WhtCertificateHandoff'), uniqueIndexExists(
      'WhtCertificateHandoff', 'WhtCertificateHandoff_source_identity_key',
      ['companyId', 'sourcePaymentType', 'sourcePaymentId', 'payeeId'],
    ),
  )),
  migration('20260804110000_wht_handoff_link_hardening', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists('WhtCertificateHandoff', 'linkCommandId'),
    columnExists('WhtCertificateHandoff', 'sourceBranchId'),
    uniqueIndexExists(
      'WhtCertificateHandoff', 'WhtCertificateHandoff_companyId_linkCommandId_key',
      ['companyId', 'linkCommandId'],
    ),
  )),
  migration('20260804120000_feature_launch_observation_bucket', 'ADDITIVE', all(
    tableExists('FeatureLaunchObservationBucket'), uniqueIndexExists(
      'FeatureLaunchObservationBucket', 'FeatureLaunchObservationBucket_bucket_key',
      ['hourStartUtc', 'targetEnvironment', 'buildReleaseId', 'surface', 'gateKey', 'routeKey', 'reason', 'wouldBlock'],
    ),
  )),
  migration('20260804130000_remote_release_operation_lease', 'DATA_BACKFILL', all(
    tableExists('RemoteReleaseOperation'), tableExists('RemoteReleaseMutationIntent'),
    uniqueIndexExists(
      'RemoteReleaseOperation', 'RemoteReleaseOperation_unresolved_environment_key',
      ['targetEnvironment'], ['status', 'RUNNING', 'UNKNOWN'],
    ),
    uniqueIndexExists(
      'RemoteReleaseMutationIntent', 'RemoteReleaseMutationIntent_open_service_key',
      ['operationId', 'serviceKey'], ['status', 'OPEN'],
    ),
  ), {
    pre: [['PRE_RELEASE_TABLE_ABSENT', `to_regclass('"RemoteReleaseOperation"') IS NULL`]],
    postData: [['POST_DATA_PROVENANCE_FIXED_POINT', remoteReleaseClean]],
  }),
  migration('20260804140000_report_view_authority_snapshots', 'BACKWARD_COMPATIBLE_NONADDITIVE', all(
    columnExists(
      'ReportView', 'permissionSnapshotJson',
      " AND format_type(a.atttypid, a.atttypmod) = 'jsonb' AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'",
    ),
    columnExists(
      'ReportView', 'sourceScopeSnapshotJson',
      " AND format_type(a.atttypid, a.atttypmod) = 'jsonb' AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'",
    ),
    columnExists(
      'ReportExportRequest', 'coverageWarningsJson',
      " AND format_type(a.atttypid, a.atttypmod) = 'jsonb' AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb'",
    ),
  )),
  migration('20260804150000_reimbursement_line_compatibility', 'DATA_BACKFILL', triggerFunctionExists(
    'ReimbursementRequest',
    'ReimbursementRequest_fallback_line',
    'ensure_reimbursement_request_fallback_line',
    '9f80e01d761c234666e84a65803b7448',
  ), {
    pre: [['PRE_LINE_TABLE_ABSENT', `to_regclass('"ReimbursementLine"') IS NULL`]],
    postData: [['POST_DATA_FIXED_POINT', reimbursementBackfillFixedPoint]],
  }),
  migration('20260809110000_legal_document_acceptance', 'ADDITIVE', all(
    tableExists('LegalDocumentActionRecord'),
    enumValuesEqual('LegalDocumentType', ['TERMS_OF_USE', 'PRIVACY_NOTICE']),
    enumValuesEqual('LegalDocumentAction', ['ACCEPTED', 'ACKNOWLEDGED']),
    enumValuesEqual('LegalAcceptanceCapacity', [
      'AUTHORIZED_REPRESENTATIVE', 'INVITED_MEMBER', 'SYSTEM_OPERATOR',
    ]),
    enumValuesEqual('LegalAcceptanceSurface', ['FIRST_ACCEPTANCE', 'MATERIAL_UPDATE']),
    constraintExists('LegalDocumentActionRecord', 'LegalDocumentActionRecord_pkey', " AND con.contype = 'p'"),
    uniqueIndexExists(
      'LegalDocumentActionRecord',
      'LegalDocumentActionRecord_scopeRef_documentType_documentVersion_action_key',
      ['scopeRef', 'documentType', 'documentVersion', 'action'],
    ),
    indexExists('LegalDocumentActionRecord_acceptedByUserId_acceptedAt_idx'),
    indexExists('LegalDocumentActionRecord_companyId_acceptedAt_idx'),
    indexExists('LegalDocumentActionRecord_membershipId_acceptedAt_idx'),
    indexExists('LegalDocumentActionRecord_batchId_idx'),
    exactTriggerFunctionExists(
      'LegalDocumentActionRecord',
      'LegalDocumentActionRecord_prevent_update_delete',
      'prevent_legal_document_action_record_mutation',
      27,
      'b3202b486ba0944610d697033503e7c3',
    ),
    exactTriggerFunctionExists(
      'LegalDocumentActionRecord',
      'LegalDocumentActionRecord_prevent_truncate',
      'prevent_legal_document_action_record_mutation',
      34,
      'b3202b486ba0944610d697033503e7c3',
    ),
  )),
  migration('20260809120000_data_rights_case_orchestration', 'ADDITIVE', all(
    tableExists('DataRightsCase'),
    tableExists('DataRightsDecisionRecord'),
    tableExists('DataRightsEvidenceRecord'),
    tableExists('DataRightsCaseActionRecord'),
    enumValuesEqual('DataRightsCaseType', [
      'USER_ACCOUNT_ERASURE', 'MEMBERSHIP_EXIT', 'COMPANY_WORKSPACE_OFFBOARDING',
    ]),
    enumValuesEqual('DataRightsCaseStatus', [
      'RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW', 'APPROVED', 'EXECUTING', 'VERIFICATION',
      'COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED',
    ]),
    enumValuesEqual('DataRightsRequestSource', ['EMAIL', 'SUPPORT', 'IN_APP', 'OTHER_MONITORED_CHANNEL']),
    enumValuesEqual('DataRightsDecisionCategory', [
      'ACCOUNT_IDENTITY', 'AUTHENTICATION_SECRETS', 'MEMBERSHIPS_ACCESS', 'TENANT_OPERATIONAL_DATA',
      'ACCOUNTING_TAX_DOCUMENTS', 'ATTACHMENTS_OBJECT_VERSIONS', 'AI_OCR_DATA', 'AUDIT_SECURITY_LOGS',
      'QUEUES_CACHES', 'PROCESSORS', 'BACKUPS', 'LEGAL_ACCEPTANCE_EVIDENCE',
    ]),
    enumValuesEqual('DataRightsDisposition', [
      'DELETE', 'ANONYMIZE', 'RESTRICT', 'RETAIN', 'RETURN', 'NOT_APPLICABLE',
    ]),
    enumValuesEqual('DataRightsEvidenceType', [
      'IDENTITY_VERIFICATION', 'AUTHORITY_VERIFICATION', 'EXPORT_DELIVERY', 'ACCESS_REVOCATION',
      'DATABASE_EXECUTION', 'OBJECT_STORAGE_INVENTORY', 'QUEUE_CACHE_PURGE', 'PROCESSOR_CONFIRMATION',
      'BACKUP_MANIFEST', 'RETENTION_HOLD', 'INDEPENDENT_VERIFICATION',
    ]),
    constraintExists('DataRightsCase', 'DataRightsCase_pkey', " AND con.contype = 'p'"),
    constraintExists(
      'DataRightsCase',
      'DataRightsCase_target_shape_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%USER_ACCOUNT_ERASURE%' AND pg_get_constraintdef(con.oid, true) LIKE '%MEMBERSHIP_EXIT%' AND pg_get_constraintdef(con.oid, true) LIKE '%COMPANY_WORKSPACE_OFFBOARDING%' AND pg_get_constraintdef(con.oid, true) LIKE '%companyId%IS NULL%' AND pg_get_constraintdef(con.oid, true) LIKE '%targetUserId%IS NULL%'",
    ),
    constraintExists(
      'DataRightsCase',
      'DataRightsCase_due_after_received_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%dueAt%>%receivedAt%'",
    ),
    constraintExists(
      'DataRightsCase',
      'DataRightsCase_completion_shape_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%COMPLETED_WITH_EXCEPTION%' AND pg_get_constraintdef(con.oid, true) LIKE '%BLOCKED%' AND pg_get_constraintdef(con.oid, true) LIKE '%completedByUserId%' AND pg_get_constraintdef(con.oid, true) LIKE '%outcomeSummary%'",
    ),
    constraintExists('DataRightsDecisionRecord', 'DataRightsDecisionRecord_pkey', " AND con.contype = 'p'"),
    constraintExists(
      'DataRightsDecisionRecord',
      'DataRightsDecisionRecord_caseId_fkey',
      " AND con.contype = 'f' AND con.confdeltype = 'r'",
    ),
    constraintExists(
      'DataRightsDecisionRecord',
      'DataRightsDecisionRecord_revision_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%revision%> 0%'",
    ),
    constraintExists(
      'DataRightsDecisionRecord',
      'DataRightsDecisionRecord_retention_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%retentionUntil%' AND pg_get_constraintdef(con.oid, true) LIKE '%accessRestriction%' AND pg_get_constraintdef(con.oid, true) LIKE '%RESTRICT%' AND pg_get_constraintdef(con.oid, true) LIKE '%RETAIN%'",
    ),
    constraintExists('DataRightsEvidenceRecord', 'DataRightsEvidenceRecord_pkey', " AND con.contype = 'p'"),
    constraintExists(
      'DataRightsEvidenceRecord',
      'DataRightsEvidenceRecord_caseId_fkey',
      " AND con.contype = 'f' AND con.confdeltype = 'r'",
    ),
    constraintExists(
      'DataRightsEvidenceRecord',
      'DataRightsEvidenceRecord_sha256_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%sha256%' AND pg_get_constraintdef(con.oid, true) LIKE '%64%'",
    ),
    constraintExists(
      'DataRightsEvidenceRecord',
      'DataRightsEvidenceRecord_completion_hash_check',
      " AND con.contype = 'c' AND pg_get_constraintdef(con.oid, true) LIKE '%IDENTITY_VERIFICATION%' AND pg_get_constraintdef(con.oid, true) LIKE '%AUTHORITY_VERIFICATION%' AND pg_get_constraintdef(con.oid, true) LIKE '%sha256%IS NOT NULL%'",
    ),
    constraintExists('DataRightsCaseActionRecord', 'DataRightsCaseActionRecord_pkey', " AND con.contype = 'p'"),
    constraintExists(
      'DataRightsCaseActionRecord',
      'DataRightsCaseActionRecord_caseId_fkey',
      " AND con.contype = 'f' AND con.confdeltype = 'r'",
    ),
    uniqueIndexExists('DataRightsCase', 'DataRightsCase_requestKey_key', ['requestKey']),
    exactPartialUniqueIndexExists(
      'DataRightsCase', 'DataRightsCase_active_user_erasure_target_key', ['targetUserId'],
      activeDataRightsPredicate('USER_ACCOUNT_ERASURE'),
    ),
    exactPartialUniqueIndexExists(
      'DataRightsCase', 'DataRightsCase_active_membership_exit_target_key', ['membershipId'],
      activeDataRightsPredicate('MEMBERSHIP_EXIT'),
    ),
    exactPartialUniqueIndexExists(
      'DataRightsCase', 'DataRightsCase_active_company_offboarding_target_key', ['companyId'],
      activeDataRightsPredicate('COMPANY_WORKSPACE_OFFBOARDING'),
    ),
    uniqueIndexExists(
      'DataRightsDecisionRecord', 'DataRightsDecisionRecord_caseId_category_revision_key',
      ['caseId', 'category', 'revision'],
    ),
    uniqueIndexExists('DataRightsCaseActionRecord', 'DataRightsCaseActionRecord_commandId_key', ['commandId']),
    indexExists('DataRightsCase_status_dueAt_idx'),
    indexExists('DataRightsCase_targetUserId_createdAt_idx'),
    indexExists('DataRightsCase_companyId_createdAt_idx'),
    indexExists('DataRightsCase_membershipId_createdAt_idx'),
    indexExists('DataRightsDecisionRecord_caseId_category_recordedAt_idx'),
    indexExists('DataRightsEvidenceRecord_caseId_evidenceType_recordedAt_idx'),
    indexExists('DataRightsCaseActionRecord_caseId_createdAt_idx'),
    indexExists('DataRightsCaseActionRecord_actorUserId_createdAt_idx'),
    exactTriggerFunctionExists(
      'DataRightsDecisionRecord', 'DataRightsDecisionRecord_scope_guard',
      'enforce_data_rights_decision_scope', 7, '5f554968954664366632567b32707c26',
    ),
    exactTriggerFunctionExists(
      'DataRightsEvidenceRecord', 'DataRightsEvidenceRecord_phase_guard',
      'enforce_data_rights_evidence_phase', 7, '57a538816992616227edd3d9eb5d5494',
    ),
    exactTriggerFunctionExists(
      'DataRightsCase', 'DataRightsCase_initial_state_guard',
      'enforce_data_rights_case_initial_state', 7, '03cba8f44d3bef57eb5cd7d8d78c0c6a',
    ),
    exactTriggerFunctionExists(
      'DataRightsCase', 'DataRightsCase_active_scope_guard',
      'enforce_data_rights_active_scope', 7, '6557d03feea2fa22df12ee280c7f39a4',
    ),
    exactTriggerFunctionExists(
      'DataRightsDecisionRecord', 'DataRightsDecisionRecord_append_only',
      'deny_data_rights_append_only_mutation', 27, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsEvidenceRecord', 'DataRightsEvidenceRecord_append_only',
      'deny_data_rights_append_only_mutation', 27, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsCaseActionRecord', 'DataRightsCaseActionRecord_append_only',
      'deny_data_rights_append_only_mutation', 27, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsDecisionRecord', 'DataRightsDecisionRecord_no_truncate',
      'deny_data_rights_append_only_mutation', 34, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsEvidenceRecord', 'DataRightsEvidenceRecord_no_truncate',
      'deny_data_rights_append_only_mutation', 34, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsCaseActionRecord', 'DataRightsCaseActionRecord_no_truncate',
      'deny_data_rights_append_only_mutation', 34, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
    exactTriggerFunctionExists(
      'DataRightsCase', 'DataRightsCase_transition_guard',
      'enforce_data_rights_case_transition', 19, 'ce430d9ae3e3688fadf34db9dcbcb8fb',
    ),
    exactTriggerFunctionExists(
      'DataRightsCase', 'DataRightsCase_no_delete',
      'deny_data_rights_case_delete', 11, '6b753e490e1d8ea0a6db533429ca9d1d',
    ),
    exactTriggerFunctionExists(
      'DataRightsCase', 'DataRightsCase_no_truncate',
      'deny_data_rights_append_only_mutation', 34, 'eee32992c92a981106efbaf8c3db8d3a',
    ),
  )),
] as const;
