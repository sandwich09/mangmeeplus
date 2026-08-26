# Agent Memory: line-ai-mangmee-advisor-conversation

Status: Spec v2 + plan v2 (docs only, 2026-08-22). Implementation NOT started; no code, flag, deploy or behavior
change. Both docs are untracked new files on `develop` pending commit by the owner.
Owner: thawatchai.phuchana
Scope: LINE OA น้องมั่งมี advisor/natural-conversation — social one-call lane, curated Thai business knowledge cards,
bounded company advisory profile, default-off rollout. Finance/trend insights (Phase 6) and preferences (Phase 7) are
deferred out of the first release.
Decisions:
- 2026-08-22 owner decisions (spec §1.1): (1) LOW/MEDIUM cards → model prose grounded on card text + citation/numeric
  validator, HIGH → deterministic card renderer; (2) single configured model for v1, fast tier/small router deferred;
  (3) new LOW-risk permission `company.advisory.read` seeded to every role holding `line.ai.query` (STAFF/HR/SALES/
  INVENTORY/MARKETING/AUDITOR lack `company.setup.read`), non-sensitive fields only; (4) advisor in group/room only for
  zero-company-data lanes, `COMPANY_INSIGHT` 1:1 only, existing `LIVE_QUERY` group behavior untouched (separate
  decision later); (5) overdue `nextReviewAt`: LOW/MEDIUM answer with dated caveat ≤1 SLA period then fail-closed,
  HIGH fail-closed immediately, `effectiveTo`/`revokedAt` immediate for all tiers.
- Architecture from the 2026-08-22 review (verified against code): `advisorAnswer` is a sibling optional field on
  `LineIntakeRoutePlan` gated by `capabilities.advisor` (precedent `clarifyQuestion`), NOT inside `LineAiPreparedPlan`
  (that wrapper is tied to `capabilities.fusedPlan` + ~21KB catalog); API consumes it directly like the exact-greeting
  lane and never forwards it into `LineAiTurnRequest`; card registry compiles into `@watchdog-bms/contracts` so gateway
  (retrieve/prompt) and API (validate/render) share one immutable set; company profile is embedded server-side in
  `LineIntakeRouteRequest` (no cache, no tool registration in v1); `LINE_AI_ADVISOR_MODE=off|social|knowledge|company`
  with no `shadow` value (measurement cohort = mode ≥ social + direct-answer off); SLO table §13.3 is a placeholder
  until Phase 0 measures envelope output tokens.
- Current casual path costs 3 serial model calls (routeIntake → router.route → composeCasual); exact-greeting lane
  (0 calls) exists default-off and is to be enabled/measured in UAT first (Phase 0).
- Cards must reference existing `TaxRateConfig`/`TaxCalendarRule`/`TaxRuleSource` records via `sourceRecordRef` for
  rates/deadlines instead of duplicating numbers.
Open questions:
- Named Accounting/Tax reviewers for HIGH cards (blocks card approval in Phase 2, not scaffolding).
- Group/room policy for existing `LIVE_QUERY` business replies (separate decision/flag).
- How `company.advisory.read` role grants sync to existing companies (decide in Phase 3).
- 2026-08-22 owner: the items above are waiting on business input; Slice C (company insight) is parked until it
  arrives. Slice A has no business-input dependency and proceeds first.
- 2026-08-22 owner approved enabling `LINE_AI_EXACT_GREETING_ENABLED` in UAT (Phase 0 baseline) AHEAD of the
  fused-casual step that `line-ai-uat-correctness-latency-spec.md` §13 item 9 sequenced first; the lane is
  independent code (end of the deterministic gates, plain-text reply) so no activation blocker is bypassed.
- Finding: the greeting lane (`03fdde81`) was already in the UAT/Production image (`a094c0d3`) but the flag was never
  wired into `infra/prod-ecs-express/deploy.sh`, so UAT ran the config default `false`. Enabling a LINE_AI_* flag
  in UAT therefore means: wire it in `deploy.sh` (pinned file → re-sync maintenance pins) → PR → UAT deploy run.
Artifacts:
- PR #226 `codex/uat-exact-greeting-flag` (head `f05de5fde2b002c1e37246ed38424aeec105eb3a`): deploy.sh wiring —
  UAT default `true`, production default `false` + explicit `true` rejected, maintenance forces `false`; serving-mode
  spec assertions; maintenance pins re-synced. Merged to develop 2026-08-22 (develop `651a95f9`); UAT deploy dispatched
  from controller `main` `b5ee824a` with `release_ref=f05de5fd…`, target `all`: **UAT_RUN_ID = 32619629089**
  (https://github.com/MangmeeDev/mangmeeplus/actions/runs/32619629089). Result: pending.
- `docs/specs/line-ai-mangmee-advisor-conversation-spec.md` (v2)
- `docs/plans/line-ai-mangmee-advisor-conversation-plan.md` (v2)
- Related: `docs/agent-memory/line-ai-latency-and-autonomy-lanes.md`, `docs/agent-memory/line-ai-uat-correctness-latency.md`
  (activation blockers #1 durable replay and #3 Flex→text fallback must close before `knowledge` UAT)
Verification:
- Docs-only change; no tests applicable. Edits applied by exact-match replacement script (spec 49 edits, plan edits)
  with each anchor required to match exactly once; leftover-term grep and code-fence balance checked after editing.
Next:
- Owner commits the two docs; Slice A (Phase 0 baseline + exact-greeting measurement, Phase 1 scaffolding) is the
  first implementation step — read spec §1.1 and §9 before touching contracts.
