import { ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import type { Prisma } from '../generated/prisma/client';
import { evaluateEntitledFeatureKeys } from '../modules/employee-access/application/entitlement.helper';
import {
  NORMALIZER_VERSION,
  isCohortKind,
  planCompanyNormalization,
} from '../modules/employee-access/application/normalize-entitlements';
import {
  A5_PRODUCTION_READER_ROLE,
  a5EvidenceTableCatalog,
  inspectA5ReaderGuard,
  readerGuardBlockers,
  sha256,
  stableJson,
  validateA5CoreTableCatalog,
} from './a5-readonly-evidence.logic';
import {
  computeLegacySnapshotHashV1,
  computeSnapshotHash,
  isExactLegacyV1FallbackSnapshot,
  type LegacyV1FallbackSnapshotFields,
  type ReimbursementLineFields,
} from '../modules/reimbursements/domain/logic/reimbursement.logic';
import {
  type ProductionA5DatabaseSnapshot,
  type ProductionA5MigrationIdentity,
  type ProductionA5ReimbursementApprovalSnapshots,
  type ProductionA5SchemaObject,
  type ProductionA5Stage,
  productionA5PolicyHashes,
} from './production-a5-evidence.logic';

export type ProductionA5ReadClient = Pick<Prisma.TransactionClient, '$queryRawUnsafe'>;

function schemaObjectKey(row: ProductionA5SchemaObject): string {
  return `${row.kind}\0${row.schema}\0${row.relation ?? ''}\0${row.name}`;
}

function compareSchemaObject(left: ProductionA5SchemaObject, right: ProductionA5SchemaObject): number {
  const leftKey = schemaObjectKey(left);
  const rightKey = schemaObjectKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function hash(value: unknown): string {
  return sha256(stableJson(value));
}

function safeCount(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`production_a5_${label}_invalid`);
  return result;
}

type PendingReimbursementHeader = {
  requestId: string;
  companyId: string;
  title: string | null;
  reason: string;
  categoryKey: string;
  categoryLabelSnapshot: string | null;
  amount: unknown;
  currency: string;
  incurredDate: Date | string;
  primaryAttachmentId: string | null;
  linkedExpenseId: string | null;
  approvalSnapshotHash: string | null;
  approvalPolicySnapshotJson?: LegacyV1FallbackSnapshotFields['approvalPolicySnapshotJson'] | null;
  currentApprovalStepId: string | null;
  currentStepStatus: string | null;
  currentStepDecidedAt: Date | string | null;
  currentStepDecisionByUserId: string | null;
  currentStepComment: string | null;
  currentStepRejectionReason: string | null;
};

type PendingReimbursementLine = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  lineNo: number;
  incurredDate: Date | string;
  description: string;
  purpose: string | null;
  categoryKey: string;
  categoryLabelSnapshot: string | null;
  amount: unknown;
  attachmentId: string | null;
  linkedExpenseId: string | null;
  sourceExpenseSnapshotJson?: ReimbursementLineFields['sourceExpenseSnapshot'] | null;
  attachmentSnapshotJson?: ReimbursementLineFields['attachmentSnapshot'] | null;
};

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_date');
  return date.toISOString();
}

function decimal(value: unknown): string {
  if (value === null || value === undefined) throw new Error('invalid_decimal');
  const result = String(value);
  if (result === '') throw new Error('invalid_decimal');
  return result;
}

