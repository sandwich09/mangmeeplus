# Agent Memory: CHAT credit exhaustion messages and readiness

Status: Complete; focused API tests, web typecheck, and the isolated admin E2E pass. API typecheck has one unrelated existing error.
Owner: Codex
Scope: CHAT-scope LINE refusal copy and durable reclaim, SHARED admin readiness display, and one partner-console E2E. No billing service/reconciler or price-floor changes.
Decisions:
- A standard package change cannot refill a company's CHAT allowance in the same Bangkok month, so CHAT-scope messages must not promise that it lets the shop continue that month.
- Keep the existing TOTAL-scope copy and actions. Use the existing staff-contact command for CHAT-scope review of special deal rights.
- Ledger-reclaimed refusals must retain explicit CHAT scope. Continue accepting old code-only markers so already saved delivery records can still be integrity-checked.
- Under SHARED, report CHAT readiness from its own cap and bucket usage even if TOTAL is already exhausted by other AI use.
Open questions: None identified for this bounded fix.
Artifacts: `docs/specs/ai-chat-credit-default-80-spec-th.md`; `docs/plans/ai-chat-credit-default-80-plan-th.md`; `e2e/system-admin.spec.ts`.
Verification:
- Focused API tests passed for LINE business card copy, combined LINE regression, ledger reclaim, readiness/meter, and signup trial alerts.
- `corepack pnpm --filter @watchdog-bms/api typecheck` reports only the unrelated existing `counterparty.controller.ts:128` DTO incompatibility.
- `corepack pnpm --filter @watchdog-bms/contracts build && corepack pnpm --filter @watchdog-bms/web typecheck` passed.
- Playwright `--list` finds the admin readiness case; it passed against the seeded preview DB on `localhost:15432` using isolated ports `3020/3021`.
- The standard `e2e/run-local.sh` preflight still cannot run against its default `localhost:5432` because that PostgreSQL is down. The isolated E2E does not write budget state; the first request is mocked to fail, retry reads the seeded endpoint with deterministic budget values, and the optional holds route is mocked unavailable.
- `git diff --check` passed for the scoped API, web, docs, and E2E changes.
- PR CI exposed older CHAT-cap test fakes that lacked the bucket-usage delegate. The CRM, draft, and LINE gateway fixtures now provide zero settled CHAT spend for their under-budget cases; the focused suites pass. The new deal-credit spec is listed in the whole-chain runner, and the new billing buttons expose `aria-busy` while fetching a quote.
Next: Local handoff is ready. `apps/web/next-env.d.ts` was checked after all E2E runs and is clean.
