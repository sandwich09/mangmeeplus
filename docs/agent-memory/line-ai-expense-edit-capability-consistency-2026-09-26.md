# Agent Memory: LINE expense edit capability consistency

Status: Implementation and local verification complete; independent review and live UAT remain. No UAT/Production deployment; local code behavior changed.
Owner: thawatchai + Codex
Scope: Resolve the UAT contradiction between “ถ้าจะแก้ พิมพ์บอกได้เลย” and `unsupported_yet`; ensure capability answers are read-only and every supported LINE edit to an existing expense goes through preview then confirm.

Decisions:
- Owner confirmed 2026-09-26 that every supported LINE edit field, including date/vendor/document number/note, must preview and wait for the confirm postback before writing.
- LINE edit capability requires `expense.update`, the `expenses` feature entitlement, eligible same-user/same-chat candidate provenance, API edit flag, and effective Gateway/AgentCore serving flag. Unavailable capability probes fail closed.
- Capability-only questions do not write an intake/conversation turn, shadow telemetry, preview, clarification consumption, or apply audit. Existing webhook event/outcome logging remains.
- Pending media/clarification/draft/substitute work takes precedence; a capability-only message while state is pending returns a read-only wait reply without consuming it.
- API correction hints for date/vendor/document number/note append/amount use `LineDraftUpdateUseCase.preview`. Deterministic API detection handles charge and line changes; the Gateway tool catalog handles other line/VAT tools. Mixed tool requests ask for one change at a time.
- The legacy correction use case is non-writing even with flags off. LINE requires `expense.update`; web reviewer guidance can still use `expense.review`.
- Confirmed duplicate-sensitive updates take the company advisory lock before the write and reconcile duplicates in the same transaction. The final revision is re-read after reconciliation for applied-result replay checks.
- Notes append without replacing capture provenance. If the complete addition cannot fit the 500-character limit, preview refuses instead of showing truncated content.
- Follow-up scope completed: transport previewId as metadata through webhook → buffer → ledger → event for confirm/cancel; preserve button labels; reject old no-ID buttons and typed confirm/cancel without mutating the latest proposal. Atomic store claims prevent replacement during apply/cancel. Cancel rechecks `expense.update`, binding, branch/status and record revision.
- Follow-up scope completed: eligible vendor registry autosave occurs only after a LINE edit transaction commits. Registry failure cannot undo the expense; apply its outcome and final revision to the LINE confirmation/replay response. A link CAS failure is described as a link failure, not as a failed registry save.
- Follow-up scope includes the two API counterparty type errors and AI Gateway client test fixture failures. No package manifest or cloud/deploy changes.

Open questions / residuals:
- UAT must still run the three-turn LINE journey with aligned API/Gateway/AgentCore flags before claiming the UAT issue is resolved.

Artifacts:
- `docs/specs/line-ai-expense-edit-capability-consistency-spec-th.md`
- `docs/plans/line-ai-expense-edit-capability-consistency-plan-2026-09-26.md`
- `docs/specs/line-ai-capture-correction-spec.md` and `docs/specs/line-ai-draft-control-spec-th.md` superseded legacy audit/direct-write text.

Verification:
- Focused API batch covering controller/card/buffer/orphan replay/security/process webhook/Gateway client/counterparty registry and autosave use cases passed 561/561 at that checkpoint; it used `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot` over those specs. The security suite was rerun after adding cancel permission/revision coverage and passed 17/17.
- Draft security + SEC-04/vendor suite: `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts` — 17/17 pass after adding cancel permission/revision checks.
- Three-turn process webhook scenario passed 1/1 with typed confirm/cancel refused and only the card-bound preview id reaching apply; root independently reran the full process suite at 352/352.
- Transport/controller/card/buffer/orphan suite: root independently ran 132/132. Full AI Gateway client: 35/35, including the seven formerly failing budget/admission fixtures.
- `pnpm --filter @watchdog-bms/contracts build`, `pnpm --filter @watchdog-bms/api typecheck`, and `pnpm --filter @watchdog-bms/web typecheck` pass. Web counterparty notice spec passes 21/21.
- Focused Gateway/AgentCore suites: 230/230; `pnpm --filter @watchdog-bms/ai-gateway typecheck` passes.
- `git diff --check` passes. The eligible-vendor CREATE fixture sets `sourceReimbursementRequestId: null`, because the real autosave use case skips reimbursement-linked expenses. No deploy, cloud read, or live UAT was run.
- Rebased the scoped task onto `origin/develop` in a clean worktree, preserving the newer counterparty type and test behavior. On that base, contracts build, API/web/Gateway typechecks, the API webhook/security/Gateway-client tests, web counterparty notice tests, and Gateway turn/runtime tests pass. Prisma client was generated locally for the isolated checkout; no package manifest changed.

Next: Merge the scoped task into develop and main with the owner-authorized admin bypass of CI. Owner then performs the deployment-runbook-gated UAT three-turn acceptance after runtime flags are aligned and records the required run IDs/acceptance.
