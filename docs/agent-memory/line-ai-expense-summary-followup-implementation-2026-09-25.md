# Agent Memory: LINE AI expense summary follow-up implementation, 2026-09-25

Status: Implemented and verified on the develop-derived integration tree. Not deployed and not tested with live LINE/UAT.
Owner: Codex
Scope: `docs/specs/line-ai-expense-summary-follow-up-spec-th.md` and its E2E simulation; implementation spans API, Gateway, AgentCore contract, tests, plan, and status docs.

Decisions:
- Follow `.agents/skills/ponytail/SKILL.md` in full mode; the external path in AGENTS.md was stale.
- Prior-result confirmation uses an API-derived non-monetary expense descriptor attached only after a successful delivery. It binds chat, company/user/membership/current access, exact period and branch scope, successful API tool evidence, status basis and truncation state. It stores no amount.
- Criterion-only confirmations use fixed API-approved wording and a read-free access proof. Any read authorization key must parse and verify; malformed read proof cannot fall back to access-only proof. A separate presentation/source label is rejected for this path.
- Refreshes use the existing ERP permission-checked read. Gateway never accesses the ERP database.
- All enabled Gateway paths either validate complete period/branch inputs or fail closed. No-provider fallback does not call an expense tool with `{}` for explicit periods, branch scope, inherited context, or unsupported month text; mixed turns may still execute safe non-expense reads.
- The orchestration-off deterministic path checks expense permissions and entitlements for fixed read-free criterion replies; it can serve generic or validated current-month summaries through the existing `expense.list_recent` tool. It clarifies explicit non-current periods, branch/inherited ambiguity, unsupported filters, incomplete multi-month mentions, and detail/status/list queries; mixed sales or tax text is never converted to an expense-only summary.
- A branch-only follow-up reuses every verified prior period and branch; `ทุกสาขา` is an explicit override that omits `branchId` and stays within current ABAC scope. Short ASCII branch codes require whole-token evidence.
- Mixed sales and expense turns strip the expense read for criterion confirmation or unsupported/unclear filters, keep the independent sales route, and append only a fixed expense rule/clarification when the caller has expense access. If the router proposes only the expense tool, Gateway retries routing on the isolated non-expense question. Sales-only wording is never used to infer an expense criterion, unsupported filter, or uncertain filter even when prior expense context exists; the API independently rejects mixed text for read-free proof.
- A misspelled status filter such as `ค่าใช้จ่ายไม่รวมรายการปฎิเสด`, or an exclusion with an unrecognized target such as `ค่าใช้จ่ายไม่รวมค่าขนส่ง`, asks which records to include/exclude before any summary call. Unknown text after `เฉพาะ` also clarifies unless it is a recognized period or branch scope; month-like Thai text is not reclassified as a branch. Supported current-month phrasing such as `เอาเฉพาะสิงหาคม` is not treated as an uncertain status filter. One-status confirmation phrasing is accepted when it clearly refers to expense, or when a verified prior expense result supplies context.
- Thai branch names retain combining marks in request matching. A grounded user name/code may resolve to a different API branch UUID; the API result ID is authoritative internally, and LINE text shows only user-provided human wording (or asks selection on the web for ambiguous/unresolved branches).
- Expense replies use validated Thai month/date labels and derive as-of from the tool instant in Asia/Bangkok, rendered in พ.ศ.; the prepared default-current-month path uses the tool's effective period even when there is no selected period candidate. Prepared reply cards carry the exact final reply text.
- Do not edit package.json; preserve the user's existing untracked specs/research and pycache artifacts.

Open questions / residual risks:
- Expense list pagination uses separate page reads and count queries, without a shared database snapshot. `truncated=false` rules out hitting the page cap but cannot guarantee a transactionally consistent aggregate during concurrent inserts/status changes.
- Full webhook → hosted AgentCore → ERP → LINE adapter E2E, live LINE/UAT, and deployment remain unrun.

Artifacts:
- Spec: `docs/specs/line-ai-expense-summary-follow-up-spec-th.md`
- Simulation: `docs/research/line-ai-expense-summary-followup-e2e-simulation-2026-09-25-th.md`
- Plan: `docs/plans/line-ai-expense-summary-followup-implementation-plan-th.md`
- Service proof tests: `apps/api/src/modules/line-ai/application/line-read-evidence.spec.ts`
- Gateway end-to-end agent-loop cases: `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`

Verification:
- `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts src/modules/line-ai/agents/orchestrator.agent.spec.ts src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts src/modules/line-ai/agents/orchestrator-native-loop.agent.spec.ts src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts src/agentcore/runtime.spec.ts` — 239/239 passed. Includes mixed sales+expense criterion, unsupported/uncertain filters, sales-only status wording with prior context, expense permission denied, expense-only router recovery, misspelled month/status fail-closed, resolved Thai branch names, duplicate/unresolved branch messages, and prepared/full current-month replies with a Bangkok date across the UTC date boundary.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` — passed after the final formatter changes.
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/line-read-evidence.spec.ts src/modules/line-ai/application/use-cases/erp-expense-list-recent.use-case.spec.ts src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts` — 84/84 passed; includes Thai branch name → resolved branch ID evidence proof.
- `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — 346/346 passed.
- `pnpm --filter @watchdog-bms/api typecheck` — passed on 2026-09-25 after the two unrelated counterparty type errors were corrected separately.
- `git diff --check` — passed.

Next:
- Independent diff review complete. No deployment was performed. A live LINE/UAT run is still needed before claiming the production behavior is fixed; retain the pagination snapshot risk above in that handoff.

## Integration with current develop (2026-09-26)

- Ported the LINE implementation onto the latest `develop`, retaining its newer Thai/numeric month handling. Multi-month completion now carries only a branch grounded in the message or verified prior context, and does not repeat a failed expense read.
- Kept the current counterparty owner decision D8: whoever added the row can edit it. The separate email fix sends a blank field as `null` through web, API DTO, and create/update input so it clears the stored value.
- Verification on the integrated tree: contracts build; API, AI Gateway, and web typechecks; focused Gateway, LINE API, counterparty API, and counterparty web tests; `git diff HEAD --check` all passed.
- The owner will deploy. No UAT, Production, cloud service, or customer gate was changed in this integration.

## Post-merge read-failure guard (2026-09-26)

- A second-month tool result with an inconsistent count or echoed period could previously be treated as a usable partial read. An echoed-period mismatch could also trigger an unnecessary second request for the same month.
- Multi-month completion now stops on a failed or internally inconsistent read. Verified months retain their amounts; the affected month is labelled `ยังดึงข้อมูลได้ไม่ครบ` as required by the period-resolution spec. A forbidden read suppresses all partial amounts.
- Focused Gateway tests cover a failed second month, inconsistent count, mismatched echoed period, and a forbidden second-month read. No live LINE/UAT or deployment was performed.
- Verification: `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/orchestrator.agent.spec.ts src/modules/line-ai/agents/orchestrator-model-loop.agent.spec.ts` — 90/90 passed; `pnpm --filter @watchdog-bms/ai-gateway typecheck` and `git diff --check` passed.
