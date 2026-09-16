# Mangmee System UI Alignment Implementation Plan

## Linked Spec

- Spec: `docs/specs/mangmee-system-ui-alignment-spec.md`
- Agent memory: `docs/agent-memory/mangmee-system-ui-alignment.md`
- Summary: `docs/mangmee-system-ui-alignment-summary-th.md`
- Visual reference: `/Users/bombam/Downloads/มั่งมี-ระบบทั้งหมด (เปิดได้ทุกเครื่อง).html`
- Design handoff: `../design_handoff_mangmee`

## Purpose

ปรับ UI ของ WatchDog-BMS ให้ใกล้กับ HTML reference ของมั่งมีแบบ production-safe โดยเริ่มจาก shared token, shell, common component และ feature pages ที่มี API รองรับแล้ว จากนั้นค่อย migrate หน้าอื่นเป็น phase ต่อเนื่อง

อัปเดตรอบล่าสุด: ใช้ภาพ design ที่ 2 เป็น acceptance target สำหรับ company dashboard/sidebar/header โดยเพิ่ม menu prototype แบบ permission-aware, planned placeholder routes, และ `COMPANY_VIEW` role สำหรับ local company mock account

## Current Repository Context

- Apps/packages to inspect:
  - `apps/web`
  - `packages/design-tokens`
  - `apps/api` เฉพาะกรณีต้องเปิด API ใหม่
- Existing patterns to reuse:
  - Company-scoped route `/companies/[companyId]/...`
  - Workspace module registry
  - Permission-aware navigation
  - Feature-local API clients
  - Shared API error/localized message helpers
- Known dependencies:
  - Tailwind CSS v4 in `apps/web/app/globals.css`
  - Generated tokens from `packages/design-tokens`
  - Existing SVG icon components
- Open implementation risks:
  - Prototype route map ไม่ตรงกับ module taxonomy ปัจจุบันทั้งหมด
  - บาง prototype flow ยังไม่มี backend contract ใน repo
  - Browser visual verification ต้องใช้ local stack และ seed data ที่เสถียร

## Implementation Rules

- Follow `docs/specs/mangmee-system-ui-alignment-spec.md`.
- Keep route/controller files thin.
- Reuse common helpers/components before adding feature-specific styling.
- Do not enable unsupported prototype routes with fake mutations.
- Planned prototype routes may be enabled only as read-only placeholders inside the company shell.
- Backend remains source of truth for auth, permission, validation, audit, and persistence.
- Keep Thai copy user-facing and avoid implementation jargon on product screens.

## Scope

### In Scope

- Shared design tokens and generated CSS
- Shared Mangmee components and utility classes
- Workspace shell/header/sidebar alignment
- Page chrome alignment
- Settings, dashboard notification, accounting, tax, and planned-module first pass
- Unit tests for shared visual mapping and ready module state
- Documentation for plan, spec, memory, and Thai summary

### Out of Scope

- Copying the whole HTML prototype into production
- Implementing all prototype-only business flows in one pass
- Changing auth/RBAC backend behavior
- Adding screenshot regression before a stable running local stack exists
- Dark mode

## Role Gates

- BA gate: HTML reference and design handoff are accepted as visual target; current WatchDog product route model remains canonical.
- SA gate: Shared tokens/components are introduced without bypassing route/API/permission boundaries.
- DEV gate: Reusable components are implemented in common layer and adopted by representative pages.
- Integration gate: design-token build/check, web typecheck, and web unit tests pass.

## Phase 0: Discovery and Alignment

### Goal

Confirm the prototype, design handoff, current workspace architecture, API support, and permission model.

### Tasks

- [x] Inspect HTML reference and extracted styles.
- [x] Inspect `../design_handoff_mangmee` route/API/permission files.
- [x] Inspect workspace shell and feature page structure.
- [x] Identify supported modules and avoid unsupported fake routes.

### Tests

- None.

### Exit Criteria

- The implementation path is clear and does not conflict with current backend/permission architecture.

## Phase 1: Shared UI Foundation

### Goal

Create reusable Mangmee style primitives so every page can migrate consistently.

