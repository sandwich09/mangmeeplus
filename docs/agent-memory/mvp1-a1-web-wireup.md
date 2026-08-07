# Agent Memory: MVP1 A1 + B5-web — CRM Web Wire-Up + AI Panel

Status: DONE 2026-07-09 — all 4 phases implemented, browser-verified, and committed to `develop` (harness: Codex CLI coded, Claude reviewed/tested/directed fixes, owner-harness committed). Commits: `eacd8984` (Phase 1 inbox), `b8bcdd88` (Phase 2 banner), `d67d24c5` (Phase 3 AI panel + trust read), `274c5028` (Phase 4 customers), `e6412128` (plan+memory). NOT yet deployed to prod — deploy is a separate canary step (owner-gated).
Owner: Dev A lane (A1 inbox/customers/banner) + Dev B lane (B5-web AI panel) — single harness run under owner instruction.
Scope: [[plans/mvp1-a1-web-wireup-plan]] — Phase 1 `/inbox` wire-up (prod regression fix), Phase 2 prototype-data banner (bookings/broadcast/crm-reports/customers), Phase 3 B3 web AI panel + trust read endpoint, Phase 4 `/customers` wire-up. Out of scope: bookings/broadcast/reports real wire-up, employee-access settings prototypes.

## Harness browser verification (2026-07-09, api-verify-3011 + web-verify-3002, seeded docker DB)

- Env fix (local rig only): `.claude/launch.json` `api-verify-3011` now appends `http://localhost:3002,http://127.0.0.1:3002` to `CORS_ALLOWED_ORIGINS` — the API rejected the verify web origin (port 3002) with a CORS error surfacing as HTTP 500 on every mutation; dev on :3000 is unaffected. Not a product bug.
- Seed: a throwaway CRM dev-seed (scratchpad) inserts 1 channel / 12 customers (mixed consent + trust) / 12 conversations / 28 messages / 3 templates against `seed-local-company`. Re-ran `apps/api` seed to grant the OWNER role the newly-added `crm.ai.assist` permission (DB was seeded before that key existed).
- Phase 1 inbox: list + chips (statusCounts/overdue/mine/unassigned) from DB; open thread; send reply (persists; local LINE send → FAILED+deliveryError badge exercised, expected with dummy creds); internal note (visible in note mode, hidden in reply mode); status→FOLLOW_UP; รับเรื่อง/เลิกดูแล self-assign; add tag; IMAGE media placeholder (`ดึงไฟล์แนบจาก LINE ไม่สำเร็จ`); overdue filter; page 2; deep-link `?conversation=` opens once and Back stays closed (no reopen loop).
- Phase 3 AI panel: trust chip renders tier label only (น่าเชื่อถือ/กำลังสร้างประวัติ/ใหม่ for TRUSTED/BUILDING/NEW; raw score + factors only inside รายละเอียด per §27); summary/reply/insights on gateway-down return `status:'unavailable'` HTTP 200 → "AI ไม่พร้อมใช้งานชั่วคราว" without blanking the tab; thumbs feedback persisted a `CrmAiAssistFeedback` row (SUMMARY/UP/requestId/owner). trust endpoint verified 85→TRUSTED, 62→BUILDING, null→NEW.
- Phase 4 customers: 12 real customers, real fields + consent labels (ยินยอม/ยังไม่ทราบ/ถอนความยินยอม/ไม่จำเป็น), debounced search filters, status filter (เก็บถาวร→empty state), pagination, profile modal real fields + `ดูโปรไฟล์เต็ม` deep-link; banner gone; no fabricated tier/score/LTV.
- Note: seed used placeholder snake_case trust factor keys; the panel's `factorLabel` maps the REAL camelCase keys from `computeTrustScore` (base/tenure90d/lineLinked/…), so real scan output labels correctly — the raw-key display in the seed screenshot is a test-data artifact, not a panel bug.

Decisions:
- Owner decision A (2026-07-08): Mangmee prototype = go-forward UI; wire up, never restore old pages.
- Route session pattern restored from pre-PR#6 (`fetchServerSession` → userId+permissions props).
- No backend ⇒ hide-don't-fake (auto-reply chip, slip verify, AI booking, branch chips) with MVP1-x comments.
- Trust display = tier labels ใหม่/กำลังสร้างประวัติ/น่าเชื่อถือ (§27); tier read via new B-owned `GET :conversationId/ai/trust` (pure read, no recompute); mapping null→NEW, ≤80→BUILDING, >80→TRUSTED.
- Phase 1 AI tab = placeholder; Phase 3 fills it (`InboxAiPanel.tsx`, B-lane `*AiPanel*` naming).
- Harness works directly on `develop` (matches B4/B5 harness precedent), per-phase commits after verification; Codex never commits; no `git add -A` (explicit paths only — shared-worktree rule).

Open questions: none blocking.

Artifacts:
- Plan: [[plans/mvp1-a1-web-wireup-plan]]
- Key files: `apps/web/app/(workspace)/companies/[companyId]/inbox/page.tsx`, `apps/web/src/features/crm-inbox/{InboxPrototypePage,InboxPage,inbox-prototype.model,crm-inbox.api}.ts(x)`, `apps/web/src/features/crm/{CustomersPrototypePage,crm.api}.ts(x)`, Phase 3: `apps/api/src/modules/crm-inbox/**/crm-ai-*`, `packages/contracts/src/crm-ai.ts`.
- Local DB was EMPTY of CRM rows (0 conversations/messages/customers) — harness seeds dev CRM data for browser verification; LINE sends fail locally (dummy creds) exercising FAILED+deliveryError UI (adapter hardcodes api.line.me — no env override).
- trustScore/leadScore/sentiment/riskLevel were persisted but NOT in any read DTO before Phase 3's trust read.

