# Agent Memory: Feature verification — bill/receipt, substitute receipt, reimbursement, employee/permissions (2026-07-28)

Status: DONE (verification complete; 2 code fixes committed as c95db1b8, pushed to origin/develop; regression tests added 2026-07-29)
Owner: Claude session (verification run requested by owner)
Scope: Live local E2E verification of (1) receipt upload→AI read→review→confirm→ledger, (2) ใบรับรองแทนใบเสร็จรับเงิน full journey, (3) reimbursement create→approve→pay, (4) employee create→role create→grant. UI language quality also assessed.

Decisions:
- Fixed 2 real bugs found during verification (apps/api, committed c95db1b8 with surgical staging):
  1. `ConfirmExpenseUseCase` catch path called `voidNumber` on a RESERVED number → always threw 409 "Only COMMITTED document numbers can be voided", masking the real error and leaking RESERVED numbers (EXP-202607-00001..3 in local DB). Changed to `cancelNumber` per the H-04 comment/pattern already in the same file.
  2. `finalizeAndConfirmExpenseCas` built its CAS record with `attachments: []` while `expenseTaxSourceChecksum` includes attachments → EVERY attachment-bearing expense failed confirm with `expense_confirmation_source_checksum_changed`. Now loads attachment links inside the txn the same way `findByIdWithRelations` does.
  - Verified: expense-branch-scope spec 26/26 pass; live confirm → 201, EXP-202607-00006 confirmed.
- `.claude/launch.json`: added `ai-gateway` (must run BUILT `pnpm build && pnpm start`; tsx dev boot fails on DI — no decorator metadata) and `workers` (PORT=3005) entries.

Verified working (local, seed-local-company):
- Upload channel: presigned MinIO upload → AI extraction (Bedrock via ai-gateway) read Thai receipt perfectly (vendor, 13-digit tax id, doc no, date, VAT 7% แยก, totals 1,808.30). 4-step review wizard, duplicate check, doc-type/tax-evidence classification, per-line tax-code gate (needs ACTIVE tax profile).
- ใบแทนใบเสร็จ: eligibility rule (valid receipt → 400 refuse), policy gate (approver+cash-evidence in settings/substitute-receipt), separate payment-evidence file required, payer self-certify with signature (bg-removal → transparent PNG), approver must be different person + review-before-approve, issued SVG artifact attached; signed evidence locks expense lines (correction = new version).
- Confirm→accounting: expense confirm requires receipt attachment or missing-receipt reason (substitute path); confirmed expense gets EXP number; outbox event published by workers app; JV posting = enable-later plug-in (generate endpoint exists, no UI trigger; สมุดรายวัน stays empty) — matches accounting-tax-plugin-path doc.
- Reimbursement: multi-line claim + per-line receipt attach + no-receipt reason; RB-202607-00002 created (Owner) → approve (ฝ้าย via custom role) → finance-review → pay 250 CASH + ref → PAID; notifications reached Owner (badge 4→7). Owner-only "ตั้งค่านโยบาย" tab visible per access commits.
- Employee/permissions: 4-step wizard (DOB DDMMYYYY initial password + forced change at first login — verified live), LINE link URL issued; RoleBuilder (preset + capability packs with risk chips + live preview + POST /settings/roles) created "ผู้อนุมัติใบแทน"; assignment via สิทธิ์รายบุคคล updates menus live; permission enforcement verified (ฝ้าย blocked from manual expense create UI, reimbursement create → 403 API).