### Tasks

- [x] Add brand, gray, status, radius, and shadow tokens.
- [x] Update design token generator to emit reusable shadow tokens.
- [x] Regenerate web theme CSS.
- [x] Add `MangmeePage`, card, icon, badge, stat, tone, and initials helpers.
- [x] Add global utility classes for page, card, button, input, table, tabs, and shell.

### Tests

- [x] Design token build/check.
- [x] Unit tests for tone mapping.

### Exit Criteria

- Feature pages can adopt Mangmee visuals without inventing new local style systems.

## Phase 2: Shell and Representative Pages

### Goal

Apply the shared UI foundation to the workspace shell and API-backed representative pages.

### Tasks

- [x] Align sidebar, header, workspace shell, company/branch scope controls.
- [x] Align shared page header and list surface.
- [x] Align settings overview.
- [x] Align dashboard notifications.
- [x] Align accounting documents.
- [x] Align tax workspace.
- [x] Align planned-module page.
- [x] Mark accounting/tax ready because current route/API support exists.

### Tests

- [x] Web typecheck.
- [x] Web unit tests.

### Exit Criteria

- Main shell and representative ready/planned pages match the new shared visual language.

## Phase 2B: Latest Company Dashboard Design Refinement

### Goal

Align the live company dashboard at `/companies/seed-local-company/dashboard` with the second design screenshot while preserving WatchDog-BMS auth, RBAC, and company-scoped routes.

### Tasks

- [x] Change sidebar width/spacing and active menu state to match the latest design.
- [x] Change header to branch selector left, bell/avatar right, and remove desktop hamburger/language controls from the company view.
- [x] Replace the company dashboard placeholder with the design-style greeting, KPI cards, branch chip, and quick menu chips.
- [x] Replace the workspace menu registry with the design menu order and labels.
- [x] Add planned placeholder routes for prototype menu items that do not yet have full backend contracts.
- [x] Register `COMPANY_VIEW` in the API permission registry with compact read/menu grants.
- [x] Sync local permissions and verify `Company / Company@123` login.

### Tests

- [x] Web typecheck.
- [x] API typecheck.
- [x] Web unit tests.
- [x] API permission registry unit test.
- [x] Authenticated runtime route checks for dashboard, inbox, and permissions.

### Exit Criteria

- Company mock user sees the latest design menu and dashboard shell without relying on fake backend mutations.

## Phase 3: Remaining Feature Page Migration

### Goal

Move the rest of `apps/web/src/features` to the shared Mangmee page, card, form, table, button, and badge primitives.

### Tasks

- [x] Normalize interactive accents across current feature menus: primary actions, active tabs/filters, action links, and loading indicators use the shared Mangmee brand styles. (2026-07-14)
- [ ] Inventory pages. (Core catalog screens aligned; remaining inventory subpages still need full page-chrome migration.)
- [x] Expenses pages. (2026-07-09 — reskinned to the shared `MangmeePage`/`MangmeeCard`/`mangmee-*` idiom: 5 sub-tabs, finance KPI cards, status chips + search, split rich review panel, category/signature/evidence. See `docs/plans/expenses-mangmee-reskin-plan.md` + `docs/agent-memory/expenses-mangmee-reskin.md`.)
- [ ] CRM pages.
- [ ] Procurement/AP/reimbursement/banking pages.
- [ ] Reports/workflow/AI pages.
- [ ] Employee access advanced screens.
- [ ] Auth/account security pages if visual drift remains.

### Tests

- Web typecheck after each feature group.
- Unit tests for changed feature logic.
- Static regression test prevents legacy blue primary/tab/loading accents from returning in feature TSX files.
- Browser checks for desktop/tablet/mobile after local stack is running.

### Exit Criteria

- No feature page relies on a conflicting local visual pattern unless justified by its domain.

## Phase 4: Prototype Flow/API Expansion

### Goal

Implement prototype-only flows only after the backend contract exists.

### Tasks

