# Agent Memory: user-facing-error-message-safety

Status: COMPLETE
Owner: Codex
Scope: Make every customer-visible web API failure resolve through reviewed code/message mappings or
a Thai actionable status/kind fallback; remove raw API `.message` display bypasses; protect persisted
workflow/delivery diagnostic surfaces; preserve strict API validation and existing toast ownership.

Decisions:
- `docs/specs/user-facing-error-message-safety-spec.md` is the task source of truth.
- A stable code mapping wins, followed by reviewed exact/pattern message mappings. An unknown
  API-shaped error fails closed to the canonical Thai status/statusCode/kind fallback.
- The prior unknown-server-message pass-through rule is superseded only for API-shaped errors.
  Reviewed non-API local UI copy remains unchanged.
- Raw message, validation arrays, code, details, and request id remain available for logic/support;
  customer renderers never display them directly.
- Both `status` and `statusCode`, plus existing API error kinds, are part of the display contract.
- The formerly reported 400 validation array now maps to the neutral fallback:
  `ทำรายการต่อไม่ได้ กรุณาตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง`.
  This supersedes the earlier screen/API-mismatch wording because an unknown 400 does not prove
  that cause.
- Direct API `.message` display bypasses across mounted web features are in scope. Non-display
  predicates may keep a narrow documented exemption.
- Persisted workflow/provider/delivery diagnostics use a reviewed code mapping or generic Thai
  workflow copy; stored raw data is not rewritten.
- `GLOBAL_VALIDATION_PIPE_OPTIONS`, DTOs, NestJS validation arrays, mutation-toast ownership,
  toast dedup/layout/a11y, and `suppressErrorToast` remain unchanged.
- Backend 5xx response/log hardening is a follow-up and outside this task.
- No dependency or `package.json` change is required.

Open questions:
- None blocking. If a useful unreviewed business sentence becomes too generic, add a reviewed mapping
  for its stable code/message; do not restore raw API pass-through.

Artifacts:
- Spec: `docs/specs/user-facing-error-message-safety-spec.md`
- Plan: `docs/plans/user-facing-error-message-safety-plan.md`
- Existing shared translator: `apps/web/src/common/api/api-error-message.ts`
- Existing mutation seam: `apps/web/src/common/api/authed-fetch.ts`
- Existing coverage: `apps/web/src/common/api/api-error-message.spec.ts`,
  `apps/web/src/common/api/api-error-coverage.spec.ts`,
  `apps/web/src/common/api/authed-fetch.spec.ts`, `e2e/toast-feedback.spec.ts`
- Incident reproduction: HTTP 400 NestJS validation body containing
  `message: ["property visibility should not exist"]` during substitute-receipt signing.

Verification:
- Docs-first audit completed 2026-08-15.
- The substitute-receipt upload-intent client no longer sends the server-owned `visibility` field;
  the signature upload/certification flow can advance to the approver step.
- Unknown API-shaped errors now fail closed through reviewed Thai status/kind copy while raw
  message, details, request id, and cause remain available for control flow and support.
- Shared clients cover fetch-boundary network errors, malformed 2xx JSON, temporary refresh
  outages, and stable error codes across legacy status branches.
- Mounted direct-message, persisted workflow/delivery, tax, banking, and ledger result-diagnostic
  display paths were migrated. The source guard covers caught errors and successful-result
  diagnostics with narrow browser-local exemptions.
- Duplicate mutation error toast ownership was resolved with existing `suppressErrorToast` at
  feature calls that intentionally own their custom toast.
- Full web unit suite passed: 925/925.
- Focused API DTO and substitute-receipt lifecycle tests passed: 29/29.
- Web typecheck and production build passed.
- Focused Playwright `TOAST-02` passed 1/1 against the exact NestJS 400 payload and asserted one
  Thai `role="alert"` with no raw `visibility`/validation text anywhere on the page.
- `origin/develop` at `2c0f1ed` was merged into branch `20260811` as `314a880`; the user's existing
  legal-acceptance worktree change was preserved.
- Local Docker images were rebuilt from the merged worktree. API, AI Gateway, Postgres, and Redis
  are healthy; web, workers, and MinIO are running, and the bucket initializer exited 0.
- Local `LegalDocumentActionRecord` was reset transactionally after E2E. Final verification is
  `rows=0`, `accepted_users=0`, and both immutability triggers enabled.
- `git diff --check` passed. No dependency or `package.json` change was made.

Next:
- Keep new API/customer diagnostics behind a stable code plus reviewed Thai mapping. The source
  guard and safe fallback prevent an unmapped diagnostic from becoming UI copy.
- Backend sanitization of unstructured 5xx `HttpException` and parser responses remains a separate
  defense-in-depth follow-up; it is not required for this web presentation fix.
