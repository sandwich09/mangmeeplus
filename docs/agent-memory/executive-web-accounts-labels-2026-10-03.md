# Agent Memory: executive web accounts and report labels

Status: Implemented and locally verified, uncommitted. Final focused tests 30/30, web typecheck exit 0, whole web suite 2689/2689 with no skips. Controller review and browser/API acceptance remain.

Owner: E4a web implementation lane, 2026-10-03; controller reviews and commits.

Scope: UI spec §9.2 EX-07/08 and §9.3 partner labels/filters only. No report screens, API/schema/migration changes, dependencies, package.json edits, deployment or git mutations.

Decisions:

- Plan followed: read specs/contracts/controllers/services and existing sales/partner/shared patterns; write red logic and wiring tests; implement pure logic plus existing shared components/authenticated fetch; update specs; focused tests and locked web checks.
- Account routes are `/system/executive-users`, `/new`, `/[userId]`. Existing System Admin shell stays; account subtree and header entry check `system.executive_user.manage`. The subtree uses Thai ForbiddenState with the shared section-denied message, not the broader SystemAccessDenied claim that the caller lacks the whole admin console. Executive reader shell/login/report work belongs to the other lane.
- Account search/status/page live in `q`, `filter_status`, `page`; API receives `status`. Contract provides the four statuses. Reuse shared Pagination (scoped 44px buttons), themed fields, cards/badges, loading/error/forbidden states and useInputPrompt.
- Every account action confirms display name and username, requires a trimmed 1–500-character reason, and sends only the contracted status/access/credential command. REVOKED has no actions; ACCOUNT_PROTECTED hides all actions. Account denials clear loaded identity and credentials. Command failures require a fresh read before another command; reasons survive for correction.
- Create defaults both rights off, omits blank optional contact fields, preserves typed values after errors, and attaches backend fieldErrors to the correct username/email input.
- Credentials remain only in component state, with expiry, copy pending/success/failure, and manual delivery wording. Access/status changes preserve a still-visible handoff; close/navigation, replacement password or access/account refusal removes it. Reset reads current server status because a suspended account remains suspended. No automatic delivery claim, storage or secret logging.
- Label saves always contain only the two report labels, including active companies; reuse PATCH and `system.partner_company.update`. The separate overview form stays available for held/archived companies and read-only for callers without update permission. Platform classification offers only INTERNAL.
- Reuse contract classification/filter keys and industry labels. Classification words live in one web map because report-labels.ts supplies classification keys but no Thai classification labels. Both fields display their own actor name/time only when present. Clearing the admin industry can fall back to the shop's business type; show the saved effective group explicitly.
- Partner filters use `reportClassification` and `reportIndustryGroup` in URL/API, reset paging, clear with the existing filters, and participate in existing count/empty states. No extra count query.
- New account words and report-label words each live in their logic module; API error sentences live in the existing mapper. Export explanation follows existing export scope (rights/filters), avoiding the inaccurate claim that every company is always in a file.

Open questions:

- Settled by the controller 2026-10-03: the right reads “ส่งออก Excel”; Excel stays as a product name, as on the other pages of the app (e.g. `expenses.export_excel`).
- Browser rendering, actual HTTP/permission/session outcomes, PostgreSQL and clipboard permission behavior: **not checked**, prohibited/unavailable in this lane. Unit tests simulate fetch and wiring tests inspect source using the repository's existing pattern.
- Existing partner page has unrelated English technical text/native fields in older sections. Not changed; E4a adds only the report-label section and filters. Industry v1 content's owner approval remains the E2 note's existing open point.

Artifacts:

- `apps/web/app/system/executive-users/{layout,page}.tsx`, `new/page.tsx`, `[userId]/page.tsx`.
- `apps/web/src/features/executive-users/{ExecutiveUsersPage,ExecutiveUserPage}.tsx`, `executive-users.api.ts`, `executive-users.logic.ts` and its logic/QA specs.
- `apps/web/src/features/system-partners/PartnerReportLabels.tsx`, `report-labels.logic.ts` and spec; wiring in PartnerDetailPage, PartnerListPage, system-partners.api and partner detail route.
- `apps/web/app/system/layout.tsx`, SystemHeader and api-error-message wiring.
- UI spec §9.2/§9.3/status line and plain-language spec account wording updated in this diff.
- Ignored local verification logs: `docs/agent-memory/executive-e4a-*.log` (not part of diff; results recorded below).

Verification:

Commands below use paths relative to apps/web with prefix `pnpm --filter @watchdog-bms/web exec node --import tsx --test`:

