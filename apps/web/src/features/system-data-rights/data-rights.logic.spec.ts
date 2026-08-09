import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DATA_RIGHTS_CASE_TYPES, DATA_RIGHTS_DECISION_CATEGORIES } from '@watchdog-bms/contracts';
import {
  allowedDispositionsForDecision,
  completionOutcomeForDecisions,
  dataRightsRoleSeparationBlocks,
  isOverdueCase,
  isLatestRequestEpoch,
  latestDecisions,
  missingDecisionCategories,
  missingEvidenceTypes,
  missingRetentionEvidenceCategories,
  recordableEvidenceTypesForStatus,
  requiredEvidenceCategory,
  targetFieldsForCaseType,
  validateCreateCase,
  type CreateDataRightsCaseForm,
} from './data-rights.logic.js';

function validForm(overrides: Partial<CreateDataRightsCaseForm> = {}): CreateDataRightsCaseForm {
  return {
    requestKey: 'DR-20260809-001',
    caseType: 'USER_ACCOUNT_ERASURE',
    requestSource: 'EMAIL',
    requesterContact: '',
    targetUserId: 'user-1',
    companyId: '',
    membershipId: '',
    receivedAt: '2026-08-09T09:00',
    dueAt: '2026-09-08T09:00',
    priorCaseReference: '',
    targetConfirmed: true,
    ...overrides,
  };
}

