import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DATA_RIGHTS_DECISION_CATEGORIES } from '@watchdog-bms/contracts';
import {
  allowedDispositionsForDecision,
  completionOutcomeForDecisions,
  dataRightsSameActorModes,
  isOverdueCase,
  isLatestRequestEpoch,
  latestDecisions,
  missingDecisionCategories,
  missingEvidenceTypes,
  missingRetentionEvidenceCategories,
  recordableEvidenceTypesForStatus,
  requiredEvidenceCategory,
  singleAdminReasonError,
  singleAdminReasonOfAction,
  singleAdminSteps,
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
  it('offers a same-person step to the only System Admin and hands it to a second one when there is one', () => {
    const sameActor = {
      currentUserId: 'system-admin-1',
      createdByUserId: 'system-admin-1',
      approvedByUserId: 'system-admin-1',
      executionStartedByUserId: 'system-admin-1',
    };
    // A second active System Admin exists: that person takes the step, as before.
    assert.deepEqual(dataRightsSameActorModes({ ...sameActor, singleAdminAvailable: false }), {
      approval: 'SECOND_ADMIN', execution: 'SECOND_ADMIN', verification: 'SECOND_ADMIN',
    });
    // The reader is the only one: each step is offered as an explicit self-step.
    assert.deepEqual(dataRightsSameActorModes({ ...sameActor, singleAdminAvailable: true }), {
      approval: 'SINGLE_ADMIN', execution: 'SINGLE_ADMIN', verification: 'SINGLE_ADMIN',
    });
    // Somebody else took the step before: nothing special, whatever the number of admins.
    for (const singleAdminAvailable of [true, false]) {
      assert.deepEqual(dataRightsSameActorModes({ ...sameActor, currentUserId: 'system-admin-2', singleAdminAvailable }), {
        approval: 'NORMAL', execution: 'NORMAL', verification: 'NORMAL',
      });
    }
    // Decided step by step: only the step whose previous actor is the reader changes.
    assert.deepEqual(dataRightsSameActorModes({
      currentUserId: 'system-admin-1', createdByUserId: 'system-admin-2', approvedByUserId: 'system-admin-1',
      executionStartedByUserId: null, singleAdminAvailable: true,
    }), { approval: 'NORMAL', execution: 'SINGLE_ADMIN', verification: 'NORMAL' });
    // An unknown reader is never treated as the previous actor.
    assert.deepEqual(dataRightsSameActorModes({ ...sameActor, currentUserId: null, singleAdminAvailable: true }), {
      approval: 'NORMAL', execution: 'NORMAL', verification: 'NORMAL',
    });
  });

  it('lists the steps one person took alone and reads the reason kept in the case history', () => {
    const none = {
      approvalSingleAdmin: false, approvalSingleAdminReason: null,
      executionSingleAdmin: false, executionSingleAdminReason: null,
      verificationSingleAdmin: false, verificationSingleAdminReason: null,
      completionSingleAdmin: false, completionSingleAdminReason: null,
      evidence: [{ evidenceType: 'INDEPENDENT_VERIFICATION' as const, singleAdmin: false, singleAdminReason: null }],
    };
    assert.deepEqual(singleAdminSteps(none), []);
    assert.deepEqual(singleAdminSteps({
      ...none,
      approvalSingleAdmin: true, approvalSingleAdminReason: 'เหตุผลอนุมัติ',
      completionSingleAdmin: true, completionSingleAdminReason: 'เหตุผลปิดเคส',
      evidence: [
        { evidenceType: 'ACCESS_REVOCATION', singleAdmin: false, singleAdminReason: null },
        { evidenceType: 'INDEPENDENT_VERIFICATION', singleAdmin: true, singleAdminReason: 'เหตุผลตรวจ' },
      ],
    }), [
      { step: 'APPROVAL', reason: 'เหตุผลอนุมัติ' },
      { step: 'INDEPENDENT_VERIFICATION', reason: 'เหตุผลตรวจ' },
      { step: 'COMPLETION', reason: 'เหตุผลปิดเคส' },
    ]);

    assert.equal(singleAdminReasonOfAction({ fingerprint: 'x', singleAdmin: true, singleAdminReason: 'ทำคนเดียว' }), 'ทำคนเดียว');
    for (const metadata of [null, 'text', { fingerprint: 'x' }, { singleAdmin: false, singleAdminReason: 'x' }, { singleAdmin: true }]) {
      assert.equal(singleAdminReasonOfAction(metadata), null);
    }
  });

  it('explains in plain Thai why a single-admin reason is not accepted yet', () => {
    assert.equal(singleAdminReasonError(''), 'กรุณาเขียนเหตุผลที่ทำขั้นตอนนี้ด้วยตนเอง');
    assert.equal(singleAdminReasonError('คนเดียว'), 'เหตุผลสั้นเกินไป กรุณาเขียนอย่างน้อย 20 ตัวอักษร');
    assert.equal(singleAdminReasonError('ก'.repeat(1_001)), 'เหตุผลยาวเกินไป กรุณาเขียนไม่เกิน 1000 ตัวอักษร');
    assert.equal(singleAdminReasonError('a'.repeat(40)), 'กรุณาเขียนเหตุผลเป็นประโยคที่อ่านแล้วเข้าใจ');
    assert.equal(singleAdminReasonError('ระบบมีผู้ดูแลระบบเพียงคนเดียว จึงทำขั้นตอนนี้ด้วยตนเอง'), null);
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
