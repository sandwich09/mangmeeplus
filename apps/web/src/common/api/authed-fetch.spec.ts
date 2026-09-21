import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_CONTEXT_STALE_EVENT, authedFetch, authedApiFetch, readCookieValue } from './authed-fetch';
import { apiErrorMessage } from './api-error-message';
import { subscribeToastBus, type ToastEvent } from '../feedback/toast-bus';

type Call = { url: string; init?: RequestInit };

function jsonResponse(status: number, body?: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
}

function scriptedFetch(script: Array<(call: Call) => Response>, calls: Call[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const call = { url, init };
    calls.push(call);
    const step = script.shift();
    if (!step) throw new Error(`Unexpected fetch call to ${url}`);
    return step(call);
  };
}

/** Runs `body` with a minimal `window` in place and returns every URL it navigated to. */
async function withStubbedWindow(body: () => Promise<void>): Promise<string[]> {
  const assigned: string[] = [];
  (globalThis as Record<string, unknown>)['window'] = {
    location: { pathname: '/companies/c1/dashboard', search: '', assign: (url: string) => assigned.push(url) },
  };
  try {
    await body();
  } finally {
    delete (globalThis as Record<string, unknown>)['window'];
  }
  return assigned;
}

describe('authed-fetch', () => {
  it('prefixes paths with /api/v1 and strips a legacy /v1 prefix', async () => {
    const calls: Call[] = [];
    const fetchImpl = scriptedFetch([() => jsonResponse(200, { ok: true })], calls);
    await authedFetch('/v1/companies/c1/products', undefined, fetchImpl);
    assert.equal(calls[0]!.url, '/api/v1/companies/c1/products');
    assert.equal(calls[0]!.init?.credentials, 'include');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    const calls: Call[] = [];
    const fetchImpl = scriptedFetch(
      [
        () => jsonResponse(401, { message: 'Missing authentication token.' }),
        () => jsonResponse(204), // POST /api/auth/refresh
        () => jsonResponse(200, { value: 42 }),
      ],
      calls,
    );
    const result = await authedApiFetch<{ value: number }>('/companies/c1/dashboard', undefined, fetchImpl);
    assert.equal(result.value, 42);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['/api/v1/companies/c1/dashboard', '/api/auth/refresh', '/api/v1/companies/c1/dashboard'],
    );
  });

  it('returns the 401 without retrying when the refresh fails', async () => {
    const calls: Call[] = [];
    const fetchImpl = scriptedFetch(
      [
        () => jsonResponse(401, { message: 'Missing authentication token.' }),
        () => jsonResponse(401, { message: 'Session is expired or revoked.' }),
      ],
      calls,
    );
    const res = await authedFetch('/companies/c1/dashboard', undefined, fetchImpl);
    assert.equal(res.status, 401);
    assert.equal(calls.length, 2);
  });

  // The BFF keeps the auth cookies when the refresh failed for a transient reason, so bouncing to
  // /login there would discard a session that is still ACTIVE on the server. Only the refresh
  // route's own 401 (which deletes the cookies) means the session is really gone.
  it('does not bounce to /login when the refresh failed transiently', async () => {
    for (const [refreshStatus, expectedMessage] of [
      [502, 'เชื่อมต่อระบบไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง'],
      [503, 'บริการที่จำเป็นยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง หากยังพบปัญหาให้ติดต่อทีมงาน'],
    ] as const) {
      const assigned = withStubbedWindow(async () => {
        const calls: Call[] = [];
        const fetchImpl = scriptedFetch([() => jsonResponse(401), () => jsonResponse(refreshStatus, { message: 'x' })], calls);
        await assert.rejects(
          () => authedApiFetch('/companies/c1/dashboard', undefined, fetchImpl),
          (error: Error & { status?: number }) => {
            assert.equal(error.status, refreshStatus);
            assert.equal(apiErrorMessage(error), expectedMessage);
            assert.doesNotMatch(apiErrorMessage(error), /เซสชัน/);
            return true;
          },
        );
        assert.equal(calls.length, 2, 'a transient refresh failure must not retry the original request');
      });
      assert.deepEqual(await assigned, [], `a ${refreshStatus} refresh must not log the user out`);
    }
  });

  it('classifies a refresh fetch rejection as network without logging the user out', async () => {
    const refreshCause = new TypeError('Failed to fetch refresh');
    const assigned = withStubbedWindow(async () => {
      const calls: Call[] = [];
      const fetchImpl = scriptedFetch([() => jsonResponse(401), () => { throw refreshCause; }], calls);
      await assert.rejects(
        () => authedApiFetch('/companies/c1/dashboard', undefined, fetchImpl),
        (error: Error & { kind?: string; cause?: unknown }) => {
          assert.equal(error.kind, 'network_error');
          assert.equal(error.cause, refreshCause);
          assert.equal(apiErrorMessage(error), 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
          return true;
        },
      );
      assert.equal(calls.length, 2);
    });
    assert.deepEqual(await assigned, []);
  });

  it('bounces to /login when the refresh proves the session is gone', async () => {
    const assigned = withStubbedWindow(async () => {
      const fetchImpl = scriptedFetch([() => jsonResponse(401), () => jsonResponse(401, { message: 'gone' })], []);
      await authedFetch('/companies/c1/dashboard', undefined, fetchImpl);
    });
    assert.deepEqual(await assigned, ['/login?next=%2Fcompanies%2Fc1%2Fdashboard']);
  });

  it('shares a single refresh across concurrent 401s', async () => {
    const calls: Call[] = [];
    let refreshCalls = 0;
    let releaseRefresh!: (value: Response) => void;
    const refreshGate = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        return refreshGate;
      }
      // First hit per request path returns 401; retries return 200.
      const priorHits = calls.filter((c) => c.url === url).length;
      return priorHits <= 1 ? jsonResponse(401) : jsonResponse(200, { ok: true });
    };

    const first = authedFetch('/companies/c1/a', undefined, fetchImpl);
    const second = authedFetch('/companies/c1/b', undefined, fetchImpl);
    // Let both first attempts land on the shared refresh gate, then release it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseRefresh(jsonResponse(204));
    const [resA, resB] = await Promise.all([first, second]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(refreshCalls, 1, 'refresh must be single-flight');
  });

  it('sends the double-submit CSRF header on mutations when the cookie exists', async () => {
    (globalThis as Record<string, unknown>)['document'] = { cookie: 'other=1; watchdog_csrf=csrf-token-1' };
    try {
      const calls: Call[] = [];
      const fetchImpl = scriptedFetch([() => jsonResponse(200, {})], calls);
      await authedFetch('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl);
      const headers = calls[0]!.init?.headers as Record<string, string>;
      assert.equal(headers['x-csrf-token'], 'csrf-token-1');
    } finally {
      delete (globalThis as Record<string, unknown>)['document'];
    }
  });

  it('does not send a CSRF header on reads', async () => {
    (globalThis as Record<string, unknown>)['document'] = { cookie: 'watchdog_csrf=csrf-token-1' };
    try {
      const calls: Call[] = [];
      const fetchImpl = scriptedFetch([() => jsonResponse(200, {})], calls);
      await authedFetch('/companies/c1/expenses', undefined, fetchImpl);
      const headers = calls[0]!.init?.headers as Record<string, string>;
      assert.equal(headers['x-csrf-token'], undefined);
    } finally {
      delete (globalThis as Record<string, unknown>)['document'];
    }
  });

  it('recovers a middleware CSRF rejection with one refresh and one retry', async () => {
    (globalThis as Record<string, unknown>)['document'] = { cookie: '' };
    try {
      const calls: Call[] = [];
      const fetchImpl = scriptedFetch(
        [
          () => jsonResponse(403, { message: 'CSRF token missing or invalid.', code: 'csrf_token_invalid' }),
          () => {
            // The BFF refresh reissues the double-submit cookie; the retry must pick it up.
            (globalThis as Record<string, unknown>)['document'] = { cookie: 'watchdog_csrf=fresh-token' };
            return jsonResponse(204);
          },
          () => jsonResponse(200, { ok: true }),
        ],
        calls,
      );
      const res = await authedFetch('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl);
      assert.equal(res.status, 200);
      assert.deepEqual(
        calls.map((c) => c.url),
        ['/api/v1/companies/c1/expenses', '/api/auth/refresh', '/api/v1/companies/c1/expenses'],
      );
      assert.equal((calls[2]!.init?.headers as Record<string, string>)['x-csrf-token'], 'fresh-token');
    } finally {
      delete (globalThis as Record<string, unknown>)['document'];
    }
  });

  it('preserves a caller OCR request id while merging Content-Type and refreshed CSRF headers', async () => {
    (globalThis as Record<string, unknown>)['document'] = { cookie: '' };
    try {
      const calls: Call[] = [];
      const fetchImpl = scriptedFetch(
        [
          () => jsonResponse(403, { message: 'CSRF token missing or invalid.', code: 'csrf_token_invalid' }),
          () => {
            (globalThis as Record<string, unknown>)['document'] = { cookie: 'watchdog_csrf=fresh-token' };
            return jsonResponse(204);
          },
          () => jsonResponse(200, { ok: true }),
        ],
        calls,
      );
      await authedFetch('/companies/c1/expenses/e1/extraction-request', {
        method: 'POST', body: '{}', headers: { 'X-Request-Id': 'ocr-attempt-1' },
      }, fetchImpl);
      const first = calls[0]!.init?.headers as Record<string, string>;
      const retry = calls[2]!.init?.headers as Record<string, string>;
      assert.equal(first['X-Request-Id'], 'ocr-attempt-1');
      assert.equal(retry['X-Request-Id'], 'ocr-attempt-1');
      assert.equal(retry['Content-Type'], 'application/json');
      assert.equal(retry['x-csrf-token'], 'fresh-token');
    } finally {
      delete (globalThis as Record<string, unknown>)['document'];
    }
  });

  it('returns a second CSRF rejection instead of retrying again', async () => {
    const calls: Call[] = [];
    const csrf403 = () => jsonResponse(403, { message: 'CSRF token missing or invalid.', code: 'csrf_token_invalid' });
    const fetchImpl = scriptedFetch([csrf403, () => jsonResponse(204), csrf403], calls);
    const res = await authedFetch('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl);
    assert.equal(res.status, 403);
    assert.equal(calls.length, 3, 'exactly one refresh + one retry');
  });

  it('never retries a business permission 403', async () => {
    const calls: Call[] = [];
    const fetchImpl = scriptedFetch([() => jsonResponse(403, { message: 'Missing permission expense.approve' })], calls);
    await assert.rejects(
      () => authedApiFetch('/companies/c1/expenses/e1/approve', { method: 'POST', body: '{}' }, fetchImpl),
      (err: Error & { status?: number }) => err.status === 403,
    );
    assert.equal(calls.length, 1, 'a permission denial must not trigger a refresh');
  });

  it('signals the workspace to revalidate access after a permission or entitlement denial', async () => {
    const events: string[] = [];
    (globalThis as Record<string, unknown>)['window'] = {
      location: { pathname: '/companies/c1/expenses', search: '', assign: () => undefined },
      dispatchEvent: (event: Event) => { events.push(event.type); return true; },
    };
    try {
      for (const body of [
        { message: 'Insufficient permissions.' },
        { message: 'Feature disabled.', code: 'feature_not_enabled' },
      ]) {
        const fetchImpl = scriptedFetch([() => jsonResponse(403, body)], []);
        await assert.rejects(() => authedApiFetch('/companies/c1/expenses', undefined, fetchImpl));
      }
    } finally {
      delete (globalThis as Record<string, unknown>)['window'];
    }
    assert.deepEqual(events, [ACCESS_CONTEXT_STALE_EVENT, ACCESS_CONTEXT_STALE_EVENT]);
  });

  it('redirects the stable legal-acceptance 403 while preserving the current page', async () => {
    const assigned = withStubbedWindow(async () => {
      const fetchImpl = scriptedFetch(
        [() => jsonResponse(403, { message: 'Legal acceptance required.', code: 'legal_acceptance_required' })],
        [],
      );
      const res = await authedFetch('/companies/c1/dashboard', undefined, fetchImpl);
      assert.equal(res.status, 403);
    });
    assert.deepEqual(
      await assigned,
      ['/legal-acceptance?companyId=c1&next=%2Fcompanies%2Fc1%2Fdashboard'],
    );
  });

  it('does not mistake an ordinary 403 for the legal gate', async () => {
    const assigned = withStubbedWindow(async () => {
      const fetchImpl = scriptedFetch(
        [() => jsonResponse(403, { message: 'Missing permission.', code: 'permission_denied' })],
        [],
      );
      await authedFetch('/companies/c1/dashboard', undefined, fetchImpl);
    });
    assert.deepEqual(await assigned, []);
  });

  it('maps error bodies to Error(message) with a status property', async () => {
    const body = { message: ['a is bad', 'b is bad'], code: 'validation_failed', warnings: [{ customerId: 'c-1' }] };
    const fetchImpl = scriptedFetch([() => jsonResponse(422, body)], []);
    await assert.rejects(
      () => authedApiFetch('/companies/c1/expenses', { method: 'PATCH', body: '{}' }, fetchImpl),
      (err: Error & { status?: number; details?: unknown }) => {
        assert.equal(err.message, 'a is bad, b is bad');
        assert.equal(err.status, 422);
        assert.deepEqual(err.details, body);
        return true;
      },
    );
  });

  it('emits one safe validation toast while preserving the raw mutation error', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    let emittedBeforeCatch = false;
    const body = {
      statusCode: 400,
      message: ['property visibility should not exist'],
      error: 'Bad Request',
    };
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => jsonResponse(400, body)], []);
        await assert.rejects(
          () => authedApiFetch('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl)
            .catch((error) => {
              emittedBeforeCatch = events.length === 1;
              throw error;
            }),
          (error: Error & { status?: number; details?: unknown }) => {
            assert.equal(error.message, 'property visibility should not exist');
            assert.equal(error.status, 400);
            assert.deepEqual(error.details, body);
            return true;
          },
        );
      });
    } finally {
      unsubscribe();
    }
    assert.equal(emittedBeforeCatch, true);
    assert.deepEqual(events, [{
      tone: 'error',
      message: 'ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง',
    }]);
  });

  it('emits exactly one friendly toast before a mutating network rejection', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    const networkError = new TypeError('Failed to fetch');
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => { throw networkError; }], []);
        await assert.rejects(
          () => authedApiFetch('/companies/c1/expenses', { method: 'PATCH', body: '{}' }, fetchImpl),
          (error: Error & { kind?: string; cause?: unknown }) => {
            assert.equal(error.kind, 'network_error');
            assert.equal(error.cause, networkError);
            return true;
          },
        );
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, [{
      tone: 'error',
      message: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    }]);
  });

  it('does not emit a toast for failed reads', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => jsonResponse(500)], []);
        await assert.rejects(() => authedApiFetch('/companies/c1/expenses', undefined, fetchImpl));
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, []);
  });

  it('does not emit a toast for a read network rejection', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => { throw new TypeError('Failed to fetch'); }], []);
        await assert.rejects(() => authedApiFetch('/companies/c1/expenses', undefined, fetchImpl));
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, []);
  });

  it('suppresses mutation toasts when opted out and strips the private init flag', async () => {
    const events: ToastEvent[] = [];
    const calls: Call[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => jsonResponse(500)], calls);
        await assert.rejects(() => authedApiFetch(
          '/companies/c1/expenses',
          { method: 'POST', body: '{}', suppressErrorToast: true },
          fetchImpl,
        ));
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, []);
    assert.equal('suppressErrorToast' in calls[0]!.init!, false);
  });

  it('suppresses a mutating network toast when opted out', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => { throw new TypeError('Failed to fetch'); }], []);
        await assert.rejects(() => authedApiFetch(
          '/companies/c1/expenses',
          { method: 'POST', body: '{}', suppressErrorToast: true },
          fetchImpl,
        ));
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, []);
  });

  it('keeps the response request ID with API error details', async () => {
    const fetchImpl = scriptedFetch([() => new Response(
      JSON.stringify({ message: 'Preview changed.', code: 'coa_preview_changed' }),
      { status: 409, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-chart-1' } },
    )], []);
    await assert.rejects(
      () => authedApiFetch('/companies/c1/chart-of-accounts/templates/t1/apply', { method: 'POST', body: '{}' }, fetchImpl),
      (err: Error & { details?: { requestId?: string } }) => {
        assert.equal(err.details?.requestId, 'req-chart-1');
        return true;
      },
    );
  });

  it('surfaces a stable error code from the body', async () => {
    const fetchImpl = scriptedFetch(
      [() => jsonResponse(409, { message: 'An employee with this ID/passport already exists.', code: 'employee_identity_conflict' })],
      [],
    );
    await assert.rejects(
      () => authedApiFetch('/companies/c1/settings/employees', { method: 'POST', body: '{}' }, fetchImpl),
      (err: Error & { status?: number; code?: string }) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'employee_identity_conflict');
        return true;
      },
    );
  });

  it('resolves undefined for 204 responses', async () => {
    const fetchImpl = scriptedFetch([() => jsonResponse(204)], []);
    const result = await authedApiFetch<void>('/auth/password/change', { method: 'POST', body: '{}' }, fetchImpl);
    assert.equal(result, undefined);
  });

  it('resolves undefined for 201 responses with an empty body instead of throwing on JSON.parse', async () => {
    const fetchImpl = scriptedFetch([() => new Response('', { status: 201 })], []);
    const result = await authedApiFetch<void>('/companies/c1/expenses/e1/duplicates/d1/dismiss', { method: 'POST', body: '{}' }, fetchImpl);
    assert.equal(result, undefined);
  });

  it('still parses 201 responses that do carry a JSON body', async () => {
    const fetchImpl = scriptedFetch([() => jsonResponse(201, { id: 'e1' })], []);
    const result = await authedApiFetch<{ id: string }>('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl);
    assert.equal(result.id, 'e1');
  });

  it('turns malformed successful JSON into one safe server error and retains the parse cause', async () => {
    const events: ToastEvent[] = [];
    const unsubscribe = subscribeToastBus((event) => events.push(event));
    try {
      await withStubbedWindow(async () => {
        const fetchImpl = scriptedFetch([() => new Response('{not-json', { status: 200 })], []);
        await assert.rejects(
          () => authedApiFetch('/companies/c1/expenses', { method: 'POST', body: '{}' }, fetchImpl),
          (error: Error & { kind?: string; code?: string; statusCode?: number; cause?: unknown }) => {
            assert.equal(error.kind, 'server_error');
            assert.equal(error.code, 'invalid_response');
            assert.equal(error.statusCode, 200);
            assert.ok(error.cause instanceof SyntaxError);
            assert.equal(apiErrorMessage(error), 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
            return true;
          },
        );
      });
    } finally {
      unsubscribe();
    }
    assert.deepEqual(events, [{ tone: 'error', message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' }]);
  });

  it('reads cookie values from a cookie string', () => {
    assert.equal(readCookieValue('a=1; watchdog_csrf=tok%20en; b=2', 'watchdog_csrf'), 'tok en');
    assert.equal(readCookieValue('a=1', 'missing'), null);
  });
});
