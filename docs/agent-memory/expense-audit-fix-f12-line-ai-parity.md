# Agent Memory: expense-audit-fix F12 (LINE-AI parity)

Status: implemented, verified, uncommitted.
Owner: —
Scope: `docs/plans/expense-audit-fix-plan.md` F12 only — (a) `reimbursement.list_pending_approvals`
permission + scoping, (b) `expense.list_recent` summary semantics, (c) LINE webhook identity
channel scoping. F1–F11, F13–F16 untouched.

Decisions:

- (a) The approval queue is approver-scoped, not a company read. The tool now requires
  `reimbursement.approve` and delegates to `ListApprovalQueueUseCase` (the same use case the web
  queue calls), so branch scope and approver eligibility come from one place instead of a direct
  `PrismaReimbursementRepository.listRequests` call. `ListApprovalQueueUseCase` is now exported
  from `ReimbursementsModule`. Wire shape of `data.items` is unchanged.
- (b) `draftAmount` was kept as the DRAFT-only figure and `pendingAmount` added for the full
  `EXPENSE_PENDING_STATUSES` set, rather than redefining `draftAmount`. Reason: the only non-test
  consumer is `apps/ai-gateway` (a separately deployed app that ships after `api-web` in the
  rollout wave), and `formatMoney(undefined)` renders `0.00` — a renamed key would have printed a
  fabricated zero over LINE during the skew window. `pendingAmount + confirmedAmount ===
  totalAmount` holds for every status, so the buckets now account for the whole counted total.
- (b) `data.total` is now `summary.countedItems` (non-cancelled). It previously carried the raw
  repository count, so the headline disagreed with every money figure under it;
  `summary.cancelledCount` still reports what was excluded.
- (b) The page loop is capped at `EXPENSE_PAGE_CAP = 10` pages of 100; `data.truncated: true` is
  emitted only when the cap actually bites.
- (c) `resolveLineIdentity` is one private helper used by both the text and the receipt-upload
  entry paths (both had the same unscoped lookup). Exact `providerChannelId` match first, then a
  channel-agnostic fallback with a `line_identity_channel_agnostic_fallback` warn — the documented
  pattern from `dashboard-notifications/.../notification.use-cases.ts`. Backward compatible with
  identities linked before the channel id was recorded.

Open questions: none.

Artifacts:

- `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.ts`
- `apps/api/src/modules/reimbursements/reimbursements.module.ts` (export `ListApprovalQueueUseCase`)
- `packages/contracts/src/ai-tools.ts` (`requiredPermissions: ['reimbursement.approve']`)
- `apps/api/src/modules/line-ai/application/use-cases/erp-tools.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/accounting-summary.agent.ts` (fact label 'รอตรวจสอบ')
- `apps/ai-gateway/src/modules/line-ai/agents/line-ai-feature-coverage.ts` (manifest row permission)
- Specs: `erp-reimbursement-tools.use-case.spec.ts`, `erp-expense-list-recent.use-case.spec.ts`,
  `process-line-webhook.use-case.spec.ts`, gateway `orchestrator.agent.spec.ts`,
  `business-read-result-semantics.spec.ts`, `orchestrator-smoke.ts`
- Docs: `docs/specs/line-ai-business-query-coverage-spec.md`,
  `docs/specs/line-ai-read-only-assistant-spec.md`

Verification (2026-08-05):

- `pnpm --filter @watchdog-bms/api test:line-ai-business-coverage` — 192 pass / 0 fail (was 189;
  +3 new webhook channel-scoping tests, no expectation weakened).
- `pnpm --filter @watchdog-bms/ai-gateway test:line-ai-business-coverage` — 371 pass / 0 fail.
- Full `apps/api` suite — 4189 pass / 0 fail. Full `apps/ai-gateway` suite — 518 pass / 0 fail.
  `packages/contracts` — 90 pass / 0 fail.
- `pnpm --filter @watchdog-bms/api test:boot` — Nest resolved every provider (confirms the new
  `ListApprovalQueueUseCase` injection).
- `tsc --noEmit` clean for `api`, `ai-gateway`, `contracts`.

Next: commit (not done in this session), then the plan's remaining fixes.
