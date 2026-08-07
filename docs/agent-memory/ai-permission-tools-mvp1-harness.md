# Agent Memory: AI Permission Tools — MVP1 Split-Engine Harness

Status: HARNESS DEFINED; P0a starting. Reviews complete (Codex 5.6 + Claude 17-agent workflow, both CONFIRM the ledger).
Owner: thawatchai (2026-07-12: scope to MVP1 tools/agents — expense, เบิก, ใบเสร็จ, CRM, จอง, ลูกค้า; "งานไหนที่แบ่ง parallel ได้ให้แบ่ง agent ไปทำขนานกัน").
Scope: MVP1 subset of [[plans/ai-permission-tools-production-gap-closure-plan]] (see "Owner-approved MVP1 scope cut" section). Full non-MVP1 gaps deferred.

## Engines and roles

- **Coordinator = this Claude session (main worktree).** Owns choke points, applies contract/registry/schema/provider/test-list edits serially, does surgical git staging (NEVER `git add -A` — shared dirty tree), runs gates, commits. Also runs the serialized CRM lane in the main tree.
- **Codex CLI (gpt-5.6-sol, xhigh)** — workspace-write lanes in isolated git worktrees for non-CRM areas. Invoked with `</dev/null` from background Bash (stdin-hang trap), `-o <file>` for last message, `-s workspace-write`.
- **Claude subagents (Agent tool, `isolation: "worktree"`)** — write lanes for non-CRM areas needing Claude.
- **Cross-review**: every lane's diff is reviewed by the OTHER engine (read-only) before the coordinator stages it. Codex lanes reviewed by a Claude verify agent; Claude lanes reviewed by `codex exec review` or a codex read-only pass. Reviewers comment/report; they do not patch the author's tree.

## Dirty-tree handling (decisive)

The worktree is DIRTY with ~40 uncommitted files from a concurrent "customer identity management" session (22 crm-inbox, 6 crm, dashboard, config, migration, package.json). Established project precedent (mvp1-p1-p2 harness): do NOT touch another session's WIP hunks; surgical-stage only our own hunks per file.

- **Isolated worktrees are created from HEAD** and therefore LACK the uncommitted WIP. The dirty WIP already added `withLiveCustomerLock` around the autonomous send (part of CUST-03). So the **CRM/CUST lane MUST run in the main dirty tree, serialized** — an isolated worktree would lose that WIP and conflict on merge.
- **Non-CRM lanes (SEC/gateway, receipt-API, tool-catalog)** touch files that are CLEAN at HEAD, so they run safely in isolated worktrees in parallel.
- Choke-point files are edited ONLY by the coordinator; lanes submit exact requested edits.

Clean-at-HEAD files the lanes rely on: `schema.prisma`, `crm-booking.use-case.ts`, `crm-booking.logic.ts`, `customer-line-register.use-case.ts`, `crm-inbox.module.ts`, all of `apps/ai-gateway/**`, all of `apps/api/src/modules/line-ai/**`, all of `apps/api/src/modules/expenses/**`, `packages/contracts/**`, `permission-registry.ts`.
Dirty (coordinate / serialize): `process-inbound-line-message.use-case.ts`, `crm-ai-auto-reply.use-case.ts`, `crm-ai-context.repository.ts`, `prisma-crm-inbox.repository.ts`, `prisma-crm.repository.ts`, the crm/crm-inbox use-case set, `apps/api/package.json`, `.env.example`, `packages/config`, the crm migration.

## Coordinator-owned choke points (only coordinator edits)

`packages/contracts/src/ai-tools.ts`; `apps/api/src/modules/auth/permission-registry.ts`; `apps/api/prisma/schema.prisma` + migration timestamps; `internal-tools.controller.ts` binding map; API+Gateway `line-ai.module.ts`; `crm-inbox.module.ts`; root `app.module.ts`; shared internal-auth guards; module provider arrays; `apps/api/package.json` test list; deployment/env/IAM; canonical docs/checklist/roadmap/memory; generated Prisma client refresh.

## Lane split (MVP1)

