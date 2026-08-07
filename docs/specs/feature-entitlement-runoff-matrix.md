# RUNOFF_MATRIX — feature-entitlement decoupling (F0)

> Generated 2026-08-02 (F0.B baseline + owner-approved U3 RPT correction).
> Inventory HEAD `ba91c102` (lane S1-S5 capture) · repo HEAD at assembly `42be7299` (adds only the S1-S5 inventory docs).
> Method: assembled from f0 lane JSONs by deterministic join + conservative §6.3 overlay. No row was decided by hand; every
> policy value is produced by the published rule table below. Unresolved rows are explicit `BLOCKED` with an evidence owner
> and keep their route CLOSED (Spec §6.3 line 326, Plan F0 line 29).
> Machine-readable siblings (canonical, committed): `feature-entitlement-runoff-matrix.json`, `feature-entitlement-launch-matrix.json` in this directory. F1 seeds gate/route rows from these files; the MD tables are the human-review rendering of the same rows.
> Known double-listing: the 7 webhook surfaces appear on both the API plane (S2) and the ASYNC plane (S3) with consistent policy/owner; F1 materialization must dedupe by physical route.
> F0-exit ruling 2026-07-31 (owner-approved A0/A4, `docs/agent-memory/f0-exit-approval-package.md`): matrices approved as the F0 baseline. The 100 BLOCKED rows in non-feature buckets (UNMAPPED/NONE/UNRESOLVED/AI_GATEWAY_PLANE) keep their assigned evidence owners as the ratified A4 assignment (UNMAPPED→PLATFORM, AI gateway plane→CRM, webhook/LINE→CRM); they block every feature's disable until resolved in F1 shadow. BLOCKED fallback wording is cause-split per the §2 table amendment.
> **OWNER DECISION 2026-08-04 — THIS MATRIX NO LONGER GATES A DISABLE.** "ควรปิดได้และหยุดทำงาน แต่ถ้ามีข้อมูลเดิมค้างก็แค่ปิดไว้ไม่บล็อค": post-onboarding DISABLE of any sellable family is ALLOWED with FREEZE-IN-PLACE semantics — the family stops working (permissions stripped, surfaces hidden, APIs answer the honest disabled refusal, LINE AI refuses), existing data stays stored, dormant and untouched, residual/in-flight work may NEVER block the disable, and a re-enable resumes where it froze. Consequently the code-side disable preflight (`runoffPreflight`, the `IN_SCOPE_FAMILIES = {reports}` release set, the `GLOBAL_BLOCK` veto switch) and the `feature_disable_pending_runoff` 422 are DELETED, and no family needs a `PRE_CUTOFF_RUNOFF_ONLY` snapshot builder — nothing runs off. The only remaining disable refusals are the platform invariants (`employee_access`, `company_settings`) and the dependency cascade. The rows below therefore stand as the F0 surface SURVEY and coverage record; the F0-exit ruling above about BLOCKED rows blocking "every feature's disable" is superseded for the disable path (it still describes route seeding). `apps/api/.../runoff-matrix.catalog.ts` keeps the per-family aggregate as documentation plus `RUNOFF_MATRIX_VERSION`, which every `RunoffSnapshot` still stamps.
>
> U3 correction 2026-08-02: report query persists a `ReportRun` and is therefore `ROOT_MUTATION/BLOCK_NEW_ROOT`; live catalog, drilldown and navigation are not exact retained artifacts. Only exact stored run/view/export history remains visible under the narrow retained-read guard. Every report root/final write takes the shared entitlement lock in the same database transaction and must match the epoch/sequence stamped at request start, so OFF or OFF→ON never accepts stale work.

Normative parent: `docs/specs/feature-entitlement-decoupling-spec.md` §6.3 (lines 309-326). This file is the exhaustive
expansion §6.3 line 326 requires. It cannot broaden a §6.3 row; where §6.3 is silent the row is `BLOCKED`, not inferred.

## 1. Scope and coverage

| Surface kind | Rows | Source inventory |
|---|---|---|
| API endpoint | 544 | `f0/s2-api.json` plus the U3 retained run-history endpoint |
| ASYNC (worker/scanner/outbox/webhook/system-context) | 63 | `f0/s3-async.json` — every surface appears exactly once |
| AI_TOOL (contract tools) | 59 | `f0/s4-web-ai.json` — every tool appears exactly once |
| AI_TOOL (gateway orchestrator/router plane) | 25 | `f0/s4-web-ai.json` |
| WEB (route groups) | 53 | `f0/s4-web-ai.json` — summarising 132 page/nav/portal surfaces |
| **Total** | **744** | |

`WorkflowTask` reuse (lane S5) is a survey input, not a runoff surface; it is referenced by the workflow rows and by
Foundation exit AC30, and stays in `docs/agent-memory/f0-workflowtask-reuse-survey.md`.

## 2. Policy vocabulary and friendly fallback

| Policy | Meaning on disable | Resume path | Customer-facing Thai fallback |
|---|---|---|---|
| `ALLOWED_WHILE_OFF` | surface keeps working, including for facts captured after disable (staff view/handoff, evidence view, inbound capture) | NONE | — (no message) |
| `VISIBLE_SNAPSHOT_ONLY` | pre-disable data stays readable; no new work of any kind | RESUME | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ |
| `BLOCK_NEW_ROOT` | new commercial roots refused (403 `feature_not_enabled`); snapshotted roots unaffected | RESUME | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ |
| `PRE_CUTOFF_RUNOFF_ONLY` | allowed only for a root inside the disable-time snapshot, as the child/compensation §6.3 names | RESUME | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ |
| `STOP_IMMEDIATELY` | external send / AI action stops at once; due retries become terminal; hand off to staff | REISSUE | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ *(AI surfaces: ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้)* |
| `SKIP_SUPPRESS` | execution skipped/suppressed; evidence retained as skipped and never replayed automatically | NONE | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน |
| `PLATFORM_EXEMPT` | platform invariant or security/self-service; no commercial toggle reaches it | NONE | — (no message) |
| `BLOCKED` | §6.3 does not cover this row. Route stays CLOSED, disable is preflight-blocked, an evidence owner is named | BLOCKED | ตามสาเหตุ ณ runtime (F0-exit amendment, spec CC1 gate-close UX): ฟีเจอร์ยังไม่ได้เปิดใช้ → "ยังไม่ได้เปิดฟีเจอร์นี้"; ฟีเจอร์เปิดอยู่แต่ route ปิด → "ส่วนนี้ใช้งานชั่วคราวไม่ได้ ระบบกำลังเตรียมการ" (ห้ามใช้คำที่สื่อว่าไม่ได้ซื้อ) |

Fallback copy never contains a gate key, route key or generation. Customers never see route identifiers (spec:273).

## 3. Decision rules (applied mechanically, in order)

1. Lane-flagged `BLOCKED` row (S2/S3/S4 status) → `BLOCKED`, evidence owner = the flagging lane's family.
2. Any permission in the 39 unmapped/default-open keys (`s1-contracts.json` `unmapped[]`, `feature-gate.logic.ts:83`) → `BLOCKED`. This covers `company.settings.view`, `admin.*`, `bi.*`, `ai.template.*`, `attachment.*`, `audit.log.read`, `document.sequence.*`, `outbox.event.read`, `system.*`, `account.session.read`, `company.setup.*`, `line.ai.query`, `ai.tool.invoke`, `workflow.audit.read`.
3. `featureKey = UNMAPPED` → `BLOCKED`.
4. `mutationClass = SYSTEM` → resolved only through the async inventory owner: PLATFORM → `PLATFORM_EXEMPT`; workflow/notifications → `SKIP_SUPPRESS`; CRM/LINE/AI → `STOP_IMMEDIATELY`; anything else, or no owner row → `BLOCKED`. `auth`/`health` system endpoints are `PLATFORM_EXEMPT` under spec:281.
5. `employee_access` / `company_settings` → `PLATFORM_EXEMPT` (spec:261-262).
6. Feature with no §6.3 family row → `BLOCKED` (today: `product_catalog`, `expense_auto_post`, the AI gateway plane).
7. `READ` → in the CRM/LINE/AI and workflow/notification families, a work-invoking `POST` (AI, draft, extract, summary, test) is not a view and takes `STOP_IMMEDIATELY` / `SKIP_SUPPRESS`. Otherwise `ALLOWED_WHILE_OFF` where §6.3/§6.2 explicitly allow viewing (§6.3 r1 staff view/handoff, §6.3 r2 evidence view, `wht.certificate.read`, `company.vat_registration.*`); otherwise `VISIBLE_SNAPSHOT_ONLY`.
8. `ROOT_MUTATION` → `BLOCK_NEW_ROOT`.
9. `FINAL_MUTATION` → `PRE_CUTOFF_RUNOFF_ONLY` only when the handler/path matches a continuation the family's §6.3 row names in column 3; otherwise `BLOCKED`. CRM/LINE/AI outbound finals → `STOP_IMMEDIATELY`; workflow/notification finals → `SKIP_SUPPRESS`.

Continuation vocabulary actually used (handler+path match → §6.3 phrase):

| Family | Matched terms | §6.3 phrase relied on |
|---|---|---|
| sales_documents | payment, receipt, credit, void, cancel, correct, refund | “receive/void payment, required receipt/credit/void child, correction” |
| expenses | approve, reject, duplicate, resolve, confirm, void, settle, payment, revers | “approve/reject, duplicate resolve, confirm/void and required settlement/compensation” |
| reimbursement | approve, reject, review, payout, pay, void, revers | “approve/reject, finance review, payout/void and projection compensation” |
| procurement | goods, receipt, receive, bill, payment, pay, void, cancel | “required GR/bill/payment/void child explicitly linked to the snapshotted root” |
| double_entry_ledger | post, revers | “required posting/reversal, draft-return completion” |
| thai_tax | correct, revers, resolve, post | “required posting/reversal, draft-return completion, filing/correction task within cutover/period rules” |
| inventory | revers, compensat, cancel | “stock compensation required by a snapshotted source document” |
| bank_reconciliation | match, unmatch, reconcil, confirm, undo | “finish/undo matching for snapshotted statement lines” |
| reports | *(none)* | §6.3 r10 allows reading a generated artifact only — every report final mutation is `BLOCKED` |

## 4. Rows by feature

### ai_line_assistant

Workstream **CRM** · rows **28** · BLOCKED **0** · §6.3 coverage: §6.3 row 1 (CRM/LINE/AI customer outbound, campaigns, reminders)

Policy mix: STOP_IMMEDIATELY 13 · ALLOWED_WHILE_OFF 11 · BLOCK_NEW_ROOT 4

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_ORCHESTRATOR | `[signal] what entitlement information reaches the gateway today` | FINAL_MUTATION | feat | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | process-line-webhook.use-case.ts:407-412 |
| API | `GET /v1/companies/:companyId/ai/provider-status` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | ai-template.controller.ts:26 |
| API | `GET /v1/companies/:companyId/ai/suggestion-templates` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | ai-template.controller.ts:19 |
| API | `GET /v1/companies/:companyId/ai/suggestions` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | ai-suggestion.controller.ts:50 |
| API | `GET /v1/companies/:companyId/ai/suggestions/:id` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | ai-suggestion.controller.ts:72 |
| API | `GET /v1/companies/:companyId/crm/ai/customers/:customerId/summary` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai.controller.ts:42 |
| API | `GET /v1/companies/:companyId/crm/ai/follow-up-priorities` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai.controller.ts:35 |
| API | `GET /v1/companies/:companyId/crm/ai/opportunities/:opportunityId/summary` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai.controller.ts:49 |
| API | `GET /v1/companies/:companyId/crm/ai/pipeline-summary` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai.controller.ts:56 |
| API | `GET /v1/companies/:companyId/crm/conversations/:conversationId/ai/trust` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai-assist.controller.ts:29 |
| API | `POST /v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/create-source-draft` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ai-suggestion.controller.ts:88 |
| API | `POST /v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/validate` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | ai-suggestion.controller.ts:80 |
| API | `POST /v1/companies/:companyId/ai/suggestions/:id/reviews` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ai-suggestion.controller.ts:101 |
| API | `POST /v1/companies/:companyId/ai/suggestions/requests` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ai-suggestion.controller.ts:43 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/feedback` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-ai-assist.controller.ts:61 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/insights` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-ai-assist.controller.ts:53 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/reply-draft` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-ai-assist.controller.ts:45 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/ai/summary` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-ai-assist.controller.ts:37 |
| ASYNC | `lineAssistantDisabled gate (process-line-webhook.use-case.ts)` | FINAL_MUTATION | EG | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | process-line-webhook.use-case.ts:407-412 |
| ASYNC | `LineMessageBufferService (in-process per-chat worker)` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | line-message-buffer.service.ts:1-129 |
| ASYNC | `POST /v1/internal/ai/draft-requests/drain` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | drain-draft-requests.use-case.ts:15-19 |
| ASYNC | `POST /v1/internal/ai/draft-requests/generate` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | ai-draft-internal.controller.ts:27-33 |
| ASYNC | `POST /v1/internal/ai/line-ledger/drain` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | drain-line-ledger.use-case.ts:50-165 |
| ASYNC | `POST /v1/line/webhook and POST /v1/webhooks/line (shared WatchDog OA)` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | line-webhook.controller.ts:30-116 |
| ASYNC | `startAiDraftWorker (queue 'ai-draft')` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | ai-draft-worker.ts:18-67 |
| ASYNC | `startLineAiLedgerWorker (queue 'line-ai-ledger')` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | line-ai-ledger-worker.ts:15-64 |
| WEB | `/ai-suggestions` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:130-139 |
| WEB | `/companies/{companyId}/ai-suggestions` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |

### bank_reconciliation

Workstream **FIN** · rows **34** · BLOCKED **5** · §6.3 coverage: §6.3 row 9 (imported bank statement)

