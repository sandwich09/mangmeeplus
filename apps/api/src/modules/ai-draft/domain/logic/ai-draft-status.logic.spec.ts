import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionRequest,
  assertRequestTransition,
  canTransitionSuggestion,
  assertSuggestionTransition,
  isTerminalSuggestionStatus,
  isSuggestionActionable,
  isSuggestionExpired,
} from './ai-draft-status.logic';

describe('request transitions', () => {
  it('allows QUEUED -> GENERATING -> READY', () => {
    assert.equal(canTransitionRequest('QUEUED', 'GENERATING'), true);
    assert.equal(canTransitionRequest('GENERATING', 'READY'), true);
  });
  it('allows retry from PROVIDER_UNAVAILABLE/NEEDS_DATA back to QUEUED', () => {
    assert.equal(canTransitionRequest('PROVIDER_UNAVAILABLE', 'QUEUED'), true);
    assert.equal(canTransitionRequest('NEEDS_DATA', 'QUEUED'), true);
  });
  it('does not allow READY -> GENERATING', () => {
    assert.equal(canTransitionRequest('READY', 'GENERATING'), false);
  });
  it('CANCELED/EXPIRED are terminal', () => {
    assert.equal(canTransitionRequest('CANCELED', 'QUEUED'), false);
    assert.equal(canTransitionRequest('EXPIRED', 'GENERATING'), false);
  });
  it('assertRequestTransition throws on invalid', () => {
    assert.throws(() => assertRequestTransition('READY', 'QUEUED'));
  });
});

describe('suggestion transitions', () => {
  it('NEW -> IN_REVIEW -> SOURCE_DRAFT_CREATED', () => {
    assert.equal(canTransitionSuggestion('NEW', 'IN_REVIEW'), true);
    assert.equal(canTransitionSuggestion('IN_REVIEW', 'SOURCE_DRAFT_CREATED'), true);
  });
  it('cannot create a source draft directly from NEW without review lock', () => {
    // NEW cannot jump straight to SOURCE_DRAFT_CREATED; must pass through accepted/in-review.
    assert.equal(canTransitionSuggestion('NEW', 'SOURCE_DRAFT_CREATED'), false);
  });
  it('SOURCE_DRAFT_CREATED cannot be dismissed or re-reviewed', () => {
    assert.equal(canTransitionSuggestion('SOURCE_DRAFT_CREATED', 'DISMISSED'), false);
    assert.equal(canTransitionSuggestion('SOURCE_DRAFT_CREATED', 'IN_REVIEW'), false);
  });
  it('blocked-by-source-state can be re-reviewed after acknowledgement', () => {
    assert.equal(canTransitionSuggestion('BLOCKED_BY_SOURCE_STATE', 'IN_REVIEW'), true);
  });
  it('assertSuggestionTransition throws on invalid', () => {
    assert.throws(() => assertSuggestionTransition('DISMISSED', 'IN_REVIEW'));
  });
});

describe('status predicates', () => {
  it('isTerminalSuggestionStatus', () => {
    assert.equal(isTerminalSuggestionStatus('SOURCE_DRAFT_CREATED'), true);
    assert.equal(isTerminalSuggestionStatus('NEW'), false);
  });
  it('isSuggestionActionable', () => {
    assert.equal(isSuggestionActionable('NEW'), true);
    assert.equal(isSuggestionActionable('IN_REVIEW'), true);
    assert.equal(isSuggestionActionable('DISMISSED'), false);
    assert.equal(isSuggestionActionable('EXPIRED'), false);
  });
  it('isSuggestionExpired compares against now', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    assert.equal(isSuggestionExpired(new Date('2026-07-01T11:00:00Z'), now), true);
    assert.equal(isSuggestionExpired(new Date('2026-07-01T13:00:00Z'), now), false);
    assert.equal(isSuggestionExpired(undefined, now), false);
  });
});
