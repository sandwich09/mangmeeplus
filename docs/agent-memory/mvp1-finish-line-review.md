# Agent Memory: MVP1 Finish-Line Review (Claude ⇄ Codex cross-review harness)

Status: DONE 2026-07-12 — review only, no code changed. Findings adversarially verified by BOTH engines (Claude 45-agent workflow + 7-claim adjudication; Codex CLI gpt-5.6-sol xhigh diff-review + gap-audit + consult round where each side accepted/rebutted the other). All disagreements resolved with file:line evidence.
Owner: thawatchai. Reviewers: Claude (this session) + Codex CLI 0.144.1 (`codex exec -m gpt-5.6-sol -s read-only`).
Scope: finish-line gap/bug/not-integrated audit for MVP1 loops A (CRM/LINE/AI) + B (bill/receipt/reimbursement), reviewed at HEAD `e03126d1` (clean tree; the former 45-file WIP was committed mid-review via merge `6a9a2d76` + fix `e03126d1`, pushed).

Verification (all green at e03126d1): contracts build PASS, api typecheck PASS, web typecheck PASS, api suite 1494/1494 (406 suites) PASS. Prod = image `ecs-d8b2f3fc`; undeployed delta = 40 commits (30 non-merge) incl. 9 new migrations (latest `20260712140000_crm_booking_canonical_customer`).

## P0 — fix before/at deploy (code)
1. **AI auto-booking books wrong duration** — `resolveRequestedBookingWindow` uses `extract.durationMinutes ?? 60` (`crm-auto-reply.logic.ts:108`) but the gateway prompt FORBIDS the model returning duration ("ERP Core applies bookingDurationMinutes", `crm-prompts.ts`), and `service.bookingDurationMinutes` (`crm-ai-auto-reply.use-case.ts:173`) is used only for slot proposals — so every autonomous booking is written as 60 min; 90/120/180-min services get double-booked in the tail. Fix: build the window from the catalog duration before isSlotFree/book. (Codex found; Claude confirmed mechanism end-to-end.)
2. **/crm-reports shows fabricated data** — funnel 62%/40%/฿2,650 multipliers + hardcoded "71% campaign" insight + broadcast CTA that 404s (`CrmReportsPrototypePage.tsx:50-59,170`). Remove or wire to real sales facts.
3. **Retention avg-LTV always ฿0 for real companies** — reads `crmCustomer.lifetimeValueAmount` which only seed.ts ever writes (`prisma-crm-inbox.repository.ts:349`); topCustomers on the same page correctly uses the received-payments bridge. Derive retention LTV the same way.
4. **Reimbursement receipt journey unusable + gate fakeable** — UI requires typing a raw attachmentId (no upload/expense-picker; `updateReimbursementDraft` unused) (`ReimbursementsPages.tsx:117`), and the API gate is truthiness-only (`!!input.primaryAttachmentId`, no existence/ownership/tenant check; `reimbursement-request.use-case.ts:45,181`).
5. **e2e bookings harness contract-stale** — still posts `customerName`; contract now requires `customerId` (`e2e/bookings.spec.ts:57`) → BOOK-03..06 fail before testing lifecycle. Fix before trusting the e2e gate for deploy.

## P0 — deploy/ops
- Deploy the 40-commit delta (canary posture per ops memory — never probe during bake). Hazards: `crm_booking_canonical_customer` makes `customerId` NOT NULL → stale cached web bundles posting `customerName` 400 briefly; deploy.sh `all` order (api→gateway→api) is safe but NEVER deploy gateway-first — new gateway hard-requires `catalog` on reply-draft/booking-extract (`crm-customer-ai-internal.controller.ts:64,102`) and would brick AI replies against old api; S3 CORS step in deploy.sh is non-fatal-on-failure → verify CORS independently after deploy.
- Set `TYPHOON_OCR_API_KEY`; align LIFF Login-channel ↔ OA messaging-channel provider; enable `CRM_AUTO_REPLY_ENABLED` + per-channel toggle for the pilot channel.

