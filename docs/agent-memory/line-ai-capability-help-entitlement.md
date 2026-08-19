# Agent Memory: line-ai-capability-help-entitlement

Status: **Implemented and verified locally 2026-08-19** (phases 1–4 in one change); live UAT check (phase 5) still open. All three owner questions closed the same day. Q1: revised receipt-permission proposal approved. Q2: both language tables in scope. Q3: AC-6 is a release gate, so the AgentCore plumbing (phase 4) shipped with the rest.

Owner: thawatchai

Scope: The LINE assistant's self-description ("ทำอะไรได้บ้าง") advertises features the company has not switched on. Sibling of [[agent-memory/line-menu-entitlement-gating|LINE staff menu feature-entitlement gating]] (2026-08-15), which gated the menu buttons and the ERP tools but not the reply copy.

## Decisions

- Reported 2026-08-19 from the LINE OA: the capability card named sales, finance, tax, stock, customers, bookings and receipt→expense-draft capture on a company where those are off. The quick replies under the same message were already correctly filtered — proof that the two surfaces disagree.
- Root cause is structural, not a missed condition: `CAPABILITY_HELP` (`apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:68-92`) is a frozen constant, and the AI gateway has **no entitlement input at all** (`grep -rn entitlement apps/ai-gateway/src` → nothing; `LineAiTurnRequest` carries no feature keys). The 2026-08-15 gate could not have covered it.
- Same defect on the API side: `capabilityFollowUpReply` (`apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts:15-33`) is static too, and repeats the receipt→draft claim. That one runs where entitlements are already loaded.
- Chosen design: **derive** the reply from `LINE_TOOL_REGISTRY` via `hasToolPermissions ∧ hasToolFeature` rather than maintain a third hand-written capability list. A line can then only be advertised when a tool behind it would actually run.
- Grouping key is `toolFeatureKeys(tool)`, NOT `businessSubjects` — measured leak below.
- New optional `LineAiTurnRequest.entitledFeatureKeys` buys exactness, not basic safety: gateway permissions are already entitlement-stripped, so absence degrades to a derivation that is correct for 59/60 tools.

## Evidence (harness run 2026-08-19, real registries, before any code change)

Fixture company: `ai_line_assistant` + `expenses` + `dashboard_notifications` on; sales, crm, inventory, product_catalog, thai_tax, reports, ledger, banking, procurement off. Entitled set expanded through the real `evaluateEntitledFeatureKeys` (submenus included).

- **E1** `composeCapabilityHelp` measured arity **0** — no company, permission, or feature parameter exists. Output is the exact text seen in the LINE screenshot.
- **E2** **9 of 12** advertised capabilities cannot be answered by that company (only ค่าใช้จ่าย, งานค้าง/แจ้งเตือน, and receipt upload survive).
- **E3** **44 of 60** `LINE_TOOL_REGISTRY` tools are refused for that company by the already-shipped `hasToolFeature` gate — sample: `inventory.search_products[product_catalog]`, `ledger.get_financial_summary[double_entry_ledger]`, `sales.get_sales_summary[sales_documents]`, `crm.get_customer_summary[crm]`.
- **E5/E6 (leak found by measurement)** Grouping by `businessSubjects` lit a FALSE "การเงิน" line for the expenses-only company: `dashboard.get_business_health_summary` declares `businessSubjects: ['company','report']`. Regrouping on `toolFeatureKeys` removed it. This is why the spec does not group by subject.
- **E7** Derivation output, corrected fixtures: staff with `expense.receipt.upload` @ expenses-only → expenses + alerts + receipt sentence; same staff with `expenses.upload` off → receipt sentence gone; manager without upload permission → receipt sentence gone; manager @ all-on → 8 lines; legacy `null` company → identical to all-on; zero permissions → **no lines at all** (hence the R4 fallback rule).
- **E9** Permissions arriving at the gateway are already entitlement-stripped (`prisma-permission-resolver.repository.ts:72-73`). For an owner holding all **266** registry permissions at the expenses-only company: 266 → **82** effective; permission-only tool selection **15**, permission ∧ entitlement **15** — zero gap.
- **E10** Inverse company (crm on, expenses off), same owner grant: 266 → 85 effective; permission-only **18**, permission ∧ entitlement **17**. The single gap is `sales.get_sales_summary` (requires `crm.report.read`, reads `sales_documents`) — the same bypass the 2026-08-15 work identified. That one case is the whole justification for the new request field.
- **Feasibility** Both turn-request build sites already have `companyId` + `this.prisma` in scope: `process-line-webhook.use-case.ts:1699-1710` (and it already calls `loadEntitledFeatureKeys` on the same turn at `:851`) and `drain-line-ledger.use-case.ts:163-172`. The AgentCore path rebuilds the request at `apps/ai-gateway/src/agentcore/runtime.ts:245-267` and would need the field plumbed or fail open.
- **Baseline** `response-composer.agent.spec.ts` 32/32 pass and never asserts the capability copy; `line-staff-menu.logic.spec.ts` 25/25 pass; `line-ai-capability-follow-up.logic.ts` has no spec file.

