# Agent Memory: proactive-expense-summary

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (spec §16.1 M1–M9)

Owner: Expenses / Notifications lane (backlog ข้อ 14 of `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`)

Scope:
- Weekly LINE summary on Mondays 08:00 (Asia/Bangkok), opt-in, sent only in weeks with something to report. Plain words and amounts, no %, ranks or multiples.
- Four rule-based "ควรดู" signals: spike against the shop's own history, a new vendor with a high amount, possible duplicates, claims waiting more than 7 days to be paid.
- ภ.ง.ด.3/53 and ภ.พ.30 due-date rows, shown only when true for the shop.
- Menu "รายจ่ายตามหมวด" opening `/income-expense-ledger?side=expense` in an expense-only mode.
- Retire `daily_owner_summary` through every path that can create it.
- Zero AI calls. At most one push per **subscribed membership** per week: up to 5 a month in five-Monday months, and a person subscribed in two shops gets two.

Decisions (cited in the spec):
- **Opt-in storage:** a new table keyed by `membershipId` (cascade). An account merge moves memberships (account-merge.use-case.ts:219), so the subscription follows with no extra code. The `close_duplicate` case moves or drops the row inside the merge transaction. `NotificationPreference` is not used, because creating a row freezes the trigger list (notification.use-cases.ts:366-372).
- **Opt-in surface:** "บัญชีของฉัน". Sold packs cannot open notification settings (owner decision 2026-10-04).
- **Eligibility:** `expense.read`. Unsubscribing never needs it.
- **Rights are checked at three points:**
  - Sweep: `resolveAccess` before building the card.
  - Delivery, inside the push transaction, in this lock order with no shortcut: entitlement advisory (shared) → `Company FOR SHARE` → membership `FOR UPDATE` → read the subscription and current rights in the transaction → compare with the card's audience → SUPPRESSED `SUMMARY_AUDIENCE_CHANGED`, or push and commit.
    - Rights writers take `Company FOR UPDATE` via `lockPlanTermCompany` (update-role.use-case.ts:71). A revocation either commits first or waits until the push has committed.
    - Unsubscribe locks the same membership row.
  - Bell: the list and the unread count filter before pagination.
- **Number basis:**
  - CONFIRMED expenses by `expenseDate`, with line-level categories as in income-expense-ledger.use-case.ts:161-165.
  - Money is THB only, plus a count row for other currencies. The ledger page's expense side gets the same fix (B8, plan 1.2). The home page (B9) is owner-gated (M4).
  - A2's "seen before" history check is company-wide with no branch filter. The amounts are scoped.
  - Scope is `branchScopeWhere`: scoped branches plus central rows (branch.logic.ts:80-83), the same as the ledger page the card links to.
  - The claim is "same basis", not "same numbers": the page is monthly and the card is weekly.
- **Event creation:** `executeInTransaction` (the advisory lock per dedupKey) with a new `onlyIfAbsent` flag.
  - Supersession matches the source (membership) and `createdAt < new`, through a new `resolveEarlier` option `matchBy: 'source'`.
  - It never matches on the shared ledger URL, which prisma-notification.repository.ts:194 would otherwise use.