Policy mix: VISIBLE_SNAPSHOT_ONLY 14 · BLOCK_NEW_ROOT 7 · PRE_CUTOFF_RUNOFF_ONLY 6 · BLOCKED 5 · STOP_IMMEDIATELY 2

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `bank.get_account_balances` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:583 |
| AI_TOOL | `bank.get_reconciliation_status` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:595 |
| API | `GET /v1/companies/:companyId/banking/adjustments` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | adjustment.controller.ts:31 |
| API | `GET /v1/companies/:companyId/banking/adjustments/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | adjustment.controller.ts:38 |
| API | `GET /v1/companies/:companyId/banking/bank-accounts` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | bank-account.controller.ts:29 |
| API | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | bank-account.controller.ts:36 |
| API | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/match-candidates` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | matching.controller.ts:28 |
| API | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | statement.controller.ts:56 |
| API | `GET /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | statement.controller.ts:45 |
| API | `GET /v1/companies/:companyId/banking/cash-position` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reconciliation.controller.ts:76 |
| API | `GET /v1/companies/:companyId/banking/reconciliations` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reconciliation.controller.ts:31 |
| API | `GET /v1/companies/:companyId/banking/reconciliations/:sessionId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reconciliation.controller.ts:45 |
| API | `PATCH /v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | bank-account.controller.ts:50 |
| API | `POST /v1/companies/:companyId/banking/adjustments` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | adjustment.controller.ts:45 |
| API | `POST /v1/companies/:companyId/banking/adjustments/:id/approve` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | adjustment.controller.ts:61 |
| API | `POST /v1/companies/:companyId/banking/adjustments/:id/submit` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | adjustment.controller.ts:53 |
| API | `POST /v1/companies/:companyId/banking/adjustments/:id/void` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | adjustment.controller.ts:73 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | bank-account.controller.ts:43 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/deactivate` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | bank-account.controller.ts:58 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/commit` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | statement.controller.ts:78 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/extract` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | statement.controller.ts:34 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | statement.controller.ts:67 |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | statement.controller.ts:100 |
| API | `POST /v1/companies/:companyId/banking/matches/:matchId/reject` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | matching.controller.ts:47 |
| API | `POST /v1/companies/:companyId/banking/matches/:matchId/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | matching.controller.ts:59 |
| API | `POST /v1/companies/:companyId/banking/reconciliations` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reconciliation.controller.ts:38 |
| API | `POST /v1/companies/:companyId/banking/reconciliations/:sessionId/complete` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | reconciliation.controller.ts:53 |
| API | `POST /v1/companies/:companyId/banking/reconciliations/:sessionId/reopen` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | reconciliation.controller.ts:65 |
| API | `POST /v1/companies/:companyId/banking/statement-imports/:importId/void` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | statement.controller.ts:112 |
| API | `POST /v1/companies/:companyId/banking/statement-lines/:statementLineId/ignore` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | matching.controller.ts:67 |
| API | `POST /v1/companies/:companyId/banking/statement-lines/:statementLineId/matches` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | matching.controller.ts:35 |
| ASYNC | `OUTBOX_PRODUCER: banking` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | banking.statement_import.committed, bank |
| WEB | `/banking` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:228-246 |
| WEB | `/companies/{companyId}/banking` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |

### crm

Workstream **CRM** · rows **113** · BLOCKED **11** · §6.3 coverage: §6.3 row 1 (CRM/LINE/AI customer outbound, campaigns, reminders)

Policy mix: BLOCK_NEW_ROOT 40 · ALLOWED_WHILE_OFF 40 · STOP_IMMEDIATELY 22 · BLOCKED 11

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `crm.get_booking_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:319 |
| AI_TOOL | `crm.get_conversation_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:370 |
| AI_TOOL | `crm.get_customer_360` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:267 |
| AI_TOOL | `crm.get_customer_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:241 |
| AI_TOOL | `crm.get_inbox_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:345 |
| AI_TOOL | `crm.get_pipeline_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:293 |
| AI_TOOL | `crm.get_report_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:280 |
| AI_TOOL | `crm.list_bookings` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:332 |
| AI_TOOL | `crm.list_conversations` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:357 |
| AI_TOOL | `crm.list_open_followups` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:306 |
| AI_TOOL | `crm.search_customers` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:254 |
| AI_TOOL | `crm.suggest_sales_followups` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:383 |
| AI_TOOL | `sales.get_sales_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | CRM | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:228 |
| API | `GET /v1/companies/:companyId/crm/activities` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:81 |
| API | `GET /v1/companies/:companyId/crm/bookings` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-booking.controller.ts:46 |
| API | `GET /v1/companies/:companyId/crm/bookings/availability` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-booking.controller.ts:53 |
| API | `GET /v1/companies/:companyId/crm/bookings/by-customer/:customerId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-booking.controller.ts:67 |
| API | `GET /v1/companies/:companyId/crm/bookings/settings` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-booking.controller.ts:32 |
| API | `GET /v1/companies/:companyId/crm/campaigns` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-campaign.controller.ts:11 |
| API | `GET /v1/companies/:companyId/crm/conversations` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-conversation.controller.ts:49 |
| API | `GET /v1/companies/:companyId/crm/conversations/:conversationId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-conversation.controller.ts:76 |
| API | `GET /v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/content` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-conversation.controller.ts:85 |
| API | `GET /v1/companies/:companyId/crm/customers` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer.controller.ts:55 |
| API | `GET /v1/companies/:companyId/crm/customers/:customerId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer.controller.ts:94 |
| API | `GET /v1/companies/:companyId/crm/customers/:customerId/contacts` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer.controller.ts:134 |
| API | `GET /v1/companies/:companyId/crm/customers/:customerId/summary360` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer-360.controller.ts:24 |
| API | `GET /v1/companies/:companyId/crm/customers/:customerId/timeline` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer-360.controller.ts:31 |
| API | `GET /v1/companies/:companyId/crm/daily-brief` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-conversation-actions.controller.ts:102 |
| API | `GET /v1/companies/:companyId/crm/dashboard/summary` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-ai.controller.ts:28 |
| API | `GET /v1/companies/:companyId/crm/follow-ups` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-follow-up.controller.ts:39 |
| API | `GET /v1/companies/:companyId/crm/inbox-policy` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-inbox-policy.controller.ts:19 |
| API | `GET /v1/companies/:companyId/crm/leads` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-lead.controller.ts:42 |
| API | `GET /v1/companies/:companyId/crm/leads/:leadId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-lead.controller.ts:66 |
| API | `GET /v1/companies/:companyId/crm/opportunities` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:113 |
| API | `GET /v1/companies/:companyId/crm/opportunities/:opportunityId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:138 |
| API | `GET /v1/companies/:companyId/crm/opportunities/:opportunityId/quotations` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:178 |
| API | `GET /v1/companies/:companyId/crm/opportunities/board` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:106 |
| API | `GET /v1/companies/:companyId/crm/pipeline/stages` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-opportunity.controller.ts:65 |
| API | `GET /v1/companies/:companyId/crm/reports/summary` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-reports.controller.ts:19 |
| API | `GET /v1/companies/:companyId/crm/templates` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-template.controller.ts:28 |
| API | `GET /v1/companies/:companyId/settings/discount-policy` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | business-policy.controller.ts:16 |
| API | `PATCH /v1/companies/:companyId/crm/bookings/:bookingId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-booking.controller.ts:81 |
| API | `PATCH /v1/companies/:companyId/crm/bookings/settings` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-booking.controller.ts:39 |
| API | `PATCH /v1/companies/:companyId/crm/contacts/:contactId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:148 |
| API | `PATCH /v1/companies/:companyId/crm/customers/:customerId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:101 |
| API | `PATCH /v1/companies/:companyId/crm/follow-ups/:followUpId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-follow-up.controller.ts:64 |
| API | `PATCH /v1/companies/:companyId/crm/leads/:leadId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-lead.controller.ts:73 |
| API | `PATCH /v1/companies/:companyId/crm/opportunities/:opportunityId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:145 |
| API | `POST /v1/companies/:companyId/crm/activities` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:97 |
| API | `POST /v1/companies/:companyId/crm/bookings` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-booking.controller.ts:74 |
| API | `POST /v1/companies/:companyId/crm/bookings/:bookingId/cancel` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-booking.controller.ts:88 |
| API | `POST /v1/companies/:companyId/crm/campaigns/:id/preview` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-campaign.controller.ts:13 |
| API | `POST /v1/companies/:companyId/crm/campaigns/:id/send` | FINAL_MUTATION | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-campaign.controller.ts:14 |
| API | `POST /v1/companies/:companyId/crm/campaigns/drafts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-campaign.controller.ts:12 |
| API | `POST /v1/companies/:companyId/crm/campaigns/generate` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-campaign.controller.ts:15 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-deal` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:34 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-quotation` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:48 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/create-task` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:41 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/messages` | FINAL_MUTATION | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-conversation.controller.ts:103 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/flag-payment-proof` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:55 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/notes` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:116 |
| API | `POST /v1/companies/:companyId/crm/conversations/:conversationId/read` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:184 |
| API | `POST /v1/companies/:companyId/crm/customers` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:73 |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/archive` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:120 |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/assign` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:127 |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/contacts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-customer.controller.ts:141 |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/erase` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-360.controller.ts:43 |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/line-identities/:identityId/link` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer.controller.ts:108 |
| API | `POST /v1/companies/:companyId/crm/customers/ai-profile-extract` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-ai-assist.controller.ts:75 |
| API | `POST /v1/companies/:companyId/crm/customers/merge` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer.controller.ts:87 |
| API | `POST /v1/companies/:companyId/crm/customers/merge/preview` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | crm-customer.controller.ts:80 |
| API | `POST /v1/companies/:companyId/crm/follow-ups` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-follow-up.controller.ts:57 |
| API | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/cancel` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-follow-up.controller.ts:88 |
| API | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/complete` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-follow-up.controller.ts:72 |
| API | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/snooze` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-follow-up.controller.ts:80 |
| API | `POST /v1/companies/:companyId/crm/leads` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-lead.controller.ts:59 |
| API | `POST /v1/companies/:companyId/crm/leads/:leadId/assign` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-lead.controller.ts:81 |
| API | `POST /v1/companies/:companyId/crm/leads/:leadId/convert` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-lead.controller.ts:89 |
| API | `POST /v1/companies/:companyId/crm/leads/:leadId/disqualify` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-lead.controller.ts:97 |
| API | `POST /v1/companies/:companyId/crm/opportunities` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:131 |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/close` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-opportunity.controller.ts:161 |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/quotation-drafts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:185 |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/quotations/:linkId/refresh` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:193 |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/reopen` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-opportunity.controller.ts:169 |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/stage` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:153 |
| API | `POST /v1/companies/:companyId/crm/templates` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-template.controller.ts:43 |
| API | `POST /v1/companies/:companyId/crm/templates/:templateId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-template.controller.ts:51 |
| API | `POST /v1/companies/:companyId/crm/templates/:templateId/approve-ai` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-template.controller.ts:36 |
| API | `POST /v1/companies/:companyId/crm/templates/:templateId/archive` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-template.controller.ts:63 |
| API | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/assign` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:173 |
| API | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/auto-reply` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:149 |
| API | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/priority` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:138 |
| API | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/status` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:127 |
| API | `PUT /v1/companies/:companyId/crm/conversations/:conversationId/tags` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-conversation.controller.ts:160 |
| API | `PUT /v1/companies/:companyId/crm/inbox-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-inbox-policy.controller.ts:26 |
| API | `PUT /v1/companies/:companyId/crm/pipeline/stages` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | crm-opportunity.controller.ts:72 |
| API | `PUT /v1/companies/:companyId/settings/discount-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | business-policy.controller.ts:21 |
| ASYNC | `OUTBOX_PRODUCER: crm (leads/opportunities/follow-ups/quotation link)` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm.lead.*, crm.opportunity.*, crm.follo |
| ASYNC | `POST /v1/internal/crm/inbox-retry-scan` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | retry-crm-inbox-deliveries.use-case.ts:60-300 |
| ASYNC | `POST /v1/internal/crm/new-conversation-scan` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | scan-crm-new-conversations.use-case.ts:23-46 |
| ASYNC | `POST /v1/internal/crm/sla-breach-scan` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | scan-crm-sla-breaches.use-case.ts:25-90 |
| ASYNC | `startCrmSlaWorker (queue 'crm-inbox')` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-sla-worker.ts:11-83 |
| ASYNC | `SYSTEM_ACTOR / actorType 'SYSTEM' (CRM sweeps)` | FINAL_MUTATION | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | retry-crm-inbox-deliveries.use-case.ts:151-165 |
| WEB | `/bookings` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:45-54 |
| WEB | `/companies/{companyId}/bookings` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/crm` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/crm-reports` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/customers` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/inbox` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | page.ts |
| WEB | `/crm` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:268-285 |
| WEB | `/crm-reports` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:55-64 |
| WEB | `/customers` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:35-44 |
| WEB | `/inbox` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | web-core-workspace.constants.ts:15-24 |

### dashboard_notifications

Workstream **WF** · rows **33** · BLOCKED **1** · §6.3 coverage: §6.3 row 2 (workflow/notifications)