## P1 — pilot week
- `retention` should be optional in contract + guard web derefs (`crm-inbox.ts:422`; `CrmReportsPrototypePage.tsx:168,204`) — rollback/skew crash window.
- Dashboard-notification LINE dispatch uses ONE global `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` for all companies (`notification.use-cases.ts:316`) — breaks multi-company.
- Item-06 producers unscheduled: worker schedules only `delivery.sweep`; `daily_owner_summary`/`snapshot.generate`/`stock_low.scan` never fire (`notification-worker.ts:40`); workflow-template daily summary defaults disabled.
- Reimbursement `approved`/`rejected` outbox events have no consumer → requester never alerted (spec `reimbursement-approval-spec.md:717`; only `request_submitted` bound in workflow catalog).
- GC9 deep-link hydration still open (destination pages read no filter params; `crm-daily-brief.logic.ts:106` also hardcodes `?period=today` on a period-aware card).
- Reports page: sales cards render silent zeros on 403 (needs `crm.inbox.read`); CSV export race labels stale data with new period; CSV formula-injection guard (prefix `=,+,-,@`).
- Trust signals `keptAppointments`/`noShows90d` still hardcoded 0 (`crm-ai-context.repository.ts:~129`) despite NO_SHOW shipped.
- Seed/demo: Bloom tenant lacks document sequences/ops config (422 on accounting flows), Bloom conversations have no CrmMessage rows, message-upsert createdAt asymmetry on re-seed.
- ABAC hygiene: `INBOX_SCOPE_ALL_ROLES` conflates read-scope and the write-side assignee gate; COMPANY_VIEW+SALES combo gets company-wide reply/resolve (pre-existing pattern with other roles; split read-all vs write-all lists like `crm.logic.ts:208-209`).

## P2 / backlog
- BookingsPrototypePage (and remaining pages) still on per-instance `useLocale()` — header EN/TH toggle doesn't update them; crm-reports page fully hardcoded Thai; Customer360 fixed th-TH date/money formats.
- Dashboard snapshot period bounds Mon-Sun + server-TZ parse are LATENT only (sole provider `InventoryHealthProvider` ignores bounds) — fix before any period-consuming provider is added.
- E2E holes: LIFF (needs real idToken), Level-0/Level-2 autonomy, Typhoon OCR ok-path, crm-reports/daily-brief tiles, receipt-backed reimbursement UI journey.
- master-implementation-checklist 15A/06 lines stale; generic line-ai `receipt-ocr.agent` stub returns dead `/receipts/upload` link (real OCR path is the webhook one).

## REFUTED — do not chase (verified with evidence)
- "Inbound media never retried" — FALSE: `retryMedia` sweep re-fetches attachmentId:null rows every 60s, only content_too_large/media_type_unsupported terminal.
- "Catalog not authoritative at staff booking API" — INTENDED per `crm-product-service-catalog-plan.md` "Deliberate limits" (snapshot design); AI path DOES revalidate catalog.
- "Default period=today breaking change" — intended product decision (d5471cc8); sole caller always sends period.
- "Mon-Sun vs trailing-7 week / TZ shift visible on dashboard" — latent metadata only; nothing consumes snapshot bounds.
- "'นภา' greeting fallback / Thai fallback strings reachable in EN" — dead code paths (displayName NOT NULL etc.).
- (Historic) "LINE-notification dispatch gap" — pipeline exists; the real residual is the unscheduled producers above.

Artifacts: Codex outputs in session scratchpad (`codex-diff-review.out`, `codex-gap-audit.out`, `codex-consult.out`); Claude workflow journals `wf_6f4a103b-f09`, `wf_41075db8-8c3`.
Next: owner picks P0 batch → new build harness (Codex executor + Claude gate per established pattern) → deploy per ops list above.