- [ ] Choose next flow priority: inbox, bookings, broadcast, PO approval, discount policy, or CRM reports.
- [ ] Add/update backend endpoints and permission seeds.
- [ ] Add feature API clients.
- [ ] Add frontend pages using shared Mangmee components.
- [ ] Add unit/integration tests.

### Tests

- API tests for contracts and permission enforcement.
- Web tests for client helper/logic.
- Browser checks for critical user journeys.

### Exit Criteria

- New prototype flow is usable end to end with real backend support.

## Integration Verification

- Backend/API contract: Existing accounting/tax/dashboard APIs remain used; no fake new API was introduced.
- Web journey: Shell and representative pages are aligned.
- Loading/error/permission states: Existing feature states are preserved.
- E2E/browser screenshot check: Desktop captured; tablet/mobile screenshot capture pending.
- Desktop screenshot check: Playwright with system Chrome passed at `1600x900`; output `/private/tmp/watchdog-company-dashboard-fixed.png`.
- Remaining screenshot check: tablet/mobile capture.
- Runtime smoke check: dev server started at `http://127.0.0.1:3000`; `/` and `/login` return 200; unauthenticated workspace route redirects to login.
- Authenticated company smoke check: `Company / Company@123` login returns 200 and redirects to `/companies/seed-local-company/dashboard`; dashboard, inbox, and settings permissions routes return 200.
- Rendered dashboard HTML check: contains latest design labels including `ทุกสาขา (รวม)`, `สวัสดี นภา`, `฿86,400`, and the prototype menu order.
- Commands:
  - `corepack pnpm --filter @watchdog-bms/design-tokens build`
  - `corepack pnpm --filter @watchdog-bms/design-tokens typecheck`
  - `corepack pnpm --filter @watchdog-bms/design-tokens test`
  - `corepack pnpm --filter @watchdog-bms/web typecheck`
  - `corepack pnpm --filter @watchdog-bms/web test`
  - `corepack pnpm --filter @watchdog-bms/api typecheck`
  - `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/permission-registry.spec.ts`

## Risks

- Migrating every page at once can hide unrelated behavioral regressions. Continue by feature group with focused tests.
- The HTML prototype includes mocked flows. Do not treat mock data as production-ready API behavior.
- Visual parity should be confirmed with screenshots once the app is running locally.

## Open Questions

- Which prototype business flow should become the next backend-backed implementation target?
- Should the product switch from IBM Plex Sans Thai to Noto Sans Thai, or keep the current font stack?
- Should screenshot regression become a required CI check after seed data stabilizes?

## 2026-09-16 local UX correction batch

### Follow-up: company directory only

- [x] Separate company/user views and colocate each search/filter/results.
- [x] Extend existing metadata reads with bounded company search and pre-limit user-status filtering; retain permissions.
- [x] Translate directory actions/statuses, simplify visible columns and preserve search on return.
- [x] Verify focused API checks and local desktop/mobile journey; leave local ready and stop for owner review.


- [x] Reorder billing result/email settings and distinguish primary/secondary actions.
- [x] Reduce receipt footer clutter without removing reject/delete recovery.
- [x] Correct shared green action contrast; compact dashboard optional setup and queue summaries.
- [x] Move admin password confirmation beside final mutation and clarify action order.
- [x] Simplify AI empty guidance, admin navigation and advanced workflow settings.
- [x] Align local marketing copy/motion; preserve current brand/LINE artwork and production menu.
- [x] Run isolated local API/web with seeded review accounts, focused checks and desktop/mobile browser review; leave app running for owner.
- [x] Record evidence and residual limits. Hold merge, push, CI and deploy.

No schema, entitlement, authentication, payment-provider or tax-policy changes are planned. Existing backend controls remain authoritative.

Local proof and remaining native LINE/provider limits are recorded in `docs/agent-memory/mangmee-ux-audit-2026-09-16.md`. Follow-up gaps found while running locally: safe admin landing and race-free first-read billing settings initialization are included; no schema migration introduced.