| Files / command | Red evidence | Green evidence |
|---|---|---|
| `src/features/executive-users/executive-users.logic.spec.ts src/features/system-partners/report-labels.logic.spec.ts` (initial 19 tests) | Before production changes: exit 1, 0 pass / 19 fail | Exit 0, 19 pass / 0 fail |
| `src/features/executive-users/executive-users.qa.spec.ts` (initial 9 tests) | Before production changes: exit 1, 0 pass / 9 fail | Exit 0, 9 pass / 0 fail |
| All three E4a specs (final 30 tests) | Temporarily replaced changed production files with `git show HEAD:<path>` contents and removed only the newly added production files; restored all bytes in a Python finally block. Exit 1, 0 pass / 30 fail | Restored implementation: exit 0, 30 pass / 0 fail / 0 skip |
| QA + `src/common/components/button/action-loading.spec.ts` | Whole suite found missing loading props. Strengthened handoff test also checked copy pending: exit 1, 19 pass / 2 fail | Added pending indicators and duplicate-copy guard: exit 0, 21 pass / 0 fail |
| QA permission test, strengthened to reject the overly broad admin-console denial | Exit 1, 9 pass / 1 fail with SystemAccessDenied | Scoped Thai ForbiddenState: all three E4a specs exit 0, 30 pass / 0 fail / 0 skip |
| QA handoff test, strengthened to preserve credential during access/status save | Exit 1, 9 pass / 1 fail on the implementation that cleared it | Removed that clear: all three E4a specs exit 0, 30 pass / 0 fail / 0 skip |

Heavy commands all ran through:
`/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`

- `pnpm --filter @watchdog-bms/web typecheck`: first exit 2 (nullable assertions and discriminated-union construction in new tests only); corrected, subsequent exits 0. Latest run after handoff and scoped-denial corrections: exit 0, no type errors.
- `pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"`: first exit 1, 2688 pass / 1 fail / 0 skip; pending-state coverage was the sole failure. After fix: exit 0, 2689 pass / 0 fail / 0 skip, 546 suites. Latest run after handoff and scoped-denial corrections: exit 0, 2689 pass / 0 fail / 0 skip, 546 suites.
- Every whole-web run used a child environment with ALL names starting `S3_` removed; no values were printed.
- `git diff --check`: exit 0; repeated after the final note update.
- No command was refused with EPERM / Operation not permitted. No network, Docker, browser, server or PostgreSQL attempted. Contracts unchanged, so no contracts rebuild required.

The 30 new test cases: seven account logic cases (URL, statuses/actions, command payload/reason, confirmation/rights copy, create validation/defaults/body, API field errors, expiry), eight individual error-code cases, five partner cases (URL, choices/platform, labels-only body, provenance, actual mocked-fetch URL/PATCH), ten wiring cases (permissions/routes, list/stale/mobile/paging, create/values, confirmations/refusals, one-time handoff/copy, fresh-read after failed command, themes, partner filters, partner permission/locks, six account requests).

Next:

- Controller review and commit; run real PostgreSQL specs with the existing disposable test database variables:
  - `SALES_CONSOLE_TEST_DATABASE_URL`: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/sales-console/sales-console.pg.spec.ts`
  - `REPORT_LABELS_TEST_DATABASE_URL`: `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/system-partner-management/report-labels.pg.spec.ts`
- Browser acceptance against the running integrated stack (not checked here), 390×844 first; then 320, 768, 1024, 1440, zoom 200%, keyboard-only and device dark preference:
  - `/system/executive-users`: header link present/absent by manage permission and direct denied route; search input and four-status dropdown at top; search/clear/back/reload/deep-link/page 2; cards below 768 and fixed table above; long name/username; zero results as text, out-of-range page, loading/slow stale response, denied/server/network error and retry. Paging controls below results.
  - `/system/executive-users/new`: four text fields (username, display name, optional mobile/email), two initially unticked checkboxes below fixed read right, no rights dropdown; empty/invalid/duplicate username/duplicate email/permission/server error keeps values; pending prevents repeat create. Success shows one-time panel above detail: expiry, copy pending/success/rejection, close, navigation/reload cannot reveal it. Access/status changes keep a still-visible panel.
  - `/system/executive-users/[userId]`: all four statuses, no-action REVOKED; each right on/off, suspend/reactivate/reset. Every action opens the shared modal with display name/username and required multiline reason (empty/whitespace/500/501, cancel, retained after failure). Confirm stale/protected/revoked/denied outcomes, refresh-before-next-command after failure, returned rights/status, expiry past/future/null, suspended reset stays suspended, reset cancels old sessions via real API.
  - `/system/partners`: existing search/status plus two report dropdowns in the top toolbar. All classification choices, industry ALL/UNSET, combined search/status, count, zero result, clear, page reset, Back/reload, loading/error and pending requests.
  - `/system/partners/[companyId]?view=overview`: two themed selects in the new report section below company info, each actor/time below its own field; choices include clear, industry options from contracts, platform only INTERNAL; saved effective industry explains mapped fallback. Save active/suspended/held/archived, inspect PATCH contains only labels, verify updated actor/time and report next-build note, save error preserves values, forbidden/read-only has no enabled write. No actor means no invented provenance line.
  - Open/close EVERY dropdown by pointer/keyboard, Escape/outside click, switch directly between dropdowns, selection/search, disabled choices, portal not clipped or off-screen. All inputs/checkboxes/reason field need visible focus/error/disabled states and 44px mobile targets; no horizontal overflow.
