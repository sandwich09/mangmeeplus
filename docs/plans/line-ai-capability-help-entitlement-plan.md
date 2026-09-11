# LINE AI Capability-Help Entitlement Implementation Plan

## Status

**Phases 1–4 implemented and locally verified 2026-08-19**; phase 5 (live UAT) open. Investigation and feasibility measurement completed the same day; the numbers this plan relies on are in the spec §4/§6/§7 and the harness output in [[agent-memory/line-ai-capability-help-entitlement|Agent Memory: line-ai-capability-help-entitlement]].

Owner decision 2026-08-19: **AC-6 is in scope and is a release gate**, so Q3 is closed — the AgentCore path is plumbed and phase 4 ships with the rest. Phases 1–4 are one release; there is no phase-1-only or phase-2-only ship, because a reply that is entitlement-honest on the local orchestrator path and not on the AgentCore path would be honest nowhere that runs today.

Q1 and Q2 were also closed on 2026-08-19 (revised receipt-permission proposal approved; both language tables in scope). **All three owner questions are answered — phase 0 is complete and implementation is unblocked.**

## Linked Spec

- Spec: [[specs/line-ai-capability-help-entitlement-spec|LINE AI Capability-Help Entitlement Honesty Spec]]
- Precedent this mirrors: [[agent-memory/line-menu-entitlement-gating|LINE staff menu feature-entitlement gating]] (menu + tool gate, 2026-08-15)
- Related: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]

## Purpose

Stop น้องมั่งมี from advertising capabilities the same turn would refuse. Measured today: 9 of 12 advertised capabilities are unanswerable, and 44 of 60 tools already refused, for a realistic expenses-only company.

## Phase 0 — Prerequisite (owner, no code)

- [x] Q1 receipt-capture permission — **owner 2026-08-19: approved the revised proposal.** Intake path's three permissions (`expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create`) ∧ `expenses.upload`, matching the menu camera button.
- [x] Q2 English parity — **owner 2026-08-19: in.** Both tables keyed by the same group ids (spec R7); mixed-language input measured and cannot yield mixed copy.
- [x] Q3 AgentCore payload plumbing — **owner 2026-08-19: in.** AC-6 is a release gate; phase 4 is mandatory.

**Phase 0 is closed. Implementation may start.**

## Phase 1 — Derivation logic in contracts (pure, no wiring)

Where: `packages/contracts/src/ai-tools.ts` (beside `toolFeatureKeys` / `hasToolFeature`, which it composes).

- [x] Add `LINE_CAPABILITY_GROUPS`: ordered `{ id, featureKeys, sourceModules? }[]` per spec §6.1. `sourceModules` was added during implementation for `reimbursements`, which carries no feature key by design. No copy in contracts — ids only, so the Thai/English wording stays in the gateway where every other user-facing string lives.
- [x] Add `usableCapabilityGroupIds(permissions, entitled)`: filter `LINE_TOOL_REGISTRY` by `hasToolPermissions ∧ hasToolFeature`, project onto groups via `toolFeatureKeys`, return ids in fixed order. `entitled === null` = fail-open, same sentinel as everywhere else.
- [x] Add the receipt-capture predicate (id `receipt_capture`): `expenses.upload` entitled ∧ any of `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create`. It is NOT derived from a tool — spec §10.1 measures that the intake path, not `accounting.capture_receipt_evidence`, is what actually runs, and that three shipped roles hold only `line_upload`.
- [x] Tests: AC-1..AC-7, AC-11 and the two grouping traps, over the REAL registry. They live in `feature-entitlements.spec.ts` rather than a new file because the contracts test script enumerates spec paths and `package.json` may not be edited for non-dependency changes.
- [x] Verify: contracts suite 137/137; `CI=true corepack pnpm --filter @watchdog-bms/contracts test` (baseline 121 passing).

Why contracts and not the gateway: the gateway must not become the second place that knows which feature owns which tool, and the API-side follow-up reply (phase 3) needs the same answer.

## Phase 2 — Gateway: entitlement-aware capability reply

- [x] `packages/contracts/src/line-ai.ts`: `LineAiTurnRequest.entitledFeatureKeys?: string[]` — optional, absent = legacy fail-open (spec §7). Additive; no existing caller breaks.
- [x] `response-composer.agent.ts`: `composeCapabilityHelp` takes the caller's permissions + entitled set, builds the reply from `usableCapabilityGroupIds`, keeps the fixed order (R1), picks the example question from a rendered group (R2), keeps the closing sentence (R3), and applies the R4 fallback when nothing is usable. Both languages.
- [x] `orchestrator.agent.ts:344-345`: pass `req.userContext.permissions` and `req.entitledFeatureKeys`.
- [x] Keep the TH and EN copy in two tables keyed by the same group ids (R7) — the derivation returns ids only, so the two tables can never render different group sets and no reply can come out half-translated.
- [x] `response-composer.agent.spec.ts`: AC-1..AC-9 and AC-12 at reply level, plus AC-8 leak assertions (no feature key, permission key, or tool name in either language).
- [x] Verify: `node_modules/.bin/tsx --test src/modules/line-ai/agents/response-composer.agent.spec.ts` from `apps/ai-gateway` (baseline 32 passing); `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test` (baseline 539); `tsc --noEmit`.

