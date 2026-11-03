# Agent Memory: proactive-expense-summary

Status: DRAFT — documents only; sold ceiling and traceability revised 2026-10-26; owner Q1–Q5/Q7 and remaining engineering proof open; Q6 removed (ceiling); Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R19 paid-only eligibility checked against free-expense-access.ts and BILLING_PAID_TIERS)
Owner: Expenses / Notifications documents lane; controller assigns implementation
Related: `docs/specs/proactive-expense-summary-spec.md`, `docs/plans/proactive-expense-summary-plan.md`, `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` ข14, `docs/guidelines/thai-ux-standard.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, citations rechecked in this worktree 2026-11-04; original review/research dates remain historical

Scope:
- Round 4, documents only: weekly spec/plan/memory and e-WHT spec/plan, re-anchored to develop e7c422802 on 2026-11-04. No code, corpus, package, schema, cloud or network change.
- Weekly summary remains opt-in per membership, Monday 08:00 Bangkok, zero AI, sold destinations and expense-derived PND3/PND53 information only. Free source-drafts shops get no weekly summary, home/account invitation or tax reminder.
- e-WHT changes are restricted to status/baseline citations, citation offsets and one free-path qualification in each document; the design, owner gates, tests and acceptance remain intact.

Decisions:
- New R19/AC32–AC33 requires current active access and an unexpired/enabled paid catalog tier (`packages/contracts/src/billing.ts:9`), plus existing reader/branch rights, before opt-in, weekly reads and send. Use current resolver/term facts; missing/free/unknown/expired never qualifies from expense.read alone.
- Reuse `isFreeExpenseDraftCompany` (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:10–54`) through the existing resolver (:65,130–131 in `prisma-permission-resolver.repository.ts`); permissions keep originally granted expense.read (:58–68 above), but free routes remain expense/source/history-only (:72–83), enforced by `auth.guard.ts:325–326`. Do not widen the free allowlist for summary routes or recovery.
- One local `weeklySummaryPaidEligible` function in the already-planned pure logic file serves existing subscription/provider/sweep/delivery/list/unread boundaries. Provider reads current company/term facts before expense/claim/WHT queries; no new commercial-access service, DB port, permission, environment switch or stored flag.
- Free UI never mounts/calls the summary card; pass existing server-session freeExpenseDrafts through account/settings-profile callers. Optional Q2 home invitation is positively paid-gated through the dashboard caller/wrapper. No loading/cache flash, zero summary requests or tax rows for free users. Existing paid branch scope and own expired-paid opt-out recovery remain.
- R1–R8/R11–R15 remain paid-summary behaviour; R9 purge and R10 daily retirement still run across cohorts without granting access; R16–R18 remain removed tombstones; R19 covers paid/free. All earlier AC ids stay; AC32/AC33 add only commercial-boundary proof.
- Goal 5 / 1.1–1.3, VAT/PP30 row and facts, ledger exports, AC11/AC13/AC30, M9 and Q6 remain removed 2026-10-26 (ceiling). No unsold module/UI/export/test work is restored.
- Tax reminders remain expense-derived PND3/PND53 with confirmed paid dates and per-payment filing coverage, excluding explicit E_WHT once its source contract lands; lower packs get information only, no form-page button. No VAT fact read.
- Money stays CONFIRMED/civil expense-date/THB-only plus other-currency counts; branch scope includes central rows. No promise that card totals equal the home/list view. Preserve subscription merge/dedup/source-supersession, tx-bound live rights checks, retention and exact own opt-out recovery.
- e-WHT R1–R21 are qualified as paid-workflow design: free has no WHT/remittance choice or confirm; existing `assertExpenseFinancialAccess` (`apps/api/src/modules/expenses/application/expense-commercial-access.ts:22–25`) is called before confirmation (`expense-draft.use-case.ts:1361`). Existing free source facts, quota and routes stay unchanged; no e-WHT design or new guard implementation.

