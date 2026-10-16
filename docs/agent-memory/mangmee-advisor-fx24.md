# Agent Memory: mangmee-advisor-fx24

Status: implementation and required local verification complete; frozen-source API and gateway typechecks passed. Uncommitted against aff1a21040a1a5d34f27199662c048e6ad0ca1bb.
Owner: Fix-up 24, 2026-10-16.
Scope: D1 claim reason ownership; D2 evidence-policy way forward; D3 voucher pending-event completion and signed lifecycle next steps; D4 dependent counterparty/expense/WHT sequence.
Decisions:
- Use ponytail full mode from the repository skill; the obsolete /Users/spare058 skill path does not exist.
- Keep metered text intake, the budget contract, final-mutation gates, same web business use-cases, tenant/branch/status/revision guards and signed human confirmations. Signed next-step openers follow the existing payment/WHT controls and never execute their next mutation.
- D1: collect a plain reason only for the current private claim's unexpired CREATE collection after receipt/category selection, after the real metered intake; parse and retain exact input evidence and reuse the guarded draft proposal.
- D2: surface the current receipt policy at the no-receipt choice; a blocked signed submit supplies a button to that claim's web evidence page. Substitute preparation/signing remain web-only; no receipt policy is waived.
- D3: C04 turn 2 already has a delivery payload but no terminal event row. The pending answer handler omitted updateEventLog; 300 seconds is the harness settle timeout with no gateway call. Persist completion and offer create → submit → approve → pay with existing guarded voucher actions; an early approve/pay request prepares the next allowed step.
- D4: recognize the exact untyped บันทึกค่าจ้าง route and shared source spans, prepare the counterparty first, then retain the original expense clause. Re-read the saved counterparty under its current permissions/revision; keep its identity/address/class and the explicitly stated WHT rate. Do not infer an income category: use active catalog buttons and the existing rollback/category/confirm path. Preserve the expense category while choosing the income category. Offer voucher then payment and certificate controls after confirmations; finish retained tasks from actual commits. Keep evidence requirements and the empty-catalog system-settings handoff.
Open questions: no product question; no fresh live-provider/LINE/PostgreSQL/browser run was possible offline. Missing source evidence still requires the existing receipt/substitute web process before confirmation.
Artifacts:
- docs/evidence/mangmee-advisor-fx24-router-replays.json copies exact input bodies and real router JSON from .live/after-fx23/{J7,E03,C04,C05}; .live stays untracked.
- Existing registered specs: process-line-webhook.use-case.spec.ts (exact-input controller/use-case/real LINE HTTP payload), expense-document.use-case.spec.ts (actual draft creation totals), line-draft-update.security.spec.ts (real category/review/confirmation, catalog revocation and signed voucher/WHT sequence), line-delivery-plan.logic.spec.ts (primary/fallback proof table).
- /private/tmp/fixup-24-last-message.md; /private/tmp/fx24-{suite,importers,compare}.py; /private/tmp/fx24-source-hashes.json; /private/tmp/fx24-baseline-comparison.json.
Verification:
- Acceptance replay/guard checks: 9 passed; /private/tmp/fx24-acceptance-final.log.
- Real module DI + full table-driven delivery-plan specs: 34 passed; /private/tmp/fx24-di-delivery-final.log.
- Full API scripts (same pretest/test lists, pnpm exec node --import tsx --test instead of the blocked tsx CLI): pretest 16 passed / 128 skipped; main 11,356 passed / 175 skipped / 2 listen-EPERM failures. Both failures reproduce on exact starting HEAD; /private/tmp/fx24-api-full-final.log and fx24-api-sockets-baseline.log.
- All 36 direct importing API specs, including unregistered specs: 1,995 passed / 128 skipped / 31 failures. Baseline has the identical 31 failure names/type/error/code; /private/tmp/fx24-importers-{final,baseline}.log.
- Full contracts script: 445 passed. No contracts change; build not required.
- Full gateway script: 2,014 passed / 46 socket-runtime cancellations, identical failures/cancellations on starting HEAD; /private/tmp/fx24-gateway-{full,baseline}.log.
- Frozen-source API and gateway package typechecks passed (exit 0); /private/tmp/fx24-{api,gateway}-typecheck-frozen.log. Final source hashes remain unchanged.
- git diff --check passed; no package.json, dependency, flag, budget/final-mutation policy, commit, .live edit, network, Docker, cloud or deployment change.
Next: review/integrate the uncommitted diff; no required local implementation/check remains. The 28-line report is /private/tmp/fixup-24-last-message.md. Completed in about 30 minutes.
