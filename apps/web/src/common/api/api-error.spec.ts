import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../models/api-error.model';
import { resolvePermissionState, mapResponseToApiError } from './api-error.logic';

// ── ApiError ──────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('sets kind and statusCode', () => {
    const err = new ApiError({ kind: 'forbidden', message: 'nope', statusCode: 403 });
    assert.equal(err.kind, 'forbidden');
    assert.equal(err.statusCode, 403);
  });

  it('preserves message', () => {
    const err = new ApiError({ kind: 'unknown', message: 'something went wrong' });
    assert.equal(err.message, 'something went wrong');
  });

  it('is instanceof Error and ApiError', () => {
    const err = new ApiError({ kind: 'network_error', message: 'net fail' });
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ApiError);
    assert.equal(err.name, 'ApiError');
  });

  it('fieldErrors is optional', () => {
    const err = new ApiError({ kind: 'validation', message: 'bad input' });
    assert.equal(err.fieldErrors, undefined);
  });

  it('stores fieldErrors when provided', () => {
    const fields = [{ field: 'email', message: 'invalid' }];
    const err = new ApiError({ kind: 'validation', message: 'bad input', fieldErrors: fields });
    assert.deepEqual(err.fieldErrors, fields);
  });

  it('retains a raw transport cause', () => {
    const cause = new SyntaxError('Unexpected token');
    const err = new ApiError({ kind: 'server_error', code: 'invalid_response', message: 'Invalid API response.', cause });
    assert.equal(err.cause, cause);
  });
});

// ── resolvePermissionState ────────────────────────────────────────────────────

describe('resolvePermissionState', () => {
  it('returns signed_out when not signed in', () => {
    assert.equal(resolvePermissionState(['x.read'], [], [], false), 'signed_out');
  });

  it('returns allowed when no required permissions', () => {
    assert.equal(resolvePermissionState([], [], [], true), 'allowed');
  });

  it('returns forbidden when user lacks all required permissions', () => {
    assert.equal(resolvePermissionState(['x.read'], [], [], true), 'forbidden');
  });

  it('returns allowed when canRead and no write permissions required', () => {
    assert.equal(resolvePermissionState(['x.read'], [], ['x.read'], true), 'allowed');
  });

  it('returns readonly when canRead but lacking write permission', () => {
    assert.equal(resolvePermissionState(['x.read'], ['x.write'], ['x.read'], true), 'readonly');
  });

  it('returns allowed when canRead and canWrite', () => {
    assert.equal(resolvePermissionState(['x.read'], ['x.write'], ['x.read', 'x.write'], true), 'allowed');
  });
});

// ── mapResponseToApiError ─────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: 'Status ' + status,
    headers: h,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('mapResponseToApiError', () => {
  it('maps 401 to unauthorized', async () => {
    const err = await mapResponseToApiError(makeResponse(401, {}));
    assert.equal(err.kind, 'unauthorized');
    assert.equal(err.statusCode, 401);
  });

  it('maps 403 to forbidden', async () => {
    const err = await mapResponseToApiError(makeResponse(403, {}));
    assert.equal(err.kind, 'forbidden');
    assert.equal(err.statusCode, 403);
  });

  it('preserves a stable API error code', async () => {
    const err = await mapResponseToApiError(makeResponse(403, { code: 'company_access_unavailable' }));
    assert.equal(err.code, 'company_access_unavailable');
  });

  it('preserves the temporary-password-expired message on 403', async () => {
    const err = await mapResponseToApiError(makeResponse(403, { message: 'Temporary password has expired.' }));
    assert.equal(err.message, 'Temporary password has expired.');
  });

  it('maps 404 to not_found', async () => {
    const err = await mapResponseToApiError(makeResponse(404, { code: 'artifact_not_found' }));
    assert.equal(err.kind, 'not_found');
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'artifact_not_found');
  });

  it('maps 429 to rate_limited', async () => {
    const err = await mapResponseToApiError(makeResponse(429, { message: 'Too many requests.', code: 'quota_exceeded' }));
    assert.equal(err.kind, 'rate_limited');
    assert.equal(err.statusCode, 429);
    assert.equal(err.code, 'quota_exceeded');
  });

  it('maps 422 to validation with NestJS message array', async () => {
    const body = { message: ['email must be an email', 'name should not be empty'] };
    const err = await mapResponseToApiError(makeResponse(422, body));
    assert.equal(err.kind, 'validation');
    assert.equal(err.fieldErrors?.length, 2);
    assert.equal(err.fieldErrors?.[0].message, 'email must be an email');
  });

  // A conflict is where the machine-readable code matters most, and 409 lands on the generic
  // fallback branch — which used to strip it, so no caller could ever branch on one.
  it('preserves a stable API error code on a 409 conflict', async () => {
    const err = await mapResponseToApiError(makeResponse(409, { code: 'employee_identity_conflict', message: 'Already exists.' }));
    assert.equal(err.code, 'employee_identity_conflict');
    assert.equal(err.statusCode, 409);
  });

  // 400/422 replaces `message` too, so the code is the only thing left to identify the rule.
  it('preserves a stable API error code on a 400 validation rejection', async () => {
    const err = await mapResponseToApiError(makeResponse(400, { code: 'password_reuse', message: 'New password must be different from the current password.' }));
    assert.equal(err.kind, 'validation');
    assert.equal(err.code, 'password_reuse');
  });

  it('maps 500 to server_error', async () => {
    const err = await mapResponseToApiError(makeResponse(500, { message: 'internal', code: 'upstream_failed' }));
    assert.equal(err.kind, 'server_error');
    assert.equal(err.statusCode, 500);
    assert.equal(err.code, 'upstream_failed');
  });

  it('reads request id from response header', async () => {
    const err = await mapResponseToApiError(makeResponse(403, {}, { 'x-request-id': 'req-abc' }));
    assert.equal(err.requestId, 'req-abc');
  });
});