Directory follow-up verification: API 37 tests, web support/lookup 23 checks, web/API typecheck and API build passed. Local E2E SYS-01, SYS-01A, SYS-01B, SYS-05 passed (4 distinct cases; failed cases fixed and rerun). Native Chrome desktop and 390px company/user views inspected. Shared sidebar confirmed by owner; environment comes from DEPLOY_ENVIRONMENT (UAT runs APP_ENV=production). No external CI, merge or deploy.


### Billing directory review follow-up

- [x] Add optional page/count to authorized overview without changing cursor clients.
- [x] Align billing list/navigation/copy and persistent search/reset with directory theme.
- [x] Replace generic contact footer with actionable read-error help using actual references.
- [x] Verify focused checks and local desktop/mobile journey; stop for owner review.

Billing directory verification: contracts/API build and web/API typecheck PASS; overview pagination unit3 PASS; local Playwright2 distinct cases PASS (desktop26 matching companies and mobile own trial fixture, including simulated503/reference/retry). Test data is created and removed by each case; no baseline company-count dependency. Native Chrome1512/390 inspected; viewport reset and local billing directory left open. Owner correction applied: Mangmee is the operator, so no contact/self-email footer. No CI, merge, push or deploy.

### Billing issue queue review follow-up

- [x] Rename queue and Stripe tools to concrete Thai tasks, preserving authorization.
- [x] Group themed filter, permanent clear, refresh, results and cursor navigation; clarify empty/error/disabled states.
- [x] Verify local issue list/detail/back/filter/paging/retry on desktop/mobile and record owner handoff.

Issue queue proof: web/API typecheck PASS; focused local billing-admin-directory E2E3/3 PASS (two existing directory cases plus queue fixtures/filter/paging/detail-return/mobile503+403/no mutation). Native desktop/mobile empty and populated lists and themed filter inspected; visual fixture cleanup completed. Older affected smoke selectors updated; full financial mutation smoke suite not rerun for this UI-only follow-up.


### Actionable billing issue detail follow-up

- [x] Add detail-only scoped original-invoice mapping and preserve metadata/financial permission boundaries.
- [x] Add concrete next-action guidance and inline existing invoice repair, with secondary tracking/contact notes and explicit result refresh.
- [x] Resolve exact verified paid-application issues in subscription/repeat/retry success paths through existing audited resolver.
- [x] Verify scoped resolution/idempotency/rollback plus local desktop/mobile detail journey; record simulations and remaining limits.
- [x] Leave local ready for owner review; no CI, push, merge or deploy.

Issue detail proof: API/web typechecks, contracts/SWC build and diff check PASS. New PostgreSQL suite:5 scenario subtests (+parent,6 TAP checks), including exact references/scope/evidence, rollback, source mapping, confirmed already-applied observation without regrant, closed-source admission, failed repair then verified recovery and revoked mutation permission. Local directory/queue E2E3 existing cases PASS; new detail E2E PASS on final code (real login/API/DB, ownership/manual tracking, preview/confirm, actual scoped worker, result/closure/back, missing-source recovery and simulated503/retry). Provider evidence is synthetic and no external Stripe call is made. Desktop1512/mobile390 native Chrome inspected, including expanded tracking; no overflow. A labelled local review fixture is retained for owner inspection. See billing-issue-resolution.json and task memory.

### Detail form preservation and action ordering

- [x] Replace full detail reload after actions with scoped reads/acknowledged updates; preserve concurrent drafts and URL context.
- [x] Theme contact controls, collapse team reassignment and keep result steps sequential.
- [x] Extend local regression for real contact actions plus tracking drafts, failures, repair ordering and mobile usability; inspect native Chrome and leave local for owner review.

### Embedded repair: one clear next action

- [x] Remove nested standalone chrome and redundant reveal/refresh controls; put editable reason/references/history in disclosures.
- [x] Keep inspect → explicit confirmation → observed result, automatically refreshing the issue only after terminal command evidence.
- [x] Verify local regression for clean initial/preview/history/cancel/recovery/final layouts and unchanged audit/source binding, then native desktop/mobile review. No CI, push, merge or deploy.

