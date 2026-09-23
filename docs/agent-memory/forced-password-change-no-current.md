# Agent Memory: forced-password-change-no-current

Status: Complete
Owner: Codex
Scope: Remove redundant current-password input only from password-verified forced changes; retain it for voluntary, LINE, and stale-session paths.
Decisions:
- A `mustChangePassword` flag alone is not a password proof. `AuthSession.passwordCredentialVersion` must equal the live credential version before the API permits an omitted current password.
- The forced UI has new-password and confirmation fields. The voluntary UI has current-password, new-password, and confirmation fields.
- Partner-member reset now revokes sessions atomically because a stale session must not survive the credential reset.
Open questions: None.
Artifacts:
- `docs/plans/forced-password-change-no-current-plan.md`
- API migration `20260923110000_forced_password_change_session_proof`
Verification:
- `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/auth/auth-endpoints.spec.ts src/modules/auth/presentation/auth.controller.spec.ts src/modules/system-partner-management/application/use-cases/partner-member-console.use-cases.spec.ts` — 86 passed, 1 PostgreSQL integration test skipped.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/auth/auth.api.spec.ts apps/web/src/features/auth/ChangePasswordPage.spec.ts apps/web/src/common/auth/change-password-bff.server.spec.ts apps/web/src/common/auth/session-gate.logic.spec.ts` — 55 passed.
- `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/web typecheck` — passed.
- `pnpm exec playwright test e2e/line-recovery.spec.ts e2e/legal-acceptance.spec.ts e2e/sales-console.spec.ts e2e/settings.spec.ts --list` — 29 updated browser tests discovered; no local app/database was started for a live browser run.
Next: Deploy the additive migration with the API and web change in the same release; no live environment action was performed.
