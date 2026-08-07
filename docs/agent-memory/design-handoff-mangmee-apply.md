# Agent Memory: Apply มั่งมี Flow A Design Handoff to App Flows

Status: First slice DONE 2026-07-06 — CRM Inbox (15A Phase 2 core triage) implemented per the design and live-verified. Remaining design screens mapped below, parked in their owning plans.
Owner: Product owner (thawatchai); implemented via Claude (Fable 5).
Scope: Owner delivered a Claude Design code handoff at `design_handoff_mangmee/` (repo root, untracked) and asked to apply it to the app flows ("apply กับ flow").

## The handoff bundle

- `มั่งมี Flow A.dc.html` — interactive design reference, ALL Phase-1 screens (visual source of truth; NOT production code).
- `types.ts` / `api.ts` / `permissions.ts` / `routes.md` — prototype-extracted domain model, API contract, RBAC registry, route map. **Reference only**: the repo's real contracts (`@watchdog-bms/contracts`), permission registry, and `companies/[companyId]/*` routing remain authoritative (same binding decision as [[plans/mangmee-auth-permissions-ui-plan]] §2: backend model is final authority; prototype's simpler menu×action matrix is not adopted).
- `README.md` — behavioral spec per screen incl. design tokens, status colors, responsive rules.
- Supersedes the older `~/Documents/WatchDog/version_1/` copies referenced by the auth/permissions migration plan; tokens identical (the HTML mirrors `@watchdog-bms/design-tokens`; the design says `@mangmee-bms` — same values).

## Design screen → repo mapping (decision record)

| Design screen | Repo state after this pass | Owning plan/phase |
|---|---|---|
| Login (email/password) | DONE earlier (2026-07-05 auth UI migration) | mangmee-auth-permissions-ui-plan Phase 1 |
| Login: phone+OTP, LINE QR | Not built (needs SMS provider / 02C) | auth plan Phase 2-3 backlog + [[plans/web-line-login-plan]] (02C) |
| Dashboard KPI/menu tiles | Existing generic dashboard; NOT restyled this pass | web-core-workspace / item 06 surfaces |
| **Inbox (กล่องข้อความ) — CRM core** | **BUILT THIS PASS** — 3-pane per design at `/companies/[companyId]/inbox` on real 15A APIs | crm-line-oa-customer-os-plan Phase 2 (core triage slice) |
| AI panel in inbox (สรุป/ร่างตอบ/auto-booking) | Placeholder tab with reason (per plan placeholder-with-reason pattern) | 15A Phase 4 + 8C |
| Customers (ลูกค้า) + profile modal | Existing item-15 CRM workspace (generic styling); side panel in inbox reuses `getCrmCustomer` | item 15 web restyle = future pass |
| Bookings week grid | No backend (CrmAppointment) yet | 15A Phase 6 |
| CRM Reports | No backend aggregates yet | 15A Phase 5 |
| Broadcast (AI composer) | No backend yet | 15A Phase 8 |
| Permissions (ตำแหน่ง/รายบุคคล/wizard) | DONE earlier restyle on the REAL RBAC model | mangmee-auth-permissions-ui-plan Phase 1 |
| PO Approval tiers | Greenfield module | auth plan Phase 3 backlog #5 |
| Discount Policy | Greenfield; feeds 15A 8C auto-discount | needs owner scope (not in any plan yet) |

## What was built this pass (15A Phase 2 core triage slice)

