# MVP 1 Two-Dev Parallel Plan (Dev A / Dev B)

## Status

Created 2026-07-09. Working split of [[plans/mvp-1-crm-line-bill-capture-sequence|MVP 1 Execution Sequence]] for two developers in parallel. That sequence doc stays canonical for scope/exit criteria; this file only assigns lanes, order, and interfaces. All items inherit the Production Hardening Baseline as per-PR exit gate.

**Progress 2026-07-09**: **A1 inbox wire-up DONE + committed** (the live-prod regression — `/inbox` now serves real DB conversations, not mock) → **H1 unblocked**, so **B5 web AI panel DONE + committed** on the wired inbox (H1). Also done in the same harness run: prototype-data banner on still-mock CRM routes, and **`/customers` wired to the real customer API**. Details + browser-verify evidence: [[agent-memory/mvp1-a1-web-wireup]]; plan [[plans/mvp1-a1-web-wireup-plan]]. Not yet deployed (canary is a separate owner-gated step). Remaining A-lane (A2–A10) and B-lane (B6 trust-scan already committed earlier; B7 auto-reply onward) unchanged.

Owner split (owner decision 2026-07-09):

- **Dev A** — ทั้งระบบ ยกเว้นงาน AI agent และงานตั้งค่า LINE ฝั่ง external: web wire-up, revenue-loop APIs/UI, notification/delivery/queue plumbing, appointments, dashboard, PDPA purge, infra/cutover.
- **Dev B** — AI agent ทั้งหมด (AI Gateway family + AI endpoints/panel + trust score + auto-reply + booking agent) และ LINE external setup (LINE Developers/OA credentials, rich menu, link states, dev-OA journeys, LIFF/LINE Login, LINE-side smokes).

## Lane A — Dev A (core system)

| # | งาน | รายละเอียด / เหตุผล | Ref | ~Effort |
|---|---|---|---|---|
| A1 | **Inbox wire-up (เริ่มทันที — prod regression fix)** | ต่อ `InboxPrototypePage` เข้า `crm-inbox.api` (ตัวอ้างอิง: `InboxPage.tsx`); prod ตอนนี้เสิร์ฟ mock อยู่ | [[plans/mvp-1-crm-line-bill-capture-sequence]] Front-End Wire-Up Track; memory Code Reconciliation | 2–4 วัน |
| A2 | MVP1-0 ฝั่งระบบ | bombam tenant ผ่าน 10A + entitlement `crm_line_inbox` + PDPA notice text + verification script | sequence MVP1-0 | 0.5 วัน |
| A3 | Phase 3 remainder (revenue loop) | create deal/task/quotation-draft จาก conversation, ส่ง doc เข้า LINE ผ่าน send path เดิม, payment-proof queue, 360 sidebar ข้อมูลจริง | [[plans/crm-line-oa-customer-os-plan]] Phase 3 (line 212); sequence MVP1-1 | 3–5 วัน |
| A4 | Prod gate: LINE push delivery + new-chat notification | delivery sweep + `line` default + backoff ตาม design แล้วต่อ `crm_new_conversation` scanner + trigger key | [[agent-memory/notification-line-push-wiring]] | 1–1.5 วัน |
| A5 | Prod gate: send retry + media durable | reply-send retry queue (429/401), inbound media/profile ย้ายเข้า BullMQ workers | sequence MVP1-1 prod gates | 1.5 วัน |
| A6 | PDPA purge job + erasure path | ตาม retention decision (24 เดือน text / 12 เดือน media / สลิป→finance ก่อน purge / admin purge audited) | memory Decisions (PDPA 2026-07-09) | 1 วัน |
| A7 | MVP1-6 Appointments | model/API/calendar/conflict/reminder (durable, Asia/Bangkok)/360 tab + wire `BookingsPrototypePage` | sequence MVP1-6; [[plans/crm-line-oa-customer-os-plan]] Phase 6 (line 262) | 3–5 วัน |
| A8 | MVP1-5 Daily Brief (ยกเว้น AI card) | widgets: unanswered/SLA/new customers/pipeline/quotes/payments/appointments/response-time + deep links + push ผ่าน A4 | sequence MVP1-5; plan Phase 5 (line 250) | 2–3 วัน |
| A9 | MVP1-3 ฝั่ง web review | evidence download/preview + review states (tax evidence, category, signature approval, accountant view) | sequence MVP1-3 | 1 วัน |
| A10 | MVP1-8 cutover (lead) | canary + RollbackAlarm ตาม precedent, secrets/env verify, queue/DLQ health, cross-tenant battery ฝั่ง core | sequence MVP1-8; memory ECS canary rules | 1.5 วัน |

