import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedCandidateActionType,
  validateCandidateActionShape,
  assertSafeCandidateAction,
  evaluateCitationRequirement,
  isToolCategoryAllowed,
  assertToolCategoryAllowed,
  defaultRiskForAction,
  isSelfOwnedAction,
} from './ai-draft-safety.logic';

describe('candidate action allowlist', () => {
  it('accepts allowlisted action types', () => {
    assert.equal(isAllowedCandidateActionType('CREATE_CRM_FOLLOW_UP_DRAFT'), true);
    assert.equal(isAllowedCandidateActionType('CREATE_REVIEW_CHECKLIST'), true);
  });

  it('rejects any final-mutation-style action type by design', () => {
    assert.equal(isAllowedCandidateActionType('POST_JOURNAL_ENTRY'), false);
    assert.equal(isAllowedCandidateActionType('PAY_INVOICE'), false);
    assert.equal(isAllowedCandidateActionType('ISSUE_TAX_INVOICE'), false);
  });

  it('validateCandidateActionShape flags an unsafe action type', () => {
    const errors = validateCandidateActionShape({ actionType: 'TRANSFER_FUNDS', targetModule: 'banking', draftPayloadJson: {} });
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Unsafe or unsupported/);
  });

  it('validateCandidateActionShape requires targetModule and object payload', () => {
    const errors = validateCandidateActionShape({ actionType: 'CREATE_CRM_FOLLOW_UP_DRAFT', targetModule: '', draftPayloadJson: 'nope' });
    assert.ok(errors.includes('targetModule is required'));
    assert.ok(errors.some((e) => /draftPayloadJson/.test(e)));
  });

  it('NO_SOURCE_DRAFT_AVAILABLE needs no target/payload', () => {
    assert.deepEqual(validateCandidateActionShape({ actionType: 'NO_SOURCE_DRAFT_AVAILABLE' }), []);
  });

  it('assertSafeCandidateAction throws on unsafe action', () => {
    assert.throws(() => assertSafeCandidateAction({ actionType: 'DELETE_COMPANY', targetModule: 'x', draftPayloadJson: {} }));
  });

  it('isSelfOwnedAction marks review checklist/workflow task as self-owned', () => {
    assert.equal(isSelfOwnedAction('CREATE_REVIEW_CHECKLIST'), true);
    assert.equal(isSelfOwnedAction('NO_SOURCE_DRAFT_AVAILABLE'), false);
    assert.equal(isSelfOwnedAction('CREATE_CRM_FOLLOW_UP_DRAFT'), false);
  });
});

describe('citation requirement', () => {
  it('passes when a recommendation has at least one citation', () => {
    assert.deepEqual(evaluateCitationRequirement({ hasRecommendation: true, citationCount: 2 }), { ok: true });
  });

  it('fails a recommendation with zero citations (must become needs-data)', () => {
    const r = evaluateCitationRequirement({ hasRecommendation: true, citationCount: 0 });
    assert.equal(r.ok, false);
    assert.match(r.reason!, /no source citations/);
  });

  it('allows a checklist/needs-data suggestion with no recommendation and no citations', () => {
    assert.deepEqual(evaluateCitationRequirement({ hasRecommendation: false, citationCount: 0 }), { ok: true });
  });
});

describe('tool policy', () => {
  it('always blocks final_mutation regardless of surface', () => {
    assert.equal(isToolCategoryAllowed('final_mutation', 'web').allowed, false);
    assert.equal(isToolCategoryAllowed('final_mutation', 'system').allowed, false);
  });

  it('blocks source_draft_create outside web (e.g. LINE)', () => {
    assert.equal(isToolCategoryAllowed('source_draft_create', 'line').allowed, false);
    assert.equal(isToolCategoryAllowed('source_draft_create', 'web').allowed, true);
  });

  it('blocks review_decision from workflow/worker but allows web', () => {
    assert.equal(isToolCategoryAllowed('review_decision', 'workflow').allowed, false);
    assert.equal(isToolCategoryAllowed('review_decision', 'web').allowed, true);
  });

  it('allows read + draft_generate from any surface', () => {
    assert.equal(isToolCategoryAllowed('read_evidence_pack', 'line').allowed, true);
    assert.equal(isToolCategoryAllowed('draft_generate', 'worker').allowed, true);
  });

  it('assertToolCategoryAllowed throws on a blocked category', () => {
    assert.throws(() => assertToolCategoryAllowed('final_mutation', 'web'));
  });
});

describe('default risk', () => {
  it('classifies certificate/quotation drafts as HIGH', () => {
    assert.equal(defaultRiskForAction('CREATE_TAX_CERTIFICATE_DRAFT'), 'HIGH');
    assert.equal(defaultRiskForAction('CREATE_ACCOUNTING_QUOTATION_DRAFT'), 'HIGH');
  });
  it('classifies review checklist as LOW and reorder review as MEDIUM', () => {
    assert.equal(defaultRiskForAction('CREATE_REVIEW_CHECKLIST'), 'LOW');
    assert.equal(defaultRiskForAction('CREATE_INVENTORY_REORDER_REVIEW'), 'MEDIUM');
  });
});
