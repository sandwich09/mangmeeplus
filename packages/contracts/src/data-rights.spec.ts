import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATA_RIGHTS_DECISION_CATEGORIES,
  dataRightsAllowedDispositions,
  dataRightsCaseEvidenceRequirements,
  dataRightsEvidenceRequirements,
  dataRightsCaseRequiresTenantAuthority,
  dataRightsRequiredExecutionEvidence,
} from './data-rights.js';

test('requires an explicit decision for every deletion data layer', () => {
  assert.deepEqual(DATA_RIGHTS_DECISION_CATEGORIES, [
    'ACCOUNT_IDENTITY',
    'AUTHENTICATION_SECRETS',
    'MEMBERSHIPS_ACCESS',
    'TENANT_OPERATIONAL_DATA',
    'ACCOUNTING_TAX_DOCUMENTS',
    'ATTACHMENTS_OBJECT_VERSIONS',
    'AI_OCR_DATA',
    'AUDIT_SECURITY_LOGS',
    'QUEUES_CACHES',
    'PROCESSORS',
    'BACKUPS',
    'LEGAL_ACCEPTANCE_EVIDENCE',
  ]);
});

test('separates personal account erasure from tenant authority', () => {
  assert.equal(dataRightsCaseRequiresTenantAuthority('USER_ACCOUNT_ERASURE'), false);
  assert.equal(dataRightsCaseRequiresTenantAuthority('MEMBERSHIP_EXIT'), true);
  assert.equal(dataRightsCaseRequiresTenantAuthority('COMPANY_WORKSPACE_OFFBOARDING'), true);
});

test('requires layered completion evidence and never treats soft deletion as completion', () => {
  assert.deepEqual(dataRightsRequiredExecutionEvidence('MEMBERSHIP_EXIT'), ['ACCESS_REVOCATION']);
  assert.deepEqual(dataRightsRequiredExecutionEvidence('USER_ACCOUNT_ERASURE'), [
    'ACCESS_REVOCATION',
    'DATABASE_EXECUTION',
    'QUEUE_CACHE_PURGE',
    'BACKUP_MANIFEST',
  ]);
  assert.deepEqual(dataRightsRequiredExecutionEvidence('COMPANY_WORKSPACE_OFFBOARDING'), [
    'ACCESS_REVOCATION',
    'DATABASE_EXECUTION',
    'OBJECT_STORAGE_INVENTORY',
    'QUEUE_CACHE_PURGE',
    'PROCESSOR_CONFIRMATION',
    'BACKUP_MANIFEST',
  ]);
});

test('prevents one request scope from deleting another scope data', () => {
  assert.deepEqual(dataRightsAllowedDispositions('MEMBERSHIP_EXIT', 'MEMBERSHIPS_ACCESS'), [
    'DELETE',
    'RESTRICT',
    'NOT_APPLICABLE',
  ]);
  assert.deepEqual(dataRightsAllowedDispositions('MEMBERSHIP_EXIT', 'ACCOUNT_IDENTITY'), ['NOT_APPLICABLE']);
  assert.deepEqual(dataRightsAllowedDispositions('USER_ACCOUNT_ERASURE', 'ACCOUNTING_TAX_DOCUMENTS'), [
    'RESTRICT',
    'RETAIN',
    'NOT_APPLICABLE',
  ]);
  assert.deepEqual(dataRightsAllowedDispositions('COMPANY_WORKSPACE_OFFBOARDING', 'AUTHENTICATION_SECRETS'), [
    'NOT_APPLICABLE',
  ]);
  assert.deepEqual(dataRightsAllowedDispositions('COMPANY_WORKSPACE_OFFBOARDING', 'TENANT_OPERATIONAL_DATA'), [
    'DELETE',
    'ANONYMIZE',
    'RESTRICT',
    'RETAIN',
    'RETURN',
    'NOT_APPLICABLE',
  ]);
});

test('derives completion evidence from each latest category decision', () => {
  assert.deepEqual(dataRightsEvidenceRequirements([
    { category: 'MEMBERSHIPS_ACCESS', disposition: 'RESTRICT' },
    { category: 'ATTACHMENTS_OBJECT_VERSIONS', disposition: 'DELETE' },
    { category: 'PROCESSORS', disposition: 'DELETE' },
    { category: 'BACKUPS', disposition: 'RETAIN' },
    { category: 'AI_OCR_DATA', disposition: 'RETURN' },
  ]), [
    { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' },
    { evidenceType: 'RETENTION_HOLD', category: 'MEMBERSHIPS_ACCESS' },
    { evidenceType: 'DATABASE_EXECUTION', category: 'ATTACHMENTS_OBJECT_VERSIONS' },
    { evidenceType: 'OBJECT_STORAGE_INVENTORY', category: 'ATTACHMENTS_OBJECT_VERSIONS' },
    { evidenceType: 'DATABASE_EXECUTION', category: 'PROCESSORS' },
    { evidenceType: 'PROCESSOR_CONFIRMATION', category: 'PROCESSORS' },
    { evidenceType: 'BACKUP_MANIFEST', category: 'BACKUPS' },
    { evidenceType: 'RETENTION_HOLD', category: 'BACKUPS' },
    { evidenceType: 'EXPORT_DELIVERY', category: 'AI_OCR_DATA' },
  ]);
});

test('requires minimum absence or execution proof even when decisions are not applicable', () => {
  assert.deepEqual(dataRightsCaseEvidenceRequirements('MEMBERSHIP_EXIT', []), [
    { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' },
  ]);
  assert.deepEqual(dataRightsCaseEvidenceRequirements('USER_ACCOUNT_ERASURE', []), [
    { evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS' },
    { evidenceType: 'DATABASE_EXECUTION', category: 'ACCOUNT_IDENTITY' },
    { evidenceType: 'QUEUE_CACHE_PURGE', category: 'QUEUES_CACHES' },
    { evidenceType: 'BACKUP_MANIFEST', category: 'BACKUPS' },
  ]);
  assert.equal(dataRightsCaseEvidenceRequirements('COMPANY_WORKSPACE_OFFBOARDING', []).length, 6);
});