## Lane B — Dev B (AI agents + LINE external)

| # | งาน | รายละเอียด / เหตุผล | Ref | ~Effort |
|---|---|---|---|---|
| B1 | MVP1-0 ฝั่ง LINE external (เริ่มทันที) | bombam LINE Developers access, OA connect ผ่าน wizard (`/settings/line-oa` — มีแล้ว), webhook verify บน prod, เช็ค plan/quota (free ~300 push/เดือน → ตั้ง `autoReplyDailyCap` ต่ำ), link QR owner/staff | [[runbooks/b1-b2-line-external-setup]]; sequence MVP1-0 | 0.5–1 วัน |
| B2 | MVP1-2 shared OA product | rich menu 3 ช่อง (แจ้งเตือน=deep link ศูนย์แจ้งเตือน / สรุปค่าใช้จ่าย=message action เข้า pipeline 10B/09 เดิม / เปิดเว็บ=deep link) + first-run link states + dev-OA journeys + หลักฐานตัดสิน 10F flags | [[runbooks/b1-b2-line-external-setup]]; sequence MVP1-2 (rich menu DECIDED 2026-07-09) | 1.5–2 วัน |
| B3 | AI family B1: scaffold | gateway module `crm-customer-ai` + contracts `crm-ai.ts` + **separation tests 4 กลุ่ม** (ต้องเขียวก่อนเขียน agent logic) | [[agent-memory/crm-customer-ai-agent-family]] | 1 วัน |
| B4 | AI family B2: `CrmCustomerIntakeAgent` | semantic turn classification + uncertainty envelope | design B | 1–2 วัน |
| B5 | AI family B3: staff assist | API `ai/summary`/`reply-draft`/`insights` + gateway client + `crm.ai.assist` + **web AI panel เสียบ inbox ที่ A1 wire แล้ว** (H1) | design B; plan Phase 4 (line 231) | 2–3 วัน |
| B6 | AI family B4: trust score | **สูตร deterministic ใน API (spec §27, 2026-07-09)** + migration trust columns+factors JSON + hourly scan (initial trigger — ห้ามผูก booking-only); gateway agent = narrative optional | design B; spec §27 | 1–2 วัน |
| B7 | AI family B5: auto-reply | migration `autoReplyEnabled`+`autoReplyDailyCap(50)` + **event-driven จาก webhook (replyToken ฟรี — ไม่ใช่ polling drain)** + gate chain **ไม่มี trust gate** (§27 ladder: ตอบทุกคนเฉพาะ QUESTION grounded) + holding message + per-conversation cap 5/วัน + ส่งเป็น `authorType='AI'` ผ่าน send path ของ A (H3) + kill switch env | design B Resolved Decisions; spec §27 | 2–3 วัน |
| B8 | MVP1-5 AI Daily Insight card | item 17 template `crm_daily_brief`, cited + permission-scoped | plan Phase 5 | 0.5–1 วัน |
| B9 | MVP1-7 8B: LIFF registration | LINE Login external config + LIFF page ใต้แบรนด์บริษัท + PDPA consent + rate limit/abuse guard | plan Phase 8B (line 280) | 2–3 วัน |
| B10 | MVP1-7 8C: auto-booking | `CrmBookingAgent` discovery/nearest-slot/semantic confirm (ห้าม keyword list) + guardrails ผ่าน appointment API ของ A7 (H4) + trust recompute + **gate trust>80 อยู่ที่นี่ที่เดียว (§27)** | plan Phase 8C (line 292); spec §27 | 3–5 วัน |
| B11 | MVP1-3 ฝั่ง LINE smokes | receipt photo / text note / signature / refusal / ดูค่าใช้จ่าย บน dev-OA + prod-shaped | sequence MVP1-3 | 0.5–1 วัน |
| B12 | MVP1-8 cutover (AI side) | AI Gateway env/provider keys, separation tests บน prod-shaped, auto-reply volume metric | sequence MVP1-8 | 0.5 วัน |