- **Signals:**
  - A2 vendor identity: the union of keys `cp:<counterpartyId>` and `tax:<13 digits>` (snapshot or the counterparty's taxId), so both directions of a later counterparty link count as the same vendor.
  - A4 reuses one pure `claimPayableSince`, moved out of workflow-scan-candidates.use-case.ts:216-220, so a payment voided today does not count as already waiting. Claims whose duplicate block is CONFIRMED are excluded.
- **Tax rows:**
  - ภ.ง.ด. rows reuse the PND adapter `ExpenseSourceAdapter.findConfirmedWithWhtByCompany`, which keeps only `paidAtConfirmed` payments (expense-source.adapter.ts:111). One row per form.
    - The form comes from a pure `withholdingFormType` extracted from sync-tax-events.use-case.ts:60-77. PND2 and unknown payee kinds give no row.
    - Filed coverage is checked per payment with `withholdingPaperPayments` (withholding-filing-state.ts:73-76), never by `TaxPeriod` status.
  - ภ.พ.30 needs a live REGISTERED fact whose period overlaps the tax month (Revenue Code §85, registration date). §83 says VAT is filed per establishment unless consolidated filing is approved; the row states only the due date.
  - Showing tax rows only to unscoped subscribers is a product limitation, not a legal claim.
  - The card says "ภายใน <base day>": 7 or 15 on paper, 15 or 23 online, with +8 days only while the statutory due date is on or before 2027-01-31.
- **Retire the daily summary:**
  - The use case becomes inert, `daily_owner_summary` leaves `IMPLEMENTED_TRIGGER_KEYS` and joins `RETIRED_TRIGGER_KEYS`, and the rule is hidden from the list with re-enabling rejected.
  - A migration disables the rules, resolves the open events and suppresses queued deliveries.
  - The cron stays.
- **Retention:** no notification purge exists in the repo. The weekly sweep purges summary events older than 13 months for **every** company (Q7), independent of subscribers and company status, in batches, even when sends fail. The cascade removes recipients and deliveries.
- **Account merge:**
  - The subscription follows the membership, and pending summary recipients of moved memberships go to the surviving user in the merge transaction.
  - `close_duplicate`: the closed membership's open summary is resolved if the surviving membership already has one for that week; otherwise its recipient moves.
  - The sweep iterates subscription ids and, inside the create transaction, locks the subscription and membership rows (`FOR SHARE`) and re-reads the owner. This closes the merge/creation race that `onlyIfAbsent` would otherwise freeze.
  - Guaranteed only once implemented and tested (spec AC21, AC29).
- **Expired package:** GET/DELETE `expense-weekly-summary/me` only (PUT is not opened) must pass three separate gates:
  - the term-expiry gate in auth.guard.ts:294-305;
  - the term-recovery path at :245;
  - the resolver's rejection when every selected branch is disabled (prisma-permission-resolver.repository.ts:108-109), which needs a narrow session-plus-membership context.
  - Whether the guard supports that context is open: M7. AC28 covers all three cases.
- **Deep link:** `#weekly-summary` is added to `COMPANY_PROFILE_SECTION_IDS` and scrolls after the card loads (cold open and hashchange).
- **Wording:** the web never promises a send date ("ตรวจครั้งถัดไป…", "จะดูให้…และส่งถ้ามีเรื่องให้สรุป").
- **UI evidence:** a real browser at 390 and 1280 (thai-ux-standard.md:110-117), plus about 1,556 for the owner. Measure the buttons.

Open questions (owner — business only, recommendation in brackets):
- Q1: opt-in only? [yes]
- Q2: a one-time offer line on the home page? [yes]
- Q3: anomalies in the weekly card only? [yes]
- Q4: send nothing in a quiet week? [yes]
- Q5: which plan is the OA `@695ultfm` on, and what is the budget? [check; move to Basic 1,280 THB + VAT if it is Free]
- Q6: show the ภ.พ.30 due-date row without a VAT screen? [yes, row only]
- Q7: keep summaries 13 months? [yes]

Artifacts:
- docs/specs/proactive-expense-summary-spec.md
- docs/plans/proactive-expense-summary-plan.md
- Sources:
  - https://lineforbusiness.com/th/service/line-oa-features
  - https://lineforbusiness.com/th/news/20240619_1
  - https://developers.line.biz/en/docs/messaging-api/pricing/
  - https://www.rd.go.th/62348.html
  - https://www.rd.go.th/39808.html
  - https://www.rd.go.th/5207.html (§83)
  - https://www.rd.go.th/5208.html (§85)
  - MoF announcement No. 8 via https://www.ryt9.com/s/rdn/3502705 and the RD VAT-refund manual

Verification:
- Docs only; no build and no tests (no node_modules).
- The coordinator re-opened every code citation from the first draft, and all held.
- I re-read every citation added in this revision against the worktree.
- Not verified (owners and next steps in spec §16.1 M1–M6):
  - M1: every rights writer locks `Company` or the entitlement advisory, in a compatible order.
  - M2: the permission resolver can read inside the delivery transaction.
  - M3: whether non-THB expenses can actually be created.
  - M5: adapter cost per subscriber.
  - M6: what the resolver grants during term recovery.
  - M7: a narrow guard context for cancellation.
  - M8: the role-disable race. `DisableRoleUseCase` counts assignments before its transaction without locking Company (disable-role.use-case.ts:24-33), while update-employee assigns roles at :288.
  - M9: the currency column and totals in the ledger export.
  - whether Production ever ran seed.ts;
  - the OA plan and its monthly volume;
  - the full text of MoF announcement No. 8 on rd.go.th (listing page returned HTTP 500);
  - whether any other direct `execute` producer can overlap (B7);
  - the holiday reason for the 26 Oct 2569 ภ.พ.30 date.

Review 2026-10-24 (Codex gpt-6-astra review F1–F21 → where it is fixed):
- F1 no revalidation before send → spec §8 (three check points), §7 Delivery; plan 3.5; AC7
- F2 supersession via the shared URL → spec §7 Supersession (`matchBy: 'source'` + createdAt), B6; plan 3.3; AC5
- F3 non-idempotent direct execute → spec §7 sweep step 4 (`executeInTransaction` + `onlyIfAbsent`), B7; plan 3.3; AC4
- F4 unsold grants bypass presets → memo §3 and D4 (backend `set-partner-features.use-case.ts:75` and per-card switch `PartnerDetailPage.tsx:1346`)
- F5 WHT basis without `paidAtConfirmed` → spec §5.3; plan 3.2; AC10
- F6 central rows in scope → spec §5.1 (adopted `branchScopeWhere`), §10.5 label "รวมส่วนกลาง"; AC6; the memory claim corrected to "same basis"
- F7 VAT status at send day → spec §5.3 (registration overlapping the tax month, §85); plan 3.1 `registeredDuringMonth`; AC11
- F8 payable-since semantics → spec §5.2 A4 (`claimPayableSince` + duplicate block); plan 3.1/3.2; AC12
- F9 counterparty identity transitions → spec §5.2 A2 (key union); AC9
- F10 daily producer not retired → spec §7 "เลิกสรุปรายวันจริง", §6 migration; plan 2.3; AC15
- F11 account merge → spec §6 (`membershipId` + close_duplicate); plan 2.5; AC17
- F12 retention unverifiable → spec §1 (no purge exists), §5.6 (13-month purge in the sweep), G7, Q7; AC18
- F13 guaranteed send dates → spec §10.3 wording ("ตรวจ", conditional toast)
- F14 1280 px evidence → spec §14 Browser; plan header and every UI step; AC13
- F15 "company-wide" filing claim → spec §5.3 (§83 per establishment; product limitation)
- F16 invalid example → spec §10.1 regenerated from a fixture (mean 5,000, card dated 2 พ.ย. with October tax rows) and used as the test fixture
- F17 BOT Your Data → memo §2 bank row (receiver eligibility not established; SME role-disclosure deferral ว. 2409/2569)
- F18 RA-17 too broad → memo §2 thai_tax row (component events keep branchId at sync-tax-events.use-case.ts:157; the legacy header path at :207 omits it)
- F19 CRM reports called a prototype → memo §2 CRM row (`CrmReportsPrototypePage.tsx:110` reads scoped backend data; binding still `planned`)
- F20 wrong citation → spec §5.1 and plan 3.2 cite income-expense-ledger.use-case.ts:161-165
- F21 4.35 is not a ceiling → spec §5.5 (up to 5 a month, plus other notices)

Review Round 2 (2026-10-24, Codex ultra; 19/21 round-1 items RESOLVED, P1 and P12 PARTLY, 13 new):
- P1 / R2-F1 (HIGH) delivery not synchronised with revocation → spec §8 point 2 a–e (lock order advisory → Company → membership; rights read inside the transaction; no shortcut); §16 shortcut removed; interleaving tests (i)–(iv) in spec §14; AC19; M1/M2 must close before plan 3.5
- P12 / R2-F5 retention skipped companies with no subscribers or not ACTIVE → spec §5.6, §7 step 5 (global purge, always runs); plan 3.4; AC18
- R2-F2 currency mixing → spec §5.1 (THB only + other-currency row), §13 B8 (ledger) and B9 (home), G10, M3/M4; plan 1.2 fixes the ledger; AC23
- R2-F3 PND2 routing → spec §5.3 (adapter + `withholdingFormType`; PND2 and unknown give no row); AC22
- R2-F4 filing coverage per form and payment → spec §5.3 (`withholdingPaperPayments`, no `TaxPeriod` status); AC22
- R2-F6 pending recipients on merge → spec §6 (move `NotificationRecipient.userId` for summary events); plan 2.5; AC21; G9 for other notices
- R2-F7 limit per subscribed membership → spec §2 goal 3 and §5.5; this memo's Scope; plan decision 1
- R2-F8 unsubscribe after expiry → spec §7 GET/DELETE recovery route; plan 2.4; AC20; M6
- R2-F9 A2 history check filtered by branch → spec §5.2 A2; plan 3.2 (history query exempt)
- R2-F10 §83 exception in the memo → research memo thai_tax row (approved consolidated filing)
- R2-F11 fragment scrolling → spec §10.3; plan 2.6; AC24
- R2-F12 "เท่า" over-match → spec AC14 and §14 (multiplicative only; "เท่ากัน" passes)
- R2-F13 ledger screens hidden by `ACCOUNTING_UI_HIDDEN` → research memo ledger row; spec §1 notes `/income-expense-ledger` is not hidden
- No HIGH open. Open MEDIUM/LOW items that reading code could not settle are M1–M6 in spec §16.1.

Review Round 3 (2026-10-24, Codex ultra; 29/34 RESOLVED, P25/P27/P28/P29/P30 PARTLY, 7 new, no HIGH → last round):
- P25 legacy filing uncertainty → spec §5.3: no row when a paper has `rowsCertain=false` or a keyless line covers a document (`withholding-filing-state.ts:63`; `rowsUncertainNotice` at `generate-wht-report.use-case.ts:197`); AC27
- P27 close_duplicate and the creation race → spec §6 (resolve or move; locked owner re-read in the sweep); plan 2.5 and 3.4; AC29
- P28 budget per subscribed membership → spec §16 and plan 4.3
- P29 independent expiry gate and disabled branches → spec §7 DELETE row (a)–(c); plan 2.4; M7; AC28
- P30 A2 history exempt from scope in the test rule → spec §14 provider test line
- R3-F1 role-disable race → M8 (and part of M1)
- R3-F2/F3 D4 must derive from the purchased package or approved deal snapshot, and cover classification changes → research memo D4
- R3-F4 map adapter rows to `expense.record` / `row.id` / `sourceLineKey` before the filing helper → spec §5.3; plan 3.2
- R3-F5 ledger CSV/XLSX → spec §11 Export (keep other-currency rows, currency column, per-currency totals); plan 1.2; M9; AC30
- R3-F6 a USD-only week is not quiet → spec §5.4; AC25
- R3-F7 strict "over 7 days" → spec §5.2 A4 (`<`); AC26; plan test

Next:
- Close M1–M9 before the phases named in plan (spec §16.1).
- Then Phase 1.
- Then Phase 1, which is independent.
- Get the Q5 answer before any deploy.
- B3, B5 and B7 are separate follow-ups.