Follow-up proof: local Playwright billing-admin-directory 4/4 PASS; final detail-only rerun PASS after untouched-field rebasing and 403/retry/history coverage. Web and API typechecks and diff check PASS. Contact preview/commit/cancel/re-preview, queued command reads, source reload, in-place tracking saves, preserved DOM/drafts/disclosures/queue cursor, 503 recovery and revoked access were exercised using isolated local HTTP/PG and synthetic payment evidence. Native Chrome desktop1512/mobile390 inspected; no horizontal overflow. No CI, push, merge, deploy or external payment/email. Full provider/legacy mutation harness not rerun.

Sequential repair proof: final local billing-admin-directory E2E4/4 PASS and web typecheck/diff check PASS. Initial journey has one visible button and no UUID; preview has confirm/cancel only, excludes duplicate current history, and persists the exact invoice reference plus issue ID in the audited reason. Cancel/re-preview, prior source/command outage recovery and draft preservation still pass. Terminal command observation refreshes the actual issue result without a second user click. Native desktop/mobile preview inspected; local preview only, no final repair command submitted in native Chrome. Viewport restored.


### Operation history destination

- [x] Replace the standalone command detail presentation with task/status/facts/next-action sections and collapsed references; preserve shared command controller.
- [x] Carry validated issue/filter context through history and back; preserve direct and batch entry paths.
- [x] Verify local real-history navigation, permitted actions, stale/error/revoked states and desktop/mobile presentation; leave local for owner review.

Proof: local billing-admin-directory Playwright5/5 PASS (17.0s), final web typecheck and diff check PASS. Real local history → detail → submit/queued cancellation → history → detail → issue preserved queue/cursor; no worker/provider dispatched by the new history test. Simulated state/503/403/readonly variants verified. Desktop1512/mobile390 visually inspected; no horizontal overflow. Direct/batch links and invalid/duplicate return parameters covered. No CI, push, merge or deploy.


### Billing menu operator UX review

- [x] Inventory company, invoice, issue, settlement, recovery, adjustment and configuration routes and their user tasks.
- [x] Reorganize company landing around current status/open issues; separate documents/history/adjustments and remove competing default forms.
- [x] Align remaining billing fields/selects/cards/date copy and task navigation; remove self-links/self-email and exposed raw references where unnecessary.
- [x] Verify company journey and representative routes locally with desktop/mobile and read/permission/error states; record precise limits and leave company page open.

Proof: local Playwright billing-admin-directory + billing-admin-menu-ux10/10 PASS (42.2s); web typecheck and diff check PASS. Company read/pagination/URL-section/draft/permission journeys use actual local HTTP/PG; plan/invoice representative states use UI contract fixtures. All37 billing routes passed mobile heading/loading/back-link/overflow/client-error/no-write smoke checks; empty/missing detail paths are recovery coverage, not complete populated financial flows. Native Chrome desktop/mobile company and desktop settings inspected. Exact inventory and limits: `docs/evidence/mangmee-ux-audit-2026-09-16/billing-menu-operator-ux.json`. No CI/push/merge/deploy or real-provider execution. Ready for owner local review.

### Five destination clarity correction

- [x] Make settlement period selection task-oriented with themed date/time and Bangkok validation.
- [x] Restructure document/repair/blocked-plan pages around current state and actionable recovery.
- [x] Split settings editing by topic and separate edit/preview/confirm from emergency stop.
- [x] Exercise populated, blocked, source mismatch and denied states locally; native desktop/mobile review; record actual coverage.

Verification for this correction: 15 distinct local checks passed across the full run and focused fixes; web typecheck and diff whitespace check passed. The initial full run passed 14/15; the last settings test exposed an uppercase fixture label and a heading incorrectly overridden by `role=status`. Both were corrected, with settings/settlement and then plan/repair targeted reruns passing. This is UX/contract regression evidence, not proof of live Stripe money movement. Native Chrome reviewed the five supplied destinations and Thai date picker; viewport restored and settings left open for owner review. No CI, push, merge or deploy.

### Settlement result follow-up

- [x] Separate unobserved money from confirmed zero and partial results.
- [x] State outcome and next action first; move retries, cancellation and tracking into secondary controls.
- [x] Verify result-state matrix and action guards locally; review the actual user's run without changing its state.

