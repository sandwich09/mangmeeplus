# Agent Memory: Attachment upload presigned endpoint fix

Status: COMPLETE
Owner: Codex
Scope: Port the reviewed AWS CSP fix, add self-hosted storage CSP/presigning support, wire local compose, and translate browser network upload failures.
Decisions:
- Kept the three §A files byte-identical to `origin/develop` before layering the separate §B additions.
- `S3_PUBLIC_ENDPOINT` is optional; presigning uses `s3PublicEndpoint || s3Endpoint`, while server-side storage operations keep the original client.
- The shared direct-to-storage uploader translates only `TypeError`; non-network failures are unchanged.
- No MinIO CORS rule was added without evidence that MinIO rejects the preflight.
Open questions: None.
Artifacts:
- `apps/web/proxy.ts`
- `apps/web/src/common/security/security-headers.logic.ts`
- `apps/web/src/common/security/security-headers.logic.spec.ts`
- `apps/web/src/features/expenses/expenses.api.ts`
- `apps/web/src/features/expenses/expenses.api.spec.ts`
- `apps/web/src/features/reimbursements/reimbursements.api.ts`
- `apps/web/src/features/tax/transaction-tax.api.ts`
- `packages/config/src/index.ts`
- `packages/config/src/index.test.ts`
- `apps/api/src/common/config/app-config.service.ts`
- `apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.ts`
- `apps/api/src/modules/data-model-core/infrastructure/storage/s3-storage.adapter.spec.ts`
- `infra/docker/compose.local.yml`
- `docs/specs/platform-environment-config-spec.md`
- `docs/specs/platform-foundation-local-prod-lean-spec.md`
Verification:
- Focused CSP spec: 8 passed, 0 failed.
- Focused upload-helper spec: 4 passed, 0 failed.
- Focused S3 adapter spec: 14 passed, 0 failed.
- Config package tests: 100 passed, 0 failed.
- Compose config validation: passed.
- Before §B, all three §A worktree blob hashes matched `origin/develop` (`0bfd212`) exactly; the final branch diff contains only the intentional §B helper, wiring, and specs.
- Required API command: sandbox `tsx` IPC launcher failed before tests with `listen EPERM`; the identical registered corpus passed via `node --import tsx`: 2,754 passed, 0 failed.
- Required web test command: sandbox `tsx` IPC launcher failed before tests with `listen EPERM`; the identical globbed corpus passed via `node --import tsx`: 487 passed, 0 failed.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `corepack pnpm --filter @watchdog-bms/web build`: default Turbopack remained alive without output or artifact progress and was stopped; the supported `next build --webpack` production build passed.
- Required config command: sandbox `tsx` IPC launcher failed before checks with `listen EPERM`; `node --import tsx scripts/validate-prod-config.ts` passed 37 of 37.
- Task-file `git diff --check`: passed.
Next: Owner manual check with a running compose stack: upload and download an attachment, confirming storage requests return successfully.