Policy mix: SKIP_SUPPRESS 12 · ALLOWED_WHILE_OFF 11 · BLOCK_NEW_ROOT 6 · STOP_IMMEDIATELY 3 · BLOCKED 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `dashboard.get_business_health_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:89 |
| AI_TOOL | `notifications.get_daily_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:113 |
| AI_TOOL | `notifications.list_open_alerts` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:101 |
| API | `GET /v1/companies/:companyId/dashboard` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | dashboard.controller.ts:15 |
| API | `GET /v1/companies/:companyId/dashboard/snapshots/latest` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | dashboard.controller.ts:26 |
| API | `GET /v1/companies/:companyId/notification-deliveries` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | notification.controller.ts:118 |
| API | `GET /v1/companies/:companyId/notification-preferences` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | notification.controller.ts:80 |
| API | `GET /v1/companies/:companyId/notification-rules` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | notification.controller.ts:99 |
| API | `GET /v1/companies/:companyId/notifications` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | notification.controller.ts:33 |
| API | `GET /v1/companies/:companyId/notifications/unread-count` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | notification.controller.ts:47 |
| API | `POST /v1/companies/:companyId/dashboard/snapshots/generate` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | dashboard.controller.ts:37 |
| API | `POST /v1/companies/:companyId/notification-deliveries/:deliveryId/retry` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification.controller.ts:125 |
| API | `POST /v1/companies/:companyId/notifications/:notificationId/dismiss` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | notification.controller.ts:68 |
| API | `POST /v1/companies/:companyId/notifications/:notificationId/read` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | notification.controller.ts:54 |
| API | `POST /v1/companies/:companyId/notifications/read-all` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | notification.controller.ts:61 |
| API | `PUT /v1/companies/:companyId/notification-preferences` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | notification.controller.ts:87 |
| API | `PUT /v1/companies/:companyId/notification-rules/:ruleId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | notification.controller.ts:106 |
| ASYNC | `notifications daily_owner_summary cron` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-jobs.ts:59 |
| ASYNC | `POST /v1/internal/companies/:companyId/dashboard/snapshots/generate` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:84-93 |
| ASYNC | `POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification.use-cases.ts:285-446 |
| ASYNC | `POST /v1/internal/companies/:companyId/notifications/daily-owner-summary` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:105-115 |
| ASYNC | `POST /v1/internal/companies/:companyId/notifications/scan/stock-low` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:95-103 |
| ASYNC | `POST /v1/internal/notifications/daily-owner-summary-sweep` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-sweeps.use-cases.ts:72-90 |
| ASYNC | `POST /v1/internal/notifications/delivery-sweep` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:34-38 |
| ASYNC | `POST /v1/internal/notifications/snapshot-sweep` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-sweeps.use-cases.ts:52-60 |
| ASYNC | `POST /v1/internal/notifications/stock-low-sweep` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-sweeps.use-cases.ts:62-70 |
| ASYNC | `startNotificationWorker (queue 'notifications')` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-worker.ts:18-145 |
| ASYNC | `WORKER_NOTIFICATION_PERMISSIONS` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | notification-sweeps.use-cases.ts:17-31 |
| WEB | `/companies/{companyId}/dashboard` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/notifications` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | page.ts |
| WEB | `/dashboard` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | web-core-workspace.constants.ts:4-14 |
| WEB | `/notifications` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | web-core-workspace.constants.ts:343-354 |
| WEB | `header notification bell / account-security menu` | READ | perm | `BLOCKED` | BLOCKED | WF | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | WorkspaceLayout.ts |

### double_entry_ledger

Workstream **FIN** · rows **33** · BLOCKED **4** · §6.3 coverage: §6.3 row 7 (ledger/tax work from snapshotted financial roots)

Policy mix: VISIBLE_SNAPSHOT_ONLY 18 · BLOCK_NEW_ROOT 6 · BLOCKED 4 · STOP_IMMEDIATELY 3 · PRE_CUTOFF_RUNOFF_ONLY 2

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `ledger.get_financial_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:188 |
| AI_TOOL | `ledger.get_period_status` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:515 |
| AI_TOOL | `ledger.get_report_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:528 |
| API | `GET /v1/companies/:companyId/chart-of-accounts` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:68 |
| API | `GET /v1/companies/:companyId/chart-of-accounts/:accountId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:111 |
| API | `GET /v1/companies/:companyId/chart-of-accounts/readiness` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:104 |
| API | `GET /v1/companies/:companyId/chart-of-accounts/templates` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:75 |
| API | `GET /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:82 |
| API | `GET /v1/companies/:companyId/journal-entries` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:134 |
| API | `GET /v1/companies/:companyId/journal-entries/:journalId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:141 |
| API | `GET /v1/companies/:companyId/periods` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:199 |
| API | `GET /v1/companies/:companyId/reports/balance-sheet` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:261 |
| API | `GET /v1/companies/:companyId/reports/general-ledger` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:240 |
| API | `GET /v1/companies/:companyId/reports/profit-and-loss` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:254 |
| API | `GET /v1/companies/:companyId/reports/trial-balance` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:247 |
| API | `GET /v1/companies/:companyId/tax/account-determination` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:181 |
| API | `PATCH /v1/companies/:companyId/chart-of-accounts/:accountId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:125 |
| API | `POST /v1/companies/:companyId/chart-of-accounts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:118 |
| API | `POST /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ledger.controller.ts:93 |
| API | `POST /v1/companies/:companyId/journal-entries/:journalId/post` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | ledger.controller.ts:156 |
| API | `POST /v1/companies/:companyId/journal-entries/:journalId/reverse` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:164 |
| API | `POST /v1/companies/:companyId/journal-entries/manual` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:148 |
| API | `POST /v1/companies/:companyId/periods/:periodId/close` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ledger.controller.ts:223 |
| API | `POST /v1/companies/:companyId/periods/:periodId/close-checks` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:215 |
| API | `POST /v1/companies/:companyId/periods/:periodId/unclose` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ledger.controller.ts:231 |
| API | `POST /v1/companies/:companyId/periods/ensure/:periodKey` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:207 |
| API | `POST /v1/companies/:companyId/posting/generate` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | ledger.controller.ts:172 |
| API | `POST /v1/companies/:companyId/reports/:reportType/export` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:269 |
| ASYNC | `OUTBOX_PRODUCER: ledger` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | journal.posted, journal.reversed, journa |
| WEB | `/companies/{companyId}/journal` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/period-closing` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/journal` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:160-169 |
| WEB | `/period-closing` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:258-267 |

### expense_auto_post

Workstream **FIN** · rows **3** · BLOCKED **3** · §6.3 coverage: **none** — automatic posting is not named in §6.3

Policy mix: BLOCKED 3

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| ASYNC | `EXPENSE_AUTO_POST_WORKER_PERMISSIONS` | SYSTEM | EG | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense-auto-post.use-case.ts:9-22 |
| ASYNC | `POST /v1/internal/ledger/expense-auto-post/drain` | FINAL_MUTATION | EG | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense-auto-post.use-case.ts:83-130 |
| ASYNC | `startExpenseAutoPostWorker (queue 'expense-auto-post')` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense-auto-post-worker.ts:4-15 |

### expenses

Workstream **FIN** · rows **53** · BLOCKED **4** · §6.3 coverage: §6.3 row 4 (expense already submitted/ready)

Policy mix: BLOCK_NEW_ROOT 24 · VISIBLE_SNAPSHOT_ONLY 14 · PRE_CUTOFF_RUNOFF_ONLY 7 · BLOCKED 4 · STOP_IMMEDIATELY 4

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `accounting.capture_receipt_evidence` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:395 |
| AI_TOOL | `expense.get_breakdown` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:568 |
| AI_TOOL | `expense.get_detail` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:214 |
| AI_TOOL | `expense.list_recent` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:200 |
| API | `DELETE /v1/companies/:companyId/expenses/:expenseId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:191 |
| API | `GET /v1/companies/:companyId/expense-categories` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:413 |
| API | `GET /v1/companies/:companyId/expense-categories/manage` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:420 |
| API | `GET /v1/companies/:companyId/expense-settings/substitute-receipt/runtime` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:452 |
| API | `GET /v1/companies/:companyId/expense-signatures` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:477 |
| API | `GET /v1/companies/:companyId/expenses` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:106 |
| API | `GET /v1/companies/:companyId/expenses/:expenseId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:197 |
| API | `GET /v1/companies/:companyId/expenses/:expenseId/source-posting-input` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:397 |
| API | `GET /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/history` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:215 |
| API | `GET /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/payers` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:209 |
| API | `GET /v1/companies/:companyId/expenses/shared-evidence` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:148 |
| API | `GET /v1/companies/:companyId/posting/expense-backfill-preview` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | ledger.controller.ts:179 |
| API | `PATCH /v1/companies/:companyId/expense-categories/:categoryId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:432 |
| API | `PATCH /v1/companies/:companyId/expenses/:expenseId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:300 |
| API | `PATCH /v1/companies/:companyId/expenses/:expenseId/review-fields` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:306 |
| API | `POST /v1/companies/:companyId/expense-categories` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:426 |
| API | `POST /v1/companies/:companyId/expense-signatures` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:489 |
| API | `POST /v1/companies/:companyId/expense-signatures/:signatureId/approve` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:495 |
| API | `POST /v1/companies/:companyId/expense-signatures/:signatureId/archive` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:507 |
| API | `POST /v1/companies/:companyId/expense-signatures/:signatureId/derived` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:514 |
| API | `POST /v1/companies/:companyId/expense-signatures/:signatureId/reject` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:501 |
| API | `POST /v1/companies/:companyId/expense-signatures/uploads` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:483 |
| API | `POST /v1/companies/:companyId/expenses` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:175 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/confirm` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:351 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/duplicate-check` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:379 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/confirm` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:391 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/dismiss` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:385 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/extraction-request` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:288 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/mark-ready` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:339 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/non-expense-classification-override` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:312 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/payment` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:369 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/receipt-uploads/:attachmentId/complete` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:328 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/reject` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:357 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/reviewer-mark-ready` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:345 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/signature-fill` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:294 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:203 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/approve` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:266 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/certify` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense.controller.ts:221 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:232 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-upload-intent` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:243 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-uploads/:attachmentId/complete` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:254 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/supersede` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense.controller.ts:277 |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | expense.controller.ts:363 |
| API | `POST /v1/companies/:companyId/expenses/accountant-package` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:169 |
| API | `POST /v1/companies/:companyId/expenses/receipt-uploads` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | expense.controller.ts:181 |
| API | `POST /v1/companies/:companyId/posting/expense-backfill` | FINAL_MUTATION | EG | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ledger.controller.ts:187 |
| ASYNC | `OUTBOX_PRODUCER: expenses` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense.receipt_uploaded, expense.line_r |
| WEB | `/companies/{companyId}/expenses` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/expenses` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:140-159 |

### inventory

Workstream **INV** · rows **25** · BLOCKED **5** · §6.3 coverage: §6.3 row 8 (inventory)

Policy mix: VISIBLE_SNAPSHOT_ONLY 11 · BLOCK_NEW_ROOT 8 · BLOCKED 5 · STOP_IMMEDIATELY 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `inventory.summarize_stock_movements` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | INV | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:175 |
| API | `GET /v1/companies/:companyId/inventory/balances` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-movement.controller.ts:77 |
| API | `GET /v1/companies/:companyId/inventory/labels` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-qr.controller.ts:20 |
| API | `GET /v1/companies/:companyId/inventory/locations` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:31 |
| API | `GET /v1/companies/:companyId/inventory/locations/:locationId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:73 |
| API | `GET /v1/companies/:companyId/inventory/locations/:locationId/balances` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:52 |
| API | `GET /v1/companies/:companyId/inventory/movements` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-movement.controller.ts:25 |
| API | `GET /v1/companies/:companyId/inventory/products/:productId/balances` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-product.controller.ts:64 |
| API | `GET /v1/companies/:companyId/inventory/products/:productId/movements` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-product.controller.ts:51 |
| API | `GET /v1/companies/:companyId/inventory/reports/stock` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | inventory-movement.controller.ts:84 |
| API | `PATCH /v1/companies/:companyId/inventory/locations/:locationId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:80 |
| API | `POST /v1/companies/:companyId/inventory/labels/:labelId/printed` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-qr.controller.ts:53 |
| API | `POST /v1/companies/:companyId/inventory/labels/generate` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-qr.controller.ts:32 |
| API | `POST /v1/companies/:companyId/inventory/locations` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:45 |
| API | `POST /v1/companies/:companyId/inventory/locations/:locationId/archive` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:66 |
| API | `POST /v1/companies/:companyId/inventory/locations/:locationId/internal-qr` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-location.controller.ts:59 |
| API | `POST /v1/companies/:companyId/inventory/movements/adjust` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-movement.controller.ts:69 |
| API | `POST /v1/companies/:companyId/inventory/movements/count` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-movement.controller.ts:62 |
| API | `POST /v1/companies/:companyId/inventory/movements/issue` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-movement.controller.ts:48 |
| API | `POST /v1/companies/:companyId/inventory/movements/receive` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-movement.controller.ts:41 |
| API | `POST /v1/companies/:companyId/inventory/movements/transfer` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-movement.controller.ts:55 |
| API | `POST /v1/companies/:companyId/inventory/products/:productId/barcodes` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-product.controller.ts:71 |
| API | `POST /v1/companies/:companyId/inventory/products/:productId/internal-qr` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | INV | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | inventory-product.controller.ts:78 |
| WEB | `/companies/{companyId}/inventory` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/inventory` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | INV | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:76-94 |

### line_oa

Workstream **CRM** · rows **11** · BLOCKED **2** · §6.3 coverage: §6.3 row 1 (CRM/LINE/AI customer outbound, campaigns, reminders)

Policy mix: ALLOWED_WHILE_OFF 4 · BLOCK_NEW_ROOT 4 · BLOCKED 2 · STOP_IMMEDIATELY 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| API | `GET /v1/companies/:companyId/crm/channels` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | messaging-channel.controller.ts:38 |
| API | `GET /v1/companies/:companyId/settings/consent-policy` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | business-policy.controller.ts:47 |
| API | `GET /v1/companies/:companyId/settings/retention-policy` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | business-policy.controller.ts:39 |
| API | `PATCH /v1/companies/:companyId/crm/channels/:channelId/settings` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | messaging-channel.controller.ts:52 |
| API | `POST /v1/companies/:companyId/crm/channels` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | messaging-channel.controller.ts:45 |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/disable` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | messaging-channel.controller.ts:81 |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/reveal` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | CRM | — | RESOLVED | messaging-channel.controller.ts:92 |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/rotate` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | messaging-channel.controller.ts:70 |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/test` | READ | PS | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | messaging-channel.controller.ts:63 |
| API | `PUT /v1/companies/:companyId/settings/consent-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | business-policy.controller.ts:51 |
| API | `PUT /v1/companies/:companyId/settings/retention-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | business-policy.controller.ts:43 |

### procurement

Workstream **FIN** · rows **60** · BLOCKED **7** · §6.3 coverage: §6.3 row 6 (issued PO / posted GR / approved vendor bill)

