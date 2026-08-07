# Feature: มั่งมี Flow A — Design Handoff → Backend Integration

## 1. Status

- Roadmap/checklist item: follows item 15A (CRM LINE OA) + 10C/10D (Employee Access) + มั่งมี auth migration Phase 1
- Owner: Owner (supapron)
- Date: 2026-07-05
- Source bundle: `/design_handoff_mangmee` (`README.md`, `types.ts`, `api.ts`, `permissions.ts`, `routes.md`, `มั่งมี Flow A.dc.html`)
- Thai summary: `Doc/mangmee-flow-a-be-integration-summary-th.md`
- Implementation plan: `docs/plans/mangmee-flow-a-be-integration-plan.md`

## 2. Goal

Wire the มั่งมี Flow A high-fidelity design (login + RBAC management + LINE OA CRM suite:
inbox, customers, bookings, CRM reports, broadcast, PO-approval tiers, discount policy)
to the real WatchDog-BMS backend. The handoff ships its own idealized API contract
(`api.ts`) and RBAC model (`permissions.ts`); this spec defines how each handoff concept
maps onto the existing backend — what is reused as-is, what is extended, what is net-new,
and where the handoff contract is **adapted** rather than copied.

## 3. Source Docs

- Product/overview: `docs/specs/sme-business-os-overview.md`
- Related specs: `docs/specs/crm-sales-spec.md`, `docs/specs/employee-access-role-management-spec.md`, `docs/specs/auth-authorization-rbac-spec.md`, `docs/specs/permission-matrix.md`, `docs/specs/ai-gateway-agents-spec.md`
- Related plans: `docs/plans/crm-sales-mvp-plan.md`, `docs/plans/employee-access-role-management-plan.md`
- Thai context summaries: `Doc/crm-line-oa-customer-os-summary-th.md` (15A), `Doc/mangmee-auth-ui-migration-summary-th.md`
- ⚠️ The full EN docs referenced by those Thai summaries (`crm-line-oa-customer-os-spec.md`/`-plan.md`, `mangmee-auth-permissions-ui-plan.md`, `docs/agent-memory/crm-line-oa-customer-os-15a.md`) are **missing from the repo** — this spec + plan are their replacement of record.

## 4. Critical repo fact: the baseline lives on one branch

| Branch | Contains |
|---|---|
| `feat/employee-access-v2-phase1-smart-roles` (tip `43ec451`) | **Everything below.** Superset of `develop`: 15A CRM inbox Phase 0+1 (`apps/api/src/modules/crm-inbox`, item15a migrations), มั่งมี login/permissions UI, auth self-service (password reset/verify email/sessions/rate-limit/TrimStringsPipe/`AuthMailerPort`), Employee Access v2 (capability packs, role templates, branch-scope update), httpOnly chunked-cookie BFF (`apps/web/app/api`, `watchdog_token.0..N`) |
| `migrete-ui-with-be` (current) | = `develop` tip only. **None** of the above |

**All work in this spec assumes the feat branch as baseline** (Phase 0 of the plan merges it into `migrete-ui-with-be`). Gap statements below are relative to that baseline, not to the current checkout.

## 5. Non-goals

- Copying the prototype HTML as production code (design reference only).
- Facebook/IG channels, customer-facing LIFF pages, AI auto-reply to customers (15A backlog).
- AI **image-model** generation for posters (poster = deterministic template render; see D9).
- Phone+OTP login **until an SMS provider is chosen** (endpoint shape reserved; see D11).
- The accounting placeholder menus (`sales`, `journal`, `salesdoc`, `reports`, `closing`, `notifications`) — menu entries + existing modules only; no new BE work in this scope (matches handoff "Phase 1 scope").

## 6. Architecture decisions

### D1 — Base branch
Merge `feat/employee-access-v2-phase1-smart-roles` into `migrete-ui-with-be` before any new code. Rationale: it strictly contains the current branch plus every already-reviewed capability this integration needs (15A inbox, mailer port, branch scope, BFF). Re-implementing on the current branch would duplicate ~4 reviewed workstreams.

