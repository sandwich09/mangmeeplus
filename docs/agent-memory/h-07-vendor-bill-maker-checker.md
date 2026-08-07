# Agent Memory: H-07 — บังคับ maker-checker สำหรับ vendor bill และ payment release

Status: DONE (implementation + tests + live verify + 8-angle review + fixes; checklist ticked 2026-07-18)
Owner: Claude (security remediation session, 2026-07-18)
Scope: `apps/api/src/modules/procurement/**`, `auth/permission-registry.ts`, `employee-access/capability-pack.registry.ts`, schema + migration `20260718160000_h07_procurement_approval_policy`, web AP page (approve feedback + policy panel + payment gate), specs, checklist

## Decisions

- **Persist submitter**: ใช้ `PurchaseApprovalEvent` (SUBMITTED ต่อรอบ); submit **append event ก่อน status change** — stray SUBMITTED บน DRAFT ไม่มีผล แต่ PENDING ที่ไม่มี event จะ misattribute submitter (fail-closed ordering); bill เก่า fallback `createdByUserId`
- **Self-approve blocked by default — ยกเว้น OWNER/ADMIN/MANAGER**: product decision จาก user 2026-07-18 ("บริษัทคนน้อย owner admin และ manager ควร self approve ได้") — `canSelfApprove(ctx.roles, policyAllow)` ใน procurement.logic: role เหล่านี้ self-approve ได้เสมอ, role อื่น fail-closed จนเปิด `ProcurementApprovalPolicy.allowSelfApproval` (OWNER-only manage, audit CRITICAL); audit approve ระบุ `selfApproved` และ snapshot ระบุ `selfApprovalRoleExempt`; **maker verify tax evidence ตัวเองไม่ได้ด้วย** (ยกเว้น role ชุดเดียวกัน — approve path เชื่อ VERIFIED เป็น independently-reviewed fact); **dual threshold ไม่มีข้อยกเว้น** — submitter ไม่นับเข้า quota แม้เป็น OWNER
- **Dual approval แบบ event-counted + checksum-pinned**: threshold เทียบ `grandTotalAmount`; **submitter ไม่นับเข้า quota เสมอ** (แม้ allowSelfApproval=true — self-approval ครอบเฉพาะบิล single-approver); approval pin กับ `vendorBillTaxSourceChecksum` ใน `thresholdSnapshotJson.sourceChecksum` — event ที่ checksum ไม่ตรง (แก้เนื้อหาแล้ว resubmit / append หลุดเข้ารอบใหม่จาก race) ไม่นับ; **finalize re-verify quota ในทรานแซกชัน CAS** (อ่าน event ผ่าน tx `db` ใน finalizeTax callback) — pre-read stale แล้วยัง fail-closed
- **Race semantics**: double-partial 2 คนพร้อมกัน = ครบ quota บน disk แต่ไม่มีใคร finalize → คลิกอนุมัติซ้ำหนึ่งครั้ง finalize (liveness ไม่ใช่ safety); duplicate approver ระหว่างรอ → 409 `vendor_bill_dual_approval_pending`; double-finalize กันด้วย CAS เดิม (updatedAt+checksum+status)
- **Payment release split**: `procurement.supplier_payment.release` (CRITICAL) ต้องมีคู่ `create` (guard hasAll); **migration backfill** grant release ให้ทุก role ที่ถือ create (Permission row สร้างใน migration ด้วย gen_random_uuid()::text ถ้ายังไม่มี — migrate รันก่อน boot sync) เพราะ `sync-permissions` (รัน prod boot ใน start-production.sh) แตะเฉพาะ system roles — custom/pack-compiled roles ต้องพึ่ง backfill; local DB ที่ migration ถูก record แล้วต้องรัน backfill SQL มือ (ทำแล้ว 2026-07-18)
- **Permissions ใหม่**: `supplier_payment.release` (FINANCE + pack ap_manage), `approval_policy.read` (LOW — ADMIN/FINANCE/AUDITOR_READONLY), `approval_policy.manage` (CRITICAL — OWNER ผ่าน COMPANY_PERMISSION_KEYS เท่านั้น)
- **Endpoint**: GET/PUT `companies/:companyId/accounts-payable/vendor-bills/approval-policy` ใน VendorBillController ประกาศก่อน route `:id`; threshold validation ใช้ `POSITIVE_ACCOUNTING_QUANTITY_PATTERN` ของ H-05 (ห้าม regex เงินใหม่); defaults ใช้ `PROCUREMENT_APPROVAL_POLICY_DEFAULTS` ใน procurement.logic (ที่เดียว กัน drift ระหว่าง GET กับ enforcement)
- **Web**: `approveWithFeedback` — 200 ที่ status ยัง PENDING_APPROVAL = partial → info banner; `ApprovalPolicyPanel` บนหน้า AP (read เห็น, manage แก้ได้); payment form gate = create+release