Policy mix: VISIBLE_SNAPSHOT_ONLY 25 · BLOCK_NEW_ROOT 14 · PRE_CUTOFF_RUNOFF_ONLY 10 · BLOCKED 7 · STOP_IMMEDIATELY 4

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `procurement.get_ap_outstanding` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:464 |
| AI_TOOL | `procurement.get_purchase_order_detail` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:502 |
| AI_TOOL | `procurement.get_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:476 |
| AI_TOOL | `procurement.search_suppliers` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:489 |
| API | `GET /v1/companies/:companyId/accounts-payable/aging` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:67 |
| API | `GET /v1/companies/:companyId/accounts-payable/payments` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:25 |
| API | `GET /v1/companies/:companyId/accounts-payable/payments/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:39 |
| API | `GET /v1/companies/:companyId/accounts-payable/payments/:id/posting-source` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:46 |
| API | `GET /v1/companies/:companyId/accounts-payable/payments/:id/pp36-posting-source` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:53 |
| API | `GET /v1/companies/:companyId/accounts-payable/suppliers/:supplierId/statement` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier-payment.controller.ts:74 |
| API | `GET /v1/companies/:companyId/accounts-payable/vendor-bills` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:32 |
| API | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:68 |
| API | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id/posting-source` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:89 |
| API | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/:id/pp36-posting-source` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:54 |
| API | `GET /v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:40 |
| API | `GET /v1/companies/:companyId/procurement/goods-receipts` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | goods-receipt.controller.ts:21 |
| API | `GET /v1/companies/:companyId/procurement/goods-receipts/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | goods-receipt.controller.ts:35 |
| API | `GET /v1/companies/:companyId/procurement/purchase-orders` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | purchase-order.controller.ts:24 |
| API | `GET /v1/companies/:companyId/procurement/purchase-orders/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | purchase-order.controller.ts:38 |
| API | `GET /v1/companies/:companyId/procurement/purchase-requests` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | purchase-request.controller.ts:23 |
| API | `GET /v1/companies/:companyId/procurement/purchase-requests/:id` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | purchase-request.controller.ts:37 |
| API | `GET /v1/companies/:companyId/procurement/suppliers` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:22 |
| API | `GET /v1/companies/:companyId/procurement/suppliers/:supplierId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:36 |
| API | `GET /v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:50 |
| API | `GET /v1/companies/:companyId/settings/po-approval` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | business-policy.controller.ts:28 |
| API | `PATCH /v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:75 |
| API | `PATCH /v1/companies/:companyId/procurement/suppliers/:supplierId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:43 |
| API | `POST /v1/companies/:companyId/accounts-payable/payments` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | supplier-payment.controller.ts:32 |
| API | `POST /v1/companies/:companyId/accounts-payable/payments/:id/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | supplier-payment.controller.ts:60 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:61 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/approve` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | vendor-bill.controller.ts:117 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/match` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:96 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/match/override` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | vendor-bill.controller.ts:103 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/reject` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | vendor-bill.controller.ts:124 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/submit` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:110 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence/review` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:82 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:id/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | vendor-bill.controller.ts:131 |
| API | `POST /v1/companies/:companyId/procurement/goods-receipts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | goods-receipt.controller.ts:28 |
| API | `POST /v1/companies/:companyId/procurement/goods-receipts/:id/post` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | goods-receipt.controller.ts:42 |
| API | `POST /v1/companies/:companyId/procurement/goods-receipts/:id/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | goods-receipt.controller.ts:49 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | purchase-order.controller.ts:31 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/approve` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-order.controller.ts:45 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/cancel` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | purchase-order.controller.ts:66 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/close` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-order.controller.ts:73 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/issue` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-order.controller.ts:52 |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/reject` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-order.controller.ts:59 |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | purchase-request.controller.ts:30 |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/approve` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-request.controller.ts:51 |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/cancel` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | purchase-request.controller.ts:65 |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/reject` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | purchase-request.controller.ts:58 |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/submit` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | purchase-request.controller.ts:44 |
| API | `POST /v1/companies/:companyId/procurement/suppliers` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:29 |
| API | `POST /v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | supplier.controller.ts:57 |
| API | `PUT /v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | vendor-bill.controller.ts:47 |
| API | `PUT /v1/companies/:companyId/settings/po-approval` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | business-policy.controller.ts:33 |
| ASYNC | `OUTBOX_PRODUCER: procurement` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | goods-receipt.use-case.ts:103 |
| WEB | `/accounts-payable` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:202-217 |
| WEB | `/companies/{companyId}/accounts-payable` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/procurement` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/procurement` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:95-111 |

### product_catalog

Workstream **INV** · rows **12** · BLOCKED **12** · §6.3 coverage: **none** — product_catalog has no §6.3 family row

Policy mix: BLOCKED 12

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `inventory.get_product_detail` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:138 |
| AI_TOOL | `inventory.get_stock_balance` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:151 |
| AI_TOOL | `inventory.list_low_stock` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:163 |
| AI_TOOL | `inventory.search_products` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:125 |
| API | `GET /v1/companies/:companyId/inventory/labels/resolve` | READ | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-qr.controller.ts:39 |
| API | `GET /v1/companies/:companyId/inventory/products` | READ | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-product.controller.ts:30 |
| API | `GET /v1/companies/:companyId/inventory/products/:productId` | READ | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-product.controller.ts:92 |
| API | `PATCH /v1/companies/:companyId/inventory/products/:productId` | ROOT_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-product.controller.ts:99 |
| API | `POST /v1/companies/:companyId/inventory/labels/scan` | ROOT_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-qr.controller.ts:46 |
| API | `POST /v1/companies/:companyId/inventory/products` | ROOT_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-product.controller.ts:44 |
| API | `POST /v1/companies/:companyId/inventory/products/:productId/archive` | ROOT_MUTATION | PS | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory-product.controller.ts:85 |
| WEB | `/settings` | READ | perm | `BLOCKED` | BLOCKED | INV | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | web-core-workspace.constants.ts:65-74 |

### reimbursement

Workstream **FIN** · rows **29** · BLOCKED **4** · §6.3 coverage: §6.3 row 5 (reimbursement submitted/approved)

Policy mix: VISIBLE_SNAPSHOT_ONLY 11 · BLOCK_NEW_ROOT 8 · BLOCKED 4 · PRE_CUTOFF_RUNOFF_ONLY 3 · STOP_IMMEDIATELY 3

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `reimbursement.get_detail` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:632 |
| AI_TOOL | `reimbursement.get_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:619 |
| AI_TOOL | `reimbursement.list_pending_approvals` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:607 |
| API | `GET /v1/companies/:companyId/reimbursement-policy` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement-policy.controller.ts:19 |
| API | `GET /v1/companies/:companyId/reimbursements` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:128 |
| API | `GET /v1/companies/:companyId/reimbursements/:requestId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:155 |
| API | `GET /v1/companies/:companyId/reimbursements/:requestId/export` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:233 |
| API | `GET /v1/companies/:companyId/reimbursements/approval-queue` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:98 |
| API | `GET /v1/companies/:companyId/reimbursements/finance-queue` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:105 |
| API | `GET /v1/companies/:companyId/reimbursements/posting/pending` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:112 |
| API | `GET /v1/companies/:companyId/reimbursements/summary` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:119 |
| API | `PATCH /v1/companies/:companyId/reimbursements/:requestId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:162 |
| API | `POST /v1/companies/:companyId/reimbursements` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:148 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/approve` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | reimbursement.controller.ts:188 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/cancel` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | reimbursement.controller.ts:178 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:243 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-upload-intent` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:255 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-uploads/:attachmentId/complete` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:262 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signatures` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | reimbursement.controller.ts:275 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signed-copies` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:283 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/finance-review` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:206 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/payments` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | reimbursement.controller.ts:213 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | reimbursement.controller.ts:221 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/reject` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | reimbursement.controller.ts:196 |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/submit` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement.controller.ts:170 |
| API | `PUT /v1/companies/:companyId/reimbursement-policy` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | reimbursement-policy.controller.ts:26 |
| ASYNC | `OUTBOX_PRODUCER: reimbursements` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | reimbursement.request_submitted, .approv |
| WEB | `/companies/{companyId}/reimbursements` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/reimbursements` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:218-227 |

### reports

Workstream **RPT** · rows **15** · BLOCKED **0** · §6.3 coverage: §6.3 row 10 (reports)

Policy mix: VISIBLE_SNAPSHOT_ONLY 6 · BLOCK_NEW_ROOT 5 · STOP_IMMEDIATELY 4

Saved views retain query configuration, not result rows. New/updated views automatically capture one deterministic effective source-permission path (catalog priority: broad before own-only; explicit personal scope may select own-only) plus branch/location/team scope in additive JSON columns; no customer entry or backfill is required. Redundant permissions held at save time are not added to the snapshot, so removing one does not hide a view when its selected broad path remains. A later broad-to-own downgrade fails closed because the original view may cover company-wide data. The retained read requires current authority to dominate that creation snapshot and also rejects scoped filter identifiers outside current authority. Legacy `{}` rows remain usable while Reports is ON and fail closed only on the retained OFF path. Existing `ROLE`/`TEAM` view rows remain fail-closed because request context has no canonical shared role/team IDs; U3 does not claim role/team sharing support or widen the pre-existing repository query (`owner OR COMPANY`).

Retained runs, views and exports require current source/scope authority to dominate the authority captured at creation. Missing/malformed legacy authority snapshots fail closed while OFF; export bytes are never recomputed. Retained `report.audit.read` and `report.export.manage` preserve accountant/admin read continuity for artifacts their role already authorized, while every mutation permission remains stripped.

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `reports.get_monthly_report_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | RPT | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:659 |
| API | `GET /v1/companies/:companyId/reports/catalog` | READ | PS | `STOP_IMMEDIATELY` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ | RESOLVED | report.controller.ts:41 |
| API | `GET /v1/companies/:companyId/reports/exports` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:100 |
| API | `GET /v1/companies/:companyId/reports/exports/:exportId/download` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:114 |
| API | `GET /v1/companies/:companyId/reports/runs/:runId` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:56 |
| API | `GET /v1/companies/:companyId/reports/runs` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูประวัติรายงานเดิมที่ยังอยู่ในสิทธิ์ของคุณได้ | RESOLVED | report.controller.ts:runsHandler |
| API | `GET /v1/companies/:companyId/reports/views` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:71 |
| API | `PATCH /v1/companies/:companyId/reports/views/:viewId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:85 |
| API | `POST /v1/companies/:companyId/reports/drilldown` | FINAL_MUTATION | PS | `STOP_IMMEDIATELY` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ | RESOLVED | report.controller.ts:64 |
| API | `POST /v1/companies/:companyId/reports/exports` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:107 |
| API | `POST /v1/companies/:companyId/reports/query` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:49 |
| API | `POST /v1/companies/:companyId/reports/views` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:78 |
| API | `POST /v1/companies/:companyId/reports/views/:viewId/archive` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | report.controller.ts:93 |
| WEB | `/companies/{companyId}/reports` | READ | EG | `VISIBLE_SNAPSHOT_ONLY` | RESUME | RPT | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/reports` | READ | perm | `STOP_IMMEDIATELY` | RESUME | RPT | ยังไม่ได้เปิดฟีเจอร์นี้ | RESOLVED | web-core-workspace.constants.ts:247-257 |

### sales_documents

Workstream **FIN** · rows **31** · BLOCKED **4** · §6.3 coverage: §6.3 row 3 (sales document already issued/part-paid)

Policy mix: VISIBLE_SNAPSHOT_ONLY 15 · BLOCK_NEW_ROOT 5 · BLOCKED 4 · STOP_IMMEDIATELY 4 · PRE_CUTOFF_RUNOFF_ONLY 3

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `accounting.get_document_detail` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:439 |
| AI_TOOL | `accounting.get_receivable_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:452 |
| AI_TOOL | `accounting.get_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:413 |
| AI_TOOL | `accounting.list_recent_documents` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:426 |
| API | `GET /v1/companies/:companyId/accounting/counterparties` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | counterparty.controller.ts:46 |
| API | `GET /v1/companies/:companyId/accounting/counterparties/:counterpartyId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | counterparty.controller.ts:57 |
| API | `GET /v1/companies/:companyId/accounting/documents` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:39 |
| API | `GET /v1/companies/:companyId/accounting/documents/:documentId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:65 |
| API | `GET /v1/companies/:companyId/accounting/documents/:documentId/posting-source` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:72 |
| API | `GET /v1/companies/:companyId/accounting/payments` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | accounting-payment.controller.ts:27 |
| API | `GET /v1/companies/:companyId/accounting/payments/:paymentId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | accounting-payment.controller.ts:49 |
| API | `GET /v1/companies/:companyId/crm/payment-proofs` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:69 |
| API | `GET /v1/companies/:companyId/crm/payment-proofs/:conversationId/messages/:messageId/content` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | crm-conversation-actions.controller.ts:76 |
| API | `PATCH /v1/companies/:companyId/accounting/counterparties/:counterpartyId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | counterparty.controller.ts:77 |
| API | `POST /v1/companies/:companyId/accounting/counterparties` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | counterparty.controller.ts:67 |
| API | `POST /v1/companies/:companyId/accounting/documents` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:79 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/approve` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | accounting-document.controller.ts:111 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/convert` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:127 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/issue` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | accounting-document.controller.ts:87 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/reject` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | accounting-document.controller.ts:119 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/submit-approval` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | accounting-document.controller.ts:103 |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | accounting-document.controller.ts:95 |
| API | `POST /v1/companies/:companyId/accounting/payments` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | accounting-payment.controller.ts:56 |
| API | `POST /v1/companies/:companyId/accounting/payments/:paymentId/void` | FINAL_MUTATION | PS | `PRE_CUTOFF_RUNOFF_ONLY` | RESUME | FIN | ทำต่อได้เฉพาะรายการเดิมที่ค้างอยู่ | RESOLVED | accounting-payment.controller.ts:64 |
| ASYNC | `OUTBOX_PRODUCER: accounting-documents` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | accounting.${docType}.issued\|voided, acc |
| WEB | `/accounting` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:170-181 |
| WEB | `/companies/{companyId}/accounting` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/sales` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/companies/{companyId}/sales-documents` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/sales` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:25-34 |
| WEB | `/sales-documents` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:182-191 |

### thai_tax

Workstream **FIN** · rows **50** · BLOCKED **10** · §6.3 coverage: §6.3 row 7 (ledger/tax work from snapshotted financial roots) + §6.2 retained-artifact authority (lines 293-306)

