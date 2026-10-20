# Agent Memory: web CSP blocks statically prerendered pages (2026-10-20)

Status: Fixed on branch `claude/amazing-bardeen-pzyx6o`; not deployed (needs owner go-ahead and `docs/runbooks/uat-production-v2-deployment.md`).
Owner: web
Scope: `apps/web/app/layout.tsx`, `apps/web/src/common/security/csp-dynamic-rendering.spec.ts`.

Problem: owner report — https://mangmeeplus.com/privacy and /terms stay on "กำลังเปิดหน้า..." with ~22 CSP errors.
Cause: `proxy.ts` sends `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce per request. Next stamps the nonce only on
per-request renders; routes with no dynamic API were prerendered at build (`○` in the `next build` table), so their scripts carry
no nonce, the CSP blocks all of them, React never hydrates and the root `loading.tsx` fallback is never swapped out.
Affected (build table before fix): `/`, `/_not-found` (every 404), `/privacy`, `/terms`, `/data-deletion`, `/forgot-password`.
`/forgot-password` and the 404 page painted but never hydrated (form/links had no client JS).

Decisions:
- Root layout calls `await connection()` (next/server) so every page renders per request, including pages added later — one file
  instead of `force-dynamic` on six routes. Trade-off: legal pages lose the year-long `s-maxage` prerender cache and render per
  request (`private, no-store`); they are small server components, so this is acceptable. Pages stay indexable (no robots change).
- Guard spec scans source: root layout must await `connection()`, and no route under `app/` may export `dynamic = 'force-static'|'error'`,
  a positive `revalidate`, or `generateStaticParams`.

Verification (local, `next build --webpack` + `next start` with `NODE_ENV/APP_ENV/DEPLOY_ENVIRONMENT=production`):
- Before: build table had the six `○` routes; Playwright Chromium at 390 and 1280 — /privacy, /terms, /data-deletion 4 CSP errors
  each and loading screen visible; /forgot-password and 404 2 CSP errors each.
- After: only `/icon.svg` static; at 390 and 1280 all of /privacy, /terms, /data-deletion, /forgot-password, 404, /login, / have
  0 CSP errors and no loading screen; full content visible in screenshots.
- `tsx --test src/common/security/*.spec.ts src/common/auth/proxy.spec.ts` → 24/24 pass; new spec fails against the old layout.
- `tsc --noEmit` (web): only error is unrelated `decimal.js` resolution from `apps/api` (API deps not installed in this session).

Next: owner go-ahead for UAT → Production per the v2 deployment runbook; after deploy, re-check /privacy and /terms console on prod.