Verification: per-phase commands in the plan + harness browser pass on api-verify-3011/web-verify-3002 (launch.json).

## Phase 3 Evidence (2026-07-09)

Status: implemented in-tree, not committed (owner/harness controls commits). Scope was Phase 3 only: B3 web AI panel + pure trust read endpoint.

Files changed:
- Backend/contracts: `packages/contracts/src/crm-ai.ts`; `apps/api/src/modules/crm-inbox/presentation/http/crm-ai-assist.controller.ts`; `apps/api/src/modules/crm-inbox/application/use-cases/crm-ai-assist.use-case.ts` + `.spec.ts`; `apps/api/src/modules/crm-inbox/infrastructure/crm-ai-context.repository.ts`; `apps/api/src/modules/crm-inbox/domain/logic/crm-ai-trust.logic.ts`; `apps/api/src/modules/crm-inbox/crm-inbox.module.ts`.
- Web: `apps/web/src/features/crm-inbox/crm-ai-assist.api.ts`; `apps/web/src/features/crm-inbox/InboxAiPanel.tsx`; `apps/web/src/features/crm-inbox/InboxPrototypePage.tsx`.
- Memory: this file; [[agent-memory/crm-customer-ai-agent-family]]; [[agent-memory/mvp-1-crm-line-bill-capture-sequence]].

Decisions/evidence:
- `GET :conversationId/ai/trust` uses the existing `loadScopedConversation` path (`crm.ai.assist` + ABAC scope), reads stored `CrmCustomer.trustScore/trustScoreFactorsJson/trustScoreComputedAt`, and returns tier only via `trustTierOf`: `null -> NEW`, `<=80 -> BUILDING`, `>80 -> TRUSTED`. No gateway call, no recompute, no migration.
- `InboxAiPanel` replaces the AI-tab placeholder only when `crm.ai.assist` is present; otherwise the Phase 1 placeholder remains. Trust loads on mount/conversation change; summary/reply/insights are on-demand; degraded HTTP-200 unions keep prior successful content visible; feedback posts the latest section `requestId`.
- Contract addition is additive: `CrmTrustFactor`, `CrmTrustTier`, `CrmTrustReadResult`.

Verification:
- `pnpm --filter @watchdog-bms/contracts build` OK.
- `pnpm --filter @watchdog-bms/api typecheck` OK.
- Required raw `pnpm --filter @watchdog-bms/api test` hit sandbox `tsx` IPC `listen EPERM` before tests started; fallback `node --import tsx --test` over the package test list passed **1200 pass / 0 fail** (with `DATABASE_URL` copied from repo-root `.env` into env only).
- `pnpm --filter @watchdog-bms/web typecheck` OK.
- Required raw `pnpm --filter @watchdog-bms/web test` hit the same sandbox `tsx` IPC `listen EPERM`; allowed fallback `find src -name '*.spec.ts' -print0 | xargs -0 node --import tsx --test` passed **237 pass / 0 fail**.
- `git diff --check` clean.

## Phase 4 Evidence (2026-07-09)

Status: implemented in-tree, not committed (owner/harness controls commits). Scope was Phase 4 only: `/customers` route + Mangmee customer directory wired to real CRM customer list API.

Files changed:
- Route/session: `apps/web/app/(workspace)/companies/[companyId]/customers/page.tsx`.
- Web customer shell/model/client: `apps/web/src/features/crm/CustomersPrototypePage.tsx`, `apps/web/src/features/crm/customers-prototype.model.ts`, `apps/web/src/features/crm/customers-prototype.model.spec.ts`, `apps/web/src/features/crm/crm.api.ts`.
- Memory: this file.

Decisions/evidence:
- Route now uses `fetchServerSession(companyId)` and redirects to `/login?next=${encodeURIComponent('/companies/{companyId}/customers')}` when missing; client receives `companyId` + `permissions`.
- `CustomersPrototypePage` now gates `crm.customer.read`, calls `listCrmCustomers(companyId, { search, status, page, pageSize })`, uses 350ms debounced search, token stale-response guard, real pagination, Forbidden/loading/error/empty states, and real `CrmCustomerSummary` fields only.
- Removed `PrototypeDataNotice` from customers. `CustomersPrototypePage.tsx` imports nothing from `mangmee-crm-data`.
- Mock tier/score/LTV/KPI behavior was deleted. KPI row shows real `total`; per-status cards are hidden because the API does not expose `statusCounts` and no extra list calls were made.
- Profile modal keeps the Mangmee visual shape with real summary fields and deep-links to `/companies/{companyId}/crm/customers/{id}`.

Verification:
- `pnpm --filter @watchdog-bms/web typecheck` OK.
- Required raw `pnpm --filter @watchdog-bms/web test` hit sandbox `tsx` IPC `listen EPERM`; fallback `node --import tsx --test $(rg --files src | rg '\.spec\.ts$')` from `apps/web` passed **235 pass / 0 fail**.
- `rg -n "mangmee-crm-data" apps/web/src/features/crm/CustomersPrototypePage.tsx` returned no matches.
- `git diff --check` not run because this task explicitly said never run git commands; non-git trailing-whitespace scan over touched files returned no matches.

Next: Harness build/browser pass and owner-controlled commit for Phase 4.