Harness note: three throwaway `tsx` scripts under `apps/api/` (run against `@watchdog-bms/contracts` dist built 2026-08-19 plus API-side entitlement helpers) were used to produce E1–E10 and deleted after the run. The AC list in the spec re-encodes every one of those checks as a permanent test, so the harness is not needed again.

## Owner questions (all closed 2026-08-19)

1. **CLOSED 2026-08-19 — owner approved the revised proposal.** Receipt-capture permission — **first proposal reversed by a second measurement.** Gating on the tool's `expense.receipt.upload` would have HIDDEN the capability from `MANAGER`, `ACCOUNTANT`, `MARKETING`, which hold `expense.receipt.line_upload` only (`permission-registry.ts:613`, `:806`, `:859`), while the real LINE intake path accepts any of `line_upload` / `upload` / `create` (`process-line-webhook.use-case.ts:1158-1159`, `:2165`). Revised: follow the intake path, same list as the menu camera button. Confirmation only.
2. ~~English blurb in the same change?~~ **CLOSED 2026-08-19 — yes.** Measured `detectReplyLanguage` (`response-composer.agent.ts:517-523`): one Thai character anywhere → whole reply Thai (`ช่วย summary sales ให้หน่อย…`, `AI ทำอะไรได้บ้าง`, `can you ดูยอดขาย ได้ไหม`, `ทำอะไรได้บ้าง help`, `🙏` all → TH); no Thai character + ≥1 Latin letter → whole reply English (`help`, `ok what can you do?` → EN); empty text follows `planLanguage`/`locale`. Mixed input therefore cannot produce mixed copy. Design consequence recorded as spec R7: the derivation returns group IDS and copy lives in one table per language, so the two tables always render the same group set. Pre-existing edge (not introduced here): a Thai user typing only `help`/`ok` gets the English reply.
3. ~~Plumb `entitledFeatureKeys` through the AgentCore runtime path?~~ **CLOSED 2026-08-19 — owner: "AC-6 ต้องทำด้วย".** Both UAT and Production run `LINE_AI_AGENT_RUNTIME=agentcore` (`deploy-uat.yml:615`, `deploy-production.yml:236`; promotion fails otherwise — `validate-production-promotion-environment.sh:52`), so `payloadToTurnRequest` is the live builder and the field must travel through `RuntimePayload`. Verified while planning the rollout: the payload parser (`runtime.ts:200-242`) is an allowlist that ignores unknown fields, and `LINE_AI_RUNTIME_CONTRACT_VERSION` (=1) is identity, not payload validation — so no contract bump, and a half-deployed gateway/artifact pair only loses AC-6 instead of breaking turns. Deploy artifact first, gateway second.

## Artifacts

