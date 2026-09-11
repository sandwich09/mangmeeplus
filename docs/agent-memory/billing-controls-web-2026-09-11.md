# Agent Memory: Billing controls 1–8 through web

Status: SPEC/PLAN COMPLETE; current web repairs VERIFIED LOCAL. Target C01–C08 runtime NOT IMPLEMENTED as a complete suite, CT01–CT32 NOT RUN.
Owner: Product owner / Codex.
Scope: Extend spec/plan for all eight operator controls, no-deploy runtime configuration and no-dead-end web recovery; audit adjacent impact and add focused local browser proof. Both repos must align. No deploy, live gate/collection changes or external messages.
Decisions:
- User requests all eight controls. Add them to the existing system admin architecture, not a separate application.
- Supported policy/config/actions must be versioned durable DB commands with status/retry/rollback through web; code/schema/API-version/secret additions still require engineering setup. No promise that arbitrary new functionality requires no release.
- New control-suite acceptance is distinct from previous 565/25/22 counts and Stripe/native provider evidence.
- Fixed SYSTEM_ADMIN safe deep links across gates, plan-term read retry/loading and duplicate sibling React key. Runtime recovery/permission browser evidence is separate from target control implementation.
Open questions: Existing B01–B10 commercial values remain unset where unapproved; design the administration workflow without selecting prices/refund/grace rules.
Artifacts: [Control spec](../specs/mangmee-billing-controls-spec-th.md), [plan CT01–CT32](../plans/mangmee-billing-controls-plan-th.md), [CG01–CG19 impact](../research/billing-controls-impact-2026-09-11.md), [local evidence](../evidence/billing-controls-2026-09-11/README.md); main Stripe/UI/rich-menu specs/plans and sibling alignment/memory cross-linked.
Verification: 26 focused auth tests; 5/5 actual browser/API/PG cases; BC02 repeated once for mobile screenshot QA (not an extra unique case); web production typecheck exit0; fixture counts0; exact commands/results and same API/web PIDs before/after admin UI mutation in evidence. First-run 4/5 failure was read fault fixture lifetime; final holds outage until retry. Duplicate key warning repaired and asserted absent.
Next: BC-S0–S5 implementation remains explicitly tracked, especially durable recovery after lost manual-renew response (CG03), delegated permission shell, shared public catalog, provider ledger/adapters, no-deploy secret consumer rotation and CT01–CT32. No live action performed or new business value approved. Documentation request complete; do not label future Stripe/control runtime as PASS from these manual-term tests.

Developer-readiness follow-up:
- User asks whether a developer can finish all flows from spec/plan without getting stuck. Rechecked actual docs/code/provider references: answer is conditional readiness to start, not readiness to finish without decisions/tests.
- Added [review DG01–DG08 / F01–F24](../research/billing-developer-readiness-2026-09-11.md), normative control §7 and plan preflight/DA01–DA08. Covers billing-only route isolation, exact command/intent/key preservation, cross-key resource reservation, historical price/consent, issued hosted sessions vs gate, service fulfillment vs revoked human actor, TEST_ONLY rejection and restore/schema recovery.
- Corrected three stale current-code rows in customer UI spec against current LINE/company layout repairs. Synced owned design, Stripe plan and sibling alignment.
- E0 signup proof/returning login, B01–B10 behavior-specific decisions, privileged auth/approver setup and real provider config remain explicit dependencies. Routine operational defaults can be chosen/tested during implementation; no new customer policy assumed.
- This follow-up changes docs only. Prior runtime 26/5/PIDs/cleanup stay historical evidence. New document verification recorded in [readiness evidence](../evidence/billing-developer-readiness-2026-09-11/README.md); no Stripe/control/runtime test rerun or deployment.
