# MVP1 A1 + B5-web: CRM Web Wire-Up (Mangmee → real APIs) + B3 Web AI Panel — Implementation Plan

Status: Implement-ready 2026-07-09. Fixes the live-prod UI regression: prod serves static Mangmee prototype pages (PR #6) while real customer chats land in the DB unseen by staff.
Executor: Codex CLI under harness (Claude reviews/tests per phase, sends fixes back; owner/harness controls all commits — Codex never commits).
Scope: [[plans/mvp-1-two-dev-parallel-plan]] item **A1** (inbox wire-up) + **B5 web half** (AI panel, H1 unblocks mid-plan) + honesty banner on still-mock CRM routes + customers wire-up. Owner decision A (2026-07-08): Mangmee prototype is the go-forward UI — wire it up, do NOT restore old pages.
Authority: [[plans/mvp-1-crm-line-bill-capture-sequence]] Front-End Wire-Up Track (line 63) + Production Hardening Baseline (line 37); [[agent-memory/crm-customer-ai-agent-family]] B3 design + §27 display rule; [[specs/crm-line-oa-customer-os-spec]] §25/§27.

## Hard rules (violating any of these = wrong implementation)

1. **Mangmee design stays** (decision A): `InboxPrototypePage.tsx` and sibling prototype components remain the visual shell — same layout, classes, design-system components (`MangmeeCard` etc.), Thai copy tone. No visual redesign. `design_handoff_mangmee/` is design truth.
2. **Kill mock data on wired surfaces**: after each phase the wired page imports NOTHING from `mangmee-crm-data.ts` mock arrays (`CRM_CONVERSATIONS`, `CRM_CUSTOMERS`, `CRM_SEED_MESSAGES`, `CRM_BOOKINGS`). Pure presentational helpers/consts (e.g. `CONV_STATUS_META`, `TIER_META`, chip builders) may stay only if they now operate on real data. NEVER render mock rows as a fallback when an API call fails — render the error state.
3. **Contracts + existing clients only**: all data via `apps/web/src/features/crm-inbox/crm-inbox.api.ts` and `apps/web/src/features/crm/crm.api.ts`, typed with `@watchdog-bms/contracts`. New client functions go INTO those files (or `crm-ai-assist.api.ts` in Phase 3) using `authedApiFetch` — no direct `fetch`, no new fetch helper, no react-query/SWR (repo uses plain `useState`/`useEffect`).
4. **Real-page conventions**: mirror `InboxPage.tsx` (the bypassed reference implementation) for: loading / error / `ForbiddenState` (403) / empty states with Thai copy; permission gating (`crm.inbox.reply` composer, `crm.inbox.note` notes, `crm.inbox.resolve` status/priority/tags, assign rules, `crm.customer.read` panel, `crm.template.read` templates); 350ms debounced search; 10s polling paused on `document.hidden`; stale-response abort (`listAbort` ref pattern); `markConversationRead` on open.
5. **No backend edits in Phases 1/2/4** (web-only). Phase 3 backend delta is limited to B-owned `crm-ai-*` files in `apps/api/src/modules/crm-inbox/` + additive `packages/contracts/src/crm-ai.ts` types. Do not touch Dev A-owned API files, `schema.prisma`, or migrations (none needed).
6. **No backend ⇒ hide, don't fake**: features whose backend does not exist yet are removed/hidden with a one-line `{/* MVP1-x: <what> arrives with <item> */}` comment — never left rendering mock behavior. Applies to: auto-reply chip/toggles + fabricated `withAutoReply` replies (B7), slip-verify actions (A3 payment-proof queue), AI auto-booking flow (8C/B10), branch chips (`MANGMEE_BRANCHES` — no branch filter on the API).
7. **Derive, never invent**: presentational fields the API doesn't provide (avatar initial, avatar color, time-ago, wait-minutes) are derived deterministically from real fields (name, customerId hash, `lastInboundAt`, `firstResponseDueAt`). No fabricated scores/tiers/LTV anywhere.
8. **XSS-inert**: customer-supplied text renders as text nodes only. No `dangerouslySetInnerHTML`.
9. **No commits, no `git add`, no new dependencies, no edits outside the files each phase lists.** Do not start dev servers; verification commands only.
10. Phase 1 ships the AI tab as a disabled placeholder ("AI Assist กำลังจะมา") — no `/ai/*` calls until Phase 3.

## Environment quirks (read before running anything)

- Node: shell defaults to v14. Prefix EVERY command session: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Web typecheck runs `next typegen` first: `pnpm --filter @watchdog-bms/web typecheck`. Web unit tests: `pnpm --filter @watchdog-bms/web test` (tsx --test glob `src/**/*.spec.ts` — globbed, NOT an explicit list; api/ai-gateway DO use explicit lists in `package.json` `"test"`).
- After editing `packages/contracts`: `pnpm --filter @watchdog-bms/contracts build` before dependent typechecks.
- API tests (Phase 3): `pnpm --filter @watchdog-bms/api test`; Prisma CLI needs explicit `DATABASE_URL` from repo-root `.env` (docker :15432/watchdog_bms) — `apps/api/.env` is stale.
- Do not commit — the harness owner controls commits.

## Phase 1 — `/inbox` wire-up (A1, the prod regression fix)

Files: `apps/web/app/(workspace)/companies/[companyId]/inbox/page.tsx`, `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx`, `apps/web/src/features/crm-inbox/inbox-prototype.model.ts` (+ its spec if present), `apps/web/src/features/crm-inbox/crm-inbox.api.ts` (only if a client fn is missing). Reference (read, do not edit, do not delete): `InboxPage.tsx`.

- **W1 route session props**: restore the pre-PR#6 pattern (git `ef93ddb1^` version of this page.tsx): `fetchServerSession(companyId)` from `@/common/auth/server-session`, `redirect('/login?next=…')` when null, render `<InboxPrototypePage companyId userId={session.userId} permissions={session.permissions} />`.
- **W2 conversation list**: replace `CRM_CONVERSATIONS`/`decorateConversations` mock reads with `listConversations(companyId, filter)` → `ListCrmConversationsResult`. Status chips map to real `statusCounts` + `overdueCount` + `mineCount` + `unassignedCount` (chips: ทั้งหมด / overdue / mine / unassigned / per-status; DROP the mock `auto` chip per rule 6). Search box → `search` param (350ms debounce). Pagination → `page`/`pageSize` (keep page size 10). Poll list every 10s (hidden-tab pause, abort stale).
- **W3 thread**: `getConversation` → `CrmConversationDetail.messages: CrmMessageSummary[]`. Map to bubbles: `direction INBOUND`=customer left, `OUTBOUND`=staff right; `visibility INTERNAL_NOTE` = note style (prototype `dir:'note'`); `deliveryStatus` badge (PENDING spinner / SENT / FAILED + `deliveryError` tooltip); `messageType IMAGE` (+`attachmentId`) renders `<img>` from `GET /api/v1/companies/{c}/crm/conversations/{id}/messages/{messageId}/content` (same-origin authed URL — plain `<img src>`, cookies ride along), `FILE` = download link with `contentMeta.fileName`, `STICKER` = sticker placeholder, `LOCATION` = `contentMeta.address` text. `markConversationRead` when a thread opens; refresh open thread on the same 10s tick.
- **W4 composer**: reply → `sendReply` (disable while `sending`, show `sendError`, append returned `message`, update list row from returned `conversation`); note mode → `addInternalNote`. Gate by permissions per rule 4. If the Mangmee design has a quick-reply/template affordance wire it to `listMessageTemplates`; otherwise skip templates this phase.
- **W5 right panel (Customer tab)**: `getCrmCustomer(companyId, customerId)` (from `crm.api.ts`, `crm.customer.read`-gated like InboxPage) for profile fields (displayName, phone, consentStatus, tags…). Real actions: status (`setConversationStatus`), priority, tags (`setConversationTags`, full replace), assign (`assignConversation` — self pickup "รับเรื่อง" + release; full reassign only with `crm.inbox.assign`). SLA display from `firstResponseDueAt`/`slaBreachedAt`; wait-minutes derived from `lastInboundAt`. Deep-link "ดูโปรไฟล์เต็ม" → `/companies/{companyId}/crm/customers/{customerId}` (real Customer 360). Prototype-only blocks (purchases, LTV, course, appointment card, slip verify, AI booking) follow rule 6.
- **W6 AI tab placeholder** per rule 10 (keep the tab shell so Phase 3 slots in).
- Keep `inbox-prototype.model.ts` helpers that are pure presentation (chip building, paginate) by retyping them over contract types; DELETE mock-coupled ones (`buildAutoReplyMessage`, booking-slot helpers) together with their spec cases; update `inbox-prototype.model.spec.ts` accordingly (web test glob picks it up automatically).

Verify (Codex runs): `pnpm --filter @watchdog-bms/web typecheck` + `test` + the offline `next build --webpack` all green; `grep -n "mangmee-crm-data" apps/web/src/features/crm-inbox/InboxPrototypePage.tsx` returns nothing (or only `CONV_STATUS_META`-style presentational consts per rule 2); `git diff --check`.

## Phase 2 — prototype-data banner on still-mock CRM routes

New tiny component `apps/web/src/common/components/prototype-data-notice.tsx` (`PrototypeDataNotice`, Mangmee-styled dismissless banner: "หน้านี้แสดงข้อมูลตัวอย่าง (prototype) — ยังไม่เชื่อมต่อข้อมูลจริง"). Mount at top of `BookingsPrototypePage.tsx`, `BroadcastPrototypePage.tsx`, `CrmReportsPrototypePage.tsx`, `CustomersPrototypePage.tsx` (removed from customers again in Phase 4). Nothing else changes. Verify: web typecheck + build.

## Phase 3 — B3 web AI panel (B5-web, needs Phase 1 merged) + trust read endpoint

Backend (B-owned files only):
- **W1 trust read**: in `crm-ai-assist.use-case.ts` append `CrmAiTrustReadUseCase` — `requirePermission(ctx,'crm.ai.assist')`, load conversation via existing scoped-load helper (404/ABAC like siblings), read customer `trustScore`/`trustScoreFactorsJson`/`trustScoreComputedAt` via `crm-ai-context.repository.ts` (append one read method), return `{ trustScore, tier, factors, computedAt }` with tier from `trustTierOf(score)` in `crm-ai-trust.logic.ts` (append): `null → 'NEW'`, `≤80 → 'BUILDING'`, `>80 → 'TRUSTED'` (mirrors §27: >80 only via verified identity + real-world event). Controller: append `@Get(':conversationId/ai/trust')` to `crm-ai-assist.controller.ts`. Register use-case in `crm-inbox.module.ts` (append-only). Pure read — NO gateway call, NO recompute.
- **W2 contracts (additive)**: `packages/contracts/src/crm-ai.ts` append `CrmTrustTier = 'NEW'|'BUILDING'|'TRUSTED'` + `CrmTrustReadResult { trustScore: number|null, tier: CrmTrustTier, factors: CrmTrustFactor[]|null, computedAt: string|null }` (reuse existing `CrmTrustFactor`).
- **W3 API spec cases**: append to `crm-ai-assist.use-case.spec.ts` (already in api test list — no `package.json` edit): permission denied; out-of-scope conversation; unscored → `{trustScore:null,tier:'NEW'}`; 80 → BUILDING; 81 → TRUSTED.

Web (B-lane naming — panel files contain `AiPanel`):
- **W4 client** `apps/web/src/features/crm-inbox/crm-ai-assist.api.ts` (new): `requestAiSummary` / `requestAiReplyDraft({tone?})` / `requestAiInsights` / `sendAiFeedback({kind,rating,comment?,requestId})` (all POST) + `getAiTrust` (GET), typed with contracts crm-ai types.
- **W5 panel** `apps/web/src/features/crm-inbox/InboxAiPanel.tsx` (new): fills the Phase 1 AI tab. Sections: **trust tier chip** (labels ใหม่ / กำลังสร้างประวัติ / น่าเชื่อถือ — per §27 display rule NEVER show a bare low number; factors behind an expandable "รายละเอียด"); **สรุปบทสนทนา** (button → summary, show `summaryText` + regenerate); **ร่างคำตอบ** (draft → show `draftText` + [แทรกลงช่องพิมพ์] into composer + [คัดลอก] + regenerate; insert only when `crm.inbox.reply`); **Insights** (intent/sentiment/risk chips + `leadScore` labeled "คะแนนความสนใจ (advisory)" + `nextBestAction`); **thumbs UP/DOWN** per section posting feedback with that result's `requestId` (required). Every call handles the full status union: `ok` / `uncertain` ("AI ไม่แน่ใจ ลองอีกครั้ง") / `refused` / `unavailable` ("AI ไม่พร้อมใช้งานชั่วคราว" + retryable hint) — HTTP is 200 for all; busy spinners per action; errors never crash the tab. Panel renders only when `crm.ai.assist` ∈ permissions (else the tab keeps the Phase 1 placeholder).
- **W6**: mount in `InboxPrototypePage.tsx` AI tab (pass conversationId, permissions, composer-setter callback). Add `InboxAiPanel` behavior notes as a colocated `crm-ai-assist.api.spec.ts`/model spec only if pure logic is extracted; UI itself is covered by the harness browser pass.

Verify (Codex runs): contracts build; api typecheck + test (full suite); web typecheck + test + build; `git diff --check`.

## Phase 4 — `/customers` wire-up

Files: `apps/web/app/(workspace)/companies/[companyId]/customers/page.tsx` (session props like W1), `apps/web/src/features/crm/CustomersPrototypePage.tsx`, `customers-prototype.model.ts` (+spec), `crm.api.ts` typing only if needed.
- List via `listCrmCustomers(companyId, {search,status,page,pageSize})` (`crm.customer.read`; `ForbiddenState` on 403). Directory columns from real `CrmCustomerSummary`: displayName, customerType/status chip, primaryPhone, consentStatus, owner, lastActivityAt. Mock tier/score/LTV columns + tier KPI cards follow rule 6/7 (drop or replace with real counts: total from `total`, per-status via the `status` filter — do NOT fabricate tiers).
- Search debounced; pagination real; profile modal keeps Mangmee look with real fields; CTA deep-links to `/crm/customers/[id]` (already real). Remove the Phase 2 banner from this page.
- Update `customers-prototype.model.spec.ts` for retyped helpers; mock-only helpers deleted.

Verify: web typecheck + test + build; no `mangmee-crm-data` import left in `CustomersPrototypePage.tsx`.

## Harness verification per phase (Claude, not Codex)

Diff review against this plan + ponytail; then servers `api-verify-3011` + `web-verify-3002` (launch.json), seeded docker DB (harness seeds CRM dev data — channel/customers/conversations/messages; LINE sends will land FAILED+deliveryError locally with dummy creds, which exercises the real failure UI), browser pass: login → `/inbox` list from DB → open thread → send reply → note → status/assign/tags → forbidden/empty/error states → (P3) AI panel actions incl. degraded `unavailable` path → (P4) customers directory. Playwright smoke may be added by harness if stable.

## Done criteria

- `/inbox` on a real session shows DB conversations/messages, mutations persist, zero mock reads; prod-blocking regression closed at the route level.
- Still-mock CRM routes visibly say so (banner) until their backends land.
- AI panel live behind `crm.ai.assist` with all four assist actions + trust tier per §27; degraded provider path graceful; feedback rows persist with requestId.
- `/customers` lists real customers with real fields only.
- All listed verification commands green per phase; evidence + file lists appended to [[agent-memory/mvp1-a1-web-wireup]] and cross-linked from [[agent-memory/mvp-1-crm-line-bill-capture-sequence]] + [[agent-memory/crm-customer-ai-agent-family]] (panel half); two-dev plan A1/B5 status updated.

## Out of scope (do not build)

`/bookings` wire-up (A7 appointments backend first), `/broadcast` + `/crm-reports` real wire-up (no backend exists), employee-access settings prototypes (`/settings/roles|permissions|access-overview|employees` — separate item), `MangmeeModulePrototypePage` placeholder routes, auto-reply UI/toggle (B7), template management UI, payment-proof marking (A3), any `schema.prisma`/migration change, websocket/SSE transport (polling stays).
