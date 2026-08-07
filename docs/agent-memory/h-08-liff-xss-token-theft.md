# Agent Memory: H-08 LIFF XSS and token theft impact

Status: Complete locally
Owner: Codex
Scope: Public employee/account/customer LIFF pages, their LINE token/channel DTO boundaries, regression coverage, and security-remediation evidence.
Decisions:
- Replace executable inline LIFF scripts with one same-origin static script response shared by all three pages.
- Keep runtime page values in HTML-escaped data attributes; never reflect employee link-token or customer channel query values into executable HTML.
- Remove `'unsafe-inline'` from `script-src`, keep existing inline CSS allowance, add `Referrer-Policy: no-referrer`, and retain `Cache-Control: no-store` on pages.
- Bound and format-check LINE ID tokens, channel ids, company ids, and employee link tokens before use.
- Preserve current LIFF journeys and avoid new dependencies.
Open questions: Live LINE console/token-revocation behavior remains U-07 and is outside this local code remediation.
Artifacts:
- `docs/security-remediation-checklist-merged-2026-07-17.md`
- `apps/api/src/common/security/liff-page.security.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/modules/auth/infrastructure/line-login-verifier.adapter.ts`
- `apps/api/src/modules/crm-inbox/presentation/http/customer-line-register.controller.ts`
- `apps/api/src/modules/crm-inbox/presentation/http/crm-customer-pdpa.controller.ts`
- `e2e/liff-xss.spec.ts`
Verification:
- Focused controller/security: 8/8 passed.
- Adjacent LINE account/employee/customer integration: 29/29 passed.
- Chromium reflected-XSS/CSP/referrer regression: 2/2 passed on isolated local ports.
- Full API regression: 2,113/2,113 passed.
- API `pnpm typecheck` and `git diff --check` passed.
- Review covered all three page modes, no-inline CSP metadata, same-origin fetch guard, token URL removal, DTO validation, public customer PDPA inputs, provider preflight, loading/error/button behavior, and absence of new dependencies.
Next: Deploy an immutable artifact to authorized staging, repeat the real mobile LINE/LIFF journey, and close U-07 only with LINE console/redirect/token-revocation/provider-log evidence.