## Handshakes (จุดที่ต้องรอกัน — มีแค่ 4 จุด)

| H | อะไร | ใครรอใคร | เมื่อไหร่ |
|---|---|---|---|
| H1 | inbox wire-up (A1) merged | B5 (AI panel UI) รอ A1 — ระหว่างรอ B ทำ B1–B4 ฝั่ง API/gateway ได้เต็มที่ | ✅ **RESOLVED 2026-07-09** — A1 committed (`eacd8984`), B5 web panel committed on top (`d67d24c5`) |
| H2 | `crm-ai.ts` contracts (B3) merged | freeze I/O ระหว่าง API↔gateway | สัปดาห์ 2 |
| H3 | send retry (A5) merged | B7 auto-reply ยิงผ่าน send path ที่มี retry แล้ว | สัปดาห์ 2–3 |
| H4 | appointment API (A7) freeze | B10 booking agent ใช้ availability read | สัปดาห์ 3–4 |

## Ownership Map (กันเหยียบกัน)

| พื้นที่ | เจ้าของ |
|---|---|
| `apps/web/src/features/crm-inbox/*` (ยกเว้นไฟล์ `*AiPanel*`), `features/crm/*` wire-ups, `features/crm-appointments` | A |
| `apps/api/src/modules/crm-inbox` — conversation/action/payment/policy use-cases + controllers | A |
| `apps/api/src/modules/dashboard-notifications`, `apps/workers/*` (sweep/retry/media/purge/reminder) | A |
| `apps/ai-gateway/src/modules/crm-customer-ai/*` (ใหม่), `packages/contracts/src/crm-ai.ts` (ใหม่) | B |
| `apps/api/src/modules/crm-inbox` — เฉพาะไฟล์ชื่อ `crm-ai-*` (use-case/controller/client) + web `*AiPanel*` + LIFF page | B |
| LINE Developers / OA Manager / rich menu / LIFF console (config ไม่ใช่โค้ด) | B |
| `prisma/schema.prisma` + migrations, `crm-inbox.module.ts`, `contracts/index.ts`, permission registry | **แชร์ — announce ก่อนแตะ** |

> 📣 **Cross-lane edit — Dev B, 2026-07-09 (B6 trust scan)**: adding `apps/workers/src/modules/crm-inbox/crm-trust-worker.ts` (ใหม่, queue ใหม่ `crm-trust` — ไม่แตะ queue `crm-inbox` ของ SLA worker) + append-only registration ใน `apps/workers/src/main.ts`. แผน: [[plans/mvp1-b4-api-trust-score-plan]]. ถ้า Dev A มี in-flight edit ใน main.ts ให้ rebase ทับได้เลย (เพิ่มแค่ import + start + log 3 บรรทัด)
>
> 📣 **Shared-file edit — Dev B, 2026-07-09** (rule 4 โน้ตส่งมอบ): consolidating duplicated AI-gateway helpers. Touching pre-existing **line-ai** + **ai-draft** (cross-lane) — **behavior-preserving refactor only**, no logic/contract change. If Dev A has an in-flight edit in either, rebase on this.
> - **F8** new `apps/ai-gateway/src/common/ai/extract-json.ts` (shared `extractJson`); removes the 4 identical copies in `ai-draft/generate-draft.use-case.ts`, `line-ai/agents/intent-router.agent.ts`, `line-ai/agents/orchestrator.agent.ts` (was `extractJsonObject`), `crm-customer-ai/agents/extract-json.ts`.
> - **F9** new `apps/ai-gateway/src/common/security/internal-secret.ts` (`assertInternalSecret`, now constant-time); replaces the inline X-Internal-Secret check in `line-ai-internal.controller.ts` (4×), `ai-draft-internal.controller.ts` (1×), `crm-customer-ai-internal.controller.ts` (3×). Same throw/message/fail-closed semantics — controller unit tests unchanged.

