import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loginFailureResponse } from './login-failure-response.server';

describe('loginFailureResponse', () => {
  it('clears browser auth state when a verified member is stopped by the closed switch', () => {
    const response = loginFailureResponse({ code: 'platform_access_closed', message: 'closed' }, 403);
    const cookies = response.headers.get('set-cookie') ?? '';
    assert.equal(response.status, 403);
    assert.match(cookies, /watchdog_token=/);
    assert.match(cookies, /watchdog_refresh=/);
    assert.match(cookies, /Max-Age=0/i);
  });

  it('does not mutate cookies for an ordinary invalid login', () => {
    const response = loginFailureResponse({ message: 'invalid' }, 401);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  });
});
