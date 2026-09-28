# Agent Memory: line-ai-private-grant-narrowing-deadline-2026-09-27

Status: implementation and focused verification complete; awaiting combined candidate freeze
Owner: `/root/sol_delivery_integrity`, with root review before candidate freeze
Scope: Preserve the authenticated original private admitted deadline during post-intake lane narrowing and report authoritative expiry truthfully, without widening calls, cost, permissions, or retry authority.
Decisions: Durable signed authority is the source of deadline truth. Narrowing retains exact stored absolute work/final deadlines and changes only profiles, slots, durable cursor, and signature. Private lane 10/15/30-second values are latency objectives after paid intake; the admitted envelope is the hard cutoff. Direct public-general and QA contracts stay unchanged.
Open questions: None for implementation. The later real-model acceptance run remains Luna/root-owned.
Artifacts: `docs/specs/line-ai-private-grant-narrowing-deadline-spec-2026-09-27.md`; `docs/plans/line-ai-private-grant-narrowing-deadline-plan-2026-09-27.md`.
Verification: `pnpm --dir apps/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts` passed 18/18. `AI_BUDGET_RESERVATION_TEST_DATABASE_URL=<private localhost:15439/watchdog_delivery_integrity_test_20260927> pnpm --dir apps/api exec tsx --test src/modules/line-ai/application/line-ai-budget-authority.pg.spec.ts` passed 13/13 against the isolated database with the repository's 256 migrations; no fixture/evidence database was changed. `pnpm --dir apps/api typecheck` passed. The client returns the authority service narrowing promise directly, so the typed expiry error reaches the webhook mapping.
Next: Root freezes the combined reviewed delivery, catalog, and deadline candidate. The later real-model Starter acceptance run remains Luna/root-owned.