## Review (8 angles → verify → fix)

CONFIRMED + fixed (11): stale-round approval race → checksum pinning + in-CAS quota re-verify; submitter counted in dual quota under allowSelfApproval → excluded เสมอ + 409 เมื่อ submitter approve บิลถึง threshold; submit event/status ordering → event-first; maker self-verify tax evidence → blocked; custom/pack roles ไม่ได้ release → migration backfill; `supplier-payment-integrity.use-case.spec.ts` (อยู่ใน `test:item11b-tax` ไม่ใช่ main list!) แตกจาก release perm → fixed; threshold regex หลวมกว่า H-05 (รับ '007') → reuse pattern; defaults inline ซ้ำ → shared constant; audit metadata partial/final copy-paste → `approvalAuditBase`; sequential policy+trail reads → Promise.all; web ไม่มี partial feedback/policy UI → เพิ่มทั้งคู่

REFUTED / accepted residuals: prod brick จาก perm ไม่ sync (REFUTED — sync-permissions รันตอน prod boot + backfill ครอบ custom roles); release split "vacuous" (role-level enablement ตาม checklist; hard control คือ SoD ที่ approve seam; payer≠submitter เป็น future hardening); reject/match-override ไม่มี SoD (reject-own = ถอนงานตัวเอง; override โชว์เป็น OVERRIDDEN + perm CRITICAL + race ที่ใช้ reject ถูก neutralize ด้วย checksum pinning); offboarded approver ยังนับ (point-in-time signature); audit row-count เปลี่ยน (partial แยกด้วย `metadataJson.dualApproval.final`); ~~ไม่มี notification หาผู้อนุมัติคนที่สอง~~ (CLOSED 2026-07-18 — workflow template `vendor_bill_second_approval` consume `vendor_bill.approval_recorded`; ดู `docs/agent-memory/vendor-bill-second-approval-notification.md`)

## ข้อควรรู้ deploy

- บริษัท **single-owner**: OWNER/ADMIN/MANAGER self-approve ได้เสมอ (role exemption) — deploy ไม่ brick; role อื่น (เช่น FINANCE) ต้องมีผู้อนุมัติคนละคน หรือ OWNER เปิด allowSelfApproval ใน panel (audit CRITICAL)
- e2e/dev DB เก่า: ต้องได้ permission ใหม่ผ่าน migrate (backfill ใน migration) หรือรัน `tsx prisma/sync-permissions.ts`; e2e ปัจจุบันไม่มี test ที่ submit/approve vendor bill → ไม่แตก
- Prisma Decimal คืน '50000' (ตัด trailing zeros) — repo policy record คืน String(v) ตาม convention

## Artifacts

- `prisma/schema.prisma` — model `ProcurementApprovalPolicy` (มี hunks H-06 ของ session อื่นปน — surgical staging แล้ว)
- `prisma/migrations/20260718160000_h07_procurement_approval_policy/migration.sql` — CREATE TABLE idempotent + release-permission backfill
- repo: `getProcurementApprovalPolicy`, `upsertProcurementApprovalPolicy`, `listPurchaseApprovalEvents`, `appendPurchaseApprovalEvent(+thresholdSnapshotJson)`
- `vendor-bill.use-case.ts` — maker-checker block ใน Approve (pre-CAS) + in-CAS quota re-verify + submit event-first + evidence self-verify block
- `approval-policy.use-case.ts` (ใหม่), `procurement.logic.ts` (+defaults), controllers, module, permission-registry, capability-pack
- Web: `AccountsPayablePages.tsx` (ApprovalPolicyPanel, approveWithFeedback, info banner, payment gate), `accounts-payable.api.ts` (+2 helpers)
- Specs: `vendor-bill-maker-checker.use-case.spec.ts` (19, ลงทะเบียน main test list); อัพเดต `vendor-bill-transaction-tax.use-case.spec.ts`, `supplier-payment-integrity.use-case.spec.ts`
- Live verify (scratchpad, ไม่ commit): `h07-live-verify.ts` — 14/14

## Verification

- Unit 22/22 (รวม role-exemption 3 เคส); full API suite 2116/2116; `test:item11b-tax` 240/240; typecheck API+web clean; live DB 14/14

## Next

- Commit แล้ว (ดู git log H-07) — prod deploy รวม batch remediation (migration + boot sync ครอบ permission ใหม่)
