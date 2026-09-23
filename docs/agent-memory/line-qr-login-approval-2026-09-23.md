# Agent Memory: LINE QR desktop login approval

Status: Isolated local fix verified; live environment not deployed or retested.
Owner: Codex
Scope: The phone confirmation step for desktop LINE QR login.
Decisions: `POST /v1/auth/line/qr/approve` was authenticated but lacked permission metadata, so `DenyByDefaultGuard` returned 403 after `AuthGuard` succeeded. Require `account.session.read`, the existing permission for self-session routes. Keep the endpoint authenticated and preserve the existing inactive-account and QR expiry checks.
Open questions: None for the local fix. Live acceptance requires a release and a fresh phone-to-desktop QR check.
Artifacts: `apps/api/src/modules/auth/presentation/auth.controller.ts`; `apps/api/src/modules/auth/line-web-qr.spec.ts`.
Verification: `pnpm exec tsx --test src/modules/auth/line-web-qr.spec.ts` from `apps/api` — 13 passed, 0 failed. After `pnpm exec prisma generate`, `pnpm --filter @watchdog-bms/api typecheck` passed. `git diff --check` passed. The test exercises the actual `DenyByDefaultGuard` and controller metadata, including refusal without the permission.
Next: Release under `docs/runbooks/uat-production-v2-deployment.md` only after the current UAT host-provenance hold in `docs/runbooks/cloud-environment-operations.md` is reconciled and the live Production owner/legal gate is satisfied. Then confirm one real linked LINE account can approve a fresh desktop QR and reach the expected web page.
