/**
 * Gate C load smoke — plan `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md` §P7 Gate C.
 *
 * Fires the critical journey concurrently: sign in → dashboard → expenses list → receipt-upload
 * init. Everything runs against the WEB origin, exactly like a browser: `/api/auth/*` are the BFF
 * route handlers and `/api/v1/*` is the Next rewrite onto the ERP API, so the numbers include the
 * hop a real user pays for.
 *
 * k6 is an EXTERNAL BINARY — deliberately not an npm dependency, and this file is never imported by
 * the app. Install it separately (`brew install k6`) and run:
 *
 *   # local stack booted by e2e/run-local.sh (web :3000 → api :3001), seeded dev OWNER
 *   k6 run scripts/load-smoke.k6.js
 *
 *   # 40 VUs for 2 minutes, the plan's "at least 2× peak beta users" rule
 *   VUS=40 DURATION=2m k6 run scripts/load-smoke.k6.js
 *
 *   # UAT: no dev sign-in there, so pass real credentials
 *   BASE_URL=https://uat.mangmeeplus.com USERNAME=... PASSWORD=... VUS=20 \
 *     k6 run scripts/load-smoke.k6.js
 *
 * THRESHOLDS BELOW ARE TRIAL TARGETS, NOT AN AGREED SLO. The plan's Gate C numbers
 * (first status ≤ 1s, low-risk chat p95 ≤ 4s, business-tool answer p95 ≤ 8s, error rate < 1%)
 * are proposals pending the B1 provider baseline; re-pin them once B1 lands, and record the run's
 * real VU count in the release manifest. Local timing does not satisfy Gate C — only a hosted run
 * against the environment that will actually open does.
 */
import http from 'k6/http';
import { check, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const USERNAME = __ENV.USERNAME || '';
const PASSWORD = __ENV.PASSWORD || '';

const journeyErrors = new Rate('journey_errors');
const loginDuration = new Trend('journey_login', true);
const dashboardDuration = new Trend('journey_dashboard', true);
const expenseListDuration = new Trend('journey_expense_list', true);
const uploadInitDuration = new Trend('journey_upload_init', true);

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '1m',
  thresholds: {
    // Gate C: "error rate ของ critical journey ต่ำกว่า 1%".
    journey_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    // "แสดงสถานะตอบรับแรกภายใน 1 วินาที" — the page-level acknowledgements.
    journey_login: ['p(95)<2000'],
    journey_dashboard: ['p(95)<4000'],
    journey_expense_list: ['p(95)<4000'],
    // The upload init is the first step of the OCR lane; the OCR itself is measured separately.
    journey_upload_init: ['p(95)<8000'],
  },
};

/** k6 keeps a per-VU cookie jar, so the httpOnly session cookies ride along automatically. */
function signIn() {
  // Dev sign-in exists only where APP_ENV=local; anywhere else pass USERNAME/PASSWORD.
  const useDevLogin = !USERNAME || !PASSWORD;
  const res = useDevLogin
    ? http.post(`${BASE_URL}/api/auth/dev-login`, '{}', { headers: { 'Content-Type': 'application/json' }, tags: { step: 'login' } })
    : http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ username: USERNAME, password: PASSWORD, remember: true }),
      { headers: { 'Content-Type': 'application/json' }, tags: { step: 'login' } },
    );

  loginDuration.add(res.timings.duration);
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  journeyErrors.add(!ok);
  if (!ok) return null;

  const body = res.json();
  // The BFF answers with the landing path; the company id comes back with it.
  return body && body.companyId ? String(body.companyId) : null;
}

/** The double-submit CSRF cookie is JS-readable by design — mutations must echo it back. */
function csrfHeader() {
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(`${BASE_URL}/`);
  const value = cookies['watchdog_csrf'] && cookies['watchdog_csrf'][0];
  return value ? { 'x-csrf-token': value } : {};
}

function timed(trend, res, name) {
  trend.add(res.timings.duration);
  const ok = check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  journeyErrors.add(!ok);
  return ok;
}

export default function loadSmoke() {
  let companyId = null;

  group('login', () => {
    companyId = signIn();
  });
  if (!companyId) return;

  group('dashboard', () => {
    timed(dashboardDuration, http.get(`${BASE_URL}/companies/${companyId}/dashboard`, { tags: { step: 'dashboard' } }), 'dashboard');
  });

  group('expenses list', () => {
    timed(
      expenseListDuration,
      http.get(`${BASE_URL}/api/v1/companies/${companyId}/expenses?pageSize=20`, { tags: { step: 'expense_list' } }),
      'expense list',
    );
  });

  group('receipt upload init', () => {
    // Init only: it reserves the expense + presigned URL without pushing bytes, which is the step
    // that queues behind OCR/AI when many people upload at once. Uploading real images from k6
    // would measure S3, not the app.
    const payload = JSON.stringify({
      originalFileName: `load-smoke-${__VU}-${__ITER}.png`,
      mimeType: 'image/png',
      byteSize: 4096,
    });
    const res = http.post(`${BASE_URL}/api/v1/companies/${companyId}/expenses/receipt-uploads`, payload, {
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      tags: { step: 'upload_init' },
    });
    timed(uploadInitDuration, res, 'upload init');
  });
}