## กติกากันชน

1. Branch แยก `feat/mvp1-a-*` / `feat/mvp1-b-*` จาก `develop`, PR เล็ก, rebase ทุกวัน
2. **Migration lane**: ประกาศก่อนสร้าง migration ทุกครั้ง (timestamp เรียงกัน, additive เท่านั้น) — ของ B มี 3 ชุด (B5-API: `CrmAiAssistFeedback`+summary-cache cols บน `CrmConversation`; trust columns+factors JSON; review-fix 2026-07-09: `CrmChannelIdentity.verifiedLinkAt/Via` + feedback partial-unique — [[plans/mvp1-b-review-fix-plan]]; toggle+cap+`AuthorType.AI`+`autoReplyCheckedAt`+persisted intake `turnClass`), ของ A มี purge index/payment-proof ถ้าจำเป็น
3. B เพิ่มไฟล์ใหม่ชื่อ `crm-ai-*` ใน crm-inbox module เท่านั้น; แก้ `crm-inbox.module.ts` แบบ append-only
4. ห้ามแก้ไฟล์เลนอีกฝั่ง — ถ้าจำเป็นให้โน้ตส่งมอบ
5. ทุก PR ผ่าน Production Hardening Baseline ([[plans/mvp-1-crm-line-bill-capture-sequence]] line 37) + verification evidence ลง memory ที่เกี่ยวข้อง

## Timeline คร่าว (~5 สัปดาห์)

| สัปดาห์ | Dev A | Dev B |
|---|---|---|
| 1 | A1 inbox wire-up + A2 | B1 LINE setup + B2 rich menu + B3 scaffold |
| 2 | A3 revenue loop + A4 push/notification | B4 intake + B5 staff assist (panel หลัง H1) |
| 3 | A5 retry/media + A6 purge + เริ่ม A7 | B6 trust + B7 auto-reply (หลัง H3) |
| 4 | A7 appointments + A8 daily brief | B8 insight + B9 LIFF + เริ่ม B10 (หลัง H4) |
| 5 | A9 + A10 cutover lead | B10 booking + B11 smokes + B12 |

## Definition of Done ต่อเลน

- A: revenue loop วิ่งบน prod ด้วยข้อมูลจริง end-to-end + notification ถึง staff (web+LINE) + queue ทุกตัว durable + appointments/daily-brief ใช้งานจริง + purge job พิสูจน์แล้ว
- B: separation tests เขียวทั้งหมด, toggle OFF = staff-draft เสมอ, toggle ON = level-0 auto-send (QUESTION grounded) ได้จริง 1 เคสบน prod รวมลูกค้า unscored (audited + AI-marked) + holding message ทำงานเมื่อ gate fail, trust>80 ปลดล็อกเฉพาะ booking (§27), rich menu/LIFF ใช้งานจริงกับ bombam, booking ผ่าน semantic confirm + guardrails
- ร่วม: MVP1-8 exit ตาม sequence doc — script เต็มผ่านบน prod-shaped services

Do not tick the master checklist from this file — evidence ลง [[agent-memory/mvp-1-crm-line-bill-capture-sequence]] ตามเดิม