Open findings — ALL CLOSED 2026-07-29 (web/UX in 6c01c36b, SVG api fix in 2e504e59; both PUSHED to origin/develop):
- P2 UX: reimbursement "silent บันทึกร่าง" — ROOT CAUSE was not the 403: a required input inside a CSS-collapsed row makes the browser abort submit with no message and no request. Fixed with noValidate + validateRequestForm (Thai, line-numbered) + auto-expand of collapsed rows. The 403 itself always rendered, but in English.
- P3 i18n: FIXED — new shared `apps/web/src/common/api/api-error-message.ts` translates API messages, error codes and `code:detail` conflicts (incl. parameterized sentences) to Thai; both `err()` seams (expenses, reimbursements) route through it; unknown text still passes through. Spec: api-error-message.spec.ts.
- P3 UX: FIXED — receipt can now be attached both on the manual-create form and from the detail viewer's empty state; both register `expense.receipt.primary` (verified: primaryAttachmentId set on seed-expense-record-ads).
- P3 "ยกเลิกรุ่นนี้และเก็บประวัติ": NOT A BUG — the button is disabled until a reason is typed (POST /supersede → 201 once filled). Added a hint line explaining why it is greyed out.
- P3 certified SVG: FIXED — root cause: `S3StorageAdapter.createDownloadUrl` forced `ResponseContentType: application/octet-stream` (hardening 23c61c08); browsers never content-sniff SVG in `<img>`, so the artifact broke while PNG/JPEG sniffed through. New shared `inlineDownloadContentType()` in data-model-core `attachment.logic.ts` allowlists png/jpeg/svg+xml/pdf for BOTH the S3 presigner and the local-storage controller; `Content-Disposition: attachment` kept (direct navigation still downloads → no inline-SVG script surface; uploads still reject SVG, only system-generated artifacts carry the type). Committed separately as 2e504e59 (not part of d5239b22/6c01c36b). Verified: presigned URL carries `response-content-type=image%2Fsvg%2Bxml` (curl: `Content-Type: image/svg+xml` + attachment disposition from MinIO), SRC-cms4ts28b…-V1.svg renders in inline viewer AND full-screen lightbox; attachment.logic.spec 13/13.
- API 500s: substitute-receipt guards in prisma-expense.repository now throw ConflictException with stable codes instead of plain Error (was surfacing as 500).
- Env: local full stack needs postgres+minio+redis+workers+ai-gateway; redis absence eventually broke web SSR ("Cannot reach the authentication service"); 4xx responses not logged with cause (observability gap for masked errors).
- Tax codes: ~~seed company has none~~ RESOLVED 2026-07-29: owner's real chart of accounts (~/Documents/ผังบัญชี.csv, 175 rows) imported via POST /chart-of-accounts (169 created, 6 codes already in seed: 1210-00 2120-01 3100-00 4100-01 5310-01 9999-99 — kept seed versions). SAP_S4_TH_CURRENT draft completed by replaying the activate-422 missing list (18 account rules + 16 report mappings) with role→account map: INPUT_VAT_CLAIMABLE→1154-00, INPUT_VAT_PENDING→1155-00, NONDEDUCTIBLE_VAT_EXPENSE→5390-02, OUTPUT_VAT_PAYABLE→2135-00, OUTPUT_VAT_DEFERRED→2136-00, PP36_OUTPUT_VAT_PAYABLE→2137-00, PP36_INPUT_VAT_CLAIMABLE→1154-00. Profile ACTIVATED; VAT expense confirmed live: EXP-202607-00007 (1,808.30, line tax code N1 อย่างย่อ→non-claimable, snapshot VERIFIED with SAP_S4_TH_CURRENT profileKey). Product gap noted: system enumerates required role per code (422 list) but has no name-based auto-suggest of GL account per role.

Artifacts:
- Expenses: cms4rtlq00004ulqtu2du3o0j (AI upload, พร้อมยืนยัน, blocked on tax codes), cms4suq3w001vulqt0yx06xsz (วินมอไซค์, substitute V1 issued, submit blocked on vendor fields locked by signed evidence — needs correction version), cms4ts28b000601qt84vpgthd (ป้าแดง = CONFIRMED EXP-202607-00006 with substitute SRC-...-V1).
- Reimbursement RB-202607-00002 PAID. Employee somying.acc (สมหญิง ตรวจสอบ) role ผู้อนุมัติใบแทน, password changed to a test value by the verification session.

Verification:
- apps/api expense-branch-scope spec 26/26; live: confirm 201, approve 200, payments 201, journal outbox drained (0 PENDING).
- Foreign-suite note: full apps/api suite NOT run (shared dirty tree has concurrent p1-security session changes; attachment.logic.spec typecheck error is theirs, not from this session's files).

Regression tests (2026-07-29, per owner "แก้ไขหน่อย"):
- `prisma-expense.repository.atomic-confirm.spec.ts`: harness gained `withAttachment`; new case "confirms an attachment-bearing expense" — bite-checked (temporarily reverting the fix makes it fail with checksum mismatch; positional-fake note: this is the test that pins the 100%-failure bug).
- `expense-branch-scope.use-case.spec.ts`: new case "tears down the reserved number and rethrows the original error when finalize fails" — pins rethrow-original-cause + cancel-called-with-right-args + commit-never-called. Void-vs-cancel CLASS choice is invisible to positional unit fakes (tsx emits no decorator metadata), so that specific regression is guarded by comments + live confirm only.
- Both spec files already registered in apps/api test script; combined run 31/31 pass.

Fix-session evidence (2026-07-29, two Claude sessions worked the same list concurrently on the shared tree; web work landed jointly in 6c01c36b):
- Reimbursement silent-submit: reproduced the exact old-silent case live (reason filled, รายการที่ 1 collapsed+empty, click บันทึกร่าง) → now shows "⚠ รายการที่ 1: กรุณาระบุรายการ" beside the button and auto-expands the collapsed row. No silent path remains (noValidate + validateRequestForm).
- Manual receipt slot: e2e via API — create WEB_MANUAL draft → upload-intent → PUT → complete `purpose=expense.receipt.primary` → `primaryAttachmentId` set, status DRAFT→NEEDS_REVIEW (confirm rule satisfiable). Test artifact left in local DB: expense cms4y271k0008efqtinyobf4f "ทดสอบแนบใบเสร็จ (manual)" + a UI test draft "ทดสอบหลังแก้ฟอร์ม". UI field visible on /expenses/manual (dictionary keys expenses.manual_receipt*).
- Thai error seam: `common/api/api-error-message.ts` now also covers doc-number 409s, eligibility secondaries, prepare/certify/approve conflicts, signature-upload errors, void-path codes, attachment access, and parameterized sentences via MESSAGE_PATTERNS (status names / period keys kept visible). Spec 8/8. Keys must stay byte-identical to API throw sites — grep before editing either side.

Next:
- Extend the Thai error map as new business rules ship; the seam is one file (`common/api/api-error-message.ts`) and its spec.
- Heal 3 leaked RESERVED EXP numbers in local DB if number continuity matters (local only).