function snapshotFields(
  header: PendingReimbursementHeader,
  lines: readonly PendingReimbursementLine[],
): LegacyV1FallbackSnapshotFields {
  return {
    requestId: header.requestId,
    companyId: header.companyId,
    title: header.title,
    reason: header.reason,
    categoryKey: header.categoryKey,
    categoryLabelSnapshot: header.categoryLabelSnapshot,
    amount: decimal(header.amount),
    currency: header.currency,
    incurredDate: iso(header.incurredDate),
    primaryAttachmentId: header.primaryAttachmentId,
    linkedExpenseId: header.linkedExpenseId,
    approvalPolicySnapshotJson: header.approvalPolicySnapshotJson ?? undefined,
    lines: lines.map((line) => ({
      id: line.id,
      companyId: line.companyId,
      reimbursementRequestId: line.reimbursementRequestId,
      lineNo: line.lineNo,
      incurredDate: iso(line.incurredDate),
      description: line.description,
      purpose: line.purpose,
      categoryKey: line.categoryKey,
      categoryLabelSnapshot: line.categoryLabelSnapshot,
      amount: decimal(line.amount),
      attachmentId: line.attachmentId,
      linkedExpenseId: line.linkedExpenseId,
      sourceExpenseSnapshot: line.sourceExpenseSnapshotJson ?? undefined,
      attachmentSnapshot: line.attachmentSnapshotJson ?? undefined,
    })),
  };
}

export function classifyProductionA5ReimbursementApprovalSnapshots(
  stage: ProductionA5Stage,
  headers: readonly PendingReimbursementHeader[],
  lines: readonly PendingReimbursementLine[],
): ProductionA5ReimbursementApprovalSnapshots {
  const byRequest = new Map<string, PendingReimbursementLine[]>();
  for (const line of lines) {
    const current = byRequest.get(line.reimbursementRequestId) ?? [];
    current.push(line);
    byRequest.set(line.reimbursementRequestId, current);
  }
  const result: ProductionA5ReimbursementApprovalSnapshots = {
    total: headers.length,
    v2Valid: 0,
    exactV1Compatible: 0,
    missingHash: 0,
    invalid: 0,
    currentStepPending: 0,
    legacyPartialApproved: 0,
    legacyPartialRejected: 0,
    invalidCurrentStep: 0,
  };
  for (const header of headers) {
    const hasDecisionActor = typeof header.currentStepDecisionByUserId === 'string'
      && header.currentStepDecisionByUserId.trim() !== '';
    const hasDecisionTime = header.currentStepDecidedAt !== null;
    if (header.currentApprovalStepId === null || header.currentStepStatus === null) {
      result.invalidCurrentStep += 1;
    } else if (header.currentStepStatus === 'PENDING'
      && !hasDecisionActor && !hasDecisionTime
      && header.currentStepComment === null && header.currentStepRejectionReason === null) {
      result.currentStepPending += 1;
    } else if (header.currentStepStatus === 'APPROVED'
      && hasDecisionActor && hasDecisionTime && header.currentStepRejectionReason === null) {
      result.legacyPartialApproved += 1;
    } else if (header.currentStepStatus === 'REJECTED'
      && hasDecisionActor && hasDecisionTime
      && typeof header.currentStepRejectionReason === 'string'
      && header.currentStepRejectionReason.trim() !== '') {
      result.legacyPartialRejected += 1;
    } else {
      result.invalidCurrentStep += 1;
    }
    const storedHash = header.approvalSnapshotHash;
    if (storedHash === null || storedHash.trim() === '') {
      result.missingHash += 1;
      continue;
    }
    try {
      const requestLines = [...(byRequest.get(header.requestId) ?? [])]
        .sort((left, right) => left.lineNo - right.lineNo);
      const fields = snapshotFields(header, requestLines);
      // PRE has no line table by reviewed schema contract. A matching historical header hash is
      // classified as compatible with the deterministic fallback the reviewed migration creates.
      if (stage === 'PRE_MUTATION') {
        if (storedHash === computeLegacySnapshotHashV1(fields)) result.exactV1Compatible += 1;
        else result.invalid += 1;
      } else if (requestLines.length > 0 && storedHash === computeSnapshotHash(fields)) {
        result.v2Valid += 1;
      } else if (isExactLegacyV1FallbackSnapshot(fields, storedHash)) {
        result.exactV1Compatible += 1;
      } else {
        result.invalid += 1;
      }
    } catch {
      result.invalid += 1;
    }
  }
  return result;
}