## Phase 3 — API: supply the entitlement set, fix the follow-up reply

- [x] `process-line-webhook.use-case.ts:1699-1710`: add `entitledFeatureKeys` to the turn request. `loadEntitledFeatureKeys` is already imported and `companyId` + `this.prisma` are in scope at that point; the existing `lineAssistantDisabled` call on the same turn reads the same rows, so fold them into one read rather than adding a second query.
- [x] `drain-line-ledger.use-case.ts:163-172`: same field on the ledger-replay turn request, so a drained turn cannot answer differently from a live one.
- [x] `line-ai-capability-follow-up.logic.ts`: `capabilityFollowUpReply` takes the same two inputs and renders from `usableCapabilityGroupIds` (R6). It runs inside the API, where both inputs are already resolved — no plumbing needed beyond the call site at `process-line-webhook.use-case.ts:1252-1254`.
- [x] Follow-up coverage (AC-9 plus the permission-poor case) added to `line-intake-dispatch.use-case.spec.ts`, which already exercises this branch end to end. A dedicated `line-ai-capability-follow-up.logic.spec.ts` was NOT created: the api test script enumerates spec paths and `package.json` may not be edited for non-dependency changes.
- [x] Verify: `node_modules/.bin/tsx --test` on the new + `process-line-webhook.use-case.spec.ts` (baseline 70) + `line-staff-menu.logic.spec.ts` (baseline 25); `CI=true corepack pnpm --filter @watchdog-bms/api test`; `tsc --noEmit` from `apps/api`.

## Phase 4 — AgentCore path (MANDATORY — owner decision, AC-6 release gate)

UAT and Production both run `LINE_AI_AGENT_RUNTIME=agentcore`, so this is the live path, not a fallback.

- [x] `apps/ai-gateway/src/agentcore/runtime.ts`: add `entitledFeatureKeys?: string[]` to `RuntimePayload` and carry it in `payloadToTurnRequest:245-267`. Absent stays `undefined` → fail-open, same sentinel as everywhere else, so an older runtime artifact invoked by a newer gateway degrades instead of throwing.
- [x] `line-ai-turn.use-case.ts:164+`: pass `req.entitledFeatureKeys` into `agentcoreRuntime.invoke(...)` beside `permissions`.
- [x] Checked before planning the rollout: the payload parser (`runtime.ts:200-242`) is a field-by-field allowlist with **no unknown-field rejection**, so an older artifact receiving the new field ignores it rather than failing the turn. `LINE_AI_RUNTIME_CONTRACT_VERSION` (`packages/contracts/src/line-ai.ts:94`, currently `1`) is reported as runtime identity and compared against `AGENTCORE_EXPECTED_CONTRACT_VERSION` at deploy — adding an optional field does not change it, so **no version bump and no binding-validation change is needed**.
- [x] **AC-6 test on both paths**: same caller, CRM-on / sales-off company — the local orchestrator path and a request rebuilt by `payloadToTurnRequest` must both omit the sales line. This is the assertion the release gate rests on.
- [ ] Rollout order (deploy step, not code): the runtime artifact must accept the field before the gateway starts sending it. Deploy AgentCore first, then the gateway — the field is optional in both directions, so a half-deployed pair only loses AC-6, never breaks a turn.
- [x] Verify: `CI=true corepack pnpm --filter @watchdog-bms/ai-gateway test`; `tsc --noEmit`.

## Phase 5 — Live verification

- [ ] On the reported UAT company: ask "ทำอะไรได้บ้าง" and confirm the reply names only enabled capabilities, and that the quick replies under it match line for line (AC-10).
- [ ] Ask the follow-up "อย่างไร" and confirm no dropped claim reappears (AC-9).
- [ ] Switch one feature on, repeat, confirm its line appears without a deploy.
- [ ] **AC-6 live, on the AgentCore path** (UAT runs `agentcore`, so this is the real gate): a company with `crm` on and `sales_documents` off must not show the sales line. If no such UAT company exists, toggle one temporarily via the partner entitlement command, capture the reply, and toggle back — record both states.
- [ ] Record the company, the entitlement rows, and both replies in the memory doc.

## Risk / Rollback

- Additive optional contract field; no migration, no data change, no permission change. Rollback is a revert of the composer change alone — the field can stay unread.
- The only user-visible regression risk is a reply that is too SHORT (a group hidden that should show). Every AC that pins a rendered line uses the real registry, so a wrong feature-key mapping fails a test rather than silently shrinking the reply in production.
- Fail-open is preserved end to end: unconfigured company, absent field, and older payload all keep today's text.


## Package access acceptance extension 2026-09-11

Use [package spec§9/§9.5](../specs/mangmee-package-entitlements-spec-th.md), [AP17–AP24 and AP-S0–S3](mangmee-package-entitlements-plan-th.md) and [access audit](../research/package-access-admin-web-line-audit-2026-09-11.md). Scoped help-copy tests do not prove record-scope history safety or revocation during slow model/queued delivery. Preserve current company-service help when the AI lane is shut, but do not state every employee can execute every company entitlement. Local/AgentCore parity and real native acceptance remain separate.