| Lane | Engine | Isolation | Gap IDs | Exclusive files (non-choke) |
|---|---|---|---|---|
| Coordinator | Claude (this session) | main | all choke edits, P0a, P1 schema/contracts, merges, gates | choke list above |
| L-SEC | Codex | worktree | SEC-01, SEC-02, SEC-03, SEC-04, SEC-06 | `apps/ai-gateway/src/agentcore/**`, `runtime.port.ts`, `agentcore-runtime.client.ts`, `line-ai-turn.use-case.ts`, gateway internal controllers + guards; API `internal-tools.controller.ts` behavior via coordinator; `process-line-webhook.use-case.ts` lineage-persist hunks |
| L-RCPT | Codex | worktree | RECEIPT-01, RECEIPT-02, RECEIPT-05, RECEIPT-06 (+ RECEIPT-04 negative tests) | `apps/ai-gateway/src/modules/line-ai/agents/receipt-*.agent.ts` (delete), `orchestrator.agent.ts` (remove branch), `erp-tool.client.ts` blocklist; API `expenses/**` intake durability, `process-line-webhook.use-case.ts` receipt hunks |
| L-TOOL | Claude subagent | worktree | TOOL-01, TOOL-03, TOOL-04, TOOL-06, OPS-01(mvp1) | `erp-tool.client.ts` accounting unblock, `accounting-summary.agent.ts`/`inventory.agent.ts` allowlists (MVP1 tools), new reimbursement + crm-followup source adapters in API line-ai tools use-cases; parity test |
| L-CUST | Claude (this session, serialized) | main | CUST-01..11 | `process-inbound-line-message.use-case.ts`, `crm-ai-auto-reply.use-case.ts`, `crm-booking.use-case.ts`, `scan-crm-booking-reminders.use-case.ts`, `retry-crm-inbox-deliveries.use-case.ts`, `customer-line-register.use-case.ts`, `prisma-crm*.repository.ts` — surgical staging |
| Integration | Coordinator + opposite-engine review | main | RECEIPT-03, OPS-04/05, E2E, canary | e2e specs, runbooks, gates |

Choke coupling: L-RCPT + L-TOOL both need `ai-tools.ts` and `permission-registry.ts` → coordinator applies those edits between their worktree runs. L-SEC + L-TOOL both touch `erp-tool.client.ts` → serialize those two on that file (SEC does not edit it; only reads — so no real conflict, but coordinator confirms).

## Standard commands (Node via nvm; DB traps in [[project_local_db_env_trap]])

```bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"
CI=true corepack pnpm --filter @watchdog-bms/contracts build
CI=true corepack pnpm --filter @watchdog-bms/api test        # hand-maintained spec list — register new specs in apps/api/package.json
CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test
CI=true corepack pnpm --filter @watchdog-bms/api typecheck
CI=true corepack pnpm --filter @watchdog-bms/ai-gateway typecheck
git diff --check
```
Codex lane invocation: `codex exec -m gpt-5.6-sol -c model_reasoning_effort=xhigh -s workspace-write -o out.md "<prompt>" </dev/null` inside the lane worktree.

## Traps carried from prior harness rounds

- Never `git add -A`; surgical index staging (hash-object + update-index) per hunk-attributed file.
- `codex exec` from background Bash with heredoc hangs on stdin → always `</dev/null`.
- New API spec silently never runs unless registered in `apps/api/package.json` test list ([[project_api_test_explicit_spec_list]]).
- e2e DB on :5432 must be re-seeded after seed changes; local real DB = docker 15432 ([[project_local_db_env_trap]]).
- No concurrent typecheck; codex-hang watchdog.
- Keyword-grep contamination scans are insufficient — the adversarial cross-review is what catches seed/schema contamination.

## Open items

- Owner policy decision: UNKNOWN-consent auto-send default vs CRM LINE OA spec §28 (blocks C3 accept).
- Full workload-identity/grant rotation (SEC-02 full) deferred past MVP1.

## Wave 1 landed (2026-07-12) — uncommitted, verified, cross-reviewed

Three concurrent writers on disjoint clean-at-HEAD files (2 Codex lanes + coordinator), no worktree needed (Codex does not stage/commit; coordinator stages surgically).

