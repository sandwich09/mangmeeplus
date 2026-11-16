# 02b — SRS: ค่าใช้จ่าย ใบเบิก เอกสารบัญชี และ AI Draft (ฝั่ง ERP)

**วัตถุประสงค์** เอกสารนี้เป็น Software Requirements Specification ถาวรของ 4 โมดูลใน `apps/api` คือ `expenses`, `reimbursements`, `accounting-documents` และ `ai-draft` พร้อมหน้าจอเว็บที่เกี่ยวข้องใน `apps/web` เขียนจากโค้ดจริงเพื่อให้ทีมในอนาคตเข้าใจ สร้างใหม่ และดูแลระบบได้จากเอกสารนี้ร่วมกับโค้ดที่เก็บถาวร ครอบคลุม state machine ของเอกสารทุกชนิด กฎเงิน (การปัดเศษ VAT WHT) กฎไฟล์ (ชนิด ขนาด สแกนไวรัส ที่เก็บ) รหัสข้อผิดพลาด API และ web route ทั้งหมดของฟีเจอร์เหล่านี้

**ที่มา** checkout `closeout-docs-main` ที่ commit `08850deaf` (origin/main, 2026-11-10) โค้ดคือความจริง เอกสารใน `docs/` ใช้ประกอบเจตนาเท่านั้น

**AREA code** `EXP` — รหัสข้อกำหนด `FR-EXP-nnn` และ `NFR-nnn` (ในเอกสารนี้ใช้ช่วง `NFR-EXP-nn` เพื่อไม่ชนกับเอกสารอื่น ตาราง traceability ให้ join ด้วยรหัสเต็ม)

## สารบัญ

1. ขอบเขตและแพ็กที่ได้ใช้
2. บทบาทและ permission keys
3. ข้อมูล (Prisma models และ enum)
4. กฎกลาง: เงิน (rounding/VAT/WHT), ไฟล์และการสแกน, เลขเอกสาร, การเข้าถึง
5. State machines (รายจ่าย, ใบรับรองแทนใบเสร็จ, ใบเตรียมจ่าย/ใบสำคัญจ่าย, capture group, ใบเบิก, เอกสารขาย, AI draft)
6. ข้อกำหนดเชิงหน้าที่ — expenses (FR-EXP-001 ถึง FR-EXP-045)
7. ข้อกำหนดเชิงหน้าที่ — reimbursements (FR-EXP-050 ถึง FR-EXP-068)
8. ข้อกำหนดเชิงหน้าที่ — accounting-documents (FR-EXP-070 ถึง FR-EXP-079)
9. ข้อกำหนดเชิงหน้าที่ — ai-draft (FR-EXP-080 ถึง FR-EXP-084)
10. ข้อกำหนดที่ไม่ใช่หน้าที่ (NFR-EXP-01 ถึง NFR-EXP-14)
11. ตาราง API endpoints ทั้งหมด
12. ตาราง web routes
13. รหัสข้อผิดพลาดทั้งหมด
14. การทดสอบที่ครอบคลุม
15. มีใน spec/คำขอ แต่ไม่พบในโค้ด และสิ่งที่ยืนยันไม่ได้
16. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

---

## 1. ขอบเขตและแพ็กที่ได้ใช้

แหล่งอ้างอิง: `packages/contracts/src/menu-entitlements.ts` (`STARTER_FEATURE_KEYS`, `TIER_FEATURE_PRESETS` บรรทัด 432–501), `packages/contracts/src/feature-entitlements.ts` (`FEATURE_CATALOG`), `packages/contracts/src/plan-term.ts` (`PLAN_TIER_PRESETS`)

`TIER_FEATURE_PRESETS` กำหนดว่าแพ็กเสียเงินทั้ง 4 ระดับใช้ชุด starter เดียวกัน และ ENTERPRISE_1999 เพิ่มเฉพาะ `wht_pnd53` กับ `wht_50bis` ดังนั้นฟีเจอร์ในเอกสารนี้ได้สิทธิ์ตามตาราง

| Feature key | ครอบคลุม | STARTER_249 | BASIC_499 | PRO_999 | ENTERPRISE_1999 | หมายเหตุ |
|---|---|---|---|---|---|---|
| `expenses` + `expenses.list` / `.upload` / `.manual` / `.categories` / `.evidence` / `.signatures` | ทั้งโมดูล expenses รวมใบรับรองแทนใบเสร็จ ใบเตรียมจ่าย/ใบสำคัญจ่าย | ได้ | ได้ | ได้ | ได้ | ใบรับรองแทนใบเสร็จไม่มี sub-feature แยก ใช้สิทธิ์ตาม `expenses` (คอมเมนต์ `feature-entitlements.ts:112-117`) |
| `reimbursement` | ทั้งโมดูล reimbursements | ได้ | ได้ | ได้ | ได้ | |
| `ai_line_assistant` | เมนูบริบท "AI แนะนำ" (`ai-suggestions`) และผู้ช่วย LINE | ได้ | ได้ | ได้ | ได้ | template ของ ai-draft ต้องพึ่งโมดูลอื่นที่ไม่ได้ขาย ดูข้อ 9 |
| เมนู `counterparties` (คู่ค้า) | `entitlementKeys: ['expenses','sales_documents']` | ได้ (ฝั่งผู้ขาย) | ได้ | ได้ | ได้ | ผูกกับ `expenses` เป็น parent เพื่อให้ร้านที่ไม่เปิดงานขายยังใช้ฝั่ง vendor ได้ |
| `wht_pnd53`, `wht_50bis` | ปุ่มออก 50 ทวิ และหน้า `expenses/wht-certificates` | ไม่ได้ | ไม่ได้ | ไม่ได้ | ได้ | รายละเอียดอยู่ในเอกสาร AREA ภาษี เอกสารนี้อธิบายเฉพาะจุดเชื่อมกับรายจ่าย |
| `sales_documents` | เอกสารขาย (quotation/invoice/receipt/tax invoice/CN/DN) รับชำระ บันทึกรายรับ | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่อยู่ใน preset ใด และ menu binding `salesdoc`/`sales`/`accounting` มี `status: 'planned'` — ดูข้อ 8 และข้อ 16 |
| `double_entry_ledger`, `expense_auto_post` | ลงบัญชีรายจ่ายอัตโนมัติ | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ | `full` preset ยังตัด `expense_auto_post` ออก ดูข้อ 16 |

**FREE_TRIAL_15** ไม่อยู่ใน `TIER_FEATURE_PRESETS` (type เป็น `Exclude<PlanTierKey,'FREE_TRIAL_15'>`) เป็นแพ็กทดลอง 15 ใบ/เดือน สาขา 1 พนักงาน 2 (`PLAN_TIER_PRESETS`) เมื่อหมดอายุและไม่เคยมีหลักฐานการซื้อ ร้านจะตกไปโหมด "ร่างรายจ่ายฟรี" (ดู FR-EXP-006)

**โควตาใบเสร็จต่อเดือน** (`monthlySlipLimit`): FREE_TRIAL_15 = 15, STARTER_249 = 30, BASIC_499 = 50, PRO_999 = 100, ENTERPRISE_1999 = 500 และมี add-on "receipt image" เพิ่มโควตา (รายละเอียดการคิดโควตาอยู่ในเอกสาร billing)

**ข้อควรระวังเรื่องค่าเริ่มต้นตอน onboarding** `DEFAULT_ENABLED_FEATURE_KEYS` ใน `apps/api/src/modules/system-partner-management/domain/feature-registry.ts:27` เปิด `expenses`, `reimbursement`, `product_catalog`, `crm`, `line_oa`, `dashboard_notifications`, `ai_line_assistant`, `thai_tax`, `double_entry_ledger`, `workflow_automation` ให้ร้านใหม่ (และปิด `expense_auto_post` โดยเจตนา — posting สะสมเป็น `pending`) ส่วนการซื้อแพ็กใช้ `TIER_FEATURE_PRESETS` ตารางข้างบนยึด `TIER_FEATURE_PRESETS` ตามที่ brief กำหนด ความสัมพันธ์ระหว่างค่าเริ่มต้นตอน onboarding กับ snapshot ของแพ็กที่ซื้ออยู่ในเอกสาร AREA billing/entitlement และเอกสารนี้ไม่ได้ยืนยัน โค้ดรายจ่ายอ่าน entitlement `thai_tax` เพียงจุดเดียวคือ capture policy (FR-EXP-007)

ข้อสังเกตเชิงขอบเขต: คำสั่งงานขอให้ครอบคลุม `accounting-documents` ทั้งโมดูล แต่ brief กำหนดให้ฟีเจอร์ที่ไม่อยู่ในแพ็กใดถูกบันทึกแบบย่อ เอกสารนี้จึง (ก) อธิบาย **คู่ค้า** เต็มรูปแบบเพราะขายจริง และ (ข) บันทึก **เอกสารขาย** ในข้อ 8 ระดับ state machine กฎ และ endpoint เพื่อเป็นหลักฐานทางวิศวกรรม โดยกำกับชัดว่าไม่ได้ขายในแพ็กใด

---

## 2. บทบาทและ permission keys

permission ถูกตรวจ 2 ชั้นเสมอ: decorator ที่ controller (`@RequirePermissions` = ต้องมีทุกตัว, `@RequireAnyPermission` = มีตัวใดตัวหนึ่ง จาก `apps/api/src/common/security/permissions.decorator.ts`) และ use case ที่ตรวจเจ้าของรายการ สาขา และสถานะอีกครั้ง

### 2.1 expenses

| Permission key | ความหมายตามโค้ด |
|---|---|
| `expense.read` | อ่านรายจ่ายทั้งร้าน (ขอบเขต `company` ใน `expense-list-read-scope.ts`) |
| `expense.read_related` | อ่านรายจ่ายที่ตนเกี่ยวข้อง (ขอบเขต `related`) และเป็นประตูเข้าคู่ค้าที่ตนเพิ่ม |
| `expense.read_own` | อ่านเฉพาะรายจ่ายที่ตนสร้าง (ขอบเขต `own`) |
| `expense.create` | สร้างร่างด้วยมือ สร้าง capture group อ่านหมวดเงินได้ WHT |
| `expense.update` | แก้ร่างของตน ส่งให้ตรวจ (`mark-ready`) ลบร่างของตน |
| `expense.review` | ตรวจ แก้ field ชนิดเอกสาร/ภาษี/หมวดบัญชี ตัดสินสิทธิภาษีซื้อ ตรวจซ้ำ จัดเตรียมใบรับรองแทนใบเสร็จ และถือขอบเขตอ่านทั้งร้าน |
| `expense.confirm` | ยืนยันรายจ่าย เปิดกลับมาแก้ (`reopen`) อนุมัติใบรับรองแทนใบเสร็จ ยืนยันชื่อผู้ซื้อไม่ตรง |
| `expense.reject` | ส่งกลับให้แก้/ไม่อนุมัติ |
| `expense.void` | ยกเลิกรายจ่ายที่ยืนยันแล้ว |
| `expense.delete` | ลบรายจ่ายในขอบเขต (ไม่จำกัดเจ้าของ) |
| `expense.payment.record` | บันทึกจ่าย แนบสลิป ยกเลิกการจ่าย ยืนยันวันที่จ่าย |
| `expense.receipt.upload`, `expense.receipt.line_upload` | อัปโหลดใบเสร็จจากเว็บ / จาก LINE |
| `expense.ocr.request` | สั่งให้ AI อ่านเอกสาร |
| `expense.duplicate.resolve` | ปลด/ยืนยันรายการซ้ำ |
| `expense.category.manage` | จัดการหมวดค่าใช้จ่ายและรหัสบัญชีของนักบัญชี |
| `expense.evidence.read`, `expense.export` | หน้าหลักฐานทางบัญชี และส่งออกชุดให้นักบัญชี |
| `expense.signature.self_manage`, `expense.signature.manage` | ลายเซ็นประจำตัว (ตัว `manage` เป็น legacy แต่ขอบเขตยังเป็นเจ้าของเท่านั้น) |
| `expense.disbursement.read` / `.prepare` / `.approve` / `.pay` / `.issue` | ใบเตรียมจ่าย/ใบสำคัญจ่าย: อ่าน จัดทำ อนุมัติ บันทึกจ่าย ออกใบจากการจ่ายที่มีอยู่/ออกใบแทน |
| `company.setup.manage` | ตั้งค่านโยบายใบรับรองแทนใบเสร็จ และสวิตช์ e-WHT |

### 2.2 reimbursements

| Permission key | ความหมายตามโค้ด |
|---|---|
| `reimbursement.create` | สร้างใบเบิก และจัดการบัญชีรับเงินของตนเอง |
| `reimbursement.update_own_draft` | แก้ร่างของตน เปิดใบที่ถูกปฏิเสธกลับมาแก้ |
| `reimbursement.submit` | ส่งใบเบิก |
| `reimbursement.cancel_own` | ยกเลิกใบของตน/ถอนคำขอยกเลิก |
| `reimbursement.read` / `.read_related` / `.read_own` | อ่านรายการและสรุป |
| `reimbursement.approve`, `reimbursement.reject` | อนุมัติ/ปฏิเสธ (route ใช้ `account.session.read` แล้ว use case ตรวจสิทธิ์จริงร่วมกับผู้ถูกมอบหมาย) |
| `reimbursement.finance_review` | ตรวจการเงิน แก้ใบแทนผู้เบิก คิวการเงิน |
| `reimbursement.payment.record`, `reimbursement.payment.void` | บันทึกจ่าย/ยกเลิกการจ่าย แนบสลิป |
| `reimbursement.duplicate.resolve` | ปลดรายการซ้ำ |
| `reimbursement.export` | ส่งออกหลักฐานใบเบิก |
| `reimbursement.policy.read`, `reimbursement.policy.manage` | อ่าน/ตั้งค่านโยบาย |
| `access.employee.read`, `access.employee.update` | ผู้ดูแลกรอกบัญชีรับเงินแทนสมาชิก |
| `account.session.read` | ประตูขั้นต่ำของ route ที่ use case ตัดสินสิทธิ์เอง (hub, detail, approve, reject, resume, internal notes, draft actions, reveal บัญชี, เปิดสลิป) |

### 2.3 accounting-documents และ ai-draft

| Permission key | ความหมาย |
|---|---|
| `accounting.counterparty.read`, `accounting.counterparty.manage` | ทะเบียนคู่ค้า: อ่าน / สร้าง-แก้ |
| `accounting.document.*`, `accounting.quotation.*`, `accounting.invoice.*`, `accounting.billing_note.*`, `accounting.receipt.*`, `accounting.tax_invoice.*`, `accounting.credit_note.*`, `accounting.debit_note.*` (`read`/`create`/`update`/`issue`/`void`), `accounting.quotation.submit_approval`, `accounting.quotation.approve`, `accounting.payment.read`/`create`/`void`, `accounting.revenue_category.manage` | เอกสารขาย (ไม่ได้ขาย ดูข้อ 8/16) |
| `ai.suggestion.read`, `ai.suggestion.read_own`, `ai.suggestion.request`, `ai.suggestion.review`, `ai.draft.review`, `ai.draft.create_source_draft` | ชั้นคำแนะนำ AI |

การผูก permission เข้ากับ role/capability pack อยู่ในเอกสาร AREA สิทธิ์ผู้ใช้ เอกสารนี้ระบุเฉพาะ key ที่โค้ดของ 4 โมดูลนี้ตรวจจริง

---

## 3. ข้อมูล (Prisma models และ enum)

ไฟล์: `apps/api/prisma/schema.prisma`

### 3.1 Models

| กลุ่ม | Model (บรรทัดโดยประมาณ) | บทบาท |
|---|---|---|
| ไฟล์แนบ | `AttachmentObject` (1176), `AttachmentBlob` (1219), `AttachmentLink` (1229) | วัตถุไฟล์ (bucket, objectKey, checksum, perceptualHash, status, visibility), เนื้อไฟล์แบบเก็บใน DB, และ link ไปยัง target (`targetType`, `targetId`, `purpose`) |
| เลขเอกสาร | `DocumentSequence` (1245), `DocumentNumber` (1268) | ตัวนับต่อ `(companyId, branchScopeKey, documentType, periodKey)` และทะเบียนเลขที่จอง/ยืนยัน/ยกเลิก |
| รายจ่าย | `ExpenseRecord` (2675), `ExpenseLine` (2998), `ExpensePayment` (2966), `ExpenseDuplicateCandidate` (3127), `ExpenseInputVatDecision` (11090) | หัวรายจ่าย บรรทัด การจ่าย คู่ที่อาจซ้ำ และประวัติการตัดสินสิทธิภาษีซื้อ |
| หมวด | `ExpenseCategory` (2634), `ExpenseCategoryAccountantAccount` (2618) | หมวดค่าใช้จ่ายของร้าน และรหัส/ชื่อบัญชีที่นักบัญชีใช้ |
| ใบเตรียมจ่าย/ใบสำคัญจ่าย | `DisbursementVoucher` (2845), `DisbursementVoucherLine` (2949), `DisbursementVoucherRevision` (2927), `DisbursementVoucherCommand` (2913) | เอกสาร บรรทัดที่อ้างรายจ่าย รอบการส่ง/ตัดสิน และ idempotency ของคำสั่ง |
| ลายเซ็น | `CompanySignatureAsset` (3151), `SignatureFillRecord` (3183) | ลายเซ็นประจำตัวและบันทึกการวางลายเซ็น |
| ใบรับรองแทนใบเสร็จ | `ExpenseSubstituteReceiptEvidence` (3207), `ExpenseSubstituteReceiptPolicy` (3279) | หลักฐานรุ่นต่อรุ่น (snapshot, hash, ผู้จ่าย ผู้อนุมัติ artifact) และนโยบายของร้าน |
| Capture group | `ExpenseCaptureGroup` (3392), `ExpenseCaptureFile` (3435), `ExpenseCaptureReadJob` (3467), `ExpenseCaptureObservation` (3504), `ExpenseCaptureAllocation` (3533) | ชุดไฟล์ที่ส่งเข้ามาครั้งเดียว งานอ่าน ข้อเท็จจริงที่อ่านได้ และการแบ่งยอดบริษัท/ส่วนตัว |
| ใบเบิก | `ReimbursementPolicy` (7364), `ReimbursementRequest` (7393), `ReimbursementLine` (7538), `ReimbursementApprovalStep` (7587), `ReimbursementPayment` (7614), `ReimbursementDuplicateCandidate` (7656), `ReimbursementClaimSignature` (7569), `ReimbursementInternalNote` (7523), `ReimbursementDraftAction` (7482) | นโยบาย คำขอ บรรทัด ขั้นอนุมัติ การจ่าย คู่ซ้ำ ลายเซ็นบนแบบฟอร์ม บันทึกภายใน และคำสั่งร่างจาก LINE |
| บัญชีรับเงิน | `MemberPayoutAccount` (7679), `MemberSavedPayoutAccount` (7706), `ReimbursementPayoutDestination` (7731) | บัญชี default ของสมาชิก บัญชีที่บันทึกไว้หลายบัญชี และปลายทางรับเงินที่ถูก freeze ต่อใบ/ต่อรุ่น |
| เอกสารบัญชี | `AccountingCounterparty` (2078), `AccountingDocument` (2112), `AccountingDocumentLine` (2209), `AccountingPayment` (2271), `AccountingPaymentAllocation` (2319), `AccountingSimpleIncomeCommand` (2342), `RevenueCategory` (2592), `AccountingDocumentIssueCommand` (10468), `AccountingDocumentBuyerEvidenceRevision` (10496), `AccountingIssueAuthzObservation` (10523) | คู่ค้า เอกสารขาย บรรทัด รับชำระ การจัดสรร รายรับอย่างง่าย หมวดรายรับ และ idempotency ของการออกเอกสาร |
| AI draft | `AiDraftRequest` (8824), `AiSuggestion` (8855), `AiSuggestionCitation` (8893), `AiDraftArtifact` (8913), `AiSuggestionReview` (8962) | คำขอ คำแนะนำ การอ้างอิงแหล่งข้อมูล ร่างที่ AI สร้าง และผลการตรวจของคน |

### 3.2 Enum สำคัญ

| Enum | ค่า |
|---|---|
| `ExpenseStatus` | `DRAFT`, `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `VOIDED` |
| `ExpensePaymentStatus` / `ExpensePaymentRecordStatus` | `UNPAID`, `PARTIALLY_PAID`, `PAID`, `VOIDED` / `RECORDED`, `VOIDED` |
| `ExpensePostingStatus` | `not_required`, `pending`, `posted`, `posting_error`, `reversed` |
| `ExpenseVatMode` | `NO_VAT`, `VAT_INCLUDED`, `VAT_EXCLUDED`, `EXEMPT`, `NEEDS_REVIEW` |
| `InputVatClaimStatus` | `CLAIMABLE`, `NON_CLAIMABLE`, `NEEDS_REVIEW` |
| `ExpensePaymentMethod` | `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER` |
| `ExpenseCaptureSource` | `WEB_UPLOAD`, `WEB_MANUAL`, `LINE_UPLOAD`, `API_INTERNAL` |
| `SourceDocumentType` | `RECEIPT`, `TAX_INVOICE`, `CUSTOMS_VAT_RECEIPT`, `PP36_RECEIPT`, `ABBREVIATED_TAX_INVOICE`, `TRANSFER_SLIP`, `HANDWRITTEN_CASH_BILL`, `SUPPLIER_BILL`, `MARKETPLACE_ORDER_SCREENSHOT`, `EXPENSE_NOTE_TEXT`, `SUBSTITUTE_RECEIPT`, `OTHER_EXPENSE_DOCUMENT`, `NEEDS_REVIEW` |
| `TaxEvidenceStatus` | `USABLE_FOR_TAX`, `SUPPORTING_ONLY`, `NOT_TAX_EVIDENCE`, `NEEDS_REVIEW` |
| `ExtractionStatus` | `NOT_REQUESTED`, `NOT_CONFIGURED`, `QUEUED`, `PROCESSING`, `SUCCEEDED`, `PARTIAL`, `FAILED` |
| `AiVerificationStatus` | `NOT_VERIFIED`, `VERIFYING`, `AI_VERIFIED`, `PARTIAL`, `NEEDS_REVIEW`, `FAILED`, `HUMAN_VERIFIED` |
| `DuplicateStatus` / `DuplicateCandidateStatus` | `NOT_CHECKED`, `NO_MATCH`, `POSSIBLE_DUPLICATE`, `CONFIRMED_DUPLICATE`, `OVERRIDDEN` / `OPEN`, `DISMISSED`, `CONFIRMED_DUPLICATE` |
| `ExpenseLineChargeKind` | `SERVICE_CHARGE`, `DELIVERY`, `PACKAGING`, `PLATFORM_FEE`, `TIP`, `ROUNDING`, `OTHER` |
| `ExpenseLineReviewStatus` | `SUGGESTED`, `REVIEWED`, `NEEDS_REVIEW` |
| `ExpenseCategoryStatus` | `ACTIVE`, `ARCHIVED` |
| `DisbursementVoucherStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PAID`, `CANCELLED` |
| `DisbursementVoucherOrigin` / `PayeeBasis` / `RevisionDecision` | `PREPARED`, `DIRECT_PAYMENT`, `REISSUED` / `SINGLE`, `TAX_ID`, `SAME_NAME`, `PREPARER_CONFIRMED` / `APPROVED`, `RETURNED`, `WITHDRAWN`, `CANCELLED` |
| `SignatureAssetStatus` / `SignatureSubmitChannel` | `PENDING_OWNER_APPROVAL`, `ACTIVE`, `REJECTED`, `ARCHIVED` / `WEB`, `LINE` |
| `SubstituteReceiptEvidenceStatus` | `PREPARED`, `PAYER_CERTIFIED`, `ISSUED`, `SUPERSEDED` |
| `SubstituteReceiptSignatureMode` / `PreparedChannel` / `FundingSource` | `DIGITAL`, `PAPER` / `WEB`, `LINE` / `COMPANY`, `PERSONAL_ADVANCE` (ค่าที่โค้ดตรวจใน `substitute-funding.logic.ts`) |
| `ExpenseCashEvidencePolicy` / `ExpenseSubstituteReceiptApprovalMode` | `REQUIRE_SEPARATE_PAYMENT_EVIDENCE`, `ALLOW_SUPPORTING_EVIDENCE_ONLY` / `OWNER_SELF`, `DESIGNATED_APPROVERS` |
| `ExpenseCaptureGroupStatus` | `OPEN`, `HANDED_OFF`, `CLOSED_NO_HANDOFF`, `CANCELLED` |
| `ExpenseCaptureFileState` | `PENDING_UPLOAD`, `STORED`, `REJECTED`, `DETACHED` |
| `ExpenseCaptureReadStatus` / `ReadOwner` | `QUEUED`, `PREPARING`, `READING`, `PARTIAL`, `PAUSED`, `FAILED`, `DONE`, `CANCELLED` / `CAPTURE_GROUP`, `EXPENSE` |
| `ExpenseCaptureBusinessUse` / `FundingRoute` / `HandoffState` / `AllocationStatus` / `ObservationSource` / `IntakeChannel` | `UNKNOWN`, `ALL_COMPANY`, `MIXED` / `UNKNOWN`, `COMPANY`, `EMPLOYEE` / `NONE`, `ACTIVE`, `RELEASED` / `PREVIEW`, `ACCEPTED`, `SUPERSEDED`, `INVALIDATED` / `AI`, `HUMAN`, `EXPENSE_FACTS` / `WEB`, `LINE` |
| `ReimbursementRequestStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `PARTIALLY_PAID`, `PAID`, `VOIDED` |
| `ReimbursementApprovalStepStatus` | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `SKIPPED`, `EXPIRED` |
| `ReimbursementFinanceReviewStatus` | `NOT_REQUIRED`, `PENDING`, `NEEDS_INFO`, `APPROVED_FOR_PAYMENT`, `BLOCKED` |
| `ReimbursementPaymentStatus` / `PaymentRecordStatus` / `PaymentMethod` | `NOT_PAYABLE`, `UNPAID`, `PARTIALLY_PAID`, `PAID`, `VOIDED` / `RECORDED`, `VOIDED` / `CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER` |
| `ReimbursementApproverMode` | `DIRECT_MANAGER`, `MANAGER_ROLE`, `OWNER_ROLE`, `CUSTOM_USER`, `CUSTOM_ROLE` |
| `ReimbursementDuplicatePolicy` / `PolicyStatus` | `WARN`, `BLOCK_SUBMIT`, `BLOCK_PAYMENT` / `ACTIVE`, `INACTIVE` |
| `ReimbursementReceiptRequirementStatus` | `REQUIRED`, `ATTACHED`, `MISSING_WITH_REASON`, `WAIVED_BY_POLICY` |
| `ReimbursementDuplicateCandidateType` / `Status` | `ATTACHMENT_CHECKSUM`, `EXPENSE_LINK`, `AMOUNT_DATE_VENDOR`, `MANUAL` / `OPEN`, `DISMISSED`, `CONFIRMED`, `OVERRIDDEN` |
| `ReimbursementClaimSignatureRole` | `REQUESTER`, `APPROVER`, `FINANCE_REVIEW`, `PAYER` |
| `AccountingCounterpartyType` / `Status` | `CUSTOMER`, `VENDOR`, `BOTH` / `ACTIVE`, `ARCHIVED` |
| `AccountingDocumentType` | `QUOTATION`, `INVOICE`, `BILLING_NOTE`, `RECEIPT`, `TAX_INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE` |
| `AccountingDocumentStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ISSUED`, `VOIDED`, `CREDITED`, `DEBITED`, `CLOSED` |
| `AccountingPaymentStatus` / `PaymentRecordStatus` / `OutputTaxCode` | `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOIDED` / `DRAFT`, `RECORDED`, `VOIDED` / `O7`, `OX`, `O0` |
| `AiDraftRequestStatus` | `QUEUED`, `GENERATING`, `READY`, `NEEDS_DATA`, `PROVIDER_UNAVAILABLE`, `FAILED`, `CANCELED`, `EXPIRED` |
| `AiSuggestionStatus` | `NEW`, `IN_REVIEW`, `ACCEPTED_FOR_SOURCE_DRAFT`, `SOURCE_DRAFT_CREATED`, `DISMISSED`, `SUPERSEDED`, `EXPIRED`, `BLOCKED_BY_PERMISSION`, `BLOCKED_BY_SOURCE_STATE`, `FAILED` |
| `AiSuggestionDomain` / `Agent` / `AiDraftRequestOrigin` | `CFO`, `SALES_CRM`, `INVENTORY`, `TAX_ACCOUNTING`, `WORKFLOW` / `CFO`, `SALES`, `CRM`, `INVENTORY`, `TAX`, `ACCOUNTING`, `WORKFLOW` / `WEB`, `LINE`, `WORKFLOW`, `SCHEDULE`, `SYSTEM` |
| `AiCandidateActionType` | `CREATE_CRM_FOLLOW_UP_DRAFT`, `CREATE_ACCOUNTING_QUOTATION_DRAFT`, `CREATE_INVENTORY_REORDER_REVIEW`, `CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST`, `CREATE_TAX_EVIDENCE_CHECKLIST`, `CREATE_TAX_CERTIFICATE_DRAFT`, `CREATE_WORKFLOW_TASK`, `CREATE_REVIEW_CHECKLIST`, `NO_SOURCE_DRAFT_AVAILABLE` |
| `AttachmentStatus` / `AttachmentVisibility` | `PENDING_UPLOAD`, `ACTIVE`, `QUARANTINED`, `DELETED` / `INTERNAL`, `ACCOUNTING`, `AUDIT`, `CUSTOMER_VISIBLE` |
| `DocumentNumberStatus` / `DocumentResetPolicy` | `RESERVED`, `COMMITTED`, `CANCELLED`, `VOIDED` / `NONE`, `MONTHLY`, `YEARLY` |

---

## 4. กฎกลาง

### 4.1 กฎเงิน (rounding, VAT, WHT)

แหล่ง: `apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts`, `expense-vat-reconciliation.logic.ts`, `expense-status.logic.ts`, `apps/api/src/modules/accounting-documents/domain/logic/accounting-totals.logic.ts`, `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`

1. **ชนิดข้อมูล** คำนวณด้วย `decimal.js` เท่านั้น ห้ามใช้ float ค่าทุกตัวรับ-ส่งเป็น string คอลัมน์เก็บเป็น `Decimal(18,4)` แต่ค่าที่เก็บเป็นระดับสตางค์
2. **นโยบายสตางค์** ทุกองค์ประกอบเงินปัดเป็น 2 ตำแหน่งแบบ `ROUND_HALF_UP` ณ เวลาคำนวณ (`round2`) เพื่อให้ยอดที่เก็บตรงกับเอกสารที่พิมพ์ เช่น 542.06 × 0.07 = 37.94
3. **บรรทัดรายจ่าย** (`calcLineTotals`):
   - `lineSubtotal = round2(quantity × unitPrice)`
   - ส่วนลดถูก clamp ไม่เกิน `max(lineSubtotal, 0)` (บรรทัด `ROUNDING` ติดลบได้โดยไม่กลายเป็นส่วนลด)
   - `VAT_INCLUDED`: `taxable = round2(afterDiscount ÷ (1 + rate))` เมื่อ rate > 0 และ `vat = round2(afterDiscount − taxable)` (VAT คือเศษที่เหลือ ยอดรวมจึงไม่เพี้ยน)
   - `VAT_EXCLUDED`: `taxable = afterDiscount`, `vat = round2(taxable × rate)`
   - โหมดอื่น (`NO_VAT`, `EXEMPT`, `NEEDS_REVIEW`): `vat = 0`
   - `wht = round2(taxable × whtRate)` — **ฐาน WHT คือยอดก่อน VAT**
   - `lineTotal = round2(taxable + vat)`
   - อัตรา VAT ที่ว่าง = "ไม่ทราบ" ไม่ใช่ 7% ไม่มีค่า default และห้ามยืนยันรายจ่ายที่โหมดบอกว่ามี VAT แต่บรรทัดไม่มีอัตรา (`hasUnknownVatRateLine`) อัตรา `0` คือ zero-rated ยืนยันได้ปกติ
