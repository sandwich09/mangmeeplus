# Agent Memory: New Owner Requirements 2026-07-06 (LINE Login, LINE AI permission/customer AI, birthdate password, AI-assisted period close, auditor approval, statement-for-closing)

Status: Owner decisions received 2026-07-06 and recorded into specs + master checklist (items 02C, 10E, 15A added; 10C and 13 owner-update notes added). No code changed. Next step is plan authoring per item.
Owner: Product owner (thawatchai)
Scope: Seven new requirements raised 2026-07-06; mapped against current code + existing specs.

## Requirements as stated by owner

1. Login ผ่านไลน์ (web login via LINE).
2. LINE AI ต้องเช็ค LINE ID + permission ไม่ใช่ใครก็ใช้ได้; ลูกค้า end user ที่ add LINE OA ของบริษัทแล้วคุยกับ AI ได้ "ตาม spec เดิม".
3. Password ที่ gen ให้พนักงาน = วันเดือนปีเกิด.
4. AI ปิดงบดุล.
5. มีการ review จากนักบัญชี.
6. มีการอนุมัติจาก auditor.
7. อัพโหลด bank statement เป็นข้อมูลปิดงบ ได้ทุกเวลา; record ซ้ำให้เลือกตัวอัพเดต.

## Discovery findings (code-verified 2026-07-06)

- R1: Web LINE OAuth login NOT implemented. `LoginPage.tsx` is username/password only. Foundation exists: `LineLoginVerifierAdapter`, `POST /auth/line/exchange` (`ExchangeLineTokenUseCase`, returns tokens or link-required), LIFF link flows (`/auth/line/link-page`, employee QR link). Aligns with 10C+ Phase 2 owner decision (LINE-Login self-service invite as primary onboarding channel), not yet built.
- R2 internal side: ALREADY IMPLEMENTED. `ProcessLineWebhookUseCase` verifies signature → `ExternalIdentity` lookup (unlinked → refusal + audit `ai.line.unlinked_access`) → active membership/company context → `PermissionResolverService` → requires `line.ai.query`/capture/signature permissions. Spec: `specs/line-ai-channel-auth-spec.md`.
- R2 customer side: spec เดิม (`specs/crm-line-oa-customer-os-spec.md`, item 15A) says end customers chat with COMPANY OA → CRM Inbox; AI is staff-assist drafts only; "AI auto-reply with explicit owner opt-in" is explicitly Backlog (§23). Code today (`crm-inbox` module, migration 20260705000000) is inbound capture/inbox only — no AI reply, staff reply path not yet verified/complete. Owner's new ask = pulling AI auto-reply out of backlog → scope change requiring owner decision + spec update.
- R3: Current `generateTemporaryPassword()` = random 12-char base64, TTL 72h, `mustChangePassword=true`. No birthDate field anywhere in Prisma. EmployeeAccessProfile stores identityType/last4/hash/encryptedRef only. Birthdate-as-password is a security downgrade (guessable, PII-derived); needs explicit owner risk acceptance + new birthDate field.
- R4–R6: Current period close (item 10) = single action, permission `ledger.period.close` (CRITICAL) held by ACCOUNTANT via `pack.ledger.manage`; pre-close `RunPeriodCloseChecksUseCase` runs 5 checks persisted to `PeriodCloseRun`. NO multi-step review/approval flow. AUDITOR_READONLY is read-only by design (cannot approve). All existing specs/gates prohibit AI from mutating accounting/closing state. Proposed reframe: AI prepares closing package (runs checks, drafts adjustments via item 17 draft layer) → ACCOUNTANT review → AUDITOR approval step (new permission, e.g. `ledger.period.approve_close`) → human executes final close; AI never presses close.
- R7: Statement import (item 13) preview/commit exists; upload anytime + overlapping periods allowed; dedupe via SHA256 `statementLineHash`; duplicate policies today = `skip` | `flag` only — NO "update/replace with newer" policy. No web UI for import/matching yet (item 13 open blocker). Statements are not consumed by period-close checks today.

## Owner decisions 2026-07-06 (all recorded in docs)

