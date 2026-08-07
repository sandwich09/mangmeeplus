# Agent Memory: admin-receipt-web-upload

Status: Implemented and locally verified
Owner: Codex
Scope: Allow the protected `ADMIN` company role to upload receipt/bill evidence through the Expenses web workspace.
Decisions:
- Grant `expense.receipt.upload` to `ADMIN`; keep review, confirm, payment, and void permissions unchanged.
- Treat routine web/LINE receipt intake as an `ADMIN` capability equivalent to `OWNER`, without broadening owner-only or financial final-mutation permissions.
- Reuse the existing protected-role permission sync so existing company ADMIN roles receive the grant on deployment.
Open questions: None.
Artifacts:
- `apps/api/src/modules/auth/permission-registry.ts`
- `apps/api/src/modules/auth/permission-registry.spec.ts`
- `docs/specs/permission-matrix.md`
Verification:
- `corepack pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/auth/permission-registry.spec.ts` — 14/14 passed.
- `git diff --check` — passed.
Next: Deploy normally so permission sync reconciles existing ADMIN roles.