Policy mix: VISIBLE_SNAPSHOT_ONLY 18 · BLOCK_NEW_ROOT 14 · BLOCKED 10 · STOP_IMMEDIATELY 8

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `tax.get_cit_calendar` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:714 |
| AI_TOOL | `tax.get_reconciliation_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:765 |
| AI_TOOL | `tax.get_tax_code_profile` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:739 |
| AI_TOOL | `tax.get_transaction_tax_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:752 |
| AI_TOOL | `tax.get_upcoming_tax_obligations` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:678 |
| AI_TOOL | `tax.get_vat_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:690 |
| AI_TOOL | `tax.get_wht_summary` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:702 |
| AI_TOOL | `tax.list_missing_tax_documents` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | FIN | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:726 |
| API | `GET /v1/companies/:companyId/tax/cit-calendar` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:196 |
| API | `GET /v1/companies/:companyId/tax/code-profile-templates` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:55 |
| API | `GET /v1/companies/:companyId/tax/code-profiles` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:48 |
| API | `GET /v1/companies/:companyId/tax/code-profiles/:profileId/readiness` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:88 |
| API | `GET /v1/companies/:companyId/tax/periods` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:57 |
| API | `GET /v1/companies/:companyId/tax/periods/:periodId/events` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:77 |
| API | `GET /v1/companies/:companyId/tax/periods/:periodId/review-issues` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:106 |
| API | `GET /v1/companies/:companyId/tax/profile` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:47 |
| API | `GET /v1/companies/:companyId/tax/reconciliations` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:254 |
| API | `GET /v1/companies/:companyId/tax/reconciliations/:runId` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:269 |
| API | `GET /v1/companies/:companyId/tax/report-mappings` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:203 |
| API | `GET /v1/companies/:companyId/tax/reports/pp30-boxes` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:285 |
| API | `GET /v1/companies/:companyId/tax/trade-evidence` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:217 |
| API | `GET /v1/companies/:companyId/tax/wht-categories` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:205 |
| API | `PATCH /v1/companies/:companyId/tax/code-definitions/:taxCodeId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:150 |
| API | `PATCH /v1/companies/:companyId/tax/code-profiles/:profileId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:81 |
| API | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-filed` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | tax.controller.ts:131 |
| API | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-paid` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | tax.controller.ts:163 |
| API | `PATCH /v1/companies/:companyId/tax/review-issues/:issueId/resolve` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:113 |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | pp36-input-claim.controller.ts:18 |
| API | `POST /v1/companies/:companyId/tax/code-definitions` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:143 |
| API | `POST /v1/companies/:companyId/tax/code-profile-templates/:templateKey` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:62 |
| API | `POST /v1/companies/:companyId/tax/code-profiles` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:74 |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/activate` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:96 |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-apply` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:120 |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:112 |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/retire` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:104 |
| API | `POST /v1/companies/:companyId/tax/legacy-remediation/apply` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:174 |
| API | `POST /v1/companies/:companyId/tax/legacy-remediation/preview` | READ | PS | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:166 |
| API | `POST /v1/companies/:companyId/tax/periods/:periodId/filing-packages` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:177 |
| API | `POST /v1/companies/:companyId/tax/periods/:periodId/vat-report` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:87 |
| API | `POST /v1/companies/:companyId/tax/periods/:periodId/wht-report` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:97 |
| API | `POST /v1/companies/:companyId/tax/reconciliations` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:247 |
| API | `POST /v1/companies/:companyId/tax/reconciliations/:runId/review` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:277 |
| API | `POST /v1/companies/:companyId/tax/sync` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | tax.controller.ts:67 |
| API | `POST /v1/companies/:companyId/tax/trade-evidence/:evidenceId/verify` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:240 |
| API | `POST /v1/companies/:companyId/tax/wht-certificates` | FINAL_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | tax.controller.ts:187 |
| API | `PUT /v1/companies/:companyId/tax/account-determination` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:196 |
| API | `PUT /v1/companies/:companyId/tax/report-mappings` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | transaction-tax.controller.ts:210 |
| ASYNC | `OUTBOX_PRODUCER: tax` | SYSTEM | none | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | tax.code_profile.activated, tax.code_def |
| WEB | `/companies/{companyId}/tax` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | page.ts |
| WEB | `/tax` | READ | perm | `VISIBLE_SNAPSHOT_ONLY` | RESUME | FIN | ดูข้อมูลเดิมได้ แต่เพิ่มรายการใหม่ไม่ได้ | RESOLVED | web-core-workspace.constants.ts:192-201 |

### workflow_automation

Workstream **WF** · rows **37** · BLOCKED **0** · §6.3 coverage: §6.3 row 2 (workflow/notifications)

Policy mix: SKIP_SUPPRESS 13 · ALLOWED_WHILE_OFF 11 · BLOCK_NEW_ROOT 9 · STOP_IMMEDIATELY 4

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `workflow.explain_run` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:779 |
| AI_TOOL | `workflow.list_assigned_tasks` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:792 |
| AI_TOOL | `workflow.list_recent_failures` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:804 |
| AI_TOOL | `workflow.summarize_rule_health` | FINAL_MUTATION | perm | `STOP_IMMEDIATELY` | REISSUE | WF | ผู้ช่วย AI ยังใช้ส่วนนี้ไม่ได้ | RESOLVED | ai-tools.ts:816 |
| API | `GET /v1/companies/:companyId/workflow/dead-letters` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-dead-letter.controller.ts:20 |
| API | `GET /v1/companies/:companyId/workflow/explanations/:runId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-run.controller.ts:49 |
| API | `GET /v1/companies/:companyId/workflow/rules` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-rule.controller.ts:39 |
| API | `GET /v1/companies/:companyId/workflow/rules/:ruleId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-rule.controller.ts:67 |
| API | `GET /v1/companies/:companyId/workflow/runs` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-run.controller.ts:21 |
| API | `GET /v1/companies/:companyId/workflow/runs/:runId` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-run.controller.ts:42 |
| API | `GET /v1/companies/:companyId/workflow/tasks` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-task.controller.ts:21 |
| API | `GET /v1/companies/:companyId/workflow/templates` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-template.controller.ts:19 |
| API | `GET /v1/companies/:companyId/workflow/webhooks` | READ | PS | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | workflow-webhook.controller.ts:20 |
| API | `PATCH /v1/companies/:companyId/workflow/rules/:ruleId` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-rule.controller.ts:74 |
| API | `POST /v1/companies/:companyId/workflow/action-runs/:actionRunId/replay` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-run.controller.ts:57 |
| API | `POST /v1/companies/:companyId/workflow/dead-letters/:deadLetterId/ignore` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-dead-letter.controller.ts:47 |
| API | `POST /v1/companies/:companyId/workflow/dead-letters/:deadLetterId/replay` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-dead-letter.controller.ts:39 |
| API | `POST /v1/companies/:companyId/workflow/rules` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-rule.controller.ts:60 |
| API | `POST /v1/companies/:companyId/workflow/rules/:ruleId/disable` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-rule.controller.ts:90 |
| API | `POST /v1/companies/:companyId/workflow/rules/:ruleId/enable` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-rule.controller.ts:82 |
| API | `POST /v1/companies/:companyId/workflow/rules/:ruleId/test` | READ | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-rule.controller.ts:98 |
| API | `POST /v1/companies/:companyId/workflow/tasks/:taskId/cancel` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-task.controller.ts:58 |
| API | `POST /v1/companies/:companyId/workflow/tasks/:taskId/complete` | FINAL_MUTATION | PS | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-task.controller.ts:50 |
| API | `POST /v1/companies/:companyId/workflow/tasks/:taskId/snooze` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-task.controller.ts:42 |
| API | `POST /v1/companies/:companyId/workflow/templates/:templateKey/enable` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-template.controller.ts:27 |
| API | `POST /v1/companies/:companyId/workflow/webhooks` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-webhook.controller.ts:27 |
| API | `POST /v1/companies/:companyId/workflow/webhooks/:endpointId/disable` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-webhook.controller.ts:43 |
| API | `POST /v1/companies/:companyId/workflow/webhooks/:endpointId/enable` | ROOT_MUTATION | PS | `BLOCK_NEW_ROOT` | RESUME | WF | ยังไม่ได้เปิดฟีเจอร์นี้ สร้างรายการใหม่ไม่ได้ | RESOLVED | workflow-webhook.controller.ts:35 |
| ASYNC | `DrainWorkflowOutboxUseCase` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-outbox-drain.use-case.ts:15-61 |
| ASYNC | `OUTBOUND webhook dispatch (workflow CALL_WEBHOOK action)` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-action-runner.use-case.ts:153 |
| ASYNC | `POST /v1/internal/workflow/action-runs/retry` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-retry.use-case.ts:15-26 |
| ASYNC | `POST /v1/internal/workflow/events/ingest` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-internal.controller.ts:28-37 |
| ASYNC | `POST /v1/internal/workflow/scan (THRESHOLD_SCAN \| SLA_SCAN \| SCHEDULE)` | FINAL_MUTATION | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-scan.use-case.ts:25-50 |
| ASYNC | `startWorkflowWorker (queue 'workflow')` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-worker.ts:15-75 |
| ASYNC | `workflow scan systemCtx` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-scan-candidates.use-case.ts:19-24 |
| WEB | `/companies/{companyId}/workflow` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | page.ts |
| WEB | `/workflow` | READ | perm | `ALLOWED_WHILE_OFF` | NONE | WF | — | RESOLVED | web-core-workspace.constants.ts:112-129 |

### employee_access

Workstream **PLATFORM** · rows **24** · BLOCKED **2** · §6.3 coverage: platform invariant (spec:261) — not commercially disableable

Policy mix: PLATFORM_EXEMPT 22 · BLOCKED 2

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `company.get_employee_detail` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:555 |
| AI_TOOL | `company.get_employee_summary` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:542 |
| API | `GET /v1/companies/:companyId/settings/access/matrix` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:61 |
| API | `GET /v1/companies/:companyId/settings/address-master` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:26 |
| API | `GET /v1/companies/:companyId/settings/capability-packs` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:33 |
| API | `GET /v1/companies/:companyId/settings/effective-access` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:47 |
| API | `GET /v1/companies/:companyId/settings/effective-access/:membershipId` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:54 |
| API | `GET /v1/companies/:companyId/settings/employees` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:35 |
| API | `GET /v1/companies/:companyId/settings/employees/:employeeId` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:42 |
| API | `GET /v1/companies/:companyId/settings/permissions` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | permission.controller.ts:14 |
| API | `GET /v1/companies/:companyId/settings/role-templates` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | access-catalog.controller.ts:40 |
| API | `GET /v1/companies/:companyId/settings/roles` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:29 |
| API | `GET /v1/companies/:companyId/settings/roles/:roleId` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:36 |
| API | `PATCH /v1/companies/:companyId/settings/employees/:employeeId` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:76 |
| API | `PATCH /v1/companies/:companyId/settings/roles/:roleId` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:69 |
| API | `POST /v1/companies/:companyId/settings/employees` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:49 |
| API | `POST /v1/companies/:companyId/settings/employees/:employeeId/complete` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:64 |
| API | `POST /v1/companies/:companyId/settings/employees/:employeeId/credentials/regenerate` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:106 |
| API | `POST /v1/companies/:companyId/settings/employees/:employeeId/disable` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:91 |
| API | `POST /v1/companies/:companyId/settings/employees/:employeeId/line-link-token` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:118 |
| API | `POST /v1/companies/:companyId/settings/employees/:employeeId/line-link-token/revoke` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | employee.controller.ts:131 |
| API | `POST /v1/companies/:companyId/settings/roles` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:55 |
| API | `POST /v1/companies/:companyId/settings/roles/:roleId/disable` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:84 |
| API | `POST /v1/companies/:companyId/settings/roles/preview` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | role.controller.ts:43 |

### company_settings

Workstream **PLATFORM** · rows **12** · BLOCKED **4** · §6.3 coverage: platform invariant (spec:262) — not commercially disableable

Policy mix: PLATFORM_EXEMPT 8 · BLOCKED 4

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `company.list_branches` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:77 |
| API | `GET /v1/companies/:companyId/branches` | READ | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | branch.controller.ts:21 |
| API | `GET /v1/companies/:companyId/tax/code-definitions` | READ | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:127 |
| API | `PATCH /v1/companies/:companyId/branches/:branchId` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | branch.controller.ts:40 |
| API | `POST /v1/auth/account/ai-assistant` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:463 |
| API | `POST /v1/auth/account/email` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:476 |
| API | `POST /v1/auth/line/link` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:357 |
| API | `POST /v1/auth/line/unlink` | FINAL_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:430 |
| API | `POST /v1/auth/password/change` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:440 |
| API | `POST /v1/companies/:companyId/branches` | ROOT_MUTATION | PS | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | branch.controller.ts:33 |
| API | `POST /v1/companies/:companyId/tax/resolve-preview` | READ | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:158 |
| API | `POST /v1/companies/:companyId/tax/trade-evidence` | ROOT_MUTATION | PS | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | transaction-tax.controller.ts:232 |

### PLATFORM

Workstream **PLATFORM** · rows **6** · BLOCKED **1** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: PLATFORM_EXEMPT 5 · BLOCKED 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| ASYNC | `assertWorkerToken (shared internal credential)` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | worker-token.ts:1-15 |
| ASYNC | `OutboxAppendService.append (shared producer helper)` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | outbox-append.service.ts:40-108 |
| ASYNC | `systemWorkerContext (shared factory)` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | system-worker-context.ts:1-27 |
| ASYNC | `workers/main bootstrap + heartbeat` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | main.ts:14-52 |
| WEB | `/system` | READ | perm | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | page.ts |
| WEB | `portal (unauthenticated)` | READ | none/sess | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | page.ts |

### AI_GATEWAY_PLANE

