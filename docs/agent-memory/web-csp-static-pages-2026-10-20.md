# Agent Memory: web CSP nonce vs statically prerendered pages

Status: Fixed on branch `claude/official-site-prototype-20261020` (not deployed).
Owner: thawatchai (reported 2026-10-20: mangmeeplus.com/privacy and /terms stay on "กำลังเปิดหน้า..." with CSP errors in the console).
Scope: `apps/web/app/layout.tsx`, `apps/web/src/common/security/security-headers.logic.spec.ts`.

Decisions:
- Root cause: `apps/web/proxy.ts` sends `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce per request (`security-headers.logic.ts:63-64`). Next stamps the nonce on its scripts only during a per-request render (Next 16 docs, `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` §"How nonces work", §"Static vs Dynamic Rendering with CSP": with nonces all pages must render dynamically). The root layout read nothing request-bound, so `next build` prerendered `/`, `/privacy`, `/terms`, `/forgot-password`, `/data-deletion`, `/_not-found`; their scripts had no nonce and were blocked, hydration never ran, and `app/loading.tsx` stayed on screen.
- Fix at the shared point: root layout is `async` and `await connection()` (docs-recommended; `export const dynamic` is removed in v16 once Cache Components is on). One change covers every route, no per-page flags.
- `/_global-error` stays prerendered: it is Next's own error document and does not use the root layout.
- Trade-off accepted: the public legal pages render per request (no static optimisation); the docs state this is required for nonce CSP.

Open questions:
- None for the fix. Release needs the owner's go-ahead and must follow `docs/runbooks/uat-production-v2-deployment.md`.

Artifacts:
- Regression guard: `security-headers.logic.spec.ts` "nonce CSP needs per-request rendering" asserts the root layout imports and awaits `connection()`.

Verification (2026-10-20, local production build `next build --webpack`, `next start`, Chromium):
- Before: prerender manifest listed / /_not-found /data-deletion /forgot-password /privacy /terms; at 390 and 1280 each page logged 21–22 CSP errors, /privacy /terms /data-deletion stuck on the loading screen, /forgot-password rendered but its scripts were blocked.
- After: prerender manifest lists only /_global-error and /icon.svg; /privacy /terms /forgot-password /data-deletion / /login at 390 and 1280: 0 CSP errors, no loading screen, page h1 present.
- `tsx --test security-headers.logic.spec.ts` 10/10 (fails 9/1 with the layout change reverted); `proxy.spec.ts` 13/13; `tsc --noEmit` exit 0.

Next: owner decides when to release through UAT then Production per the runbook; after release, recheck mangmeeplus.com/privacy and /terms in a browser console.