Develop already fixed/changed (local code, not live verification):
- `049aa51de`: never-paid expired shops may use source drafts; the old uniformly-blocked statement is corrected. Free predicate/permissions/routes above are existing code. Three monthly source reads and pending/usable counts remain in `free-expense-quota.ts:9,21–29`; attachment ownership/state checks remain in `free-expense-attachment.ts:13–26`. No quota/source/commercial implementation is repeated.
- `9036b8552`: welcome/cohort/package-advisor entry exists (`apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:402–428,453–457`). It does not enroll a weekly summary or open typed free AI questions (D04). Preserve it unchanged.
- `1fbba874e`/`884ba5307`: concise activity history exists (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:292–304,1207–1212`; `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`). Summary reads add no expense save/activity row; no history implementation.
- `3f6db1729`: accepted confirmation results are already suppressed for exact recipient/chat/proof (`process-line-webhook.use-case.ts:3717–3731`). `48295b57c`: picker command text survives display sanitization (`apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14`). Preserve both. The picker fix is in the text transformer, while buffer ordering remains existing behaviour; no new webhook/buffer/sanitizer work.
- Existing B1–B9 and e-WHT B1–B13 remain visible at the re-anchored evidence; those merged features do not fix them. e-WHT fields/settings still do not exist in apps/packages; no existing e-WHT implementation is claimed or repeated.

Current bugs/gaps:
- New G14, **out of scope for a daily eligibility repair**: daily sweep selects active companies/rules (`apps/api/src/modules/dashboard-notifications/application/use-cases/notification-sweeps.use-cases.ts:115–121`); creator reads a snapshot and selects OWNER/ADMIN (`notification.use-cases.ts:303–325`) with no explicit free-cohort exclusion at either boundary. This is static evidence, not proof of delivery to a free shop. Preserve existing R10 full retirement; add no daily free filter or daily test here.
- G15, **in-scope former-design gap**: permission-only summary eligibility could qualify a free worker recipient with expense.read. R19 closes that design gap before opt-in/read/send; weekly summary is not implemented today, so no current weekly disclosure is claimed.
- B1/B4 daily zero-widget/role broadcast, B6 URL supersession, B7 concurrent direct create, B8 unsold-ledger mixed currency and B9 home mixed currency remain; no ledger/home fix is added. Existing current delivery still checks active membership/event and entitlement without re-reading reader scope (`notification.use-cases.ts:498–530`), hence R7/19 live checks remain required.
- B2 unsold ledger placeholder, B3 permanent quiet-hours suppression, B5 429 quota retry, other notice retention/merge gaps remain out of scope. G12 account hash still lacks weekly-summary (`company-profile.logic.ts:68–75`). M1/M8 writer locking, M2 tx-bound resolver and M5 adapter-volume proof remain; no speculative resolver API or cache is added.
- M6 recovery now explicitly means expired previously-paid access; free-cohort permission filtering is separate. R19 cannot turn the narrow metadata/DELETE recovery path into free enrollment or summary reads.

Open questions (unchanged, with recommendations):
- Q1 opt-in only [yes]; Q2 once-only paid-home invitation [yes after owner approval, never free]; Q3 signals only in weekly card [yes]; Q4 quiet weeks silent [yes].
- Q5 message budget [operator reconfirms OA plan/prices, budget covers five-Monday months plus other notices]; Q7 retention [13 months]. Q6 stays removed. Home B9 wording/placement remains a separate owner decision (M4).
- e-WHT Q1–Q4 and existing engineering prerequisites remain unchanged; free-path clarification introduces no new owner question. Legal deadline/price research is not done in this no-network round.

Artifacts:
- Weekly spec: 19 R ids (16 retained, 3 removed), AC1–AC33 intact, R19 path applicability, concrete failure/impact/risks/first tests and trace row.
- Weekly plan: R19 mapped into existing steps, exact registered first tests, commands/dependencies, three-width browser journey; no new step ids or migration for R19.
- e-WHT spec/plan: all 21 R ids and A1–A44 retained; status/citation/free-path edits only; original B5 PP30-unsold side-effect note retained.

Verification:
- Mandatory AGENTS, local ponytail full, Thai UX and owner decisions read; current code traced for free access/route/confirmation guards, daily producer/delivery, summary facts, auth/recovery, source history, welcome and picker/duplicate delivery. No network/cloud.
- API test registrations rechecked with actual grep -c commands: all 10 weekly and 19 e-WHT listed files remain positive; no package or test edit. First R19 assertions live only in the existing registered weekly/API/auth files.
- Final static checks passed: all five headers/current status, 40 requirement IDs (3 removed), weekly AC1–AC33 and e-WHT A1–A44, 60 literal evidence quotes, citation endpoint bounds, Markdown tables and git diff --check. e-WHT original design text matches after excluding status/baseline/citations/free-path notes. No runtime claim follows from registration or static checks.
- No implementation, API/Gateway/PG/browser tests, build/typecheck, schema validate/generate/migration/reset, provider call, cloud operation, git write, commit/push or deploy. Browser checks remain planned at 390/1280/~1556 in existing e2e/journeys.

Next:
- Controller reviews the five scoped documents; retain existing owner gates and removed ids, then implement only separately authorized steps with tests first.
- Keep the daily-cohort gap as a separate finding; R10 retirement remains the approved summary replacement. Preserve e-WHT design and downstream P04/P07/P10/P08/P11/P12 ownership.
- Before any later release follow mandatory UAT/Production protocol and record UAT/READY/Production run ids, signed result and customer OPEN.