- **SEC-02/SEC-03 (coordinator, Claude)** — `internal-tools.controller.ts` re-resolves authoritative permissions/scope from DB via `PermissionResolverService.resolveAccess(userId, companyId)`, ignores caller-supplied `permissions/branchIds/roles/company`, requires `ai.tool.invoke` at the execution boundary, builds a fresh `ErpToolContext` for `tool.execute` + audit. Spec rewritten as red→green (caller-supplied perms ignored; DB perms authoritative). Confirmed the gateway sends `userId: req.userContext.internalUserId` (internal id, resolver-resolvable) → does NOT break prod tool calls. Residual (deferred): shared-secret still fronts the route; a secret holder can still target a real member's userId+company (full workload identity = later A1).
- **SEC-01/SEC-04 (Codex lane L-SEC)** — AgentCore payload now carries `membershipId/branchIds/locationIds/roles`; runtime returns real tool `name/status/duration` + aggregate `sourceRefs/webLinks`; adapter maps lineage into `toolsInvoked/sourceRefs`; missing lineage arrays rejected as malformed (empty ≠ missing). REVIEW NOTES (non-blocking, AgentCore ERP path is OFF in prod): (1) the deliberate `// Never expose raw sourceRefs with entityIds` guard was removed — bound sourceRefs (drop entityId) before enabling AgentCore lineage in prod; (2) `sha256: ''` still hardcoded for AgentCore attachments (defeats dedup) — fix before AgentCore attachment path is live.
- **RECEIPT-01 (Codex lane L-RCPT)** — deleted `receipt-ocr.agent.ts` + `receipt-authenticity.agent.ts`, removed the dead orchestrator receipt branch, trimmed `UNIMPLEMENTED_TOOLS` to just `accounting.get_summary`. Coordinator removed the 4 `receipt.*` metas from `ai-tools.ts` (also closed the non-canonical `expense.receipt.read` orphan → TOOL-04 half). OCR capability untouched (deterministic API pipeline + gateway `/internal/ai/receipt-ocr`).
- **Coordinator hygiene (OPS-05 partial)** — `.gitignore` now excludes `apps/web/.next-customer-build/` + `.next-customer-final-build/`. FLAGGED (not fixed — others' dirty hunks / persistent config): `apps/api/package.json` registers nonexistent `expense-branch-scope.spec.ts` (real: `.use-case.spec.ts`); committed CRM migration edited in place (drift risk); CI skips `develop` branch.

Gates (serial, after both lanes done): contracts build clean; ai-gateway typecheck clean + test 336/336; api typecheck clean; internal-tools.controller.spec 5/5. Cross-review: coordinator reviewed both Codex lanes (approved w/ notes above); Codex cross-review of SEC-02 = <pending, ba8yg7nm9>.

NOT committed (per "commit only when asked"). Surgical-stage set when asked: internal-tools.controller.ts(+spec), runtime.ts, line-ai-turn.use-case.ts, runtime.port.ts, agentcore-runtime.client.ts (+3 specs), orchestrator.agent.ts(+spec), erp-tool.client.ts(+spec), agent-tools.registry.spec.ts, deleted receipt-*.agent.ts, ai-tools.ts, .gitignore, + docs.

## Wave 2 landed (2026-07-12) — uncommitted, verified, cross-reviewed

- **TOOL-01 accounting (Opus lane L-TOOL)** — removed `accounting.get_summary` from `UNIMPLEMENTED_TOOLS` (now intentionally empty set); the tool now takes the normal policy+HTTP path like `sales.get_sales_summary` (API endpoint was already wired at `internal-tools.controller.ts:89` → `AccountingGetSummaryTool`). Spec updated to assert it reaches the POST path, not `unsupported_module`. FLAGGED for coordinator: `line-ai-turn.logic.ts:29` legacy keyword `classifyIntent` still maps Thai `บัญชี/งบดุล/กำไรขาดทุน` → `unsupported_module` on the NON-model deterministic fallback path (model router is correct); decide whether Thai accounting keyword should route to `read_summary`.
- **RECEIPT-02/06 durability (Codex lane L-RCPT-api)** — media idempotency via `expenseRepo.findByLineMessageId` before init (redelivery returns existing expense, no duplicate); atomic event claim `claimWebhookEvent` (unique-insert for new / CAS on `processedAt` for buffer-created `received` rows, P2002 losers stop, 2-min orphan-reclaim window) replacing the `find`-then-`create`-with-`.catch(()=>{})`; honest OCR statuses `OCR_EXTRACTED_NEEDS_REVIEW/NOT_CONFIGURED/OCR_FAILED/NOT_REQUESTED` (closes the dishonest NOT_CONFIGURED conflation); transient failures (media download, storage) `releaseWebhookEvent` keep `received`+clear `processedAt`+`RETRYABLE_*` → reclaimable, deterministic refusals stay terminal. Reviewed the CAS logic — correctly atomic under READ COMMITTED. FLAGGED for coordinator (schema/choke): add composite unique `(companyId, lineMessageId)` for fully-atomic cross-event-id media idempotency; add attempt-count ceiling for poison-event retry bound.

Gates: ai-gateway typecheck+test 336/336; api typecheck clean; api affected specs 81/81 (intake-dispatch + process-line-webhook + buffer + internal-tools controller). Cross-review: coordinator reviewed both lanes (approved w/ flags above).

## Owner decisions (2026-07-12) — resolved

- **Consent = keep §28 (opt-out).** Only `REVOKED` blocks; UNKNOWN/GRANTED/NOT_REQUIRED pass; missing row fails closed. Code already correct. C3 = make the REVOKED check atomic + reload channel/global at final boundary. NO consent-gating code change. Plan Implementation Default #7 superseded by §28.
- **Mixed receipt-media + question = clarify once.** Replace the `defer_text` silent-media-discard with a CLARIFY branch ("รูปนี้เป็นใบเสร็จหรือภาพประกอบคำถาม?"), route on reply. RECEIPT-05 (R1) does this; no spurious drafts, no lost receipts.

## Wave 1+2 committed: `db7d7e73` (29 files, surgical — zero foreign hunks)

## Wave 3 landed (2026-07-12) — in working tree, gating in progress

- **P1 schema (coordinator, Fable)** — additive migration `20260712200000_mvp1_ai_gap_closure_p1`: `AuditActorType` enum + `AuditLog.actorType/actorRefId` (CUST-01); `CrmBookingProposal` + status enum (CUST-02); `LineIntakePendingMedia` + status enum (RECEIPT-05); `CrmChannelAutoReplyUsage` (CUST-05 atomic cap); `@@unique([companyId, lineMessageId])` on ExpenseRecord with duplicate-guard DO block (RECEIPT-02 hard idempotency). Prisma validate + generate green. TRAP LOGGED: `prisma format` reformats the WHOLE file — it entangled hunks with the other session's WIP; fixed by rebuilding schema from HEAD + their 5 CRM model blocks + my 3 regions. NEVER run `prisma format` in this shared tree. Side effect: their CRM WIP models carry local column-realignment noise (semantics intact).
- **SEC-06 + CUST-06 (Codex L-BOUNDARY)** — `secret-compare.ts` (constant-time, length-guarded) used by both CRM worker-token controllers, internal-tools, and gateway `assertInternalSecret`; readiness `GET /internal/ai/agents` now requires the internal secret; `trusted-client-ip.ts` (last-XFF-hop) replaces the spoofable first-entry helpers in customer-line-register + auth controllers, api-rate-limit.guard refactored onto it. Reviewed both helpers — correct. CUST-07 full (private connectivity/rotation) deferred by scope.
- **TOOL-06 reimbursement (Codex L-REIMB)** — `ReimbursementListPendingApprovalsTool` (reimbursement.read, company-scoped, PENDING_APPROVAL, ≤10 redacted items + total, no bank data; company-wide visibility matches web approval queue — evidence reimbursement-approval.use-case.ts:28). Coordinator wired: line-ai.module imports + erpTools, controller param + toolMap (spec stubs 28→29), router ENABLED (disabled set now 6), accounting specialist allowlist + Thai fact label. crm.suggest_sales_followups stays disabled (dirty tree).
- **package.json (working tree ONLY — do NOT commit yet)**: fixed their broken registration (`expense-branch-scope.spec.ts` → real `.use-case.spec.ts`) + registered 5 new specs. The test-list line also carries the OTHER session's edit (prisma-crm.repository.spec.ts, whose file is THEIR untracked WIP) — committing this line now would break a clean checkout. Commit package.json only in the joint close-out with their WIP.
- **RECEIPT-05 (Opus L-RCPT5)** — clarify-once branch per owner decision: persist bytes w/o draft + `LineIntakePendingMedia` PENDING + clarify reply; follow-up text resolves RECEIPT (draft from stored attachment) / ILLUSTRATION (answer stored caption) / ambiguous falls through. <status: in flight>

Gates so far: ai-gateway typecheck + 338/338; api boundary/reimb/controller/registry specs 32/32. api typecheck + full intake specs pending L-RCPT5.
Next: gate L-RCPT5 → codex cross-review of Claude-side wave-3 → surgical commit wave 3 (owner ok pending) → L-CUST big slice (CUST-01/02/03/04/05/09/10/11 — needs CRM WIP ownership resolution) + CUST-08 PDPA + RECEIPT-03/04 + OPS-01 parity.