4. **ยอดรวมเอกสาร** (`calcDocumentTotals`): `subtotalAmount` รวมเฉพาะบรรทัดสินค้า/บริการ (บรรทัดที่มี `chargeKind` ไม่นับใน subtotal แต่นับในฐานภาษี), `grandTotal = round2(taxable + vat)`, `netPayable = round2(grandTotal − wht)` — **ยอดที่ต้องจ่ายจริงคือยอดรวมหัก WHT**
5. **Totals identity** (`expenseTotalsIdentityError`, ค่าคลาดเคลื่อน `EXPENSE_TOTALS_TOLERANCE = 0.05`): subtotal = ผลรวมบรรทัดสินค้า, vat = ผลรวม VAT บรรทัด, grandTotal = taxable + vat, และ (ยกเว้น `VAT_INCLUDED`) taxable = subtotal − discount + ผลรวมบรรทัด charge ถ้าไม่ตรงการสร้าง/แก้ร่างถูกปฏิเสธ 400 และฝั่งอ่านรายงาน `totalsIdentity { ok, gapAmount }`
6. **การกระทบ VAT กับเอกสาร** (`reconcileExpenseVat`): แหล่ง VAT (`vatSource.inputType` = `RATE`/`AMOUNT`/`BOTH`/`NONE`) ถูกเทียบกับที่คำนวณได้ ถ้าต่างเกิน tolerance ผู้ตรวจต้องใช้ `vatSourceOverride` ตอนยืนยัน (ระบุเหตุผล ≤ 500 ตัวอักษร และบรรทัด VAT ที่รับส่วนต่าง) ระบบบันทึก audit `expense.vat.source_override`
7. **บรรทัดปัดเศษอัตโนมัติ** (`expense-precision-adjustment.logic.ts`): ระบบคงบรรทัด `ROUNDING` ที่คำนวณเองไว้ได้เฉพาะเมื่อส่วนต่างมีหลักฐานจากเอกสาร (ส่วนต่างราคาเศษ ≤ 0.02 หรือส่วนต่าง subtotal ที่พิมพ์ ≤ min(จำนวนรายการ × 0.01, 0.10)) และจะไม่ปรับยอดที่คนแก้ให้กลับไปเท่ายอด OCR เดิม
8. **การจ่าย**: `outstanding = round2(max(netPayable − paid, 0))`; สถานะ `PAID` เมื่อ `netPayable − paid < SETTLE_EPSILON (0.005)`; จ่ายเกินยอดค้างถูกปฏิเสธ (`expense_payment_exceeds_outstanding`, `expense_paid_exceeds_payable`)
9. **OCR total gate**: ถ้ายอดรวมที่เก็บต่างจากยอดที่ AI อ่านได้เกิน 0.05 ต้องมีการรับทราบจากผู้ตรวจ (`ocr-total-acknowledgement`) ผูกกับยอด ณ ตอนรับทราบ แก้ยอดอีกครั้งต้องรับทราบใหม่
10. **ยอดศูนย์**: ยืนยันรายจ่ายยอด 0 ไม่ได้ (audit H-11)
11. **WHT**: เมื่อ `whtAmount > 0` ต้องมีประเภทผู้รับเงิน (`vendorEntityKindSnapshot` บุคคลธรรมดา/นิติบุคคล — ตัดสิน ภ.ง.ด.3 หรือ 53) และหมวดเงินได้ (`whtCategoryCode`) ก่อนยืนยัน วิธีนำส่ง (`whtRemittance`) ต้องอยู่ใน `WHT_REMITTANCES` และถูกล้างเป็น null เมื่อ WHT เป็น 0 การเลือก `E_WHT` ต้องเปิดสวิตช์ e-WHT ของร้าน (`expense_e_wht_not_enabled`) และจำกัดวิธีจ่าย (`expense_ewht_payment_method`, `expense_ewht_cash_payment_exists`)
12. **สกุลเงิน**: default `THB`; มี `currency_not_supported` สำหรับการส่งออก/เส้นทางที่ไม่รองรับสกุลต่างประเทศ
13. **เอกสารขาย** ใช้นโยบายเดียวกัน (`accounting-totals.logic.ts`) แต่ `vatRate` เป็นเปอร์เซ็นต์ (หาร 100) ต่างจากรายจ่ายที่เป็นทศนิยม (0.07)
14. **ใบเบิก**: ยอดต่อบรรทัดต้อง > 0, ยอดสูงสุด `REIMBURSEMENT_MAX_AMOUNT = 99,999,999,999,999.99`, สูงสุด `REIMBURSEMENT_MAX_LINES = 50` บรรทัด, MVP **จ่ายเต็มจำนวนเท่านั้น** (`partial_payment_not_allowed`, `payment_over_approved_amount`) ใช้ `SETTLE_EPSILON` เดียวกัน

### 4.2 กฎไฟล์และการสแกน

แหล่ง: `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts`, `.../application/use-cases/complete-attachment-upload.use-case.ts`, `.../infrastructure/attachment-malware-scanner.ts`, `packages/config/src/index.ts`

| หัวข้อ | กฎ |
|---|---|
| ชนิดไฟล์ที่รับ | `image/jpeg`, `image/png`, `application/pdf` เท่านั้น (`ALLOWED_ATTACHMENT_MIME_TYPES`); นามสกุลต้องตรงกับ MIME (`pdf` / `png` / `jpg`,`jpeg`); ตรวจ magic bytes (`%PDF-`, PNG signature, JPEG SOI + EOI โดยยอมให้มี trailer หลัง EOI) |
| ขนาด | เพดานแข็ง `MAX_ATTACHMENT_BYTES = 25 MB`; ค่าที่ใช้จริงคือ `UPLOAD_MAX_BYTES` default 10,485,760 (10 MB); ไฟล์ค้างอัปโหลดต่อร้านไม่เกิน `UPLOAD_PENDING_MAX_BYTES_PER_COMPANY` default 100 MB |
| ลายเซ็น | PNG/JPEG เท่านั้น ไม่เกิน `SIGNATURE_MAX_BYTES = 2,000,000` ไบต์; ระบบ normalize ด้วย `sharp` (หมุนตาม EXIF, ย่อขอบยาวสุด 1600 แล้ว 1000, ลบพื้นหลังด้วย threshold luminance 235, จำกัด input 40 ล้านพิกเซล) |
| สลิปการจ่าย (รายจ่าย ใบเบิก ใบสำคัญจ่าย) | PDF/PNG/JPEG ไม่เกิน 10 MB (`REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES`); ใบเบิกแนบได้ไม่เกิน 5 ไฟล์ต่อการจ่าย (`REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES`) |
| PDF ใน capture | ไม่เกิน `EXPENSE_CAPTURE_PDF_MAX_PAGES` default 60 หน้า; ไฟล์ derivative ไม่เกิน `EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES` default 64 MB; XML ฝังใน PDF ไม่เกิน 3 MB; มีตัวตรวจความปลอดภัย PDF (`PdfSafetyReader`) |
| ขั้นตอนอัปโหลด | 2 ขั้น: (1) intent — server จอง `AttachmentObject` สถานะ `PENDING_UPLOAD` และคืน pre-signed upload; (2) complete — server อ่านไบต์จาก storage, สแกนมัลแวร์, คำนวณ SHA-256, เทียบ checksum ที่ client แจ้ง, ย้ายไป object key แบบ immutable ที่ผูกกับ checksum แล้วตั้ง `ACTIVE` |
| สแกนไวรัส | ClamAV ผ่าน TCP (`CLAMAV_HOST`, `CLAMAV_PORT` default 3310, `CLAMAV_TIMEOUT_MS` default 5000 สูงสุด 30000); production ที่ไม่ตั้ง host จะ throw `CLAMAV_NOT_CONFIGURED` (fail closed); พบมัลแวร์ → `MALWARE_DETECTED` → ปฏิเสธด้วย `CONTENT_REJECTED`; สแกนไม่ได้ → `CONTENT_UNINSPECTABLE` |
| ที่เก็บ | `AttachmentObject.storageProvider/bucket/objectKey/objectVersionId` (object storage) และ `AttachmentBlob` สำหรับเก็บใน DB; ดาวน์โหลดผ่าน download-url ที่ตรวจสิทธิ์ต่อ target |
| จุดประสงค์ไฟล์ (purpose) ที่อนุญาต | target `expense.record`: `expense.receipt.primary`, `expense.receipt.supporting`, `expense.payment.evidence`, `expense.review.evidence`; target `expense.capture_group`: `expense.capture.evidence`; target `accounting.document`: `accounting.receipt.evidence`, `accounting.document.supporting`; target `company.signature_asset`: ลายเซ็น; target `reimbursement_request`: `reimbursement.claim_form.signed`; target `reimbursement_payment`: `reimbursement.payment.slip`; target `disbursement_voucher`: `expense.disbursement_voucher.pdf` / `.supporting` / `.slip` |
| ความเป็นเอกสิทธิ์ของไฟล์ | ลายเซ็นห้ามผูกกับเป้าหมายอื่นและกลับกัน; สลิปใบเบิกห้ามเป็นใบเสร็จหรือสำเนาแบบฟอร์ม; ไฟล์ของใบสำคัญจ่ายห้ามใช้นอกใบนั้น (`findAttachmentLinkConflict`) |
| การเก็บรักษา | capture evidence เก็บ `EXPENSE_CAPTURE_RETENTION_DAYS` default 90 วัน (7–3650); หลักฐานใบรับรองแทนใบเสร็จถูกล็อกไม่ให้ลบ (`SUBSTITUTE_EVIDENCE_RETENTION_LOCKED`) |

### 4.3 เลขเอกสาร (running number)

แหล่ง: `apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts`, `apps/api/src/modules/expenses/infrastructure/expense-number.ts`