1. Customer AI on company OA: per-company toggle for AI auto-reply; auto-reply allowed only when customer trust score > 80. REFINED same day: trust score is computed by AI (not a deterministic formula) from grade signals (no-show/missed-appointment rate, repeat-purchase frequency, tenure), stored with reasoning + timestamp, recomputed after every successful booking; unscored customers stay in staff-draft mode. Booking is the one allowed AI final execute: AI does discovery, proposes nearest available slots, and books directly once the customer confirms; confirmation understood semantically from context (คอนเฟิร์ม/ยืนยัน/cf/ok and equivalents) — deterministic keyword lists forbidden, deterministic code only as execution guardrails (slot re-check, idempotency, audit, AI-created marker). All other final executes remain forbidden. End customers must register via LINE Login (LIFF) to be captured as CRM contacts + PDPA consent — still no internal principal/role/AI Gateway access. Recorded: crm-line-oa-customer-os-spec §24 + checklist item 15A.
2. Birthdate temp password: accepted. New `birthDate` field; initial password = date of birth; NO forced change and no expiry (owner-accepted risk; lockout/rate-limit stay; format พ.ศ./ค.ศ. + DDMMYYYY to fix at implementation). Recorded: employee-access spec §13 + checklist 10C owner update.
3. AI close reframe accepted: AI drafts close package → ACCOUNTANT reviews/approves ("กดถูก") → auditor approves → human executes final close. Recorded: ledger closing spec §22 + new checklist item 10E.
4. Auditor may be internal OR external → REFINED same day: accountant may also be external; every external collaborator (accountant or auditor) must carry an explicit "external" flag/toggle visible in team UI, approval records, and audit. Supersedes auth spec §20 "external accountant = normal ACCOUNTANT membership; collaborator model deferred". Guest/external-collaborator feature is permission-scoped, no seat cost per 10C+ decision; AUDITOR_READONLY stays read-only; new permission working name `ledger.period.approve_close`. Recorded: auth spec §22 + ledger spec §22 + item 10E.
5. Statement duplicates: any safe design is fine; goal is only that duplicate data never corrupts balances (current hash dedupe + skip qualifies); matched/reconciled lines never silently replaced; statements feed 10E close readiness. Recorded: bank-reconciliation spec §19 + checklist item 13 owner update.
6. Web Login via LINE approved as requirement → new checklist item 02C + auth spec §21.
7. (Same day, after the 15A media slice shipped) Inbound video/audio on the company OA = explicitly unsupported: fail marker + "ยังไม่รองรับ" bubble, no download/no player; future order is VOICE-TO-TEXT FIRST (transcription via the dedicated CRM agent family), any player only after that proves value. Implemented same day (fail marker at ingestion). Recorded: crm spec §26 + checklist Reorder Log 2026-07-06 (media/statement decisions).
8. (Same day) NEW item 13 requirement: bank statement upload as PDF/photo with AI/OCR extraction. Owner asked for a direction between OCR and the current path; recorded recommendation: CSV/XLSX stays canonical; PDF text-layer extraction first, real OCR (item 09 AI Gateway pattern) only for scans/photos; output = candidate rows into the SAME preview -> human-commit flow (per-row confidence, running-balance continuity guardrail, existing hash dedupe; AI never commits). Recorded: bank-reconciliation spec §20 + plan follow-up scope 2026-07-06 + checklist item 13 owner update (2).

## Artifacts

- specs/line-ai-channel-auth-spec.md (shared OA rules — laid out for owner 2026-07-06)
- specs/crm-line-oa-customer-os-spec.md (company OA / customer, AI staff-assist only, auto-reply in backlog §23)
- specs/double-entry-ledger-closing-spec.md, specs/permission-matrix.md (close + AUDITOR_READONLY)
- specs/bank-reconciliation-spec.md (import/dedupe)
- Code refs: apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts; apps/api/src/modules/crm-inbox/...; apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts; apps/api/src/modules/ledger/application/use-cases/period.use-case.ts; apps/api/src/modules/banking/application/use-cases/statement-import.use-case.ts

## Verification

Discovery only; no code changed. Findings from parallel read-only code exploration 2026-07-06.

## Planning pass done 2026-07-06 (owner directive: proceed with docs)

- Owner added: CRM customer AI must use a DEDICATED agent family, never the employee/shared-OA agents. Recorded in crm spec §25 (CrmCustomerIntakeAgent / CrmCustomerReplyAgent / CrmBookingAgent / CrmTrustScoreAgent; separate module/prompts/allowlists/internal `POST /internal/ai/crm-*` endpoints; only provider port + safety envelope shared).
- Authored/updated docs: plans/web-line-login-plan.md (02C, 2 phases, reuses LineLoginVerifierAdapter + /v1/auth/line/exchange); plans/ai-assisted-period-close-plan.md (10E, Phases 0–4 incl. minimal external-collaborator slice with `isExternalCollaborator` flag + immutable approval records + `ledger.period.approve_close` guards); crm plan Phases 8B (customer LINE Login LIFF registration) + 8C (trust score / auto-reply toggle / auto-booking) + core-rule/scope amendments; employee-access plan follow-up section (birthdate password); permission-matrix §5.1 adds `ledger.period.approve_close` granted to NO system role by default (excluded from OWNER/ACCOUNTANT "all") to prevent self-satisfied approval chains.
- Checklist: 02C/10E/15A now marked docs-ready with plan links; two Reorder Log entries added.

## Next

- Owner to prioritize sequencing of 02C / 10E / 15A against existing unfinished items (02A first-unfinished rule still applies; 15A Phase 0 gates on item 15 migration deploy).
- Implementation note for 10E: closing item 17 gaps (migration deploy, notification dispatch) and item 13 web UI first shortens Phase 2–3.
- Open implementation decisions to record at build time: birthdate password format (DDMMYYYY, พ.ศ. vs ค.ศ.) and 02C browser flow choice (LIFF vs OAuth redirect).