export async function readProductionA5ReimbursementApprovalSnapshots(
  client: ProductionA5ReadClient,
  stage: ProductionA5Stage,
): Promise<ProductionA5ReimbursementApprovalSnapshots> {
  const headers = await client.$queryRawUnsafe<PendingReimbursementHeader[]>(`
    /* production-a5:pending-reimbursement-headers */
    SELECT request.id AS "requestId", request."companyId", request.title, request.reason,
           request."categoryKey", request."categoryLabelSnapshot", request.amount, request.currency,
           request."incurredDate", request."primaryAttachmentId", request."linkedExpenseId",
           request."approvalSnapshotHash", request."currentApprovalStepId",
           to_jsonb(request)->'approvalPolicySnapshotJson' AS "approvalPolicySnapshotJson",
           step.status::text AS "currentStepStatus", step."decidedAt" AS "currentStepDecidedAt",
           step."decisionByUserId" AS "currentStepDecisionByUserId",
           step.comment AS "currentStepComment", step."rejectionReason" AS "currentStepRejectionReason"
      FROM "ReimbursementRequest" request
      LEFT JOIN "ReimbursementApprovalStep" step
        ON step.id = request."currentApprovalStepId"
       AND step."companyId" = request."companyId"
       AND step."reimbursementRequestId" = request.id
     WHERE request.status = 'PENDING_APPROVAL'
     ORDER BY request.id
  `);
  const lines = stage === 'PRE_MUTATION' ? [] : await client.$queryRawUnsafe<PendingReimbursementLine[]>(`
    /* production-a5:pending-reimbursement-lines */
    SELECT line.id, line."companyId", line."reimbursementRequestId", line."lineNo",
           line."incurredDate", line.description, line.purpose, line."categoryKey",
           line."categoryLabelSnapshot", line.amount, line."attachmentId", line."linkedExpenseId",
           to_jsonb(line)->'sourceExpenseSnapshotJson' AS "sourceExpenseSnapshotJson",
           to_jsonb(line)->'attachmentSnapshotJson' AS "attachmentSnapshotJson"
      FROM "ReimbursementLine" line
      JOIN "ReimbursementRequest" request ON request.id = line."reimbursementRequestId"
     WHERE request.status = 'PENDING_APPROVAL'
     ORDER BY line."reimbursementRequestId", line."lineNo"
  `);
  return classifyProductionA5ReimbursementApprovalSnapshots(stage, headers, lines);
}