| documentType | รูปแบบ default | padding | reset |
|---|---|---|---|
| `expense.record` | `EXP-{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |
| `expense.substitute_receipt` | `SRC-{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |
| `expense.disbursement_voucher` | `PV-{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |
| `reimbursement.request` | `RB-{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |
| `reimbursement.payment` | `RBPAY-{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |
| `accounting.quotation` / `.invoice` / `.billing_note` / `.receipt` / `.payment` / `.credit_note` / `.debit_note` | `QT-` / `INV-` / `BN-` / `REC-` / `PAY-` / `CN-` / `DN-` + `{YYYY}{MM}-{SEQ}` | 5 | MONTHLY |

กฎ: เลขไม่ซ้ำระดับร้าน (`@@unique([companyId, documentType, documentNumber])`); ตัวนับแยกสาขาได้เฉพาะเมื่อ template มี `{BRANCH}`; การจองเป็น idempotent ด้วย `idempotencyKey`; วงจร `RESERVED → COMMITTED` (หรือ `CANCELLED`/`VOIDED`); งวด (`periodKey`) ของรายจ่ายมาจาก**วันที่เอกสาร** ไม่ใช่วันที่บันทึก; เลขที่ออกแล้วไม่เปลี่ยนแม้ปิดสวิตช์ `EXPENSE_DRAFT_NUMBERING_ENABLED` (default `true`); ร่างที่สร้างด้วยมือบนเว็บ (`WEB_MANUAL`) ได้เลขตั้งแต่สร้าง; ร่างที่มีใบรับรองแทนใบเสร็จหรือถูกอ้างในใบเบิกจะไม่ถูกเติมเลขย้อนหลังตอน save (`canNumberReviewedDraft`); เลขที่ไม่ตรงทะเบียน → `EXPENSE_NUMBER_OWNER_CONFLICT`

### 4.4 การเข้าถึงข้ามทุกฟีเจอร์

- **Tenant**: ทุก query มี `companyId` จาก `RequestContext`
- **ขอบเขตสาขา**: `assertBranchInScope` / `isBranchInScope` ตรวจ `ctx.scopes` กับ `branchId` ของรายการ
- **Optimistic concurrency**: การแก้ร่างรายจ่ายต้องส่ง `expectedUpdatedAt` (`EXPENSE_UPDATE_VERSION_REQUIRED` / `_INVALID` / `EXPENSE_UPDATE_CONFLICT`); ใบเบิกใช้ `reimbursement_draft_changed` / `reimbursement_changed` / snapshot hash; ใบสำคัญจ่ายใช้ `version` (`disbursement_version_conflict`); คู่ค้าใช้ `counterparty_conflict`
- **Idempotency**: สร้างร่างรายจ่าย (`idempotencyKey` 8–64 ตัวอักษร a-z0-9_-), บันทึกจ่าย, คำสั่งใบสำคัญจ่าย (`commandId`), การออกเอกสารขาย, รายรับอย่างง่าย
- **Kill switch** (`expense-launch-gate.ts`): เมื่อ launch route `expenses/DEFAULT` ปิด ระบบปฏิเสธเฉพาะ "ราก" ใหม่ (สร้างร่างด้วยมือ และอัปโหลดใบเสร็จ) ด้วย `feature_temporarily_unavailable` ข้อความ "ระบบบันทึกค่าใช้จ่ายปิดปรับปรุงชั่วคราว รายการเดิมยังเปิดดูได้ตามปกติ" งานที่ค้างอยู่ (ส่งตรวจ ยืนยัน จ่าย) ทำต่อได้
- **สถานะร้าน** (`expense-commercial-access.ts`): ร้านที่ไม่ `ACTIVE`, ถูก archive, หรือ term หมด/ถูกปิด → `company_access_unavailable`; ร้านโหมดร่างฟรี → การกระทำทางการเงินทุกอย่างถูกปฏิเสธด้วย `FREE_EXPENSE_DRAFTS_ONLY`
- **Audit**: ทุกคำสั่งเขียน `AuditService.log` พร้อม `action`, `targetType`, `result`, `riskLevel` (เช่น `expense.void` = CRITICAL, `expense.reject`/`expense.payment.record` = HIGH)
- **ช่องทาง LINE**: การกระทำบางอย่างบังคับเว็บเท่านั้น ได้แก่ เปิดรายจ่ายกลับมาแก้ (`expense_correction_web_required`), ยกเลิกการจ่าย, วางลายเซ็น, ใบสำคัญจ่าย (`disbursement_line_session_denied`) และการยืนยันรายจ่ายจาก LINE ต้องผ่านเส้นทางยืนยันเฉพาะที่ตรวจ revision

---

## 5. State machines

### 5.1 รายจ่าย (`ExpenseRecord.status`)

แหล่ง: `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts:91-102` (`ALLOWED_TRANSITIONS`) และ use case ใน `application/use-cases/expense-draft.use-case.ts`

| จาก | ไป | คำสั่ง / endpoint | ผู้ทำได้ | เงื่อนไขหลัก |
|---|---|---|---|---|
| (ไม่มี) | `DRAFT` | `POST /expenses`, `POST /expenses/receipt-uploads`, capture handoff, LINE | `expense.create` หรือ `expense.receipt.upload` / `.line_upload` | launch route เปิด; ร้านไม่อยู่โหมดร่างฟรี (สำหรับร่างด้วยมือ) |
| `DRAFT` | `EXTRACTING` | ระบบ เมื่อเริ่มอ่านเอกสาร | ระบบ | มีไฟล์แนบ |
| `DRAFT`, `EXTRACTING` | `NEEDS_REVIEW` | ระบบ หลัง OCR | ระบบ | ผลอ่านต้องให้คนตรวจ |
| `DRAFT`, `EXTRACTING`, `NEEDS_REVIEW` | `READY_FOR_CONFIRMATION` | `POST :id/mark-ready` (`expense.update`, เจ้าของร่าง) หรือ `POST :id/reviewer-mark-ready` (`expense.review`) | ผู้สร้างร่าง / ผู้ตรวจ | ร่างต้นทางครบ (`assertExpenseSourceDraftComplete`); ไม่มีการจัดประเภท "ไม่ใช่รายจ่าย" ที่ยังค้าง; ระบุผู้ตรวจได้ (`requestedReviewerUserId`) ซึ่งต้องอยู่ในรายชื่อ `GET :id/reviewers` |
| `READY_FOR_CONFIRMATION` | `CONFIRMED` | `POST :id/confirm` | `expense.confirm` (เว็บ; LINE ผ่านเส้นทางยืนยันเฉพาะ) | ผ่าน `validateConfirm` ทั้งหมด (ดู FR-EXP-020) |
| `READY_FOR_CONFIRMATION` | `NEEDS_REVIEW` | แก้ร่างที่ทำให้ต้องตรวจใหม่ | ผู้ตรวจ/ระบบ | — |
| `DRAFT`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION` | `REJECTED` | `POST :id/reject` | `expense.reject` | ต้องมีเหตุผล (1–500); รายจ่ายที่เกิดจากใบเบิกที่ยังมีชีวิตปฏิเสธเดี่ยวๆ ไม่ได้ (`expense_belongs_to_reimbursement`) |
| `REJECTED` | `NEEDS_REVIEW` | `mark-ready` โดยไม่ระบุผู้ตรวจ ("เริ่มตรวจใหม่") | เจ้าของร่าง / ผู้ตรวจ | ไปได้เฉพาะ `NEEDS_REVIEW` ต้องแก้และส่งใหม่ |
| `CONFIRMED` | `NEEDS_REVIEW` | `POST :id/reopen` | `expense.confirm`, เว็บเท่านั้น | เหตุผล; ตรวจ blocker เดียวกับการยกเลิก (งวดบัญชี/ภาษีล็อก ใบรับรองภาษี ใบเตรียมจ่ายที่จอง); ยกเลิกการจ่ายและ reverse posting ที่เกี่ยวข้อง |
| `CONFIRMED` | `VOIDED` | `POST :id/void` | `expense.void` | เหตุผล ≥ 3 ตัวอักษร (`EXPENSE_VOID_REASON_MIN_LENGTH`); ผ่าน void blocker ทั้งหมด |
| `VOIDED` | — | สถานะสุดท้าย | — | — |

หมายเหตุ: การลบ (`DELETE :id`) ไม่ใช่สถานะ เป็นการลบร่างที่ยังไม่มีข้อมูลผูก (FR-EXP-025)

**สถานะย่อยที่เดินคู่กัน**
- `paymentStatus`: `UNPAID → PARTIALLY_PAID → PAID` ตามผลรวมการจ่ายที่ `RECORDED`; ยกเลิกการจ่ายทำให้ถอยกลับ; `VOIDED` เมื่อรายจ่ายถูกยกเลิก
- `postingStatus`: `CONFIRMED` และไม่ใช่ `CONFIRMED_DUPLICATE` → `pending`; อื่น ๆ → `not_required` (`derivePostingStatus`); `posted`/`posting_error`/`reversed` ตั้งโดยงานลงบัญชี (นอกขอบเขตแพ็ก)
- `duplicateStatus`: `NOT_CHECKED → NO_MATCH | POSSIBLE_DUPLICATE → OVERRIDDEN (dismiss) | CONFIRMED_DUPLICATE (confirm)`
- `extractionStatus` และ `aiVerificationStatus`: ตาม enum ในข้อ 3.2
- `inputVatClaimStatus`: ระบบตั้ง `NON_CLAIMABLE` ตอนสร้าง; เปลี่ยนได้ผ่านการตัดสินของผู้ตรวจเท่านั้น (FR-EXP-018)

### 5.2 ใบรับรองแทนใบเสร็จ (`ExpenseSubstituteReceiptEvidence.status`)

แหล่ง: `application/use-cases/substitute-receipt.use-case.ts`, `infrastructure/prisma-expense.repository.ts`

| จาก | ไป | คำสั่ง | ผู้ทำได้ | เงื่อนไข |
|---|---|---|---|---|
| (ไม่มี / ฉบับก่อน `SUPERSEDED`) | `PREPARED` | `POST :expenseId/substitute-receipt` | ผู้ถือ `expense.review` / `.confirm` / `.read*` ที่เข้าถึงรายจ่ายนั้น | รายจ่ายอยู่ใน `DRAFT`/`NEEDS_REVIEW`/`READY_FOR_CONFIRMATION`; ยังไม่มีฉบับที่มีผล; ชนิดเอกสาร/หลักฐานเข้าเกณฑ์ |
| `PREPARED` | `PREPARED` (แก้ข้อเท็จจริง) | `PATCH :expenseId/substitute-receipt/:evidenceId` | `expense.review` | ส่ง `expectedExpenseUpdatedAt` และ `expectedEvidenceUpdatedAt` |
| `PREPARED` (DIGITAL) | `PAYER_CERTIFIED` | `POST …/:evidenceId/certify` | ผู้จ่าย (`payerUserId` = ผู้เรียก) ถือ `expense.read_related` หรือ `.read_own` | ลายเซ็นของตนเอง ≤ 2 MB; snapshot hash ตรง |
| `PREPARED` (PAPER) | `PREPARED` + สแกนแนบ | `POST …/paper/upload-intent`, `…/paper/submit` | `expense.review` | ระบุผู้จ่าย/ผู้อนุมัติ วันที่ลงนาม checksum 64 hex และ `formMatchesAcknowledged = true` |
| `PAYER_CERTIFIED` | `ISSUED` | `POST …/:evidenceId/approve` | `expense.confirm` และเป็นผู้อนุมัติตามนโยบาย (`OWNER_SELF` หรืออยู่ใน `approverUserIds`) | snapshot ไม่เปลี่ยน |
| `PREPARED` (PAPER, มีสแกน) | `ISSUED` | `POST …/paper/accept` | `expense.confirm` | รับรอง 3 ข้อ (`factsAndSignatures`, `approverAuthority`, `originalRetained`) และ `previewChecksumSha256` ตรง |
| `PREPARED`, `PAYER_CERTIFIED`, `ISSUED` | `SUPERSEDED` | `POST …/:evidenceId/supersede` | `expense.review` | มีเหตุผล; ฉบับแก้ไขที่ `ISSUED` แล้วต้องออกฉบับแก้ไขใหม่แทนการยกเลิก |
| `ISSUED` | ฉบับแก้ไขใหม่ (`correctionOfEvidenceId`) | `POST …/:evidenceId/correct-document` | `expense.review` | เหตุผล + `expectedEvidenceUpdatedAt` |

โหมดลงนาม: `DIGITAL` (ลงนามในระบบ) หรือ `PAPER` (พิมพ์ ลงนามด้วยมือ สแกนกลับ) เจ้าของร้านในโหมด `OWNER_SELF` ที่มี `expense.confirm` รับรองและอนุมัติในขั้นเดียวได้ (`canCertifyAndApprove`)

### 5.3 ใบเตรียมจ่าย / ใบสำคัญจ่าย (`DisbursementVoucher.status`)

แหล่ง: `domain/logic/disbursement-voucher.logic.ts` (`disbursementVoucherActions`), `application/use-cases/disbursement-voucher.use-case.ts`

| จาก | ไป | คำสั่ง | สิทธิ์ | เงื่อนไข |
|---|---|---|---|---|
| (ไม่มี) | `DRAFT` | `POST /disbursement-vouchers` | `expense.disbursement.prepare` | 1–30 บรรทัด (`DISBURSEMENT_VOUCHER_MAX_LINES`), สาขาเดียวกัน, ไม่ซ้ำรายจ่าย, ยอดบรรทัด > 0 และไม่เกินยอดค้างจ่าย |
| `DRAFT` | `DRAFT` (แก้) / ลบ | `PUT :id`, `DELETE :id` | `prepare` | ลบได้เฉพาะใบที่ยังไม่มีเลขและ revision = 0 (`disbursement_numbered_delete`) |
| `DRAFT` | `PENDING_APPROVAL` | `POST :id/submit` | `prepare` | ออกเลข `PV-…` เมื่อส่งครั้งแรก; ผู้ที่มีทั้ง `prepare` และ `approve` ส่งและอนุมัติในคราวเดียวได้ (`submitAndApprove`, บันทึก `selfApproved = true`) |
| `PENDING_APPROVAL` | `APPROVED` | `POST :id/approve` | `expense.disbursement.approve` | แหล่งข้อมูลรายจ่ายไม่เปลี่ยน (`disbursement_source_changed`) |
| `PENDING_APPROVAL` | `DRAFT` | `POST :id/return` | `approve` และไม่ใช่ผู้จัดทำ/ผู้ส่งเอง | เหตุผล ≥ 3 ตัวอักษร |
| `PENDING_APPROVAL`, `APPROVED` | `DRAFT` | `POST :id/withdraw` | `prepare` หรือ `approve` และเป็นเจ้าของใบ (หรือเจ้าของร้านกู้คืน) | — |
| `PENDING_APPROVAL`, `APPROVED`, `DRAFT` ที่มีเลขแล้ว | `CANCELLED` | `POST :id/cancel` | เช่นเดียวกับ withdraw | เหตุผล ≥ 3 ตัวอักษร |
| `APPROVED` | `PAID` | `POST :id/pay` | `expense.disbursement.pay` | ต้องเลือกวิธีจ่าย; สร้าง `ExpensePayment` ให้ทุกบรรทัดใน transaction เดียว |
| `PAID` | `CANCELLED` (`cancelledAfterPaid = true`) | ระบบ เมื่อการจ่ายของรายจ่ายถูกยกเลิก หรือรายจ่ายถูก void/reopen | ระบบ | `cancelDisbursementVouchersForPayments` |
| (การจ่ายที่มีอยู่) | `PAID` (`origin = DIRECT_PAYMENT`) | `POST /disbursement-vouchers/from-payment` | `expense.disbursement.issue` | การจ่ายยังมีผล ไม่ใช่การจ่ายผ่านใบเบิก |
| ใบเดิม | ใบใหม่ (`origin = REISSUED`, `replacesVoucherId`) | `POST :id/reissue` | `expense.disbursement.issue` | ยังมีการจ่ายที่มีผลเหลืออยู่ในใบ |

`POST :id/remind` (สถานะ `PENDING_APPROVAL`, สิทธิ์ `prepare`) ส่งเตือนผู้อนุมัติ มี cooldown (`disbursement_reminder_cooldown`)

### 5.4 Capture group (`ExpenseCaptureGroup.status`)

| จาก | ไป | คำสั่ง | เงื่อนไข |
|---|---|---|---|
| (ไม่มี) | `OPEN` | `POST /expenses/capture-groups` หรือ `POST /expenses/:expenseId/capture-group` (แปลงรายจ่ายเดิม) | `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` (default true) |
| `OPEN` | `HANDED_OFF` | `POST …/capture-groups/:groupId/handoff` | การอ่านเสร็จ (`expense_capture_read_pending` ถ้ายังไม่เสร็จ); มีหลักฐาน (`expense_capture_no_evidence`); allocation ผ่าน |
| `OPEN` | `CLOSED_NO_HANDOFF` / `CANCELLED` | `POST …/close` เหตุผล `NO_COMPANY_PORTION` / `CANCELLED` | — |

ไฟล์ในกลุ่ม: `PENDING_UPLOAD → STORED | REJECTED`, `STORED → DETACHED` งานอ่าน: `QUEUED → PREPARING → READING → DONE | PARTIAL | PAUSED | FAILED | CANCELLED` allocation: `PREVIEW → ACCEPTED → SUPERSEDED | INVALIDATED`

### 5.5 ใบเบิก (`ReimbursementRequest.status`)

แหล่ง: `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts:585-598`

| จาก | ไป | คำสั่ง | ผู้ทำได้ | เงื่อนไข |
|---|---|---|---|---|
| (ไม่มี) | `DRAFT` | `POST /reimbursements` | `reimbursement.create` | — |
| `DRAFT` | `PENDING_APPROVAL` | `POST :id/submit` | `reimbursement.submit` และเป็นผู้เบิก (หรือ `finance_review`) | ยอด ≥ เกณฑ์อนุมัติ หรือจ่ายเข้าบัญชีบุคคลที่สาม (approval floor) |
| `DRAFT` | `FINANCE_REVIEW` | submit | เช่นเดียวกัน | ไม่ต้องอนุมัติ และนโยบายเปิดตรวจการเงิน |
| `DRAFT` | `APPROVED` แล้วระบบเลื่อนเป็น `READY_FOR_PAYMENT` | submit | เช่นเดียวกัน | ไม่ต้องอนุมัติและไม่ต้องตรวจการเงิน (audit `reimbursement.approval.auto_by_policy`; event decision `BELOW_APPROVAL_THRESHOLD`); การเลื่อนเป็น `READY_FOR_PAYMENT` เกิดหลัง "projection" สร้างรายจ่ายจากบรรทัดใบเบิกสำเร็จ |
| `PENDING_APPROVAL` | `FINANCE_REVIEW` (นโยบายเปิดตรวจการเงิน) หรือ `READY_FOR_PAYMENT` (ไม่ตรวจการเงิน; ผ่าน `APPROVED` ภายใน) | `POST :id/approve` | ผู้ถูกมอบหมายใน approval step หรือผู้ถือ role ตาม snapshot/OWNER; ถือ `reimbursement.approve` | `expectedHash` ตรงกับ snapshot (`stale_approval_snapshot`); ไม่ใช่ self-approval ที่ต้องห้าม |
| `PENDING_APPROVAL` | `REJECTED` | `POST :id/reject` | เช่นเดียวกับ approve + `reimbursement.reject` | ต้องมีเหตุผล |
| `PENDING_APPROVAL` | `DRAFT` | มีในตาราง transition | — | ไม่ได้ยืนยัน endpoint ที่เรียกเส้นทางนี้โดยตรง (ดูข้อ 15) |
| `REJECTED` | `DRAFT` | `POST :id/reopen` | `reimbursement.update_own_draft` | เจ้าของใบ |
| `APPROVED` | `FINANCE_REVIEW` / `READY_FOR_PAYMENT` | ระบบ (หลัง projection) หรือ `POST :id/resume` ("ดำเนินการต่อ" เมื่อ projection ค้าง) | ระบบ / ผู้เกี่ยวข้องตาม `pendingProjectionIntent` | ตามนโยบายที่ freeze ไว้ใน snapshot |
| `FINANCE_REVIEW` | `READY_FOR_PAYMENT` | `POST :id/finance-review` decision `APPROVED_FOR_PAYMENT` | `reimbursement.finance_review` | decision ถูกบันทึกแบบ durable ก่อน แล้วจึงทำ projection (audit `reimbursement.finance_review.decision_durable`); decision `NEEDS_INFO` (ต้องมี note) และ `BLOCKED` ไม่เปลี่ยน `status` แต่ตั้ง `financeReviewStatus` |
| `READY_FOR_PAYMENT` | `PAID` | `POST :id/payments` | `reimbursement.payment.record` | จ่ายเต็มจำนวน; ผ่าน duplicate gate; สลิปตามวิธีจ่าย |
| `READY_FOR_PAYMENT` | `PENDING_APPROVAL` | `POST :id/payout-correction` (ส่งกลับแก้บัญชีรับเงิน) | ผู้เกี่ยวข้องตาม `payoutCorrectionActions` | ระบุ reason code; เมื่อผู้เบิกตอบบัญชีใหม่ ระบบกลับเป็น `READY_FOR_PAYMENT` ทันทีถ้ายอดต่ำกว่าเกณฑ์อนุมัติ มิฉะนั้นรออนุมัติรอบใหม่ |
| `READY_FOR_PAYMENT` | `FINANCE_REVIEW` | มีในตาราง transition | — | ไม่ได้ยืนยัน endpoint ที่เรียกเส้นทางนี้โดยตรง (ดูข้อ 15) |
| `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `REJECTED` | `CANCELLED` | `POST :id/cancel` | `reimbursement.cancel_own` (เจ้าของ) หรือ `finance_review` | เหตุผลขั้นต่ำ; ถ้ามีใบรับรองภาษีต้อง attest (`reimbursement_cancellation_certificate_*`) |
| `APPROVED`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`, `PARTIALLY_PAID`, `PAID` | `VOIDED` | `POST :id/payments/:paymentId/void` และการยกเลิกหลังจ่าย | `reimbursement.payment.void` | ไม่ถูกกระทบยอดธนาคาร (`reimbursement_payment_bank_reconciled`); งวดไม่ล็อก |
| `CANCELLED`, `VOIDED` | — | สถานะสุดท้าย | — | — |

`PARTIALLY_PAID → PAID | VOIDED` มีในตารางสถานะแต่ MVP ไม่อนุญาตจ่ายบางส่วน (`partial_payment_not_allowed`) จึงเป็นเส้นทางสำหรับข้อมูลเก่า

**Approval step**: `PENDING → APPROVED | REJECTED | CANCELLED | SKIPPED | EXPIRED`; step ที่ถูกแทนที่จากการแก้บัญชีรับเงินมี `invalidatedAt` + `invalidatedReason = 'payout_account_correction'`

**Finance review**: `NOT_REQUIRED | PENDING → NEEDS_INFO | APPROVED_FOR_PAYMENT | BLOCKED`

### 5.6 เอกสารขาย (`AccountingDocument.status`) — ไม่ได้ขายในแพ็กใด

แหล่ง: `apps/api/src/modules/accounting-documents/domain/logic/accounting-status.logic.ts`

| จาก | ไป | เงื่อนไข |
|---|---|---|
| `DRAFT` | `PENDING_APPROVAL` | เฉพาะ `QUOTATION` (`submit-approval`, `accounting.quotation.submit_approval`) |
| `DRAFT` | `ISSUED` | ทุกชนิดยกเว้น `QUOTATION` (ต้องผ่านอนุมัติก่อน); ต้องมีอย่างน้อย 1 บรรทัด |
| `PENDING_APPROVAL` | `APPROVED` / `REJECTED` | `accounting.quotation.approve`; ผู้ส่งกับผู้อนุมัติต้องไม่ใช่คนเดียวกัน |
| `APPROVED` | `ISSUED` / `REJECTED` | — |
| `REJECTED` | `DRAFT` | แก้แล้วส่งใหม่ |
| `ISSUED` | `VOIDED` / `CREDITED` / `DEBITED` / `CLOSED` | void ต้อง void เอกสารลูก/ใบเสร็จที่ยังมีผลก่อน |
| `CREDITED`, `DEBITED` | `VOIDED` | — |
| `VOIDED`, `CLOSED` | — | สถานะสุดท้าย |

### 5.7 AI draft

แหล่ง: `apps/api/src/modules/ai-draft/domain/logic/ai-draft-status.logic.ts`

**AiDraftRequest**: `QUEUED → GENERATING | CANCELED | EXPIRED`; `GENERATING → READY | NEEDS_DATA | PROVIDER_UNAVAILABLE | FAILED | CANCELED`; `PROVIDER_UNAVAILABLE`, `NEEDS_DATA → QUEUED | GENERATING | CANCELED | EXPIRED`; `FAILED → QUEUED | CANCELED | EXPIRED`; `READY → EXPIRED`

**AiSuggestion**: `NEW → IN_REVIEW | ACCEPTED_FOR_SOURCE_DRAFT | DISMISSED | SUPERSEDED | EXPIRED | BLOCKED_BY_PERMISSION | BLOCKED_BY_SOURCE_STATE`; `IN_REVIEW → ACCEPTED_FOR_SOURCE_DRAFT | SOURCE_DRAFT_CREATED | DISMISSED | SUPERSEDED | EXPIRED | BLOCKED_BY_SOURCE_STATE | NEW`; `ACCEPTED_FOR_SOURCE_DRAFT → SOURCE_DRAFT_CREATED | DISMISSED | SUPERSEDED | EXPIRED | BLOCKED_BY_SOURCE_STATE`; `SOURCE_DRAFT_CREATED → SUPERSEDED | EXPIRED`; `BLOCKED_BY_PERMISSION → IN_REVIEW | EXPIRED`; `BLOCKED_BY_SOURCE_STATE → IN_REVIEW | SUPERSEDED | EXPIRED`; `FAILED → EXPIRED`; `DISMISSED`, `SUPERSEDED`, `EXPIRED` เป็นสถานะสุดท้าย

---

## 6. ข้อกำหนดเชิงหน้าที่ — expenses

**สัญลักษณ์ย่อที่ใช้ในข้อ 6–9**
- **แพ็ก S/B/P/E** = STARTER_249, BASIC_499, PRO_999, ENTERPRISE_1999 ได้ใช้ทั้งหมด (feature `expenses` หรือ `reimbursement` อยู่ใน starter preset) FREE_TRIAL_15 ใช้ได้ระหว่างช่วงทดลอง
- path ของ API ทุกตัวขึ้นต้นด้วย `/v1/companies/:companyId` (ตัดออกเพื่อความสั้น) path ของเว็บขึ้นต้นด้วย `/companies/[companyId]`
- path ไฟล์ที่ไม่ระบุ prefix อยู่ใต้ `apps/api/src/modules/expenses/`
- ทุก FR อยู่ภายใต้กฎกลางข้อ 4.4 (tenant, สาขา, สถานะร้าน, audit) โดยไม่กล่าวซ้ำ

### FR-EXP-001 สร้างร่างรายจ่ายด้วยมือ

- **คำอธิบาย** ผู้ใช้กรอกรายจ่ายเอง (ผู้ขาย วันที่ บรรทัดรายการ โหมด VAT WHT หมวด) บันทึกเป็น `DRAFT`
- **ผู้ใช้/สิทธิ์** `expense.create` (use case ยอมรับ `expense.receipt.upload` / `.line_upload` ด้วย)
- **แพ็ก** S/B/P/E
- **เงื่อนไขก่อนทำ** launch route `expenses/DEFAULT` เปิด; ร้านไม่อยู่โหมดร่างฟรี; สาขาอยู่ในขอบเขต
- **ขั้นตอนหลัก** ตรวจ idempotency key → ตรวจ launch gate → ตรวจ vendor identity → ตรวจยอดบรรทัด, `whtInput`, `vatSource` → `reconcileExpenseVat` → คำนวณ WHT → สร้าง record + บรรทัด + resolve Tax Code snapshot (`ExpenseTransactionTaxService.resolveLines`) → ตรวจ totals identity → audit `expense.create`
- **กฎธุรกิจ** `inputVatClaimStatus` ตั้งเป็น `NON_CLAIMABLE` เสมอ ผู้เรียกส่งค่านี้มาไม่ได้ (`expense_input_vat_decision_required`); `captureSource = WEB_MANUAL` ได้เลข `EXP-…` ทันที; สาขาถูก resolve จากขอบเขตผู้ใช้เมื่อไม่ระบุ; `outstandingAmount = netPayableAmount`; `whtRemittance = E_WHT` ต้องเปิดสวิตช์ร้าน; บรรทัดสูงสุด `EXPENSE_MAX_ITEM_LINES = 200`
- **การตรวจ/ข้อผิดพลาด** `Invalid draft idempotency key` (400), `EXPENSE_DRAFT_KEY_CONFLICT`, `EXPENSE_VENDOR_NAME_INVALID`, `EXPENSE_VENDOR_NAME_TOO_LONG`, `EXPENSE_VENDOR_ADDRESS_TOO_LONG`, `EXPENSE_VENDOR_BRANCH_CODE_INVALID`, `expense_wht_remittance_invalid`, `expense_e_wht_not_enabled` (422), `expense_wht_category_payee_mismatch`, `feature_temporarily_unavailable` (403), `FREE_EXPENSE_DRAFTS_ONLY` (403), ข้อความ totals identity (400)
- **ข้อมูล** `ExpenseRecord`, `ExpenseLine`, `DocumentNumber`
- **API** `POST /expenses`
- **หน้าจอ** `/expenses/manual`
- **ทดสอบ** `application/use-cases/expense-draft-amount-validation.use-case.spec.ts`, `expense-launch-gate.spec.ts`, `expense-free-access.use-case.spec.ts`, `infrastructure/expense-number.pg.spec.ts`, `e2e/manual-expense-web-entry.spec.ts`, `e2e/expense-number-save.spec.ts`

### FR-EXP-002 อัปโหลดใบเสร็จ (ไฟล์เดียว)

- **คำอธิบาย** ผู้ใช้ส่งรูปหรือ PDF ใบเสร็จ ระบบสร้างร่างพร้อมไฟล์ต้นฉบับ
- **สิทธิ์** intent: `expense.receipt.upload`; complete: `expense.receipt.upload` หรือ `expense.review`
- **แพ็ก** S/B/P/E และโหมดร่างฟรี (เฉพาะร่างของตน)
- **ขั้นตอน** `POST /expenses/receipt-uploads` (ชื่อไฟล์ ≤ 255, MIME, ขนาด, วันที่, สาขา, note ≤ 500) → server สร้างร่าง + `AttachmentObject` `PENDING_UPLOAD` + pre-signed upload → client อัปโหลด → `POST /expenses/:id/receipt-uploads/:attachmentId/complete` (checksum, ขนาด, `purpose`, `intent` = `replace`/`append`, `expectedUpdatedAt`, `expectedPrimaryAttachmentId`, `operationId` UUID) → สแกนไวรัส + ตรวจ checksum → link `expense.receipt.primary`
- **กฎ** `replace` ใช้กับใบเสร็จหลักเท่านั้น, `append` ใช้เพิ่มหลักฐานประกอบ; เก็บประวัติการแทนที่ไฟล์ล่าสุด 10 รายการ (`MAX_RECEIPT_FILE_OPERATIONS`); `operationId` ทำให้ retry ไม่ซ้ำ; กฎไฟล์ตามข้อ 4.2
- **ข้อผิดพลาด** `Unsupported expense attachment purpose.`, `Receipt checksum changed.`, `Expense changed. Reload and review before uploading again.` (409), `FREE_EXPENSE_DRAFTS_ONLY`, `CONTENT_REJECTED`, `CONTENT_UNINSPECTABLE`
- **ข้อมูล** `ExpenseRecord`, `AttachmentObject`, `AttachmentLink`
- **API** `POST /expenses/receipt-uploads`, `POST /expenses/:expenseId/receipt-uploads/:attachmentId/complete`
- **หน้าจอ** `/expenses/upload`
- **ทดสอบ** `application/use-cases/expense-upload.use-case.spec.ts`, `receipt-upload-source.pg.spec.ts`, `e2e/expenses.spec.ts`, `e2e/receipt-draft-continuity.spec.ts`

### FR-EXP-003 Capture group (รับเอกสารหลายไฟล์ต่อหนึ่งรายการ)

- **คำอธิบาย** ชุดไฟล์ที่ผู้ใช้ส่งเข้ามาด้วยกัน (หลายหน้า/หลายใบ) เป็นเจ้าของหลักฐานต้นทาง แล้วส่งมอบ (handoff) เป็นรายจ่ายหรือใบเบิก
- **สิทธิ์** สร้าง: `expense.receipt.upload` / `.line_upload` / `expense.create`; อ่าน: `expense.read` / `.read_own` / `.review`; เพิ่มไฟล์: รวม `expense.review`; detach/facts/review/accept/close: `expense.update` หรือ `expense.review`; handoff: `expense.create` / `.receipt.upload` / `.review`
- **แพ็ก** S/B/P/E
- **ขั้นตอน** สร้างกลุ่ม → เพิ่มไฟล์ (intent) → complete ไฟล์ → ระบบสร้าง `ExpenseCaptureReadJob` → worker drain อ่าน → ผู้ใช้ตรวจ/แก้ facts → ทบทวน (business use, funding route, ผู้จ่าย) → รับ allocation → handoff หรือ close
- **กฎ** capability (`GET /expenses/capture-capability`) รายงานชนิดไฟล์และ `maxBytes = UPLOAD_MAX_BYTES` ให้ client ไม่ต้อง hard-code; funding route `COMPANY`/`EMPLOYEE` ตัดสินว่า handoff ไปรายจ่ายหรือใบเบิก; allocation แบ่งส่วนบริษัท/ส่วนตัวเมื่อ `businessUse = MIXED`; การแก้ facts ใช้ revision; กลุ่มที่ handoff แล้วใช้ซ้ำไม่ได้
- **ข้อผิดพลาด** `expense_capture_group_closed`, `expense_capture_handoff_consumed`, `expense_capture_no_evidence`, `expense_capture_read_pending`, `expense_capture_facts_unavailable`, `expense_capture_review_input_invalid`, `expense_capture_allocation_blocked`, `expense_capture_payer_forbidden`, `expense_capture_payer_invalid`, `expense_capture_tax_review_forbidden`, `substitute_capture_*`
- **ข้อมูล** `ExpenseCaptureGroup`, `ExpenseCaptureFile`, `ExpenseCaptureReadJob`, `ExpenseCaptureObservation`, `ExpenseCaptureAllocation`
- **API** ดูข้อ 11.2
- **หน้าจอ** `/expenses/upload`
- **ทดสอบ** `application/use-cases/expense-capture-group.use-case.spec.ts`, `expense-capture-review.use-case.spec.ts`, `expense-capture-handoff.use-case.spec.ts`, `expense-capture.pg.spec.ts`, `expense-capture-handoff.pg.spec.ts`, `domain/logic/expense-capture-*.logic.spec.ts`, `e2e/expense-capture-intake.spec.ts`, `e2e/expense-capture-intake.evidence.spec.ts`, `e2e/journeys/staff-receipt-from-phone.journey.spec.ts`

### FR-EXP-004 อ่านเอกสารด้วย AI (OCR / extraction)

- **คำอธิบาย** ส่งไฟล์ใบเสร็จให้ AI Gateway อ่าน แล้วนำผลมาเติมร่าง (ผู้ขาย เลขที่เอกสาร วันที่ บรรทัด VAT ชนิดเอกสาร หมวดที่แนะนำ ผู้ซื้อที่พิมพ์)
- **สิทธิ์** `expense.ocr.request` หรือ `expense.review` หรือ `expense.receipt.upload`
- **แพ็ก** S/B/P/E (นับโควตาใบเสร็จของแพ็ก); โหมดร่างฟรี 3 ใบ/เดือน
- **เงื่อนไข** สถานะรายจ่ายเป็น `DRAFT` / `NEEDS_REVIEW` / `READY_FOR_CONFIRMATION` (อื่น ๆ → 409)
- **ขั้นตอน** ตรวจสิทธิ์และสถานะ → ขอ admission โควตา/งบ AI → เรียก AI Gateway ผ่าน `infrastructure/receipt-ocr.client.ts` (ERP ไม่เรียกโมเดลเอง) → `ReceiptOcrApplyService` นำผลลงร่าง → ตรวจซ้ำ → audit `expense.ocr.request`
- **กฎ** ผลลัพธ์: `ok`, `not_expense_document`, `not_configured`, `failed`; เอกสารที่ AI จัดว่าไม่ใช่รายจ่ายจะบล็อกการส่งตรวจ/ยืนยันจนผู้ตรวจ override (FR-EXP-015); ค่าที่ AI อ่านเก็บใน `aiVerifiedFieldsJson` / `aiVerificationSummaryJson` แยกจากค่าที่คนยืนยัน; หมวดที่ AI แนะนำถูก resolve กับหมวด `ACTIVE` ของร้าน (ไม่เลือก "เบ็ดเตล็ด" ให้เอง); การอ่านที่ไม่สำเร็จไม่ตัดโควตา (settle ตามผลที่ persist)
- **ข้อผิดพลาด** `receipt_quota_exceeded` (409 พร้อมข้อความโควตา), `FREE_DOCUMENTS_IN_FLIGHT`, `demo_read_limit_reached` (403), รหัสงบ AI จาก gateway (ส่งผ่าน `errorCode` + `budgetScope`), `Cannot extract receipt for expense in <status> status`
- **ข้อมูล** `ExpenseRecord` (`extractionStatus`, `aiVerificationStatus`, json fields), `ExpenseCaptureReadJob`
- **API** `POST /expenses/:expenseId/extraction-request`, `GET /expenses/:expenseId/read-status`, `POST /internal/expenses/capture-read/drain` (worker, header `x-worker-token`)
- **หน้าจอ** `/expenses/upload`, `/expenses/[expenseId]`
- **ทดสอบ** `application/use-cases/expense-extraction.use-case.spec.ts`, `application/services/receipt-ocr-apply.service.spec.ts`, `expense-capture-read-runner.service.spec.ts`, `expense-capture-read.pg.spec.ts`, `receipt-truth.pg.spec.ts`

### FR-EXP-005 สถานะการอ่านและการ poll

- **คำอธิบาย** client poll สถานะงานอ่านทุกไม่กี่วินาที endpoint อ่านเฉพาะแถวงาน ไม่เริ่มงานใหม่
- **สิทธิ์** ระดับกลุ่ม: `expense.read` / `.read_own` / `.review`; ระดับรายจ่าย: สิทธิ์อ่านใด ๆ ของรายจ่าย
- **แพ็ก** S/B/P/E และโหมดร่างฟรี
- **กฎ** worker (`apps/workers/src/modules/expense-capture-read`) เรียก drain ที่ตอบทันทีเมื่อ claim งาน ไม่รอผลอ่าน (ไฟล์หนึ่งอาจใช้เวลาหลายนาที); batch default 3; concurrency `EXPENSE_CAPTURE_READ_CONCURRENCY` default 2 (1–4)
- **API** `GET /expenses/capture-groups/:groupId/read-status`, `GET /expenses/:expenseId/read-status`
- **ทดสอบ** `application/use-cases/expense-capture-read-status.use-case.spec.ts`

### FR-EXP-006 โหมดร่างรายจ่ายฟรี และโควตา

- **คำอธิบาย** ร้านที่แพ็กทดลอง `FREE_TRIAL_15` หมดอายุและไม่เคยมีหลักฐานการซื้อใด ๆ ยังเก็บเอกสารและร่างได้ แต่ทำรายการทางการเงินไม่ได้
- **เงื่อนไขเข้าโหมด** (`system-partner-management/application/free-expense-access.ts`) tier = `FREE_TRIAL_15`, term หมดแล้ว, ไม่มี `billingReceiptAccountId`/`capacityOverride`, ร้าน `ACTIVE` หรือถูกระบบปิดเพราะ `no_package`/`term_expired`, ไม่มี billing account ที่เคยมี subscription/การจ่าย, ไม่มี invoice ที่จ่าย/คืน/โต้แย้ง, ไม่มี receipt grant ที่มีผล, ไม่มี package change request ที่ยืนยัน/จ่าย, ไม่มี sales attribution ถ้าตรวจไม่ได้ → fail closed (`FREE_EXPENSE_ACCESS_UNAVAILABLE`, 503)
- **สิทธิ์ที่เหลือ** intersect กับ `FREE_EXPENSE_PERMISSIONS`: `expense.read`, `.read_own`, `.read_related`, `.update`, `.receipt.upload`, `.receipt.line_upload`, `.ocr.request`, `attachment.read`, `attachment.create` และสิทธิ์ตั้งค่าร้านพื้นฐาน — ไม่มี review/confirm/create
- **กฎ** route ที่อนุญาตถูกระบุแบบ exact (`isFreeExpenseDraftRoute`); อ่านได้เฉพาะรายจ่ายสถานะร่างต้นทาง; แก้ได้เฉพาะร่างของตน; เลือก Tax Code ไม่ได้; โควตาอ่านฟรี `FREE_EXPENSE_MONTHLY_LIMIT = 3` เอกสาร/เดือน (`quotaSource = FREE_MONTHLY_3`) ผลอ่านเก็บแบบ `sourceOnly`
- **ข้อผิดพลาด** `FREE_EXPENSE_DRAFTS_ONLY` (403), `company_access_unavailable` (403), `receipt_quota_exceeded`
- **ทดสอบ** `application/use-cases/expense-free-access.use-case.spec.ts`

### FR-EXP-007 นโยบายการแสดงคำถามภาษี (capture policy)

- **คำอธิบาย** ตัดสินว่าฟอร์มรายจ่ายถามคำถาม VAT ไทย (Tax Code, โหมด VAT, สิทธิภาษีซื้อ) หรือไม่
- **สิทธิ์** สิทธิ์ใด ๆ ที่พาผู้ใช้มาหน้ารายจ่าย
- **กฎ** `FULL` เมื่อร้านจด VAT ณ วันที่เอกสาร หรือสถานะ `UNKNOWN` และเปิด `thai_tax`; นอกนั้น `SIMPLE`; เป็นนโยบายการแสดงผล ไม่ถูกเก็บ ไม่ใช้ตัดสินความถูกต้องทางภาษี; query `on` รับวันที่หรือ datetime (ตัดเหลือวัน) ค่าที่ไม่ใช่วันจริง → 422
- **API** `GET /expenses/capture-policy?on=`
- **ทดสอบ** `domain/logic/expense-capture-policy.logic.spec.ts`, `application/use-cases/expense-capture-policy.use-case.spec.ts`

### FR-EXP-008 รายการรายจ่าย ตัวกรอง และขอบเขตการอ่าน

- **คำอธิบาย** รายการแบบแบ่งหน้า (default `page=1`, `pageSize=20`)
- **สิทธิ์** `expense.read` / `.read_related` / `.read_own` / `.review`
- **ตัวกรอง** `status`, `branchId`, `paymentStatus`, `duplicateStatus`, `vendorCounterpartyId`, `sourceDocumentType`, `vendorAddressMissing` (เฉพาะสตริง `true`), `taxEvidenceStatus`, `expenseCategoryId`, `captureSource`, `postingStatus`, `fromDate`/`toDate` (วันที่เอกสาร), `uploadedFromDate`/`uploadedToDate`
- **กฎ** ขอบเขต: `expense.read` หรือ `.review` → ทั้งร้าน; `.read_related` → ที่เกี่ยวข้อง; `.read_own` → ที่สร้างเอง; ผู้ใช้ LINE ที่มีเพียง `expense.update` เห็นเฉพาะของตน; ค่า default ไม่รวม `REJECTED`/`VOIDED` เว้นแต่ระบุ status
- **API** `GET /expenses`
- **หน้าจอ** `/expenses`
- **ทดสอบ** `application/use-cases/expense-related-access.use-case.spec.ts`, `expense-branch-scope.use-case.spec.ts`, `infrastructure/prisma-expense.repository.branch.spec.ts`, `prisma-expense.repository.vendor-address-filter.spec.ts`, `e2e/expenses.spec.ts`, `e2e/branch-scope.spec.ts`

### FR-EXP-009 รายละเอียดรายจ่าย

- **คำอธิบาย** อ่านรายจ่ายพร้อมบรรทัด ไฟล์แนบ การจ่าย หลักฐานแทนใบเสร็จ และข้อมูลประกอบการตัดสินใจ
- **สิทธิ์** `expense.read` / `.read_related` / `.read_own` / `.create` / `.review` / `.confirm` / `.receipt.upload` / `.receipt.line_upload`
- **กฎ** response เพิ่ม `inputVatRight`, `reviewRequest`, ประวัติการแก้ไข (correction history), `sourceDraft`, `correctionCapabilities` และตัดฟิลด์ภายใน (`sourceChannelMetadataJson`, `lineMessageId`, `lineEventId`, `buyerAsPrintedJson`) ออก; `totalsIdentity` รายงานว่ายอดหัวกับบรรทัดตรงกันหรือไม่
- **API** `GET /expenses/:expenseId`, `GET /expenses/:expenseId/source-posting-input` (`expense.read`, เฉพาะ `CONFIRMED`/`VOIDED`)
- **หน้าจอ** `/expenses/[expenseId]`
- **ทดสอบ** `application/use-cases/expense-related-access.use-case.spec.ts`, `infrastructure/prisma-expense.repository.posting-source.spec.ts`

### FR-EXP-010 แก้ร่างรายจ่าย

- **คำอธิบาย** แก้หัวและบรรทัดของรายจ่ายที่ยังไม่ยืนยัน
- **สิทธิ์** route: `expense.update` / `.review` / `.create` / `.receipt.upload` / `.receipt.line_upload`; use case ตัดสินว่าแต่ละสิทธิ์แก้อะไรได้
- **เงื่อนไข** สถานะ `DRAFT`/`EXTRACTING`/`NEEDS_REVIEW`/`READY_FOR_CONFIRMATION`; ส่ง `expectedUpdatedAt`
- **กฎ** ฟิลด์เฉพาะผู้ตรวจ (`expense.review`): `sourceDocumentType`, `sourceDocumentLanguage`, `taxEvidenceStatus`, `taxEvidenceReasonCode`, `inputVatClaimStatus`, `whtRemittance`, `expenseCategoryId`, `accountHintKey`, `taxCategory`, `nonExpenseClassificationOverride`, `documentReviewAcknowledged`, `evidenceAssessment`; ผู้ไม่ใช่ผู้ตรวจแก้ได้เฉพาะร่างที่ตนสร้าง; ใบเสร็จ/ใบรับรองแทน/เอกสารประกอบห้ามมี Tax Code และห้ามขอภาษีซื้อ; `sourceDraft` ต้องส่งเดี่ยวพร้อม `expectedUpdatedAt`; การลบแถวที่ staged จากใบเสร็จทำได้เฉพาะผู้ตรวจ; identity ของบรรทัดต้องอยู่ในร่างนั้น; รายจ่ายที่มีใบรับรองแทนใบเสร็จถูกล็อกบรรทัด/หัว (`substitute_evidence_locks_expense`, `_locks_lines`, `_doc_type_locked`)
- **ข้อผิดพลาด** `EXPENSE_UPDATE_VERSION_REQUIRED`, `EXPENSE_UPDATE_VERSION_INVALID`, `EXPENSE_UPDATE_CONFLICT` (409), `EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED`, `EXPENSE_SOURCE_DRAFT_INVALID`, `EXPENSE_SOURCE_DRAFT_INCOMPLETE`, `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, `EXPENSE_DOCUMENT_REVIEW_INCOMPLETE`, `EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED`, `EXPENSE_PURPOSE_TEXT_INVALID`, `expense_input_vat_decision_required`, `Cannot update expense in status <status>`
- **ข้อมูล** `ExpenseRecord`, `ExpenseLine`; ประวัติ diff เก็บใน audit metadata `expenseHistoryChanges`
- **API** `PATCH /expenses/:expenseId`, `PATCH /expenses/:expenseId/review-fields` (ผู้ไม่มี `expense.review` ถูกส่งไปเส้นทางแก้เฉพาะข้อมูลใบรับรองของตน)
- **หน้าจอ** `/expenses/[expenseId]`
- **ทดสอบ** `application/use-cases/expense-draft-concurrency.use-case.spec.ts`, `expense-draft-vat-decouple.use-case.spec.ts`, `expense-draft-ai-missing-fields.use-case.spec.ts`, `expense-vendor-address.use-case.spec.ts`, `expense-source-draft.pg.spec.ts`, `presentation/http/expense.dtos.spec.ts`

### FR-EXP-011 พรีวิวยอดรวม

- **คำอธิบาย** คำนวณยอดจากข้อมูลในฟอร์มด้วยกฎเดียวกับการบันทึก โดยไม่เขียนลงฐานข้อมูล
- **สิทธิ์** `expense.update` หรือ `expense.review`
- **กฎ** DTO `ExpenseTotalsPreviewDto` รับเฉพาะฟิลด์ของฟอร์มตรวจ ปฏิเสธฟิลด์ที่ server เป็นเจ้าของ; ต้องมีอย่างน้อย 1 บรรทัด; `removedSourceItemRefs` ไม่เกิน 200
- **API** `POST /expenses/:expenseId/totals-preview`
- **ทดสอบ** `presentation/http/expense.dtos.spec.ts`, `domain/logic/expense-totals.logic.spec.ts`

### FR-EXP-012 หมวดค่าใช้จ่าย

- **คำอธิบาย** หมวดของร้าน ใช้จัดกลุ่มรายจ่ายและ map ไปบัญชี
- **สิทธิ์** อ่าน: สิทธิ์อ่าน/สร้าง/อัปโหลดรายจ่ายใด ๆ; จัดการ: `expense.category.manage`
- **กฎ** ระบบ bootstrap หมวด default (`application/services/expense-category-bootstrap.service.ts`): ค่ารับรอง, ค่าเช่าสำนักงานและสถานที่, ค่าขนส่ง, ค่าธรรมเนียมธนาคาร, ค่าใช้จ่ายเบ็ดเตล็ด, ค่าบริการวิชาชีพ, ค่าซ่อมแซมและบำรุงรักษา, ค่าโฆษณาและการตลาด, ค่าเดินทางและยานพาหนะ, ค่าอาหารและเครื่องดื่ม, ค่าสาธารณูปโภค, ค่าเครื่องเขียนและวัสดุสิ้นเปลือง (แต่ละหมวดมี `accountHintKey` เช่น `expense.rent`); ชื่อหมวดห้ามซ้ำ (P2002 → 409); หมวด default ของระบบแก้ไม่ได้; สถานะ `ACTIVE`/`ARCHIVED`; AI ไม่เลือกหมวด `expense.miscellaneous` ให้
- **ข้อผิดพลาด** `Category name is required`, `accountHintKey is required`, `Category name already exists: <name>` (409), `Category not found or is a read-only system default` (404)
- **ข้อมูล** `ExpenseCategory`
- **API** `GET /expense-categories`, `GET /expense-categories/manage`, `POST /expense-categories`, `PATCH /expense-categories/:categoryId`
- **หน้าจอ** `/expenses/categories`
- **ทดสอบ** `application/services/expense-category-bootstrap.service.spec.ts`, `application/use-cases/expense-document.use-case.spec.ts`

### FR-EXP-013 รหัสบัญชีของนักบัญชีต่อหมวด

- **คำอธิบาย** ผูกรหัส/ชื่อบัญชีที่นักบัญชีภายนอกใช้เข้ากับหมวด เพื่อใช้ในไฟล์ส่งออก
- **สิทธิ์** `expense.category.manage`
- **กฎ** `accountCode` 1–20 ตัวอักษร, `accountName` 1–120; ห้ามขึ้นต้นด้วย `=`, `+`, `-`, `@` และห้ามมีอักขระควบคุม (ป้องกัน CSV/formula injection)
- **ข้อผิดพลาด** `expense_category_account_unmapped` (เมื่อส่งออกแล้วหมวดยังไม่ผูก)
- **ข้อมูล** `ExpenseCategoryAccountantAccount`
- **API** `PUT /expense-categories/:categoryId/accountant-account`, `DELETE /expense-categories/:categoryId/accountant-account`
- **หน้าจอ** `/expenses/categories`

### FR-EXP-014 ลบใบเสร็จ/หลักฐานออกจากรายจ่าย

- **สิทธิ์** `expense.update` หรือ `expense.review`
- **กฎ** ระบุ `purpose` (`expense.receipt.primary` / `.supporting` / `expense.payment.evidence` / `expense.review.evidence`) และ `expectedUpdatedAt`; ถูกล็อกเมื่อรายจ่ายพ้นช่วงแก้ไขหรือหลักฐานถูกใช้อ้างอิง
- **ข้อผิดพลาด** `expense_receipt_removal_locked`, `SUBSTITUTE_EVIDENCE_RETENTION_LOCKED`
- **API** `DELETE /expenses/:expenseId/receipts/:attachmentId` (204)
- **ทดสอบ** `application/use-cases/remove-expense-receipt.use-case.spec.ts`

### FR-EXP-015 Override การจัดประเภท "ไม่ใช่เอกสารรายจ่าย"

- **คำอธิบาย** เมื่อ AI จัดเอกสารว่าไม่ใช่รายจ่าย ผู้ตรวจต้องเลือกชนิดเอกสารและรับทราบพร้อมเหตุผลก่อนเดินต่อ
- **สิทธิ์** `expense.review`
- **กฎ** ต้องมีการจัดประเภทที่ยังค้าง; ต้องเลือก `sourceDocumentType` ที่เป็นรายจ่าย; `acknowledged = true`; เหตุผล 1–500; ถ้าผลจัดประเภทเปลี่ยนต้องรันใหม่
- **ข้อผิดพลาด** `No unresolved non-expense classification to override.`, `Classification override acknowledgement is required.`, `Classification override reason is required and must not exceed 500 characters.`, `Re-run document classification before overriding this expense.`
- **API** `POST /expenses/:expenseId/non-expense-classification-override`

### FR-EXP-016 รับทราบส่วนต่างยอดรวมกับ OCR

- **สิทธิ์** `expense.review`
- **กฎ** ใช้เมื่อ `|ยอดรวม − ยอด OCR| > 0.05`; การรับทราบผูกกับยอด ณ ขณะนั้น (`acknowledgedTotalAmount` เทียบที่ 4 ตำแหน่ง); ไม่ใช้ `reviewedAt` เป็นหลักฐานการรับทราบ; เหตุผล 1–500
- **ข้อผิดพลาด** `OCR total acknowledgement is required.`, `No OCR grand total difference to acknowledge.`, `The acknowledged amount no longer matches this expense. Reload and review the total again.`
- **API** `POST /expenses/:expenseId/ocr-total-acknowledgement`
- **ทดสอบ** `domain/logic/expense-status.logic.spec.ts`

### FR-EXP-017 ตรวจและจัดการรายการซ้ำ

- **คำอธิบาย** ให้คะแนนความซ้ำกับรายจ่ายอื่นและเปิด candidate ให้คนตัดสิน
- **สิทธิ์** ตรวจ: `expense.review`; ตัดสิน: `expense.duplicate.resolve`
- **กฎ** (`domain/logic/expense-duplicate.logic.ts`) คะแนน: checksum เดียวกัน +40, perceptual hash ห่าง ≤ 6 (`MAX_PERCEPTUAL_HASH_DISTANCE`) +35, เกณฑ์ผู้ขาย/เลขเอกสาร/ยอด/วันที่ +30/+25/+20; ทุกคู่ที่คะแนน > 0 กลายเป็น candidate `OPEN` (คะแนนใช้จัดลำดับ ไม่ใช่ gate); `POSSIBLE_DUPLICATE` เป็นเพียงคำเตือน ยืนยันรายจ่ายได้; `CONFIRMED_DUPLICATE` (คนยืนยันว่าซ้ำ) ห้ามยืนยันรายจ่าย; เหตุผลตัดสิน 3–500 ตัวอักษร
- **ข้อผิดพลาด** `Duplicate resolution reason must be at least 3 characters`, `…at most 500 characters`, `Expense is marked as a duplicate. Clear the duplicate mark before confirming.`
- **ข้อมูล** `ExpenseDuplicateCandidate`
- **API** `POST /expenses/:expenseId/duplicate-check`, `POST …/duplicates/:candidateId/dismiss`, `POST …/duplicates/:candidateId/confirm`
- **ทดสอบ** `domain/logic/expense-duplicate.logic.spec.ts`, `application/services/expense-duplicate-detection.spec.ts`, `infrastructure/prisma-expense.repository.duplicate-resolve.spec.ts`

### FR-EXP-018 สิทธิภาษีซื้อ (input VAT right)

- **คำอธิบาย** ผู้ตรวจตัดสินว่ารายจ่ายใช้ VAT ตอนยื่นภาษีได้หรือไม่ พร้อมบันทึกเงื่อนไขที่ใช้ตัดสิน
- **สิทธิ์** `expense.review`
- **กฎ** (`infrastructure/expense-input-vat-decision.ts`)
  - กรณีตายตัวที่เปลี่ยนไม่ได้ (`input_vat_fixed`): ร้านไม่จด VAT ณ วันที่เอกสาร, เอกสารไม่มี VAT, ใบกำกับภาษีอย่างย่อ, ไม่ใช่ใบกำกับภาษี, หรือหลักฐานเป็นใบรับรองแทน/หลักฐานทดแทน
  - เงื่อนไขที่ระบบตรวจเอง: `SHOP_REGISTERED`, `CLAIMABLE_TYPE`, `PAPER_ATTACHED`, `SELLER_TAX_ID` (13 หลัก), `DOCUMENT_NUMBER`, `USABLE_EVIDENCE` (`taxEvidenceStatus = USABLE_FOR_TAX`), `BUYER_MATCH` (ชื่อ/เลขผู้ซื้อที่พิมพ์ตรงกับทะเบียนร้าน หรือผู้ตรวจยืนยัน) และเงื่อนไขที่ผู้ตรวจติ๊ก (`INPUT_VAT_REVIEWER_CONDITIONS`)
  - เลือก `NON_CLAIMABLE` หรือเปลี่ยนคำตัดสินเดิม ต้องมีเหตุผล (≤ 500)
  - งวด ภ.พ.30 ของเดือนเอกสารต้องยังไม่ล็อก; รายจ่าย `VOIDED`/`REJECTED` ตัดสินไม่ได้; journal ที่ post แล้วเปลี่ยนไม่ได้
  - ชนิดเอกสารที่ขอภาษีซื้อได้: `TAX_INVOICE`, `CUSTOMS_VAT_RECEIPT`, `PP36_RECEIPT` (`CLAIMABLE_INPUT_VAT_DOCUMENT_TYPES`)
- **ข้อผิดพลาด** `input_vat_fixed`, `input_vat_conditions_required`, `input_vat_reason_required`, `input_vat_company_registration_unanswered`, `input_vat_attachment_required`, `input_vat_seller_tax_id_required`, `input_vat_document_number_required`, `input_vat_usable_evidence_required`, `input_vat_company_identity_required`, `input_vat_expense_closed`, `input_vat_no_vat_to_claim`, `input_vat_posted_journal_immutable`, `input_vat_not_available_company_not_vat_registered`, `tax_period_locked`
- **ข้อมูล** `ExpenseInputVatDecision`, `ExpenseRecord.inputVatClaimStatus`, `buyerAsPrintedJson`
- **API** `POST /expenses/:expenseId/input-vat-decision`, `POST /expenses/:expenseId/buyer-match/confirm` (`expense.confirm`, ต้องมีเหตุผล)
- **หน้าจอ** `/expenses/[expenseId]` (`ExpenseInputVatRight.tsx`)
- **ทดสอบ** `domain/logic/buyer-as-printed.logic.spec.ts`, `domain/logic/expense-status.logic.spec.ts`, `e2e/journeys/expense-input-vat-right.journey.spec.ts`

### FR-EXP-019 ส่งให้ตรวจ (mark ready) และรายชื่อผู้ตรวจ

- **สิทธิ์** เจ้าของร่าง: `expense.update` (`mark-ready`); ผู้ตรวจ: `expense.review` (`reviewer-mark-ready`); รายชื่อผู้ตรวจ: `expense.update` หรือ `.review`
- **กฎ** ปลายทาง `READY_FOR_CONFIRMATION` ยกเว้นรายจ่าย `REJECTED` ที่ไม่ระบุผู้ตรวจ → `NEEDS_REVIEW`; ระบุ `requestedReviewerUserId` ได้ ต้องเป็นผู้ที่ยืนยันรายจ่ายของสาขานั้นได้; ระบบแจ้งเตือนผู้ตรวจที่ถูกระบุเท่านั้น (trigger `expense.review_requested`, web only); เรียกซ้ำกับผู้ตรวจเดิมเป็น no-op
- **ข้อผิดพลาด** `expense_reviewer_ineligible`, `expense_source_version_changed` (409), ข้อความ non-expense classification, `Cannot transition from <a> to <b>.`
- **API** `GET /expenses/:expenseId/reviewers`, `POST …/mark-ready`, `POST …/reviewer-mark-ready`
- **หน้าจอ** `/expenses/[expenseId]` (`ExpenseReviewRequestDialog.tsx`, `ExpenseReviewSubmitActions.tsx`)

### FR-EXP-020 ยืนยันรายจ่าย

- **คำอธิบาย** ทำให้รายจ่ายเป็นทางการ (`CONFIRMED`) ล็อกข้อมูลเงิน/ภาษี และ finalize ภาษีของเอกสาร
- **สิทธิ์** `expense.confirm`
- **เงื่อนไขก่อนทำ** สถานะ `READY_FOR_CONFIRMATION`
- **กฎตรวจ** (`validateConfirm` และ use case)
  1. ไม่ใช่ `CONFIRMED_DUPLICATE`
  2. มีใบเสร็จหลัก หรือเหตุผลไม่มีใบเสร็จ หรือหลักฐานจากใบเบิก หรือหลักฐานที่ผู้ตรวจประเมินแล้ว; ไม่มีใบเสร็จต้องมีสิทธิ์การเงิน
  3. มีวันที่เอกสาร
  4. ยอดรวม > 0
  5. มี WHT ต้องมีประเภทผู้รับเงินและหมวดเงินได้
  6. ส่วนต่างยอดกับ OCR > 0.05 ต้องรับทราบแล้ว
  7. ร่างต้นทางครบ; ไม่มี non-expense classification ค้าง
  8. หลักฐานภาษีซื้อในประเทศ: ต้องเป็นเอกสารชนิดที่ขอได้ + `USABLE_FOR_TAX` + มีไฟล์ + เลขผู้เสียภาษีผู้ขาย + เลขที่เอกสาร
  9. ทุกบรรทัดที่มี VAT ต้องมี Tax Code snapshot ที่ server resolve
  10. โหมดที่มี VAT ห้ามมีบรรทัดไม่มีอัตรา (ข้อความระบุเลขบรรทัด)
  11. ส่วนต่าง VAT เกิน tolerance ต้องส่ง `vatSourceOverride { reason, vatLineNumber, expectedUpdatedAt }`
  12. หลักฐานแทนภายในต้องเป็น `SUPPORTING_ONLY` และไม่ขอภาษีซื้อ
- **ผลลัพธ์** ออกเลข `EXP-…` ถ้ายังไม่มี; `postingStatus = pending` (หรือ `not_required`); audit `tax.document_tax.finalize`; ผูก/สร้างคู่ค้าฝั่ง vendor อัตโนมัติ (FR-EXP-072)
- **ข้อผิดพลาด** ข้อความจาก `validateConfirm`, `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, `EXPENSE_VAT_OVERRIDE_INVALID`, `EXPENSE_VAT_OVERRIDE_STALE` (409), `EXPENSE_VAT_RECONCILIATION_REQUIRED`, `EXPENSE_VAT_TAX_RATE_CONFLICT`, `EXPENSE_VAT_TAX_TOLERANCE_REQUIRED`, `expense_confirmation_source_version_changed` (409), `Expense confirmation is available on the authenticated web only.` (403 สำหรับ LINE นอกเส้นทางยืนยันเฉพาะ)
- **API** `POST /expenses/:expenseId/confirm`
- **หน้าจอ** `/expenses/[expenseId]`
- **ทดสอบ** `domain/logic/expense-status.logic.spec.ts`, `infrastructure/prisma-expense.repository.atomic-confirm.spec.ts`, `prisma-expense.repository.tax-snapshot.spec.ts`, `application/services/expense-transaction-tax.service.spec.ts`, `application/use-cases/expense-vendor-counterparty-autosave.use-case.spec.ts`

### FR-EXP-021 ส่งกลับ/ไม่อนุมัติ (reject)

- **สิทธิ์** `expense.reject`
- **กฎ** เหตุผลบังคับ (1–500); บันทึก `rejectedByUserId`, `rejectedAt`, `rejectReason`; ยกเลิก tax event ที่ผูก; รายจ่ายที่เกิดจากใบเบิกที่ยังมีชีวิตต้องจบพร้อมใบเบิก
- **ข้อผิดพลาด** `expense_belongs_to_reimbursement`, `Cannot transition from <a> to REJECTED.`, `expense_correction_source_changed` (409)
- **API** `POST /expenses/:expenseId/reject`

### FR-EXP-022 เปิดรายจ่ายที่ยืนยันแล้วกลับมาแก้ (reopen)

- **สิทธิ์** `expense.confirm`; เว็บเท่านั้น
- **กฎ** `CONFIRMED → NEEDS_REVIEW`; เหตุผลบังคับ; ใช้ blocker ชุดเดียวกับ void (FR-EXP-023); ถ้ามีหนังสือรับรองภาษีผูกอยู่ต้องส่ง `taxFilingAttested = true`; ยกเลิกการจ่ายและใบสำคัญจ่ายที่ `PAID` ของการจ่ายนั้น (`cancelledAfterPaid`); audit `expense.reopen`
- **ข้อผิดพลาด** `expense_correction_web_required`, `expense_correction_not_found`, `expense_correction_branch_forbidden`, `expense_correction_permission_missing`, `expense_correction_blocked`, `expense_correction_source_changed`, `expense_certificate_attestation_required`, `certificate_issued`, `certificate_permission_missing`
- **API** `POST /expenses/:expenseId/reopen`
- **หน้าจอ** `/expenses/[expenseId]` (`ExpenseCertificateReopen.tsx`, `ExpenseDisbursementReopenNotice.tsx`)
- **ทดสอบ** `e2e/journeys/paid-expense-reopened.journey.spec.ts`

### FR-EXP-023 ยกเลิกรายจ่าย (void)

- **สิทธิ์** `expense.void`
- **กฎ** เฉพาะ `CONFIRMED`; เหตุผล ≥ 3 ตัวอักษร; blocker (`infrastructure/expense-void-blocker.ts`): ถูกจองในใบเตรียมจ่าย (`expense_disbursement_reserved`), posting ยังไม่จบ (`posting_unresolved`), งวดบัญชีล็อก (`accounting_period_locked`), งวดภาษีล็อก (`tax_period_locked` แยกข้อความ PND3/PND53/PP30), มีหนังสือรับรองภาษีใน tax workspace (`certificate_issued`), รายจ่ายของใบเบิก (`expense_belongs_to_reimbursement`), สถานะการเงินไม่เข้าเกณฑ์ (`expense_not_voidable`); ถ้ามีหนังสือรับรองบนรายจ่ายต้อง attest; ทำ true reversal ของ journal (เมื่อมี), ยกเลิกการจ่าย, ยกเลิกใบสำคัญจ่ายที่เกี่ยวข้อง, mark เลขเอกสาร; audit `expense.void` ระดับ CRITICAL; serialization failure → 409 ให้ลองใหม่
- **ข้อผิดพลาด** `expense_void_reason_required`, `expense_void_permission_missing`, `expense_void_number_unavailable` (422), `expense_changed`, `expense_changed_retry`, `expense_stale_reload`, `posting_state_changed` และ blocker ข้างต้น
- **API** `POST /expenses/:expenseId/void`
- **หน้าจอ** `/expenses/[expenseId]` (`ExpenseCertificateVoidDialog.tsx`)
- **ทดสอบ** `infrastructure/prisma-expense.repository.void.spec.ts`, `application/use-cases/void-expense-true-reversal.use-case.spec.ts`

### FR-EXP-024 ประวัติกิจกรรมของรายจ่าย

- **คำอธิบาย** แสดงลำดับเหตุการณ์และ diff ก่อน/หลังต่อฟิลด์
- **สิทธิ์** เท่ากับการอ่านรายละเอียด
- **กฎ** diff คำนวณจาก snapshot ในฐานข้อมูลภายใต้ lock หลังบันทึก (`domain/logic/expense-history.logic.ts`); ฟิลด์หัว 29 ตัว และฟิลด์บรรทัด 14 ตัว (`lines.<n>.<field>`); ตัวเลขแสดงแบบ canonical; เปิดเผยเฉพาะรูปแบบ `expenseHistoryChanges` ส่วน audit เก่าแสดงเฉพาะชื่อ action; แบ่งหน้าด้วย `page` (จำนวนเต็ม ≥ 1)
- **ข้อผิดพลาด** `Invalid expense history page`
- **API** `GET /expenses/:expenseId/history?page=`
- **หน้าจอ** `ExpenseHistoryModal.tsx`

### FR-EXP-025 ลบร่างรายจ่าย

- **สิทธิ์** `expense.delete` (ในขอบเขต) หรือ `expense.update` (เฉพาะร่างของตน)
- **กฎ** ลบได้เฉพาะรายการที่ยังไม่เป็นทางการและไม่มีข้อมูลผูก (การจ่าย ใบเบิก ใบสำคัญจ่าย ประวัติที่ต้องเก็บ หลักฐานแทนใบเสร็จ); การลบจัดการ duplicate candidate ที่เหลือและ workflow ที่อ้างถึง; การปฏิเสธถูก audit ด้วย `result: 'DENIED'`
- **ข้อผิดพลาด** `EXPENSE_NOT_DELETABLE` (409), `EXPENSE_HAS_LINKED_DATA` (409, มี `blocker`), `EXPENSE_CHANGED_DURING_DELETE` (409), `SUBSTITUTE_EVIDENCE_RETENTION_LOCKED` (409), `EXPENSE_DRAFT_DELETED`
- **API** `DELETE /expenses/:expenseId` (204)
- **ทดสอบ** `application/use-cases/delete-expense.use-case.spec.ts`

### FR-EXP-026 บันทึกการจ่ายเงินรายจ่าย

- **สิทธิ์** `expense.payment.record`
- **เงื่อนไข** รายจ่าย `CONFIRMED`; ไม่ใช่รายจ่ายของใบเบิก; มีสาขา
- **กฎ** `paidAmount` ต้องตรง pattern เงินบวก (`POSITIVE_ACCOUNTING_MONEY_PATTERN`); ไม่เกินยอดค้าง; `paidAt` เป็น civil date ไม่เกินวันนี้ตามเวลา Asia/Bangkok; `idempotencyKey` 8–64 ตัว; `bankAccountRef` ≤ 128; แนบสลิปได้ (`slipAttachmentId`); e-WHT จำกัดวิธีจ่าย; replay ของการจ่ายที่ถูกยกเลิกแล้วถูกปฏิเสธ; ปรับ `paidAmount`, `outstandingAmount`, `paymentStatus`; audit `expense.payment.record` (HIGH)
- **ข้อผิดพลาด** `expense_payment_not_confirmed`, `expense_settled_via_reimbursement` (422), `claim_expense_settles_via_reimbursement`, `expense_payment_invalid_key`, `expense_payment_invalid_date`, `expense_payment_future_date`, `expense_payment_invalid_method`, `expense_payment_invalid_reference`, `expense_payment_exceeds_outstanding`, `expense_paid_exceeds_payable`, `expense_payment_idempotency_conflict`, `expense_payment_cancelled_replay` (409), `expense_payment_slip_invalid`, `expense_ewht_payment_method`, `expense_ewht_cash_payment_exists`, `expense_disbursement_reserved`
- **ข้อมูล** `ExpensePayment`, `ExpenseRecord`
- **API** `POST /expenses/:expenseId/payment`, `POST …/payments/slip-upload-intent`, `POST …/payments/slip-uploads/:attachmentId/complete`
- **หน้าจอ** `/expenses/[expenseId]`
- **ทดสอบ** `application/use-cases/record-expense-payment.use-case.spec.ts`, `infrastructure/prisma-expense.repository.payment.spec.ts`

### FR-EXP-027 ยกเลิกการจ่าย และยืนยันวันที่จ่าย

- **สิทธิ์** `expense.payment.record`; ยกเลิกทำได้บนเว็บเท่านั้น
- **กฎ** ยกเลิกต้องมีเหตุผล; `ExpensePayment.status = VOIDED`; ใบสำคัญจ่ายที่ครอบการจ่ายนั้นถูกยกเลิก; `confirm-date` ใช้กับการจ่ายเก่าที่วันที่ถูกคัดลอกจากวันที่เอกสาร (idempotency key ขึ้นต้น `client:seed-payment-`) ให้ผู้ใช้ยืนยันวันที่จริง
- **ข้อผิดพลาด** `expense_payment_already_cancelled`, `expense_payment_changed`, `expense_payment_correction_blocked`, `expense_payment_date_already_confirmed`, `expense_payment_invalid_date`
- **API** `POST /expenses/:expenseId/payments/:paymentId/cancel`, `POST …/payments/:paymentId/confirm-date`
- **หน้าจอ** `PaymentDateConfirmation.tsx`

### FR-EXP-028 ใบสำคัญรับเงิน (payment voucher PDF)

- **คำอธิบาย** สร้าง PDF "ใบสำคัญรับเงิน" ให้ผู้รับเงินลงนาม ใช้เมื่อผู้ขายไม่มีใบเสร็จให้
- **สิทธิ์** `expense.read` / `.read_related` / `.read_own` / `.review`
- **กฎ** (`domain/logic/payment-voucher.logic.ts`) query `paymentDate`, `payeeName`, `payeeAddress`, `payeeTaxId` แทนค่าที่พิมพ์ได้; แบบฟอร์มมีช่อง ข้าพเจ้า ที่อยู่ เลขประจำตัว ได้รับเงินจาก (ชื่อร้าน) เป็นค่า จำนวนเงินเป็นตัวเลขและตัวอักษรไทย (`thaiBahtText`) วันที่แบบ พ.ศ. และช่องลงชื่อผู้รับเงิน/ผู้จ่ายเงิน; response `Cache-Control: private, no-store`; ชื่อไฟล์ไทยส่งแบบ RFC 5987
- **API** `GET /expenses/:expenseId/payment-voucher.pdf`
- **ทดสอบ** `domain/logic/payment-voucher.logic.spec.ts`

### FR-EXP-029 ใบเตรียมจ่าย: จัดทำและแก้ไข

- **คำอธิบาย** รวมรายจ่ายที่ยืนยันแล้วและค้างจ่ายของผู้รับเงินรายเดียวกันเป็นเอกสารขออนุมัติจ่าย
- **สิทธิ์** `expense.disbursement.prepare`
- **กฎ** 1–30 บรรทัด; สาขาเดียวกัน; ห้ามซ้ำรายจ่าย; ยอดบรรทัด > 0 และ ≤ ยอดค้างจ่าย; ผู้รับเงินจัดกลุ่มด้วยเลขผู้เสียภาษีหรือชื่อ (`payeeBasis` = `SINGLE`/`TAX_ID`/`SAME_NAME`/`PREPARER_CONFIRMED`) ถ้าชื่อ/เลขไม่ตรงกันผู้จัดทำต้องยืนยัน; รายจ่ายที่อยู่ในใบที่ยังมีผลถูก "จอง" บันทึกจ่ายตรงไม่ได้; บัญชีผู้รับเงิน: เลขบัญชีตัวเลข 6–20 หลัก ต้องระบุธนาคาร เก็บเข้ารหัสและแสดงเฉพาะ 4 ตัวท้าย; e-WHT จำกัดวิธีจ่ายที่วางแผน
- **ข้อผิดพลาด** `disbursement_invalid_input`, `disbursement_lines_required`, `disbursement_too_many_lines`, `disbursement_duplicate_expense`, `disbursement_expense_unreadable`, `disbursement_branch_mismatch`, `disbursement_payee_confirmation_required`, `disbursement_amount_invalid`, `disbursement_total_overflow`, `disbursement_version_conflict`, `disbursement_not_draft`, `disbursement_numbered_delete`, `disbursement_command_conflict`, `disbursement_expense_reserved`, `disbursement_account_number_invalid`, `disbursement_account_bank_required`, `disbursement_account_source_denied`, `disbursement_account_source_mismatch`, `disbursement_ewht_planned_method`
- **ข้อมูล** `DisbursementVoucher`, `DisbursementVoucherLine`, `DisbursementVoucherCommand`
- **API** `GET /disbursement-vouchers/payees`, `GET …/payable-expenses`, `GET …/payee-account`, `GET …/approvers`, `POST /disbursement-vouchers`, `PUT …/:id`, `DELETE …/:id`, `GET /disbursement-vouchers`, `GET …/:id`
- **หน้าจอ** `/expenses/disbursement-vouchers`, `/expenses/disbursement-vouchers/new`, `/expenses/disbursement-vouchers/[id]`
- **ทดสอบ** `e2e/journeys/voucher-supporting-files.journey.spec.ts` (ไม่พบ unit spec เฉพาะของ `disbursement-voucher.use-case.ts` ในโมดูล — ดูข้อ 15)

### FR-EXP-030 ใบเตรียมจ่าย: ส่ง อนุมัติ ส่งกลับ ถอน ยกเลิก เตือน

- **สิทธิ์** ตามตาราง 5.3
- **กฎ** ผู้อนุมัติส่งกลับใบที่ตนจัดทำ/ส่งเองไม่ได้; ถอน/ยกเลิกใบของผู้อื่นไม่ได้ เว้นแต่เจ้าของร้านกู้คืนเมื่อผู้จัดทำไม่ active; อนุมัติใบของตนเองได้เมื่อมีทั้งสองสิทธิ์ และถูกบันทึก `selfApproved`; ลายเซ็นของผู้จัดทำ/ผู้อนุมัติ/ผู้จ่ายถูก snapshot พร้อม checksum; เหตุผลส่งกลับ/ยกเลิก ≥ 3 ตัวอักษร; ถ้ารายจ่ายต้นทางเปลี่ยน (hash ของสถานะ สาขา ยอด ผู้ขาย) ใบถูกส่งกลับให้แก้; การเตือนมี cooldown ต่อผู้อนุมัติ; ทุกรอบเก็บใน `DisbursementVoucherRevision`
- **ข้อผิดพลาด** `disbursement_permission_denied` (403), `disbursement_status_changed` (409), `disbursement_approver_ineligible`, `disbursement_return_reason_required`, `disbursement_cancel_reason_required`, `disbursement_source_changed`, `disbursement_reminder_cooldown`, `disbursement_changed_retry`, `disbursement_line_session_denied`, `disbursement_not_found`
- **API** `POST /disbursement-vouchers/:id/submit`, `/approve`, `/return`, `/withdraw`, `/cancel`, `/remind`

### FR-EXP-031 ใบสำคัญจ่าย: บันทึกจ่าย ออกจากการจ่ายเดิม ออกใบแทน และ PDF

- **สิทธิ์** จ่าย: `expense.disbursement.pay`; ออกจากการจ่ายเดิม/ออกใบแทน: `expense.disbursement.issue`; อ่าน PDF: `expense.disbursement.read`
- **กฎ** `pay` บันทึก `ExpensePayment` ทุกบรรทัดใน transaction เดียว (ล้มทั้งหมดถ้าบรรทัดใดล้ม: `disbursement_payment_retry`); ต้องเลือกวิธีจ่าย; PDF สร้างหลังจ่าย (`disbursement_file_pending` ระหว่างจัดทำ, `disbursement_file_unavailable` ถ้าสร้างไม่ได้โดยการจ่ายและเลขยังอยู่); พิมพ์ไม่ได้ถ้ายังไม่ส่งอนุมัติ; `from-payment` ออกใบสำหรับการจ่ายที่บันทึกตรง; `reissue` ออกใบใหม่แทนใบที่ถูกยกเลิกหลังจ่ายเมื่อยังมีการจ่ายที่มีผล
- **ข้อผิดพลาด** `disbursement_payment_method_required`, `disbursement_payment_source_changed`, `disbursement_payment_key_conflict`, `disbursement_print_unsubmitted`, `disbursement_signature_unavailable`, `disbursement_issue_claim`, `disbursement_issue_payment_cancelled`, `disbursement_issue_payment_not_found`, `disbursement_reissue_empty`, `disbursement_account_missing`
- **API** `POST /disbursement-vouchers/:id/pay`, `POST /disbursement-vouchers/from-payment`, `POST …/:id/reissue`, `GET …/:id/document.pdf`, `POST …/:id/payee-account/reveal`
- **หน้าจอ** `/expenses/disbursement-vouchers/[id]`, และการ์ดในหน้ารายจ่าย (`ExpenseDisbursementVoucher.tsx`, `ExpenseDisbursementCancellation.tsx`)

### FR-EXP-032 ใบสำคัญจ่าย: ไฟล์ประกอบและหลักฐานการจ่าย

- **สิทธิ์** ไฟล์ประกอบ: `prepare`; สลิป: `pay`; อ่าน: `read`
- **กฎ** PDF/รูป ≤ 10 MB; ไฟล์ประกอบแก้ได้เฉพาะก่อนใบถูก freeze (`disbursement_supporting_frozen`); สลิปแนบได้เมื่ออนุมัติแล้ว/จ่ายแล้ว (`disbursement_slip_status`); ไฟล์ต้องอัปโหลดเพื่อใบนั้นโดยเฉพาะ (upload tag) และใช้กับเอกสารอื่นไม่ได้; ดาวน์โหลดได้เฉพาะจากใบที่เป็นเจ้าของ ไม่ผ่าน endpoint ดาวน์โหลดทั่วไป
- **ข้อผิดพลาด** `disbursement_supporting_frozen`, `_missing`, `_invalid`, `_not_owned`, `disbursement_slip_missing`, `_invalid`, `_not_owned`, `_status`, `disbursement_file_link_outside`, `disbursement_slip_link_conflict`, `disbursement_file_general_download_denied`, `disbursement_file_retained`
- **API** `GET /disbursement-vouchers/:id/supporting-files`, `POST …/supporting-files/slip-upload-intent`, `POST …/supporting-files/slip-uploads/:attachmentId/complete`, `POST …/supporting-files`, `DELETE …/supporting-files/:attachmentId`, `GET …/supporting-files/:attachmentId`, `POST …/slip-upload-intent`, `POST …/slip-uploads/:attachmentId/complete`, `POST …/slip`, `GET …/slip`
- **ทดสอบ** `e2e/journeys/voucher-supporting-files.journey.spec.ts`

### FR-EXP-033 ใบรับรองแทนใบเสร็จรับเงิน: จัดเตรียมและแก้ไข

- **คำอธิบาย** เอกสาร "ใบรับรองแทนใบเสร็จรับเงิน" สำหรับรายจ่ายที่ไม่มีใบเสร็จ/ใบเสร็จไม่สมบูรณ์
- **สิทธิ์** จัดเตรียม: `expense.review` / `.confirm` / `.read` / `.read_related` / `.read_own` ที่เข้าถึงรายจ่ายได้; แก้ไข/แก้เอกสาร/ยกเลิก: `expense.review`
- **กฎ** เหตุผล (`reasonCode`): `PAYEE_CANNOT_ISSUE`, `RECEIPT_UNAVAILABLE`, `RECEIPT_MATERIALLY_INCOMPLETE`, `OTHER`; ต้องมีผู้รับเงิน เหตุผลที่ไม่มีใบเสร็จ (≤ 500) วัตถุประสงค์ทางธุรกิจ (≤ 500) วันที่จ่าย วิธีจ่าย; ชื่อผู้รับ ≤ 200, ที่อยู่ ≤ 300; แหล่งเงิน `COMPANY` หรือ `PERSONAL_ADVANCE` และต้องเป็นการจ่ายเต็มจำนวน; วันที่/วิธีจ่ายต้องตรงกับการจ่ายที่บันทึกแล้ว; หลักฐานแทนเป็น `SUPPORTING_ONLY` และไม่ขอภาษีซื้อได้; เลข `SRC-{YYYY}{MM}-{SEQ}`; ใบเสร็จที่ใช้ได้ปกติต้องไปเส้นทางปกติ; นโยบายเงินสด (`cashEvidencePolicy`) กำหนดว่าต้องแนบหลักฐานการจ่ายแยกหรือไม่; จำกัดจำนวนบรรทัดและความยาวคำอธิบายที่พิมพ์
- **ข้อผิดพลาด** `substitute_facts_incomplete`, `substitute_funding_source_required`, `substitute_full_payment_required`, `substitute_existing_payment_details_mismatch`, `substitute_receipt_ewht_payment_method`, `substitute_payment_evidence_invalid`, `substitute_payment_month_confirmation_required`, `substitute_personal_settles_via_reimbursement`, `substitute_source_has_live_claim`, `substitute_evidence_overlap`, `substitute_evidence_idempotency_conflict`, `substitute_evidence_stale`, `substitute_evidence_unavailable`, `substitute_evidence_expense_confirmed`, `substitute_evidence_nonclaimable`, `substitute_expense_changed`, `substitute_edit_requires_cancellation`, `substitute_receipt_too_many_lines`, `substitute_receipt_line_description_too_long`, `valid_receipt_normal_path`, `classification_ineligible`, `document_kind_ineligible`, `source_type_ineligible`, `expense_status_ineligible`, `tax_evidence_nonclaimable`, `tax_evidence_review_required`, `reviewed_category_required`, `reviewed_items_required`, `reviewed_total_required`, `check_bill_route_required`, `check_bill_route_ineligible`
- **ข้อมูล** `ExpenseSubstituteReceiptEvidence` (snapshot + `canonicalSnapshotHash`), `DocumentNumber`
- **API** `POST /expenses/:expenseId/substitute-receipt`, `PATCH …/substitute-receipt/:evidenceId`, `POST …/:evidenceId/correct-document`, `POST …/:evidenceId/supersede`, `POST …/substitute-receipt/evidence-upload`, `POST …/evidence-upload/:attachmentId/complete`, `GET …/substitute-receipt/payers`, `GET …/substitute-receipt/history`
- **หน้าจอ** `/expenses/substitute-receipts/new`, `/expenses/substitute-receipts/[evidenceId]`
- **ทดสอบ** `application/use-cases/substitute-receipt.use-case.spec.ts`, `substitute-receipt-capture.use-case.spec.ts`, `substitute-receipt-payer-access.use-case.spec.ts`, `domain/logic/substitute-receipt.logic.spec.ts`, `infrastructure/substitute-expense-edit.pg.spec.ts`, `substitute-funding.pg.spec.ts`, `prisma-expense.repository.substitute-number.spec.ts`, `prisma-expense.repository.substitute-payment.spec.ts`, `e2e/journeys/no-receipt-certificate.journey.spec.ts`, `e2e/substitute-editable-navigation.spec.ts`, `e2e/substitute-cancelled-view-only.spec.ts`

### FR-EXP-034 ใบรับรองแทนใบเสร็จ: ลงนามดิจิทัลและอนุมัติ

- **สิทธิ์** ผู้จ่ายรับรอง: `expense.read_related` หรือ `.read_own` และเป็น `payerUserId`; อนุมัติ: `expense.confirm` และเป็นผู้อนุมัติตามนโยบาย
- **กฎ** ผู้จ่ายพรีวิวก่อนรับรอง (`preview`); ลายเซ็นต้องเป็นของผู้ลงนามเอง (ลายเซ็นที่บันทึกไว้ หรืออัปโหลดเฉพาะครั้ง); ข้อความรับรองสร้างจากชื่อและตำแหน่ง; artifact ที่รับรองแล้วมี checksum ถ้าไม่ตรงตอนอนุมัติ → `substitute_certified_artifact_checksum_mismatch`; เจ้าของร้านในโหมด `OWNER_SELF` รับรองและอนุมัติได้ในขั้นเดียว
- **API** `POST …/:evidenceId/preview`, `POST …/:evidenceId/certify`, `POST …/:evidenceId/signature-upload-intent`, `POST …/:evidenceId/signature-uploads/:attachmentId/complete`, `POST …/:evidenceId/approve`
- **ทดสอบ** `substitute-receipt-signature-queue.use-case.spec.ts`, `substitute-receipt-signature-queue.pg.spec.ts`

### FR-EXP-035 ใบรับรองแทนใบเสร็จ: ลงนามบนกระดาษ

- **สิทธิ์** อัปโหลด/ส่ง: `expense.review`; พรีวิว: `expense.review` หรือ `.confirm`; รับ: `expense.confirm`
- **กฎ** ดาวน์โหลดแบบฟอร์มเปล่า (`form.pdf`) สร้างจาก snapshot `PREPARED` ตามคำขอ ไม่ถูกเก็บและไม่นับว่า "ออก"; ส่งสแกนพร้อมชื่อ/ตำแหน่ง/วันที่ลงนามของผู้จ่ายและผู้อนุมัติ, ธง `samePerson`, checksum, `formMatchesAcknowledged`; ระบบแนบ "หน้ารับรองโดยระบบ (แนบท้ายฟอร์มที่ลงนามด้วยมือ)"; ผู้รับต้องยืนยัน 3 ข้อ
- **ข้อผิดพลาด** `substitute_wet_signed_scan_checksum_mismatch`, `substitute_wet_signed_scan_not_linkable`, `substitute_wet_signed_scan_not_renderable`
- **API** `GET …/:evidenceId/form.pdf`, `POST …/paper/upload-intent`, `POST …/paper/submit`, `POST …/paper/preview`, `POST …/paper/accept`
- **หน้าจอ** `SubstitutePaperSigningPanel.tsx`

### FR-EXP-036 ใบรับรองแทนใบเสร็จ: รายการ ไฟล์ที่ออก และพิมพ์ฉบับยกเลิก

- **สิทธิ์** `expense.review` / `.confirm` / `.read` / `.read_related` / `.read_own`
- **กฎ** รายการระดับร้านกรอง `status`, `yearMonth` (YYYY-MM), `payerUserId`, `order` (`newest`/`oldest`), แบ่งหน้า; `candidates` คือรายจ่ายที่จัดทำใบรับรองได้ (ค้นหา, `includeBlocked`); ดาวน์โหลด artifact PDF ของฉบับ `ISSUED`; ฉบับที่ถูกยกเลิก (`SUPERSEDED`) ยังพิมพ์ได้โดยมีตราสถานะ และฉบับที่ยังไม่ออกพิมพ์พร้อมตรา `AWAITING REVIEW` / `AWAITING APPROVAL`; การแก้เอกสารที่ออกแล้วสร้างฉบับแก้ไขที่อ้าง `correctionOfEvidenceId`
- **ข้อผิดพลาด** `substitute_print_artifact_unavailable`, `substitute_print_history_unavailable`
- **API** `GET /substitute-receipts`, `GET /substitute-receipts/candidates`, `GET /substitute-receipts/:evidenceId/expense`, `GET /expenses/:expenseId/substitute-receipt/:evidenceId/artifact.pdf`, `GET …/artifact-preview`
- **หน้าจอ** `/expenses/substitute-receipts`
- **ทดสอบ** `application/use-cases/substitute-receipt-download.use-case.spec.ts`, `domain/logic/substitute-receipt-pdf.logic.spec.ts`

### FR-EXP-037 นโยบายใบรับรองแทนใบเสร็จของร้าน

- **สิทธิ์** อ่าน/แก้: `company.setup.manage`; runtime: สิทธิ์อ่านรายจ่ายใด ๆ
- **กฎ** `approvalMode`: `OWNER_SELF` (default) หรือ `DESIGNATED_APPROVERS` (1–20 คน ไม่ซ้ำ ต้องเป็นผู้มีสิทธิ์); `cashEvidencePolicy` default `ALLOW_SUPPORTING_EVIDENCE_ONLY`; `cashEvidenceInstructions` ≤ 500; `ready` = โหมด owner หรือมีผู้อนุมัติอย่างน้อย 1; runtime บอกว่าผู้เรียกมีลายเซ็นที่ใช้ซ้ำได้หรือไม่ พร้อม URL พรีวิว
- **ข้อผิดพลาด** `Invalid approvalMode.`, `Select between 1 and 20 authorized approvers.`, `Approver users must be unique.`, `cashEvidenceInstructions must be at most 500 characters.`
- **ข้อมูล** `ExpenseSubstituteReceiptPolicy`
- **API** `GET /expense-settings/substitute-receipt`, `GET /expense-settings/substitute-receipt/runtime`, `PATCH /expense-settings/substitute-receipt`
- **หน้าจอ** `/settings/substitute-receipt`
- **ทดสอบ** `application/use-cases/substitute-receipt-policy.use-case.spec.ts`

### FR-EXP-038 ลายเซ็นประจำตัว

- **สิทธิ์** ตัวใดตัวหนึ่งใน `SIGNATURE_OWNER_PERMISSIONS` = `expense.signature.self_manage`, `expense.review`, `expense.confirm`, `expense.signature.manage`; ทุก use case บังคับขอบเขตเจ้าของ
- **กฎ** PNG/JPEG ≤ 2 MB; ลายเซ็น `ACTIVE` ตั้งแต่สร้างและเป็นของผู้ส่ง ลายเซ็น active เดิมถูกเลิกใช้ใน transaction เดียวกัน; เก็บต้นฉบับ และรับ PNG ที่ลบพื้นหลังจาก web canvas เป็น derived asset; archive ได้เฉพาะของตน; รูปเสิร์ฟผ่าน API same-origin (เลี่ยง ORB ของ Chrome); body สร้าง command ทีละ field ไม่ spread เพื่อกันการส่ง `attachmentAlreadyActive` / `lineMessageId` จากเว็บ; การวางลายเซ็นบนเอกสาร (`signature-fill`) ใช้ได้เฉพาะเว็บ ลายเซ็น `ACTIVE` ของตนเอง
- **ข้อผิดพลาด** `Signature images must be PNG or JPEG`, ข้อความขนาดเกิน 2 MB, `Signature belongs to another owner.`, `You can only archive your own signature`, `Signature fill is a web-only action`, `Only ACTIVE signatures can be filled into documents`
- **ข้อมูล** `CompanySignatureAsset`, `SignatureFillRecord`
- **API** `GET /expense-signatures`, `GET /expense-signatures/images/:attachmentId`, `POST /expense-signatures/uploads`, `POST /expense-signatures`, `POST /expense-signatures/:signatureId/archive`, `POST /expense-signatures/:signatureId/derived`, `POST /expenses/:expenseId/signature-fill`
- **หน้าจอ** `/expenses/signatures`

### FR-EXP-039 หลักฐานทางบัญชี (shared evidence view)

- **สิทธิ์** `expense.evidence.read` (use case ยอมรับ `expense.export`)
- **กฎ** กรอง `branchId`, `dateField` (`expenseDate` default / `uploadedAt`), `fromDate`/`toDate`, `yearMonth`, `status`, `sourceDocumentType`, `taxEvidenceStatus`, `expenseCategoryId`, `paymentStatus`, `postingStatus`, `createdByUserId`, แบ่งหน้า; ไม่เปิดในโหมดร่างฟรี
- **API** `GET /expenses/shared-evidence`
- **หน้าจอ** `/expenses/evidence`

### FR-EXP-040 ชุดส่งนักบัญชี (accountant package)

- **คำอธิบาย** ส่งออกรายการรายจ่ายเป็น workbook และ zip หลักฐาน
- **สิทธิ์** `expense.export` และ `expense.read`
- **กฎ** เลือกด้วย `expenseIds` (≤ 10,000) หรือตัวกรองเดียวกับ FR-EXP-039; `columnSet` `summary`/`full`; `format` `csv`; `pageSize` ≤ 500; workbook `รายจ่าย-<ร้าน>-<ช่วง>.xlsx` มีแผ่นรายการ การจ่าย ภาษีหัก ณ ที่จ่าย และไฟล์ (คอลัมน์ตาม `ACCOUNTANT_WORKBOOK_COLUMNS`, `ACCOUNTANT_PAYMENT_SHEET_COLUMNS`, `ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS`, `ACCOUNTANT_FILES_SHEET_COLUMNS`); zip หลักฐานแบ่งชุดละไม่เกิน 60 ไฟล์ (`EVIDENCE_BUNDLE_MAX_FILES`) และ 60 MB (`EVIDENCE_BUNDLE_MAX_BYTES`) ไฟล์เดี่ยวที่ใหญ่เกินเดินทางคนเดียว; แต่ละ zip มี `สารบัญ.xlsx`; ชื่อ `หลักฐาน-<ร้าน>-<ช่วง>[-ชุดที่-n].zip`; ไฟล์แต่ละตัวยังผ่าน gate สิทธิ์อ่านไฟล์แนบ; workbook สูงสุด 20 MB (`XLSX_LIMIT`)
- **API** `POST /expenses/accountant-package`, `POST /expenses/accountant-package/bundle-plan`, `POST /expenses/accountant-package/bundle/:part`
- **หน้าจอ** `/expenses/evidence` (`EvidenceBundleDownload.tsx`, `AccountingExportControls.tsx`)
- **ทดสอบ** `domain/logic/expense-export.logic.spec.ts`, `infrastructure/expense-evidence-sources.spec.ts`

### FR-EXP-041 ส่งออกเข้าโปรแกรมบัญชี (สมุดรายวันซื้อ)

- **สิทธิ์** `expense.export`
- **กฎ** preset เดียว `purchase_journal`; ส่งออกเฉพาะรายจ่าย `CONFIRMED`; รายการที่ส่งออกไม่ได้ถูกแยกพร้อมเหตุผล (`ACCOUNTING_EXPORT_EXCLUSION_REASONS` เช่น `foreign_currency`, `not_confirmed`, `vat_not_representable`); ต้องผูกรหัสบัญชีของหมวด (FR-EXP-013); ไฟล์ `สมุดรายวันซื้อ-<ร้าน>-<ช่วง>.xlsx`
- **ข้อผิดพลาด** `accounting_export_confirmed_only` (422), `expense_category_account_unmapped`, `currency_not_supported`
- **API** `POST /expenses/accounting-software-export`
- **ทดสอบ** `domain/logic/expense-export.logic.spec.ts`

### FR-EXP-042 สวิตช์ e-WHT ของร้าน

- **สิทธิ์** อ่าน: สิทธิ์รายจ่ายใด ๆ หรือ `company.setup.manage`; แก้: `company.setup.manage`
- **กฎ** body `{ used: boolean }`; เมื่อปิด ผู้ใช้เลือกวิธีนำส่ง `E_WHT` ใหม่ไม่ได้ แต่รายการที่เก็บ `E_WHT` ไว้แล้วคงค่าได้ (`eWhtRemittanceAllowed`)
- **API** `GET /expense-settings/e-wht`, `PATCH /expense-settings/e-wht`
- **หน้าจอ** `/settings/e-wht`

### FR-EXP-043 หมวดเงินได้ WHT สำหรับฟอร์มรายจ่าย

- **สิทธิ์** `expense.create`
- **กฎ** คืนรายการหมวดเงินได้ที่ `ACTIVE` พร้อม `filingRoute` (default `SYSTEM_FILLS`); ใช้ catalog เดียวกับฝั่ง AP
- **API** `GET /expenses/wht-income-categories`

### FR-EXP-044 จุดเชื่อมหนังสือรับรอง 50 ทวิ (ENTERPRISE_1999)

- **คำอธิบาย** หน้า `/expenses/wht-certificates` และปุ่มออกหนังสือรับรองบนรายจ่าย ใช้ข้อมูล WHT ของรายจ่ายที่ยืนยันแล้ว
- **แพ็ก** ENTERPRISE_1999 เท่านั้น (`wht_50bis`, `wht_pnd53`)
- **กฎฝั่งรายจ่าย** รายจ่ายที่มีหนังสือรับรองออกแล้ว void/reopen ต้อง attest และบางกรณีถูกบล็อก (`certificate_issued`); รายละเอียดการออกเอกสารอยู่ในเอกสาร AREA ภาษี
- **หน้าจอ** `/expenses/wht-certificates` (`WhtCertificatesPage.tsx`, `WhtIssueButton.tsx`)

### FR-EXP-045 การรับรายจ่ายจาก LINE (ส่วนที่อยู่ในโมดูล expenses)

- **คำอธิบาย** use case ที่ AI Gateway / โมดูล line-ai เรียกผ่าน API ที่ตรวจสิทธิ์ ได้แก่ รับรูปจาก LINE (`expense-capture-line.use-case.ts`), สนทนาเติมร่าง (`line-expense-draft-conversation.use-case.ts`), แก้ร่าง (`line-draft-update.use-case.ts`), แก้ไขรายการ (`line-correction.use-case.ts`), ผูกหลักฐานการจ่าย (`link-line-payment-evidence.use-case.ts`), ต่อเนื่องใบรับรองแทนใบเสร็จ (`line-substitute-receipt-continuation.use-case.ts`)
- **สิทธิ์** `expense.receipt.line_upload` และสิทธิ์ของผู้ใช้ที่ผูก LINE; จำกัดเฉพาะผู้ส่งต้นทางและแชตเดิม
- **กฎ** ผู้ใช้ LINE แก้ได้เฉพาะฟิลด์ที่อนุญาตของร่างตนเอง; continuation ที่ล้าสมัยถูกปฏิเสธ; เว็บโหลด continuation ของ LINE ได้ด้วย `expense.review`
- **ข้อผิดพลาด** `LINE_RECEIPT_CONTINUATION_STALE`, `LINE_SUBSTITUTE_CONTINUATION_STALE`
- **API (เว็บ)** `GET /expenses/:expenseId/substitute-receipt/continuations/:workflowId`
- **ทดสอบ** `application/use-cases/line-draft-update.security.spec.ts`, `line-expense-draft-conversation.use-case.spec.ts`, `line-substitute-receipt-continuation.use-case.spec.ts`, `line-correction.use-case.spec.ts`, `line-draft-update.pg.spec.ts`
- **หมายเหตุ** พฤติกรรมของผู้ช่วย AI เอง (routing, ข้อความตอบ) อยู่ในเอกสาร AREA LINE/AI

---

## 7. ข้อกำหนดเชิงหน้าที่ — reimbursements

path ไฟล์ที่ไม่ระบุ prefix อยู่ใต้ `apps/api/src/modules/reimbursements/` ทุก controller ของ `/reimbursements` และ `/reimbursement-policy` ติด `ReimbursementWriteQuiesceGuard` (NFR-EXP-08)

### FR-EXP-050 สร้างและแก้ร่างใบเบิก

- **คำอธิบาย** พนักงานขอเบิกเงินที่สำรองจ่าย โดยกรอกบรรทัดรายการ แนบใบเสร็จหรืออ้างรายจ่ายที่มีอยู่
- **สิทธิ์** สร้าง: `reimbursement.create`; แก้: `reimbursement.update_own_draft` (เจ้าของ) หรือ `reimbursement.finance_review`
- **แพ็ก** S/B/P/E
- **กฎ** `reason` บังคับ (≤ 1000); `title` ≤ 200; 1–50 บรรทัด; ต่อบรรทัด: `lineNo` 1–50, `incurredDate` (วันที่จริง ไม่เป็นอนาคต), `description` (≤ 500), `categoryKey` (≤ 80), `amount` > 0, หลักฐาน = `attachmentId` หรือ `linkedExpenseId`; ยอดใบ = ผลรวมบรรทัด; จัดทำแทนสมาชิกคนอื่นต้องมีสิทธิ์ (`requesterUserId`); แก้ได้เฉพาะ `DRAFT`; idempotency ผ่าน header key; ใบเสร็จ/รายจ่ายเดียวกันห้ามอยู่ใน 2 ใบเบิกที่ยังมีชีวิต; หลักฐานต้องอยู่สาขาเดียวกับใบ
- **ข้อผิดพลาด** `reason_required`, `lines_required`, `line_description_required`, `line_category_required`, `line_incurred_date_required`, `line_amount_required`, `line_amount_must_be_positive`, `amount_must_be_positive`, `Only draft requests can be edited`, `Cannot prepare a reimbursement for another member`, `Cannot update this reimbursement`, `Invalid idempotency key`, `reimbursement_draft_changed` (409), `REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH`, `reimbursement_source_changed`
- **ข้อมูล** `ReimbursementRequest`, `ReimbursementLine`
- **API** `POST /reimbursements`, `PATCH /reimbursements/:requestId`, `GET /reimbursements/source-options`
- **หน้าจอ** `/reimbursements/new`, `/reimbursements/[requestId]/edit`
- **ทดสอบ** `application/use-cases/reimbursement-request.use-case.spec.ts`, `domain/logic/reimbursement.logic.spec.ts`, `presentation/http/reimbursement.dtos.spec.ts`, `infrastructure/prisma-reimbursement.repository.atomic-lines.spec.ts`, `infrastructure/reimbursement-source.spec.ts`, `e2e/reimbursements.spec.ts`, `e2e/reimbursement-receipt.spec.ts`

### FR-EXP-051 รายการ ฮับ สรุป และรายละเอียดใบเบิก

- **สิทธิ์** รายการ/สรุป: `reimbursement.read` / `.read_related` / `.read_own`; ฮับและรายละเอียด: route ใช้ `account.session.read` แล้ว use case ตัดสินว่าผู้เรียกเป็นผู้เบิก ผู้อนุมัติ ผู้ตรวจการเงิน ผู้จ่าย หรือมีสิทธิ์อ่าน
- **กฎ** ฮับรวมงานที่รอผู้เรียกทำตาม "โต๊ะ" ปัจจุบันของใบ (`currentDesk`); รายการกรองด้วย bucket (ค่าไม่ถูกต้อง → `reimbursement_list_bucket_invalid`); รายละเอียดคืนสถานะ ขั้นอนุมัติ การจ่าย ลายเซ็น สำเนาที่ลงนาม ปลายทางรับเงิน (ปิดบังเลขบัญชี) ประวัติการแก้บัญชี และ flag การกระทำที่ผู้เรียกทำได้; ผู้ถือ `reimbursement.read` (สิทธิ์อ่านใบเบิก) เห็นใบที่รออนุมัติด้วย
- **ข้อผิดพลาด** `Cannot read this reimbursement` (403), `Reimbursement request not found` (404), `Missing permission to read reimbursements`
- **API** `GET /reimbursements`, `GET /reimbursements/hub`, `GET /reimbursements/summary`, `GET /reimbursements/:requestId`
- **หน้าจอ** `/reimbursements`, `/reimbursements/[requestId]` (`ReimbursementJourneyPage.tsx`, `ReimbursementDetailSections.tsx`)
- **ทดสอบ** `application/use-cases/reimbursement-related-access.use-case.spec.ts`, `reimbursement-branch-scope.use-case.spec.ts`

### FR-EXP-052 ส่งใบเบิก

- **สิทธิ์** `reimbursement.submit` และเป็นผู้เบิก (หรือ `reimbursement.finance_review`)
- **เงื่อนไข** สถานะ `DRAFT`; นโยบาย `ACTIVE`
- **ขั้นตอน** ตรวจบรรทัด → ตรวจหลักฐาน → ตรวจ receipt requirement → ตรวจหลักฐานไม่ถูกใช้ในใบอื่น → ตรวจซ้ำ → วางแผนปลายทางรับเงิน → ตัดสินว่าต้องมีคนอนุมัติหรือไม่ → หาเส้นทางผู้อนุมัติ → freeze policy snapshot และ snapshot hash → ออกเลข `RB-{YYYY}{MM}-{SEQ}` → สร้าง approval step → แจ้งเตือนเฉพาะผู้เกี่ยวข้อง
- **กฎ**
  - ต้องอนุมัติเมื่อ `amount ≥ approvalRequiredFromAmount` (default `1.00`) **หรือ** ปลายทางเป็นการโอนเข้าบัญชีบุคคลที่สาม (`approvalFloor = THIRD_PARTY_PAYOUT`)
  - receipt gate: ทุกบรรทัดมีหลักฐาน หรือมีเหตุผลระดับใบเมื่อนโยบายอนุญาต (`allowMissingReceiptWithReason`)
  - duplicate: ตรวจทุกครั้ง; บล็อกการส่งเฉพาะนโยบาย `BLOCK_SUBMIT`
  - ปลายทางรับเงิน: ใบที่โอนต้องมีบัญชีครบ; ใบที่ไม่ระบุใช้บัญชี default ของผู้เบิก; ระบบไม่เลือกแทนผู้เบิกที่ยังไม่เลือก; ผู้ส่งต้องส่ง `payoutSubmitToken` ของรายละเอียดที่เห็น ถ้าปลายทางเปลี่ยน → `payout_destination_changed`
  - policy snapshot (`ReimbursementPolicySnapshotV1`, `schemaVersion: 1`) ถูก freeze และเป็นส่วนหนึ่งของ hash; snapshot ที่ผิดรูป fail closed (`invalid_reimbursement_policy_snapshot`)
  - บรรทัดที่อ้างรายจ่ายต้องมี `sourceExpenseSnapshot` (ถ้าไม่มี → `reimbursement_source_review_required`)
- **ข้อผิดพลาด** `Cannot submit from status <status>` (422), `Only the requester can submit this request`, `reimbursement_policy_inactive`, `missing_receipt_reason_required`, `duplicate_unresolved` (422 พร้อม `duplicatePhase: 'SUBMIT'`, `duplicateReasons`), `payout_destination_changed`, `reimbursement_source_version_changed` (409), `reimbursement_source_review_required`, `reimbursement_approver_not_ready`, `reimbursement_document_number_unavailable`
- **API** `POST /reimbursements/:requestId/submit`
- **ทดสอบ** `application/use-cases/reimbursement-request.use-case.spec.ts`, `infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts`

### FR-EXP-053 เส้นทางผู้อนุมัติ และผู้อนุมัติหลายบทบาท

- **คำอธิบาย** ตัดสินว่าใครอนุมัติใบเบิกได้
- **กฎ** (`application/use-cases/reimbursement-policy.use-case.ts`, `domain/logic/reimbursement.logic.ts`)
  - นโยบายเก็บ `defaultApproverRoles` (1–20 role key, ตัวแรกคือ `roleKey` หลัก); default `['MANAGER']`
  - โหมด `CUSTOM_USER` + `defaultApproverUserId` ใช้ผู้ใช้ที่ระบุ ถ้าใช้ไม่ได้ fallback ไป role
  - ผู้ถือ role ใด role หนึ่งในรายการอนุมัติได้ ("any of several roles"); `OWNER` ผ่านเสมอ (`matchesApproverRole`)
  - ผู้ถูกมอบหมายถูก freeze ใน approval step: ผู้ที่ถูกมอบหมายและยัง active เท่านั้นที่อนุมัติได้ (`ASSIGNED`); การแก้ role หลังส่งไม่ถอนสิทธิ์ผู้ถูกมอบหมาย; เมื่อผู้ถูกมอบหมายทุกคนออก/ถูกปิด จึงใช้กฎ role/OWNER (`FALLBACK`); คนอื่น → `DENIED`
  - ถ้าไม่มีใครใน role ระบบใช้เจ้าของร้านแทน (`ownerFallbackUsedAtSubmission`)
  - snapshot ของใบที่ส่งแล้วเก็บเฉพาะ role แรก (`route.roleKey`) — นโยบายปัจจุบันเท่านั้นที่ถือหลาย role
- **ข้อผิดพลาด** `approver_role_required`, `approver_role_not_eligible`, `reimbursement_approver_not_ready`, `not_eligible_approver` (403)
- **API** `GET /reimbursement-policy/approver-options` (`reimbursement.policy.manage`), `GET /reimbursements/approval-queue`
- **ทดสอบ** `application/use-cases/reimbursement-approval.use-case.spec.ts`, `reimbursement-approval-backlog.use-case.spec.ts`

### FR-EXP-054 อนุมัติ / ปฏิเสธ และ self-approval

- **สิทธิ์** `reimbursement.approve` / `reimbursement.reject` + อำนาจตาม FR-EXP-053
- **กฎ**
  - ผู้อนุมัติส่ง `approvalSnapshotHash` ที่ตนเห็น ถ้าใบเปลี่ยน → `stale_approval_snapshot`
  - **self-approval**: ผู้เบิกอนุมัติใบตนเองไม่ได้เมื่อ `allowSelfApproval = false` ยกเว้น (ก) เจ้าของร้าน (`OWNER`) ซึ่งตัดสินใบตนเองได้เสมอ (`isOwnerSelfApproval`) และ (ข) ร้านที่ไม่มีผู้อื่นอนุมัติได้เลย — ระบบมอบ step ให้ผู้เบิกเองและ freeze `soloSelfApprovalAtSubmission = true` ไว้ใน snapshot (คำสั่งเจ้าของ 2026-09-21); ใบที่ผู้เบิกและผู้อนุมัติเป็นคนเดียวกันแสดงหมายเหตุ `REIMBURSEMENT_SELF_APPROVED_NOTE`
  - การพยายาม self-approval ที่ต้องห้ามถูก audit `reimbursement.approval.self_approval_denied`
  - ใบที่โอนเข้าบัญชี: ผู้อนุมัติต้องยืนยันรุ่นบัญชีที่ตรวจ (`payoutVerifiedVersion`) และรับทราบบัญชีบุคคลที่สาม (`payoutThirdPartyAccepted`) (audit `reimbursement.payout.verify`)
  - ปฏิเสธต้องมีเหตุผล (≤ 500); ห้ามมีเลขบัญชีใน note (`note_contains_account_number`)
  - อนุมัติแล้วไป `FINANCE_REVIEW` (ถ้านโยบาย freeze ไว้ว่าต้องตรวจ) หรือ `READY_FOR_PAYMENT`
  - ระหว่างรอคำขอยกเลิก/แก้บัญชี อนุมัติไม่ได้
- **ข้อผิดพลาด** `invalid_status_transition`, `not_eligible_approver`, `self_approval_denied`, `stale_approval_snapshot`, `rejection_reason_required`, `note_contains_account_number`, `payout_correction_in_progress`, `reimbursement_cancellation_pending`, `reimbursement_source_version_changed`
- **ข้อมูล** `ReimbursementApprovalStep`
- **API** `POST /reimbursements/:requestId/approve`, `POST …/reject`
- **หน้าจอ** `/reimbursements/[requestId]`
- **ทดสอบ** `application/use-cases/reimbursement-approval.use-case.spec.ts`, `e2e/journeys/claim-declined-then-paid.journey.spec.ts`

### FR-EXP-055 เปิดใบที่ถูกปฏิเสธกลับมาแก้ และ "ดำเนินการต่อ"

- **สิทธิ์** reopen: `reimbursement.update_own_draft` (เจ้าของ); resume: `account.session.read` + ผู้ที่ `pendingProjectionIntent` ระบุ
- **กฎ** `REJECTED → DRAFT` คงเลขใบเดิม แต่ลงนามไม่ได้จนส่งใหม่; `resume` ใช้กู้ใบที่ decision บันทึกแล้วแต่ projection (การสร้างรายจ่ายจากใบเบิก) ค้าง
- **ข้อผิดพลาด** `Cannot reopen this reimbursement`, `reimbursement_resume_not_allowed`
- **API** `POST /reimbursements/:requestId/reopen`, `POST …/resume`

### FR-EXP-056 ตรวจการเงิน (finance review)

- **สิทธิ์** `reimbursement.finance_review` (ปลดรายการซ้ำ: `reimbursement.duplicate.resolve` หรือ `reimbursement.payment.record`)
- **กฎ** เปิด/ปิดด้วย `financeReviewRequired` ของนโยบาย (default `false` เพื่อให้เจ้าของคนเดียวจบใบได้ในครั้งเดียว); decision: `APPROVED_FOR_PAYMENT`, `NEEDS_INFO` (ต้องมี note), `BLOCKED`; note ≤ ขีดจำกัดและห้ามมีเลขบัญชี; decision `APPROVED_FOR_PAYMENT` บันทึกแบบ durable ก่อนแล้วจึงทำ projection ถ้า projection ล้ม ใบค้างที่ `FINANCE_REVIEW` พร้อม flag ให้กด "ดำเนินการต่อ"
- **ข้อผิดพลาด** `invalid_finance_decision`, `finance_review_note_too_long`, `finance_correction_reason_required`, `duplicate_resolution_reason_required`, `note_contains_account_number`
- **API** `POST /reimbursements/:requestId/finance-review`, `GET /reimbursements/finance-queue`
- **ทดสอบ** `application/use-cases/reimbursement-finance.use-case.spec.ts`

### FR-EXP-057 Projection: สร้างรายจ่ายจากใบเบิก

- **คำอธิบาย** เมื่อใบพร้อมจ่าย ระบบสร้าง `ExpenseRecord` จากบรรทัดใบเบิก (รายจ่ายที่ "เกิดจากใบเบิก", `sourceReimbursementRequestId`) และยืนยันให้อัตโนมัติ
- **กฎ** (`application/services/materialize-claim-expenses.service.ts`, `reimbursement-projection-orchestrator.service.ts`, `reimbursement-projection-reconciler.service.ts`) หัวยอดเขียนจากตัวเลขของใบ และพิสูจน์ totals identity ก่อนสร้าง; รายจ่ายชนิดนี้จ่ายผ่านการจ่ายใบเบิกเท่านั้น (`expense_settled_via_reimbursement`) และ reject/void เดี่ยวไม่ได้; worker `reimbursement-reconcile` เรียก `POST /internal/reimbursements/reconcile` เพื่อซ่อม projection ที่ค้าง; ข้อความเมื่อรายจ่ายของใบถูกยกเลิก: `REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE`
- **ข้อผิดพลาด** `reimbursement_projection_authority_mismatch` (403)
- **ทดสอบ** `application/services/materialize-claim-expenses.service.spec.ts`, `reimbursement-projection-reconciler.service.spec.ts`, `infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts`

### FR-EXP-058 รายการซ้ำของใบเบิก

- **กฎ** candidate type: `ATTACHMENT_CHECKSUM`, `EXPENSE_LINK`, `AMOUNT_DATE_VENDOR`, `MANUAL`; นโยบาย `WARN` / `BLOCK_SUBMIT` / `BLOCK_PAYMENT` (default `BLOCK_PAYMENT`); สถานะซ้ำของรายจ่ายที่ผูก (`POSSIBLE_DUPLICATE`, รอยืนยัน, `CONFIRMED_DUPLICATE`) รวมเข้าเหตุผล `EXPENSE_DOCUMENT` / `EXPENSE_CONFIRMATION` / `EXPENSE_CONFIRMED_DUPLICATE`; การปลดต้องมีเหตุผล (≤ 500) และห้ามมีเลขบัญชี
- **ข้อผิดพลาด** `duplicate_unresolved`, `duplicate_confirmed`, `duplicate_resolution_reason_required`
- **ข้อมูล** `ReimbursementDuplicateCandidate`
- **API** ผ่าน `POST /reimbursements/:requestId/finance-review` (`resolveDuplicate`)

### FR-EXP-059 บันทึกการจ่ายใบเบิก

- **สิทธิ์** `reimbursement.payment.record`
- **เงื่อนไข** สถานะอยู่ใน `PAYMENT_RECORDING_STATUSES` = `APPROVED`, `FINANCE_REVIEW`, `READY_FOR_PAYMENT`; ถ้านโยบายต้องตรวจการเงินต้องได้ `APPROVED_FOR_PAYMENT`
- **กฎ** จ่ายเต็มจำนวนเท่านั้น; วิธีจ่าย `CASH` / `BANK_TRANSFER` / `CHEQUE` / `OTHER`; `BANK_TRANSFER` **ต้องแนบสลิป** (`reimbursementPaymentSlipRequired`); เลขอ้างอิงบังคับตามวิธีจ่ายเมื่อไม่มีสลิป; วิธีจ่ายที่ต่างจากที่ผู้เบิกขอต้องมีเหตุผล (`mismatchReasonRequired`); การโอนเข้าบัญชีที่ผู้เบิกระบุต้องยืนยันปลายทาง (`payoutConfirmation: required`); ผ่าน duplicate gate; ออกเลข `RBPAY-{YYYY}{MM}-{SEQ}`; mirror การจ่ายไปยังรายจ่ายที่เกิดจากใบ; idempotency key; งวดบัญชีต้องไม่ล็อก
- **ข้อผิดพลาด** `invalid_status_transition`, `finance_review_required`, `duplicate_unresolved`, `duplicate_confirmed`, `payment_amount_invalid`, `payment_over_approved_amount`, `partial_payment_not_allowed`, `payment_reference_required`, `payment_slip_required`, `payment_date_invalid`, `payment_idempotency_key_invalid`, `reimbursement_payment_already_recorded`, `reimbursement_payment_number_conflict`, `reimbursement_payment_source_changed`, `reimbursement_payment_changed`, `payout_correction_in_progress`, `accounting_period_locked`
- **ข้อมูล** `ReimbursementPayment`
- **API** `POST /reimbursements/:requestId/payments`, `GET /reimbursements/posting/pending` (`reimbursement.finance_review`)
- **ทดสอบ** `application/use-cases/reimbursement-finance.use-case.spec.ts`, `reimbursement-payment-posting.use-case.spec.ts`

### FR-EXP-060 สลิปการจ่าย

- **สิทธิ์** อัปโหลด/แนบ: `reimbursement.payment.record`; เปิด: ผู้ที่ `canOpenReimbursementPaymentSlip` ระบุ (คู่กรณีการจ่าย และผู้ตรวจการเงิน)
- **กฎ** PDF/PNG/JPEG ≤ 10 MB; ≤ 5 ไฟล์ต่อการจ่าย; ไฟล์ติด tag `reimbursement_payment_slip` ตั้งแต่ intent และผูกกับใบเดียว; ไม่เป็นใบเสร็จ ไม่เป็นสำเนาแบบฟอร์ม ไม่ถูก OCR; เปิดได้ผ่าน endpoint ของใบเท่านั้น
- **ข้อผิดพลาด** `payment_slip_invalid`, `payment_slip_access_denied` (403), `Payment slip not found`
- **API** `POST /reimbursements/:requestId/payments/slip-upload-intent`, `POST …/payments/slip-uploads/:attachmentId/complete`, `POST …/payments/:paymentId/slips`, `GET …/payments/:paymentId/slips/:attachmentId/download-url`

### FR-EXP-061 ยกเลิกการจ่ายใบเบิก

- **สิทธิ์** `reimbursement.payment.void`
- **กฎ** ต้องมีเหตุผล (≤ 500); การจ่ายที่ถูกกระทบยอดธนาคารแล้วยกเลิกไม่ได้; ทำ reversal ของ posting และ mirror ไปยังรายจ่าย; งวดต้องไม่ล็อก
- **ข้อผิดพลาด** `void_reason_required`, `Payment cannot be voided`, `Payment not found`, `reimbursement_payment_bank_reconciled`, `expense_not_voidable`, `accounting_period_locked`
- **API** `POST /reimbursements/:requestId/payments/:paymentId/void`
- **ทดสอบ** `application/use-cases/void-reimbursement-payment-reversal.use-case.spec.ts`

### FR-EXP-062 ยกเลิกใบเบิก ลบร่าง และถอนคำขอยกเลิก

- **สิทธิ์** ยกเลิก/ถอน: `reimbursement.cancel_own` (เจ้าของ) หรือ `reimbursement.finance_review`; ลบร่าง: `account.session.read` + เจ้าของ
- **กฎ** ลบได้เฉพาะร่างที่ยังไม่ส่ง (audit `reimbursement.request.delete_draft`); การยกเลิกใบที่มีรายจ่าย/ภาษีผูกทำงานเป็น 2 ระยะ (บันทึก intent แล้วดำเนินการ; audit `cancellation_intent`, `cancellation_retry`, `cancellation_withdrawn`, `cancellation_reason_corrected`); เหตุผลมีความยาวขั้นต่ำ; ถ้ามีหนังสือรับรองภาษีต้อง `taxFilingAttested`; งวดภาษีล็อกยกเลิกไม่ได้
- **ข้อผิดพลาด** `Cannot cancel this reimbursement`, `cancellation_reason_too_short`, `reason_too_short`, `reimbursement_cancellation_already_pending`, `reimbursement_cancellation_certificate_attestation_required`, `reimbursement_cancellation_certificate_issued`, `reimbursement_cancellation_certificate_permission_missing`, `reimbursement_cancellation_tax_period_locked`, `certificate_attestation_required`, `certificate_permission_missing`, `reimbursement_changed`
- **API** `DELETE /reimbursements/:requestId`, `POST …/cancel`, `POST …/cancel/withdraw`
- **หน้าจอ** `ReimbursementCertificateCancelDialog.tsx`

### FR-EXP-063 บัญชีรับเงินของสมาชิก (default และหลายบัญชี)

- **สิทธิ์** ของตนเอง: `reimbursement.create`; แทนสมาชิก: อ่าน `access.employee.read` / แก้ `access.employee.update`
- **กฎ**
  - วิธีรับเงิน `BANK_TRANSFER` / `CASH`; ชนิดบัญชี `BANK_ACCOUNT` / `PROMPTPAY_PHONE`; ผู้ถือ `SELF` / `THIRD_PARTY` (ต้องมี `holderNote` 2–200 ตัวอักษร)
  - บัญชี default หนึ่งบัญชีต่อสมาชิก (`MemberPayoutAccount`) และบัญชีที่บันทึกไว้ไม่เกิน 20 (`PAYOUT_SAVED_ACCOUNT_LIMIT`, `MemberSavedPayoutAccount`) พร้อม label ≤ 40; ตั้งบัญชีที่บันทึกไว้เป็น default ได้
  - ชื่อธนาคาร ≤ 80 (เลือกจาก `THAI_BANK_NAMES`), ชื่อบัญชี ≤ 140
  - เลขบัญชีเก็บเข้ารหัส (`sealPayoutDestination`) พร้อม fingerprint; หน้าจอเห็นเฉพาะ 4 ตัวท้าย; การเปิดเลขเต็ม (`reveal`) เป็นคำสั่ง POST ที่ถูก audit
  - ผู้ดูแลกรอกแทนสมาชิกไม่ได้เมื่อสมาชิกไม่ active, สมาชิกเป็นผู้จัดการคน (`OWNER`, `SYSTEM_ADMIN`, `COMPANY_VIEW`, `ADMIN`, `MANAGER`), หรืออยู่นอกขอบเขตสาขา (`target_not_active`, `target_manages_people`, `outside_editor_branch_scope`)
- **ข้อมูล** `MemberPayoutAccount`, `MemberSavedPayoutAccount`
- **API** `GET|PUT|DELETE /reimbursements/payout-accounts/me`, `POST …/payout-accounts/me/reveal`, `GET|POST /reimbursements/payout-accounts/me/saved`, `DELETE …/me/saved/:accountId`, `POST …/me/saved/:accountId/reveal`, `POST …/me/saved/:accountId/make-default`, `GET|PUT /reimbursements/payout-accounts/members/:userId`
- **หน้าจอ** `/reimbursements/payout-account` (`ReimbursementPayoutAccountPage.tsx`, `SavedPayoutAccountsCard.tsx`)

### FR-EXP-064 ปลายทางรับเงินของใบเบิก และการแก้หลังอนุมัติ

- **สิทธิ์** ตั้งปลายทาง: `reimbursement.update_own_draft` หรือ `reimbursement.finance_review`; reveal/correction: `account.session.read` + กลุ่มที่ use case อนุญาต (`REQUESTER` / `APPROVER` / `PAYER`)
- **กฎ**
  - โหมด `DEFAULT` (ตามบัญชี default), `CASH`, `SPECIFIED` (กรอกเอง), `SAVED` (เลือกจากที่บันทึกไว้); ตอนแก้หลังอนุมัติมี `PREVIOUS` เพิ่ม
  - ปลายทางถูก freeze ต่อรุ่น (`ReimbursementPayoutDestination`, `payoutVersion`, `payoutFingerprint`) ตอนส่งใบ และเป็นส่วนของ snapshot hash
  - พบบัญชีผิดหลังอนุมัติก่อนจ่าย: ส่งกลับด้วย reason code จากรายการคงที่ (เช่น `ACCOUNT_NUMBER_WRONG`, `ACCOUNT_NAME_MISMATCH`, `BANK_WRONG`, `OTHER`) และ note ≤ 500; บัญชีบุคคลที่สามใช้เหตุผล "ชื่อไม่ตรงกับผู้เบิก" ไม่ได้; พร้อมเพย์ไม่มีเหตุผล "ธนาคารผิด"
  - ระหว่างแก้: สถานะ `PENDING_APPROVAL`, ลงนามแบบฟอร์มไม่ได้, อนุมัติ/จ่าย/ตรวจการเงินถูกบล็อก (`payout_correction_in_progress`); approval เดิมถูก invalidate ด้วยเหตุผล `payout_account_correction`
  - ผู้เบิกตอบบัญชีใหม่แล้ว: ต่ำกว่าเกณฑ์อนุมัติ → กลับ `READY_FOR_PAYMENT`; มิฉะนั้นผู้อนุมัติตรวจรอบใหม่
- **ข้อผิดพลาด** `payout_correction_in_progress`, `payout_correction_reason_required`, `payout_correction_note_too_long`, `payout_correction_name_mismatch_third_party`, `payout_destination_changed`
- **API** `PUT /reimbursements/:requestId/payout-destination`, `POST …/payout-destination/reveal`, `POST …/payout-correction`
- **หน้าจอ** `ReimbursementPayout.tsx`, `ReimbursementPayoutCorrection.tsx`

### FR-EXP-065 แบบฟอร์มใบเบิก ลายเซ็น และ "ลงนามหลังจ่าย"

- **สิทธิ์** `reimbursement.read` / `.read_related` / `.read_own` + ต้องเป็นผู้มีบทบาทจริงในขั้นนั้น
- **กฎ** (`application/use-cases/reimbursement-claim-signature.use-case.ts`)
  - ลงนามได้เฉพาะใบที่มีเลขและไม่อยู่ใน `DRAFT` / `REJECTED` / `CANCELLED` / `VOIDED` และไม่อยู่ระหว่างแก้บัญชีรับเงิน
  - บทบาทมาจากผู้ที่ทำขั้นนั้นจริง: `REQUESTER` = ผู้เบิก; `APPROVER` = ผู้ตัดสิน approval step ที่มีผลในรอบล่าสุด; ไม่มีใครลงนามล่วงหน้าในขั้นที่ยังไม่เกิด
  - แบบฟอร์มมาตรฐานมี 2 ผู้ลงนาม (ผู้เบิก, ผู้อนุมัติ — `TWO_SIGNERS`); แบบเก่ามี 4 ช่อง โดย `FINANCE_REVIEW` ลงได้เมื่อ `APPROVED_FOR_PAYMENT` และเป็นผู้ตรวจจริง และ `PAYER` ลงได้เมื่อเป็นผู้บันทึกการจ่าย `RECORDED` ล่าสุด
  - ลำดับการเดินงานที่ระบบใช้คือ ส่ง → อนุมัติ → จ่าย → ลงนาม: การลงนามไม่ใช่เงื่อนไขก่อนจ่าย ใบที่จ่ายแล้วยังลงนามได้ ("sign after payment")
  - ลงนามสิ่งที่พรีวิว: ผู้ลงนามส่ง `snapshotHash` ถ้าใบเปลี่ยน → `stale_claim_snapshot`
  - ลายเซ็น PNG/JPEG ≤ 2 MB ตรวจ magic bytes และ checksum; ใช้ลายเซ็นที่บันทึกไว้ของผู้ลงนามเป็น default
  - แต่ละบทบาทลงได้คนเดียวต่อใบ (unique ต่อ request)
- **ข้อผิดพลาด** `claim_signature_role_not_eligible` (403), `claim_signature_attachment_invalid`, `claim_signature_too_large`, `claim_signature_checksum_mismatch`, `claim_signature_bytes_mismatch`, `claim_signature_must_be_png_or_jpeg_max_2mb`, `claim_signature_upload_not_found`, `claim_saved_signature_required`, `claim_signature_unreadable`, `stale_claim_snapshot` (409)
- **ข้อมูล** `ReimbursementClaimSignature`
- **API** `POST /reimbursements/:requestId/claim-form/preview`, `POST …/claim-form/signature-upload-intent`, `POST …/claim-form/signature-uploads/:attachmentId/complete`, `POST …/claim-form/signatures`
- **ทดสอบ** `application/use-cases/reimbursement-claim-signature.use-case.spec.ts`, `reimbursement-claim-form.use-case.spec.ts`, `domain/logic/claim-form.logic.spec.ts`

### FR-EXP-066 สำเนาแบบฟอร์มที่ลงนามด้วยมือ

- **กฎ** PDF/PNG/JPEG; ผู้อัปโหลดต้องเป็นเจ้าของไฟล์ที่ `ACTIVE`; ใบต้องส่งแล้ว (`claim_form_requires_submitted`); ถ้าผู้แนบประกาศว่าสแกนมีลายเซ็นครบ ต้องยืนยันเลขใบ (`confirmedRequestNo`) และสำเนานั้นนับเป็นเอกสารที่ลงนาม มิฉะนั้นเป็นสำเนาเก็บไว้เฉย ๆ; สำเนาที่ประกาศก่อนใบถูกส่งกลับจากขั้นจ่ายถูกเก็บเป็น "สำเนาก่อนส่งกลับ" และไม่นับ; สลิปการจ่ายและไฟล์ที่ระบบ tag ไว้เป็นสำเนาไม่ได้; การประกาศเก็บใน metadata key `reimbursementSignedCopyAck` ที่ผูกกับ id ของ link
- **ข้อผิดพลาด** `claim_form_signed_copy_denied`, `claim_form_signed_copy_attachment_invalid`, `claim_form_signed_copy_must_be_pdf_or_image`, `claim_form_requires_submitted`, `stale_claim_snapshot`
- **API** `POST /reimbursements/:requestId/claim-form/signed-copies`

### FR-EXP-067 นโยบายใบเบิก

- **สิทธิ์** อ่าน: `reimbursement.policy.read` หรือ `.manage`; แก้: `reimbursement.policy.manage`
- **ค่า default** (`REIMBURSEMENT_POLICY_DEFAULTS`): `currency THB`, `approvalRequiredFromAmount 1.00`, `approverMode MANAGER_ROLE`, `defaultApproverRoles ['MANAGER']`, `allowSelfApproval false`, `requireReceipt true`, `allowMissingReceiptWithReason false`, `duplicatePolicy BLOCK_PAYMENT`, `financeReviewRequired false`, `status ACTIVE`
- **กฎ** ฟิลด์ที่แก้ได้: เกณฑ์ยอด, role ผู้อนุมัติ (1–20, แต่ละ key ≤ 120, ต้องเลือกได้จริง), สวิตช์ self-approval, receipt, duplicate policy, finance review, `slaHours` (0–8760); ใช้ `expectedUpdatedAt`; audit เก็บ before/after ของ role; ใบที่ส่งแล้วใช้ snapshot ที่ freeze ไว้ ไม่ได้รับผลจากการแก้นโยบาย (`effectivePolicyForRequest`)
- **ข้อผิดพลาด** `invalid_duplicate_policy`, `invalid_threshold`, `invalid_sla_hours`, `approver_role_required`, `approver_role_not_eligible`, `reimbursement_approver_not_ready`
- **ข้อมูล** `ReimbursementPolicy`
- **API** `GET /reimbursement-policy`, `PUT /reimbursement-policy`, `GET /reimbursement-policy/approver-options`
- **หน้าจอ** แท็บ "ตั้งค่านโยบาย" ใน `/reimbursements` (`ReimbursementsPages.tsx`)

### FR-EXP-068 บันทึกภายใน, ร่างจาก LINE และส่งออกหลักฐาน

- **บันทึกภายใน** สิทธิ์ route `account.session.read` + ผู้เกี่ยวข้องตาม use case; body ≤ 2000; แก้/ลบได้เฉพาะของตน; ข้อผิดพลาด `internal_note_body_invalid`, `Cannot edit this internal note`, `Cannot delete this internal note`, `Internal note not found`; ข้อมูล `ReimbursementInternalNote`; API `POST /reimbursements/:requestId/internal-notes`, `PATCH|DELETE …/internal-notes/:noteId`
- **ร่างจาก LINE** ผู้ช่วย LINE เตรียมคำสั่งร่าง (`ReimbursementDraftAction`) แล้วผู้ใช้เปิดลิงก์บนเว็บเพื่อยืนยันหรือยกเลิก; ยืนยันต้องส่ง `previewRevision` และ `confirmationDigest` (64 hex) ที่ตรงกับพรีวิว; เปิดปิดด้วย `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` (default true) และ `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` (`off`/`shadow`/`clarify_only`/`handoff`, default `off`); API `GET /reimbursements/draft-actions/:actionId`, `POST …/confirm`, `POST …/cancel`; หน้าจอ `/reimbursements/draft-actions/[actionId]`; ทดสอบ `application/use-cases/line-reimbursement-draft.use-case.spec.ts`, `line-reimbursement-draft.pg.spec.ts`, `presentation/http/reimbursement-draft-action.controller.spec.ts`
- **ส่งออกหลักฐาน** สิทธิ์ `reimbursement.export`; คืน JSON หลักฐานของใบโดย redact เลขบัญชี (`redactPayload`); API `GET /reimbursements/:requestId/export`; audit `reimbursement.export`

---

## 8. ข้อกำหนดเชิงหน้าที่ — accounting-documents

path ไฟล์ที่ไม่ระบุ prefix อยู่ใต้ `apps/api/src/modules/accounting-documents/`

**สถานะการขาย** โมดูลนี้มี 2 ส่วน: (ก) **ทะเบียนคู่ค้า** ซึ่งขายจริงในทุกแพ็ก (เมนู `counterparties`, parent feature `expenses`) — FR-EXP-070 ถึง 073; (ข) **เอกสารขาย/รับชำระ/รายรับ** ซึ่งผูกกับ feature `sales_documents` ที่ไม่อยู่ใน `TIER_FEATURE_PRESETS` ของแพ็กใด และ menu binding `salesdoc` / `sales` / `accounting` มี `status: 'planned'` — FR-EXP-074 ถึง 079 บันทึกไว้เป็นหลักฐานทางวิศวกรรมเท่านั้น

### FR-EXP-070 ทะเบียนคู่ค้า: รายการและรายละเอียด

- **สิทธิ์** รายการ: `accounting.counterparty.read`; รายละเอียด: `accounting.counterparty.read` / `.manage` หรือผู้ที่เพิ่มคู่ค้านั้นเอง (เข้าผ่าน `expense.read_related`, `accounting.document.read_related`, `expense.create`, `expense.update`, `expense.review`, `expense.receipt.upload`, `expense.receipt.line_upload`)
- **แพ็ก** S/B/P/E (ฝั่งผู้ขาย)
- **กฎ** ผู้ที่ไม่มีสิทธิ์ทะเบียนและไม่ใช่ผู้เพิ่ม ได้ 404 (ไม่เปิดเผยว่ามีอยู่); รายการแบ่งหน้า (default 20) พร้อม `counts`; รายละเอียดคืน `canEdit` และ usage (นับจากเอกสารจริงทั้งฝั่งซื้อ/ขาย) ไม่มีตัวเลือก ลูกค้า/ผู้ขาย/ทั้งสอง บนหน้าจอ — server ตั้ง `type` เอง (`VENDOR` เมื่อรายจ่ายสร้าง, `BOTH` เมื่อฝั่งขายใช้)
- **ข้อมูล** `AccountingCounterparty`
- **API** `GET /accounting/counterparties`, `GET /accounting/counterparties/:counterpartyId`
- **หน้าจอ** `/counterparties`, `/counterparties/[counterpartyId]`
- **ทดสอบ** `application/use-cases/counterparty-registry.use-case.spec.ts`, `infrastructure/prisma-accounting.repository.counterparty-usage.spec.ts`, `infrastructure/counterparty-type-promotion.spec.ts`, `e2e/counterparties.spec.ts`

### FR-EXP-071 ทะเบียนคู่ค้า: สร้างและแก้ไข

- **สิทธิ์** สร้าง: `accounting.counterparty.manage`; แก้: `.manage` หรือผู้เพิ่มคู่ค้านั้น
- **กฎ** `displayName` บังคับ (≤ 255); `legalName` ≤ 255; `taxId` ≤ 32 (ไม่บังคับ 13 หลักเพราะอาจเป็นต่างประเทศ); `branchCode` ต้องเป็นตัวเลข 5 หลักหรือเว้นว่าง (ว่าง = สำนักงานใหญ่ ไม่เก็บ `00000`); `entityKind` ตาม `BUYER_ENTITY_KINDS`; `email` รูปแบบอีเมล; `phone` ≤ 32; `postalCode` ≤ 16; ที่อยู่ ≤ 500 ตัวอักษร; body ที่ส่ง `type` ถูกปฏิเสธ 400 (`forbidNonWhitelisted`); สถานะ `ACTIVE`/`ARCHIVED`; `locked = true` ("ล็อกที่อยู่หลัก") ทำให้ที่อยู่จากเอกสารใหม่ไม่มาแทน; ที่อยู่เก็บเป็น JSON v2 พร้อมแหล่งที่มา (`MANUAL`, `EXPENSE_AUTO`, `RD_LOOKUP`, `OCR`, `PROCUREMENT`) และประวัติ; แก้ใช้ `expectedUpdatedAt`
- **ข้อผิดพลาด** `counterparty_address_too_long`, `counterparty_branch_code_invalid`, `counterparty_conflict` (409), `Counterparty <id> not found` (404), `feature_temporarily_unavailable`
- **API** `POST /accounting/counterparties`, `PATCH /accounting/counterparties/:counterpartyId`
- **หน้าจอ** `/counterparties/[counterpartyId]` (`CounterpartyFields.tsx`)

### FR-EXP-072 บันทึกผู้ขายอัตโนมัติจากรายจ่าย

- **คำอธิบาย** เมื่อรายจ่ายถูกบันทึก/ยืนยัน ระบบจับคู่หรือสร้างคู่ค้าฝั่งผู้ขายและจำที่อยู่ที่เห็นบนเอกสาร
- **กฎ** (`domain/logic/vendor-counterparty-match.logic.ts`, `application/use-cases/ensure-vendor-counterparty-from-expense.use-case.ts`) กุญแจจับคู่: เลขผู้เสียภาษี 13 หลัก + รหัสสาขา (ว่าง = `00000` เฉพาะในกุญแจ) ชนะเสมอ; ไม่มีเลข → ชื่อที่ normalize เท่ากันทั้งสตริง; ชื่อว่างไม่จับคู่; ที่อยู่เทียบหลัง normalize คำย่อไทย (ใช้เปรียบเทียบเท่านั้น ไม่เก็บ); ที่อยู่ที่ถูกล็อกไม่ถูกแทน; ข้อมูลโครงสร้างจาก RD lookup ไม่ถูกลบโดย auto-save
- **ทดสอบ** `domain/logic/vendor-counterparty-match.logic.spec.ts`, `application/use-cases/ensure-vendor-counterparty-from-expense.use-case.spec.ts`, `apps/api/src/modules/expenses/application/use-cases/expense-vendor-counterparty-autosave.use-case.spec.ts`

### FR-EXP-073 ใช้ที่อยู่ที่เคยเห็นเป็นที่อยู่หลัก

- **สิทธิ์** เท่ากับการแก้คู่ค้า
- **กฎ** `addressText` (≤ 500) ต้องยังอยู่ในประวัติของคู่ค้า; ใช้ `expectedUpdatedAt`
- **ข้อผิดพลาด** `Address is no longer in this counterparty history; reload the page.` (404), `counterparty_conflict`
- **API** `POST /accounting/counterparties/:counterpartyId/promote-seen-address`

### FR-EXP-074 เอกสารขาย: ชนิด สร้าง แก้ (ไม่ได้ขาย)

- **ชนิด** `QUOTATION`, `INVOICE`, `BILLING_NOTE`, `RECEIPT`, `TAX_INVOICE`, `CREDIT_NOTE`, `DEBIT_NOTE`
- **สิทธิ์** อ่าน/สร้าง/แก้ ตามชุด `DOCUMENT_READ_PERMISSIONS` / `DOCUMENT_CREATE_PERMISSIONS` ใน `presentation/http/accounting-document.controller.ts`
- **กฎ** (`domain/logic/accounting-status.logic.ts`) `QUOTATION`/`BILLING_NOTE`/`RECEIPT` ห้ามมี Tax Code; `INVOICE` ธรรมดาห้ามมี Tax Code (ต้องออก `TAX_INVOICE`); `TAX_INVOICE`/`CREDIT_NOTE`/`DEBIT_NOTE` ต้องมี output Tax Code (`O7` ต้อง `VAT_INCLUDED`/`VAT_EXCLUDED` และ VAT > 0; `OX` ต้อง `EXEMPT`; `O0` ต้อง `NO_VAT`; สองตัวหลัง VAT = 0); `RECEIPT` ที่อ้างต้นทางต้องเป็น `INVOICE` ที่ `ISSUED` และจ่ายครบ; `TAX_INVOICE` อ้าง `INVOICE` หรือ `RECEIPT` ที่ `ISSUED`; CN/DN ต้องอ้าง `TAX_INVOICE` หรือ `INVOICE` ไม่มี VAT ที่ออกแล้ว และต้องมี reason code (`OTHER_PRESCRIBED` ต้องมีข้อความ ≥ 3 ตัวอักษร); ต้นทางหนึ่งมีใบเสร็จ/ใบกำกับที่มีผลได้ใบเดียว; แก้ได้เฉพาะ `DRAFT`; launch route `sales_documents/DEFAULT` เป็น `BLOCK_NEW_ROOT` (ราก = quotation, invoice, billing note, receipt/tax invoice ที่ไม่มีต้นทางตามเกณฑ์)
- **ข้อผิดพลาด** `accounting_document_changed`, `accounting_document_create_idempotency_conflict`, `accounting_receipt_already_exists`, `accounting_tax_invoice_already_exists`, `output_tax_code_line_mismatch` และข้อความจาก `validateOutputTaxDocument`
- **API** `GET|POST /accounting/documents`, `GET|PATCH /accounting/documents/:documentId`, `GET …/:documentId/posting-source`
- **หน้าจอ** `/sales-documents`, `/sales`, `/accounting`
- **ทดสอบ** `domain/logic/accounting-status.logic.spec.ts`, `application/use-cases/update-document.use-case.spec.ts`, `money-input-validation.use-case.spec.ts`, `e2e/accounting.spec.ts`

### FR-EXP-075 เอกสารขาย: ออกเลข อนุมัติใบเสนอราคา แปลง ยกเลิก (ไม่ได้ขาย)

- **กฎ** ออกเอกสาร (`issue`) จองและ commit เลขตามตาราง 4.3 แบบ atomic พร้อม idempotency (`AccountingDocumentIssueCommand`); ต้องมี ≥ 1 บรรทัด; ใบเสนอราคาต้อง submit → approve ก่อน issue และผู้ส่งอนุมัติเองไม่ได้; `convert` สร้างเอกสารถัดไปจากต้นทาง (ต้นทางแปลงซ้ำไม่ได้: `accounting_document_already_converted`); `void` ต้องมีเหตุผลและทำ true reversal; ต้อง void เอกสารลูกและใบเสร็จที่ยังมีผลก่อน; งวดบัญชี/ภาษีล็อก void ไม่ได้
- **ข้อผิดพลาด** `accounting_active_child_document_must_be_voided`, `accounting_active_receipt_must_be_voided`, `accounting_document_already_converted`, `accounting_period_locked`, `tax_period_locked`, `posting_state_changed`
- **API** `POST /accounting/documents/:documentId/issue`, `/void`, `/submit-approval`, `/approve`, `/reject`, `/convert`
- **ทดสอบ** `infrastructure/prisma-accounting.repository.atomic-issue.spec.ts`, `prisma-accounting.repository.void.spec.ts`, `prisma-accounting.repository.conversion.spec.ts`, `application/use-cases/void-true-reversal.use-case.spec.ts`, `issue-document-number-release.use-case.spec.ts`

### FR-EXP-076 รับชำระเงิน (ไม่ได้ขาย)

- **สิทธิ์** `accounting.payment.read` / `.create` / `.void`
- **กฎ** การรับชำระและเอกสารที่จัดสรรต้องสาขาเดียวกันและคู่ค้าเดียวกัน; ผู้ใช้ที่จำกัดสาขาจ่ายเอกสารระดับส่วนกลางไม่ได้; idempotency; void ต้องมีเหตุผล ≥ 3 ตัวอักษร
- **ข้อผิดพลาด** `accounting_payment_idempotency_conflict`, `accounting_payment_state_changed`, `Payment is already voided`
- **ข้อมูล** `AccountingPayment`, `AccountingPaymentAllocation`
- **API** `GET|POST /accounting/payments`, `GET /accounting/payments/:paymentId`, `POST …/:paymentId/void`

### FR-EXP-077 บันทึกรายรับอย่างง่าย และหมวดรายรับ (ไม่ได้ขาย)

- **กฎ** รายรับอย่างง่ายสร้าง invoice ธรรมดา + รับชำระในคำสั่งเดียว; ห้ามมี Tax Code; ร้านต้องตอบสถานะจด VAT ก่อน; ร้านไม่จด VAT ต้องบันทึกแบบไม่มี VAT; เลขบรรทัดไม่ซ้ำ; idempotent (`AccountingSimpleIncomeCommand`); หมวดรายรับสร้าง/แก้ด้วย `accounting.revenue_category.manage` ชื่อห้ามซ้ำ
- **ข้อผิดพลาด** `simple_income_idempotency_conflict`
- **API** `POST /accounting/simple-income`, `GET /revenue-categories`, `GET /revenue-categories/manage`, `POST /revenue-categories`, `PATCH /revenue-categories/:categoryId`
- **หน้าจอ** `/sales-documents/record-income`, `/sales-documents/revenue-categories`

### FR-EXP-078 สมุดรายรับ-รายจ่าย (ไม่ได้ขาย)

- **คำอธิบาย** มุมมองรวมรายรับ (เอกสารขาย) และรายจ่าย พร้อมสรุปและส่งออก
- **API** `GET /income-expense-ledger/availability`, `/summary`, `/entries`, `/export`
- **หน้าจอ** `/income-expense-ledger`
- **ทดสอบ** `e2e/income-expense-ledger.spec.ts`

### FR-EXP-079 PDF และการพิมพ์เอกสารที่ยกเลิก

- **ผลการตรวจโค้ด** โมดูล `accounting-documents` ฝั่ง API **ไม่มี** ตัวสร้าง PDF และหน้า `AccountingPages.tsx` ไม่มีคำสั่งพิมพ์ — "มีในคำขอ แต่ไม่พบในโค้ด" (ดูข้อ 15)
- **PDF ที่มีจริงในขอบเขตเอกสารนี้** ทั้งหมดอยู่ในโมดูล `expenses` และสร้างด้วย `pdf-lib` + `sharp` (SVG → PNG ที่ density 144 → ฝังใน PDF, ฟอนต์ไทย Noto Sans Thai/Tahoma ใน SVG):
  | เอกสาร | ไฟล์ logic | endpoint |
  |---|---|---|
  | ใบรับรองแทนใบเสร็จรับเงิน (ฉบับออก ฉบับพรีวิว ฟอร์มเปล่า และสแกนลงนามด้วยมือ + หน้ารับรองโดยระบบ) | `domain/logic/substitute-receipt.logic.ts`, `substitute-receipt-pdf.logic.ts` | `…/substitute-receipt/:evidenceId/artifact.pdf`, `/artifact-preview`, `/form.pdf` |
  | ใบสำคัญรับเงิน | `domain/logic/payment-voucher.logic.ts` | `…/expenses/:expenseId/payment-voucher.pdf` |
  | ใบเตรียมจ่าย/ใบสำคัญจ่าย | `domain/logic/disbursement-voucher-pdf.logic.ts` | `…/disbursement-vouchers/:id/document.pdf` |
  | PDF ต่อรายการในชุดส่งนักบัญชี (หน้าปก + ไฟล์หลักฐาน) | `domain/logic/expense-record-pdf.logic.ts` | อยู่ใน zip ของ `…/accountant-package/bundle/:part` |
  | แบบฟอร์ม "ใบเบิกค่าใช้จ่าย" — render เป็น SVG หลายหน้า (`renderReimbursementClaimFormPages`) ไม่ใช่ PDF ผู้ใช้พิมพ์จากเบราว์เซอร์ | `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts` | `…/reimbursements/:requestId/claim-form/preview` |
- **การพิมพ์เอกสารที่ยกเลิก** มีเฉพาะใบรับรองแทนใบเสร็จ: ตราสถานะ `VOID` / `SUPERSEDED` / `UNSIGNED` / `AWAITING APPROVAL` / `AWAITING REVIEW` (`SubstituteReceiptPrintStamp`) ฉบับที่ถูกยกเลิกยังเปิดดู/พิมพ์ได้แบบ view-only (`e2e/substitute-cancelled-view-only.spec.ts`)

---

## 9. ข้อกำหนดเชิงหน้าที่ — ai-draft (ชั้นคำแนะนำ AI ฝั่ง ERP)

path ไฟล์ที่ไม่ระบุ prefix อยู่ใต้ `apps/api/src/modules/ai-draft/`

**หลักการ** AI เป็นที่ปรึกษาเท่านั้น: สร้างได้เฉพาะ "คำแนะนำ" และ "ร่างในโมดูลต้นทาง" ผ่าน API ที่ตรวจสิทธิ์ ไม่มี candidate action ใดที่แสดงการเปลี่ยนแปลงขั้นสุดท้ายด้านเงิน สต๊อก ภาษี บัญชี การอนุมัติ การส่งออก หรือสิทธิ์ได้ (`domain/logic/ai-draft-safety.logic.ts`) และ ERP ไม่เรียกโมเดลตรง — ผ่าน AI Gateway (`infrastructure/provider/ai-gateway-draft.provider.ts`)

**ขอบเขตแพ็ก** เมนูบริบท `ai-suggestions` ผูกกับ `ai_line_assistant` ซึ่งอยู่ใน starter preset แต่ template ทั้ง 5 ตัวต้องการสิทธิ์ของโมดูลต้นทาง (banking, crm, inventory, tax, workflow) ที่ไม่อยู่ในแพ็กใด ดังนั้นร้านในแพ็กที่ขายจะเห็น template เป็น "ใช้ไม่ได้" หรือขอไม่ผ่านสิทธิ์ และ**ไม่มี template สำหรับร่างรายจ่ายหรือใบเบิก** (การเติมร่างรายจ่ายด้วย AI ทำผ่าน FR-EXP-004 ไม่ใช่โมดูลนี้)

### FR-EXP-080 แค็ตตาล็อก template และสถานะผู้ให้บริการ

- **สิทธิ์** `ai.suggestion.read_own`
- **กฎ** template เป็นของโค้ด (`domain/ai-draft-template-catalog.ts`) ไม่มีหน้าแก้ prompt: `cfo_cash_risk_summary` (HIGH, อายุ 24 ชม.), `crm_followup_next_action`, `inventory_reorder_review`, `tax_evidence_checklist`, `workflow_review_checklist` (อายุปกติ 7 วัน); ความพร้อมคำนวณจาก `IMPLEMENTED_SOURCE_MODULES` และสิทธิ์ที่ต้องมี; provider เลือกจาก env `AI_DRAFT_PROVIDER` = `gateway`/`bedrock` (ผ่าน AI Gateway), `fake` (ทดสอบ), `disabled`; ไม่ตั้งค่า → ใช้ gateway เมื่อมี `AI_GATEWAY_URL` + `AI_GATEWAY_INTERNAL_SECRET` มิฉะนั้น disabled
- **API** `GET /ai/suggestion-templates`, `GET /ai/provider-status`
- **หน้าจอ** `/ai-suggestions`

### FR-EXP-081 ขอคำแนะนำ

- **สิทธิ์** `ai.suggestion.request` (logic ยอมรับ `ai.draft.request`) + สิทธิ์ต้นทางของ template
- **กฎ** สร้าง `AiDraftRequest` สถานะ `QUEUED` พร้อม idempotency (`domain/logic/ai-draft-idempotency.logic.ts`); origin `WEB`/`LINE`/`WORKFLOW`/`SCHEDULE`/`SYSTEM`; worker `apps/workers/src/modules/ai-draft` เรียก drain
- **ข้อผิดพลาด** `PROVIDER_DISABLED`, `GATEWAY_UNREACHABLE`
- **ข้อมูล** `AiDraftRequest`
- **API** `POST /ai/suggestions/requests`, `POST /internal/ai/draft-requests/drain`, `POST /internal/ai/draft-requests/generate`
- **ทดสอบ** `application/use-cases/create-draft-request.use-case.spec.ts`, `drain-draft-requests.use-case.spec.ts`, `presentation/http/ai-draft-internal.controller.spec.ts`

### FR-EXP-082 สร้างคำแนะนำ (generation)

- **กฎ** generator รวบรวมข้อมูลต้นทางผ่าน API ที่ตรวจสิทธิ์และ `source-state.service.ts`; คำแนะนำที่มีข้อเสนอต้องมี citation อย่างน้อย 1 รายการ มิฉะนั้นลดเป็น `NEEDS_DATA` (`ai_suggestion_needs_data`); candidate action ต้องอยู่ใน allowlist ปิด (`ALLOWED_CANDIDATE_ACTION_TYPES`) และรูปถูกต้อง; tool หมวด `final_mutation` ถูกบล็อกเสมอ; provider ล้ม → `PROVIDER_UNAVAILABLE` (ไม่มีเนื้อหาสำเร็จรูปทดแทน); ไม่มีหลักฐาน → `NO_EVIDENCE`
- **ข้อมูล** `AiSuggestion`, `AiSuggestionCitation`, `AiDraftArtifact`
- **ทดสอบ** `application/use-cases/generate-suggestion.use-case.spec.ts`, `domain/logic/ai-draft-safety.logic.spec.ts`, `ai-draft-status.logic.spec.ts`

### FR-EXP-083 อ่านและตรวจคำแนะนำ

- **สิทธิ์** อ่าน: `ai.suggestion.read_own` (จำกัดผู้ขอ/ผู้รับมอบ) และ `ai.suggestion.read` สำหรับทั้งร้าน; ตรวจ: `ai.suggestion.review`
- **กฎ** สถานะตามข้อ 5.7; คำแนะนำหมดอายุตาม `expiresAt`; การตรวจบันทึกใน `AiSuggestionReview`
- **API** `GET /ai/suggestions`, `GET /ai/suggestions/:id`, `POST /ai/suggestions/:id/reviews`
- **ทดสอบ** `application/use-cases/ai-suggestion-review.use-case.spec.ts`, `e2e/ai-suggestions.spec.ts`

### FR-EXP-084 ตรวจและสร้างร่างในโมดูลต้นทาง

- **สิทธิ์** validate: `ai.draft.review` + สิทธิ์ต้นทางของ action; create: `ai.draft.create_source_draft` + สิทธิ์ต้นทาง (สิทธิ์ AI อย่างเดียวไม่พอ)
- **กฎ** สิทธิ์ต้นทางต่อ action (`CANDIDATE_ACTION_SOURCE_PERMISSIONS`): `CREATE_CRM_FOLLOW_UP_DRAFT` → `crm.follow_up.create`; `CREATE_ACCOUNTING_QUOTATION_DRAFT` → `accounting.quotation.create`; `CREATE_INVENTORY_REORDER_REVIEW` → `inventory.report.read`; `CREATE_INVENTORY_TRANSFER_OR_COUNT_REQUEST` → `inventory.movement.create`; `CREATE_TAX_EVIDENCE_CHECKLIST` → `tax.review_issue.read`; `CREATE_TAX_CERTIFICATE_DRAFT` → `tax.certificate.issue`; `CREATE_WORKFLOW_TASK` → `workflow.task.read`; adapter ที่ต่อจริงใน `application/adapters/source-draft-adapter.service.ts` มีเพียง CRM follow-up และ action ที่ระบบเป็นเจ้าของเอง (review checklist, workflow task) — action อื่นตอบ 422 `No source-draft adapter is wired for action <type>`; `NO_SOURCE_DRAFT_AVAILABLE` → `ai_source_draft_unavailable`
- **API** `POST /ai/suggestions/:id/actions/:actionId/validate`, `POST /ai/suggestions/:id/actions/:actionId/create-source-draft`
- **ทดสอบ** `domain/logic/ai-draft-permission.logic.spec.ts`, `application/source-state.service.spec.ts`
- **หมายเหตุ** `application/use-cases/line-ai-suggestion.use-case.ts` ให้ผู้ช่วย LINE อ่านคำแนะนำในรูปข้อความสั้น (`domain/logic/line-ai-suggestion.logic.ts`)

---

## 10. ข้อกำหนดที่ไม่ใช่หน้าที่ (NFR)

| ID | ข้อกำหนด | หลักฐาน |
|---|---|---|
| NFR-EXP-01 | **ความถูกต้องของเงิน**: คำนวณด้วย decimal เท่านั้น ปัด 2 ตำแหน่ง `ROUND_HALF_UP` ทุกองค์ประกอบ; totals identity บังคับตอนเขียนและรายงานตอนอ่าน | `expenses/domain/logic/expense-totals.logic.ts`, `accounting-documents/domain/logic/accounting-totals.logic.ts`, `accounting-totals.golden.spec.ts` |
| NFR-EXP-02 | **การแยก tenant และสาขา**: ทุก query ผูก `companyId`; ตรวจ branch scope ใน use case; ผู้ไม่มีสิทธิ์ได้ 404 แทน 403 ในทะเบียนคู่ค้า | `assertBranchInScope`, `expense-branch-scope.use-case.spec.ts`, `reimbursement-branch-scope.use-case.spec.ts`, `e2e/branch-scope.spec.ts` |
| NFR-EXP-03 | **Concurrency**: optimistic token (`expectedUpdatedAt`, `version`, snapshot hash) + advisory lock ระดับ transaction (`pg_advisory_xact_lock`) สำหรับ lifecycle ของเอกสาร; serialization failure ตอบ 409 ให้ลองใหม่ | `expense-draft-concurrency.use-case.spec.ts`, `prisma-reimbursement.repository.draft-submit-race.spec.ts`, `sales-document-launch-gate.ts` |
| NFR-EXP-04 | **Idempotency**: คำสั่งสร้าง/จ่าย/ออกเอกสารทุกตัวที่ผู้ใช้อาจกดซ้ำมี key; replay คืนผลเดิม; payload ต่าง → 409 | `EXPENSE_DRAFT_KEY_CONFLICT`, `expense_payment_idempotency_conflict`, `disbursement_command_conflict`, `accounting_*_idempotency_conflict` |
| NFR-EXP-05 | **ความปลอดภัยของไฟล์**: allowlist MIME + นามสกุล + magic bytes; สแกน ClamAV แบบ fail closed ใน production; checksum SHA-256; object key immutable; ไฟล์ลายเซ็น/สลิป/ใบสำคัญจ่ายเป็นเอกสิทธิ์ | ข้อ 4.2 |
| NFR-EXP-06 | **ข้อมูลอ่อนไหว**: เลขบัญชีธนาคารเก็บเข้ารหัส แสดง 4 ตัวท้าย เปิดเต็มผ่าน POST ที่ audit; ห้ามมีเลขบัญชีใน note (`looksLikeAccountNumber`); payload ส่งออกถูก redact; response ไฟล์ตั้ง `Cache-Control: private, no-store` | `reimbursements/domain/logic/payout-destination.logic.ts`, `reimbursement.logic.ts` (`redactPayload`) |
| NFR-EXP-07 | **Audit trail**: ทุกคำสั่งเขียนและการปฏิเสธสำคัญถูกบันทึกพร้อม risk level; ประวัติรายจ่ายอ่านจาก diff ที่เก็บ | `AuditService.log`, `expense-history.logic.ts` |
| NFR-EXP-08 | **การหยุดเขียนชั่วคราว**: `REIMBURSEMENT_WRITE_QUIESCE=true` ทำให้คำสั่งเขียนของใบเบิกตอบ 503 `reimbursement_upgrade_in_progress` พร้อม `Retry-After: 60` (อ่านได้ปกติ; ยกเว้น `draft-actions/:id/cancel`); launch route `expenses/DEFAULT` และ `sales_documents/DEFAULT` ปิดเฉพาะรากใหม่ | `reimbursement-write-quiesce.guard.ts`, `expense-launch-gate.ts` |
| NFR-EXP-09 | **การแยก AI ออกจาก ERP core**: ERP เรียก AI Gateway ผ่าน client ภายใน; AI ไม่เข้าถึง repository โดยตรง; ไม่มี final mutation จาก AI | `expenses/infrastructure/receipt-ocr.client.ts`, `expense-capture-read.client.ts`, `ai-draft/domain/logic/ai-draft-safety.logic.ts` |
| NFR-EXP-10 | **งานเบื้องหลัง**: endpoint ภายใน (`/internal/...`) เป็น `@Public()` แต่ตรวจ `x-worker-token`; drain ตอบทันทีเมื่อ claim งาน; DTO เป็น class เพื่อให้ ValidationPipe (`whitelist` + `forbidNonWhitelisted`) ทำงาน (audit H-23) | `expense-capture-read-internal.controller.ts`, `reimbursement-reconcile-internal.controller.ts`, `ai-draft-internal.controller.ts` |
| NFR-EXP-11 | **การตรวจ input ที่ขอบ HTTP**: body ทุกตัวที่เป็น DTO class ถูกตรวจชนิด ความยาว และ pattern; ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ 400 | `expense.dtos.ts`, `reimbursement.dtos.ts`, `counterparty.controller.ts` |
| NFR-EXP-12 | **ภาษาไทยและเอกสารพิมพ์**: ข้อความถึงผู้ใช้เป็นไทย; ชื่อไฟล์ไทยส่งด้วย RFC 5987; จำนวนเงินตัวอักษรไทย (`thaiBahtText`); วันที่ พ.ศ.; civil date ใช้เขตเวลา Asia/Bangkok | `payment-voucher.logic.ts`, `substitute-receipt.logic.ts` |
| NFR-EXP-13 | **ลำดับ route**: controller ที่มี path คงที่ต้องลงทะเบียนก่อน `:expenseId` (`ExpenseCaptureController` ก่อน `ExpenseController`) | `expenses.module.ts`, คอมเมนต์ใน `expense-capture.controller.ts` |
| NFR-EXP-14 | **ขีดจำกัด**: 200 บรรทัดต่อรายจ่าย, 50 บรรทัดต่อใบเบิก, 30 บรรทัดต่อใบเตรียมจ่าย, 60 ไฟล์/60 MB ต่อ zip หลักฐาน, 20 MB ต่อ workbook, 10,000 id ต่อคำขอส่งออก, `pageSize` ≤ 500 | ค่าคงที่ที่อ้างในแต่ละ FR |

---

## 11. ตาราง API endpoints ทั้งหมด

ทุก path ขึ้นต้นด้วย `/v1/companies/:companyId` ยกเว้นที่ระบุ `/internal/...` คอลัมน์สิทธิ์: "ทั้งหมด:" = `@RequirePermissions`, "ตัวใดตัวหนึ่ง:" = `@RequireAnyPermission` ตัวย่อ `e.` = `expense.`, `r.` = `reimbursement.`, `a.` = `accounting.`

### 11.1 `ExpenseController` — `presentation/http/expense.controller.ts`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/expenses/capture-policy` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.create, e.review | 007 |
| GET `/expenses/wht-income-categories` | e.create | 043 |
| GET `/expenses` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.review | 008 |
| GET `/expenses/shared-evidence` | e.evidence.read | 039 |
| POST `/expenses/accountant-package/bundle-plan` | e.export | 040 |
| POST `/expenses/accountant-package/bundle/:part` | e.export | 040 |
| POST `/expenses/accounting-software-export` | e.export | 041 |
| POST `/expenses/accountant-package` | e.export | 040 |
| POST `/expenses` | e.create | 001 |
| POST `/expenses/receipt-uploads` | e.receipt.upload | 002 |
| DELETE `/expenses/:expenseId` | ตัวใดตัวหนึ่ง: e.delete, e.update | 025 |
| GET `/expenses/:expenseId` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.create, e.review, e.confirm, e.receipt.upload, e.receipt.line_upload | 009 |
| POST `/expenses/:expenseId/payments/slip-upload-intent` | e.payment.record | 026 |
| POST `/expenses/:expenseId/payments/slip-uploads/:attachmentId/complete` | e.payment.record | 026 |
| POST `/expenses/:expenseId/input-vat-decision` | e.review | 018 |
| GET `/expenses/:expenseId/history` | เท่ากับ GET รายละเอียด | 024 |
| GET `/expenses/:expenseId/payment-voucher.pdf` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.review | 028 |
| POST `/expenses/:expenseId/substitute-receipt/evidence-upload` | ตัวใดตัวหนึ่ง: e.review, e.confirm, e.read, e.read_related, e.read_own | 033 |
| POST `/expenses/:expenseId/substitute-receipt/evidence-upload/:attachmentId/complete` | เช่นเดียวกัน | 033 |
| POST `/expenses/:expenseId/substitute-receipt` | เช่นเดียวกัน | 033 |
| PATCH `/expenses/:expenseId/substitute-receipt/:evidenceId` | e.review | 033 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/correct-document` | e.review | 033 |
| GET `/expenses/:expenseId/substitute-receipt/continuations/:workflowId` | e.review | 045 |
| GET `/expenses/:expenseId/substitute-receipt/payers` | ตัวใดตัวหนึ่ง: e.review, e.confirm, e.read, e.read_related, e.read_own | 033 |
| GET `/expenses/:expenseId/substitute-receipt/history` | เช่นเดียวกัน | 033 |
| GET `/expenses/:expenseId/substitute-receipt/:evidenceId/artifact.pdf` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.review, e.confirm | 036 |
| GET `/expenses/:expenseId/substitute-receipt/:evidenceId/artifact-preview` | เช่นเดียวกัน | 036 |
| GET `/expenses/:expenseId/substitute-receipt/:evidenceId/form.pdf` | e.review | 035 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/certify` | ตัวใดตัวหนึ่ง: e.read_related, e.read_own | 034 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/preview` | ตัวใดตัวหนึ่ง: e.read_related, e.read_own | 034 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/paper/upload-intent` | e.review | 035 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/paper/submit` | e.review | 035 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/paper/preview` | ตัวใดตัวหนึ่ง: e.review, e.confirm | 035 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/paper/accept` | e.confirm | 035 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/signature-upload-intent` | ตัวใดตัวหนึ่ง: e.read_related, e.read_own | 034 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/signature-uploads/:attachmentId/complete` | เช่นเดียวกัน | 034 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/approve` | e.confirm | 034 |
| POST `/expenses/:expenseId/substitute-receipt/:evidenceId/supersede` | e.review | 033 |
| POST `/expenses/:expenseId/extraction-request` | ตัวใดตัวหนึ่ง: e.ocr.request, e.review, e.receipt.upload | 004 |
| POST `/expenses/:expenseId/signature-fill` | e.review | 038 |
| PATCH `/expenses/:expenseId` | ตัวใดตัวหนึ่ง: e.update, e.review, e.create, e.receipt.upload, e.receipt.line_upload | 010 |
| POST `/expenses/:expenseId/totals-preview` | ตัวใดตัวหนึ่ง: e.update, e.review | 011 |
| PATCH `/expenses/:expenseId/review-fields` | ตัวใดตัวหนึ่ง: e.review, e.read, e.read_related, e.read_own, e.confirm | 010 |
| POST `/expenses/:expenseId/non-expense-classification-override` | e.review | 015 |
| POST `/expenses/:expenseId/ocr-total-acknowledgement` | e.review | 016 |
| DELETE `/expenses/:expenseId/receipts/:attachmentId` | ตัวใดตัวหนึ่ง: e.update, e.review | 014 |
| POST `/expenses/:expenseId/receipt-uploads/:attachmentId/complete` | ตัวใดตัวหนึ่ง: e.receipt.upload, e.review | 002 |
| GET `/expenses/:expenseId/reviewers` | ตัวใดตัวหนึ่ง: e.update, e.review | 019 |
| POST `/expenses/:expenseId/mark-ready` | e.update | 019 |
| POST `/expenses/:expenseId/reviewer-mark-ready` | e.review | 019 |
| POST `/expenses/:expenseId/confirm` | e.confirm | 020 |
| POST `/expenses/:expenseId/reject` | e.reject | 021 |
| POST `/expenses/:expenseId/void` | e.void | 023 |
| POST `/expenses/:expenseId/reopen` | e.confirm | 022 |
| POST `/expenses/:expenseId/payments/:paymentId/cancel` | e.payment.record | 027 |
| POST `/expenses/:expenseId/payments/:paymentId/confirm-date` | e.payment.record | 027 |
| POST `/expenses/:expenseId/payment` | e.payment.record | 026 |
| POST `/expenses/:expenseId/duplicate-check` | e.review | 017 |
| POST `/expenses/:expenseId/duplicates/:candidateId/dismiss` | e.duplicate.resolve | 017 |
| POST `/expenses/:expenseId/duplicates/:candidateId/confirm` | e.duplicate.resolve | 017 |
| POST `/expenses/:expenseId/buyer-match/confirm` | e.confirm | 018 |
| GET `/expenses/:expenseId/source-posting-input` | e.read | 009 |

### 11.2 `ExpenseCaptureController` และ internal — `expense-capture.controller.ts`, `expense-capture-read-internal.controller.ts`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/expenses/capture-capability` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.review, e.create, e.receipt.upload, e.receipt.line_upload | 003 |
| POST `/expenses/capture-groups` | ตัวใดตัวหนึ่ง: e.receipt.upload, e.receipt.line_upload, e.create | 003 |
| GET `/expenses/capture-groups` | ตัวใดตัวหนึ่ง: e.read, e.read_own, e.review | 003 |
| GET `/expenses/capture-groups/:groupId` | เช่นเดียวกัน | 003 |
| GET `/expenses/capture-groups/:groupId/read-status` | เช่นเดียวกัน | 005 |
| POST `/expenses/capture-groups/:groupId/files` | ตัวใดตัวหนึ่ง: e.receipt.upload, e.receipt.line_upload, e.create, e.review | 003 |
| POST `/expenses/capture-groups/:groupId/files/:fileId/complete` | เช่นเดียวกัน | 003 |
| POST `/expenses/capture-groups/:groupId/files/:fileId/detach` | ตัวใดตัวหนึ่ง: e.update, e.review | 003 |
| POST `/expenses/capture-groups/:groupId/facts` | เช่นเดียวกัน | 003 |
| POST `/expenses/capture-groups/:groupId/review` | เช่นเดียวกัน | 003 |
| POST `/expenses/capture-groups/:groupId/allocations/:allocationId/accept` | เช่นเดียวกัน | 003 |
| POST `/expenses/capture-groups/:groupId/handoff` | ตัวใดตัวหนึ่ง: e.create, e.receipt.upload, e.review | 003 |
| POST `/expenses/capture-groups/:groupId/close` | ตัวใดตัวหนึ่ง: e.update, e.review | 003 |
| GET `/expenses/:expenseId/read-status` | เท่ากับ GET รายละเอียดรายจ่าย | 005 |
| POST `/expenses/:expenseId/capture-group` | ตัวใดตัวหนึ่ง: e.receipt.upload, e.receipt.line_upload, e.create | 003 |
| POST `/internal/expenses/capture-read/drain` | `@Public()` + header `x-worker-token`; body `batchSize` 1..`MAX_CAPTURE_CLAIM_BATCH` | 004 |

### 11.3 หมวด, ใบรับรองแทนใบเสร็จระดับร้าน, ตั้งค่า, ลายเซ็น

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/expense-categories` | ตัวใดตัวหนึ่ง: e.read, e.read_related, e.read_own, e.review, e.create, e.receipt.upload, e.receipt.line_upload | 012 |
| GET `/expense-categories/manage` | e.category.manage | 012 |
| POST `/expense-categories` | e.category.manage | 012 |
| PUT `/expense-categories/:categoryId/accountant-account` | e.category.manage | 013 |
| DELETE `/expense-categories/:categoryId/accountant-account` | e.category.manage | 013 |
| PATCH `/expense-categories/:categoryId` | e.category.manage | 012 |
| GET `/substitute-receipts/:evidenceId/expense` | ตัวใดตัวหนึ่ง: e.review, e.confirm, e.read, e.read_related, e.read_own | 036 |
| GET `/substitute-receipts/candidates` | เช่นเดียวกัน | 036 |
| GET `/substitute-receipts` | เช่นเดียวกัน | 036 |
| GET `/expense-settings/e-wht` | ตัวใดตัวหนึ่ง: company.setup.manage, e.review, e.confirm, e.create, e.update, e.read, e.read_related, e.read_own | 042 |
| PATCH `/expense-settings/e-wht` | company.setup.manage | 042 |
| GET `/expense-settings/substitute-receipt` | company.setup.manage | 037 |
| GET `/expense-settings/substitute-receipt/runtime` | ตัวใดตัวหนึ่ง: e.review, e.confirm, e.read, e.read_related, e.read_own | 037 |
| PATCH `/expense-settings/substitute-receipt` | company.setup.manage | 037 |
| GET `/expense-signatures/images/:attachmentId` | ตัวใดตัวหนึ่ง: `SIGNATURE_OWNER_PERMISSIONS` | 038 |
| GET `/expense-signatures` | เช่นเดียวกัน | 038 |
| POST `/expense-signatures/uploads` | เช่นเดียวกัน | 038 |
| POST `/expense-signatures` | เช่นเดียวกัน | 038 |
| POST `/expense-signatures/:signatureId/archive` | เช่นเดียวกัน | 038 |
| POST `/expense-signatures/:signatureId/derived` | เช่นเดียวกัน | 038 |

### 11.4 `DisbursementVoucherController` — `presentation/http/disbursement-voucher.controller.ts`

ตัวย่อ `d.` = `expense.disbursement.`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/disbursement-vouchers/payee-account` | d.prepare | 029 |
| GET `/disbursement-vouchers/payees` | d.prepare | 029 |
| GET `/disbursement-vouchers/payable-expenses` | d.prepare | 029 |
| GET `/disbursement-vouchers/approvers` | d.prepare | 029 |
| POST `/disbursement-vouchers/from-payment` | d.issue | 031 |
| POST `/disbursement-vouchers/:id/reissue` | d.issue | 031 |
| POST `/disbursement-vouchers` | d.prepare | 029 |
| PUT `/disbursement-vouchers/:id` | d.prepare | 029 |
| DELETE `/disbursement-vouchers/:id` | d.prepare | 029 |
| GET `/disbursement-vouchers` | d.read | 029 |
| GET `/disbursement-vouchers/:id` | d.read | 029 |
| POST `/disbursement-vouchers/:id/submit` | d.prepare | 030 |
| POST `/disbursement-vouchers/:id/remind` | d.prepare | 030 |
| POST `/disbursement-vouchers/:id/approve` | d.approve | 030 |
| POST `/disbursement-vouchers/:id/return` | d.approve | 030 |
| POST `/disbursement-vouchers/:id/withdraw` | ตัวใดตัวหนึ่ง: d.prepare, d.approve | 030 |
| POST `/disbursement-vouchers/:id/cancel` | ตัวใดตัวหนึ่ง: d.prepare, d.approve | 030 |
| POST `/disbursement-vouchers/:id/payee-account/reveal` | ตัวใดตัวหนึ่ง: d.prepare, d.approve, d.pay | 031 |
| GET `/disbursement-vouchers/:id/document.pdf` | d.read | 031 |
| POST `/disbursement-vouchers/:id/pay` | d.pay | 031 |
| GET `/disbursement-vouchers/:id/supporting-files` | d.read | 032 |
| POST `/disbursement-vouchers/:id/supporting-files/slip-upload-intent` | d.prepare | 032 |
| POST `/disbursement-vouchers/:id/supporting-files/slip-uploads/:attachmentId/complete` | d.prepare | 032 |
| POST `/disbursement-vouchers/:id/supporting-files` | d.prepare | 032 |
| DELETE `/disbursement-vouchers/:id/supporting-files/:attachmentId` | d.prepare | 032 |
| GET `/disbursement-vouchers/:id/supporting-files/:attachmentId` | d.read | 032 |
| POST `/disbursement-vouchers/:id/slip-upload-intent` | d.pay | 032 |
| POST `/disbursement-vouchers/:id/slip-uploads/:attachmentId/complete` | d.pay | 032 |
| POST `/disbursement-vouchers/:id/slip` | d.pay | 032 |
| GET `/disbursement-vouchers/:id/slip` | d.read | 032 |

### 11.5 Reimbursements — `reimbursement.controller.ts`, `reimbursement-payout.controller.ts`, `reimbursement-policy.controller.ts`, `reimbursement-reconcile-internal.controller.ts`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/reimbursements/hub` | account.session.read | 051 |
| GET `/reimbursements/approval-queue` | account.session.read | 053 |
| GET `/reimbursements/finance-queue` | ตัวใดตัวหนึ่ง: r.finance_review, r.payment.record | 056 |
| GET `/reimbursements/posting/pending` | r.finance_review | 059 |
| GET `/reimbursements/summary` | ตัวใดตัวหนึ่ง: r.read, r.read_related, r.read_own | 051 |
| GET `/reimbursements/source-options` | ตัวใดตัวหนึ่ง: r.create, r.update_own_draft, r.finance_review | 050 |
| GET `/reimbursements/draft-actions/:actionId` | account.session.read | 068 |
| POST `/reimbursements/draft-actions/:actionId/confirm` | account.session.read | 068 |
| POST `/reimbursements/draft-actions/:actionId/cancel` | account.session.read | 068 |
| GET `/reimbursements` | ตัวใดตัวหนึ่ง: r.read, r.read_related, r.read_own | 051 |
| POST `/reimbursements` | r.create | 050 |
| GET `/reimbursements/:requestId` | account.session.read | 051 |
| POST `/reimbursements/:requestId/internal-notes` | account.session.read | 068 |
| PATCH `/reimbursements/:requestId/internal-notes/:noteId` | account.session.read | 068 |
| DELETE `/reimbursements/:requestId/internal-notes/:noteId` | account.session.read | 068 |
| PATCH `/reimbursements/:requestId` | ตัวใดตัวหนึ่ง: r.update_own_draft, r.finance_review | 050 |
| POST `/reimbursements/:requestId/submit` | r.submit | 052 |
| POST `/reimbursements/:requestId/reopen` | r.update_own_draft | 055 |
| DELETE `/reimbursements/:requestId` | account.session.read | 062 |
| POST `/reimbursements/:requestId/cancel` | ตัวใดตัวหนึ่ง: r.cancel_own, r.finance_review | 062 |
| POST `/reimbursements/:requestId/cancel/withdraw` | เช่นเดียวกัน | 062 |
| POST `/reimbursements/:requestId/approve` | account.session.read (use case: r.approve) | 054 |
| POST `/reimbursements/:requestId/reject` | account.session.read (use case: r.reject) | 054 |
| POST `/reimbursements/:requestId/resume` | account.session.read | 055 |
| POST `/reimbursements/:requestId/finance-review` | ตัวใดตัวหนึ่ง: r.finance_review, r.duplicate.resolve, r.payment.record | 056, 058 |
| POST `/reimbursements/:requestId/payments` | r.payment.record | 059 |
| POST `/reimbursements/:requestId/payments/:paymentId/void` | r.payment.void | 061 |
| POST `/reimbursements/:requestId/payments/slip-upload-intent` | r.payment.record | 060 |
| POST `/reimbursements/:requestId/payments/slip-uploads/:attachmentId/complete` | r.payment.record | 060 |
| POST `/reimbursements/:requestId/payments/:paymentId/slips` | r.payment.record | 060 |
| GET `/reimbursements/:requestId/payments/:paymentId/slips/:attachmentId/download-url` | account.session.read | 060 |
| GET `/reimbursements/:requestId/export` | r.export | 068 |
| POST `/reimbursements/:requestId/claim-form/preview` | ตัวใดตัวหนึ่ง: r.read, r.read_related, r.read_own | 065 |
| POST `/reimbursements/:requestId/claim-form/signature-upload-intent` | เช่นเดียวกัน | 065 |
| POST `/reimbursements/:requestId/claim-form/signature-uploads/:attachmentId/complete` | เช่นเดียวกัน | 065 |
| POST `/reimbursements/:requestId/claim-form/signatures` | เช่นเดียวกัน | 065 |
| POST `/reimbursements/:requestId/claim-form/signed-copies` | เช่นเดียวกัน | 066 |
| GET `/reimbursements/payout-accounts/me/saved` | r.create | 063 |
| POST `/reimbursements/payout-accounts/me/saved` | r.create | 063 |
| DELETE `/reimbursements/payout-accounts/me/saved/:accountId` | r.create | 063 |
| POST `/reimbursements/payout-accounts/me/saved/:accountId/reveal` | r.create | 063 |
| POST `/reimbursements/payout-accounts/me/saved/:accountId/make-default` | r.create | 063 |
| GET `/reimbursements/payout-accounts/me` | r.create | 063 |
| PUT `/reimbursements/payout-accounts/me` | r.create | 063 |
| DELETE `/reimbursements/payout-accounts/me` | r.create | 063 |
| POST `/reimbursements/payout-accounts/me/reveal` | r.create | 063 |
| GET `/reimbursements/payout-accounts/members/:userId` | ตัวใดตัวหนึ่ง: access.employee.read, access.employee.update | 063 |
| PUT `/reimbursements/payout-accounts/members/:userId` | access.employee.update | 063 |
| POST `/reimbursements/:requestId/payout-destination/reveal` | account.session.read | 064 |
| POST `/reimbursements/:requestId/payout-correction` | account.session.read | 064 |
| PUT `/reimbursements/:requestId/payout-destination` | ตัวใดตัวหนึ่ง: r.update_own_draft, r.finance_review | 064 |
| GET `/reimbursement-policy/approver-options` | r.policy.manage | 053 |
| GET `/reimbursement-policy` | ตัวใดตัวหนึ่ง: r.policy.read, r.policy.manage | 067 |
| PUT `/reimbursement-policy` | r.policy.manage | 067 |
| POST `/internal/reimbursements/reconcile` | `@Public()` + worker token | 057 |

### 11.6 Accounting documents — `accounting-documents/presentation/http/*.controller.ts`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| GET `/accounting/counterparties` | a.counterparty.read | 070 |
| GET `/accounting/counterparties/:counterpartyId` | ตัวใดตัวหนึ่ง: a.counterparty.read, a.counterparty.manage, `ADDED_BY_PATH` | 070 |
| POST `/accounting/counterparties` | a.counterparty.manage | 071 |
| PATCH `/accounting/counterparties/:counterpartyId` | ตัวใดตัวหนึ่ง: a.counterparty.read, a.counterparty.manage, `ADDED_BY_PATH` | 071 |
| POST `/accounting/counterparties/:counterpartyId/promote-seen-address` | เช่นเดียวกัน | 073 |
| GET `/accounting/documents` | ตัวใดตัวหนึ่ง: `DOCUMENT_READ_PERMISSIONS` | 074 |
| GET `/accounting/documents/:documentId` | เช่นเดียวกัน | 074 |
| GET `/accounting/documents/:documentId/posting-source` | a.document.read | 074 |
| POST `/accounting/documents` | ตัวใดตัวหนึ่ง: `DOCUMENT_CREATE_PERMISSIONS` | 074 |
| PATCH `/accounting/documents/:documentId` | ตัวใดตัวหนึ่ง: สิทธิ์ update รายชนิด | 074 |
| POST `/accounting/documents/:documentId/issue` | ตัวใดตัวหนึ่ง: `DOCUMENT_ISSUE_PERMISSIONS` | 075 |
| POST `/accounting/documents/:documentId/void` | ตัวใดตัวหนึ่ง: `DOCUMENT_VOID_PERMISSIONS` | 075 |
| POST `/accounting/documents/:documentId/submit-approval` | a.quotation.submit_approval | 075 |
| POST `/accounting/documents/:documentId/approve` | a.quotation.approve | 075 |
| POST `/accounting/documents/:documentId/reject` | a.quotation.approve | 075 |
| POST `/accounting/documents/:documentId/convert` | ตัวใดตัวหนึ่ง: `DOCUMENT_CREATE_PERMISSIONS` | 075 |
| GET `/accounting/payments` | a.payment.read | 076 |
| GET `/accounting/payments/:paymentId` | a.payment.read | 076 |
| POST `/accounting/payments` | a.payment.create | 076 |
| POST `/accounting/payments/:paymentId/void` | a.payment.void | 076 |
| POST `/accounting/simple-income` | ตัวใดตัวหนึ่ง: a.document.create, a.invoice.create | 077 |
| GET `/revenue-categories` | ตัวใดตัวหนึ่ง: a.document.read, a.document.read_related | 077 |
| GET `/revenue-categories/manage` | a.revenue_category.manage | 077 |
| POST `/revenue-categories` | a.revenue_category.manage | 077 |
| PATCH `/revenue-categories/:categoryId` | a.revenue_category.manage | 077 |
| GET `/income-expense-ledger/availability` | ตัวใดตัวหนึ่ง: `SALES_CREATE_PERMISSIONS` | 078 |
| GET `/income-expense-ledger/summary` | ตัวใดตัวหนึ่ง: `LEDGER_READ_PERMISSIONS` | 078 |
| GET `/income-expense-ledger/entries` | เช่นเดียวกัน | 078 |
| GET `/income-expense-ledger/export` | ตัวใดตัวหนึ่ง: `LEDGER_EXPORT_PERMISSIONS` | 078 |

### 11.7 AI draft — `ai-draft/presentation/http/*.controller.ts`

| Method + path | สิทธิ์ | FR |
|---|---|---|
| POST `/ai/suggestions/requests` | ai.suggestion.request | 081 |
| GET `/ai/suggestions` | ai.suggestion.read_own | 083 |
| GET `/ai/suggestions/:id` | ai.suggestion.read_own | 083 |
| POST `/ai/suggestions/:id/actions/:actionId/validate` | ai.draft.review | 084 |
| POST `/ai/suggestions/:id/actions/:actionId/create-source-draft` | ai.draft.create_source_draft | 084 |
| POST `/ai/suggestions/:id/reviews` | ai.suggestion.review | 083 |
| GET `/ai/suggestion-templates` | ai.suggestion.read_own | 080 |
| GET `/ai/provider-status` | ai.suggestion.read_own | 080 |
| POST `/internal/ai/draft-requests/drain` | `@Public()` + worker token | 081 |
| POST `/internal/ai/draft-requests/generate` | `@Public()` + worker token | 081 |

---

## 12. ตาราง web routes

ทุก route อยู่ใต้ `apps/web/app/(workspace)/companies/[companyId]/` (ไฟล์ `page.tsx`) component หลักอยู่ใน `apps/web/src/features/<feature>/`

| Web route | ฟีเจอร์ | component หลัก | แพ็ก |
|---|---|---|---|
| `/expenses` | รายการรายจ่าย | `expenses/ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx` | S/B/P/E |
| `/expenses/upload` | อัปโหลดใบเสร็จ / capture group | `ExpensesPages.tsx`, `ReceiptUploadResult.tsx`, `expense-capture-upload.logic.ts` | S/B/P/E |
| `/expenses/manual` | บันทึกด้วยมือ | `ExpensesPages.tsx`, `manual-expense-entry.logic.ts`, `ManualExpenseEntryNotEnabled.tsx` | S/B/P/E |
| `/expenses/[expenseId]` | รายละเอียด/ตรวจ/ยืนยัน/จ่าย | `ExpenseReviewPage.tsx` และการ์ด `ExpenseInputVatRight.tsx`, `ExpenseCertificateSection.tsx`, `ExpenseDisbursementVoucher.tsx`, `ExpenseHistoryModal.tsx`, `ExpenseSourceDraftCard.tsx`, `PaymentDateConfirmation.tsx` | S/B/P/E |
| `/expenses/categories` | หมวดและรหัสบัญชีนักบัญชี | `ExpensesPages.tsx` | S/B/P/E |
| `/expenses/evidence` | หลักฐานทางบัญชีและส่งออก | `EvidenceBundleDownload.tsx`, `AccountingExportControls.tsx`, `evidence-audit.logic.ts` | S/B/P/E |
| `/expenses/signatures` | ลายเซ็นของฉัน | `SignaturePad.tsx`, `signature-pad.model.ts` | S/B/P/E |
| `/expenses/substitute-receipts` | ฮับใบรับรองแทนใบเสร็จ | `SubstituteReceiptHubPage.tsx` | S/B/P/E |
| `/expenses/substitute-receipts/new` | ตัวช่วยจัดทำ | `SubstituteReceiptWizardPage.tsx` | S/B/P/E |
| `/expenses/substitute-receipts/[evidenceId]` | รายละเอียด/ลงนาม/อนุมัติ | `SubstituteReceiptWizardPage.tsx`, `SubstitutePaperSigningPanel.tsx`, `SubstituteReceiptCancelDialog.tsx` | S/B/P/E |
| `/expenses/disbursement-vouchers` | รายการใบเตรียมจ่าย/ใบสำคัญจ่าย | `expenses/disbursement-vouchers/*` | S/B/P/E |
| `/expenses/disbursement-vouchers/new` | จัดทำใบเตรียมจ่าย | `expenses/disbursement-vouchers/*`, `disbursement-voucher-entry.logic.ts` | S/B/P/E |
| `/expenses/disbursement-vouchers/[id]` | รายละเอียด/อนุมัติ/จ่าย/ไฟล์ | `expenses/disbursement-vouchers/*` | S/B/P/E |
| `/expenses/wht-certificates` | หนังสือรับรอง 50 ทวิ จากรายจ่าย | `WhtCertificatesPage.tsx`, `WhtIssueButton.tsx` | ENTERPRISE_1999 |
| `/settings/substitute-receipt` | นโยบายใบรับรองแทนใบเสร็จ | `SubstituteReceiptSettingsPage.tsx` | S/B/P/E |
| `/settings/e-wht` | สวิตช์ e-WHT | `EWhtSettingsPage.tsx` | S/B/P/E |
| `/reimbursements` | ฮับ/รายการ/คิว/แท็บนโยบาย | `reimbursements/ReimbursementsPages.tsx` | S/B/P/E |
| `/reimbursements/new` | สร้างใบเบิก | `ReimbursementCreatePage.tsx`, `ReimbursementSourceFacts.tsx` | S/B/P/E |
| `/reimbursements/[requestId]` | รายละเอียดแบบ step journey | `ReimbursementJourneyPage.tsx`, `ReimbursementDetailSections.tsx`, `ReimbursementPayout.tsx`, `ReimbursementPayoutCorrection.tsx` | S/B/P/E |
| `/reimbursements/[requestId]/edit` | แก้ร่าง | `ReimbursementCreatePage.tsx` | S/B/P/E |
| `/reimbursements/payout-account` | บัญชีรับเงินของฉัน | `ReimbursementPayoutAccountPage.tsx`, `SavedPayoutAccountsCard.tsx` | S/B/P/E |
| `/reimbursements/draft-actions/[actionId]` | ยืนยันร่างจาก LINE | `ReimbursementDraftActionPage.tsx` | S/B/P/E |
| `/counterparties` | ทะเบียนคู่ค้า | `counterparties/CounterpartiesPage.tsx` | S/B/P/E |
| `/counterparties/[counterpartyId]` | รายละเอียด/แก้คู่ค้า | `CounterpartyDetailPage.tsx`, `CounterpartyFields.tsx` | S/B/P/E |
| `/ai-suggestions` | AI แนะนำ (เมนูบริบท) | `ai-suggestions/AiSuggestionsPages.tsx` | S/B/P/E (template ใช้ไม่ได้จริง ดูข้อ 9) |
| `/user-guide/expenses`, `/user-guide/reimbursements`, `/user-guide/substitute-receipts` | คู่มือผู้ใช้ | — | S/B/P/E |
| `/sales-documents`, `/sales-documents/record-income`, `/sales-documents/revenue-categories`, `/sales`, `/accounting`, `/income-expense-ledger` | เอกสารขาย รายรับ สมุดรายรับ-รายจ่าย | `accounting-documents/AccountingPages.tsx`, `RecordIncomePage.tsx`, `RevenueCategoryPanel.tsx`, `IncomeExpenseLedgerPage.tsx` | ไม่ได้ขาย (ข้อ 16) |

เว็บเรียก API ผ่าน `apps/web/src/features/expenses/expenses.api.ts`, `substitute-receipt.api.ts`, `disbursement-vouchers/disbursement-vouchers.api.ts`, `reimbursements/reimbursements.api.ts`, `reimbursement-payout.api.ts`, `counterparties/counterparties.api.ts`, `ai-suggestions/ai-suggestions.api.ts`, `accounting-documents/accounting-documents.api.ts`

---

## 13. รหัสข้อผิดพลาดทั้งหมด

รูปแบบ body คือ `{ code, message }` ของ NestJS exception (บางตัวมีฟิลด์เสริม เช่น `blocker`, `duplicatePhase`, `duplicateReasons`, `reasonCode`, `periodKey`, `formType`) โค้ดบางจุดยัง throw เป็นข้อความธรรมดา (ไม่มี `code`) — ข้อความเหล่านั้นระบุไว้ใน FR ที่เกี่ยวข้อง รายการด้านล่างได้จากการ grep `code: '…'` และค่าที่ส่งเข้า exception ในไฟล์ที่ไม่ใช่ spec ของแต่ละโมดูล

### 13.1 expenses

| กลุ่ม | รหัส |
|---|---|
| การเข้าถึง/สถานะร้าน | `FREE_EXPENSE_DRAFTS_ONLY` (403), `FREE_EXPENSE_ACCESS_UNAVAILABLE` (503), `company_access_unavailable` (403), `feature_temporarily_unavailable` (403) |
| Concurrency / version | `EXPENSE_UPDATE_VERSION_REQUIRED`, `EXPENSE_UPDATE_VERSION_INVALID`, `EXPENSE_UPDATE_CONFLICT` (409), `EXPENSE_CHANGED_DURING_DELETE` (409), `expense_changed`, `expense_changed_retry`, `expense_stale_reload`, `expense_source_version_changed` (409), `expense_confirmation_source_version_changed` (409), `posting_state_changed` |
| ร่างและ source draft | `EXPENSE_DRAFT_KEY_CONFLICT`, `EXPENSE_DRAFT_DELETED`, `EXPENSE_SOURCE_DRAFT_INCOMPLETE`, `EXPENSE_SOURCE_DRAFT_INVALID`, `EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED`, `EXPENSE_PURPOSE_TEXT_INVALID`, `EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED`, `EXPENSE_DOCUMENT_REVIEW_INCOMPLETE`, `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, `DOCUMENT_TYPE_CHANGED`, `BUYER_MARK_UNDONE` |
| ผู้ขาย | `EXPENSE_VENDOR_NAME_INVALID`, `EXPENSE_VENDOR_NAME_TOO_LONG`, `EXPENSE_VENDOR_ADDRESS_TOO_LONG`, `EXPENSE_VENDOR_BRANCH_CODE_INVALID`, `expense_buyer_match_not_mismatch`, `expense_buyer_match_reason_required` |
| VAT / WHT | `EXPENSE_VAT_OVERRIDE_INVALID`, `EXPENSE_VAT_OVERRIDE_STALE` (409), `EXPENSE_VAT_RECONCILIATION_REQUIRED`, `EXPENSE_VAT_TAX_RATE_CONFLICT`, `EXPENSE_VAT_TAX_TOLERANCE_REQUIRED`, `expense_wht_remittance_invalid`, `expense_wht_category_payee_mismatch`, `expense_e_wht_not_enabled` (422), `expense_ewht_payment_method`, `expense_ewht_cash_payment_exists` |
| สิทธิภาษีซื้อ | `expense_input_vat_decision_required` (403), `input_vat_fixed`, `input_vat_conditions_required`, `input_vat_reason_required`, `input_vat_company_registration_unanswered`, `input_vat_attachment_required`, `input_vat_seller_tax_id_required`, `input_vat_document_number_required`, `input_vat_usable_evidence_required`, `input_vat_company_identity_required`, `input_vat_expense_closed` (409), `input_vat_no_vat_to_claim`, `input_vat_posted_journal_immutable`, `input_vat_not_available_company_not_vat_registered` |
| เลขเอกสาร | `EXPENSE_NUMBER_OWNER_CONFLICT` (409), `expense_void_number_unavailable` (422) |
| ลบ | `EXPENSE_NOT_DELETABLE` (409), `EXPENSE_HAS_LINKED_DATA` (409), `SUBSTITUTE_EVIDENCE_RETENTION_LOCKED` (409), `expense_receipt_removal_locked` |
| ส่งตรวจ / แก้ไขหลังยืนยัน / ยกเลิก | `expense_reviewer_ineligible`, `expense_correction_blocked`, `expense_correction_branch_forbidden` (403), `expense_correction_not_found` (404), `expense_correction_permission_missing`, `expense_correction_source_changed` (409), `expense_correction_web_required` (403), `expense_void_reason_required`, `expense_void_permission_missing`, `expense_not_voidable`, `expense_belongs_to_reimbursement`, `expense_certificate_attestation_required`, `certificate_issued`, `certificate_permission_missing`, `posting_unresolved` (422), `accounting_period_locked` (409), `tax_period_locked` (409) |
| การจ่าย | `expense_payment_not_confirmed`, `expense_payment_invalid_key`, `expense_payment_invalid_date`, `expense_payment_future_date`, `expense_payment_invalid_method`, `expense_payment_invalid_reference`, `expense_payment_exceeds_outstanding`, `expense_paid_exceeds_payable`, `expense_payment_idempotency_conflict`, `expense_payment_cancelled_replay` (409), `expense_payment_already_cancelled`, `expense_payment_changed`, `expense_payment_correction_blocked`, `expense_payment_date_already_confirmed`, `expense_payment_slip_invalid`, `expense_settled_via_reimbursement` (422), `claim_expense_settles_via_reimbursement`, `expense_disbursement_reserved` (409), `payment_slip_invalid` |
| OCR / โควตา | `receipt_quota_exceeded` (409), `FREE_DOCUMENTS_IN_FLIGHT` (409), `demo_read_limit_reached` (403), `CONTENT_REJECTED`, `CONTENT_UNINSPECTABLE` |
| Capture group | `expense_capture_allocation_blocked`, `expense_capture_facts_unavailable`, `expense_capture_group_closed`, `expense_capture_handoff_consumed`, `expense_capture_no_evidence`, `expense_capture_payer_forbidden`, `expense_capture_payer_invalid`, `expense_capture_read_pending`, `expense_capture_review_input_invalid`, `expense_capture_tax_review_forbidden` |
| ใบรับรองแทนใบเสร็จ | `substitute_capture_allocation_superseded`, `substitute_capture_document_mismatch`, `substitute_capture_funding_route_mismatch`, `substitute_capture_unpaid_evidence`, `substitute_certified_artifact_checksum_mismatch`, `substitute_edit_requires_cancellation`, `substitute_evidence_doc_type_locked`, `substitute_evidence_expense_confirmed`, `substitute_evidence_idempotency_conflict`, `substitute_evidence_locks_expense`, `substitute_evidence_locks_lines`, `substitute_evidence_nonclaimable`, `substitute_evidence_overlap`, `substitute_evidence_stale`, `substitute_evidence_unavailable`, `substitute_existing_payment_details_mismatch`, `substitute_expense_changed`, `substitute_facts_incomplete`, `substitute_full_payment_required`, `substitute_funding_source_required`, `substitute_payment_evidence_invalid`, `substitute_payment_month_confirmation_required`, `substitute_personal_settles_via_reimbursement`, `substitute_print_artifact_unavailable`, `substitute_print_history_unavailable`, `substitute_receipt_ewht_payment_method`, `substitute_receipt_line_description_too_long`, `substitute_receipt_too_many_lines`, `substitute_source_has_live_claim`, `substitute_wet_signed_scan_checksum_mismatch`, `substitute_wet_signed_scan_not_linkable`, `substitute_wet_signed_scan_not_renderable`, `valid_receipt_normal_path`, `classification_ineligible`, `document_kind_ineligible`, `source_type_ineligible`, `expense_status_ineligible`, `tax_evidence_nonclaimable`, `tax_evidence_review_required`, `reviewed_category_required`, `reviewed_items_required`, `reviewed_total_required`, `check_bill_route_ineligible`, `check_bill_route_required` |
| LINE | `LINE_RECEIPT_CONTINUATION_STALE`, `LINE_SUBSTITUTE_CONTINUATION_STALE` |
| ส่งออก | `accounting_export_confirmed_only` (422), `expense_category_account_unmapped`, `currency_not_supported` |
| ใบเตรียมจ่าย/ใบสำคัญจ่าย (จาก `packages/contracts/src/disbursement-vouchers.ts`) | `disbursement_invalid_input`, `disbursement_lines_required`, `disbursement_too_many_lines`, `disbursement_duplicate_expense`, `disbursement_expense_unreadable`, `disbursement_branch_mismatch`, `disbursement_payee_confirmation_required`, `disbursement_amount_invalid`, `disbursement_total_overflow`, `disbursement_version_conflict`, `disbursement_not_draft`, `disbursement_numbered_delete`, `disbursement_command_conflict`, `disbursement_permission_denied` (403), `disbursement_line_session_denied`, `disbursement_not_found`, `disbursement_status_changed` (409), `disbursement_approver_ineligible`, `disbursement_return_reason_required`, `disbursement_cancel_reason_required`, `disbursement_source_changed`, `disbursement_payment_source_changed`, `disbursement_payment_key_conflict`, `disbursement_payment_method_required`, `disbursement_payment_retry`, `disbursement_changed_retry`, `disbursement_reminder_cooldown` (409), `disbursement_ewht_planned_method`, `disbursement_expense_reserved`, `disbursement_supporting_frozen`, `disbursement_supporting_missing`, `disbursement_supporting_invalid`, `disbursement_supporting_not_owned`, `disbursement_slip_missing`, `disbursement_slip_invalid`, `disbursement_slip_not_owned`, `disbursement_slip_status`, `disbursement_file_link_outside`, `disbursement_slip_link_conflict`, `disbursement_file_general_download_denied`, `disbursement_file_retained`, `disbursement_file_pending`, `disbursement_file_unavailable`, `disbursement_signature_unavailable`, `disbursement_print_unsubmitted`, `disbursement_account_number_invalid`, `disbursement_account_bank_required`, `disbursement_account_source_denied`, `disbursement_account_source_mismatch`, `disbursement_account_missing`, `disbursement_issue_claim`, `disbursement_issue_payment_cancelled`, `disbursement_issue_payment_not_found`, `disbursement_reissue_empty` |

### 13.2 reimbursements

| กลุ่ม | รหัส |
|---|---|
| ระบบ | `reimbursement_upgrade_in_progress` (503, `Retry-After: 60`) |
| ร่าง/ตรวจ input | `reason_required`, `lines_required`, `line_description_required`, `line_category_required`, `line_incurred_date_required`, `line_amount_required`, `line_amount_must_be_positive`, `amount_must_be_positive`, `reimbursement_draft_changed` (409), `reimbursement_changed`, `reimbursement_source_changed`, `reimbursement_source_review_required` (422), `reimbursement_source_version_changed` (409), `REIMBURSEMENT_EVIDENCE_BRANCH_MISMATCH`, `reimbursement_list_bucket_invalid`, `internal_note_body_invalid` |
| ส่ง/อนุมัติ | `reimbursement_policy_inactive` (422), `missing_receipt_reason_required`, `duplicate_unresolved` (422), `duplicate_confirmed`, `payout_destination_changed`, `reimbursement_document_number_unavailable`, `invalid_status_transition`, `not_eligible_approver` (403), `self_approval_denied`, `stale_approval_snapshot` (409), `rejection_reason_required`, `note_contains_account_number`, `reimbursement_resume_not_allowed`, `invalid_reimbursement_policy_snapshot` |
| ตรวจการเงิน/จ่าย | `invalid_finance_decision`, `finance_review_note_too_long`, `finance_correction_reason_required`, `finance_review_required`, `duplicate_resolution_reason_required`, `payment_amount_invalid`, `payment_over_approved_amount`, `partial_payment_not_allowed`, `payment_reference_required`, `payment_slip_required`, `payment_date_invalid`, `payment_idempotency_key_invalid`, `reimbursement_payment_already_recorded`, `reimbursement_payment_number_conflict`, `reimbursement_payment_source_changed`, `reimbursement_payment_changed`, `reimbursement_payment_bank_reconciled`, `void_reason_required`, `payment_slip_invalid`, `payment_slip_access_denied` (403), `accounting_period_locked`, `expense_not_voidable`, `reimbursement_projection_authority_mismatch` (403) |
| ยกเลิก | `cancellation_reason_too_short`, `reason_too_short`, `reimbursement_cancellation_already_pending`, `reimbursement_cancellation_pending`, `reimbursement_cancellation_certificate_attestation_required`, `reimbursement_cancellation_certificate_issued`, `reimbursement_cancellation_certificate_permission_missing`, `reimbursement_cancellation_tax_period_locked`, `certificate_attestation_required`, `certificate_permission_missing`, `branch_has_open_reimbursements` |
| บัญชีรับเงิน | `payout_correction_in_progress`, `payout_correction_reason_required`, `payout_correction_note_too_long`, `payout_correction_name_mismatch_third_party`, และเหตุผลปฏิเสธการกรอกแทน `target_not_active`, `target_manages_people`, `outside_editor_branch_scope` |
| แบบฟอร์ม/ลายเซ็น | `claim_signature_role_not_eligible` (403), `claim_signature_attachment_invalid`, `claim_signature_too_large`, `claim_signature_checksum_mismatch` (409), `claim_signature_bytes_mismatch`, `claim_signature_must_be_png_or_jpeg_max_2mb`, `claim_signature_upload_not_found`, `claim_saved_signature_required`, `claim_signature_unreadable`, `stale_claim_snapshot` (409), `claim_form_requires_submitted` (422), `claim_form_signed_copy_denied` (403), `claim_form_signed_copy_attachment_invalid`, `claim_form_signed_copy_must_be_pdf_or_image` |
| นโยบาย | `invalid_duplicate_policy`, `invalid_threshold`, `invalid_sla_hours`, `approver_role_required`, `approver_role_not_eligible`, `reimbursement_approver_not_ready` |

### 13.3 accounting-documents

`accounting_document_changed`, `accounting_document_create_idempotency_conflict`, `accounting_document_already_converted`, `accounting_active_child_document_must_be_voided`, `accounting_active_receipt_must_be_voided`, `accounting_receipt_already_exists` (409), `accounting_tax_invoice_already_exists` (409), `accounting_payment_idempotency_conflict` (409), `accounting_payment_state_changed`, `accounting_period_locked`, `tax_period_locked`, `posting_state_changed`, `simple_income_idempotency_conflict`, `counterparty_address_too_long`, `counterparty_branch_code_invalid`, `counterparty_conflict` (409), `output_tax_code_line_mismatch`, `feature_temporarily_unavailable` (403)

### 13.4 ai-draft

`PROVIDER_DISABLED`, `GATEWAY_UNREACHABLE`, `NO_EVIDENCE`, `ai_suggestion_needs_data`, `ai_source_draft_unavailable` (422)

---

## 14. การทดสอบที่ครอบคลุม

จำนวนไฟล์ spec ต่อโมดูล (นับจาก `find … -name '*.spec.ts'`): `expenses` 91, `reimbursements` 25, `accounting-documents` 23, `ai-draft` 12 ฝั่งเว็บมีไฟล์ test/spec 98 ไฟล์ใน `apps/web/src/features/{expenses,reimbursements,counterparties}` ไฟล์ `*.pg.spec.ts` คือการทดสอบกับ PostgreSQL จริง

### 14.1 expenses (`apps/api/src/modules/expenses/`)

| ระดับ | ไฟล์ (ชื่อฐาน, ต่อท้าย `.spec.ts`) |
|---|---|
| domain logic | `buyer-as-printed.logic`, `expense-auto-post.logic`, `expense-capture-allocation.logic`, `expense-capture-assembly.logic`, `expense-capture-facts.logic`, `expense-capture-fields.logic`, `expense-capture-handoff.logic`, `expense-capture-policy.logic`, `expense-capture-preprocess.logic`, `expense-capture.logic`, `expense-document.logic`, `expense-draft-amount-validation.logic`, `expense-duplicate.logic`, `expense-export.logic`, `expense-source-draft.logic`, `expense-status.logic`, `expense-totals.logic`, `expense-vendor-identity.logic`, `line-correction.logic`, `line-draft-update.logic`, `line-expense-draft-conversation.logic`, `line-receipt-branch.logic`, `payment-voucher.logic`, `substitute-receipt-pdf.logic`, `substitute-receipt.logic` |
| use cases / services | `delete-expense.use-case`, `expense-branch-scope.use-case`, `expense-capture-group.use-case`, `expense-capture-handoff.use-case`, `expense-capture-policy.use-case`, `expense-capture-read-runner.service`, `expense-capture-read-status.use-case`, `expense-capture-review.use-case`, `expense-category-bootstrap.service`, `expense-document.use-case`, `expense-draft-ai-missing-fields.use-case`, `expense-draft-amount-validation.use-case`, `expense-draft-concurrency.use-case`, `expense-draft-vat-decouple.use-case`, `expense-duplicate-detection`, `expense-extraction.use-case`, `expense-free-access.use-case`, `expense-launch-gate`, `expense-related-access.use-case`, `expense-transaction-tax.service`, `expense-upload.use-case`, `expense-vendor-address.use-case`, `expense-vendor-counterparty-autosave.use-case`, `line-correction.use-case`, `line-draft-update.security`, `line-expense-draft-conversation.use-case`, `line-substitute-receipt-continuation.use-case`, `receipt-ocr-apply.service`, `record-expense-payment.use-case`, `remove-expense-receipt.use-case`, `substitute-receipt-capture.use-case`, `substitute-receipt-download.use-case`, `substitute-receipt-payer-access.use-case`, `substitute-receipt-policy.use-case`, `substitute-receipt-signature-queue.use-case`, `substitute-receipt.use-case`, `void-expense-true-reversal.use-case` |
| repository / infrastructure | `expense-capture-read.client`, `expense-evidence-sources`, `prisma-expense.repository.atomic-confirm`, `.branch`, `.duplicate-resolve`, `.line-continuation`, `.payment`, `.posting-source`, `.substitute-number`, `.substitute-payment`, `.tax-snapshot`, `.vendor-address-filter`, `.void` |
| PostgreSQL (`.pg`) | `expense-capture-certificate.pg`, `expense-capture-handoff.pg`, `expense-capture-read.pg`, `expense-capture.pg`, `expense-line-charge-kind.pg`, `expense-number.pg`, `expense-source-draft.pg`, `line-draft-update.pg`, `receipt-truth.pg`, `receipt-upload-source.pg`, `substitute-expense-edit.pg`, `substitute-funding.pg`, `substitute-receipt-signature-queue.pg` |
| อื่น ๆ | `expense-capture-compatibility`, `expense-capture-lane-parity`, `expense.dtos` |

### 14.2 reimbursements, accounting-documents, ai-draft

| โมดูล | ไฟล์ |
|---|---|
| reimbursements | `application/services/materialize-claim-expenses.service`, `reimbursement-evidence.service`, `reimbursement-projection-reconciler.service`; `application/use-cases/line-reimbursement-draft.use-case`, `reimbursement-approval-backlog.use-case`, `reimbursement-approval.use-case`, `reimbursement-branch-scope.use-case`, `reimbursement-claim-form.use-case`, `reimbursement-claim-signature.use-case`, `reimbursement-finance.use-case`, `reimbursement-payment-posting.use-case`, `reimbursement-related-access.use-case`, `reimbursement-request.use-case`, `void-reimbursement-payment-reversal.use-case`; `domain/logic/claim-form.logic`, `reimbursement.logic`; `domain/reimbursement.constants`; `infrastructure/prisma-reimbursement.repository.atomic-lines`, `.draft-submit-race`, `.payment-mirror`, `reimbursement-source`; `line-reimbursement-draft.pg`; `presentation/http/reimbursement-draft-action.controller`, `reimbursement-write-quiesce.guard`, `reimbursement.dtos` |
| accounting-documents | `application/services/revenue-category-bootstrap.service`; `application/use-cases/counterparty-registry.use-case`, `document-transaction-tax.use-case`, `ensure-vendor-counterparty-from-expense.use-case`, `issue-document-number-release.use-case`, `money-input-validation.use-case`, `revenue-category.use-case`, `sum-received-payments-by-counterparty.use-case`, `update-document.use-case`, `void-true-reversal.use-case`; `domain/logic/accounting-money-validation.logic`, `accounting-status.logic`, `accounting-totals.golden`, `accounting-totals.logic`, `vendor-counterparty-match.logic`; `infrastructure/counterparty-type-promotion`, `prisma-accounting.repository.atomic-issue`, `.conversion`, `.counterparty-usage`, `.draft-update`, `.related-access`, `.void`; `presentation/http/accounting-money.dtos` |
| ai-draft | `application/source-state.service`; `application/use-cases/ai-suggestion-review.use-case`, `create-draft-request.use-case`, `drain-draft-requests.use-case`, `generate-suggestion.use-case`, `line-ai-suggestion.use-case`; `domain/logic/ai-draft-idempotency.logic`, `ai-draft-permission.logic`, `ai-draft-safety.logic`, `ai-draft-status.logic`, `line-ai-suggestion.logic`; `presentation/http/ai-draft-internal.controller` |

### 14.3 E2E (Playwright, `e2e/`)

`expenses.spec.ts`, `expense-capture-intake.spec.ts`, `expense-capture-intake.evidence.spec.ts`, `expense-number-save.spec.ts`, `expense-running-number.spec.ts`, `manual-expense-web-entry.spec.ts`, `receipt-draft-continuity.spec.ts`, `substitute-cancelled-view-only.spec.ts`, `substitute-editable-navigation.spec.ts`, `reimbursements.spec.ts`, `reimbursement-receipt.spec.ts`, `counterparties.spec.ts`, `ai-suggestions.spec.ts`, `accounting.spec.ts`, `income-expense-ledger.spec.ts`, `branch-scope.spec.ts` และ journey: `journeys/claim-declined-then-paid.journey.spec.ts`, `journeys/expense-input-vat-right.journey.spec.ts`, `journeys/no-receipt-certificate.journey.spec.ts`, `journeys/paid-expense-reopened.journey.spec.ts`, `journeys/staff-receipt-from-phone.journey.spec.ts`, `journeys/voucher-supporting-files.journey.spec.ts`

### 14.4 Workers ที่เกี่ยวข้อง (`apps/workers/src/modules/`)

| Worker | เรียก endpoint | มี spec |
|---|---|---|
| `expense-capture-read/expense-capture-read-worker.ts` | `POST /internal/expenses/capture-read/drain` | ไม่พบ |
| `reimbursement-reconcile/reimbursement-reconcile-worker.ts` | `POST /internal/reimbursements/reconcile` | ไม่พบ |
| `ai-draft/ai-draft-worker.ts` | `POST /internal/ai/draft-requests/drain` | ไม่พบ |
| `expense-auto-post/expense-auto-post-worker.ts` | drain การลงบัญชีรายจ่าย (นอกขอบเขตแพ็ก) | `expense-auto-post-worker.spec.ts` |

---

## 15. มีใน spec/คำขอ แต่ไม่พบในโค้ด และสิ่งที่ยืนยันไม่ได้

### 15.1 มีในคำขอ แต่ไม่พบในโค้ด

| หัวข้อ | ผลการตรวจ |
|---|---|
| เงินทดรองจ่าย (cash advance) และการเคลียร์เงินทดรอง | **ไม่พบ** model, endpoint หรือ use case ในโมดูล `reimbursements` หรือ `expenses` (grep `cash.?advance`, `เงินทดรอง`, `advance_clear` ไม่มีผลในโค้ดที่ไม่ใช่ spec ของสองโมดูล) สิ่งที่ใกล้เคียงที่สุดคือแหล่งเงิน `PERSONAL_ADVANCE` ของใบรับรองแทนใบเสร็จ (พนักงานสำรองจ่ายเต็มจำนวนแล้วเบิกคืนผ่านใบเบิก) |
| งบประมาณ / วงเงินค่าใช้จ่าย (budgets / spending limits) | **ไม่พบ** ในโมดูลทั้งสี่ ขีดจำกัดที่มีคือโควตาใบเสร็จของแพ็ก งบ AI และเกณฑ์ยอดที่ต้องอนุมัติของใบเบิก (`approvalRequiredFromAmount`) |
| PDF ของเอกสารบัญชี (accounting documents) และการพิมพ์เอกสารบัญชีที่ยกเลิก | **ไม่พบ** ตัวสร้าง PDF ใน `accounting-documents` และไม่พบคำสั่งพิมพ์ใน `apps/web/src/features/accounting-documents/AccountingPages.tsx` การพิมพ์ฉบับยกเลิกมีเฉพาะใบรับรองแทนใบเสร็จ (FR-EXP-036, FR-EXP-079) |
| การอนุมัติใบเบิกหลายขั้น (multi-step approval chain) | "หลายขั้น" ในโค้ดหมายถึงลำดับ ส่ง → อนุมัติ → (ตรวจการเงิน ถ้าเปิด) → จ่าย → ลงนาม นโยบายและ policy snapshot มีเส้นทางผู้อนุมัติ **เส้นเดียว** (`route` เดียว, เกณฑ์ยอดเดียว) จึงมีขั้นอนุมัติของคนหนึ่งขั้นต่อรอบการส่ง (บวกรอบใหม่เมื่อแก้บัญชีรับเงิน) ไม่พบการกำหนดผู้อนุมัติหลายระดับตามวงเงิน — ข้อนี้อนุมานจากรูปของ snapshot ไม่ได้อ่าน repository ที่สร้าง step ทุกบรรทัด |
| จ่ายใบเบิกบางส่วน | มีสถานะ `PARTIALLY_PAID` ใน enum และตาราง transition แต่ `validatePaymentRecording` ปฏิเสธด้วย `partial_payment_not_allowed` |
| โหมดผู้อนุมัติ `DIRECT_MANAGER` | มีใน enum `ReimbursementApproverMode` แต่ parser ของ policy snapshot ยอมรับเฉพาะ `MANAGER_ROLE`, `OWNER_ROLE`, `CUSTOM_ROLE` และเส้นทาง `CUSTOM_USER` — ไม่พบการ resolve หัวหน้าโดยตรง |
| ลายเซ็นที่ต้องให้เจ้าของอนุมัติ (`PENDING_OWNER_APPROVAL`, `REJECTED`) | มีใน enum `SignatureAssetStatus` แต่โค้ดปัจจุบันสร้างลายเซ็นเป็น `ACTIVE` ทันที (การตัดสินใจเจ้าของ 2026-08-20 ตามคอมเมนต์ใน `signature-asset.use-case.ts`) |
| template AI สำหรับร่างรายจ่าย/ใบเบิก | ไม่มีใน `ai-draft-template-catalog.ts` (มี 5 template ของ CFO/CRM/Inventory/Tax/Workflow) และ adapter สร้างร่างต้นทางต่อจริงเพียง CRM follow-up กับ action ที่ระบบเป็นเจ้าของเอง |

### 15.2 สิ่งที่ยืนยันได้เพียงบางส่วน

เอกสารนี้อ่าน controller, DTO, domain logic และโครงของ use case ทุกตัว แต่ไม่ได้อ่านทุกบรรทัดของไฟล์ขนาดใหญ่ต่อไปนี้ รายละเอียดเชิงลึกจึงยืนยันระดับโครงสร้าง ชื่อ endpoint รหัสข้อผิดพลาด และกฎที่มองเห็นจาก logic เท่านั้น

| ไฟล์ | สิ่งที่ยังไม่ได้ยืนยันทีละบรรทัด |
|---|---|
| `expenses/infrastructure/prisma-expense.repository.ts` (5,209 บรรทัด) | รายละเอียด transaction ของ void/reopen/payment และ query ของรายการ |
| `expenses/application/use-cases/substitute-receipt.use-case.ts` (1,930) และ `line-substitute-receipt-continuation.use-case.ts` (2,531) | เงื่อนไขย่อยของแต่ละรหัส `substitute_*` และ flow ต่อเนื่องจาก LINE |
| `expenses/application/use-cases/disbursement-voucher.use-case.ts` (894) | ระยะเวลา cooldown ของการเตือน และรายละเอียดการ snapshot ลายเซ็น |
| `expenses/application/use-cases/expense-capture-group.use-case.ts`, `expense-capture-review.use-case.ts`, `expense-capture-handoff.use-case.ts` และ logic `expense-capture-*.logic.ts` | กฎการแบ่ง allocation และเงื่อนไข handoff ไปใบเบิก |
| `expenses/application/services/receipt-ocr-apply.service.ts` (1,470) | กฎการ map ผล OCR ลงฟิลด์ทีละตัว |
| `expenses/domain/logic/expense-vat-reconciliation.logic.ts` (561) | ลำดับการเลือกแหล่ง VAT ในทุกกรณี (ยืนยันเฉพาะค่า tolerance 0.05 และเส้นทาง override) |
| `expenses/domain/logic/expense-duplicate.logic.ts` | การจับคู่คะแนน +30/+25/+20 กับเกณฑ์แต่ละตัว (ยืนยันเฉพาะ +40 checksum และ +35 perceptual hash) |
| `reimbursements/infrastructure/prisma-reimbursement.repository.ts` (5,062) และ `reimbursement-payout.ts` (855) | รายละเอียดการ freeze ปลายทางรับเงินและ payment mirror |
| `reimbursements/application/use-cases/reimbursement-request.use-case.ts` ส่วน cancel (บรรทัด 1076–1290) | ความยาวขั้นต่ำของเหตุผลยกเลิก และลำดับ 2 ระยะของการยกเลิก |
| transition `PENDING_APPROVAL → DRAFT` และ `READY_FOR_PAYMENT → FINANCE_REVIEW` ของใบเบิก | มีใน `ALLOWED_TRANSITIONS` แต่ไม่ได้ยืนยัน endpoint ที่เรียก |
| HTTP status ของรหัสข้อผิดพลาดที่ไม่ได้ระบุในข้อ 13 | ระบุเฉพาะตัวที่เห็น exception class ชัดเจน |
| การผูก permission เข้ากับ role และ capability pack | อยู่นอกโมดูลที่ตรวจ (ดูเอกสาร AREA สิทธิ์ผู้ใช้) |
| ไม่พบ unit spec เฉพาะของ `disbursement-voucher.use-case.ts`, `disbursement-voucher.logic.ts`, `signature-asset.use-case.ts`, `expense-evidence.use-case.ts`, `reimbursement-policy.use-case.ts`, `reimbursement-payout*.use-case.ts`, `payout-destination.logic.ts` ในรายชื่อไฟล์ spec ของโมดูล | อาจถูกครอบคลุมโดย spec อื่นหรือ E2E; ไม่ได้ยืนยัน |

---

## 16. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

| รายการ | เหตุผล | ที่อยู่โค้ด |
|---|---|---|
| เอกสารขาย: ใบเสนอราคา ใบแจ้งหนี้ ใบวางบิล ใบเสร็จ ใบกำกับภาษี ใบลดหนี้ ใบเพิ่มหนี้ | feature `sales_documents` ไม่อยู่ใน `TIER_FEATURE_PRESETS`; binding `salesdoc`/`sales`/`accounting` เป็น `planned` | `accounting-documents/application/use-cases/document.use-case.ts`, web `/sales-documents`, `/sales`, `/accounting` |
| รับชำระเงินจากลูกค้า | เช่นเดียวกัน | `accounting-documents/application/use-cases/payment.use-case.ts` |
| บันทึกรายรับอย่างง่าย และหมวดรายรับ | เช่นเดียวกัน | `record-simple-income.use-case.ts`, `revenue-category.use-case.ts`, web `/sales-documents/record-income`, `/sales-documents/revenue-categories` |
| สมุดรายรับ-รายจ่าย | ต้องมีสิทธิ์ฝั่งขาย | `income-expense-ledger.use-case.ts`, web `/income-expense-ledger` |
| ลงบัญชีรายจ่ายอัตโนมัติ (auto-post to ledger) | feature `expense_auto_post` ต้องมี `double_entry_ledger` ซึ่งไม่อยู่ในแพ็กใด และ preset `full` ยังตัด `expense_auto_post` ออก; ในแพ็กที่ขาย `postingStatus` ของรายจ่ายที่ยืนยันจะค้าง `pending` โดยไม่มีผลต่อผู้ใช้ | `expenses/domain/logic/expense-auto-post.logic.ts` (blocker: `NO_ACTIVE_EVIDENCE`, `TAX_EVIDENCE_NEEDS_REVIEW`, `NOT_TAX_EVIDENCE`, `VENDOR_NAME_MISSING`), `apps/workers/src/modules/expense-auto-post/` |
| Posting ของการจ่ายใบเบิกเข้าบัญชีแยกประเภท | ขึ้นกับ `double_entry_ledger` | `reimbursements/application/use-cases/reimbursement-finance.use-case.ts` (`ListUnpostedReimbursementPaymentsUseCase`), web `ClaimPaymentPosting.tsx` |
| template ของ ai-draft ทั้ง 5 ตัว และการสร้างร่างต้นทางจากคำแนะนำ | ต้องการสิทธิ์ของโมดูล banking / crm / inventory / tax / workflow ที่ไม่ได้ขาย | `ai-draft/domain/ai-draft-template-catalog.ts` |
| สร้างร่างใบเสนอราคาจาก AI (`CREATE_ACCOUNTING_QUOTATION_DRAFT`) | ไม่มี adapter และ `sales_documents` ไม่ได้ขาย | `ai-draft/application/adapters/source-draft-adapter.service.ts` |
| สนทนาเติมร่างรายจ่ายทาง LINE แบบ conversation | ปิดโดย default (`LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED = false`) | `expenses/application/use-cases/line-expense-draft-conversation.use-case.ts` |
