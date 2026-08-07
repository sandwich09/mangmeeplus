import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashText,
  previewText,
  redactSensitive,
  buildSourceStateHash,
  buildRequestIdempotencyKey,
  buildCandidateActionIdempotencyKey,
} from './ai-draft-idempotency.logic';

describe('hashText', () => {
  it('is stable and hex', () => {
    assert.equal(hashText('abc'), hashText('abc'));
    assert.match(hashText('abc'), /^[0-9a-f]{64}$/);
  });
});

describe('redactSensitive', () => {
  it('masks long digit runs (bank/card) keeping last 4', () => {
    assert.equal(redactSensitive('acct 1234567890123'), 'acct *********0123');
  });
  it('redacts token/secret key-value pairs', () => {
    assert.match(redactSensitive('Authorization Bearer abcdef123'), /\[REDACTED\]/);
    assert.match(redactSensitive('secret = hunter2value'), /\[REDACTED\]/);
  });
});

describe('previewText', () => {
  it('bounds length and appends ellipsis', () => {
    const p = previewText('x'.repeat(500), 280)!;
    assert.equal(p.length, 281); // 280 + ellipsis
    assert.ok(p.endsWith('…'));
  });
  it('returns undefined for undefined input and redacts short text', () => {
    assert.equal(previewText(undefined), undefined);
    assert.equal(previewText('acct 999999999'), 'acct *****9999');
  });
});

describe('buildSourceStateHash', () => {
  it('changes when any part changes', () => {
    const a = buildSourceStateHash(['co', 'cust', 100]);
    const b = buildSourceStateHash(['co', 'cust', 100]);
    const c = buildSourceStateHash(['co', 'cust', 101]);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
  it('treats null/undefined consistently', () => {
    assert.equal(buildSourceStateHash([null, 'x']), buildSourceStateHash([undefined, 'x']));
  });
});

describe('buildRequestIdempotencyKey', () => {
  it('uses the supplied key verbatim when present', () => {
    const k = buildRequestIdempotencyKey({ companyId: 'co', origin: 'WEB', templateKey: 't', suppliedKey: 'given' });
    assert.equal(k, 'given');
  });

  it('WORKFLOW origin is stable on workflowRunId (dedupes retries)', () => {
    const a = buildRequestIdempotencyKey({ companyId: 'co', origin: 'WORKFLOW', templateKey: 't', workflowRunId: 'run1' });
    const b = buildRequestIdempotencyKey({ companyId: 'co', origin: 'WORKFLOW', templateKey: 't', workflowRunId: 'run1' });
    assert.equal(a, b);
  });

  it('WORKFLOW origin without any anchor throws', () => {
    assert.throws(() => buildRequestIdempotencyKey({ companyId: 'co', origin: 'WORKFLOW', templateKey: 't' }));
  });

  it('manual WEB requests are unique per call', () => {
    const a = buildRequestIdempotencyKey({ companyId: 'co', origin: 'WEB', templateKey: 't', uniqueSuffix: '1' });
    const b = buildRequestIdempotencyKey({ companyId: 'co', origin: 'WEB', templateKey: 't', uniqueSuffix: '2' });
    assert.notEqual(a, b);
  });
});

describe('buildCandidateActionIdempotencyKey', () => {
  it('is stable per suggestion+action+target and differs across targets', () => {
    const a = buildCandidateActionIdempotencyKey('s1', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'cust1');
    const b = buildCandidateActionIdempotencyKey('s1', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'cust1');
    const c = buildCandidateActionIdempotencyKey('s1', 'CREATE_CRM_FOLLOW_UP_DRAFT', 'cust2');
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