### D2 — URL & tenancy adapter (handoff `/api/*` → real `/v1/companies/:companyId/*`)
The handoff contract is flat and company-implicit. The real backend is company-path-scoped with global prefix `v1`, reached from the browser via the BFF rewrite (`/api/:path*` → API origin). **The backend keeps its conventions.** The web data layer (single `authed-fetch` client) owns the mapping:

- `api.ts` stub `fetch('/api/conversations?...')` → real `GET /api/v1/companies/{companyId}/crm/conversations?...`
- `branch` query param → `branchId`; the UI's virtual `"all"` branch → **omit** `branchId` (server treats absence as "all branches visible to caller", intersected with membership branch scope).
- Handoff `{items, total}` list envelope → real `{items, total, page, pageSize}` (superset, no FE break).
- Handoff DELETE verbs map to existing disable/archive POSTs where the backend is soft-delete by design (users, roles, customers).

### D3 — RBAC: permission keys stay canonical; the menu matrix is a projection
The backend's flat permission-key RBAC (`module.resource.action`, deny-by-default guard, capability packs) remains the **only** authorization mechanism. The handoff's `role × menu × [view|create|edit|del|approve]` matrix becomes a **server-computed projection**:

- New code registry `MENU_REGISTRY` (contracts package): the 16 `MenuId`s, each mapping `action → required permission key(s)` (e.g. `inbox.view → crm.inbox.read`, `inbox.create → crm.inbox.reply`, `roles.edit → access.role.manage`). Menus and routes mirror `permissions.ts`/`routes.md` from the handoff.
- `GET .../access/matrix` computes `PermissionMatrix` from each role's granted keys through the registry (owner row hard-coded all-true, locked).
- `PUT .../access/matrix/{roleId}/{menuId}` translates checked actions back to permission-key grants and reuses the existing role-update use case (full-replace of that menu's mapped keys only). Editing `OWNER`/`SYSTEM_ADMIN` → 403.
- `visibleMenus` is evaluated **server-side** and returned by the enriched `/auth/me` (D6); the client helpers in the handoff's `permissions.ts` remain UI-only conveniences.

### D4 — Per-user overrides = membership-level menu visibility only
Handoff semantics: override toggles **menu visibility** (view) per user; other actions still follow the role. Implementation: new table `MembershipMenuOverride (membershipId, menuId, effect ALLOW|DENY)` + `PUT .../employees/{id}/menu-override`. Resolution order in the permission resolver (view projection only): owner → always; inactive → nothing; override → wins; else role grant. Non-view actions are **never** overridden (matches handoff `userCan`). Audit every change.

### D5 — "One role per user" is a UI/API rule, not a schema change
Schema stays M:N (`MembershipRole`); the employee create/update DTO validation rejects `roleIds.length > 1` behind config flag `EMPLOYEE_SINGLE_ROLE=true` (default on for มั่งมี deployments). Capability packs continue to compose within the single role.

### D6 — Enriched session payload
`GET /v1/auth/me` today returns `{userId, companyId, roles, permissions, authProvider}`. Extend (additive) to the handoff's `auth.me()` needs:

```
{ userId, companyId, roles, permissions, authProvider,
  user:   { id, displayName, firstName?, lastName?, email?, username, initial },
  matrix: PermissionMatrix,          // D3 projection for the caller's company
  menus:  MenuId[],                  // server-evaluated visibleMenus
  branches: { id, name, sub }[],     // caller-visible branches (scope-filtered)
  activeBranchScope: 'ALL' | string[] }
```

### D7 — Conversation domain reuses 15A wholesale
- Status enum already matches: `NEW|OPEN|WAITING_CUSTOMER|WAITING_INTERNAL|FOLLOW_UP|RESOLVED|SPAM` → handoff lowercase via contracts mapper (`followup ↔ FOLLOW_UP`; `SPAM` folded into a filterable extra, not shown as a chip).
- Derived fields computed server-side per row: `waitMin` (now − last inbound customer message), `unread` (inbound messages after staff's last read cursor — new `CrmConversationReadState` table), `overdue = status!==RESOLVED && waitMin>30` (SLA per 15A: 30 min default, later configurable via `CrmInboxPolicy`).
- Status auto-advance is a **server-side domain rule** in the send/book/verify-slip use cases: staff reply → `WAITING_CUSTOMER`; booking created from chat → `RESOLVED`; slip verified → `OPEN`. Manual `PUT status` allows any legal transition; all transitions audited.
- Internal notes: existing `CrmMessageVisibility.INTERNAL_NOTE`; the LINE send adapter **structurally rejects** internal-note messages (15A invariant kept).

### D8 — Bookings: store real timestamps, serve the week grid
New module `crm-bookings`. The handoff's `{day, weekOffset, time, dur}` is a **UI coordinate system**; the DB stores concrete `startAt`/`endAt` (`Asia/Bangkok`), `branchId`, required tenant-valid `customerId`, `customerName` snapshot, `serviceName`, `staffUserId`, source channel, and `sourceConversationId?`. `GET .../bookings?branchId&weekStart=YYYY-MM-DD` returns rows + echo of the week; the FE mapper converts to grid coordinates. Server validation: active customer in the same company, within 09:00–20:00 configurable window, duration 1–3h in 0.5h steps, no overlap per staff+branch, reject `startAt < now`. Booking-from-chat = same use case + auto-advance (D7).

### D9 — Broadcast: LINE audience push + AI text generation; poster is a template render
New module `crm-campaigns` on top of 15A's `CompanyMessagingChannel`:

- Segments = customer tiers (D10): `all|vip|active|lead` with live counts, always excluding `consentStatus != GRANTED` and blocked/unfollowed channel identities.
- Send path: worker job (BullMQ, `apps/workers`) fanning out via LINE **multicast** to segment member `lineUserId`s (500/batch, rate-limited, resumable, idempotent per recipient — mirrors 15A campaign model sketch). LINE `broadcast` API only for `all` when quota allows. `reach` = accepted recipients.
- `POST .../campaigns/generate` → ai-gateway internal endpoint (new agent `marketing-draft`, text-only, 3 options `{headline, body}`; **draft-only** — the existing "no generate-and-send in one call" invariant holds: generate and send are separate permission-gated endpoints).
- Poster: deterministic server-side SVG→PNG template render (brand gradient presets `green|pink|gold|pastel|dark` + headline/price text) stored as an Attachment; **no image model**. Manual mode accepts an uploaded image through the existing attachment pipeline.

### D10 — Customer tier/score/LTV are additive CrmCustomer fields
Add `tier (VIP|ACTIVE|LEAD)`, `engagementScore Int`, `lifetimeValueAmount Decimal`, plus `CrmCustomerCourse` (+`sessions`) and `CrmCustomerPurchase` tables for the profile modal (course progress, purchase history). This intentionally lands the additive extension the 15A spec already reserved (leadScore/LTV). Tier drives broadcast segments and per-tier discount policy.

### D11 — Auth channels
- **Password login**: exists (username **or email** since มั่งมี Phase 1) — reuse.
- **LINE QR login**: net-new poll-based flow, feature-flagged (`AUTH_LINE_QR_LOGIN`): `POST /v1/auth/line/qr-session` → `{sessionId, qr, expiresIn:60}`; QR encodes the employee-link-style LIFF URL carrying the session token; scan on phone (already-linked LINE identity) confirms; web polls `GET /v1/auth/line/qr-session/{id}` → `pending|confirmed{tokens}|expired`. Single-use, 60s TTL, rate-limited, sessions table reuses `VerificationToken` pattern. QR must be rendered **in-process** (no `api.qrserver.com` for an auth secret — fix the existing external-QR usage for this flow).
- **Phone+OTP**: contract reserved (`POST /v1/auth/otp/request|verify`, 60s resend, 6 digits, hashed code, 5-attempt lockout) but **blocked on SMS provider selection** — ships disabled with a `disabled-sms.adapter` like the mailer.

### D12 — Credential delivery by email
Extend `AuthMailerPort` with `sendCredentialHandoff({toEmail, username, temporaryPassword, lineLink?})`; new endpoint `POST .../employees/{id}/email-credentials` (permission `access.employee.credential.issue`, audited, requires employee to have a verified email). Console/disabled adapters until SMTP is configured — the UI button surfaces "email not configured" honestly.

### D13 — Settings: PO approval tiers + discount policy
Two new company-scoped settings aggregates:

- `PoApprovalPolicy` + `PoApprovalTier[] {maxAmount Decimal?, approverRoleKeys[]}` (null max = catch-all top tier; ≥1 tier; server keeps tiers sorted, validates contiguity). `GET|PUT /v1/companies/{id}/settings/po-approval` (perm `procurement.approval_policy.read|manage`). The procurement `ApprovePurchaseOrderUseCase` consults the policy: approver's role must be in the tier matching the PO amount (and `thresholdSnapshotJson` finally gets populated with the tier snapshot at approval time). Permissions page shows the caller-relevant ceiling **read-only** (matrix screen never edits it).
- `DiscountPolicy {allowAuto, autoPct, maxPct, vipPct, regularPct, overrideRoleKey}` — `GET|PUT /v1/companies/{id}/settings/discount-policy` (perm `crm.discount_policy.read|manage`). Inbox Auto-AI card reads it (read-only, per handoff). Enforcement hook: any future discount-applying use case must clamp to `maxPct` unless caller has the override role.

### D14 — Dashboard KPIs
Extend the snapshot provider set with real providers replacing placeholders where data exists: `sales` (sum of issued sales documents / paid invoices for branch+today), `bills` (count), `bookings` (today's bookings, D8), `pending` (open approval requests: PO + expenses + reimbursements). Branch-scoped via `branchId` param intersected with membership scope. Menus without data keep honest `module_status` placeholders.

## 7. API contract mapping (handoff `api.ts` → real backend)

Legend: ✅ exists on baseline · 🔧 extend existing · 🆕 net-new · ⏸ deferred/flag-gated

### auth
| Handoff | Real endpoint | Status |
|---|---|---|
| `auth.loginPassword(email,pw)` | `POST /v1/auth/password/login` (username **or** email) | ✅ |
| `auth.requestOtp` / `verifyOtp` | `POST /v1/auth/otp/request` / `verify` | ⏸ D11 (SMS provider) |
| `auth.lineQr()` | `POST/GET /v1/auth/line/qr-session` | 🆕 D11 |
| `auth.me()` → `{user, permissions}` | `GET /v1/auth/me` enriched → `{user, matrix, menus, branches,…}` | 🔧 D6 |
| `auth.logout()` | `POST /v1/auth/logout` (+BFF cookie clear) | ✅ |

### branches / permissions / roles / users
| Handoff | Real endpoint | Status |
|---|---|---|
| `branches.list()` | `GET /v1/companies/{id}/branches` (scope-filtered) | ✅ (filter 🔧) |
| `permissions.matrix()` | `GET /v1/companies/{id}/settings/access/matrix` | 🆕 D3 |
| `permissions.setRolePerm(role,menu,actions)` | `PUT /v1/companies/{id}/settings/access/matrix/{roleId}/{menuId}` | 🆕 D3 |
| `permissions.roles()` | `GET /v1/companies/{id}/settings/roles` | ✅ |
| `permissions.createRole({label,color,copyFrom})` | `POST .../roles` + `copyFromRoleId`, `color` | 🔧 |
| `permissions.updateRole` / `deleteRole` | `PATCH .../roles/{id}` / `POST .../roles/{id}/disable` (soft) | ✅ / 🔧 (map DELETE→disable) |
| `users.list({branch,roleId,q,page})` | `GET .../settings/employees?branchId&roleId&q&page&pageSize` | 🔧 (filters+pagination new) |
| `users.get/create/update` | `GET/POST/PATCH .../settings/employees/{id}` | ✅ (fields 🔧 §8) |
| `users.setActive` | `POST .../employees/{id}/disable {status}` | ✅ |
| `users.setRole` | `PATCH .../employees/{id} {roleIds:[one]}` + single-role rule | 🔧 D5 |
| `users.setOverride(menu, 0/1)` | `PUT .../employees/{id}/menu-override` | 🆕 D4 |
| `users.remove` | `POST .../employees/{id}/disable {status:DISABLED, reason:resigned}` | 🔧 (soft only) |
| `users.emailCredentials` | `POST .../employees/{id}/email-credentials` | 🆕 D12 |

### inbox / customers
| Handoff | Real endpoint | Status |
|---|---|---|
| `inbox.conversations({branch,status,q,page})` | `GET .../crm/conversations` + `branchId,q` filters, derived `waitMin/unread/overdue` | 🔧 (list ✅; filters/derived 🆕) |
| `inbox.messages(convId)` | `GET .../crm/conversations/{id}` (detail incl. messages) + read-cursor update | ✅/🔧 |
| `inbox.send(convId, text, internal)` | `POST .../crm/conversations/{id}/messages {text, visibility}` → LINE push; auto-advance | 🆕 (15A Phase 2) |
| `inbox.setStatus` | `PUT .../crm/conversations/{id}/status` | 🆕 |
| `inbox.assign` | `PUT .../crm/conversations/{id}/assign` | 🆕 |
| `inbox.verifySlip` | `POST .../crm/conversations/{id}/messages/{msgId}/verify-slip` → finance queue + auto-advance | 🆕 (media download prereq) |
| `inbox.book` | `POST .../crm/conversations/{id}/book` → crm-bookings + RESOLVED | 🆕 D8 |
| `inbox.setAutoWorkflow(custId,{booking,discount})` | `PUT .../crm/customers/{id}/auto-workflow` (discount % read from D13 policy) | 🆕 |
| `customers.list({branch,tier,q})` | `GET .../crm/customers` + `branchId,tier` filters + tier/score/ltv fields | 🔧 D10 |
| `customers.get(id)` | `GET .../crm/customers/{id}` + course/purchases/appointment payload | 🔧 D10 |

### bookings / broadcast / reports / dashboard / settings
| Handoff | Real endpoint | Status |
|---|---|---|
| `bookings.week({branch,weekOffset})` | `GET .../crm/bookings?branchId&weekStart` | 🆕 D8 |
| `bookings.create/update/remove` | `POST/PATCH/DELETE .../crm/bookings/{id}` (hard delete OK pre-visit; else cancel) | 🆕 D8 |
| `broadcast.generate(req)` | `POST .../crm/campaigns/generate` → ai-gateway `marketing-draft` (3 text options + poster preset) | 🆕 D9 |
| `broadcast.send(draft)` | `POST .../crm/campaigns` (create+enqueue) → `{reach}` | 🆕 D9 |
| `broadcast.campaigns()` | `GET .../crm/campaigns` | 🆕 D9 |
| `crmReports.summary({branch})` | `GET .../crm/reports/summary?branchId` | 🆕 |
| `dashboard.summary({branch})` | `GET .../dashboard?branchId` (real KPI providers) | 🔧 D14 |
| `settings.poTiers/savePoTiers` | `GET|PUT .../settings/po-approval` | 🆕 D13 |
| `settings.discountPolicy/saveDiscount` | `GET|PUT .../settings/discount-policy` | 🆕 D13 |

## 8. Data model changes (Prisma, all additive)

| Model | Change |
|---|---|
| `CrmCustomer` | + `tier CrmCustomerTier @default(LEAD)`, `engagementScore Int @default(0)`, `lifetimeValueAmount Decimal @default(0)`, `autoWorkflowBooking Boolean @default(false)`, `autoWorkflowDiscount Boolean @default(false)` |
| `CrmCustomerCourse` 🆕 | customerId, name, totalSessions, usedSessions; child `CrmCustomerCourseSession` (n, date, byUserId, done) |
| `CrmCustomerPurchase` 🆕 | customerId, item, amount, purchasedAt (source: manual or sales-doc link) |
| `CrmConversationReadState` 🆕 | conversationId × userId → lastReadMessageId/At (drives `unread`) |
| `CrmBooking` 🆕 | companyId, branchId, customerId required FK, customerName snapshot, serviceName, staffUserId, startAt, endAt, status BOOKED|CANCELLED|DONE|NO_SHOW, source STAFF|LINE|WEB|PHONE|FACEBOOK|WALK_IN|OTHER, sourceConversationId?; index (companyId, branchId, startAt); overlap checked per staff |
| `CrmCampaign` 🆕 + `CrmCampaignRecipient` 🆕 | segment, messageText, posterAttachmentId?, status DRAFT|SENDING|SENT|FAILED, reach, sentAt; recipient rows idempotent (campaignId × customerId unique) |
| `MembershipMenuOverride` 🆕 | membershipId, menuId, effect ALLOW|DENY, unique (membershipId, menuId) |
| `PoApprovalPolicy` 🆕 + `PoApprovalTier` 🆕 | companyId unique; tier: maxAmount Decimal? (null = top), sortOrder, approverRoleKeys String[] |
| `CompanyDiscountPolicy` 🆕 | companyId unique; allowAuto, autoPct, maxPct, vipPct, regularPct, overrideRoleKey |
| `AuthQrLoginSession` 🆕 (flagged) | tokenHash unique, status PENDING|CONFIRMED|EXPIRED|USED, userId?, expiresAt (60s) |
| `EmployeeAccessProfile` | + `email?`, `firstName?`, `lastName?`, `nickname?` (ชื่อเล่น — call-name shown in bookings + individual permissions, falls back to `displayName`), `dob?`, `addressLine?`, `postalCode?`, `secondaryIdType/Number?` (encrypted, for the ID-card+passport pair) — additive, existing single-identity flow keeps working |

New permission keys: `crm.inbox.reply`, `crm.inbox.manage` (assign/status), `crm.inbox.verify_slip`, `crm.booking.read|create|edit|delete`, `crm.campaign.read|create|send`, `crm.report.read`, `crm.discount_policy.read|manage`, `procurement.approval_policy.read|manage`, `access.menu_override.manage` — registered in `permission-registry.ts` + `ROLE_GRANTS` + capability packs (`Inbox Agent`, `Campaign Manager` per 15A).

## 9. Screen-by-screen backend coverage (Flow A → BE)

| # | Screen | BE dependency |
|---|---|---|
| 1 | Login (3 channels) | ✅ password · 🆕 QR session (flag) · ⏸ OTP |
| 2 | Dashboard | D14 KPI providers + D6 menus |
| 3 | Inbox | D7 filters/derived + send/assign/status/slip/book + AI suggest (existing ai.suggestion draft-only path) |
| 4 | Customers | D10 fields + KPI counts + "เปิดแชท" = lookup conversation by customerId (add `GET .../crm/conversations?customerId=`) |
| 5 | Bookings | D8 module |
| 6 | CRM reports | reports/summary aggregation (counts by status, resolvedRate, avgResponseMin from message deltas, overdue, per-staff, top-LTV) |
| 7 | Broadcast | D9 campaigns + generate |
| 8 | Permissions | D3 matrix + D4 override + D5 single-role + wizard fields (§8) + D12 email credentials + LINE-connect QR (existing link-token) |
| 9 | PO approval | D13 tiers + procurement enforcement |
| 10 | Discount policy | D13 policy + inbox read-only card |

## 10. Security & invariants (carried forward, non-negotiable)

- Deny-by-default guard + `@RequirePermissions` on every new route; client matrix is never trusted.
- Company tenancy on every table/route; branch scope intersected server-side (never from client "all").
- Internal notes structurally cannot reach the LINE send path.
- AI = draft-only; generate and send are separate endpoints/permissions; auto-workflow toggles gate **suggestions**, discount % always sourced from central policy and clamped at `maxPct`.
- Broadcast excludes consent-revoked/blocked identities at send time (not only at preview); campaign send is a sensitive permission.
- Owner/SYSTEM_ADMIN roles locked (not assignable, matrix row read-only); soft-delete everywhere the UI says "ลบ" for users/roles/customers.
- Credentials/QR for auth flows rendered in-process; no secrets to third-party QR services; temp password shown once + 72h TTL + `mustChangePassword` guard (existing).
- Every mutation audited (existing audit module), incl. matrix edits, overrides, policy changes, campaign sends, slip verification.

## 11. Open questions (blocking decisions for Owner)

1. **SMS provider** for OTP (Phase: deferred until chosen — Thai options e.g. ThaiBulkSMS/AIS/local aggregator).
2. **SMTP/email provider** for credential handoff + password reset mail (mailer port exists; adapters are console/disabled).
3. Poster render style approval: SVG template with brand presets vs. Owner-supplied template images.
4. `sales`/`bills` KPI source of truth: accounting documents (invoices/receipts) vs. future POS `sales` module — spec assumes accounting documents until the `sales` menu ships.
5. Whether `deleteRole` should stay disable-only (recommended) — the handoff UI has a hard delete affordance.

## 12. CRM Reports Summary + LTV derivation (implement detail, added 2026-07-09)

Refines screen #6 (§9 line 206) / endpoint `GET .../crm/reports/summary?branchId` (§7 line 174) / plan Phase 6 item 3, and **closes the previously-unspecified LTV derivation**. Needs no new Prisma model and no migration. Full build steps in [[plans/mvp1-crm-reports-ltv-plan]].

**Response shape** (`CrmReportsSummary`, contract in `packages/contracts/src/crm-inbox.ts`): `total`, `resolved`, `resolvedRate`, `avgResponseMin` (nullable), `overdue`, `statusBreakdown[] {status,count,pct}`, `staffPerformance[] {userId,displayName?,assigned,resolved,rate}` (null userId = unassigned bucket), `topCustomers[] {customerId,displayName,lifetimeValueAmount,tier}`, `branchId`. Permission `crm.report.read` (already registered/granted).

**Aggregation rules.** Exclude `SPAM` from all counts. `overdue` reuses the canonical `overdueWhere(now)` predicate (`firstRespondedAt = null ∧ firstResponseDueAt < now ∧ status ∉ {RESOLVED,SPAM}`), not a wait-minute heuristic. `avgResponseMin` = mean of `(firstRespondedAt − createdAt)` minutes over responded conversations (conversation-level; message-level deltas are a future refinement). `CrmConversation` has **no `branchId`** — branch scope is derived by joining conversation → `CrmCustomer.branchId`; the `branchId` param is intersected with the caller's scope server-side (never trusted raw), per §10.

**LTV derivation (this resolves the item-15 "lifetime value (derived read model)" and D10 `lifetimeValueAmount` fields, which were declared but never given a formula).**
`LTV(customer) = Σ AccountingPayment.amount WHERE companyId = customer.companyId AND counterpartyId = customer.accountingCounterpartyId AND direction = 'RECEIVED' AND status = 'RECORDED'`. Summing **received payments** rather than document `paidAmount` avoids double-counting a single sale that spans both an INVOICE and a RECEIPT/TAX_INVOICE (a payment is recorded once; `paidAmount` is duplicated across the sale's documents, and a voided document does not zero it). Null counterparty ⇒ 0; decimal-safe string on the wire. Computed **on-demand** in the report query (the `lifetimeValueAmount` column stays reserved for a future cache; no recompute job in this build). Refund netting + credit notes = future refinement (MVP1 sums gross received).

**Decision — reuse accounting, do not build `CrmCustomerPurchase` for LTV.** §8's proposed `CrmCustomerPurchase 🆕` table is **superseded for LTV purposes**: item-08 `AccountingDocument` already holds real, paid, customer-facing sales documents and owns revenue, so LTV reads through the `CrmCustomer.accountingCounterpartyId` → `AccountingCounterparty` → `AccountingDocument` bridge. This is consistent with Open Question #4 (accounting documents are the sales/bills source of truth until a POS `sales` module ships). The bridge is optional/nullable today; the plan back-links it at the CRM→document sale seam so LTV accumulates automatically going forward (no fuzzy historical backfill).

**Tier badge.** No `CrmCustomer.tier` field exists yet (D10 unbuilt); the reports `tier` is **derived from real LTV** via one threshold constant (`≥50,000 vip · >0 active · 0 lead`), flagged to be replaced when the D10 tier field/semantics land. Derived from real revenue — not fabricated. Threshold is an Owner-adjustable product choice.