Workstream **CRM** · rows **24** · BLOCKED **24** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 24

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_ORCHESTRATOR | `allowedToolsForAgent() (domain isolation)` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | orchestrator.agent.ts:703-718 |
| AI_ORCHESTRATOR | `availableToolsForPlan()` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | orchestrator.agent.ts:688-700 |
| AI_ORCHESTRATOR | `dispatchByModelLoop() (JSON one-tool loop)` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | orchestrator.agent.ts:432-467 |
| AI_ORCHESTRATOR | `dispatchByNativeToolLoop() (native tool-use)` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | orchestrator.agent.ts:478-500 |
| AI_ORCHESTRATOR | `dispatchByPlan() (deterministic fallback)` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | orchestrator.agent.ts:396-422 |
| AI_ORCHESTRATOR | `GET /internal/ai/agents` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | line-ai-internal.controller.ts:249-252 |
| AI_ROUTER | `IntentRouterAgent.route() (business read turn)` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | intent-router.agent.ts:180-183 |
| AI_ROUTER | `IntentRouterAgent.routeIntake() (LINE intake route)` | FINAL_MUTATION | feat | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | intent-router.agent.ts:191-201 |
| AI_ORCHESTRATOR | `POST /internal/ai/bank-statement-extract` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | line-ai-internal.controller.ts:185-190 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-booking-extract` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:60-61 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-broadcast` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:196-197 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-customer-profile-extract` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:98-99 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-insights` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:180-181 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-intake` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:82-83 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-reply-draft` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:123-124 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-summary` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:164-165 |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-trust-score` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-ai-internal.controller.ts:147-148 |
| AI_ORCHESTRATOR | `POST /internal/ai/draft-generate` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-draft-internal.controller.ts:26-27 |
| AI_ORCHESTRATOR | `POST /internal/ai/line-intake-route` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | line-ai-internal.controller.ts:54-59 |
| AI_ORCHESTRATOR | `POST /internal/ai/line-turn` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | line-ai-internal.controller.ts:35-40 |
| AI_ORCHESTRATOR | `POST /internal/ai/receipt-ocr` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | line-ai-internal.controller.ts:73-78 |
| AI_ROUTER | `ROUTER_DISABLED_TOOLS (static disabled catalog)` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | intent-router.agent.ts:111-117 |
| AI_ROUTER | `ROUTER_ENABLED_TOOLS (static enabled catalog)` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | intent-router.agent.ts:51-106 |
| AI_ORCHESTRATOR | `ToolPolicyEnforcerService.assertToolCanExecute()` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | tool-policy-enforcer.service.ts:9-24 |

### NONE