Evidence: two new local Playwright tests passed for result states, source-review acknowledgement and cancellation confirmation (mocked provider/run responses). The existing range/idempotency test initially hit the one-minute safety margin at Bangkok midnight; its browser clock is now fixed to daytime and the focused rerun passed. Three distinct focused checks pass; final web typecheck and diff check pass. Native Chrome inspected the owner's existing result without executing it or changing its state. Details: `docs/evidence/mangmee-ux-audit-2026-09-16/settlement-result-clarity.json`. No CI, push, merge, deploy or real-provider mutation.
### Email and LINE settings theme follow-up

- [x] Organize company detail into persistent sections and group feature editing; verify navigation/drafts/support context locally.

- [x] Apply existing theme controls and task hierarchy to email status, retention settings and shared LINE settings.
- [x] Check history filters/pagination, draft preservation, configuration/permission states and desktop/mobile layout locally.
- [x] Record evidence and leave the local pages open for owner review; no CI, push, merge or deploy.

Verification: final focused Playwright run passed 5/5 (12.1s): email theme, LINE settings, company sections, SYS-02 company overview and SYS-04 feature confirmation cycle. Web typecheck and diff check passed. Email/LINE configuration variants use API fixtures; company sections use local seed data and SYS-04 uses an isolated local fixture. Native Chrome desktop inspected all three pages and left company overview, email and LINE open. Mobile 390px overflow/draft checks were automated. No live provider request, credential update, CI, push, merge or deploy. Evidence: `docs/evidence/mangmee-ux-audit-2026-09-16/email-line-company-ux.json`.

### Retained local review company's feature readiness

- [x] Diagnose the actual retained company's locked controls rather than rely on isolated E2E readiness.
- [x] Run scoped, hash-bound existing normalization with unchanged effective access; verify completeness, drift, provenance and idempotent replay.
- [x] Check enabled native controls and reversible draft, then repeat isolated saved off/on/off E2E.

Cause was incomplete local seed setup (no rows, set or normalization marker). Repaired only `seed-local-company` in local `mangmee_ux`; no safety bypass or application code change. Scoped verification passed; SYS-04 passed1/1 (5.1s). Native draft restored without saving. Evidence: `docs/evidence/mangmee-ux-audit-2026-09-16/local-company-entitlement-repair.json`. No CI/push/merge/deploy.

### Dashboard overview correction

- [x] Remove the standalone pending-receipt CTA; retain existing summary metrics.
- [x] Move the optional profile-completeness reminder under the dashboard header, preserving permission and dismissal behavior.
- [x] Local existing profile-completion browser tests passed at390/1280 (2/2,5.9s); web typecheck and diff check passed. Desktop test screenshot confirms reminder before overview; native Chrome confirms the banner is gone and respects the owner's existing snooze. No CI/push/merge/deploy.

## Owner amendment: AI works in context — 2026-09-17

- Owner approved hiding “AI แนะนำ” from primary navigation. Mark its shared menu binding `navigation: contextual`; exclude it from customer navigation, admin menu cards and sidebar preview. Keep existing authenticated suggestion review URLs and permission checks.
- Move `ai_line_assistant` switch to the existing background-work section; keep the same pending changes, lock/disable guards, review, audit and save path. AI entitlement, quota, starter 17 keys, provider readiness and final-mutation confirmation do not change.
- Starter remains seven capabilities: six navigation entries (including notifications in the header) plus background AI. Earlier seven-menu evidence describes the former presentation; no new feature replaces the removed menu.
- Verify navigation absence, allowed/denied direct-route access, retained AI permission grants, admin background toggle diff, local typecheck and browser smoke. No new contextual workflow, real provider call, migration, CI, merge or deployment in this amendment.

Local verification for the AI navigation amendment: contracts build and web typecheck PASS, web logic118/118, API binding8/8 and isolated AI browser2/2 PASS without skips. Native admin background section inspected. See [evidence](../evidence/mangmee-ux-audit-2026-09-16/ai-contextual-navigation.json). External provider behavior was not exercised.
