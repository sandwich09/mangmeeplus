import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '../../../app/d/[token]/route';
import DemoExpiredPage from '../../../app/d/expired/page';
import { certificateHarness } from '@/features/expenses/expense-certificate-test-harness';
import { isProtectedPagePath } from '@/common/auth/middleware.logic';
import { ACCESS_TOKEN_COOKIE, CSRF_COOKIE, HOME_PATH_COOKIE, PERSIST_COOKIE, REFRESH_TOKEN_COOKIE } from '@/common/auth/auth-cookies.constants';

const token = 'a'.repeat(32);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const open = (value = token) => GET(new NextRequest(`https://mangmeeplus.com/d/${value}`, {
  headers: { 'x-forwarded-for': '203.0.113.55, 172.71.14.9' },
}), { params: Promise.resolve({ token: value }) });

function assertRecovery(response: Response, reason?: 'unavailable') {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `https://mangmeeplus.com/d/expired${reason ? '?reason=unavailable' : ''}`);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('HEAD never calls the demo API and has an empty 204 response', async () => {
  globalThis.fetch = async () => { assert.fail('HEAD reached API'); };
  assert.equal(HEAD().status, 204);
  assert.equal(await HEAD().text(), '');
});

test('demo entry and expired page are public without a session', () => {
  assert.equal(isProtectedPagePath(`/d/${token}`), false);
  assert.equal(isProtectedPagePath('/d/expired'), false);
});

test('bad token redirects before touching API', async () => {
  globalThis.fetch = async () => { assert.fail('bad token reached API'); };
  for (const value of ['bad', 'a'.repeat(129), 'invalid!'.repeat(4)]) assertRecovery(await open(value));
});

test('only HTTP 410 confirms expiry even if its body is unreadable', async () => {
  globalThis.fetch = async () => new Response('invalid json', { status: 410 });
  assertRecovery(await open());
});

test('other HTTP failures show temporary unavailability without changing cookies', async () => {
  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    globalThis.fetch = async () => Response.json({ code: 'demo_link_expired' }, { status });
    assertRecovery(await open(), 'unavailable');
  }
});

test('network errors and timeouts show temporary unavailability', async () => {
  for (const error of [new TypeError('unreachable'), new DOMException('timeout', 'TimeoutError')]) {
    globalThis.fetch = async () => { throw error; };
    assertRecovery(await open(), 'unavailable');
  }
});

test('invalid exchange responses show temporary unavailability without changing cookies', async () => {
  for (const body of ['null', '{}', 'invalid json', '{"accessToken":1,"refreshToken":"r"}', '{"accessToken":"a","refreshToken":"r"}']) {
    globalThis.fetch = async () => new Response(body);
    assertRecovery(await open(), 'unavailable');
  }
});

test('success posts the token with visitor headers and sets session cookies before 303', async () => {
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/v1\/auth\/demo\/open$/);
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { token });
    assert.equal(new Headers(init?.headers).get('x-forwarded-for'), '203.0.113.55, 172.71.14.9');
    assert.equal(init?.cache, 'no-store');
    return Response.json({ accessToken: 'demo-access', refreshToken: 'demo-refresh', expiresIn: 900, companyId: 'demo', targetPath: '/companies/demo/dashboard' });
  };
  const response = await open();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://mangmeeplus.com/companies/demo/dashboard');
  assert.equal(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value, 'demo-access');
  assert.equal(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value, 'demo-refresh');
  assert.equal(response.cookies.get(PERSIST_COOKIE)?.value, '0');
  assert.equal(response.cookies.get(HOME_PATH_COOKIE)?.value, '/companies/demo/dashboard');
  assert.ok(response.cookies.get(CSRF_COOKIE)?.value);
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, PERSIST_COOKIE, HOME_PATH_COOKIE, CSRF_COOKIE]) {
    assert.equal(response.cookies.get(name)?.maxAge, undefined);
    assert.equal(response.cookies.get(name)?.expires, undefined);
  }
  assert.equal(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly, true);
  assert.equal(response.cookies.get(REFRESH_TOKEN_COOKIE)?.httpOnly, true);
});

test('off-origin API targets fall back to the API company dashboard', async () => {
  for (const targetPath of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    globalThis.fetch = async () => Response.json({ accessToken: 'a', refreshToken: 'r', companyId: 'demo', targetPath });
    assert.equal((await open()).headers.get('location'), 'https://mangmeeplus.com/companies/demo/dashboard');
  }
});


test('confirmed expiry retains its message and support primary action', async () => {
  const page = await DemoExpiredPage({ searchParams: Promise.resolve({}) });
  const view = certificateHarness(() => page);
  const html = view.render();
  assert.match(html, /ลิงก์เดโม่นี้หมดอายุแล้วค่ะ/);
  assert.doesNotMatch(html, /ลองอีกครั้ง/);
  assert.match(html, /<a[^>]*class="mangmee-btn mangmee-btn-primary"[^>]*>คุยกับทีมดูแล<\/a>/);
});

test('temporary unavailability offers history-back retry and secondary support', async () => {
  const page = await DemoExpiredPage({ searchParams: Promise.resolve({ reason: 'unavailable' }) });
  const view = certificateHarness(() => page);
  const html = view.render();
  assert.match(html, /ตอนนี้เปิดเดโม่ไม่ได้ชั่วคราวค่ะ ลองกดลิงก์เดิมอีกครั้งในอีกสักครู่นะคะ/);
  assert.doesNotMatch(html, /ลิงก์เดโม่นี้หมดอายุแล้วค่ะ/);
  assert.match(html, /<a[^>]*class="mangmee-btn mangmee-btn-secondary"[^>]*>คุยกับทีมดูแล<\/a>/);
  const retry = view.find('button', props => props.children.includes('ลองอีกครั้ง'));
  assert.match(retry.className, /mangmee-btn-primary/);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let backCalls = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { history: { back() { backCalls += 1; } } } });
  try {
    retry.onClick();
    assert.equal(backCalls, 1);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
