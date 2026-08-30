# Agent Memory: company-plan-term (P29)

Status: Spec + plan locked 2026-08-30; implementation FORBIDDEN until Owner orders ("แค่ spec+plan ก่อน ห้าม implement").

Owner: thawatchai

Scope: Admin-managed per-company plan limits (branches/employees/monthly slips) + usage term with exact-hour expiry, yellow/red warnings, renew, auto-disable — on the Partner console. The manual-subscription bridge before P26 payment, and the trial engine for P10 auto-register (PRO_TRIAL + 30 days).

Decisions (Owner chat 2026-08-30):

- Config fields on admin company page: branchLimit / employeeLimit / monthlySlipLimit, defaults = STARTER tier (1/2/30); term default 30 days, configurable; warning yellow before expiry, red at expiry; renew extends; no renew = disable the company at the exact day+hour the term ends.
- Design (spec): new 1:1 table `CompanyPlanTerm` (tierKey snapshot, 3 limits, termStartAt/termEndsAt UTC, warningDays default 7, renewCount, termDisabledAt to distinguish term-disable from admin-disable); display state computed (ACTIVE/WARNING/EXPIRED); enforcement = on-access check (exact hour) + workers sweep ~5min flipping ACTIVE→DISABLED via existing PartnerLifecycleTransitionUseCase logic (reason term_expired) + exactly-once notifications; renew re-enables ONLY term-disabled companies; SUSPENDED untouched (security state).
- Branch/employee caps enforced at create-branch / create-employee use-cases (block new only, never retro-delete); slip limit stored/displayed only — real cut needs P26 F-BILL-1 meter.
- Legacy companies without a term row = unlimited (grandfathered) until admin sets one; no auto-backfill.
- Integration: P10 Slice C provisioning sets PRO preset + 30 days (P29 plan T3). This answered Billing §8 TBDs: trial duration + post-trial behavior.

Open questions (spec §8, non-blocking): warningDays default 7?, banner visibility staff vs OWNER, LINE expired-reply confirm, grandfather confirm.

Artifacts:

- `docs/specs/mangmee-company-plan-term-spec-th.md` (P29), `docs/plans/mangmee-company-plan-term-plan-th.md` (T1 config/UI → T2 enforcement → T3 signup wiring)
- Code evidence keys: CompanyStatus enum + activatedAt/disabledAt on Company; partner-lifecycle-transition.use-case; prisma-permission-resolver company ACTIVE filtering (explicit-branch reject point must be re-verified at T2); PartnerDetailPage/PartnerListPage; set-partner-ai-model audit pattern; create-branch/create-employee seams; object-version-cleanup worker sweep precedent; no DocumentWorkUnit meter yet.

Verification: docs-only; code evidence from live greps 2026-08-30; no code touched.

Next: wait for Owner to order T1 (or answer §8 questions); P29 number chosen because P28 is already the procurement purchase-side lane.