Workstream **CRM/PLATFORM/WF/FIN** · rows **55** · BLOCKED **22** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 22 · PLATFORM_EXEMPT 15 · SKIP_SUPPRESS 12 · STOP_IMMEDIATELY 6

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| API | `GET /local-storage/download/:token` | SYSTEM | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | local-storage.controller.ts:31 |
| API | `GET /v1/auth/[line/link-page/employee, line/employee-link-page]` | READ | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:376 |
| API | `GET /v1/auth/line/customer-register-page` | READ | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | customer-line-register.controller.ts:66 |
| API | `GET /v1/auth/line/link-page` | READ | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:285 |
| API | `GET /v1/auth/line/link-page.js` | READ | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:322 |
| API | `GET /v1/auth/login-channels` | READ | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:159 |
| API | `GET /v1/health` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | health.controller.ts:14 |
| API | `GET /v1/internal/health/readiness` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | health-internal.controller.ts:18 |
| API | `POST /v1/auth/account/email/verify` | FINAL_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:508 |
| API | `POST /v1/auth/dev/token` | SYSTEM | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:228 |
| API | `POST /v1/auth/line/customer-register` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | customer-line-register.controller.ts:47 |
| API | `POST /v1/auth/line/employee-link` | FINAL_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:416 |
| API | `POST /v1/auth/line/exchange` | FINAL_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:271 |
| API | `POST /v1/auth/password/login` | ROOT_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:171 |
| API | `POST /v1/auth/password/reset-request` | FINAL_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:210 |
| API | `POST /v1/auth/session/refresh` | ROOT_MUTATION | none | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | auth.controller.ts:523 |
| API | `POST /v1/crm-customer/pdpa/consent-withdraw` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-pdpa.controller.ts:61 |
| API | `POST /v1/crm-customer/pdpa/data-export` | READ | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-pdpa.controller.ts:75 |
| API | `POST /v1/crm-customer/pdpa/erasure-request` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-pdpa.controller.ts:100 |
| API | `POST /v1/crm-customer/pdpa/erasure-status` | READ | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-pdpa.controller.ts:112 |
| API | `POST /v1/crm/line/webhook/:webhookKey` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-line-webhook.controller.ts:36 |
| API | `POST /v1/internal/ai/draft-requests/drain` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | ai-draft-internal.controller.ts:21 |
| API | `POST /v1/internal/ai/draft-requests/generate` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | ai-draft-internal.controller.ts:27 |
| API | `POST /v1/internal/ai/line-ledger/drain` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | line-ai-ledger-internal.controller.ts:17 |
| API | `POST /v1/internal/ai/tools/invoke` | SYSTEM | PS | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | internal-tools.controller.ts:218 |
| API | `POST /v1/internal/companies/:companyId/dashboard/snapshots/generate` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:85 |
| API | `POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:118 |
| API | `POST /v1/internal/companies/:companyId/notifications/daily-owner-summary` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:106 |
| API | `POST /v1/internal/companies/:companyId/notifications/scan/stock-low` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:96 |
| API | `POST /v1/internal/crm/autonomy-retry-scan` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:57 |
| API | `POST /v1/internal/crm/booking-proposal-sweep` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:69 |
| API | `POST /v1/internal/crm/booking-reminder-scan` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:63 |
| API | `POST /v1/internal/crm/campaign-delivery-scan` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:33 |
| API | `POST /v1/internal/crm/inbox-retry-scan` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-internal.controller.ts:51 |
| API | `POST /v1/internal/crm/new-conversation-scan` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-internal.controller.ts:45 |
| API | `POST /v1/internal/crm/pdpa-erasure-process` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:81 |
| API | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:87 |
| API | `POST /v1/internal/crm/pdpa-purge` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:75 |
| API | `POST /v1/internal/crm/sla-breach-scan` | SYSTEM | none | `STOP_IMMEDIATELY` | REISSUE | CRM | ตอนนี้ยังส่งข้อความหาลูกค้าไม่ได้ | RESOLVED | crm-internal.controller.ts:39 |
| API | `POST /v1/internal/crm/trust-score-scan` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-ai-internal.controller.ts:16 |
| API | `POST /v1/internal/ledger/expense-auto-post/drain` | SYSTEM | EG | `BLOCKED` | BLOCKED | FIN | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense-auto-post-internal.controller.ts:12 |
| API | `POST /v1/internal/notifications/daily-owner-summary-sweep` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:53 |
| API | `POST /v1/internal/notifications/delivery-sweep` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:35 |
| API | `POST /v1/internal/notifications/snapshot-sweep` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:41 |
| API | `POST /v1/internal/notifications/stock-low-sweep` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | internal.controller.ts:47 |
| API | `POST /v1/internal/workflow/action-runs/retry` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-internal.controller.ts:52 |
| API | `POST /v1/internal/workflow/events/ingest` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-internal.controller.ts:29 |
| API | `POST /v1/internal/workflow/outbox/drain` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-internal.controller.ts:40 |
| API | `POST /v1/internal/workflow/scan` | SYSTEM | none | `SKIP_SUPPRESS` | NONE | WF | ระบบจะข้ามการแจ้งเตือนนี้ไว้ก่อน | RESOLVED | workflow-internal.controller.ts:46 |
| API | `POST /v1/line/webhook` | FINAL_MUTATION | EG | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | line-webhook.controller.ts:36 |
| API | `POST /v1/webhooks/line` | FINAL_MUTATION | EG | `PLATFORM_EXEMPT` | NONE | PLATFORM | — | RESOLVED | line-webhook.controller.ts:44 |
| API | `PUT /local-storage/upload/:token` | SYSTEM | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | local-storage.controller.ts:18 |
| WEB | `[helper] api-error entitlement mapping` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | EmployeeAccessPages.ts |
| WEB | `[helper] client-side feature/entitlement helper` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | server-session.ts:16-48 |
| WEB | `sidebar whitelist DESIGN_HANDOFF_NAV_ORDER` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | WorkspaceLayout.ts |

### UNMAPPED

Workstream **PLATFORM/CRM** · rows **37** · BLOCKED **37** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 37

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `hr.get_leave_summary` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:646 |
| API | `DELETE /v1/companies/:companyId/attachments/:attachmentId` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | attachment.controller.ts:67 |
| API | `GET /v1/audit/logs` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | audit.controller.ts:40 |
| API | `GET /v1/auth/account/security` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:451 |
| API | `GET /v1/auth/me` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:557 |
| API | `GET /v1/auth/me/companies` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:584 |
| API | `GET /v1/companies/:companyId/attachments/:attachmentId/download-url` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | attachment.controller.ts:44 |
| API | `GET /v1/companies/:companyId/document-sequences` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | document-sequence.controller.ts:19 |
| API | `GET /v1/companies/:companyId/expense-settings/substitute-receipt` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense.controller.ts:446 |
| API | `GET /v1/system/ai-budget` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-ai-budget.controller.ts:31 |
| API | `GET /v1/system/company-onboardings/:id` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-onboarding.controller.ts:76 |
| API | `GET /v1/system/partners` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:79 |
| API | `GET /v1/system/partners/:partnerCompanyId` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:100 |
| API | `GET /v1/system/partners/:partnerCompanyId/ai-usage` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:250 |
| API | `GET /v1/system/partners/:partnerCompanyId/members` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:148 |
| API | `GET /v1/test/protected` | SYSTEM | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | protected-test.controller.ts:10 |
| API | `PATCH /v1/companies/:companyId/expense-settings/substitute-receipt` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | expense.controller.ts:458 |
| API | `PATCH /v1/system/partners/:partnerCompanyId` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:109 |
| API | `POST /v1/auth/account/email/resend` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:494 |
| API | `POST /v1/auth/logout` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:532 |
| API | `POST /v1/auth/sessions/revoke-others` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | auth.controller.ts:543 |
| API | `POST /v1/companies/:companyId/attachments/:attachmentId/complete` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | attachment.controller.ts:32 |
| API | `POST /v1/companies/:companyId/attachments/:attachmentId/links` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | attachment.controller.ts:55 |
| API | `POST /v1/companies/:companyId/attachments/upload-intent` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | attachment.controller.ts:25 |
| API | `POST /v1/system/company-onboardings` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-onboarding.controller.ts:51 |
| API | `POST /v1/system/company-onboardings/:id/regenerate-temporary-password` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-onboarding.controller.ts:86 |
| API | `POST /v1/system/company-onboardings/:id/reissue-owner-line-link` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-onboarding.controller.ts:101 |
| API | `POST /v1/system/partners/:partnerCompanyId/lifecycle` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:129 |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:158 |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reset` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:177 |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reveal` | READ | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:196 |
| API | `PUT /v1/companies/:companyId/document-sequences/:documentType` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | document-sequence.controller.ts:31 |
| API | `PUT /v1/system/ai-budget` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-ai-budget.controller.ts:40 |
| API | `PUT /v1/system/line/shared-credentials/:credentialKind` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-line.controller.ts:25 |
| API | `PUT /v1/system/partners/:partnerCompanyId/ai-model` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:232 |
| API | `PUT /v1/system/partners/:partnerCompanyId/features` | ROOT_MUTATION | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | partner.controller.ts:214 |
| WEB | `/companies/{companyId}/settings` | READ | perm | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | page.ts |

### UNRESOLVED

Workstream **CRM/PLATFORM** · rows **17** · BLOCKED **17** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 17

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| ASYNC | `@Public customer LINE registration (POST /v1/line/customer-register, GET .../customer-register-page)` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | customer-line-register.controller.ts:39-60 |
| ASYNC | `@Public customer PDPA endpoints (consent-withdraw, data-export, erasure-request, erasure-status)` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-customer-pdpa.controller.ts:53-110 |
| ASYNC | `OUTBOX_PRODUCER: crm-inbox (conversations/channels/policy)` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm.conversation.*, crm.customer.created |
| ASYNC | `OUTBOX_PRODUCER: inventory` | SYSTEM | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | inventory.product.created\|updated\|archiv |
| ASYNC | `POST /v1/crm/line/webhook/:webhookKey (company OA, end customers)` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-line-webhook.controller.ts:29-86 |
| ASYNC | `POST /v1/internal/ai/tools/invoke (AI Gateway → API tool bridge)` | SYSTEM | none | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | internal-tools.controller.ts:214-320 |
| ASYNC | `POST /v1/internal/crm/autonomy-retry-scan` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | retry-crm-autonomy-jobs.use-case.ts:19-34 |
| ASYNC | `POST /v1/internal/crm/booking-proposal-sweep` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | sweep-crm-booking-proposals.use-case.ts:23-29 |
| ASYNC | `POST /v1/internal/crm/booking-reminder-scan` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | scan-crm-booking-reminders.use-case.ts:34-79 |
| ASYNC | `POST /v1/internal/crm/campaign-delivery-scan` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | deliver-crm-campaign.use-case.ts:9-27 |
| ASYNC | `POST /v1/internal/crm/pdpa-erasure-process` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-pdpa.use-case.ts:266 |
| ASYNC | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-internal.controller.ts:86-96 |
| ASYNC | `POST /v1/internal/crm/pdpa-purge` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-pdpa.use-case.ts:50 |
| ASYNC | `POST /v1/internal/crm/trust-score-scan` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-ai-internal.controller.ts:15-19 |
| ASYNC | `startCrmCampaignWorker (queue 'crm-campaign-delivery')` | FINAL_MUTATION | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-campaign-worker.ts:3-5 |
| ASYNC | `startCrmPdpaWorker (queue 'crm-pdpa')` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-pdpa-worker.ts:21-91 |
| ASYNC | `startCrmTrustWorker (queue 'crm-trust')` | SYSTEM | none | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | crm-trust-worker.ts:9-19 |

### UNGATED

Workstream **CRM** · rows **1** · BLOCKED **1** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| AI_TOOL | `company.get_current_context` | FINAL_MUTATION | perm | `BLOCKED` | BLOCKED | CRM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | ai-tools.ts:65 |

### PLATFORM_CONTROL_PLANE

Workstream **PLATFORM** · rows **1** · BLOCKED **1** · §6.3 coverage: **none** — not a top-level feature key

Policy mix: BLOCKED 1

| Surface | Surface ID | Class | Enf | Policy | Resume | Owner | Fallback | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| WEB | `[helper] system-partners entitlement editor logic` | READ | perm | `BLOCKED` | BLOCKED | PLATFORM | ยังไม่ได้เปิดฟีเจอร์นี้ | **BLOCKED** | system-partners.logic.ts:19-166 |

## 5. BLOCKED register

181 of 744 rows are BLOCKED. Each keeps its route CLOSED and blocks disable preflight for its
feature until the named workstream supplies evidence (spec:326, plan:29). A BLOCKED row may not inherit a sibling decision.

### 5.1 Themes

| # | Theme | Rows | Evidence owners |
|---|---|---|---|
| 1 | final mutation not named in the family's allowed-runoff column | 36 | FIN, INV |
| 2 | guarded only by a default-open (unmapped) permission | 32 | PLATFORM |
| 3 | lane S3 flagged: async surface with no proven feature owner | 26 | CRM, PLATFORM |
| 4 | AI gateway plane route declares no feature ownership | 23 | CRM |
| 5 | no §6.3 family row for the feature | 15 | INV, PLATFORM |
| 6 | CRM/LINE/AI final action with no §6.3 continuation (staff view/handoff only) | 13 | CRM |
| 7 | outbox producer: §6.3 has no async/outbox row for the family | 10 | FIN |
| 8 | endpoint resolves to no featureKey at all | 7 | CRM |
| 9 | lane S2 flagged: guard/feature mismatch or ungated settings surface | 6 | FIN, PLATFORM |
| 10 | AI tool advertises an ungated/unmapped feature set | 4 | CRM |
| 11 | system/internal endpoint with no async-inventory owner | 3 | FIN, PLATFORM |
| 12 | lane S4 flagged: dead entitlement signal / unwired AI surface | 2 | CRM |
| 13 | web route group with BLOCKED member surfaces (client-side gate) | 2 | INV, PLATFORM |
| 14 | featureKey UNMAPPED in inventory | 1 | PLATFORM |
| 15 | web/AI surface advertising an ungated feature set | 1 | WF |

### 5.2 Register by evidence owner

#### FIN — 45 rows

| Surface | Surface ID | Class | Feature | What evidence is missing |
|---|---|---|---|---|
| API | `GET /v1/companies/:companyId/tax/code-definitions` | READ | company_settings | S2 lane BLOCKED: BLOCKED: Thai-tax surface guarded by company.branch.read (always-on company_settings submenu) => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision |
| API | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-filed` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `PATCH /v1/companies/:companyId/tax/periods/:periodId/mark-paid` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/approve` | FINAL_MUTATION | sales_documents | final mutation not named in S6.3-r3 allowed-runoff column (spec:317) |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/issue` | FINAL_MUTATION | sales_documents | final mutation not named in S6.3-r3 allowed-runoff column (spec:317) |
| API | `POST /v1/companies/:companyId/accounting/documents/:documentId/reject` | FINAL_MUTATION | sales_documents | final mutation not named in S6.3-r3 allowed-runoff column (spec:317) |
| API | `POST /v1/companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/banking/adjustments/:id/approve` | FINAL_MUTATION | bank_reconciliation | final mutation not named in S6.3-r9 allowed-runoff column (spec:323) |
| API | `POST /v1/companies/:companyId/banking/adjustments/:id/void` | FINAL_MUTATION | bank_reconciliation | final mutation not named in S6.3-r9 allowed-runoff column (spec:323) |
| API | `POST /v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/commit` | FINAL_MUTATION | bank_reconciliation | final mutation not named in S6.3-r9 allowed-runoff column (spec:323) |
| API | `POST /v1/companies/:companyId/banking/statement-imports/:importId/void` | FINAL_MUTATION | bank_reconciliation | final mutation not named in S6.3-r9 allowed-runoff column (spec:323) |
| API | `POST /v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply` | FINAL_MUTATION | double_entry_ledger | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/certify` | FINAL_MUTATION | expenses | final mutation not named in S6.3-r4 allowed-runoff column (spec:318) |
| API | `POST /v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/supersede` | FINAL_MUTATION | expenses | final mutation not named in S6.3-r4 allowed-runoff column (spec:318) |
| API | `POST /v1/companies/:companyId/periods/:periodId/close` | FINAL_MUTATION | double_entry_ledger | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/periods/:periodId/unclose` | FINAL_MUTATION | double_entry_ledger | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/posting/expense-backfill` | FINAL_MUTATION | expenses | final mutation not named in S6.3-r4 allowed-runoff column (spec:318) |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/approve` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/close` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/issue` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/procurement/purchase-orders/:id/reject` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/approve` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/procurement/purchase-requests/:id/reject` | FINAL_MUTATION | procurement | final mutation not named in S6.3-r6 allowed-runoff column (spec:320) |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/cancel` | FINAL_MUTATION | reimbursement | final mutation not named in S6.3-r5 allowed-runoff column (spec:319) |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/claim-form/signatures` | FINAL_MUTATION | reimbursement | final mutation not named in S6.3-r5 allowed-runoff column (spec:319) |
| API | `POST /v1/companies/:companyId/reimbursements/:requestId/payments` | FINAL_MUTATION | reimbursement | final mutation not named in S6.3-r5 allowed-runoff column (spec:319) |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/activate` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/import-apply` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/tax/code-profiles/:profileId/retire` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/tax/legacy-remediation/apply` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/tax/resolve-preview` | READ | company_settings | S2 lane BLOCKED: BLOCKED: Thai-tax resolve preview guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| API | `POST /v1/companies/:companyId/tax/trade-evidence` | ROOT_MUTATION | company_settings | S2 lane BLOCKED: BLOCKED: Thai-tax trade-evidence create guarded by company.branch.read => survives thai_tax=OFF. Missing: correct tax.* permission or explicit owner decision. |
| API | `POST /v1/companies/:companyId/tax/trade-evidence/:evidenceId/verify` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/companies/:companyId/tax/wht-certificates` | FINAL_MUTATION | thai_tax | final mutation not named in S6.3-r7 allowed-runoff column (spec:321) |
| API | `POST /v1/internal/ledger/expense-auto-post/drain` | SYSTEM | NONE | system drain owned by expense_auto_post (dependency: double_entry_ledger); spec 6.3 has no automatic-execution runoff row for this family |
| ASYNC | `EXPENSE_AUTO_POST_WORKER_PERMISSIONS` | SYSTEM | expense_auto_post | spec 6.3 has no async/outbox row for expense_auto_post; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: accounting-documents` | SYSTEM | sales_documents | spec 6.3 has no async/outbox row for sales_documents; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: banking` | SYSTEM | bank_reconciliation | spec 6.3 has no async/outbox row for bank_reconciliation; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: expenses` | SYSTEM | expenses | spec 6.3 has no async/outbox row for expenses; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: ledger` | SYSTEM | double_entry_ledger | spec 6.3 has no async/outbox row for double_entry_ledger; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: procurement` | SYSTEM | procurement | spec 6.3 has no async/outbox row for procurement; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: reimbursements` | SYSTEM | reimbursement | spec 6.3 has no async/outbox row for reimbursement; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `OUTBOX_PRODUCER: tax` | SYSTEM | thai_tax | spec 6.3 has no async/outbox row for thai_tax; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `POST /v1/internal/ledger/expense-auto-post/drain` | FINAL_MUTATION | expense_auto_post | spec 6.3 has no async/outbox row for expense_auto_post; owner must decide whether emission is suppressed or continues for snapshotted roots |
| ASYNC | `startExpenseAutoPostWorker (queue 'expense-auto-post')` | FINAL_MUTATION | expense_auto_post | spec 6.3 has no async/outbox row for expense_auto_post; owner must decide whether emission is suppressed or continues for snapshotted roots |

#### CRM — 73 rows

| Surface | Surface ID | Class | Feature | What evidence is missing |
|---|---|---|---|---|
| AI_ORCHESTRATOR | `allowedToolsForAgent() (domain isolation)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `availableToolsForPlan()` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_TOOL | `company.get_current_context` | FINAL_MUTATION | UNGATED | tool advertises feature set "UNGATED"; no entitlement rule gates it (AI must not plan an unavailable tool, spec:333, AC22) |
| AI_TOOL | `company.get_employee_detail` | FINAL_MUTATION | employee_access | tool advertises feature set "employee_access\|employee_access.employees\|UNGATED"; no entitlement rule gates it (AI must not plan an unavailable tool, spec:333, AC22) |
| AI_TOOL | `company.get_employee_summary` | FINAL_MUTATION | employee_access | tool advertises feature set "employee_access\|employee_access.employees\|UNGATED"; no entitlement rule gates it (AI must not plan an unavailable tool, spec:333, AC22) |
| AI_TOOL | `company.list_branches` | FINAL_MUTATION | company_settings | tool advertises feature set "company_settings\|company_settings.branches\|UNGATED"; no entitlement rule gates it (AI must not plan an unavailable tool, spec:333, AC22) |
| AI_ORCHESTRATOR | `dispatchByModelLoop() (JSON one-tool loop)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `dispatchByNativeToolLoop() (native tool-use)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `dispatchByPlan() (deterministic fallback)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `GET /internal/ai/agents` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_TOOL | `hr.get_leave_summary` | FINAL_MUTATION | UNMAPPED | S4 lane BLOCKED: sourceModule=hr; router=DISABLED_NOT_WIRED; specialist allowlist=NONE. NO availability/entitlement filter — the only filters are the static ROUTER_ENABLED_TOOLS set and permission  |
| AI_ROUTER | `IntentRouterAgent.route() (business read turn)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ROUTER | `IntentRouterAgent.routeIntake() (LINE intake route)` | FINAL_MUTATION | AI_GATEWAY_PLANE | S4 lane BLOCKED: BLOCKED/DEAD SIGNAL: LineIntakeRouteRequest.enabledFeatures is optional (packages/contracts/src/line-ai.ts:331) and NO producer sets it — the only caller, apps/api/src/modules/line |
| AI_ORCHESTRATOR | `POST /internal/ai/bank-statement-extract` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-booking-extract` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-broadcast` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-customer-profile-extract` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-insights` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-intake` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-reply-draft` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-summary` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/crm-trust-score` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/draft-generate` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/line-intake-route` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/line-turn` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `POST /internal/ai/receipt-ocr` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ROUTER | `ROUTER_DISABLED_TOOLS (static disabled catalog)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ROUTER | `ROUTER_ENABLED_TOOLS (static enabled catalog)` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| AI_ORCHESTRATOR | `ToolPolicyEnforcerService.assertToolCanExecute()` | FINAL_MUTATION | AI_GATEWAY_PLANE | AI Gateway plane surface declares no feature ownership (featureKey []); spec:333 requires intake to populate enabledFeatures and deterministic tool filtering — owner must assign per-route ownership (AC22) |
| API | `GET /v1/auth/line/customer-register-page` | READ | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/auth/line/customer-register` | FINAL_MUTATION | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/companies/:companyId/crm/bookings/:bookingId/cancel` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/disable` | FINAL_MUTATION | line_oa | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/channels/:channelId/rotate` | FINAL_MUTATION | line_oa | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/erase` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/customers/:customerId/line-identities/:identityId/link` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/customers/merge` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/cancel` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/follow-ups/:followUpId/complete` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/leads/:leadId/convert` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/leads/:leadId/disqualify` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/close` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/opportunities/:opportunityId/reopen` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/companies/:companyId/crm/templates/:templateId/approve-ai` | FINAL_MUTATION | crm | S6.3-r1 allows only staff view/handoff; no explicit final-mutation continuation for this action |
| API | `POST /v1/crm-customer/pdpa/consent-withdraw` | FINAL_MUTATION | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/crm-customer/pdpa/data-export` | READ | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/crm-customer/pdpa/erasure-request` | FINAL_MUTATION | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/crm-customer/pdpa/erasure-status` | READ | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/crm/line/webhook/:webhookKey` | FINAL_MUTATION | NONE | no featureKey resolves for this endpoint (module crm-inbox); ownership unproven |
| API | `POST /v1/internal/ai/tools/invoke` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: the tool map (:200-212) spans ~50 tools across ~10 sellable features. resolveAccess DOES apply filterPermissionsByEntitlement, so a tool whose underlyi |
| API | `POST /v1/internal/crm/autonomy-retry-scan` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: replays AI-authored auto-replies for CRM conversations. Ownership is ambiguous between `crm` (the inbox) and `ai_line_assistant` (the AI that authors t |
| API | `POST /v1/internal/crm/booking-proposal-sweep` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: same booking-ownership ambiguity as booking-reminder-scan. This is the explicit per-company iteration the plan's CRM item 5 asks about — companiesScann |
| API | `POST /v1/internal/crm/booking-reminder-scan` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: bookings are catalogued as submenu `crm.bookings` under `crm`, but crm-inbox.constants.ts:13-15 records that the intended `crm_scheduling` flag is Phas |
| API | `POST /v1/internal/crm/campaign-delivery-scan` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: `crm` vs `line_oa` ownership. Skip conditions present today: consent status, identity status, unfollowedAt, marketingRequiresExplicitConsent, channel.s |
| API | `POST /v1/internal/crm/pdpa-erasure-process` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: same as pdpa-purge. Fed by the @Public customer erasure-request endpoint (see WEBHOOK row) — a customer can trigger this even when CRM is off for the t |
| API | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: same PDPA ownership question. Notable as the only internal endpoint with an explicit human-confirmation guard — a useful precedent for the plan's opera |
| API | `POST /v1/internal/crm/pdpa-purge` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: destructive and legally motivated. Missing: owner decision on retention obligations after CRM is unsold (see startCrmPdpaWorker row). |
| API | `POST /v1/internal/crm/trust-score-scan` | SYSTEM | NONE | S3 lane BLOCKED owner: BLOCKED: `crm` vs `ai_line_assistant` (see startCrmTrustWorker). |
| ASYNC | `@Public customer LINE registration (POST /v1/line/customer-register, GET .../customer-register-page)` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: `crm` vs `line_oa` (customer registration is CRM data acquired through the LINE OA channel). Same ambiguity as the company OA webhook. |
| ASYNC | `@Public customer PDPA endpoints (consent-withdraw, data-export, erasure-request, erasure-status)` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: same PDPA ownership question. Operationally important — an end customer can enqueue destructive work for a tenant regardless of that tenant's entitlement state, so a launc |
| ASYNC | `OUTBOX_PRODUCER: crm-inbox (conversations/channels/policy)` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: crm.channel.* maps to `line_oa` while crm.conversation.* maps to `crm` (feature-gate.logic.ts:45-47). Missing: owner decision on which key owns conversation events that or |
| ASYNC | `POST /v1/crm/line/webhook/:webhookKey (company OA, end customers)` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED and HIGHEST PRIORITY. The customer-facing OA webhook has NO entitlement check at all, while the employee OA webhook has one. It fans out into three different sellable areas |
| ASYNC | `POST /v1/internal/crm/autonomy-retry-scan` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: replays AI-authored auto-replies for CRM conversations. Ownership is ambiguous between `crm` (the inbox) and `ai_line_assistant` (the AI that authors the reply) — feature- |
| ASYNC | `POST /v1/internal/crm/booking-proposal-sweep` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: same booking-ownership ambiguity as booking-reminder-scan. This is the explicit per-company iteration the plan's CRM item 5 asks about — companiesScanned is a returned met |
| ASYNC | `POST /v1/internal/crm/booking-reminder-scan` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: bookings are catalogued as submenu `crm.bookings` under `crm`, but crm-inbox.constants.ts:13-15 records that the intended `crm_scheduling` flag is Phase-9 vocabulary that  |
| ASYNC | `POST /v1/internal/crm/campaign-delivery-scan` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: `crm` vs `line_oa` ownership. Skip conditions present today: consent status, identity status, unfollowedAt, marketingRequiresExplicitConsent, channel.status !== ACTIVE. En |
| ASYNC | `POST /v1/internal/crm/pdpa-erasure-process` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: same as pdpa-purge. Fed by the @Public customer erasure-request endpoint (see WEBHOOK row) — a customer can trigger this even when CRM is off for the tenant. |
| ASYNC | `POST /v1/internal/crm/pdpa-post-restore-re-erasure` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: same PDPA ownership question. Notable as the only internal endpoint with an explicit human-confirmation guard — a useful precedent for the plan's operational-route rows. |
| ASYNC | `POST /v1/internal/crm/pdpa-purge` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: destructive and legally motivated. Missing: owner decision on retention obligations after CRM is unsold (see startCrmPdpaWorker row). |
| ASYNC | `POST /v1/internal/crm/trust-score-scan` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: `crm` vs `ai_line_assistant` (see startCrmTrustWorker). |
| ASYNC | `startCrmCampaignWorker (queue 'crm-campaign-delivery')` | FINAL_MUTATION | UNRESOLVED | S3 lane BLOCKED: BLOCKED: outbound marketing campaigns push over the company LINE OA. Ambiguous between `crm` (campaign data) and `line_oa` (the sold channel). Missing: owner decision. High blast r |
| ASYNC | `startCrmPdpaWorker (queue 'crm-pdpa')` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: PDPA retention/erasure is a legal-compliance obligation over CRM data. Missing: an owner decision on whether PDPA purge is owned by `crm` (and therefore stops when CRM is  |
| ASYNC | `startCrmTrustWorker (queue 'crm-trust')` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: trust scoring is CRM-AI. feature-gate.logic.ts:46 routes the `crm.ai.` permission prefix to ai_line_assistant while the data is `crm`. Missing: owner decision on which of  |

#### INV — 17 rows

| Surface | Surface ID | Class | Feature | What evidence is missing |
|---|---|---|---|---|
| AI_TOOL | `inventory.get_product_detail` | FINAL_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| AI_TOOL | `inventory.get_stock_balance` | FINAL_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| AI_TOOL | `inventory.list_low_stock` | FINAL_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| AI_TOOL | `inventory.search_products` | FINAL_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `GET /v1/companies/:companyId/inventory/labels/resolve` | READ | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `GET /v1/companies/:companyId/inventory/products` | READ | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `GET /v1/companies/:companyId/inventory/products/:productId` | READ | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `PATCH /v1/companies/:companyId/inventory/products/:productId` | ROOT_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `POST /v1/companies/:companyId/inventory/labels/scan` | ROOT_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `POST /v1/companies/:companyId/inventory/movements/adjust` | FINAL_MUTATION | inventory | final mutation not named in S6.3-r8 allowed-runoff column (spec:322) |
| API | `POST /v1/companies/:companyId/inventory/movements/count` | FINAL_MUTATION | inventory | final mutation not named in S6.3-r8 allowed-runoff column (spec:322) |
| API | `POST /v1/companies/:companyId/inventory/movements/issue` | FINAL_MUTATION | inventory | final mutation not named in S6.3-r8 allowed-runoff column (spec:322) |
| API | `POST /v1/companies/:companyId/inventory/movements/receive` | FINAL_MUTATION | inventory | final mutation not named in S6.3-r8 allowed-runoff column (spec:322) |
| API | `POST /v1/companies/:companyId/inventory/movements/transfer` | FINAL_MUTATION | inventory | final mutation not named in S6.3-r8 allowed-runoff column (spec:322) |
| API | `POST /v1/companies/:companyId/inventory/products` | ROOT_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| API | `POST /v1/companies/:companyId/inventory/products/:productId/archive` | ROOT_MUTATION | product_catalog | feature product_catalog has no spec 6.3 family row (spec:313-324) |
| WEB | `/settings` | READ | product_catalog | 2/18 member surfaces BLOCKED in S4: Visibility = ANY of requiredAnyPermissions in session.permissions. Hidden when the API strips those permissions (feature-gate.logic.ts:75-88 |

#### WF — 1 rows

| Surface | Surface ID | Class | Feature | What evidence is missing |
|---|---|---|---|---|
| WEB | `header notification bell / account-security menu` | READ | dashboard_notifications | route group advertises ungated/unmapped feature set "dashboard_notifications & company_settings\|company_settings.security\|UNGATED" |

#### PLATFORM — 45 rows

| Surface | Surface ID | Class | Feature | What evidence is missing |
|---|---|---|---|---|
| API | `DELETE /v1/companies/:companyId/attachments/:attachmentId` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) attachment.delete; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /local-storage/download/:token` | SYSTEM | NONE | internal/system endpoint with no matching async-inventory owner row |
| API | `GET /v1/audit/logs` | READ | UNMAPPED | guarded only by default-open permission(s) audit.log.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/auth/account/security` | READ | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/auth/me` | READ | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/auth/me/companies` | READ | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/companies/:companyId/attachments/:attachmentId/download-url` | READ | UNMAPPED | guarded only by default-open permission(s) attachment.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/companies/:companyId/document-sequences` | READ | UNMAPPED | guarded only by default-open permission(s) document.sequence.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/companies/:companyId/expense-settings/substitute-receipt` | READ | UNMAPPED | S2 lane BLOCKED: guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: Expenses feature screen (ใบรับร |
| API | `GET /v1/system/ai-budget` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_ai_model.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/system/company-onboardings/:id` | READ | UNMAPPED | guarded only by default-open permission(s) system.company_onboarding.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/system/partners` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_dashboard.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/system/partners/:partnerCompanyId` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_dashboard.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/system/partners/:partnerCompanyId/ai-usage` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_dashboard.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/system/partners/:partnerCompanyId/members` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_member.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `GET /v1/test/protected` | SYSTEM | UNMAPPED | S2 lane BLOCKED: guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: requires permission health.read |
| API | `PATCH /v1/companies/:companyId/expense-settings/substitute-receipt` | ROOT_MUTATION | UNMAPPED | S2 lane BLOCKED: guarded, but every required permission is UNMAPPED/ungated in feature-gate.logic.ts => the chokepoint never strips it (entitlement-blind) \| BLOCKED: same as the GET — company.setup |
| API | `PATCH /v1/system/partners/:partnerCompanyId` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_company.update; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/auth/account/email/resend` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/auth/logout` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/auth/sessions/revoke-others` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) account.session.read; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/companies/:companyId/attachments/:attachmentId/complete` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) attachment.create; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/companies/:companyId/attachments/:attachmentId/links` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) attachment.create; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/companies/:companyId/attachments/upload-intent` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) attachment.create; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/company-onboardings` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.company_onboarding.create; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/company-onboardings/:id/regenerate-temporary-password` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.company_onboarding.regenerate_temporary_password; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/company-onboardings/:id/reissue-owner-line-link` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.company_onboarding.regenerate_temporary_password; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/partners/:partnerCompanyId/lifecycle` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_company.lifecycle.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_member.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reset` | FINAL_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_member.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reveal` | READ | UNMAPPED | guarded only by default-open permission(s) system.partner_member.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `PUT /local-storage/upload/:token` | SYSTEM | NONE | internal/system endpoint with no matching async-inventory owner row |
| API | `PUT /v1/companies/:companyId/document-sequences/:documentType` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) document.sequence.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `PUT /v1/system/ai-budget` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_ai_model.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `PUT /v1/system/line/shared-credentials/:credentialKind` | FINAL_MUTATION | UNMAPPED | featureKey UNMAPPED in S2 inventory; no owning feature proven |
| API | `PUT /v1/system/partners/:partnerCompanyId/ai-model` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_ai_model.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| API | `PUT /v1/system/partners/:partnerCompanyId/features` | ROOT_MUTATION | UNMAPPED | guarded only by default-open permission(s) system.partner_feature.manage; no entitlement rule exists (s1-contracts.json unmapped[]; feature-gate.logic.ts:83) |
| ASYNC | `OUTBOX_PRODUCER: inventory` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: feature-gate.logic.ts:19-20 and :40 state product/service catalog is sold independently (`product_catalog`) from `inventory`. Missing: owner decision on whether inventory. |
| ASYNC | `POST /v1/internal/ai/tools/invoke (AI Gateway → API tool bridge)` | SYSTEM | UNRESOLVED | S3 lane BLOCKED: BLOCKED: the tool map (:200-212) spans ~50 tools across ~10 sellable features. resolveAccess DOES apply filterPermissionsByEntitlement, so a tool whose underlying read permission i |
| WEB | `[helper] api-error entitlement mapping` | READ | NONE | feature NONE has no spec 6.3 family row (spec:313-324) |
| WEB | `[helper] client-side feature/entitlement helper` | READ | NONE | feature NONE has no spec 6.3 family row (spec:313-324) |
| WEB | `[helper] system-partners entitlement editor logic` | READ | PLATFORM_CONTROL_PLANE | feature  has no spec 6.3 family row (spec:313-324) |
| WEB | `/companies/{companyId}/settings` | READ | UNMAPPED | 10/26 member surfaces BLOCKED in S4: filterSettingsMenuItems(permissions). Route gate is CLIENT-side (WorkspaceLayout 'use client', useEffect router.replace + return null); serv |
| WEB | `/system` | READ | PLATFORM | partner control-plane pages carry system.* default-open permissions; no platform-permission allowlist exists in contracts |
| WEB | `sidebar whitelist DESIGN_HANDOFF_NAV_ORDER` | READ | NONE | feature NONE has no spec 6.3 family row (spec:313-324) |

