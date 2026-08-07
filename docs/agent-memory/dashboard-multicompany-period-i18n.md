# Agent Memory: Dashboard multi-company + period-aware CRM + menu icons + EN i18n

Status: In progress (code complete for items 1–3 & 5-phase1; item 4 pending visual; final QA pending)
Owner: worasak
Scope: Five fixes reported on the running local app (branch `sunday`):
1. More than one company (header company switcher).
2. Demo data spread across all branches.
3. CRM dashboard period tabs (today/7d/month/quarter) actually change the cards; lists paginate (>10); zero cards populated.
4. Sidebar menu icons centered in their colored frames.
5. EN language toggle switches the UI (phase 1: core screens), keeping customer-entered Thai.

Decisions:
- Item 1: one extra company (Bloom Beauty Clinic, `seed-local-company-2`) + owner & company-view memberships so `fetchMyCompanies()` returns 2.
- Item 3: made the CRM daily-brief period-aware in code (not just seed).
- Item 5: phased — Dashboard delivered first; other feature pages follow.

## Changes

### Item 3 code — period-aware CRM daily-brief
- `apps/api/src/modules/crm-inbox/domain/logic/crm-daily-brief.logic.ts`: added `bangkokPeriodBounds(kind, now)` (precise UTC+7; `today`=Bangkok day, `week`=last 7 days, `month`/`quarter`=current). `buildDailyBriefWidgets(..., periodLabel)` suffixes the three date-scoped widgets.
- `crm-daily-brief.use-case.ts`: `execute(ctx, { periodKind }, now)`; dated metrics use `countCustomersBetween`/`countBookingsBetween`/period window; open-queue metrics (unanswered/SLA/payment-proofs) stay current-state.
- `prisma-crm.repository.ts`: added `countCustomersBetween`.
- Controller `crm-conversation-actions.controller.ts`: `GET .../crm/daily-brief?period=` (validated).
- Web: `crm-inbox.api.ts` `getCrmDailyBrief(companyId, period)`; `DashboardPages` passes `periodKind` to `CrmDailyBriefCard` (refetch on change).
- Tests: `crm-daily-brief.use-case.spec.ts` updated (execute signature, `countCustomersBetween` mock) + new period test.

### Items 1/2/3 seed — `apps/api/prisma/seed.ts`
- Company 1 (Room45): `ROOM45_CUSTOMER_AGE_DAYS` spreads `crmCustomer.createdAt` → today 2 / 7d 7 / month 9 / total 14. Retagged k11 with `complaint`. Linked k4 → counterparty; added overdue INVOICE (`INV-LOCAL-0002`), issued QUOTATION (`QT-LOCAL-0001`), and a payment-proof AttachmentObject+Link — so the previously-zero cards fire.
- Company 2 (Bloom): `SECOND_COMPANY` + `seedBloomDemoWorkspace` (`BLOOM_BRANCHES` + 12 `BLOOM_CUSTOMERS`), spread across HO/BLM-CTW/BLM-LAD (4/4/4) and periods (today 2 / 7d 7 / month 8 / total 12 → inbox paginates >10). Memberships for owner + company-view.
- Fast seed loop (no image rebuild): `docker compose cp apps/api/prisma/seed.ts api:/app/apps/api/prisma/seed.ts` then `exec api sh -c 'cd /app/apps/api && ./node_modules/.bin/tsx prisma/seed.ts'`. Seed is idempotent (upsert). `createdAt` set in both create + update so re-seed on an existing volume still spreads dates.

### Item 5 i18n (phase 1) — Dashboard + inbox/customers/expenses
Extended beyond Dashboard: InboxPage, CrmPages + Customer360Page, ExpensesPages localized via 3 parallel subagents (prefixes `inbox.` / `customers.` / `expenses.`). 434 keys merged into workspace-dictionary.ts (th+en) with `scratchpad/merge_i18n.py` (unescapes `&amp;`, escapes quotes, inserts before each object's closing brace). Also fixed `INBOX_SCOPE_ALL_ROLES` to include `COMPANY_VIEW` (crm-inbox.logic.ts) so napa's complaint/avg-first-response cards show company-wide data (was assignee-scoped → 0).

### Item 5 i18n (phase 1) — Dashboard (foundation)
- New `apps/web/src/common/i18n/locale-context.tsx` (`WorkspaceLocaleContext` + `useWorkspaceLocale`); provided in `WorkspaceShell` around `{children}` so the header toggle live-updates page content (the `useLocale` hook only syncs its own instance).
- `workspace-dictionary.ts`: added `dashboard.home.*`, `dashboard.period.last7/quarter`, and `card.*` keys (th+en).
- `DashboardPages.tsx`: all UI strings via `t()` + `useWorkspaceLocale`; CRM card labels rendered by widget key (`CARD_LABEL_KEY`) with period suffix on dated cards. Customer/mock Thai left intact.

### Item 4 — menu icons (pending)
- Root-cause candidate: some sidebar SVGs have non-square viewBoxes (`dollar-line.svg`/`file.svg` 25×24, `bolt.svg` 24×26) while `globals.css .menu-item-icon-wrap svg` forces equal width/height. Needs visual confirmation before editing (symmetric padding is a no-op; only content-bbox recenter changes rendering).

## Verification
- Seed spread + zero-cards verified via psql (counts today/7d/month, branch distribution 4/4/4, payment_proofs/quotation/overdue = 1, napa in 2 companies).
- Build `docker compose build api web` compiles TS for both (typecheck gate).
- Pending: manual QA in browser — company switcher shows 2, branch filter per branch, period tabs change cards, EN toggle on dashboard, icon centering.

## Next
- Rebuild api+web, restart, manual QA.
- Item 4 fix after seeing the rendered sidebar.
- Item 5: extend to InboxPage, Customer360Page, CrmPages, ExpensesPages.

Credentials: system admin `thawatchai.watchdog`/`watchdogbms11`; owner `owner@watchdog.local`/`Owner@12345`; company-view `napa@room45.co`/`Company@123`.