/** Exact catalog for the five H2-declared object kinds; it intentionally makes no claim about triggers/policies. */
export async function readProductionA5SchemaObjects(
  client: ProductionA5ReadClient,
  schema: string,
): Promise<ProductionA5SchemaObject[]> {
  const relations = await client.$queryRawUnsafe<Array<{
    schema: string;
    relation: string;
    relationKind: string;
  }>>(`
    /* production-a5:schema-relations */
    SELECT n.nspname AS schema,
           c.relname AS relation,
           c.relkind::text AS "relationKind"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1
       AND c.relkind IN ('r','p')
     ORDER BY c.relname
  `, schema);
  const columns = await client.$queryRawUnsafe<Array<{
    schema: string;
    relation: string;
    name: string;
    position: number;
    dataType: string;
    defaultExpression: string | null;
    notNull: boolean;
    identityKind: string;
    generatedKind: string;
  }>>(`
    /* production-a5:schema-columns */
    SELECT n.nspname AS schema,
           c.relname AS relation,
           a.attname AS name,
           a.attnum::int AS position,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS "dataType",
           pg_get_expr(d.adbin, d.adrelid) AS "defaultExpression",
           a.attnotnull AS "notNull",
           a.attidentity::text AS "identityKind",
           a.attgenerated::text AS "generatedKind"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = $1
       AND c.relkind IN ('r','p')
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum
  `, schema);
  const indexes = await client.$queryRawUnsafe<Array<{
    schema: string;
    relation: string;
    name: string;
    definition: string;
  }>>(`
    /* production-a5:schema-indexes */
    SELECT n.nspname AS schema,
           table_class.relname AS relation,
           index_class.relname AS name,
           pg_get_indexdef(index_class.oid) AS definition
      FROM pg_index i
      JOIN pg_class table_class ON table_class.oid = i.indrelid
      JOIN pg_class index_class ON index_class.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = table_class.relnamespace
     WHERE n.nspname = $1
       AND table_class.relkind IN ('r','p')
     ORDER BY table_class.relname, index_class.relname
  `, schema);
  const constraints = await client.$queryRawUnsafe<Array<{
    schema: string;
    relation: string;
    name: string;
    constraintType: string;
    definition: string;
  }>>(`
    /* production-a5:schema-constraints */
    SELECT n.nspname AS schema,
           c.relname AS relation,
           con.conname AS name,
           con.contype::text AS "constraintType",
           pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1
       AND c.relkind IN ('r','p')
     ORDER BY c.relname, con.conname
  `, schema);
  const enums = await client.$queryRawUnsafe<Array<{
    schema: string;
    typeName: string;
    label: string;
    sortOrder: number;
  }>>(`
    /* production-a5:schema-enums */
    SELECT n.nspname AS schema,
           t.typname AS "typeName",
           e.enumlabel AS label,
           e.enumsortorder::float8 AS "sortOrder"
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = $1
     ORDER BY t.typname, e.enumsortorder
  `, schema);
  return [
    ...relations.map((row): ProductionA5SchemaObject => ({
      kind: 'RELATION', schema: row.schema, relation: row.relation, name: row.relation,
      definition: row.relationKind,
    })),
    ...columns.map((row): ProductionA5SchemaObject => ({
      kind: 'COLUMN', schema: row.schema, relation: row.relation, name: row.name,
      definition: stableJson({
        position: row.position,
        dataType: row.dataType,
        defaultExpression: row.defaultExpression,
        nullable: !row.notNull,
        identityKind: row.identityKind,
        generatedKind: row.generatedKind,
      }),
    })),
    ...indexes.map((row): ProductionA5SchemaObject => ({
      kind: 'INDEX', schema: row.schema, relation: row.relation, name: row.name,
      definition: row.definition,
    })),
    ...constraints.map((row): ProductionA5SchemaObject => ({
      kind: 'CONSTRAINT', schema: row.schema, relation: row.relation, name: row.name,
      definition: `${row.constraintType}:${row.definition}`,
    })),
    ...enums.map((row): ProductionA5SchemaObject => ({
      kind: 'ENUM_VALUE', schema: row.schema, relation: null,
      name: `${row.typeName}.${row.label}`,
      definition: stableJson({ typeName: row.typeName, label: row.label, sortOrder: row.sortOrder }),
    })),
  ].sort(compareSchemaObject);
}

export async function readProductionA5AppliedMigrations(
  client: ProductionA5ReadClient,
): Promise<ProductionA5MigrationIdentity[]> {
  const rows = await client.$queryRawUnsafe<Array<{
    name: string;
    checksum: string;
    startedAt: Date;
    finishedAt: Date | null;
    rolledBackAt: Date | null;
  }>>(`
    /* production-a5:applied-migrations */
    SELECT migration_name AS name, checksum, started_at AS "startedAt",
           finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
     ORDER BY started_at, id
  `);
  if (rows.some((row) => row.rolledBackAt !== null)) {
    throw new Error('production_a5_failed_or_rolled_back_migration_present');
  }
  if (rows.some((row) => row.finishedAt === null)) {
    throw new Error('production_a5_unfinished_migration_present');
  }
  const active = rows
    .filter((row) => row.finishedAt !== null && row.rolledBackAt === null)
    .map(({ name, checksum }, index) => ({ name, checksum, appliedOrder: index + 1 }));
  for (const row of active) {
    if (!/^[0-9a-f]{64}$/.test(row.checksum)) throw new Error('production_a5_migration_checksum_invalid');
  }
  const names = active.map((row) => row.name);
  if (new Set(names).size !== names.length) throw new Error('production_a5_duplicate_active_migration');
  return active;
}