Backend (`apps/api/src/modules/crm-inbox/`):
- `POST .../conversations/:id/messages` — staff reply → LINE push (new `LineMessagingAdapter.pushTextMessage`, UUID retry key). DB-first (PENDING row) → push → SENT/FAILED; on SENT: status auto-advance per design (ส่งข้อความ → รอลูกค้า = `statusAfterStaffReply`), preview/lastOutboundAt update, `firstRespondedAt` set once; on FAILED: no advance, no firstRespondedAt, deliveryError kept.
- `POST .../conversations/:id/notes` — internal note; separate route + permission so the note path is structurally unable to reach LINE (plan's "structural send-rejection").
- `PUT .../conversations/:id/status` — manual triage status; RESOLVED stamps resolvedAt/By, manual un-resolve clears them (auto-reopen owns reopenedCount).
- `PUT .../conversations/:id/assign` — assign/unassign (no membership validation — same precedent as item-15 lead assign; tighten with Phase 2 ABAC).
- `POST .../conversations/:id/read` — clears unreadCount.
- List API: `search` (customer name via two-step lookup — no Prisma relation conversation→customer — OR preview contains), `overdue` filter, `statusCounts` + `overdueCount` (company-wide, for chips), `assignedToDisplayName`/`lastInboundAt` on summaries.
- Overdue definition (chip "เกิน 30 นาที") = first-response SLA only: status ∉ {RESOLVED,SPAM} ∧ firstRespondedAt null ∧ firstResponseDueAt < now (`isConversationOverdue`). ponytail: mid-conversation SLA arrives with CrmInboxPolicy + scanner (Phase 2 full).
- Permissions: `crm.inbox.reply` (MEDIUM) / `note` (LOW) / `assign` (MEDIUM) / `resolve` (LOW) registered + granted to ADMIN/MANAGER/SALES (OWNER automatic); synced to local DB (305 permissions, 1155 grants).
- Send endpoint permission gating note: `@RequirePermissions` guard is AND-semantics (`hasAll`) — hence the separate /messages vs /notes routes instead of one route with two keys.

Web (`apps/web/src/features/crm-inbox/` + route `app/(workspace)/companies/[companyId]/inbox/page.tsx`):
- `InboxPage.tsx` — 3-pane Flow A: status chips w/ live counts + เกิน-30-นาที chip (only when >0), searchable paginated list (10/page) with avatar color hash, status pill, ⏱ badge, unread badge, ดูแลโดย line, red inset border on overdue; thread with bubbles (in=white/left, out=brand-500/right, failed=red tint + ส่งไม่สำเร็จ, note=amber centered 🔒); composer with ส่งหาลูกค้า/โน้ตภายใน tabs (note visible ONLY in note tab per design), Enter-to-send; status dropdown; รับเรื่อง/เลิกดูแล; right panel tabs ข้อมูลลูกค้า (real data via item-15 `getCrmCustomer`) + AI ช่วย placeholder (Phase 4 reason). Mobile = single-pane list↔thread with ‹ back; xl shows col 3.
- 10s polling for list + open thread, paused when tab hidden (plan: refetch isolation for later SSE).
- Server route passes `session.userId` + permissions from `fetchServerSession` (UI gating only; server re-authorizes).
- Nav: `inbox` module (ChatIcon, `crm.inbox.read`, operate group after dashboard) + `module.inbox` th/en dictionary keys.
- Thai-first literals in feature (precedent: LineOaSettingsPage in same feature).

## Verification (2026-07-06, local)

- contracts build, api+web typecheck clean; api tests 993/993, web tests 163/163 (new: triage logic + use-case specs, web inbox helpers spec).
- `prisma migrate deploy` + `tsx prisma/sync-permissions.ts` on local Postgres (docker compose.local).
- Live click-through (dev-login as seed OWNER): channel seeded with real cipher; 3 signed webhook events → real ingestion (200, 2 conversations); inbox renders chips/counts/SLA badge; open thread clears unread; internal note posts + hidden in reply tab; รับเรื่อง → ดูแลโดย Local Owner; status → รอทีมภายใน; reply with fake token → FAILED path verified end-to-end (red bubble + ส่งไม่สำเร็จ + plain-Thai banner; no status advance; audit `crm.inbox.reply` FAILED). DB rows + 4 audit actions verified. Desktop 3-pane + mobile single-pane screenshots checked. Smoke rows cleaned after.
- Real-LINE SENT smoke still needs a physical channel — standing external blocker (same as Phase 1).

## Open questions

- Discount Policy screen has no owning plan/spec — owner to scope (feeds 8C auto-discount read-only card).
- Dashboard restyle per design (KPI cards + menu tiles) unowned — candidate small pass.
- Prototype `permissions.ts` menu×action matrix intentionally NOT adopted; if owner wants that UX later it must map onto capability packs (10C+), not replace them.

## Next

- ~~Media download~~ DONE 2026-07-06 second pass (image/sticker/location/file bubbles now render real content — see [[agent-memory/crm-line-oa-customer-os-15a]] media-slice section).
- 15A Phase 2 remainder: templates/quick replies, tags/priority, CrmInboxPolicy + SLA scanner + breach notifications, assignment ABAC scope, spam action.
- Then Phase 3 (Customer 360 + in-conversation actions) picks up the design's profile modal + quick actions.
