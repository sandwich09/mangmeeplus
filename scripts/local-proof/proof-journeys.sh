#!/usr/bin/env bash
# Usage: proof-journeys.sh <tag> [extra Playwright args]
# Safety: checked proof URLs and shared heavy lock; warm-up/test failures return nonzero.
# Warm-up uses only the local proof HTTP context and the seeded test owner.
source "$(dirname "$0")/common.sh"
lp_tag "${1:-}"; lp_heavy "$@"
lp_env proof
TAG="$1"; shift
OUT="$LP_RESULTS/$TAG.summary"; LOG="$LP_LOGS/journeys-$TAG.log"
# Authenticated requests compile the protected routes; cookie-less requests only warm /login.
# Use the existing harness sign-in/clickwrap, with an HTTP context (no browser before the tests).
corepack pnpm exec node --import tsx <<'JS' > "$LOG" 2>&1
const { request } = require('@playwright/test');
const { loginAs } = require('./e2e/harness/roles.ts');
const { loginViaDevBff, ensureBrowserLegalAcceptance } = require('./e2e/harness/auth.ts');
(async () => {
  const baseURL = process.env.E2E_WEB_BASE_URL;
  const http = await request.newContext({ baseURL, timeout: 90000, extraHTTPHeaders: { Origin: baseURL } });
  const context = { request: http, cookies: async () => (await http.storageState()).cookies };
  const warm = async (path, missingRecord = false) => {
    const response = await http.get(path, { maxRedirects: 0 });
    if (!response.ok() && !(missingRecord && response.status() === 404)) throw new Error(`Warm-up failed: ${path} HTTP ${response.status()}`);
    console.log(`WARM ${path}`);
    await response.dispose();
  };
  try {
    await warm('/login');
    await loginViaDevBff(context);
    // Static routes reached by e2e/journeys/*.ts; one instance compiles the shared company route.
    const company = '/companies/seed-local-company';
    for (const path of [
      'dashboard', 'expenses', 'expenses/manual', 'expenses/upload', 'expenses/evidence',
      'expenses/substitute-receipts', 'expenses/substitute-receipts/new',
      'expenses/disbursement-vouchers', 'expenses/disbursement-vouchers/new',
      'reimbursements', 'reimbursements/new', 'settings/branches', 'settings/access-overview',
      'settings/profile', 'account', 'tax/withholding',
    ]) await warm(`${company}/${path}`);
    // Compile detail/signing routes without creating journey records; a missing record is expected.
    for (const path of ['expenses', 'expenses/substitute-receipts', 'expenses/disbursement-vouchers', 'reimbursements']) {
      await warm(`${company}/${path}/local-proof-warmup`, true);
    }
    await ensureBrowserLegalAcceptance(context, 'seed-local-company-2');
    await warm('/companies/seed-local-company-2/dashboard');
    // The plain shop has the four QA members, not the legacy dev owner. Company routes above are shared.
    await loginAs(context, 'OWNER');
    for (const shop of ['seed-local-plain-shop', 'seed-local-plain-shop-unanswered', 'seed-local-input-vat-shop']) {
      await ensureBrowserLegalAcceptance(context, shop);
      await warm(`/companies/${shop}/dashboard`);
    }
  } finally { await http.dispose(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
JS
RC=$?
if [ "$RC" -eq 0 ]; then
  corepack pnpm exec playwright test e2e/journeys --project=chromium --workers=1 --retries=0 --output="$LP_RESULTS/$TAG" "$@" >> "$LOG" 2>&1; RC=$?
fi
bash "$LOCAL_PROOF_DIR/result.sh" journeys "$RC" "$LOG" > "$OUT"
cat "$OUT"
exit "$RC"