type EntitlementRow = {
  id: string;
  companyId: string;
  featureKey: string;
  enabled: boolean;
  updatedBySystemAdminUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

async function readPreexistingAuthority(client: ProductionA5ReadClient): Promise<{
  preexistingEntitlementStateHash: string;
  preexistingAuthorityStateHash: string;
}> {
  const companies = await client.$queryRawUnsafe<Array<{ id: string }>>(`
    /* production-a5:companies */
    SELECT id FROM "Company" ORDER BY id
  `);
  const rows = await client.$queryRawUnsafe<EntitlementRow[]>(`
    /* production-a5:preexisting-entitlements */
    SELECT id, "companyId", "featureKey", enabled, "updatedBySystemAdminUserId", "createdAt", "updatedAt"
      FROM "CompanyFeatureEntitlement"
     ORDER BY "companyId", "featureKey", id
  `);
  const byCompany = new Map<string, EntitlementRow[]>();
  for (const row of rows) {
    const current = byCompany.get(row.companyId) ?? [];
    current.push(row);
    byCompany.set(row.companyId, current);
  }
  const allKeys = [...ALL_FEATURE_ENTITLEMENT_KEYS].sort();
  const authority = companies.map((company) => {
    const effective = evaluateEntitledFeatureKeys(byCompany.get(company.id) ?? []);
    return {
      companyId: company.id,
      effectiveFeatureKeys: effective === null ? allKeys : [...effective].sort(),
    };
  });
  return {
    preexistingEntitlementStateHash: hash(rows),
    preexistingAuthorityStateHash: hash(authority),
  };
}

async function readLaunchSnapshot(client: ProductionA5ReadClient): Promise<NonNullable<ProductionA5DatabaseSnapshot['launch']>> {
  const routes = await client.$queryRawUnsafe<Array<{
    gateKey: string;
    routeKey: string;
    state: 'OPEN' | 'CLOSED';
    generation: number;
  }>>(`
    /* production-a5:launch-state */
    SELECT "gateKey", "routeKey", state::text AS state, generation
      FROM "FeatureLaunchGate"
     ORDER BY "gateKey", "routeKey"
  `);
  return { featureLaunchStateHash: hash(routes), routes };
}

async function readNormalization(client: ProductionA5ReadClient): Promise<ProductionA5DatabaseSnapshot['normalization']> {
  const companies = await client.$queryRawUnsafe<Array<{
    companyId: string;
    status: string | null;
    normalizerVersion: number | null;
    cohortKind: string | null;
  }>>(`
    /* production-a5:normalization-companies */
    SELECT c.id AS "companyId", n.status::text AS status,
           n."normalizerVersion", n."cohortKind"
      FROM "Company" c
      LEFT JOIN "CompanyEntitlementNormalization" n ON n."companyId" = c.id
     ORDER BY c.id
  `);
  const rows = await client.$queryRawUnsafe<Array<{
    companyId: string;
    featureKey: string;
    enabled: boolean;
    grantOrigin: string | null;
  }>>(`
    /* production-a5:normalization-entitlements */
    SELECT "companyId", "featureKey", enabled, "grantOrigin"
      FROM "CompanyFeatureEntitlement"
     ORDER BY "companyId", "featureKey"
  `);
  const humanRows = await client.$queryRawUnsafe<Array<{ companyId: string; featureKey: string }>>(`
    /* production-a5:normalization-human-decisions */
    SELECT DISTINCT "companyId", "featureKey"
      FROM "EntitlementTransition"
     WHERE "actorUserId" <> 'SYSTEM'
     ORDER BY "companyId", "featureKey"
  `);
  const entitlements = new Map<string, typeof rows>();
  for (const row of rows) {
    const current = entitlements.get(row.companyId) ?? [];
    current.push(row);
    entitlements.set(row.companyId, current);
  }
  const human = new Map<string, Set<string>>();
  for (const row of humanRows) {
    const current = human.get(row.companyId) ?? new Set<string>();
    current.add(row.featureKey);
    human.set(row.companyId, current);
  }
  let incomplete = 0;
  let drift = 0;
  let unexpectedOrigin = 0;
  for (const company of companies) {
    if (company.status !== 'COMPLETED' || (company.normalizerVersion ?? -1) < NORMALIZER_VERSION
      || !isCohortKind(company.cohortKind)) {
      incomplete += 1;
      continue;
    }
    const companyRows = entitlements.get(company.companyId) ?? [];
    const humanKeys = human.get(company.companyId) ?? new Set<string>();
    const plan = planCompanyNormalization(company.companyId, companyRows, company.cohortKind, humanKeys);
    const exceptions = plan.dependencyFindings.some((finding) => finding.action === 'EXCEPTION');
    if (plan.writes.length > 0 || plan.orphanRows.length > 0 || exceptions) drift += 1;
    if (company.cohortKind === 'LEGACY') {
      const stored = new Map(companyRows.map((row) => [row.featureKey, row]));
      const hasGap = plan.proposedRows.some((row) => row.enabled
        && stored.get(row.featureKey)?.grantOrigin !== 'LEGACY'
        && !humanKeys.has(row.featureKey));
      if (hasGap) unexpectedOrigin += 1;
    }
  }
  return { status: 'MATERIALIZED', incomplete, drift, unexpectedOrigin };
}

export async function collectProductionA5DatabaseSnapshot(
  client: ProductionA5ReadClient,
  input: { stage: ProductionA5Stage; schema: string; noTaskRole: boolean },
): Promise<ProductionA5DatabaseSnapshot> {
  if (!input.noTaskRole) throw new Error('production_a5_task_role_present');
  const schemaObjects = await readProductionA5SchemaObjects(client, input.schema);
  const evidenceTables = a5EvidenceTableCatalog('production');
  const presentCore = schemaObjects
    .filter((row) => row.kind === 'RELATION' && evidenceTables.includes(row.name))
    .map((row) => row.name);
  const profile = input.stage === 'PRE_MUTATION' ? 'LEGACY_PRE_F1' : 'F1_CURRENT';
  const expectedCoreTables = validateA5CoreTableCatalog(profile, presentCore, 'production');
  const guard = await inspectA5ReaderGuard(client as Prisma.TransactionClient, input.schema, expectedCoreTables);
  const blockers = readerGuardBlockers(guard, A5_PRODUCTION_READER_ROLE);
  if (blockers.length > 0) throw new Error(`production_a5_reader_guard_failed:${blockers.join(',')}`);
  const readerBoundary: ProductionA5DatabaseSnapshot['readerBoundary'] = {
    role: A5_PRODUCTION_READER_ROLE,
    defaultReadOnly: true,
    transactionReadOnly: true,
    noTaskRole: true,
    nonPrivileged: true,
    noCreateOrDmlOrMaintain: true,
    noOutsideCoreSelect: true,
    noExecutableSecurityDefiner: true,
    noOwnershipOrMembership: true,
    coreRlsVisible: true,
  };
  const [appliedMigrations, authority, reimbursementApprovalSnapshots] = await Promise.all([
    readProductionA5AppliedMigrations(client),
    readPreexistingAuthority(client),
    readProductionA5ReimbursementApprovalSnapshots(client, input.stage),
  ]);
  const policy = productionA5PolicyHashes();
  const launch = input.stage === 'PRE_MUTATION' ? null : await readLaunchSnapshot(client);
  const normalization = input.stage === 'PRE_MUTATION'
    ? { status: 'NOT_MATERIALIZED', incomplete: null, drift: null, unexpectedOrigin: null } as const
    : await readNormalization(client);
  return {
    readerBoundary,
    schemaObjects,
    appliedMigrations,
    ...authority,
    reimbursementApprovalSnapshots,
    ...policy,
    launch,
    normalization,
  };
}

export function assertNoProductionA5AwsCredentials(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const credentialKeys = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
  ];
  if (credentialKeys.some((key) => Boolean(env[key]))) throw new Error('production_a5_aws_credentials_present');
}