## 6. Summary counts

| Policy | Rows |
|---|---|
| `BLOCKED` | 181 |
| `BLOCK_NEW_ROOT` | 153 |
| `VISIBLE_SNAPSHOT_ONLY` | 136 |
| `STOP_IMMEDIATELY` | 79 |
| `ALLOWED_WHILE_OFF` | 77 |
| `PLATFORM_EXEMPT` | 50 |
| `SKIP_SUPPRESS` | 37 |
| `PRE_CUTOFF_RUNOFF_ONLY` | 31 |
| **Total** | **744** |

| Surface kind | Rows | RESOLVED | BLOCKED |
|---|---|---|---|
| API | 544 | 431 | 113 |
| ASYNC | 63 | 36 | 27 |
| AI_TOOL | 84 | 51 | 33 |
| WEB | 53 | 45 | 8 |
| **Total** | **744** | **563** | **181** |

| Evidence owner (BLOCKED only) | Rows |
|---|---|
| CRM | 73 |
| FIN | 45 |
| PLATFORM | 45 |
| INV | 17 |
| WF | 1 |

| Feature | Rows | BLOCKED | Disable preflight |
|---|---|---|---|
| ai_line_assistant | 28 | 0 | clear |
| bank_reconciliation | 34 | 5 | **BLOCKED** |
| crm | 113 | 11 | **BLOCKED** |
| dashboard_notifications | 33 | 1 | **BLOCKED** |
| double_entry_ledger | 33 | 4 | **BLOCKED** |
| expense_auto_post | 3 | 3 | **BLOCKED** |
| expenses | 53 | 4 | **BLOCKED** |
| inventory | 25 | 5 | **BLOCKED** |
| line_oa | 11 | 2 | **BLOCKED** |
| procurement | 60 | 7 | **BLOCKED** |
| product_catalog | 12 | 12 | **BLOCKED** |
| reimbursement | 29 | 4 | **BLOCKED** |
| reports | 14 | 0 | clear |
| sales_documents | 31 | 4 | **BLOCKED** |
| thai_tax | 50 | 10 | **BLOCKED** |
| workflow_automation | 37 | 0 | clear |
| employee_access | 24 | 2 | **BLOCKED** |
| company_settings | 12 | 4 | **BLOCKED** |
| PLATFORM | 6 | 1 | **BLOCKED** |
| AI_GATEWAY_PLANE | 24 | 24 | **BLOCKED** |
| NONE | 55 | 22 | **BLOCKED** |
| UNMAPPED | 37 | 37 | **BLOCKED** |
| UNRESOLVED | 17 | 17 | **BLOCKED** |
| UNGATED | 1 | 1 | **BLOCKED** |
| PLATFORM_CONTROL_PLANE | 1 | 1 | **BLOCKED** |

The AC1-AC31 crosswalk lives in `feature-entitlement-launch-matrix.md` §5, per the Spec §10 preamble requirement that
each criterion map to affected `DEFAULT` / exact `(gateKey, routeKey)` rows.
