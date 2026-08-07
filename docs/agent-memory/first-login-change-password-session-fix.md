# Agent Memory: First-login change-password session fix

Status: Implemented and unit-tested
Owner: Codex
Scope: Web auth BFF, forced change-password client call, focused unit test, plan
Decisions: Route forced password changes through `/api/auth/change-password`; the BFF reconstructs the httpOnly access-token cookie and sends explicit Bearer auth to ERP API.
Open questions: None.
Artifacts: `docs/plans/first-login-change-password-session-fix-plan.md`, web BFF route and forwarder test.
Verification: `corepack pnpm --filter @watchdog-bms/web test` passed 221/221. Web typecheck reached pre-existing unrelated CRM/contracts errors; no error references the files in this fix.
Next: Deploy and verify the new-register temporary-password journey on mangmeeplus.com.
