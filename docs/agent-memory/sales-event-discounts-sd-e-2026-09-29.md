# Agent Memory: sales-event discounts — SD-E (reports and admin screens)

Status: implemented on `claude/sales-event-sd-e-20260929` (not pushed); discount path only, credit columns wait for SD-F
Owner: Claude (SD-E), coordinated by the sales-event controller session
Scope: plan `docs/plans/sales-event-discounts-plan-th.md` §2 SD-E; spec `docs/specs/sales-event-discounts-spec-th.md` §7.1, §9, §10, SD-E18, SD-E20

Decisions:
- Report route `GET /v1/sales/events/report` lives in its own controller and service (`sales-event-reports.*`), apart from SD-A's `SalesEventsController`.
- Guard follows spec §9: `sales.report.read`, plus `assertPlatformTenant`. A lead and SYSTEM_ADMIN see every team through `visibleAgents`, optionally narrowed; MANGMEE_SALES has no access. The coordinator approved this on 2026-09-29.
- The report covers tickets ISSUED in the Bangkok month range, grouped event name → batch → เซลล์.
  - Counts: issued, used as discount, in payment (RESERVED), still usable, expired (ISSUED with expiresAt ≤ now), revoked.
  - Money:
    - discount given = Σ appliedDiscountSatang where USED and DISCOUNT;
    - received and refunded = Σ over the bill of each such ticket (invoiceId is unique, so each bill counts once);
    - open liability = Σ discountSatang of tickets still usable.
  - Never reads or writes SalesAttribution (SD-Q3).
- The report fold runs in memory over at most 5,000 tickets and returns `truncated` beyond that. There is no index on `createdAt` (no migration). Switch to SQL GROUP BY with an index if volume grows.
- Admin:
  - The lookup matches an 8-character serial (no 0/O/1/I) exactly, before the id-suffix search, and links to the shop's admin page. An unused serial answers `BILLING_LOOKUP_EVENT_TICKET_UNUSED`, to platform scope only; scoped operators get a plain 404.
  - The shop's admin page lists up to 25 of its discounts. The amount and the bill link require `system.billing.financial.read`.
- Issue kind `EVENT_DISCOUNT_REVIEW` (constant `BILLING_EVENT_DISCOUNT_REVIEW_ISSUE` in contracts): Thai label, and a next step in the resolution panel that links to the bill. SD-C raises the issue, with `referenceId` set to the invoice id.

Open questions: none

Deferred:
- To SD-F: the "used as credit" count on screen, the credit units granted, and a credit use's lot on the admin page.
- To SD-A's PG spec: report cases (used as discount, as credit, expired, refunded, one bill once).
- Also deferred: shop names per used ticket in the report (spec §10).

Artifacts: see the branch diff (contracts, sales-console report service and controller, billing-admin lookup and company, web reports view, admin shop page, issue panel)

Verification (2026-09-29, worktree `/private/tmp/mangmee-sales-event-sd-e-20260929`):
- contracts: build + typecheck exit 0; web typecheck (`next typegen && tsc --noEmit`) exit 0
- API: native TypeScript typecheck (`api-typecheck.sh`, serialized tsc lock) rc=0; a JS `tsc` subset over the touched files and their imports exit 0; `test:boot` exit 0 (Nest resolved every provider); `check-di-metadata.mjs` exit 0
- specs: `sales-event-report.logic.spec.ts` 7/7; `billing-admin-lookup.spec.ts` 15/15 (4 new); `spec-suite-coverage.spec.ts` 3/3; web `sales-event-report.logic.spec.ts` 3/3, `sales-console.qa.spec.ts` 38/38, `api-error-coverage` + `billing-display` + guard specs 30/30
- pins `--check` current; `git diff --check` clean; whole-chain (`node scripts/run-line-ai-whole-chain-acceptance.mjs`, heavy lock, 14:17–14:18) exit 0
- not run: PG spec (SD-A's `sales-event-discounts.pg.spec.ts` is not on this branch), browser check at 390 px (owner minimal-testing directive)

Next: merge after SD-A, SD-C and SD-D. In `sales-console.module.ts` the providers line conflicts with SD-A: keep both services.
