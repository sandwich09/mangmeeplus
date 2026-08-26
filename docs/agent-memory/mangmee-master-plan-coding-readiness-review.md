# Agent Memory: mangmee master plan coding readiness review

Status: COMPLETE — docs/evidence review delivered 2026-08-26; implementation/owner gates remain as recorded
Owner: Codex
Scope: Review every topic in lanes 1–4 of `docs/plans/mangmee-master-plan-index-th.md`; exclude Subscriber/Billing lane 5; verify specs and plans against repository code/tests and authoritative external evidence; close documentation gaps required before coding.
Decisions:
- Treat a topic as coding-ready only when product journey, rules/exceptions, architecture/contracts, permissions/tenant/audit/state boundaries, implementation phases, focused verification, rollout/rollback, and evidence provenance are explicit or linked to a canonical source.
- Do not treat labels such as `spec ✅` or `ready` as evidence by themselves.
- Preserve existing user work and avoid implementation/code changes; this task changes planning/specification evidence only.
- Use `origin/develop@1ad0ea6c` as the integration baseline because the current `plan@425ce7bd` worktree is older; record P27 Phase 3 as branch-only (`codex/ledger-p3-bundle@01587293`) rather than merged.
- Decouple lanes 1–4 from Billing where the old docs created an accidental dependency: P10 uses attribution-only `requestedOfferKey`; P24 uses a controlled cohort/entitlement and does not define price/expiry/quota enforcement; P15–P17 follow P27/P28/P13, not P26.
- Resolve P12 surface selection from LINE official documentation: external web uses OAuth authorization code + PKCE; LIFF uses `liff.login()` and both converge on one backend verifier/identity boundary.
- Keep material accounting/security/provider choices blocked instead of accepting recommended defaults as Owner decisions.
Open questions:
- P10 ingress auth model, claim TTL/resend/revoke, duplicate taxId policy.
- P28 spec §10 items 2–5; P13 active-membership/notification policy.
- P15–P17 pilot source/volume/accountant review/matrix approver; P18–P20 provider and pilot.
- P21/P23/Advisor named accounting/tax reviewer, current sanitized fixtures and SLA.
- P25 next-cohort workload/concurrency/SLO/headroom inputs.
Artifacts:
- `docs/plans/mangmee-master-plan-index-th.md`
- `docs/plans/mangmee-four-lane-coding-readiness-audit-th.md`
- `docs/plans/mangmee-four-lane-gap-closure-plan-th.md`
- `docs/specs/mangmee-revenue-connectors-contract-spec-th.md`
- Corrected P10/P11/P12/P13/P15–P17/P21/P24 specs and the master 2.5-day plan.
- Restored 9 lane-1–4 spec artifacts referenced by the index from `origin/develop`, hash-verified before editing. Also restored the P27 task memory and excluded billing spec byte-for-byte only to repair existing local links; billing content was not reviewed or changed.
Verification:
- `bash infra/monitoring/runtime-alarms.spec.sh` → `ok`.
- Focused `tsx --test` for auth controller/login channel/LINE link, banking logic, procurement logic and transaction-tax logic → 105 tests passed, 0 failed.
- Local Markdown link checker over 17 reviewed/changed docs → all local targets exist.
- Stable closure-anchor checker → all referenced plan anchors exist.
- Trailing-whitespace check over reviewed/changed docs → clean.
- SHA-256 comparison confirmed the master index initially matched `origin/develop`; restored integration artifacts matched their source before edits. Excluded billing spec/P27 memory still match byte-for-byte after restore.
- Integration-ref invariant check reconfirmed: LINE exchange remains fail-closed, SES adapter throws as unimplemented, LINE multi-company has owner-only guards, banking scorer has no production caller, `SupplierCreditNote` is absent, P27 Phase 2 is ancestor of `origin/develop` while Phase 3 is not.
- External/browser evidence: LINE official login/link/security docs; AWS SES/ECS/CloudWatch docs; Revenue Department current forms page (updated 28-02-2026); OWASP GenAI Top 10; read-only FlowAccount/provider-doc inspection. No live mutation, cloud action, credentials or customer/account identifiers were recorded.
Next:
- Owner may start any `READY <phase>` in the closure plan. First blocking decisions are listed in the audit §5; do not start the blocked behavior until those answers/evidence are recorded.