- [[specs/line-ai-capability-help-entitlement-spec|Spec]] — measured current state, derivation design, reply contract, AC-1..AC-11
- [[plans/line-ai-capability-help-entitlement-plan|Plan]] — phases 0–5, per-phase verification commands
- Files this touches when implemented: `packages/contracts/src/ai-tools.ts`, `packages/contracts/src/line-ai.ts`, `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`, `.../orchestrator.agent.ts`, `apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts`, `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, `.../drain-line-ledger.use-case.ts`

## Implementation (2026-08-19)

- `packages/contracts/src/ai-tools.ts`: `LINE_CAPABILITY_GROUPS` (9 groups, fixed reply order), `usableCapabilityGroupIds`, `inCapabilityGroup`, `canAdvertiseReceiptCapture`, `LINE_RECEIPT_CAPTURE_PERMISSIONS`. Groups return IDS only; copy lives in the gateway and the API follow-up, keyed by those ids, so TH and EN can never describe different capability sets.
- `packages/contracts/src/line-ai.ts`: optional `LineAiTurnRequest.entitledFeatureKeys`.
- Gateway: `composeCapabilityHelp(..., access)` builds from the derivation; `orchestrator.agent.ts` passes `userContext.permissions` + `entitledFeatureKeys`; `runtime.ts` (`RuntimePayload`, both `validatePayload` branches, `payloadToTurnRequest`), `runtime.port.ts`, and `line-ai-turn.use-case.ts` carry the field to AgentCore.
- API: `process-line-webhook.use-case.ts` loads the set ONCE per turn (new `lineAssistantDisabledFor` over an already-loaded set) and feeds the AI gate, the staff menu context, the follow-up reply, and the turn request — one DB read where there were two; `drain-line-ledger.use-case.ts` sends the same field so a drained turn cannot answer differently.

### Two gaps found by reviewing the change itself

1. **Subject grouping leaked** (found before implementing, spec §6.1): `dashboard.get_business_health_summary` declares `businessSubjects: ['company','report']` and lit a finance line on a company with reports/ledger/banking off. Grouping moved to `toolFeatureKeys`.
2. **13 of 60 tools sat outside every group** (found after the first implementation passed): `reimbursements` carries no feature key at all by design, and `workflow_automation` had no group, so a claims-only approver or a workflow-task user would have been told the assistant could do nothing for them — an under-advertising regression against the old hardcoded copy, which claimed both under "ค่าใช้จ่าย" and "งานค้าง". Fixed by matching the expenses group on `sourceModules: ['reimbursements']` and adding `workflow_automation` to the alerts group. The remaining 8 (company context, employee, HR leave, and the receipt-capture tool) are deliberately unadvertised: the old copy never claimed them either, and the receipt claim has its own sentence.

### Known limits (recorded, not fixed here)

- The derivation checks registry permissions + entitlement, not per-row ABAC. A tool that passes both and then returns nothing for branch-scope reasons can still be advertised.
- `ai-gateway.client.ts` mints actor delegations filtered by `hasToolPermissions` only, not `hasToolFeature`, so delegations exist for tools the feature gate refuses. Not a hole (the ERP controller re-checks) but the same asymmetry this work closed for copy.
- A caller with zero usable groups whose only remaining capability is receipt upload gets a reply that does not start with the capability intro, so `isDeliveredCapabilityFollowUp` will not recognise a follow-up to it and the turn falls through to the model.

## Verification

- Evidence harness E1–E10 above (run 2026-08-19, deleted after capture).
- Baselines before the change: ai-gateway `response-composer.agent.spec.ts` 32/32; api `line-staff-menu.logic.spec.ts` 25/25.
- New/updated tests: contracts `feature-entitlements.spec.ts` +12 (AC-1..AC-7, AC-11, subject-leak, reimbursement/workflow coverage, receipt-permission set); ai-gateway `response-composer.agent.spec.ts` +10 (AC-1..AC-9, AC-12, R2, legacy call shape), `runtime.spec.ts` +2 (payload carries entitlements; absent stays absent), `line-ai-turn.use-case.spec.ts` +1 (forwarded to AgentCore invoke), `orchestrator.agent.spec.ts` updated (the fixture caller holds inventory+ledger reads, so the reply must now omit sales); api `process-line-webhook.use-case.spec.ts` +2, `drain-line-ledger.use-case.spec.ts` +2, `line-intake-dispatch.use-case.spec.ts` updated +1 (its capability follow-up fixture held only `line.ai.query`, which now correctly advertises nothing).
- Suites: `@watchdog-bms/contracts` 137/137 pass · `@watchdog-bms/ai-gateway` 587/587 pass · `@watchdog-bms/api` exit 0 · `tsc --noEmit` clean in `packages/contracts`, `apps/api`, `apps/ai-gateway`, `apps/web`.
- End-to-end simulation of the reported turn (expenses-only company, staff permissions, through the real composer): reply lists only ค่าใช้จ่าย + งานค้าง/แจ้งเตือน + the receipt sentence, example question is "ค่าใช้จ่ายเดือนนี้เท่าไหร่", and the follow-up reply is a subset. English renders the same two groups.

## Next

1. ~~Owner confirms Q1 and Q2~~ — done 2026-08-19. ~~Phases 1–4~~ — implemented 2026-08-19.
2. Review + merge the PR to `develop`.
3. Phase 5 live UAT check: the reported company's reply, the AC-6 CRM-on/sales-off case **on the AgentCore path** (UAT runs `agentcore`), and menu-vs-text agreement. Deploy the AgentCore artifact before the gateway so the field is understood when it starts being sent. Record entitlement rows and both replies here.
