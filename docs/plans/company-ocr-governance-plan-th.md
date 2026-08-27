# Company OCR Governance Implementation Plan

Spec: `docs/specs/company-ocr-governance-spec-th.md`
Scope: Platform Admin OCR switch/quota/usage เท่านั้น — ไม่แตะ Subscribe/Billing

## Phase 0 — Prove and freeze semantics

- [x] trace receipt web, receipt LINE และ statement OCR seams
- [x] prove `expenses.upload` ใช้แทน OCR switch ไม่ได้
- [x] freeze OCR read/upload counting semantics และ no-backfill decision
- [x] independent Claude CLI Opus 5 / effort max audit; ผลและ gap บันทึกใน memory

Exit: spec §3–§8 ไม่มีคำว่า “นับ usage” ที่ยังตีความได้หลายแบบ

## Phase 1 — Durable config and atomic OCR admission

- [x] Prisma migration: config fields + OCR event/month aggregate
- [x] shared Bangkok-month admission helper with advisory lock and request fence
- [x] wire receipt web, LINE image router/receipt reuse and statement image clients after rate/spend admission
- [x] mandatory Prisma DI + local readiness before admission + atomic release for typed pre-provider refusal
- [x] retry transient release transaction; trust exact HTTP status/error pairs only
- [x] LINE 200-UNAVAILABLE split: release typed disabled/config, block second provider on uncertain outcome
- [x] web lost-response retry reuses idempotency key; received provider failure starts a fresh attempt
- [x] stable disabled/exhausted/duplicate/unavailable outcome mapping
- [x] focused unit + concurrency contract tests

Exit: acceptance 1–5 ผ่าน และ provider fake ยืนยัน denied request ไม่ถูกเรียก

## Phase 2 — Platform Admin API and usage read

- [x] additive contracts for OCR config and usage
- [x] metadata-only read aggregates OCR current/previous/source breakdown and receipt uploads
- [x] wrap aggregate/source/upload reads in one `RepeatableRead` snapshot
- [x] config write under existing System Admin permission, metadata lock and CRITICAL audit transaction
- [x] dedicated `ocrConfigVersion` CAS: exact stale replay no-op, stale real change 409, audit from/to version
- [x] controller DTO/permission/`:partnerCompanyId` tests

Exit: acceptance 5–8 ผ่านจาก API/use-case tests

## Phase 3 — Thai Platform Admin UX

- [x] add OCR card to Partner detail with 40+ sizing/copy
- [x] switch + monthly limit (empty = unlimited) + save state
- [x] current/previous/read remaining/source/upload cards
- [x] loading/error/retry/locked states
- [x] send OCR config version; 409 reloads latest state and explains the conflict in Thai
- [x] component logic tests and web typecheck

Exit: Platform Admin can operate the feature without knowing rate-limit/token vocabulary

## Phase 4 — Integration evidence

- [x] Prisma validate/generate and clean-database migration check
- [x] focused API + web suites
- [x] register real PostgreSQL OCR race/snapshot/CAS specs in CI with fail-if-database-missing guard
- [x] API/web typecheck serially
- [x] local browser QA 390px and desktop: read, change, reload, off/on, no console error
- [x] screenshots saved under `docs/evidence/company-ocr-governance/`
- [x] update memory and master index truthfully

Exit: code is ready for root review; root owns commit/push/PR/merge sequencing
