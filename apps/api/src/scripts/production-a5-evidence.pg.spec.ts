import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import {
  assertNoProductionA5AwsCredentials,
  classifyProductionA5ReimbursementApprovalSnapshots,
  collectProductionA5DatabaseSnapshot,
  readProductionA5AppliedMigrations,
  readProductionA5SchemaObjects,
  readProductionA5ReimbursementApprovalSnapshots,
  type ProductionA5ReadClient,
} from './production-a5-evidence.pg';
import {
  computeLegacySnapshotHashV1,
  computeSnapshotHash,
  isExactLegacyV1FallbackSnapshot,
} from '../modules/reimbursements/domain/logic/reimbursement.logic';

type QueryHandler = (sql: string, values: unknown[]) => unknown[];

function fakeClient(handler: QueryHandler): ProductionA5ReadClient {
  return {
    $queryRawUnsafe: (async (sql: string, ...values: unknown[]) => handler(sql, values)) as ProductionA5ReadClient['$queryRawUnsafe'],
  };
}

describe('production A5 PostgreSQL collector', () => {
  it('normalizes the explicit supported schema-object catalog in stable order', async () => {
    const client = fakeClient((sql) => {
      if (sql.includes('production-a5:schema-relations')) {
        return [{ schema: 'public', relation: 'Widget', relationKind: 'r' }];
      }
      if (sql.includes('production-a5:schema-columns')) {
        return [{
          schema: 'public', relation: 'Widget', name: 'id', position: 1, dataType: 'text',
          defaultExpression: null, notNull: true, identityKind: '', generatedKind: '',
        }];
      }
      if (sql.includes('production-a5:schema-indexes')) {
        return [{ schema: 'public', relation: 'Widget', name: 'Widget_pkey', definition: 'CREATE UNIQUE INDEX' }];
      }
      if (sql.includes('production-a5:schema-constraints')) {
        return [{ schema: 'public', relation: 'Widget', name: 'Widget_pkey', constraintType: 'p', definition: 'PRIMARY KEY (id)' }];
      }
      if (sql.includes('production-a5:schema-enums')) {
        return [{ schema: 'public', typeName: 'WidgetState', label: 'OPEN', sortOrder: 1 }];
      }
      throw new Error('unexpected_query');
    });

    const rows = await readProductionA5SchemaObjects(client, 'public');
    assert.deepEqual(rows.map((row) => row.kind), ['COLUMN', 'CONSTRAINT', 'ENUM_VALUE', 'INDEX', 'RELATION']);
    assert.equal(rows[0]!.relation, 'Widget');
    assert.equal(rows[0]!.definition,
      '{"dataType":"text","defaultExpression":null,"generatedKind":"","identityKind":"","nullable":false,"position":1}');
    assert.equal(rows[2]!.relation, null);
  });

  it('excludes views, materialized views, foreign tables and sequences at the SQL boundary', async () => {
    const queries: string[] = [];
    const client = fakeClient((sql) => {
      queries.push(sql);
      return [];
    });
    assert.deepEqual(await readProductionA5SchemaObjects(client, 'public'), []);
    const relationQuery = queries.find((sql) => sql.includes('production-a5:schema-relations'))!;
    const columnQuery = queries.find((sql) => sql.includes('production-a5:schema-columns'))!;
    const indexQuery = queries.find((sql) => sql.includes('production-a5:schema-indexes'))!;
    const constraintQuery = queries.find((sql) => sql.includes('production-a5:schema-constraints'))!;
    for (const sql of [relationQuery, columnQuery]) {
      assert.match(sql, /c\.relkind IN \('r','p'\)/);
      assert.doesNotMatch(sql, /'v'|'m'|'f'|'S'/);
    }
    assert.match(indexQuery, /table_class\.relkind IN \('r','p'\)/);
    assert.match(constraintQuery, /c\.relkind IN \('r','p'\)/);
  });

  it('uses the legacy profile without ever querying absent launch/normalization relations', async () => {
    const queries: string[] = [];
    const legacyRelations = [
      '_prisma_migrations', 'Company', 'CompanyFeatureEntitlement', 'AuditLog',
      'CompanyOnboardingRun', 'WorkflowTask', 'ReimbursementRequest',
    ];
    const client = fakeClient((sql) => {
      queries.push(sql);
      if (sql.includes('production-a5:schema-relations')) {
        return legacyRelations.map((relation) => ({ schema: 'public', relation, relationKind: 'r' }));
      }
      if (sql.includes('production-a5:schema-columns') || sql.includes('production-a5:schema-indexes')
        || sql.includes('production-a5:schema-constraints') || sql.includes('production-a5:schema-enums')) return [];
      if (sql.includes('current_user AS "currentUser"')) {
        return [{
          currentUser: 'watchdog_a5_prod_ro', transactionReadOnly: 'on', defaultTransactionReadOnly: 'on',
          roleNoInherit: true, roleNonPrivileged: true, roleMemberships: 0,
        }];
      }
      if (sql.includes('WITH app_relations AS')) {
        return [{
          missingCoreSelect: 0, outsideCoreSelect: 0, dmlPrivilegeTables: 0,
          sequencePrivilegeObjects: 0, securityDefinerExecute: 0, ownedObjects: 0,
          rowSecurityCoreTables: 0, databaseCreate: false, schemaCreate: false,
        }];
      }
      if (sql.includes('production-a5:applied-migrations')) return [];
      if (sql.includes('production-a5:companies')) return [{ id: 'tenant-never-emitted' }];
      if (sql.includes('production-a5:preexisting-entitlements')) return [];
      if (sql.includes('production-a5:pending-reimbursement-headers')) return [];
      throw new Error(`unexpected_query:${sql}`);
    });

    const snapshot = await collectProductionA5DatabaseSnapshot(client, {
      stage: 'PRE_MUTATION', schema: 'public', noTaskRole: true,
    });
    assert.equal(snapshot.launch, null);
    assert.equal(snapshot.normalization.status, 'NOT_MATERIALIZED');
    assert.match(snapshot.preexistingEntitlementStateHash, /^[0-9a-f]{64}$/);
    assert.match(snapshot.preexistingAuthorityStateHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(snapshot).includes('tenant-never-emitted'), false);
    assert.equal(queries.some((sql) => sql.includes('production-a5:launch-state')), false);
    assert.equal(queries.some((sql) => sql.includes('production-a5:normalization-')), false);
    assert.equal(queries.some((sql) => sql.includes('production-a5:pending-reimbursement-lines')), false);
  });

  it('classifies every pending snapshot without emitting request, tenant, amount or text fields', () => {
    const base = {
      companyId: 'tenant-secret', title: 'private title', reason: 'private reason',
      categoryKey: 'travel', categoryLabelSnapshot: 'private label', amount: '100.0000',
      currency: 'THB', incurredDate: new Date('2026-08-01T00:00:00.000Z'),
      primaryAttachmentId: 'attachment-secret', linkedExpenseId: null,
      currentApprovalStepId: 'step-pending', currentStepStatus: 'PENDING',
      currentStepDecidedAt: null, currentStepDecisionByUserId: null,
      currentStepComment: null, currentStepRejectionReason: null,
    };
    const lineFor = (requestId: string, overrides: Record<string, unknown> = {}) => ({
      id: `rbl_${requestId}`, companyId: base.companyId, reimbursementRequestId: requestId, lineNo: 1,
      incurredDate: base.incurredDate, description: base.title, purpose: null,
      categoryKey: base.categoryKey, categoryLabelSnapshot: base.categoryLabelSnapshot,
      amount: base.amount, attachmentId: base.primaryAttachmentId, linkedExpenseId: null,
      ...overrides,
    });
    const v1Fields = {
      amount: base.amount, currency: base.currency, categoryKey: base.categoryKey,
      incurredDate: base.incurredDate.toISOString(), reason: base.reason,
      primaryAttachmentId: base.primaryAttachmentId,
    };
    const sourceExpenseSnapshot: ReimbursementSourceSnapshot = {
      schemaVersion: 1, expenseId: 'expense-secret', expenseUpdatedAt: '2026-08-01T00:00:00.000Z',
      requesterUserId: 'employee-secret', expenseDate: '2026-08-01', paymentDate: null,
      paymentMethod: null, currency: 'THB',
      seller: { name: 'vendor-secret', taxId: null, branchCode: null, documentNumber: null },
      sourceDocumentType: 'RECEIPT', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      taxEvidenceStatus: 'SUPPORTING_ONLY',
      classification: { expenseCategoryId: null, accountHintKey: null, taxCategory: null },
      totals: { netPayableAmount: '100.0000' }, lines: [], attachments: [], certificate: null,
    };
    const attachmentSnapshot = {
      id: 'attachment-secret', uploadedByUserId: 'finance-secret', checksumSha256: 'checksum-secret', fileName: 'receipt.png',
    };
    const approvalPolicySnapshotJson = {
      schemaVersion: 1, policyId: 'policy-secret', policyVersion: '2026-08-01T00:00:00.000Z',
      approvalRequiredFromAmount: '1.0000', requiresApproval: true,
      route: { mode: 'MANAGER_ROLE', roleKey: 'MANAGER', effectiveTaskRole: 'MANAGER', ownerFallbackUsedAtSubmission: false },
      allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
      duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: true,
    } as const;
    const v2Line = { ...lineFor('v2'), sourceExpenseSnapshotJson: sourceExpenseSnapshot, attachmentSnapshotJson: attachmentSnapshot };
    const v2Fields = { ...v1Fields, approvalPolicySnapshotJson, lines: [{ ...v2Line, sourceExpenseSnapshot, attachmentSnapshot }] };
    const headers = [
      { requestId: 'v2', ...base, approvalPolicySnapshotJson, approvalSnapshotHash: computeSnapshotHash(v2Fields) },
      { requestId: 'v1', ...base, approvalSnapshotHash: computeLegacySnapshotHashV1(v1Fields) },
      { requestId: 'missing', ...base, approvalSnapshotHash: null },
      { requestId: 'invalid', ...base, approvalSnapshotHash: 'f'.repeat(32) },
    ];
    const exactV1Fields = {
      requestId: 'v1', companyId: base.companyId, title: base.title, reason: base.reason,
      categoryKey: base.categoryKey, categoryLabelSnapshot: base.categoryLabelSnapshot,
      amount: base.amount, currency: base.currency, incurredDate: base.incurredDate.toISOString(),
      primaryAttachmentId: base.primaryAttachmentId, linkedExpenseId: base.linkedExpenseId,
      lines: [lineFor('v1')],
    };
    assert.equal(computeLegacySnapshotHashV1(exactV1Fields), headers[1]!.approvalSnapshotHash);
    const exactLine = exactV1Fields.lines[0]!;
    assert.equal(exactLine.id, `rbl_${exactV1Fields.requestId}`);
    assert.equal(exactLine.companyId, exactV1Fields.companyId);
    assert.equal(exactLine.reimbursementRequestId, exactV1Fields.requestId);
    assert.equal(exactLine.lineNo, 1);
    assert.equal(exactLine.incurredDate.toISOString(), exactV1Fields.incurredDate);
    assert.equal(exactLine.description, exactV1Fields.title);
    assert.equal(exactLine.purpose, null);
    assert.equal(exactLine.categoryKey, exactV1Fields.categoryKey);
    assert.equal(exactLine.categoryLabelSnapshot, exactV1Fields.categoryLabelSnapshot);
    assert.equal(exactLine.amount, exactV1Fields.amount);
    assert.equal(exactLine.attachmentId, exactV1Fields.primaryAttachmentId);
    assert.equal(exactLine.linkedExpenseId, exactV1Fields.linkedExpenseId);
    assert.equal(isExactLegacyV1FallbackSnapshot(exactV1Fields, headers[1]!.approvalSnapshotHash!), true);
    for (const addedFacts of [{ sourceExpenseSnapshot }, { attachmentSnapshot }]) {
      assert.equal(isExactLegacyV1FallbackSnapshot({
        ...exactV1Fields, lines: [{ ...exactLine, ...addedFacts }],
      }, headers[1]!.approvalSnapshotHash!), false);
    }
    assert.equal(isExactLegacyV1FallbackSnapshot({ ...exactV1Fields, approvalPolicySnapshotJson }, headers[1]!.approvalSnapshotHash!), false);
    const result = classifyProductionA5ReimbursementApprovalSnapshots(
      'POST_MIGRATION', headers, [v2Line, lineFor('v1'), lineFor('missing'), lineFor('invalid')],
    );
    assert.deepEqual(result, {
      total: 4, v2Valid: 1, exactV1Compatible: 1, missingHash: 1, invalid: 1,
      currentStepPending: 4, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    });
    for (const changed of [
      { ...v2Line, sourceExpenseSnapshotJson: { ...sourceExpenseSnapshot, expenseDate: '2026-08-02' } },
      { ...v2Line, attachmentSnapshotJson: { ...attachmentSnapshot, checksumSha256: 'changed' } },
      { ...v2Line, sourceExpenseSnapshotJson: null },
    ]) {
      assert.equal(classifyProductionA5ReimbursementApprovalSnapshots('POST_MIGRATION', [headers[0]!], [changed]).invalid, 1);
    }
    const bytes = JSON.stringify(result);
    for (const secret of ['tenant-secret', 'private title', 'private reason', '100.0000', 'attachment-secret', 'vendor-secret', 'finance-secret', 'policy-secret']) {
      assert.equal(bytes.includes(secret), false);
    }
  });

  it('reads optional snapshot columns without referencing columns absent from older databases', async () => {
    const queries: string[] = [];
    await readProductionA5ReimbursementApprovalSnapshots(fakeClient((sql) => {
      queries.push(sql);
      return [];
    }), 'POST_MIGRATION');
    assert.ok(queries.some((sql) => sql.includes("to_jsonb(request)->'approvalPolicySnapshotJson'")));
    for (const field of ['sourceExpenseSnapshotJson', 'attachmentSnapshotJson']) {
      assert.ok(queries.some((sql) => sql.includes(`to_jsonb(line)->'${field}'`)));
      assert.ok(queries.every((sql) => !sql.includes(`line."${field}"`)));
    }
  });

  it('treats a valid legacy header as deterministic-v1-compatible before the line table exists', () => {
    const header = {
      requestId: 'legacy', companyId: 'tenant-secret', title: 'Legacy', reason: 'reason',
      categoryKey: 'travel', categoryLabelSnapshot: null, amount: '10.0000', currency: 'THB',
      incurredDate: new Date('2026-08-01T00:00:00.000Z'), primaryAttachmentId: null,
      linkedExpenseId: null, approvalSnapshotHash: '',
      currentApprovalStepId: 'step-pending', currentStepStatus: 'PENDING',
      currentStepDecidedAt: null, currentStepDecisionByUserId: null,
      currentStepComment: null, currentStepRejectionReason: null,
    };
    header.approvalSnapshotHash = computeLegacySnapshotHashV1({
      amount: header.amount, currency: header.currency, categoryKey: header.categoryKey,
      incurredDate: header.incurredDate.toISOString(), reason: header.reason,
      primaryAttachmentId: header.primaryAttachmentId,
    });
    assert.deepEqual(classifyProductionA5ReimbursementApprovalSnapshots('PRE_MUTATION', [header], []), {
      total: 1, v2Valid: 0, exactV1Compatible: 1, missingHash: 0, invalid: 0,
      currentStepPending: 1, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    });
  });

  it('does not call an empty post-migration line set v2-valid even though v1 and empty-v2 hash alike', () => {
    const header = {
      requestId: 'no-lines', companyId: 'tenant-secret', title: null, reason: 'reason',
      categoryKey: 'travel', categoryLabelSnapshot: null, amount: '10.0000', currency: 'THB',
      incurredDate: new Date('2026-08-01T00:00:00.000Z'), primaryAttachmentId: null,
      linkedExpenseId: null, approvalSnapshotHash: computeLegacySnapshotHashV1({
        amount: '10.0000', currency: 'THB', categoryKey: 'travel',
        incurredDate: '2026-08-01T00:00:00.000Z', reason: 'reason', primaryAttachmentId: null,
      }),
      currentApprovalStepId: 'step-pending', currentStepStatus: 'PENDING',
      currentStepDecidedAt: null, currentStepDecisionByUserId: null,
      currentStepComment: null, currentStepRejectionReason: null,
    };
    assert.deepEqual(classifyProductionA5ReimbursementApprovalSnapshots('POST_MIGRATION', [header], []), {
      total: 1, v2Valid: 0, exactV1Compatible: 0, missingHash: 0, invalid: 1,
      currentStepPending: 1, legacyPartialApproved: 0, legacyPartialRejected: 0, invalidCurrentStep: 0,
    });
  });

  it('classifies legacy partial decisions separately without emitting actor or decision text', () => {
    const base = {
      companyId: 'tenant-secret', title: 'Legacy', reason: 'reason', categoryKey: 'travel',
      categoryLabelSnapshot: null, amount: '10.0000', currency: 'THB',
      incurredDate: new Date('2026-08-01T00:00:00.000Z'), primaryAttachmentId: null,
      linkedExpenseId: null, currentApprovalStepId: 'step-secret',
      currentStepDecidedAt: new Date('2026-08-02T00:00:00.000Z'),
      currentStepDecisionByUserId: 'actor-secret', currentStepComment: 'comment-secret',
      approvalSnapshotHash: '',
    };
    base.approvalSnapshotHash = computeLegacySnapshotHashV1({
      amount: base.amount, currency: base.currency, categoryKey: base.categoryKey,
      incurredDate: base.incurredDate.toISOString(), reason: base.reason, primaryAttachmentId: null,
    });
    const approved = { ...base, requestId: 'approved', currentStepStatus: 'APPROVED', currentStepRejectionReason: null };
    const rejected = { ...base, requestId: 'rejected', currentStepStatus: 'REJECTED', currentStepRejectionReason: 'reason-secret' };
    const invalid = { ...base, requestId: 'invalid-step', currentStepStatus: 'CANCELLED', currentStepRejectionReason: null };
    const result = classifyProductionA5ReimbursementApprovalSnapshots('PRE_MUTATION', [approved, rejected, invalid], []);
    assert.deepEqual(result, {
      total: 3, v2Valid: 0, exactV1Compatible: 3, missingHash: 0, invalid: 0,
      currentStepPending: 0, legacyPartialApproved: 1, legacyPartialRejected: 1, invalidCurrentStep: 1,
    });
    const bytes = JSON.stringify(result);
    for (const secret of ['tenant-secret', 'actor-secret', 'comment-secret', 'reason-secret']) {
      assert.equal(bytes.includes(secret), false);
    }
  });

  it('rejects task-role/AWS credential availability before collection', () => {
    assert.doesNotThrow(() => assertNoProductionA5AwsCredentials({ AWS_REGION: 'ap-southeast-1' }));
    for (const key of [
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
      'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI',
      'AWS_WEB_IDENTITY_TOKEN_FILE',
    ]) {
      assert.throws(() => assertNoProductionA5AwsCredentials({ [key]: 'present' }), /aws_credentials_present/);
    }
  });

  it('fails closed on unfinished migration history instead of omitting it from the baseline', async () => {
    const client = fakeClient((sql) => {
      assert.match(sql, /production-a5:applied-migrations/);
      return [{
        name: '20260803000000_interrupted', checksum: 'a'.repeat(64),
        finishedAt: null, rolledBackAt: null,
      }];
    });
    await assert.rejects(() => readProductionA5AppliedMigrations(client), /unfinished_migration_present/);
  });

  it('fails closed on a failed/rolled-back migration row', async () => {
    const client = fakeClient(() => [{
      name: '20260803000000_failed', checksum: 'a'.repeat(64),
      finishedAt: null, rolledBackAt: new Date('2026-08-03T00:00:00Z'),
    }]);
    await assert.rejects(() => readProductionA5AppliedMigrations(client), /failed_or_rolled_back_migration_present/);
  });

  it('preserves database execution order instead of sorting migration names', async () => {
    const client = fakeClient(() => [
      {
        name: '20260802000000_second_name', checksum: 'b'.repeat(64), startedAt: new Date('2026-08-03T00:00:00Z'),
        finishedAt: new Date('2026-08-03T00:00:01Z'), rolledBackAt: null,
      },
      {
        name: '20260801000000_first_name', checksum: 'a'.repeat(64), startedAt: new Date('2026-08-03T00:00:02Z'),
        finishedAt: new Date('2026-08-03T00:00:03Z'), rolledBackAt: null,
      },
    ]);
    assert.deepEqual(await readProductionA5AppliedMigrations(client), [
      { name: '20260802000000_second_name', checksum: 'b'.repeat(64), appliedOrder: 1 },
      { name: '20260801000000_first_name', checksum: 'a'.repeat(64), appliedOrder: 2 },
    ]);
  });
});