describe('data-rights create validation', () => {
  it('requires the exact target tuple for each case type', () => {
    assert.deepEqual(targetFieldsForCaseType('USER_ACCOUNT_ERASURE'), ['targetUserId']);
    assert.deepEqual(targetFieldsForCaseType('MEMBERSHIP_EXIT'), ['targetUserId', 'companyId', 'membershipId']);
    assert.deepEqual(targetFieldsForCaseType('COMPANY_WORKSPACE_OFFBOARDING'), ['companyId']);

    const membershipErrors = validateCreateCase(validForm({
      caseType: 'MEMBERSHIP_EXIT',
      companyId: '',
      membershipId: '',
    }), new Date('2026-08-09T08:00:00+07:00'));
    assert.equal(membershipErrors.companyId, 'จำเป็นต้องระบุให้ตรงกับข้อมูลในระบบ');
    assert.equal(membershipErrors.membershipId, 'จำเป็นต้องระบุให้ตรงกับข้อมูลในระบบ');

    const companyErrors = validateCreateCase(validForm({
      caseType: 'COMPANY_WORKSPACE_OFFBOARDING',
      targetUserId: 'must-not-be-sent',
      companyId: 'company-1',
    }), new Date('2026-08-09T08:00:00+07:00'));
    assert.equal(companyErrors.targetUserId, 'เคสประเภทนี้ต้องไม่ส่งรหัสช่องนี้');
  });

  it('blocks malformed references, invalid deadlines, and unconfirmed targets', () => {
    const errors = validateCreateCase(validForm({
      requestKey: 'contains private data@example.com',
      dueAt: '2026-08-08T09:00',
      targetConfirmed: false,
    }), new Date('2026-08-09T08:00:00+07:00'));
    assert.match(errors.requestKey ?? '', /A-Z/);
    assert.match(errors.dueAt ?? '', /ต้องอยู่หลัง/);
    assert.ok(errors.targetConfirmed);
  });

  it('accepts only opaque case references for blocked-case remediation', () => {
    assert.equal(validateCreateCase(validForm({ priorCaseReference: 'case://blocked-case-1' })).priorCaseReference, undefined);
    assert.match(validateCreateCase(validForm({ priorCaseReference: 'https://example.test/case/1' })).priorCaseReference ?? '', /case:\/\//);
  });
});

describe('data-rights workflow helpers', () => {
  it('enforces the same role separation for every case type', () => {
    for (const caseType of DATA_RIGHTS_CASE_TYPES) {
      assert.deepEqual(dataRightsRoleSeparationBlocks({
        caseType,
        currentUserId: 'system-admin-1',
        createdByUserId: 'system-admin-1',
        approvedByUserId: 'system-admin-1',
        executionStartedByUserId: 'system-admin-1',
      }), {
        approval: true,
        execution: true,
        verification: true,
      }, caseType);
    }

    assert.deepEqual(dataRightsRoleSeparationBlocks({
      caseType: 'USER_ACCOUNT_ERASURE',
      currentUserId: 'system-admin-2',
      createdByUserId: 'system-admin-1',
      approvedByUserId: 'system-admin-1',
      executionStartedByUserId: 'system-admin-1',
    }), {
      approval: false,
      execution: false,
      verification: false,
    });
  });

  it('keeps BLOCKED unresolved for overdue tracking but excludes resolved cases', () => {
    const now = new Date('2026-08-10T00:00:00Z');
    assert.equal(isOverdueCase({ status: 'RETENTION_REVIEW', dueAt: '2026-08-09T00:00:00Z' }, now), true);
    assert.equal(isOverdueCase({ status: 'BLOCKED', dueAt: '2026-08-09T00:00:00Z' }, now), true);
    assert.equal(isOverdueCase({ status: 'COMPLETED', dueAt: '2026-08-09T00:00:00Z' }, now), false);
  });

  it('lets only the latest filter request update list state', () => {
    assert.equal(isLatestRequestEpoch(4, 4), true);
    assert.equal(isLatestRequestEpoch(3, 4), false);
  });

  it('uses the latest revision and requires all twelve decisions', () => {
    const decisions = [
      { category: 'ACCOUNT_IDENTITY' as const, disposition: 'DELETE' as const, revision: 1 },
      { category: 'ACCOUNT_IDENTITY' as const, disposition: 'RESTRICT' as const, revision: 2 },
    ];
    assert.equal(latestDecisions(decisions).get('ACCOUNT_IDENTITY')?.disposition, 'RESTRICT');
    assert.equal(missingDecisionCategories(decisions).length, 11);
  });

  it('matches scope-safe dispositions and completion outcome to retained exceptions', () => {
    assert.deepEqual(allowedDispositionsForDecision('MEMBERSHIP_EXIT', 'ACCOUNT_IDENTITY'), ['NOT_APPLICABLE']);
    assert.deepEqual(allowedDispositionsForDecision('MEMBERSHIP_EXIT', 'MEMBERSHIPS_ACCESS'), ['DELETE', 'RESTRICT', 'NOT_APPLICABLE']);
    assert.equal(completionOutcomeForDecisions([]), 'COMPLETED');
    assert.equal(completionOutcomeForDecisions([
      { category: 'BACKUPS', disposition: 'RETAIN', revision: 1 },
    ]), 'COMPLETED_WITH_EXCEPTION');
  });

  it('adds export, retention-hold, and independent-verification evidence from decisions', () => {
    const decisions = [
      { category: 'ACCOUNT_IDENTITY' as const, disposition: 'RETURN' as const, revision: 1 },
      { category: 'BACKUPS' as const, disposition: 'RETAIN' as const, revision: 1 },
    ];
    const missing = missingEvidenceTypes('USER_ACCOUNT_ERASURE', decisions, [], true);
    assert.ok(missing.includes('EXPORT_DELIVERY'));
    assert.ok(missing.includes('RETENTION_HOLD'));
    assert.ok(missing.includes('INDEPENDENT_VERIFICATION'));
    assert.ok(missing.includes('BACKUP_MANIFEST'));
  });

  it('does not allow an all-not-applicable case to complete without baseline proof', () => {
    const decisions = DATA_RIGHTS_DECISION_CATEGORIES.map((category) => ({
      category,
      disposition: 'NOT_APPLICABLE' as const,
      revision: 1,
    }));
    assert.deepEqual(missingEvidenceTypes('MEMBERSHIP_EXIT', decisions, [], false), ['ACCESS_REVOCATION']);
    assert.deepEqual(missingEvidenceTypes('USER_ACCOUNT_ERASURE', decisions, [], false), [
      'ACCESS_REVOCATION',
      'DATABASE_EXECUTION',
      'QUEUE_CACHE_PURGE',
      'BACKUP_MANIFEST',
    ]);
  });

  it('matches evidence phases and category bindings enforced by the API', () => {
    assert.deepEqual(recordableEvidenceTypesForStatus('RETENTION_REVIEW'), ['EXPORT_DELIVERY']);
    assert.ok(recordableEvidenceTypesForStatus('EXECUTING').includes('BACKUP_MANIFEST'));
    assert.deepEqual(recordableEvidenceTypesForStatus('VERIFICATION'), ['INDEPENDENT_VERIFICATION']);
    assert.deepEqual(recordableEvidenceTypesForStatus('IDENTITY_VERIFIED'), []);
    assert.equal(requiredEvidenceCategory('BACKUP_MANIFEST'), 'BACKUPS');
    assert.equal(requiredEvidenceCategory('ACCESS_REVOCATION'), 'MEMBERSHIPS_ACCESS');
  });

  it('requires one retention-hold reference for each retained or restricted category', () => {
    const decisions = [
      { category: 'BACKUPS' as const, disposition: 'RETAIN' as const, revision: 1 },
      { category: 'AUDIT_SECURITY_LOGS' as const, disposition: 'RESTRICT' as const, revision: 1 },
    ];
    assert.deepEqual(missingRetentionEvidenceCategories(decisions, [
      { evidenceType: 'RETENTION_HOLD', category: 'BACKUPS', sha256: 'a'.repeat(64) },
    ]), ['AUDIT_SECURITY_LOGS']);
  });

  it('does not treat a legacy evidence reference without a valid hash as complete', () => {
    const decisions = DATA_RIGHTS_DECISION_CATEGORIES.map((category) => ({
      category,
      disposition: 'NOT_APPLICABLE' as const,
      revision: 1,
    }));
    assert.deepEqual(missingEvidenceTypes('MEMBERSHIP_EXIT', decisions, [
      { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS', sha256: null },
    ], false), ['ACCESS_REVOCATION']);
  });
});
