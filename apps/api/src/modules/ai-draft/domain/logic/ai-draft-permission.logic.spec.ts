import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  requiredSourcePermissionsForAction,
  canReadSuggestions,
  hasBroadSuggestionRead,
  canRequestSuggestions,
  canReviewSuggestions,
  canValidateCandidateAction,
  evaluateCanCreateSourceDraft,
  canManageTemplates,
} from './ai-draft-permission.logic';

describe('required source permissions', () => {
  it('maps CRM follow-up to crm.follow_up.create', () => {
    assert.deepEqual(requiredSourcePermissionsForAction('CREATE_CRM_FOLLOW_UP_DRAFT'), ['crm.follow_up.create']);
  });
  it('self-owned actions need no source permission', () => {
    assert.deepEqual(requiredSourcePermissionsForAction('CREATE_REVIEW_CHECKLIST'), []);
  });
});

describe('read policy', () => {
  it('read or read_own both allow reading', () => {
    assert.equal(canReadSuggestions(['ai.suggestion.read']), true);
    assert.equal(canReadSuggestions(['ai.suggestion.read_own']), true);
    assert.equal(canReadSuggestions([]), false);
  });
  it('only broad read sees full company scope', () => {
    assert.equal(hasBroadSuggestionRead(['ai.suggestion.read']), true);
    assert.equal(hasBroadSuggestionRead(['ai.suggestion.read_own']), false);
  });
});

describe('request/review policy', () => {
  it('request allowed via suggestion.request or draft.request', () => {
    assert.equal(canRequestSuggestions(['ai.suggestion.request']), true);
    assert.equal(canRequestSuggestions(['ai.draft.request']), true);
    assert.equal(canRequestSuggestions(['ai.suggestion.read']), false);
  });
  it('review allowed via suggestion.review or draft.review', () => {
    assert.equal(canReviewSuggestions(['ai.suggestion.review']), true);
    assert.equal(canReviewSuggestions(['ai.draft.review']), true);
  });
});

describe('validate candidate action', () => {
  it('needs draft.review AND the source permission', () => {
    assert.equal(canValidateCandidateAction(['ai.draft.review', 'crm.follow_up.create'], 'CREATE_CRM_FOLLOW_UP_DRAFT'), true);
    assert.equal(canValidateCandidateAction(['ai.draft.review'], 'CREATE_CRM_FOLLOW_UP_DRAFT'), false);
  });
});

describe('create source draft policy', () => {
  it('AI create permission alone is never sufficient — needs source permission too', () => {
    const r = evaluateCanCreateSourceDraft(['ai.draft.create_source_draft'], 'CREATE_CRM_FOLLOW_UP_DRAFT');
    assert.equal(r.allowed, false);
    assert.deepEqual(r.missing, ['crm.follow_up.create']);
  });
  it('source permission alone is never sufficient — needs AI create permission too', () => {
    const r = evaluateCanCreateSourceDraft(['crm.follow_up.create'], 'CREATE_CRM_FOLLOW_UP_DRAFT');
    assert.equal(r.allowed, false);
    assert.deepEqual(r.missing, ['ai.draft.create_source_draft']);
  });
  it('both AI create + source permission allows creation', () => {
    const r = evaluateCanCreateSourceDraft(['ai.draft.create_source_draft', 'crm.follow_up.create'], 'CREATE_CRM_FOLLOW_UP_DRAFT');
    assert.equal(r.allowed, true);
    assert.deepEqual(r.missing, []);
  });
  it('self-owned review checklist only needs AI create permission', () => {
    const r = evaluateCanCreateSourceDraft(['ai.draft.create_source_draft'], 'CREATE_REVIEW_CHECKLIST');
    assert.equal(r.allowed, true);
  });
});

describe('template management', () => {
  it('requires ai.template.manage', () => {
    assert.equal(canManageTemplates(['ai.template.manage']), true);
    assert.equal(canManageTemplates(['ai.template.read']), false);
  });
});
