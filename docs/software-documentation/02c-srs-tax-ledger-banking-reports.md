# 02c — ข้อกำหนดความต้องการซอฟต์แวร์ (SRS): ภาษี · บัญชีแยกประเภท · ธนาคาร · รายงาน · ชุดส่งผู้ทำบัญชี

**วัตถุประสงค์** เอกสารนี้เป็นบันทึกถาวรของข้อกำหนดเชิงหน้าที่ (functional requirements) สำหรับโมดูล `tax` (ภาษีหัก ณ ที่จ่าย, ประเภทเงินได้, หนังสือรับรอง 50 ทวิ, แบบ ภ.ง.ด.3 / ภ.ง.ด.53 และใบแนบ, VAT / รายงานภาษีซื้อ, tax code, ขั้นตอนตั้งค่าภาษี, e-WHT), `ledger` (ผังบัญชี, การลงบัญชีคู่, กฎลงบัญชีอัตโนมัติ, การปิดงวด), `banking` (บัญชีธนาคาร, statement, กระทบยอด), `reports` (รายงานทุกชุด ตัวกรอง คอลัมน์ การคำนวณ รูปแบบส่งออก) และ "ชุดส่งผู้ทำบัญชี / ไฟล์นำเข้าโปรแกรมบัญชี" (โครงไฟล์, PDF หนึ่งไฟล์ต่อหนึ่งรายการ, กฎตั้งชื่อ) ของ MangmeePlus / WatchDog-BMS ทุกสูตรคำนวณระบุสูตร การปัดเศษ และไฟล์ที่สูตรนั้นอยู่ ทุกไฟล์ส่งออกระบุโครงคอลัมน์ ทีมในอนาคตต้องสามารถสร้างระบบขึ้นใหม่จากเอกสารนี้ร่วมกับ source code ที่เก็บถาวรไว้

**ที่มา** ตรวจจาก checkout `closeout-docs-main` (clean `origin/main`, commit `08850deaf`, 2026-11-10) เท่านั้น — **โค้ดคือความจริง** เอกสารใน `docs/` ใช้เป็นข้อมูลประกอบเจตนา

**รหัสพื้นที่ (AREA)** `TAX` — functional requirement ใช้รูป `FR-TAX-<nnn>`, non-functional ใช้ `NFR-<nnn>` (ในเอกสารนี้ใช้ช่วง `NFR-301`–`NFR-312` เพื่อไม่ชนกับเอกสารอื่น ให้ผู้รวม traceability matrix ปรับเลขได้)

---

## สารบัญ

1. [ขอบเขตและสิทธิ์ตามแพ็ก (ข้อค้นพบสำคัญ)](#1-ขอบเขตและสิทธิ์ตามแพ็ก-ข้อค้นพบสำคัญ)
2. [แนวคิดร่วม: สถานะ, permission, เลขที่เอกสาร, ถ้อยคำ](#2-แนวคิดร่วม)
3. [ส่วน A — ภาษีหัก ณ ที่จ่ายที่ขายในแพ็ก (FR-TAX-001 … 029)](#3-ส่วน-a--ภาษีหัก-ณ-ที่จ่าย)
4. [ส่วน B — ชุดส่งผู้ทำบัญชีและไฟล์นำเข้าโปรแกรมบัญชี (FR-TAX-030 … 037)](#4-ส่วน-b--ชุดส่งผู้ทำบัญชี)
5. [ส่วน C — โครงสร้างพื้นฐานภาษี/บัญชีที่ทำงานกับทุกร้าน (FR-TAX-040 … 041)](#5-ส่วน-c--โครงสร้างพื้นฐาน)
6. [ส่วน D — โมดูลที่มีโค้ดครบแต่ไม่อยู่ใน preset ของแพ็กใด: Tax workspace (FR-TAX-050 … 066)](#6-ส่วน-d--tax-workspace-thai_tax)
7. [ส่วน E — Ledger (FR-TAX-070 … 084)](#7-ส่วน-e--ledger-double_entry_ledger)
8. [ส่วน F — Banking (FR-TAX-090 … 099)](#8-ส่วน-f--banking-bank_reconciliation)
9. [ส่วน G — Reports (FR-TAX-110 … 118)](#9-ส่วน-g--reports)
10. [สรุปสูตรคำนวณและการปัดเศษทั้งหมด](#10-สรุปสูตรคำนวณและการปัดเศษ)
11. [สรุปโครงไฟล์ส่งออกทั้งหมด](#11-สรุปโครงไฟล์ส่งออก)
12. [ถ้อยคำ: ภาษาง่ายสำหรับร้าน vs ศัพท์บัญชีในเอกสารผู้ทำบัญชี/กรมสรรพากร](#12-ถ้อยคำ)
13. [Non-functional requirements](#13-non-functional-requirements)
14. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#14-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
15. [สิ่งที่ยังตรวจไม่ครบ และสิ่งที่พบใน docs แต่ไม่พบในโค้ด](#15-สิ่งที่ยังตรวจไม่ครบ)

---

## 1. ขอบเขตและสิทธิ์ตามแพ็ก (ข้อค้นพบสำคัญ)

### 1.1 แพ็กให้ feature key อะไรบ้าง

แหล่งเดียวที่ตอบว่า "แพ็กไหนเปิดเมนูอะไร" คือ `TIER_FEATURE_PRESETS` ใน `packages/contracts/src/menu-entitlements.ts:496-501`:

| แพ็ก | feature keys |
|---|---|
| `STARTER_249`, `BASIC_499`, `PRO_999` | `FEATURE_PACKAGE_PRESETS.starter.featureKeys` = `dashboard_notifications`, `expenses`, `expenses.list`, `expenses.upload`, `expenses.manual`, `expenses.categories`, `expenses.evidence`, `expenses.signatures`, `reimbursement`, `ai_line_assistant`, `employee_access(.employees/.roles/.overview)`, `company_settings(.branches/.security)` |
| `ENTERPRISE_1999` | ทั้งหมดของ starter **บวก** `wht_pnd53` และ `wht_50bis` เท่านั้น |
| `FREE_TRIAL_15` | ไม่มีใน `TIER_FEATURE_PRESETS` (type เป็น `Exclude<PlanTierKey,'FREE_TRIAL_15'>`); ค่า default ของ `billingFeaturePlan` คือ starter preset (`apps/api/src/modules/billing/application/billing-feature-entitlements.ts:40`) |

คอมเมนต์ในโค้ด (`menu-entitlements.ts:486-494`) ระบุชัดว่า *"All four paid tiers share starter menus. ENTERPRISE adds only ภ.ง.ด.53 and system-issued 50 ทวิ; that narrow right must never turn on the whole `thai_tax` workspace."*

### 1.2 ผลต่อเอกสารนี้

feature key ต่อไปนี้ **ไม่อยู่ใน preset ของแพ็กใดเลย** (รวมถึง `SALES_DEAL_ALLOWED_FEATURE_KEYS` ที่เซลล์ขายได้): `thai_tax`, `double_entry_ledger`, `expense_auto_post`, `bank_reconciliation`, `reports` ทั้งหมดเปิดได้ทางเดียวคือ System Partner admin เปิดรายร้าน (preset `standard` / `full` หรือเปิดรายคีย์ ใน `FEATURE_PACKAGE_PRESETS`, `menu-entitlements.ts:451-484`)

ตาม `_BRIEF.md` โมดูลที่ไม่อยู่ในแพ็กใดถือว่า "นอกขอบเขต" แต่คำสั่งงานของเอกสารนี้ขอให้บันทึกทุก feature ของ `tax`/`ledger`/`banking`/`reports` พร้อมสูตรและโครงไฟล์ เอกสารจึงแบ่งชัดเจนดังนี้ เพื่อให้ traceability matrix กรองได้:

| ส่วน | เนื้อหา | สถานะขอบเขตแพ็ก |
|---|---|---|
| A | ภาษีหัก ณ ที่จ่าย: handoff 50 ทวิ, ออก/แก้/ใบแทน 50 ทวิ, ภ.ง.ด.3/53, e-WHT, ประเภทเงินได้, ลายเซ็น | **ในขอบเขต** (รายละเอียดรายข้อ) |
| B | ชุดส่งผู้ทำบัญชี, PDF ต่อรายการ, ไฟล์นำเข้าโปรแกรมบัญชี | **ในขอบเขต** (ทุกแพ็ก ผ่าน `expenses.evidence`) |
| C | bootstrap tax code / ผังบัญชี ตอนสมัคร | **ในขอบเขต** (ทำงานเบื้องหลังทุกร้าน) |
| D–G | Tax workspace เต็ม, Ledger, Banking, Reports | **นอก preset แพ็ก** — บันทึกไว้ในระดับที่สร้างใหม่ได้ ทุกข้อระบุ "แพ็ก: ไม่มี" และสรุปซ้ำในหัวข้อ 14 |

### 1.3 capability pack ที่ผูก permission กับ feature

จาก `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:414-540` (permission ของ pack ที่มี `featureEntitlementKey` จะถูกกรองออกเมื่อร้านไม่มี feature นั้น — `filterPermissionsByEntitlement`):

| pack key | feature | permission keys |
|---|---|---|
| `pack.wht.pnd53` | `wht_pnd53` | `wht.pnd53.read`, `wht.pnd53.prepare` |
| `pack.wht.certificate.manage` | **ไม่ผูก feature** (ทุกร้าน) | `wht.certificate.read`, `wht.external_certificate.link`, `wht.certificate.correct` |
| `pack.wht.certificate.issue` | `wht_50bis` | `wht.certificate.issue` |
| `pack.wht.certificate.issue.legacy` | `thai_tax` | `wht.certificate.issue` |
| `pack.company.tax_signature.manage` | `wht_50bis` | `company.tax_signature.manage` |
| `pack.company.tax_signature.manage.legacy` | `thai_tax` | `company.tax_signature.manage` |
| `pack.tax.view` | `thai_tax` | `tax.profile.read`, `tax.config.read`, `tax.period.read`, `tax.event.read`, `tax.report.read`, `tax.certificate.read`, `tax.review_issue.read` |
| `pack.tax.prepare` | `thai_tax` | `tax.event.sync`, `tax.report.recompute`, `tax.report.export`, `tax.filing.mark_filed`, `tax.filing.mark_paid`, `tax.certificate.issue`, `tax.certificate.void`, `tax.review_issue.resolve`, `tax.adjustment.create` |
| `pack.tax.manage` | `thai_tax` | `tax.profile.manage`, `tax.config.manage`, `tax.period.manage` |
| `pack.ledger.view` | `double_entry_ledger` | `ledger.account.read`, `ledger.journal.read`, `ledger.posting-rule.read`, `ledger.report.read`, `ledger.period.read`, `ledger.export` |
| `pack.ledger.operate` | `double_entry_ledger` | `journal.entry.create` |
| `pack.ledger.manage` | `double_entry_ledger` | `ledger.account.manage`, `journal.entry.post`, `journal.entry.reverse`, `ledger.posting-rule.manage`, `ledger.period.close`, `ledger.period.unclose` |
| `pack.cash.view` | `bank_reconciliation` | `bank.cash.read` |
| `pack.bank.view` | `bank_reconciliation` | `bank.account.read`, `bank.statement.read`, `bank.match.read`, `bank.adjustment.read`, `bank.reconciliation.read`, `bank.cash.read` |
| `pack.bank.operate` | `bank_reconciliation` | `bank.account.manage`, `bank.statement.import`, `bank.statement.manual_line`, `bank.match.suggest`, `bank.match.confirm`, `bank.match.unmatch`, `bank.adjustment.create`, `bank.reconciliation.create` |
| `pack.bank.reconcile_manage` | `bank_reconciliation` | `bank.statement.void`, `bank.match.override`, `bank.adjustment.approve`, `bank.adjustment.void`, `bank.reconciliation.complete`, `bank.reconciliation.reopen`, `bank.reconciliation.export` |
| `pack.bank.sensitive` | `bank_reconciliation` | `bank.account.sensitive_read` |
| `pack.expense.view` / `pack.expense.finance` | `expenses` | รวม `expense.evidence.read`, `expense.export` (ใช้กับส่วน B) |

กลุ่ม `report.*` ไม่มี capability pack ของตัวเอง; ถูกแจกผ่านค่าคงที่ `REPORT_BI_*_GRANTS` ใน `apps/api/src/modules/auth/permission-registry.ts:492-520` และเมนูถูกผูกกับ feature `reports` ที่ `MENU_ENTITLEMENT_BINDINGS` (`navKey: 'reports'`)

### 1.4 บทบาทเริ่มต้นที่ถือ permission หลัก

จาก `ROLE_GRANTS` (`apps/api/src/modules/auth/permission-registry.ts:544-1100`; `OWNER` ถือทุก `COMPANY_PERMISSION_KEYS`):

| permission | บทบาทเริ่มต้น (นอกจาก OWNER) |
|---|---|
| `wht.pnd53.read`, `wht.pnd53.prepare` | FINANCE, ACCOUNTANT |
| `wht.certificate.read` / `.issue` / `.correct`, `wht.external_certificate.link` | FINANCE, ACCOUNTANT |
| `company.tax_signature.manage` | OWNER เท่านั้น (จงใจไม่ใส่ในบทบาทอื่น — `permission-registry.ts:260-262`) |
| `expense.export` | ADMIN, FINANCE, ACCOUNTANT, AUDITOR_READONLY |
| `tax.filing.mark_filed` | FINANCE, ACCOUNTANT |
| `ledger.period.close` | ACCOUNTANT |
| `system.wht_income_category.manage` | บทบาทแพลตฟอร์ม (SYSTEM_ADMIN) |

---

## 2. แนวคิดร่วม

### 2.1 Prisma models ที่เกี่ยวข้อง (`apps/api/prisma/schema.prisma`)

- **ภาษี**: `CompanyTaxProfile`, `CompanyTaxCodeProfile`, `TaxCodeDefinition`, `TaxAccountDeterminationRule`, `TaxReportMappingRule`, `TaxReconciliationRun`, `TaxReconciliationLine`, `TaxRuleSource`, `TaxYearConfig`, `TaxRateConfig`, `WhtIncomeCategory`, `TaxCalendarRule`, `TaxPeriod`, `TaxEvent`, `TaxReviewIssue`, `TaxReportSnapshot`, `WhtFiling`, `WhtFilingLine`, `TaxFilingPackage`, `WhtCertificate`, `WhtCertificateHandoff`, `WhtCertificateHistory`, `WhtPayerModeFact`, `TaxAdjustment`, `TaxVerificationChecklist`
- **บัญชี**: `ChartOfAccount`, `AccountingPeriod`, `JournalEntry`, `JournalLine`, `PostingRule`
- **ธนาคาร**: `BankAccount`, `BankStatementImport`, `BankStatementLine`, `BankReconciliationMatch`, `BankAdjustment`, `BankReconciliationSession`, `BankReconciliationSessionLine`, `BankReconciliationEvidenceExport`
- **รายงาน**: `ReportView`, `ReportRun`, `ReportExportRequest`, `ReportDrilldownAccessLog`
- **ร่วม**: `Company`, `Branch`, `ExpenseRecord`, `ExpenseLine`, `ExpensePayment`, `SupplierPayment`, `AccountingCounterparty`, `AttachmentObject`, `AttachmentLink`, document sequence (`data-model-core`)

### 2.2 Enum สถานะ (ค่าจริงจาก schema)

| enum | ค่า |
|---|---|
| `TaxFormType` | `PND2`, `PP30`, `PP36`, `PND3`, `PND53`, `PND50`, `PND51`, `CUSTOMS_SUPPORT` |
| `TaxPeriodStatus` | `OPEN`, `NEEDS_REVIEW`, `READY_FOR_REVIEW`, `REVIEWED`, `EXPORTED`, `FILED`, `PAID`, `CLOSED`, `AMENDED` (งวดล็อกเมื่อเป็น `FILED`/`PAID`/`CLOSED` — `tax-period.logic.ts:46-50`) |
| `TaxEventType` | `WHT_PND2`, `WHT_PND3`, `WHT_PND53`, `VAT_OUTPUT`, `VAT_INPUT`, `VAT_EXEMPT`, `VAT_REVIEW`, `CUSTOMS_ASSESSED` |
| `TaxEventStatus` | `ACTIVE`, `SUPERSEDED`, `REVERSED`, `EXCLUDED` (`EXCLUDED` = รายการที่จ่ายผ่าน e-WHT ธนาคารนำส่ง) |
| `WhtHandoffStatus` | `REQUIRED`, `EXTERNAL_LINKED`, `SYSTEM_ISSUED`, `CANCELLED` |
| `WhtCertificateStatus` | `DRAFT`, `ISSUED`, `VOIDED` |
| `WhtRemittance` | `PAYER_FILES` (ร้านยื่นแบบเอง), `E_WHT` (ธนาคารนำส่ง) |
| `LedgerAccountClass` | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `COST`, `EXPENSE`, `TAX_EXPENSE`, `SUSPENSE` |
| `JournalEntryType` / `Status` | `GENERATED`, `MANUAL`, `REVERSAL`, `OPENING_BALANCE`, `CLOSING` / `DRAFT`, `POSTED`, `REVERSED`, `VOIDED` |
| `LedgerPeriodStatus` | `OPEN`, `CLOSING_REVIEW`, `CLOSED`, `REOPENED` |
| `BankStatementImportStatus` | `PREVIEW`, `COMMITTED`, `VOIDED`, `FAILED` |
| `BankStatementLineStatus` | `UNMATCHED`, `SUGGESTED`, `PARTIALLY_MATCHED`, `MATCHED`, `IGNORED`, `VOIDED` |
| `BankMatchStatus` / `BankMatchSourceType` | `SUGGESTED`, `CONFIRMED`, `REJECTED`, `VOIDED` / `CUSTOMER_PAYMENT`, `SUPPLIER_PAYMENT`, `EXPENSE_PAYMENT`, `REIMBURSEMENT_PAYMENT`, `BANK_ADJUSTMENT`, `LEDGER_JOURNAL_LINE`, `INTER_ACCOUNT_TRANSFER`, `OTHER_SOURCE` |
| `BankAdjustmentStatus` / `Category` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `VOIDED`, `POSTED`, `POSTING_ERROR` / `BANK_FEE`, `BANK_INTEREST`, `OWNER_CONTRIBUTION`, `OWNER_DRAW`, `INTER_ACCOUNT_TRANSFER`, `UNKNOWN_DEPOSIT`, `UNKNOWN_WITHDRAWAL`, `OTHER` |
| `BankReconciliationStatus` | `DRAFT`, `IN_REVIEW`, `COMPLETED`, `REOPENED`, `VOIDED` |
| `ReportExportFormat` / `ReportViewVisibility` | `CSV`, `XLSX` (โค้ดรับเฉพาะ `CSV`) / `PRIVATE`, `COMPANY`, `ROLE`, `TEAM` |

### 2.3 เลขที่เอกสาร

`apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.ts:21-22`:

| documentType | รูปแบบ | padding | reset |
|---|---|---|---|
| `tax.wht_certificate` | `WHT-{YYYY}-{SEQ}` | 5 หลัก | รายปี (`YEARLY`) |
| `tax.filing_export` | `TAXEXP-{YYYY}{MM}-{SEQ}` | 5 หลัก | รายเดือน (`MONTHLY`) |

เลขถูก "จอง" (reserve) ด้วย idempotency key ก่อน แล้ว "commit" ผูกกับเอกสารใน transaction เดียวกับที่สร้างเอกสาร

### 2.4 Web routes (ทั้งหมดอยู่ใต้ `/companies/[companyId]` ใน `apps/web/app/(workspace)/companies/[companyId]/…`)

gate ฝั่งเว็บอยู่ที่ `apps/web/src/features/web-core-workspace/route-permissions.ts`:

| route | anyOf permissions | ส่วน |
|---|---|---|
| `/tax/withholding`, `/tax/pnd53` | `wht.pnd53.read`, `wht.pnd53.prepare` | A |
| `/expenses/wht-certificates` | `wht.certificate.read`, `wht.certificate.issue`, `wht.certificate.correct`, `wht.external_certificate.link` | A |
| `/settings/tax-signature` | `company.tax_signature.manage` | A |
| `/settings/e-wht` | `company.setup.manage` | A |
| `/expenses/evidence` | (ใต้เมนู expenses) `expense.evidence.read` / `expense.export` | B |
| `/tax` | `tax.period.read` | D |
| `/tax/evidence` | `tax.config.read` | D |
| `/tax/reconciliation` | `tax.report.read` | D |
| `/settings/accounting-tax-setup` (+ `/profile`, `/prerequisites`, `/chart`, `/chart/review`, `/mappings`, `/review`) | `tax.profile.*`, `tax.config.*`, ledger keys | D/E |
| `/settings/tax-codes` | `tax.profile.read/manage`, `tax.config.read/manage` | D |
| `/settings/tax-accounts` | `tax.config.read/manage`, `ledger.posting-rule.read/manage` | D |
| `/settings/chart-of-accounts` | `ledger.account.read/manage` | E |
| `/journal` | `ledger.journal.read` | E |
| `/period-closing` | `ledger.period.read` (เมนู `closing` สถานะ `planned`) | E |
| `/banking` (`?tab=accounts|cash|import|matching|reconciliations|adjustments`) | `bank.*.read` | F |
| `/reports` | `report.catalog.read`, `report.snapshot.read` | G |
| `/system/wht-income-categories` (นอก company) | `system.wht_income_category.manage` | A |

เมนูหลักที่เกี่ยวข้อง (`MENU_ENTITLEMENT_BINDINGS`): `pnd53` "ภาษีหัก ณ ที่จ่าย" (`wht_pnd53`, ready), `tax` "ภาษี" (`thai_tax`, ready), `journal` "สมุดรายวัน" (`double_entry_ledger`, ready), `closing` "ปิดงวด" (`double_entry_ledger`, **planned**), `banking` "บัญชีธนาคาร" (`bank_reconciliation`, ready), `reports` "รายงานการเงิน" (`reports`, ready), `accounting` "บัญชี" (`sales_documents`, **planned**)

---

## 3. ส่วน A — ภาษีหัก ณ ที่จ่าย

โค้ดหลัก: `apps/api/src/modules/tax/` · controller `presentation/http/tax.controller.ts` (prefix `companies/:companyId`) · ทุก endpoint ที่รับ `:companyId` เรียก `assertRouteCompany(ctx, companyId)` เพื่อกันการอ่านข้ามร้านด้วย header `x-company-id`

ภาพรวมการไหลของข้อมูล: รายจ่ายที่ยืนยันแล้ว (`ExpenseRecord.status = CONFIRMED`, `whtAmount > 0`) หรือการจ่ายเจ้าหนี้ (`SupplierPayment.status = RECORDED`, `whtAmount > 0`) → (1) สร้าง `WhtCertificateHandoff` สถานะ `REQUIRED` เพื่อบอกว่า "ต้องมีใบ 50 ทวิ" → ผู้ใช้เลือกทางใดทางหนึ่ง: จดเลขที่ใบที่ทำนอกระบบ (`EXTERNAL_LINKED`) หรือให้ระบบออก PDF (`SYSTEM_ISSUED`, เฉพาะ ENTERPRISE) → (2) `SyncTaxEventsUseCase` สร้าง `TaxEvent` ชนิด `WHT_PND3`/`WHT_PND53`/`WHT_PND2` ลงงวดเดือนที่จ่าย → (3) หน้ารายเดือนรวมเป็นแบบ ภ.ง.ด.3 / ภ.ง.ด.53 ต่อสถานประกอบการ → ดาวน์โหลด PDF ทับแบบของกรมสรรพากร หรือ XLSX ให้ผู้ทำบัญชี → บันทึกว่ายื่นแล้ว

### FR-TAX-001 สร้างรายการ "ต้องออก 50 ทวิ" (handoff) จากรายการจ่าย

- **คำอธิบาย** เมื่อมีการหักภาษี ณ ที่จ่าย ระบบบันทึกข้อเท็จจริงที่รู้อยู่แล้ว (ผู้จ่าย ผู้รับ ประเภทเงินได้ อัตรา ยอด วันที่) เป็น `WhtCertificateHandoff` สถานะ `REQUIRED` ไม่ปฏิเสธการจ่ายเงินไม่ว่าระบบออกใบเองได้หรือไม่
- **ผู้ใช้/permission** เรียกจากโมดูลต้นทาง (expenses, procurement) ไม่ใช่ endpoint ของผู้ใช้โดยตรง
- **แพ็ก** ทุกแพ็ก (pack `pack.wht.certificate.manage` ไม่ผูก feature)
- **เงื่อนไขก่อนทำ** มีรายการจ่ายที่มี `whtAmount > 0`
- **ขั้นตอนหลัก** `WhtCertificateHandoffUseCase.createOrReplay` (`application/use-cases/wht-certificate-handoff.use-case.ts:141-192`): ค้นด้วย unique `(companyId, creationCommandId)` ถ้ามีแล้วคืนค่าเดิม (`replayed: true`); ถ้าไม่มีสร้างแถวใหม่พร้อม `prefillSnapshotJson`, `prefillSnapshotHash` (sha256 ของ prefill), `availabilityVectorJson`, `sourcePaymentType` (`expense.record` | `procurement.supplier_payment`), `sourcePaymentId`, `sourceBranchId`, `taxEventIdsJson`
- **กฎธุรกิจ** idempotent ตาม `creationCommandId`; ถ้าชน unique (`P2002`) นอก transaction ของผู้เรียก ให้โหลดแถวที่ชนะกลับมา; ภายใน transaction ของผู้เรียกไม่กู้ (เพราะ transaction เสียแล้ว); หนึ่งรายการจ่ายที่จ่ายหลายงวดจะมี handoff แยกต่อการจ่าย (`creationCommandId = wht-payment:<expenseId>:<paymentId>`, `services/wht-certificate-payment.ts` → `paymentHandoff`, ใช้ `createMany … skipDuplicates`)
- **ข้อผิดพลาด** ไม่มีข้อผิดพลาดเชิงธุรกิจ (ต้องไม่ขวางการจ่าย)
- **ข้อมูล** `WhtCertificateHandoff`
- **API** ไม่มี (ภายใน)
- **หน้าจอ** แสดงผลใน `/expenses/wht-certificates`, รายละเอียดรายจ่าย, หน้าเจ้าหนี้
- **ทดสอบ** `wht-certificate-handoff.use-case.spec.ts`, `e2e/wht-settlement.spec.ts`

### FR-TAX-002 ดูรายการ / ค้นหา / รายละเอียด handoff และประวัติใบของรายจ่าย

- **คำอธิบาย** แสดงรายการที่ต้องออก 50 ทวิ พร้อมสถานะ ความครบของข้อมูล และธงว่าระบบเปิดให้ออก/แก้/ทำใบแทนหรือไม่
- **permission** list/history/ไฟล์: anyOf `wht.certificate.read`, `wht.certificate.issue`, `wht.certificate.correct`, `wht.external_certificate.link`; รายละเอียดรายตัว: `wht.certificate.read`
- **แพ็ก** ทุกแพ็ก
- **ขั้นตอนหลัก** `list` (ไม่มี page: คืน array สูงสุด 200 แถว เรียง `createdAt desc, id desc`) หรือ `listPaged` (เมื่อส่ง `page`/`pageSize`); ตัวกรอง `status`, `branchId`, `sourcePaymentId`, `periodKey` (`YYYY-MM`), `formType` (`PND2`/`PND3`/`PND53`), `search`, `order`; ทุกการอ่านผ่าน `handoffReadBoundary` + `handoffBranchWhere` (ขอบเขตสาขาของผู้ใช้ และสิทธิ์อ่านรายจ่ายต้นทาง)
- **กฎธุรกิจ** คำนวณธง 3 ตัวจาก launch gate `cap.wht50bis`: route `SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION`, `SYSTEM_REPLACEMENT_COPY` (`isLaunchRouteOpen`, บรรทัด 60-80); ความไม่ครบของ prefill ใช้ `whtHandoffMissing` (`domain/logic/wht-handoff-missing.logic.ts`): `FORM_TYPE_UNRESOLVED` เมื่อไม่มี `formType`, `INCOME_CATEGORY_OR_RATE_MISSING` เมื่อขาดรหัส/ชื่อประเภทเงินได้หรืออัตรา
- **ข้อผิดพลาด** 400 "เดือนภาษีไม่ถูกต้อง เลือกเดือนอีกครั้ง", "ไม่พบแบบภาษีที่เลือก เลือก ภ.ง.ด.2 ภ.ง.ด.3 หรือ ภ.ง.ด.53", "ไม่พบสถานะที่เลือก เลือกตัวกรองรายการอีกครั้ง"; 404 `WHT handoff not found.`
- **ข้อมูล** `WhtCertificateHandoff`, `WhtCertificate`, `WhtCertificateHistory`
- **API** `GET wht/payment-handoffs`, `GET wht/payment-handoffs/:handoffId`, `GET wht/expenses/:expenseId/certificate-history`
- **หน้าจอ** `/expenses/wht-certificates` (`apps/web/src/features/expenses/WhtCertificatesPage`), `apps/web/src/features/accounts-payable/WhtHandoffDetail`
- **ทดสอบ** `wht-certificate-handoff.use-case.spec.ts`, `tax.controller.spec.ts`, `WhtCertificatesPage.spec.ts`, `expense-wht-certificates.logic.spec.ts`, `WhtHandoffDetail.wiring.spec.ts`

### FR-TAX-003 เติมที่อยู่ผู้รับเงินที่ prefill ไม่มี

- **คำอธิบาย** prefill ถูกแช่แข็งตอนสร้าง handoff ถ้าไม่มีที่อยู่ผู้รับเงิน ผู้ใช้กรอกเพิ่มได้ และระบบเขียนกลับทะเบียนคู่ค้า
- **permission** anyOf `wht.external_certificate.link`, `wht.certificate.issue` (สิทธิ์อ่านอย่างเดียวเขียนไม่ได้) · **แพ็ก** ทุกแพ็ก
- **ขั้นตอนหลัก** `setPayeeAddress` บันทึก `WhtCertificateHandoff.payeeAddress` (ความยาวสูงสุด `WHT_HANDOFF_PAYEE_ADDRESS_MAX` จาก contracts) แล้ว `saveAddressToRegistry` พยายามบันทึกลง `AccountingCounterparty` ด้วยตรรกะจับคู่ผู้ขาย (`vendor-counterparty-match.logic`)
- **กฎธุรกิจ** ที่อยู่ที่ผู้ใช้พิมพ์ "ชนะ" ที่อยู่ใน prefill ตอนออกใบ แต่ไม่แก้ `prefillSnapshotJson`/hash; audit action `tax.wht_certificate.payee_address_set`
- **API** `POST wht/payment-handoffs/:handoffId/payee-address` · **ทดสอบ** `sync-tax-events-payee-address.use-case.spec.ts`, `wht-certificate-handoff.use-case.spec.ts`

### FR-TAX-004 จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ (link / change / remove + แนบไฟล์)

- **คำอธิบาย** ร้านที่ออกใบ 50 ทวิ เอง (กระดาษ/โปรแกรมอื่น) จดเลขที่และวันที่ออกไว้กับรายการจ่าย พร้อมแนบรูปหรือ PDF ของใบ
- **permission** `wht.external_certificate.link` (อ่านไฟล์: anyOf กลุ่ม certificate) · **แพ็ก** ทุกแพ็ก
- **เงื่อนไขก่อนทำ** handoff สถานะ `REQUIRED` (link) หรือ `EXTERNAL_LINKED` (change/remove)
- **ขั้นตอนหลัก** (1) ขอ upload intent → (2) อัปโหลด → complete → (3) `linkExternal` เปลี่ยนสถานะเป็น `EXTERNAL_LINKED` ด้วย conditional update ที่ where `status: 'REQUIRED'` (แข่งกับการออกในระบบ ชนะได้ฝ่ายเดียว) และเขียน `WhtCertificateHistory`; `changeExternal` แก้ข้อมูลใบที่จดไว้; `removeExternal` ถอนการจดที่ผิด
- **การตรวจสอบข้อมูล** ตัวตรวจเดียวใช้ทั้ง DTO และ use case: `normalizeWhtLinkEvidence` (`domain/logic/wht-link-evidence.logic.ts`)

  | field | กฎ |
  |---|---|
  | `commandId` | string, ต้องมี, ≤ 200 ตัวอักษร (idempotency) |
  | `externalCertificateNumber` | string, ต้องมี, ≤ 100 |
  | `externalEvidenceRef` | string, ว่างได้, ≤ 500 |
  | `issuedDate` | ต้องเป็น `YYYY-MM-DD` เท่านั้น (ไม่มีเวลา) และเป็นวันที่มีจริง (สร้างด้วย `Date.UTC` แล้วเทียบกลับ) |
  | `paymentDate` | ไม่บังคับ; รูปแบบเดียวกัน; ต้องไม่หลัง `issuedDate` |
  | `note` | ไม่บังคับ, ≤ 1000, ค่าว่าง → `null` |

  ค่าที่ยาวเกิน **ถูกปฏิเสธ ไม่ตัดทิ้ง**; ไฟล์แนบ: `WHT_EXTERNAL_FILE` (`packages/contracts/src/tax.ts:1065`) target `wht.external_certificate`, purpose `wht.external_certificate.evidence`, สูงสุด 10 MB, รูปหรือ PDF
- **ข้อผิดพลาด** `wht_external_file_invalid` ("แนบรูปหรือ PDF ของใบ ไม่เกิน 10 เมกะไบต์ แล้วลองอีกครั้ง"); คำสั่งซ้ำ (commandId เดิม) ตอบผลเดิมหรือ conflict (`replayOrConflict`)
- **ข้อมูล** `WhtCertificateHandoff` (`externalCertificateNumber`, …), `WhtCertificateHistory`, `AttachmentObject`, `AttachmentLink`
- **API** `POST wht/payment-handoffs/:id/external-certificate/file-upload-intent`, `POST …/external-certificate/file-uploads/:attachmentId/complete`, `GET …/external-certificate/files/:attachmentId`, `POST …/external-certificate`, `POST …/external-certificate/change`, `POST …/external-certificate/remove`
- **หน้าจอ** `/expenses/wht-certificates`, รายละเอียดรายจ่าย
- **ทดสอบ** `wht-certificate-handoff.use-case.spec.ts` (1,630 บรรทัด), `tax.controller.spec.ts`
- **หมายเหตุการตรวจ** ไม่ได้อ่านเนื้อใน `changeExternal`/`removeExternal` ทุกบรรทัด (บรรทัด 631-780) กฎละเอียดให้ดูไฟล์

### FR-TAX-005 ออกหนังสือรับรอง 50 ทวิ ในระบบจาก handoff

- **คำอธิบาย** ระบบสร้าง PDF หนังสือรับรอง 50 ทวิ บนแบบของกรมสรรพากร ออกเลขที่ และผูกกับรายการจ่าย
- **permission** `wht.certificate.issue` · **แพ็ก** `ENTERPRISE_1999` (feature `wht_50bis`); ร้านเดิมที่มี `thai_tax` คงสิทธิ์ผ่าน pack legacy
- **เงื่อนไขก่อนทำ** (ตรวจตามลำดับใน `previewLineAction`, `issue-wht-certificate-from-handoff.use-case.ts:85-124`)
  1. handoff สถานะ `REQUIRED` มิฉะนั้น 409 `wht_handoff_not_issuable`
  2. launch route `cap.wht50bis / SYSTEM_INITIAL_ISSUE` เปิด มิฉะนั้น 409 `wht_system_issuance_unavailable` ("ระบบยังไม่เปิดการออกหนังสือรับรองในระบบ")
  3. มีการจ่ายที่ `RECORDED` และ `paidAtConfirmed = true` (`certificatePayment`): ไม่มี → `wht_certificate_payment_required`; จ่ายหลายครั้งแต่ไม่เลือก → `wht_certificate_payment_selection_required`; ยังไม่ทราบวันที่จ่ายจริง → `wht_certificate_payment_date_required`
  4. ประเภทเงินได้ออกในระบบได้ (`whtCertificateUnsupportedReason`): `PND2`, `WHT_INTEREST`, `WHT_DIVIDEND_IND`, `WHT_DIVIDEND` → 409 `wht_certificate_income_unsupported`
  5. ระบุแบบได้ → มิฉะนั้น `wht_handoff_form_type_unresolved`; มีประเภทเงินได้+อัตรา → มิฉะนั้น `wht_handoff_income_category_missing`
  6. ข้อมูลผู้จ่ายครบ (`whtPayerIdentity`) → มิฉะนั้น `wht_payer_identity_missing` (แนบ `payerMissing`)
  7. มีที่อยู่ผู้รับเงิน (`whtPayeeAddress`) → มิฉะนั้น `wht_handoff_payee_address_missing`
- **ขั้นตอนหลัก** (`execute`, บรรทัด 125-275)
  1. ตรวจ optimistic lock `expectedUpdatedAt` (ถ้าส่งมา) → 409 `wht_handoff_changed`
  2. `periodKey = formPeriodKey(formType, paymentDate)` (เดือนของ**วันที่จ่าย**) แล้ว `upsertPeriod` (ไม่ต้อง sync ภาษีก่อน)
  3. จองเลข `tax.wht_certificate` ด้วย idempotency key `wht_certificate_from_handoff:<handoffId>[:r<certificateRound>]`
  4. render PDF (FR-TAX-009) พร้อมลายเซ็นตาม FR-TAX-010
  5. transaction: ล็อกรายจ่าย (`lockExpenseCorrection`) และตรวจว่ายัง `CONFIRMED`; `assertPaymentNotCertified` (การจ่ายเดียวกันห้ามมีใบสองใบ → `wht_certificate_payment_already_issued`); คำนวณ prefill ใหม่ต้องตรงกับที่ render (`expense_wht_source_changed`); `SELECT … FOR UPDATE` handoff; ตรวจ status/hash/round; สร้าง `WhtCertificate` (`status: ISSUED`, `taxEventIdsJson: []`); ถ้ามีใบเดิมที่ถูกยกเลิกเพราะเปิดแก้รายจ่าย (`voidReason: SOURCE_REOPENED`) ให้ผูก `supersedesCertificateId` ↔ `supersededByCertificateId`; commit เลข; conditional update handoff → `SYSTEM_ISSUED`; เขียนประวัติ `ISSUED`
  6. audit `document.number.commit` (LOW) และ `tax.wht_certificate.issue` (HIGH, metadata `source: 'handoff'`, `pdfChecksum`)
- **กฎธุรกิจ** หนึ่งใบต่อหนึ่งการจ่าย; วันที่เอกสารไม่ถูกใช้แทนวันที่จ่าย; ยอดในใบคือส่วนแบ่งของการจ่ายนั้น (FR-TAX-014); ถ้าชนการจองเลข (`P2002`) ผู้แพ้ได้ผลของผู้ชนะ (`reloadWinner`) พร้อม PDF; เลขซ้ำ → `wht_certificate_number_duplicate`
- **ผลลัพธ์** DTO ใบรับรอง + `pdfArtifact { fileName, mimeType, contentBase64, checksum, byteLength }`; PDF **ไม่ถูกเก็บเป็นไฟล์** — ดาวน์โหลดซ้ำคือ render ใหม่จาก snapshot (FR-TAX-006)
- **ข้อมูล** `WhtCertificate`, `WhtCertificateHandoff`, `WhtCertificateHistory`, `TaxPeriod`, document sequence
- **API** `POST wht/payment-handoffs/:handoffId/system-certificate` (body `{ paymentId? }`)
- **หน้าจอ** ปุ่มออกใบใน `/expenses/wht-certificates` และรายละเอียดรายจ่าย (`WhtIssueButton`, `WhtPayerIdentityNotice`); LINE AI เรียก `previewLineAction` เพื่อเตรียมการ์ดยืนยัน
- **ทดสอบ** `issue-wht-certificate-from-handoff.use-case.spec.ts`, `WhtIssueButton.spec.ts`, `WhtPayerIdentityNotice.spec.ts`, `e2e/wht-settlement.spec.ts`

### FR-TAX-006 ดาวน์โหลด 50 ทวิ ที่ระบบออกแล้ว

- **permission** anyOf กลุ่ม certificate · **แพ็ก** ทุกแพ็กที่มีใบอยู่ (การออกต้อง ENTERPRISE)
- **ขั้นตอน** `IssueWhtCertificateFromHandoffUseCase.download` render PDF ใหม่จาก `payerSnapshotJson`/`payeeSnapshotJson`/ยอดของ `WhtCertificate`; หน้ารายเดือนให้ `canDownload = true` เฉพาะเมื่อ handoff `SYSTEM_ISSUED`, มีเลขที่, และผู้ใช้อยู่ใน read boundary
- **API** `GET wht/payment-handoffs/:handoffId/system-certificate`

### FR-TAX-007 แก้ไข 50 ทวิ ที่ระบบออก (ออกเลขใหม่ แทนใบเดิม)

- **permission** `wht.certificate.correct` · **แพ็ก** ทุกแพ็ก (ไม่ผูก feature — เป็นหน้าที่ตามกฎหมายต่อใบที่ออกไปแล้ว)
- **เงื่อนไขก่อนทำ** handoff `SYSTEM_ISSUED` + มี `certificateId` (`wht_certificate_not_correctable`); ใบยังไม่ถูกแทน (`wht_certificate_already_superseded`); route `SYSTEM_CONTENT_CORRECTION` เปิด (`wht_system_correction_unavailable`)
- **กฎธุรกิจ** (`correct-wht-certificate.use-case.ts:76-150`)
  - **ช่องที่ล็อก** แก้ไม่ได้: แบบ (`formType`), รหัส/ชื่อประเภทเงินได้, อัตรา, ยอดจ่าย, ยอดภาษี, เลขผู้เสียภาษีผู้รับเงิน → 409 `wht_correction_field_locked`; ถ้างวดนั้นยื่นแล้วจะตอบ `wht_certificate_correction_tax_period_locked` ก่อน
  - **ช่องที่แก้ได้**: ชื่อ/ที่อยู่ผู้จ่าย, ชื่อ/ที่อยู่ผู้รับเงิน, วันที่จ่าย (การเปลี่ยนวันที่จ่ายถือเป็น "financial" — ถ้างวดยื่นแล้วปฏิเสธ)
  - ต้องมีชื่อผู้รับเงิน (`wht_certificate_payee_name_required`), ที่อยู่ผู้รับเงิน (`wht_certificate_payee_address_required`), ข้อมูลผู้จ่ายครบ (`wht_payer_identity_missing`); ไม่มีอะไรเปลี่ยน → `wht_certificate_correction_no_changes`
  - ออกใบใหม่เลขใหม่ (`tax.wht_certificate`), ใบเดิมถูก supersede (`supersededByCertificateId`), ต้องระบุ `reason`
- **API** `POST wht/payment-handoffs/:handoffId/system-certificate/correction` (body `{ corrected, reason }`)
- **ทดสอบ** `correct-wht-certificate.use-case.spec.ts`

### FR-TAX-008 ออกใบแทน (สำเนาเลขเดิม)

- **permission** `wht.certificate.correct` · **แพ็ก** ทุกแพ็ก
- **กฎ** ไม่มี body, ไม่จองเลขใหม่; ต้องเป็น handoff ที่มีใบของระบบและยังใช้อยู่ (`wht_certificate_not_correctable`); route `SYSTEM_REPLACEMENT_COPY` เปิด; PDF เหมือนเดิมทุกช่อง เพิ่มข้อความ `ใบแทน <วัน/เดือน/ปี พ.ศ.>` ที่มุมบน (FR-TAX-009); audit `tax.wht_certificate.replacement_copy`
- **API** `POST wht/payment-handoffs/:handoffId/system-certificate/replacement-copy`
- **ทดสอบ** `issue-wht-replacement-copy.use-case.spec.ts`

### FR-TAX-009 โครง PDF หนังสือรับรอง 50 ทวิ

- **ไฟล์** `domain/logic/wht-certificate-pdf.logic.ts`; แบบต้นฉบับ `apps/api/src/modules/tax/assets/rd-wht50bis.pdf` (จาก `rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf`)
- **วิธีสร้าง** โหลดแบบ, อ่านตำแหน่งช่องจาก AcroForm field ของแบบเอง (`getRectangle` ของ widget แรก), คัดลอกหน้า 0 **สองครั้ง** (สองฉบับตรงกันตามกฎหมาย), ลบ `Annots` (ปุ่มล้างข้อมูล/ช่องว่าง), วาด overlay เป็น SVG → PNG (`sharp`, density 192) ทับเต็มหน้า; ฟอนต์ `Noto Sans Thai, Noto Sans, sans-serif`; ข้อความกว้างเกินช่องจะลดขนาดฟอนต์ (`fitToWidth`)
- **การเติมช่อง** (`makeMarks`)

  | ช่องในแบบ | ค่า |
  |---|---|
  | `book_no` / `run_no` | เลขที่ใบแยกที่ตัวคั่น `-` หรือ `/` ตัวสุดท้าย: ส่วนหน้า = เล่มที่, ส่วนท้าย = เลขที่ (เช่น `WHT-2026` / `00001`) |
  | `id1`, `id1_2` | เลขผู้เสียภาษีผู้จ่าย/ผู้รับ 13 หลัก วางใน comb 17 ช่อง (กลุ่ม 1-4-5-2-1) ตำแหน่ง `[0,2,3,4,5,7,8,9,10,11,13,14,16]`; ไม่ใช่ 13 หลัก → error |
  | `name1`, `add1` / `name2`, `add2` | ชื่อ/ที่อยู่ผู้จ่าย / ผู้รับ (ที่อยู่ที่เป็น JSON ถูกแปลงด้วย `formatCompanyLegalAddressForPrint`; ไม่มี → `-`) |
  | `chk4` หรือ `chk7` | ✓ ที่ ภ.ง.ด.3 (`chk4`) หรือ ภ.ง.ด.53 (`chk7`) |
  | `chk8` | ✓ (หัก ณ ที่จ่าย) |
  | แถวเงินได้ | `WHT_INTEREST` → `date4`/`pay1.3`/`tax1.3`; รหัสขึ้นต้น `WHT_OTHER` → `date14.1`/`pay1.13.1`/`tax1.13.1` + คำอธิบาย `spec3` = ชื่อประเภทเงินได้; `WHT_(SERVICE|RENT|PROFESSIONAL|ADVERTISING|TRANSPORT)_(3|5|IND|JUR)`, `WHT_PRIZE`, `CAT5` → `date14.0`/`pay1.13.0`/`tax1.13.0`; `WHT_DIVIDEND` และรหัสอื่น → throw |
  | `pay1.14`, `tax1.14` | รวมเงินที่จ่าย / รวมภาษี (รูปแบบเงิน `money()`) |
  | `total` | ยอดภาษีเป็นตัวอักษร (`thaiBahtText(withheldAmount)`) |
  | `date_pay`, `month_pay`, `year_pay` | วัน/เดือน/ปี พ.ศ. ของวันที่ออก (`issuedAt` แปลงเป็นวันตามเวลาไทยด้วย `civilDate`) |
  | ใบแทน | ข้อความ `ใบแทน dd/mm/พ.ศ.` ที่ (x=408, y=797) |
  | ลายเซ็น | ภาพที่ x=340, y=height−105, กว้าง 133 สูง 31 (เฉพาะโหมด `AUTO_STAMP`) |
  | สถานะ | ตราน้ำ `SUPERSEDED` สีแดงโปร่ง เอียง −30° กลางหน้า (เมื่อ `stateStamp`) |

- **วันที่** รูปแบบ `dd/mm/(ค.ศ.+543)`; **ชื่อไฟล์** `หนังสือรับรอง-50-ทวิ-<certificateNumber>.pdf` (`tax-artifact-renderer.service.ts:44`); PDF title = เลขที่ใบ
- **ทดสอบ** `wht-certificate-pdf.logic.spec.ts`

### FR-TAX-010 ลายเซ็นบน 50 ทวิ

- **permission** `company.tax_signature.manage` (OWNER เท่านั้นโดยค่าเริ่มต้น) · **แพ็ก** `ENTERPRISE_1999` (`wht_50bis`) หรือ legacy `thai_tax`
- **กฎ** `CompanyTaxProfile.signatureMode` = `BLANK` (ค่าเริ่มต้น เว้นว่างให้เซ็นมือ) หรือ `AUTO_STAMP`; `AUTO_STAMP` ต้องมี `signatureImageAttachmentId` (`wht_signature_attachment_required`: "ยังไม่มีรูปลายเซ็น อัปโหลดรูปลายเซ็นก่อนเปิดใช้การประทับอัตโนมัติ"); ไฟล์ต้องเป็น PNG หรือ JPEG; ตอน render ถ้าไม่มีโปรไฟล์ / โหมดไม่ใช่ `AUTO_STAMP` / ไฟล์ไม่ `ACTIVE` → ไม่ประทับ (ไม่แสดง placeholder เสีย); audit `company.tax_signature.manage`
- **API** `GET tax/profile/signature`, `PATCH tax/profile/signature`
- **หน้าจอ** `/settings/tax-signature` (`TaxSignatureSettingsPage`)
- **ทดสอบ** `update-company-tax-signature.use-case.spec.ts`, `TaxSignatureSettingsPage.spec.ts`

### FR-TAX-011 ประเภทเงินได้หัก ณ ที่จ่าย (catalog กลางของระบบ)

- **คำอธิบาย** `WhtIncomeCategory` เป็นตารางกลางทุกร้าน (unique `code`) กำหนดแบบ, อัตราเริ่มต้น และ "เส้นทางการยื่น" (`filingRoute`)
- **permission** ผู้ดูแลระบบ: `system.wht_income_category.manage` (`GET /system/wht-income-categories`, `PATCH /system/wht-income-categories/:code`); ระดับร้าน (เฉพาะ `thai_tax`): `tax.config.read` (`GET tax/wht-categories`), `tax.config.manage` (`PATCH tax/wht-categories/:code`)
- **แพ็ก** การใช้งาน (เลือกประเภทในรายจ่าย) ทุกแพ็ก; การเปิด/ปิดทำโดย SYSTEM_ADMIN
- **ค่าตั้งต้น** (`apps/api/prisma/seed.ts:2938-2960`, migration `20261004120000_open_wht_income_categories`)

  | code | ชื่อ | แบบ | อัตราเริ่มต้น | filingRoute | สถานะ seed |
  |---|---|---|---|---|---|
  | `WHT_SERVICE_3` | ค่าบริการ (บุคคลธรรมดา) | PND3 | 3% | SYSTEM_FILLS | ACTIVE |
  | `WHT_SERVICE_5` | ค่าบริการ (นิติบุคคล) | PND53 | 3% | SYSTEM_FILLS | ACTIVE |
  | `WHT_RENT_IND` / `WHT_RENT_JUR` | ค่าเช่า | PND3 / PND53 | 5% | SYSTEM_FILLS | ACTIVE |
  | `WHT_PROFESSIONAL_IND` / `_JUR` | ค่าวิชาชีพ | PND3 / PND53 | 3% | SYSTEM_FILLS | ACTIVE |
  | `WHT_ADVERTISING_IND` / `_JUR` | ค่าโฆษณา | PND3 / PND53 | 2% | SYSTEM_FILLS | ACTIVE |
  | `WHT_TRANSPORT_IND` / `_JUR` | ค่าขนส่ง | PND3 / PND53 | 1% | SYSTEM_FILLS | ACTIVE |
  | `WHT_PRIZE` | รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา) | PND3 | 5% | SYSTEM_FILLS | ACTIVE |
  | `WHT_OTHER_IND` / `WHT_OTHER_JUR` | อื่นๆ | PND3 / PND53 | 3% | ACCOUNTANT_PREPARES | ACTIVE |
  | `WHT_DIVIDEND` | เงินปันผล (นิติบุคคล) | PND53 | 10% | ACCOUNTANT_PREPARES | DRAFT |
  | `WHT_INTEREST` | ดอกเบี้ย (บุคคลธรรมดา) | PND2 | 1% | SEPARATE_PND2 | DRAFT |
  | `WHT_PRIZE_JUR` | รางวัลฯ (นิติบุคคล) | PND53 | 0% | SYSTEM_FILLS | DRAFT |
  | `WHT_INTEREST_JUR` | ดอกเบี้ย (นิติบุคคล) | PND53 | 0% | ACCOUNTANT_PREPARES | DRAFT |
  | `WHT_DIVIDEND_IND` | เงินปันผล (บุคคลธรรมดา) | PND2 | 0% | SEPARATE_PND2 | DRAFT |

- **filingRoute** `SYSTEM_FILLS` = ระบบกรอกลงแบบได้; `ACCOUNTANT_PREPARES` = ระบบกรอกลงแบบไม่ได้ ผู้ทำบัญชีทำเอง (ดาวน์โหลด PDF ไม่ได้ ได้เฉพาะ XLSX); `SEPARATE_PND2` = ยื่น ภ.ง.ด.2 แยก ไม่อยู่ใน ภ.ง.ด.3
- **ข้อผิดพลาด** (`wht-income-category.use-case.ts`) "คุณไม่มีสิทธิ์จัดการประเภทเงินได้หัก ณ ที่จ่ายของระบบ", "กรุณาเลือกเปิดใช้หรือปิดใช้ประเภทเงินได้", "ไม่พบประเภทเงินได้หัก ณ ที่จ่าย"; audit `tax.wht_income_category.set_status`
- **หน้าจอ** `/system/wht-income-categories` (`apps/web/src/features/system-wht-income-categories`)
- **ทดสอบ** `wht-income-category.use-case.spec.ts`, `wht-income-categories.spec.ts`

### FR-TAX-012 เลือกแบบ ภ.ง.ด. จากชนิดผู้รับเงิน

- **สูตร** `withholdingFormFor(kind, filingRoute)` (`domain/logic/expense-payment-withholding.logic.ts:28-32`):
  - `kind === 'INDIVIDUAL'` → `PND2` ถ้า `filingRoute === 'SEPARATE_PND2'` มิฉะนั้น `PND3`
  - `kind === 'JURISTIC'` หรือ `'JURISTIC_PERSON'` → `PND53`
  - อื่น ๆ (ไม่ทราบ / ต่างประเทศ) → `null` ⇒ สร้าง review issue `WHT_PAYEE_KIND_UNKNOWN` (BLOCKING) และไม่สร้าง tax event
- รายจ่ายใช้ `vendorEntityKindSnapshot` (หรือ `AccountingCounterparty.entityKind`); เจ้าหนี้ใช้ `Supplier.supplierType`

### FR-TAX-013 ปันส่วนฐานเงินได้และภาษีตามการจ่ายแต่ละครั้ง

- **ไฟล์/ฟังก์ชัน** `allocateExpenseWithholding` (`domain/logic/expense-payment-withholding.logic.ts:6-25`)
- **หลัก** เงินสดที่จ่ายคือยอดสุทธิ (`netPayable`); ปันส่วน**สะสม**ตามลำดับการบันทึก (`createdAt` แล้ว `id`) เฉพาะการจ่ายสถานะ `RECORDED`
- **สูตร** ให้ `net = netPayable` (ถ้าเงินสดรวม ≥ `grossPayable = netPayable + withheld` ให้ใช้ `grossPayable` แทน — กรณีข้อมูลเก่าที่จ่ายเต็มยอด) และ `paid_k` = ยอดจ่ายสะสมถึงครั้งที่ k
  - ครั้งที่ยังจ่ายไม่ครบ: `base_k = round2_HALF_UP(income × paid_k / net) − Σ base_ก่อนหน้า` (clamp ในช่วง `[0, income]`), `tax_k = round2_HALF_UP(withheld × paid_k / net) − Σ tax_ก่อนหน้า` (clamp `[0, withheld]`)
  - ครั้งที่ทำให้ `round2(paid_k) ≥ round2(net)`: รับ**เศษที่เหลือทั้งหมด** `base_k = income − Σ base_ก่อนหน้า`, `tax_k = withheld − Σ tax_ก่อนหน้า`
  - การจ่ายที่ถูก "แช่แข็ง" ไว้แล้ว (ใน map `frozen`) ใช้ค่าที่แช่แข็ง
- **การปัดเศษ** `Prisma.Decimal.toDecimalPlaces(2, ROUND_HALF_UP)`; ผลรวมทุกครั้งเท่ากับ `income` และ `withheld` พอดี (สตางค์สุดท้ายตกที่การจ่ายที่ปิดยอด)
- การจ่ายที่ยังไม่ทราบวันที่ (`paidAtConfirmed = false`) ยังได้ส่วนแบ่ง แต่ผู้เรียกไม่นำขึ้นแบบ

### FR-TAX-014 ฐานเงินได้ที่คำนวณย้อนจากภาษี

- **ฟังก์ชัน** `deriveWhtIncomeBase(withheldAmount, ratePercent)` (`domain/logic/wht-report.logic.ts:41-46`)
- **สูตร** `base = round(withheld / (rate/100) × 100) / 100` แสดง 4 ตำแหน่ง (`toFixed(4)`); อัตรา ≤ 0 หรืออ่านไม่ได้ → `null` (ปล่อยให้ตรวจ ไม่เดาตัวเลข)
- **เหตุผล** ยอด gross ของ `SupplierPayment` รวม VAT จึงไม่ใช่ฐานเงินได้ ใบ 50 ทวิ และใบแนบ ภ.ง.ด. ต้องแสดงเลขเดียวกันสำหรับการจ่ายเดียวกัน · **ทดสอบ** `wht-report.logic.spec.ts`

### FR-TAX-015 ดึงรายการหักภาษีเข้างวด (sync)

- **permission** `wht.pnd53.prepare` (ทาง `POST tax/pnd53/sync` หรือ `POST tax/withholding/:formType/sync`) · **แพ็ก** `ENTERPRISE_1999`
- **ขั้นตอน** `SyncTaxEventsUseCase.execute(companyId, since?, scope)` (`application/use-cases/sync-tax-events.use-case.ts`); route `tax/pnd53/sync` ใช้ scope `PND53`, route แบบมี `:formType` ใช้ scope `WHT` (ไม่แตะ VAT); route `tax/sync` (`tax.event.sync`, เฉพาะ `thai_tax`) ใช้ scope `ALL`
- **กฎ**
  - `periodKey` = เดือนตามวันที่จ่ายในเขตเวลาบริษัท (`formPeriodKey` → `civilPeriodKey`)
  - idempotency key ของ event: `sha256("<companyId>:<sourceType>:<sourceId>:<eventType>")` ตัด 32 ตัวอักษร; `sourceHash` = sha256 ของ JSON ที่เรียง key ตัด 16 ตัวอักษร (`domain/logic/tax-event.logic.ts`) — ถ้า hash เปลี่ยนจะ supersede event เดิมแล้วสร้างใหม่
  - งวดที่ล็อก (`FILED`/`PAID`/`CLOSED`) ไม่ถูกแก้: สร้าง review issue BLOCKING (`SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK`, `VOID_AFTER_TAX_PERIOD_LOCK`) แล้วข้าม
  - ไม่ทราบชนิดผู้รับ → issue `WHT_PAYEE_KIND_UNKNOWN` และ supersede event ที่เคยเดาเป็น PND53
  - รายการที่ `whtRemittance = E_WHT` ถูกบันทึกเป็น event สถานะ `EXCLUDED` (ตัวนับ `whtBankRemittedRecorded`)
  - review issue codes ที่สร้างได้ (`tax-period.logic.ts:83-127`): `WHT_PAYEE_KIND_UNKNOWN` (BLOCKING), `MISSING_TAX_ID` (BLOCKING), `MISSING_BRANCH_CODE` (WARNING), `WHT_RATE_MISMATCH` (WARNING), `DUPLICATE_SOURCE`, `CLOSED_PERIOD_CONFLICT`, `MISSING_LEDGER_DATA`, `INCOMPLETE_SOURCE_FACTS`, และฝั่ง VAT `UNKNOWN_VAT_MODE`, `INPUT_VAT_NOT_CLAIMABLE`, `MISSING_TAX_INVOICE`
- **ผลลัพธ์** `{ transactionTaxComponentsCreated, voidedComponentsSuperseded, vatOutputCreated, vatInputCreated, whtCreated, whtBankRemittedRecorded, reviewIssuesCreated, skippedLocked }`
- **ทดสอบ** `sync-tax-events-wht-form.use-case.spec.ts`, `sync-tax-events-supplier-payment-wht.use-case.spec.ts`, `sync-tax-events-components.use-case.spec.ts`, `expense-source.adapter.spec.ts`, `supplier-payment-source.adapter.spec.ts`

### FR-TAX-016 หน้ารายเดือนภาษีหัก ณ ที่จ่าย

- **permission** `wht.pnd53.read` · **แพ็ก** `ENTERPRISE_1999`
- **API** `GET tax/withholding/months` → `{ months: string[] }` รวมเดือนจาก (ก) `TaxPeriod` แบบ PND2/3/53 (ข) `TaxEvent` ที่ `ACTIVE` (ค) รายจ่าย `CONFIRMED` ที่ `whtAmount > 0` (ใช้เดือนของการจ่ายที่ยืนยันวันที่แล้ว ถ้ายังไม่จ่ายใช้เดือนของวันที่เอกสาร) (ง) `SupplierPayment` ที่ `RECORDED` — เรียงใหม่ไปเก่า; `GET tax/withholding/months/:periodKey` → `WithholdingMonthDto` อ่านใน transaction `RepeatableRead`
- **เนื้อหา DTO** (`generate-wht-report.use-case.ts:43-268`)
  - `payments[]` (PND3/PND53) และ `separatePnd2[]`: `paymentDate`, `payeeName`, `formType`, `incomeCategoryCode/Label`, `rate`, `paid`, `withheld`, `currency`, `sourceType/sourceId/expenseId`, `establishment`, `certificate { handoffId, state, number, canDownload }`, `paper`
  - `bankRemitted[]` รายการ e-WHT (event `EXCLUDED`) ไม่มีใบรับรอง
  - `unpaidExpenses[]` (รายจ่ายหักภาษีที่ยังไม่มีการจ่ายในเดือนนั้น), `undatedPayments[]` (การจ่ายที่ยังไม่ยืนยันวันที่), `paidWithoutWithholding[]` (จ่ายเต็มยอดรวมภาษี: `Σ payments ≥ netPayable + whtAmount`)
  - `establishments[]` การ์ดต่อสถานประกอบการ แต่ละใบมี `forms[]` (PND3, PND53) → `papers[]` (ปกติ + เพิ่มเติม) และ `monthTotals`
  - `establishmentIssues[]` (`WHT_PAYER_MODE_REQUIRED` / `WHT_BRANCH_HAS_NO_CODE`)
- **ค่าต่อแบบ (paper)** `kind` (`NORMAL`/`ADDITIONAL`), `sequence`, `status`, `paymentCount`, `totalPaid`, `totalWithheld` (ผลรวม `Prisma.Decimal` แสดง `toFixed(4)`), `dueDate`, `issues[]`, `canDownload`, `canMarkFiled`, `rowsCertain`, `accountantPrepared`, `accountantTypes[]`, `downloadedAt`, `filedAt`, `noticeCode` (`WHT_ADDITIONAL_SURCHARGE_MANUAL` สำหรับแบบเพิ่มเติม), `unfiledPaymentCount`, `cancellations`, `cancelledPayeeNames`, `paymentBasisChanged`, `canConfirmRows`, `rowsConfirmation`, `rowsUncertainNotice`
  - `canDownload = !uncertain && (ยื่นแล้ว || (มีแถว && ไม่มี issue BLOCKING))`
  - `canMarkFiled = !uncertain && status === 'EXPORTED' && !stale && ไม่มี issue BLOCKING`
  - `dueDate` = `TaxPeriod.dueDate` ถ้ามี มิฉะนั้นวันที่ 7 ของเดือนถัดไป (`evaluateDueDate(periodKey, { type: 'day_of_next_month', day: 7 })`)
  - แบบที่ `EXPORTED` แต่รายการเปลี่ยนหลังดาวน์โหลด → เพิ่ม issue `WHT_FILING_CHANGED_AFTER_DOWNLOAD` (WARNING, "ดาวน์โหลดแบบใหม่ก่อนยื่น")
  - แบบที่ยื่นแล้วแสดงยอดจากแถวที่แช่แข็ง (`WhtFilingLine.lineJson.payment[6]`, `[7]`) ไม่ใช่ข้อมูลปัจจุบัน
- **ขอบเขตสาขา** ทุก query ใช้ `branchScopeWhere(ctx.scopes)`; issue ของสาขาที่ผู้ใช้ไม่ได้ดูแลถูกซ่อนรายละเอียดเป็นข้อความ `E_WHT_WORDS['W-T5']`
- **ข้อผิดพลาด** 400 "เดือนภาษีไม่ถูกต้อง เลือกเดือนอีกครั้ง" (รูปแบบไม่ใช่ `YYYY-MM`)
- **หน้าจอ** `/tax/withholding` (`apps/web/src/features/tax/WithholdingPage.tsx`), `/tax/pnd53`
- **ทดสอบ** `WithholdingPage.spec.ts`, `tax.controller.spec.ts`, `expense-withholding-ux.spec.ts`

### FR-TAX-017 ใครเป็นผู้จ่ายและหักภาษี (payer mode) และสถานประกอบการ

- **permission** อ่าน: anyOf `wht.pnd53.read`, `company.legal_identity.manage`, `company.branch.read`; บันทึก: `company.legal_identity.manage` (ตรวจซ้ำในโค้ด → 403 `WHT_PAYER_MODE_FORBIDDEN`)
- **แพ็ก** ใช้กับ ภ.ง.ด. (`ENTERPRISE_1999`); หน้าตั้งค่าอยู่ใต้ตั้งค่าสาขา (ทุกแพ็กเห็นตามสิทธิ์)
- **กฎ** (`domain/logic/wht-payer-mode.logic.ts`)
  - โหมด `HEAD_OFFICE_PAYS_ALL` หรือ `EACH_BRANCH_PAYS` เก็บเป็น `WhtPayerModeFact` พร้อม `effectiveFromPeriodKey`; โหมดที่มีผลของเดือน M = fact ที่ยังไม่ `supersededAt` และ `effectiveFromPeriodKey ≤ M` ตัวล่าสุด (เรียง periodKey desc, `answeredAt` desc, id desc); แก้คำตอบของเดือนเดียวกันเท่านั้นที่ supersede
  - `resolveWhtEstablishment`: ถ้ามีสาขา `ACTIVE` > 1 และยังไม่ตอบโหมด → `SHOP_HAS_NOT_ANSWERED`; ใช้สำนักงานใหญ่เมื่อมีสาขาเดียว หรือโหมด `HEAD_OFFICE_PAYS_ALL` หรือรายการไม่มีสาขา; รหัสสาขาภาษี (`taxBranchCode`) ของสำนักงานใหญ่ default `00000`; รหัสต้องเป็นตัวเลข 5 หลัก มิฉะนั้น `BRANCH_HAS_NO_CODE`
  - การระบุสถานประกอบการเป็นการ "จัดกลุ่ม" เท่านั้น ไม่ปฏิเสธการจ่ายและไม่แก้แบบที่มีอยู่
- **ข้อผิดพลาด** `WHT_ESTABLISHMENT_FORBIDDEN` ("ไม่มีสิทธิ์เปิดแบบของสาขานี้ เลือกสาขาที่เปิดได้"), `WHT_ESTABLISHMENT_REQUIRED`, `WHT_ESTABLISHMENT_INVALID`, `WHT_BRANCH_HAS_NO_CODE`
- **audit** `tax.wht_payer_mode.answer` (HIGH)
- **API** `GET tax/withholding/payer-mode?periodKey=`, `POST tax/withholding/payer-mode`
- **หน้าจอ** `apps/web/src/features/branch-settings/WhtPayerModeSettings` · **ทดสอบ** `WhtPayerModeSettings.spec.ts`

### FR-TAX-018 ตรวจความพร้อมของแบบก่อนดาวน์โหลด

- **ไฟล์** `application/services/withholding-filing-validation.ts` (`withholdingRowFaults`, `withholdingPaperBlockers`, `validateWithholdingFiling`) — ใช้ร่วมทั้งหน้ารายเดือนและการ export
- **กฎระดับแบบ** (issue code `<PND3|PND53>_FILING_<REASON>`, ทั้งหมด BLOCKING)

  | reason | เงื่อนไข |
  |---|---|
  | `EMPTY` | ไม่มีรายการในเดือน ("เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ") |
  | `BANK_REMITTED_ONLY` | ไม่มีแถว เพราะทุกรายการจ่ายผ่าน e-WHT (ข้อความ `E_WHT_WORDS['W-T3']`) |
  | `MONTH` | `periodKey` ไม่ใช่ `YYYY-MM` |
  | `OVERDUE` | แบบปกติ (`sequence = 0`) และเวลาปัจจุบัน > `dueDay T16:59:59.999Z` (= 23:59:59.999 เวลาไทยของวันครบกำหนด) — "พ้นกำหนดยื่นแล้ว ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร" |
  | `BRANCHES` | ไม่ได้ระบุสถานประกอบการและรายการมาจากหลายสาขา |
  | `BRANCH` | ไม่พบสาขาที่จ่าย |
  | `PAYER` | ข้อมูลร้านไม่ครบ/ยาวเกิน: ชื่อจดทะเบียน (≤ 80), เลขผู้เสียภาษี 13 หลัก, รหัสสาขา 5 หลัก, ที่อยู่ (ต้องมี `line1`, `subdistrict`, `district`, `province`, `postalCode` 5 หลัก; `line1` ≤ 50, `line2`/ตำบล/อำเภอ/จังหวัด ≤ 35) |

- **กฎระดับแถว** (`withholdingRowFaults`)

  | reason | เงื่อนไข |
  |---|---|
  | `PAYEE` | ขาดชื่อ/เลขผู้เสียภาษี/ที่อยู่ หรือชื่อ > 80, เลขไม่ใช่ 13 หลัก, รหัสสาขาไม่ใช่ 5 หลัก (บุคคลธรรมดาเว้นว่างได้; นิติบุคคล default `00000`), ที่อยู่ > 104 ตัวอักษร |
  | `CATEGORY` | รหัสประเภทเงินได้ไม่อยู่ใน catalog |
  | `KIND` | แบบของประเภทเงินได้ไม่ตรงกับแบบที่ทำ หรือชนิดผู้รับเงินไม่ตรง (PND3 ต้อง `INDIVIDUAL`; PND53 ต้อง `JURISTIC`/`JURISTIC_PERSON`) |
  | `AMOUNT` | อัตรา ≤ 0, ฐาน ≤ 0, ภาษี < 0, ภาษี = 0 (ยกเว้นแถวจากการจ่ายรายครั้ง), หรือ **`|round(income × rate) / 100 − withheld| > 0.02`** (ยอมต่าง 2 สตางค์เพื่อรองรับการปัดของส่วนแบ่งการจ่าย) |
  | `EVENT` | event ไม่ใช่แบบนี้, สกุลเงินไม่ใช่ `THB`, หรือเดือนของวันที่ไม่ตรงงวด |
  | `SOURCE` | ต้นทางไม่ใช่ `expense.record` หรือ `procurement.supplier_payment` |

- **issue จากต้นทางสด** (ไม่รอ sync): `WHT_PAYEE_KIND_UNKNOWN`, `MISSING_TAX_ID` (เฉพาะ route `SYSTEM_FILLS`), `FUNCTIONAL_CURRENCY_FX_MISSING`, `WHT_FILING_CHANGED_AFTER_DOWNLOAD` (ข้อมูลรายจ่ายปัจจุบันไม่ตรงกับ event ที่บันทึก เทียบด้วย `sourceHash` และ `withholdingPaymentFacts`)
- **ประเภทที่ผู้ทำบัญชีทำเอง** ถ้ามีแถวที่ `filingRoute = ACCOUNTANT_PREPARES` ผลคือ `accountantPrepared: true`, `filing: null` (ไม่มี PDF) เหลือเฉพาะ issue ของ payer/branch; แถว `SEPARATE_PND2` ถูกตัดออกจากแบบ
- **การเรียงแถวในแบบ** `payeeTaxId` → `payeeBranch` → `paidAt` (เพื่อให้การจ่ายของผู้รับเดียวกันอยู่ติดกัน)
- **ทดสอบ** `generate-tax-filing-package.use-case.spec.ts` (1,055 บรรทัด), `tax-period.logic.spec.ts`

### FR-TAX-019 ดาวน์โหลดแบบ ภ.ง.ด.3 / ภ.ง.ด.53 (PDF บนแบบกรมสรรพากร)

- **permission** `wht.pnd53.prepare` · **แพ็ก** `ENTERPRISE_1999`
- **API** `POST tax/pnd53/periods/:periodId/export` หรือ `POST tax/withholding/:formType/periods/:periodId/export` body `{ exportFormat: 'PDF'|'XLSX', establishmentCode?, sequence? }` (รูปแบบอื่น → 400 "เลือกรูปแบบไฟล์แล้วดาวน์โหลดอีกครั้ง")
- **ขั้นตอนหลัก** (`GenerateTaxFilingPackageUseCase.execute`, `application/use-cases/generate-tax-filing-package.use-case.ts`)
  1. งวด `PND2` → 409 `WHT_PND2_SEPARATE` ("ประเภทนี้ต้องยื่น ภ.ง.ด.2 แยก ให้ผู้ทำบัญชีจัดทำแบบให้")
  2. หลายสถานประกอบการแต่ไม่ระบุ → 409 `WHT_ESTABLISHMENT_REQUIRED`; แบบที่ `rowsCertain = false` → 409 `WHT_FILING_ROWS_UNCERTAIN`
  3. ถ้าแบบนั้น `FILED` แล้ว: คืน**ไฟล์เดิมที่เก็บไว้** (ตรวจ sha256 กับ `TaxFilingPackage.checksum`; เปิดไม่ได้ → 409 `WHT_FILING_FILE_UNAVAILABLE` "เปิดแบบที่ยื่นไว้ไม่ได้ ลองอีกครั้งหรือติดต่อทีมงานมั่งมี")
  4. ตัดแถวที่อยู่ในแบบที่ยื่นแล้วออก (`withholdingPaperPayments`), เรียง (`orderWithholdingPayments`), ตรวจ (FR-TAX-018); มี BLOCKING → 409 พร้อม `issues[]`; ประเภทที่ผู้ทำบัญชีทำเองแต่ขอ PDF → 409 `WHT_ACCOUNTANT_PREPARES` ("ผู้ทำบัญชีจัดทำแบบนี้เอง ดาวน์โหลดรายการให้ผู้ทำบัญชีแทน")
  5. render PDF (ด้านล่าง) หรือ XLSX (FR-TAX-020)
  6. จองเลข `tax.filing_export` (idempotency `tax.filing_export:<periodId>:<format>:<checksum>`), เก็บไฟล์ที่ `"<companyId>/tax-filings/<uuid>"`, `recordWithholdingDownload` สร้าง/อัปเดต `WhtFiling` + `WhtFilingLine` (แช่แข็ง `lineJson` = แถวที่พิมพ์ + `payment` facts) + `TaxFilingPackage` ใน transaction `Serializable`; ชนกัน → 409 `WHT_FILING_CHANGED_DURING_DOWNLOAD` และลบไฟล์ที่เพิ่งเก็บ
  7. audit `tax.filing_package.generate` (HIGH)
- **โครง PDF** (`domain/logic/pnd53-official-form.logic.ts`, `pnd3-official-form.logic.ts`)

  | รายการ | ภ.ง.ด.53 | ภ.ง.ด.3 |
  |---|---|---|
  | แบบหลัก (asset) | `assets/rd-pnd53-main.pdf` (`WHT53_041060.pdf`) | `assets/rd-pnd3-main.pdf` (`270360_WHT3.pdf`) |
  | ใบแนบ (asset) | `assets/rd-pnd53-attachment.pdf` (`290360_attach53.pdf`) | `assets/rd-pnd3-attachment.pdf` (`270360_attach3.pdf`) |
  | หน้าแรก | แบบหลักด้านหน้าเท่านั้น (ลบหน้า 2 คำแนะนำ, ลบ `AcroForm`, ลบ `Annots`) | เหมือนกัน |
  | ใบแนบ | 6 ผู้รับเงินต่อแผ่น, สูงสุด 3 การจ่ายต่อผู้รับ (การจ่ายที่ 4 ของผู้รับเดิมขึ้นแถวใหม่) | เหมือนกัน |
  | การจัดกลุ่มผู้รับ | แถวติดกันที่ `payeeTaxId` + `payeeBranch` เท่ากัน | เหมือนกัน |
  | จำนวนแผ่นใบแนบ | `ceil(จำนวนกลุ่ม / 6)` | เหมือนกัน |

  ช่องในแบบหลัก: เลขผู้เสียภาษีผู้จ่าย 13 หลัก (ทีละหลักตรงกลางช่อง), สาขา 5 หลัก, ชื่อ, ที่อยู่ (คำแรกของ `line1` ลงช่อง "เลขที่" ที่เหลือลง "ถนน" โดยตัดคำว่า `ถนน` นำหน้า; `line2` ลงช่องอาคารถ้าพอดี มิฉะนั้นลงบรรทัดว่างข้างรหัสไปรษณีย์), ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์, ปี พ.ศ. (`ปี + 543`), ✓ เดือน (ตาราง 4 คอลัมน์ × 3 แถว: คอลัมน์ `floor((เดือน−1)/3)`, แถว `(เดือน−1) mod 3`), ✓ "ยื่นปกติ" หรือ ✓ "ยื่นเพิ่มเติมครั้งที่ N" + เลขครั้ง, ✓ มาตรา 3 เตรส, ✓ ใบแนบ, **จำนวนราย** = จำนวนแถวผู้รับที่มีเลขลำดับในใบแนบ (ไม่ใช่จำนวนการจ่าย), จำนวนแผ่นใบแนบ, รวมเงินได้, รวมภาษี; สำหรับแบบปกติเพิ่ม "เงินเพิ่ม" = `0.00` และ "รวมทั้งสิ้น" = รวมภาษี (แบบเพิ่มเติมเว้นสองช่องนี้ให้กรอกมือ)

  ช่องในใบแนบ: เลขผู้เสียภาษี+สาขาผู้จ่าย, แผ่นที่/ในจำนวน, ต่อผู้รับ: ลำดับที่ `(หน้า−1)×6 + ลำดับในหน้า`, เลขผู้เสียภาษี 13 หลัก, สาขา 5 หลัก, ชื่อ (ภ.ง.ด.3 แยกชื่อ/นามสกุลด้วย `splitPnd3PayeeName` — คำนำหน้า `นางสาว|นาง|นาย|น.ส.|ด.ช.|ด.ญ.` ติดกับชื่อ), ที่อยู่ (ภ.ง.ด.53 สองบรรทัด ตัดที่ช่องว่างสุดท้ายภายใน 52 ตัวอักษร เกินสองบรรทัด → error; ภ.ง.ด.3 บรรทัดเดียว), ต่อการจ่าย: วันที่ `dd/mm/พ.ศ.`, ประเภทเงินได้ (ชื่อไทย), อัตรา, เงินได้ (บาท/สตางค์แยกช่อง จาก `value.toFixed(2)`), ภาษี, เงื่อนไข = `1` (หัก ณ ที่จ่าย); ท้ายแผ่น: รวมเงินได้และภาษีของแผ่นนั้น
- **ผลรวม** `totalIncome = Σ line.income`, `totalTax = Σ line.withheld` (JavaScript number, พิมพ์ด้วย `toFixed(2)`)
- **ชื่อไฟล์** `ภ.ง.ด.3-<YYYY-MM>-<รหัสสาขา 5 หลัก>[-เพิ่มเติมครั้งที่-<N>].pdf` / `ภ.ง.ด.53-…` (`buildWithholdingArtifact` + `paperFileName`)
- **ข้อจำกัด** ต้องพิมพ์และเซ็นด้วยมือก่อนยื่น (ระบบไม่ยื่นอิเล็กทรอนิกส์)

### FR-TAX-020 "รายการให้ผู้ทำบัญชี" (XLSX ของ ภ.ง.ด.)

- **permission/แพ็ก** เหมือน FR-TAX-019 (`exportFormat: 'XLSX'`)
- **ไฟล์** `application/services/withholding-accountant-export.ts`
- **ชื่อไฟล์** `รายการให้ผู้ทำบัญชี-<PND3|PND53>-<YYYY-MM>-<รหัสสาขา>[-เพิ่มเติมครั้งที่-<N>].xlsx`
- **แผ่นงาน** แผ่นหลักชื่อ `ภ.ง.ด.3` หรือ `ภ.ง.ด.53`; ถ้ามีรายการ `WHT_PND2` ของเดือนนั้นเพิ่มแผ่น `ภ.ง.ด.2`; แถวหัวตรึง (`freezeRows: 1`)
- **คอลัมน์** (11 คอลัมน์): `วันที่จ่าย` (`formatThaiExportDate`), `ผู้รับเงิน`, `เลขผู้เสียภาษี`, `สาขา`, `ที่อยู่`, `ประเภทเงินได้` (ชื่อไทย), `อัตรา (%)` (ตัวเลข), `สกุลเงิน` (ชื่อไทยของสกุล), `ยอดจ่าย` (number), `ภาษีที่หักไว้` (number), `เลขที่หนังสือรับรอง 50 ทวิ` (เลขของระบบเมื่อ `SYSTEM_ISSUED`, เลขนอกระบบเมื่อ `EXTERNAL_LINKED`, มิฉะนั้นว่าง)
- **แถวรวม** หนึ่งแถวต่อสกุลเงิน: `รวม`, …, สกุลเงิน, `Σ ยอดจ่าย` และ `Σ ภาษี` ปัด `toFixed(2)` (ไม่รวมต่างสกุล)
- **หมายเหตุท้ายแผ่น** สำหรับแบบเพิ่มเติม: ชื่อผู้รับเงินที่ถูกยกเลิกจากแบบก่อน (`cancelledPayeesNote`)

### FR-TAX-021 แบบเพิ่มเติม (ยื่นเพิ่มเติมครั้งที่ N)

- **กฎ** (`application/services/withholding-filing-state.ts`): `openWithholdingSequence` — ยังไม่มีแบบปกติที่ `FILED` → 0; แบบปกติยื่นแล้วแต่ `rowsCertain = false` → `null` (เปิดแบบเพิ่มเติมไม่ได้); มิฉะนั้น = จำนวนแบบเพิ่มเติมที่ `FILED` + 1; ส่ง `sequence` ที่ไม่ตรง → 409 `WHT_FILING_SEQUENCE_INVALID`
- แบบเพิ่มเติมมีเฉพาะการจ่ายที่**ยังไม่อยู่**ในแบบที่ยื่นแล้ว (`filedLineCoversPayment`); ไม่ตรวจ `OVERDUE`; หน้าเว็บแสดง notice `WHT_ADDITIONAL_SURCHARGE_MANUAL` (เงินเพิ่มคำนวณเอง)

### FR-TAX-022 บันทึกว่ายื่นแบบแล้ว

- **permission** `wht.pnd53.prepare` + ต้องผ่าน **บทบาทผู้ตรวจภาษี** (`assertTaxReviewerRole`): ผู้ใช้ต้องเป็น `OWNER` หรือถือบทบาทตาม `CompanyTaxProfile.taxReviewerRole` (default `ACCOUNTANT`) มิฉะนั้น 403 `tax_reviewer_role_required` (`domain/logic/tax-reviewer.logic.ts`)
- **แพ็ก** `ENTERPRISE_1999`
- **API** `PATCH tax/pnd53/periods/:periodId/mark-filed` หรือ `PATCH tax/withholding/:formType/periods/:periodId/mark-filed` body `{ establishmentCode?, sequence?, note? }`
- **ขั้นตอน** (`tax.controller.ts:313-360`) sync WHT ก่อน → transaction `Serializable` + `FOR UPDATE` งวด → ต้องมีแบบสถานะ `EXPORTED` ที่ไฟล์ล่าสุด "ยังตรงกับข้อมูลปัจจุบัน" (`isWithholdingDownloadCurrent`: เทียบ `payment` facts ที่แช่แข็งกับปัจจุบัน) มิฉะนั้น 409 `WHT_FILING_CHANGED_AFTER_DOWNLOAD` ("มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น") → ไม่มี issue BLOCKING → `markWithholdingFilingFiled`, `TaxFilingPackage.status = ACCEPTED_MANUAL` + `filedManuallyAt/Note` → `rollUpWithholdingPeriod` (สถานะงวดสรุปจากทุกสถานประกอบการ)
- **ข้อผิดพลาด** `WHT_FILING_ALREADY_FILED` ("แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน"), `WHT_PND2_SEPARATE`, `<FORM>_FILING_REVIEW`
- **audit** `tax.period.mark_filed` (CRITICAL)

### FR-TAX-023 ยืนยันแถวของแบบที่ยื่นไว้ก่อนระบบแช่แข็งแถว

- **permission** `wht.pnd53.prepare` · **API** `POST tax/withholding/filings/:filingId/confirm-rows`
- **กฎ** (`application/services/legacy-withholding-filing.ts`) งวดเก่าที่ถูก restore โดยไม่มีแถวแช่แข็งแน่นอนจะมี `rowsCertain = false` ("รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง") ดาวน์โหลด/ยื่นไม่ได้จนกว่าผู้มีสิทธิ์จะยืนยัน; การยืนยันบันทึก `payerSnapshotJson.rowsConfirmation { userId, at }` และ render ไฟล์จากแถวที่แช่แข็ง; audit `tax.wht_filing.confirm_rows`; ไม่พบ → "ไม่พบแบบนี้ เปิดข้อมูลเดือนนี้ใหม่"

### FR-TAX-024 รายการที่ต้องแก้ (review issues) ของ ภ.ง.ด.

- **API** `GET tax/pnd53/periods/:periodId/review-issues` (หรือ `tax/withholding/:formType/…`) — `wht.pnd53.read`, คืนเฉพาะ `OPEN`; `PATCH tax/pnd53/review-issues/:issueId/resolve` — `wht.pnd53.prepare` + บทบาทผู้ตรวจภาษี, ต้องมี `note` (400 "Resolution note is required"), issue ต้อง `OPEN` (409)
- **API เสริม** `GET tax/pnd53/periods`, `GET tax/pnd53/periods/:periodId/events`, `POST tax/pnd53/periods/:periodId/report` (FR-TAX-026)
- **audit** `tax.review_issue.resolve` (HIGH)

### FR-TAX-025 e-WHT (ธนาคารนำส่งภาษี)

- **คำอธิบาย** ร้านที่สมัครบริการ e-WHT กับธนาคาร เลือกวิธีนำส่งต่อรายจ่ายเป็น "ธนาคารนำส่ง (e-WHT)" รายการนั้นไม่ต้องออก 50 ทวิ และไม่อยู่ในแบบ ภ.ง.ด.3/53
- **แพ็ก** การตั้งค่าและเลือกในรายจ่าย: ทุกแพ็ก (อยู่ใน feature `expenses`); รายงาน e-WHT รายเดือน: `ENTERPRISE_1999`
- **permission** ตั้งค่า `/settings/e-wht`: `company.setup.manage`; ดาวน์โหลดรายการ: `wht.pnd53.read`
- **กฎใน tax module** รายการ `whtRemittance = E_WHT` → `TaxEvent.status = EXCLUDED`; แสดงใน `bankRemitted[]` ของหน้ารายเดือน; ถ้าทั้งเดือนเป็น e-WHT แบบจะมี issue `…_FILING_BANK_REMITTED_ONLY`; ผู้รับเงินที่หัก 1% แต่ไม่ได้เลือก e-WHT ได้คำเตือน `WHT_RATE_MISMATCH` (ข้อความ `W-T4`)
- **ไฟล์ส่งออก** `GET tax/withholding/months/:periodKey/e-wht-export?establishmentCode=` → XLSX ชื่อ `จ่ายผ่าน e-WHT-<YYYY-MM>.xlsx`, แผ่นเดียวชื่อ `จ่ายผ่าน e-WHT` (`E_WHT_WORDS['W-X3']`), 10 คอลัมน์: `วันที่จ่าย`, `ผู้รับเงิน`, `เลขผู้เสียภาษี`, `สาขา`, `ที่อยู่`, `ประเภทเงินได้`, `อัตรา (%)`, `สกุลเงิน`, `ยอดจ่าย`, `ภาษีที่หักไว้` + แถว `รวม` ต่อสกุลเงิน (`toFixed(2)`); เรียง `eventDate asc, id asc`; audit `tax.withholding.e_wht_export` (HIGH, เก็บ checksum)
- **ถ้อยคำ** ทั้งหมดรวมที่ `E_WHT_WORDS` (`packages/contracts/src/tax.ts:81-125`) — ดูหัวข้อ 12
- **หมายเหตุ** กฎอัตรา e-WHT 1% (ช่วง 1 ม.ค. 2566–31 ธ.ค. 2570), การบังคับจ่ายผ่านธนาคาร และหน้าตั้งค่า อยู่ในโมดูล `expenses` (เอกสาร SRS ส่วนรายจ่าย); **ระบบไม่เชื่อมต่อธนาคารหรือส่งไฟล์ e-WHT เอง** — เป็นเพียงการบันทึกว่ารายการนั้นธนาคารเป็นผู้นำส่ง
- **ทดสอบ** `e2e/journeys/e-wht-payment.journey.spec.ts`, `EWhtSettingsPage.spec.ts`

### FR-TAX-026 สรุปยอดแบบ (WHT report snapshot)

- **permission** `wht.pnd53.prepare` (`POST tax/pnd53/periods/:periodId/report`) หรือ `tax.report.recompute` (`POST tax/periods/:periodId/wht-report`)
- **การคำนวณ** (`domain/logic/wht-report.logic.ts`) จัดกลุ่ม event `WHT_PND3`/`WHT_PND53` ที่ `ACTIVE` ด้วย key `ชื่อผู้รับ|เลขผู้เสียภาษี|รหัสประเภทเงินได้|อัตรา`; ต่อกลุ่ม `totalGross = Σ grossAmount`, `totalWithheld = Σ withheldAmount`, `totalNetPaid = Σ netPaidAmount`; รวมทั้งแบบ `totalGross`, `totalWithheld`, `payeeGroupCount`, `reviewIssueCount`; ใช้ `parseFloat` แล้ว `toFixed(4)` (ไม่ใช่ Decimal — ดู NFR-304)
- **ผล** บันทึก `TaxReportSnapshot { reportJson, checksum }` โดย checksum = sha256 ของ JSON ตัด 16 ตัวอักษร
- `validateCertificateTotals`: ยอดในใบรับรองต้องต่างจากยอด event ไม่เกิน `0.0001`

### FR-TAX-027 ประวัติใบ 50 ทวิ ต่อรายการ

- `WhtCertificateHistory` บันทึกทุกเหตุการณ์ (`appendWhtCertificateHistory`, `services/wht-certificate-history.ts`): ชนิดเช่น `ISSUED`, `CANCELLED_SOURCE_REOPENED`, การจด/เปลี่ยน/ถอนใบนอกระบบ, การแก้ไข, ใบแทน พร้อม `certificateNumber`, `certificateDate`, `relatedCertificateId/Number`, `isExternal`, `actorUserId`; อ่านผ่าน `GET wht/expenses/:expenseId/certificate-history` (ใหม่ไปเก่า)

### FR-TAX-028 การเปิดแก้รายจ่ายที่มีใบ 50 ทวิ / ยื่นแบบแล้ว

- เมื่อรายจ่ายต้นทางถูกเปิดแก้หรือยกเลิก (`cancelExpenseCertificateInTx`, `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:3449-3492`): ใบของระบบที่ `ISSUED` ถูกตั้งเป็น `VOIDED` พร้อม `voidReason` = `SOURCE_REOPENED` (เปิดแก้) หรือ `SOURCE_VOIDED` (ยกเลิก); handoff ถูกตั้งเป็น `CANCELLED`, ล้าง `certificateId` และข้อมูลใบนอกระบบทั้งหมด, `certificateRound` เพิ่ม 1; ประวัติบันทึก `CANCELLED_SOURCE_REOPENED` / `CANCELLED_SOURCE_VOIDED` / `EXTERNAL_RECORD_REMOVED` (พร้อม `reason`, `taxFilingAttested: true`); audit `tax.wht_certificate.cancel` (HIGH); ถ้าสถานะเปลี่ยนระหว่างทาง → 409 `expense_correction_source_changed`
- handoff กลับเป็น `REQUIRED` อีกครั้งในโมดูล `expenses` เมื่อรายจ่ายถูกยืนยันใหม่ (พบการเขียน `status: 'REQUIRED'` ที่ `prisma-expense.repository.ts:3559, 5166` — ไม่ได้อ่านเงื่อนไขรอบข้างทั้งหมด); การออกใบรอบใหม่ใช้ idempotency key ที่มี `:r<certificateRound>` และผูกใบเก่าที่ `SOURCE_REOPENED` เป็น predecessor (FR-TAX-005 ข้อ 5)
- แถวที่เคยอยู่ในแบบที่ดาวน์โหลดแล้วปรากฏใน `cancellations` ของแบบ (`services/withholding-filing-history.ts`); การจ่ายที่อยู่ในแบบที่ยื่นแล้วถูกล็อก (`filedWithholdingPaymentPeriods`, ข้อความ `withholdingPeriodLockedMessage`)
- **หมายเหตุ** ตรรกะฝั่งรายจ่าย (`lockExpenseCorrection`, `expense-void-blocker`) อยู่ในโมดูล `expenses`

### FR-TAX-029 เครื่องมือ LINE AI ที่อ่านข้อมูลภาษีหัก ณ ที่จ่าย

- contracts ประกาศ tool `wht.get_month_summary`, `wht.calculate_withholding` และ help topic `wht.certificate-meaning`, `wht.pnd53-due` (พบใน `packages/contracts/src`); AI Gateway เรียกผ่าน API ที่ตรวจ permission แล้วเท่านั้น รายละเอียดอยู่ในเอกสาร SRS ส่วน LINE AI

---

## 4. ส่วน B — ชุดส่งผู้ทำบัญชี

โค้ดหลัก: `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts` (use case), `domain/logic/expense-export.logic.ts` (workbook), `domain/logic/accounting-software-export.logic.ts` (สมุดรายวันซื้อ), `domain/logic/expense-record-pdf.logic.ts` (PDF ต่อรายการ) · controller `expense.controller.ts:243-292` (prefix `companies/:companyId/expenses`) · ค่าคงที่คอลัมน์ทั้งหมดอยู่ที่ `packages/contracts/src/expenses.ts:2077-2282`

**แพ็ก (ทุกข้อในส่วนนี้)** ทุกแพ็ก — feature `expenses` + sub-feature `expenses.evidence` อยู่ใน starter preset; **permission** `expense.export` (และ `expense.read` + การผ่าน `assertExpenseFinancialAccess` เว้นแต่ `SYSTEM_ADMIN`), หน้ามุมมองหลักฐานใช้ `expense.evidence.read`; ขอบเขตสาขาตาม `ctx.scopes` (`Branch is outside your assigned branch scope.`)

**ตัวกรองร่วม** (`AccountantEvidenceBundleDto`, `presentation/http/expense.dtos.ts:262-280`): `expenseIds[]` (≤ 10,000), `dateField` (`expenseDate` ค่าเริ่มต้น | `uploadedAt`), `yearMonth` (`YYYY-MM`), `fromDate`/`toDate` (ISO-8601), `branchId`, `expenseCategoryId`, `createdByUserId`, `status` (ค่าเริ่มต้น `CONFIRMED`) และตัวกรองของ `SharedEvidenceFilter` (`sourceDocumentType`, `taxEvidenceStatus`, `paymentStatus`, `postingStatus`)

### FR-TAX-030 มุมมองหลักฐานทางบัญชี (shared evidence)

- **คำอธิบาย** โฟลเดอร์เสมือนปี/เดือน (นับตามวันที่เอกสารหรือวันที่ส่งเข้า) และแถวรายจ่ายที่กรองตามสิทธิ์
- **permission** `expense.evidence.read` หรือ `expense.export`
- **API** `GET expenses/shared-evidence` (query: ตัวกรองร่วม + `page`, `pageSize`) → `{ folders, rows, total, … }`
- **หน้าจอ** `/expenses/evidence` (`apps/web/src/features/expenses/EvidencePanel…`)
- **ทดสอบ** `e2e/evidence.spec.ts`, `e2e/journeys/evidence-and-settings.journey.spec.ts`, `EvidencePanel.qa.spec.ts`, `evidence-audit.logic.spec.ts`

### FR-TAX-031 ไฟล์สรุปรายจ่ายสำหรับผู้ทำบัญชี (workbook)

- **API** `POST expenses/accountant-package` (body: ตัวกรองร่วม + `columnSet` `summary|full`, `format` `csv`, `page`, `pageSize` ≤ 500) → `{ indexXlsxBase64, indexFileName, paymentRowCount, withholdingRowCount, … }`
- **ชื่อไฟล์** `รายจ่าย-<ชื่อร้าน ≤ 40 ตัวอักษร>-<ช่วง>.xlsx` โดย `<ชื่อร้าน>` = `registeredName` (หรือ `name`) ผ่าน `bundleName` (ตัวอักษรที่ไม่ใช่ `A-Za-z0-9_`, ไทย `฀-๿`, `-` ถูกแทนด้วย `_`); `<ช่วง>` = `yearMonth` หรือ `<from>_<to>` หรือ `ทุกเดือน`
- **การอ่านข้อมูล** ถ้าไม่ส่ง `page`/`pageSize` ระบบวนอ่านทั้งชุด (หน้า ละ 500) เพื่อ export ทั้งการเลือก
- **แผ่นงาน** (ชื่อจาก `ACCOUNTANT_WORKBOOK_SHEETS`, ลำดับตาม `buildAccountantWorkbook`)

  1. **`ต้องตามเอกสาร`** — คอลัมน์ `เลขที่รายการ`, `สิ่งที่ต้องตาม`, `ดูรายการ` (ลิงก์ภายในไปยังแถวในแผ่นรายการ/การจ่าย/หัก ณ ที่จ่าย); ไม่มีรายการ → "ไม่พบรายการที่ต้องตามเอกสารจากข้อมูลในไฟล์นี้"
  2. **`สรุปรายเดือน`** — ตารางสรุป (`buildAccountantMonthSummary`): จำนวนรายการ, แยกตามหมวดค่าใช้จ่าย (`มูลค่าก่อน VAT`, `VAT`, `ยอดรวม`), แยกตาม VAT, สิทธิใช้ภาษีซื้อ, รายงานภาษีซื้อ (ในรายงาน / ไม่อยู่ในรายงาน), หัก ณ ที่จ่ายตามวันที่จ่ายในช่วงนี้ (`จำนวนเงินที่จ่าย`, `ภาษีที่หัก` แยก "ในช่วง", "จากรายจ่ายนอกช่วงเอกสาร", "e-WHT", "ส่วนต่าง"), การจ่ายในช่วงนี้ (รวม "การจ่ายที่ยังไม่ยืนยันวันที่"); หลายสกุลเงินแยกคอลัมน์ต่อสกุล ไม่รวมกัน
  3. **`รายการค่าใช้จ่าย`** — คอลัมน์ตาม `ACCOUNTANT_WORKBOOK_COLUMNS` (ยกเว้น `primary_file`):

     | key | หัวคอลัมน์ | key | หัวคอลัมน์ |
     |---|---|---|---|
     | `document_date` | วันที่เอกสาร | `input_vat_right` | สิทธิภาษีซื้อ |
     | `uploaded_at` | วันที่ส่งเข้ามั่งมี | `tax_evidence_status` | หลักฐานรายจ่าย |
     | (`shop_branch`) | สาขาของร้าน (เฉพาะเมื่อร้านมีหลายสาขา แทรกตำแหน่งที่ 3) | `wht_amount` | หัก ณ ที่จ่าย (ทั้งเอกสาร) |
     | `expense_number` | เลขที่รายการ | `net_payable_amount` | ยอดจ่ายสุทธิ |
     | (`record_files`) | เอกสารรายการ (PDF) (เฉพาะในชุด ZIP แทรกหลังเลขที่รายการ) | `paid_amount` | จ่ายแล้ว |
     | `vendor_document_number` | เลขที่ตามเอกสาร | `outstanding_amount` | ค้างจ่าย |
     | `source_document_type` | ประเภทเอกสาร | `last_paid_at` | วันที่จ่ายล่าสุด |
     | `vendor_name` | ผู้ขาย/ผู้รับเงิน | `advanced_by` | สำรองจ่ายโดย |
     | `vendor_tax_id` | เลขประจำตัวผู้เสียภาษีผู้ขาย | `expense_status` | สถานะ |
     | `vendor_branch` | สาขาผู้ขาย | `notes` | หมายเหตุ |
     | `vendor_address` | ที่อยู่ผู้ขาย | `wht_remittance` | วิธีนำส่งภาษีหัก ณ ที่จ่าย |
     | `category_name` | หมวดค่าใช้จ่าย | `taxable_amount` | มูลค่าก่อน VAT |
     | `description` | รายละเอียด | `vat_amount` | VAT |
     | `currency` | สกุลเงิน | `grand_total_amount` | ยอดรวมตามเอกสาร |

     เรียงตาม `document_date` แล้ว `expense_number`; ค่าว่างของรหัส → "ยังไม่ระบุ", ค่าที่ไม่มี label → "อื่น ๆ"; ไม่มีเลขที่ → "ยังไม่มีเลขที่"; วันที่ที่ AI อ่านไม่แน่ใจ → "ยังไม่ระบุ"
  4. **`การจ่าย`** (เมื่อมีการจ่าย) — `ACCOUNTANT_PAYMENT_SHEET_COLUMNS`: `วันที่จ่าย`, `เลขที่รายการ`, `ผู้ขาย/ผู้รับเงิน`, `ยอดจ่าย`, `สกุลเงิน`, `วิธีจ่าย` (`เงินสด`/`โอนเงิน`/`บัตรเครดิต`/`เช็ค`/`อื่นๆ`), `จ่ายจาก`, `เลขที่ใบสำคัญจ่าย` (เฉพาะเมื่อผู้ใช้มีสิทธิ์เห็นใบสำคัญจ่าย), `เอกสารรายการ (PDF)` (เฉพาะในชุด ZIP)
  5. **`หัก ณ ที่จ่าย`** (เมื่อมี) — `ACCOUNTANT_WITHHOLDING_SHEET_COLUMNS`: `วันที่จ่าย`, `เลขที่รายการ`, `ผู้รับเงิน`, `เลขประจำตัวผู้เสียภาษี`, `สาขา`, `ที่อยู่`, `แบบ ภ.ง.ด.`, `ประเภทเงินได้`, `อัตรา (%)`, `จำนวนเงินที่จ่าย`, `ภาษีที่หัก`, `สกุลเงิน`, `เลขที่หนังสือรับรอง 50 ทวิ` (เฉพาะเมื่อมีสิทธิ์เห็นใบรับรอง), `สถานะ` (`ยื่นแล้ว` / `งวดปิดแล้ว ตรวจกับแบบที่ยื่น` / `ยังไม่ยื่น ข้อมูลครบตามแบบ` / `ยังไม่ยื่น ต้องตรวจ <เหตุ>`), `หมายเหตุ` (เช่น "ผู้ทำบัญชีจัดทำแบบนี้เอง")
  6. **`รายงานภาษีซื้อ`** — FR-TAX-034
  7. **`ไฟล์ทั้งหมด`** (เฉพาะในชุด ZIP) — `เลขที่รายการ`, `ชนิดเอกสาร` (`เอกสารค่าใช้จ่าย`/`ใบรับรองแทนใบเสร็จ`/`หลักฐานการจ่าย`/`ใบสำคัญจ่าย`/`เอกสารประกอบการจ่าย`/`หนังสือรับรอง 50 ทวิ`/`ใบเบิก`/`เอกสารรายการ (PDF)`), `ฉบับ` (`ฉบับที่ใช้อยู่` / `ฉบับเดิม (มีฉบับใหม่แทนแล้ว)` / `ยกเลิกแล้ว (ไม่มีฉบับใหม่)`), `แทนด้วย`, `ไฟล์` (ลิงก์ไปไฟล์ใน ZIP), `ชุดที่` (เมื่อมีหลายชุด)
  8. **`เกี่ยวกับไฟล์นี้`** — `หัวข้อ`/`ค่า`: ร้าน, เลขประจำตัวผู้เสียภาษีของร้าน, ช่วงวันที่, นับตาม (`วันที่เอกสาร`/`วันที่ส่งเข้า`), สถานะเอกสาร, สาขา, สร้างเมื่อ, จำนวนรายการ, จำนวนการจ่าย, การจ่ายที่ยังไม่ยืนยันวันที่, หัก ณ ที่จ่าย, สกุลเงิน ("ยอดเงินเป็นสกุลตามคอลัมน์สกุลเงิน อย่ารวมต่างสกุล"), การตรวจไฟล์, ช่องที่ว่าง, ชุดที่, วิธีเปิดไฟล์
- **audit** `expense.accountant_package.create`
- **ทดสอบ** spec ในโมดูล `expenses` (`expense-export.logic.spec.ts` ฯลฯ), `e2e/evidence.spec.ts`

### FR-TAX-032 แผนชุดเอกสาร (bundle plan) และดาวน์โหลด ZIP

- **API** `POST expenses/accountant-package/bundle-plan` → `{ fileCount, partCount, counts { receipts, substituteReceipts, paymentSlips, vouchers, supportingFiles, whtCertificates, claimForms, recordPacks }, missingReceiptCount }`; `POST expenses/accountant-package/bundle/:part` → ไฟล์ ZIP (`application/zip`, `Cache-Control: private, no-store`, `Content-Disposition` แบบ `filename*=UTF-8''…`)
- **การแบ่งชุด** `EVIDENCE_BUNDLE_MAX_FILES = 60` ไฟล์ และ `EVIDENCE_BUNDLE_MAX_BYTES = 60,000,000` ไบต์ต่อชุด; ไฟล์เดียวที่ใหญ่เกินเดินทางในชุดของตัวเอง; ขนาดของ "เอกสารรายการ (PDF)" วัดจากการ render จริงแล้วจัดชุดซ้ำจนนิ่ง
- **เนื้อหา ZIP** (`zipStore` — เก็บแบบไม่บีบอัด)
  - ไฟล์ตามโฟลเดอร์ (FR-TAX-033)
  - `สารบัญ.xlsx` = workbook ของ FR-TAX-031 (`columnSet: 'full'`) ที่มีลิงก์ไปไฟล์ในชุด
  - `ไฟล์ที่ไม่ได้รวม.txt` (เมื่อมีไฟล์ที่ข้าม) — หนึ่งบรรทัดต่อไฟล์: `<เลขที่รายการ> <ชื่อไฟล์เดิม> ไม่ได้รวมเพราะ <เหตุผล>`; เหตุผล: `ไฟล์ยังตรวจสอบไม่เสร็จ`, `ไฟล์นี้เปิดไม่ได้`, `ไม่รองรับชนิดไฟล์นี้`, `ขนาดไฟล์เกินขอบเขตของชุดนี้ ลองดาวน์โหลดอีกครั้ง`, `ไม่พบไฟล์`, `สร้างชุดเอกสารรายการไม่ได้ ลองดาวน์โหลดอีกครั้ง`
- **ชื่อ ZIP** `หลักฐาน-<ชื่อร้าน>-<ช่วง>[-ชุดที่-<n>].zip`
- **ข้อผิดพลาด** `part` ไม่ใช่จำนวนเต็มในช่วง → 404
- **audit** `expense.accountant_bundle.download` (MEDIUM; metadata `workbook: 'accountant-v2'`, `part`, `fileCount`, `skippedCount`)
- **ทดสอบ** `EvidenceBundleDownload.spec.ts`, `e2e/evidence.spec.ts`

### FR-TAX-033 PDF หนึ่งไฟล์ต่อหนึ่งรายการ และกฎตั้งชื่อไฟล์ในชุด

- **PDF ต่อรายการ ("ชุดเอกสารรายการ")** (`buildExpenseRecordPdf`, `expense-evidence.use-case.ts:735-797`)
  - หนึ่งรายจ่าย = หนึ่ง PDF; ถ้ารายจ่ายหลายรายการถูกจ่ายด้วย**ใบสำคัญจ่ายใบเดียว** จะรวมเป็น PDF เดียวตั้งชื่อตามเลขที่ใบสำคัญจ่าย และใบสำคัญจ่ายเป็นหน้านำ (`leading`); รายจ่ายที่มีการจ่ายนอกใบสำคัญจ่ายนั้นได้ PDF ของตัวเองเพิ่ม
  - **ลำดับหน้า** (owner order): หน้าปก → หลักฐานการจ่าย (`paymentSlips`) → เอกสารประกอบการจ่าย (`supportingFiles`) → หนังสือรับรอง 50 ทวิ (`whtCertificates`) → เอกสารค่าใช้จ่าย (`receipts`) → ใบรับรองแทนใบเสร็จ (`substituteReceipts`) → ใบเบิก (`claimForms`); ฉบับที่ถูกแทน (`superseded`/`isHistorical`) ไม่รวม
  - **หน้าปก** (`RecordCover`): เลขที่รายการ, หน่วยเงิน, ช่อง `วันที่เอกสาร` (+ "(ควรตรวจอีกครั้ง)" เมื่อวันที่ไม่น่าเชื่อ), `ประเภทเอกสาร`, `เลขที่ตามเอกสาร`, `ผู้ขาย/ผู้รับเงิน`, `เลขประจำตัวผู้เสียภาษีผู้ขาย` (+สาขา), `หมวดค่าใช้จ่าย`, `รายละเอียด`; ยอด `มูลค่าก่อน VAT`, `VAT`, **`ยอดรวมตามเอกสาร`**, `หัก ณ ที่จ่าย`, **`ยอดจ่ายสุทธิ`**, `จ่ายแล้ว`, **`ค้างจ่าย`**; ตารางการจ่าย (วันที่ [+ "(ยังไม่ยืนยัน)"], วิธีจ่าย, บัญชี, ยอด); หมายเหตุ
  - ป้ายมุมขวาล่างของแต่ละหน้าตามชนิด (`RECORD_PACKET_LABELS`); ไฟล์ที่ฝังไม่ได้ถูกอ้างเป็น `referenced` หรือ `unavailable` พร้อมเหตุผล; อ้างถึงชุดอื่นที่เกี่ยวข้อง (`relatedPackets`)
- **กฎตั้งชื่อ** (`publicFileName`: ถ้าชื่อซ้ำเติม `-2`, `-3`, …; นามสกุลไม่ทราบใช้ `bin`; ทุกส่วนผ่าน `bundleName`)

  | ชนิด | path ใน ZIP |
  |---|---|
  | เอกสารรายการ (PDF) | `ชุดเอกสารรายการ/<เลขที่รายการ หรือเลขที่ใบสำคัญจ่าย>.pdf` |
  | เอกสารค่าใช้จ่าย | `เอกสารค่าใช้จ่าย/<เลขที่รายการ>-<ลำดับ>[-ฉบับเดิม].<ext>` |
  | ใบรับรองแทนใบเสร็จ | `ใบรับรองแทนใบเสร็จ/<เลขที่รายการ>-<ลำดับ>[-ฉบับเดิม].<ext>` |
  | หลักฐานการจ่าย | `หลักฐานการจ่าย/<เลขที่รายการ>-จ่าย-<ลำดับการจ่าย>.<ext>` |
  | หนังสือรับรอง 50 ทวิ | `หนังสือรับรอง 50 ทวิ/<เลขที่>…​.pdf` |
  | ใบเบิก | `ใบเบิก/<เลขที่ใบเบิก>.<ext>` |
  | เอกสารที่เปิดไม่ได้ | `เอกสารที่เปิดไม่ได้/<เลขที่รายการ>.pdf` |

- **ทดสอบ** spec ของ `expense-record-pdf.logic` และ `expense-evidence.use-case` ในโมดูล `expenses`

### FR-TAX-034 แผ่น "รายงานภาษีซื้อ" (รูปแบบรายงานภาษีซื้อของกรมสรรพากร)

- **ไฟล์** `buildAccountantPurchaseTaxRows` (`expense-export.logic.ts:547-646`)
- **โครง** หนึ่งบล็อกต่อ (เดือนของวันที่เอกสาร × สาขา) เรียงตาม key; หัวบล็อก: `เดือนภาษี` (ชื่อเดือนไทย พ.ศ.), `ชื่อผู้ประกอบการ`, `เลขประจำตัวผู้เสียภาษีอากร`, `ชื่อสถานประกอบการ`, `สำนักงานใหญ่/สาขาที่`
- **คอลัมน์** `ลำดับที่`, `วัน เดือน ปี`, `เลขที่/เล่มที่`, `ชื่อผู้ขายสินค้า/ผู้ให้บริการ`, `เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ`, `สำนักงานใหญ่` (✓ เมื่อสาขาผู้ขาย = `00000`), `สาขาที่`, `มูลค่าสินค้าหรือบริการ`, `จำนวนเงินภาษีมูลค่าเพิ่ม`; แถว `รวม` ปัด `ROUND_HALF_UP` 2 ตำแหน่ง
- **เงื่อนไขเข้ารายงาน** กลุ่มบรรทัดที่ `vatAmount ≠ 0` **และ** สิทธิภาษีซื้อ = `ใช้ได้ตามเงื่อนไข` **และ** รายจ่าย `CONFIRMED` **และ** สกุล `THB` **และ** มีวันที่เอกสารที่ยืนยัน **และ** ร้านจด VAT ณ วันนั้น (`effectiveVatStatus` ≠ `NOT_REGISTERED`/`UNKNOWN`) **และ** ข้อมูลร้านครบ (ชื่อจดทะเบียน, เลข 13 หลัก, สาขาเป็นสถานประกอบการ VAT, รหัสสาขา 5 หลัก) **และ** ข้อมูลผู้ขายครบ (เลขที่เอกสาร, ชื่อ; ถ้าเป็น `TAX_INVOICE` ต้องมีเลข 13 หลักและสาขา 5 หลัก)
- **รายการที่ไม่เข้า** แสดงท้ายแผ่นใต้หัว `รายการที่ไม่อยู่ในรายงาน` / `เหตุผล` / `สกุลเงิน` / `มูลค่าก่อน VAT` / `VAT` พร้อมลิงก์ไปแถวในแผ่นรายการ; เหตุผลเช่น "สิทธิภาษีซื้อรอตรวจสอบ", "รายการยังไม่ยืนยัน", "ยอดเป็นสกุลเงินอื่น ยังไม่มีอัตราแปลงเป็นบาท", "ร้านไม่ได้จด VAT ในช่วงรายการนี้ จึงไม่มีรายงานภาษีซื้อ", "ข้อมูลร้านยังไม่ครบสำหรับรายงานภาษีซื้อ", "ข้อมูลผู้ขายหรือเลขที่เอกสารยังไม่ครบ"
- **ข้อจำกัดที่ระบุในไฟล์เอง** "จัดตามเดือนวันที่เอกสาร ระบบยังไม่ได้เก็บเดือนที่ใช้สิทธิภาษีซื้อ", "แสดงเฉพาะรายจ่ายที่เลือก ให้สำนักงานบัญชีตรวจเดือนใช้สิทธิก่อนใช้รายงาน"; การเรียงในบล็อกตามวันที่รับเอกสาร (`receivedAt` หรือ `uploadedAt`)

### FR-TAX-035 สิทธิภาษีซื้อที่มีผล (input VAT right)

- **ฟังก์ชัน** `effectiveInputVatRight(record, line)` (`accounting-software-export.logic.ts:44-55`) คืนหนึ่งใน 5 ค่า:
  1. `ไม่มี VAT` — `vatAmount = 0` หรือ (บรรทัดมี tax component และ `claimabilitySnapshot = NOT_APPLICABLE`)
  2. `ใช้ไม่ได้` — `inputVatClaimStatus = NON_CLAIMABLE` หรือ `taxEvidenceStatus ∈ {SUPPORTING_ONLY, NOT_TAX_EVIDENCE}` หรือ claimability ∈ `{NONDEDUCTIBLE_EXPENSE, NONDEDUCTIBLE_CAPITALIZED}` หรือ review = `REJECTED`
  3. `รอตรวจสอบ` — `inputVatClaimStatus ≠ CLAIMABLE` หรือ `taxEvidenceStatus ≠ USABLE_FOR_TAX` หรือ claimability = `PENDING_EVIDENCE` หรือ review ≠ `VERIFIED`
  4. `ใช้ได้บางส่วน` — claimability = `PARTIAL`
  5. `ใช้ได้ตามเงื่อนไข` — กรณีที่เหลือ
- การปฏิเสธระดับเอกสารปัจจุบัน "ชนะ" snapshot ระดับบรรทัดที่เคยขอคืนได้เสมอ · **ทดสอบ** `e2e/journeys/expense-input-vat-right.journey.spec.ts`

### FR-TAX-036 ไฟล์นำเข้าโปรแกรมบัญชี — "สมุดรายวันซื้อ"

- **API** `POST expenses/accounting-software-export` body: ตัวกรองร่วม + `preset: 'purchase_journal'` (preset เดียวที่มี — `ACCOUNTING_SOFTWARE_EXPORT_PRESETS`; คอมเมนต์ระบุว่า preset เฉพาะผู้ขายโปรแกรม "รอ template ที่ยืนยันแล้ว")
- **เงื่อนไข** `status` ต้องเป็น `CONFIRMED` (หรือเว้น) มิฉะนั้น 422 `accounting_export_confirmed_only`
- **ผลลัพธ์** `{ preset, files: [{ fileName, xlsxBase64, rowCount }], documentCount, rowCount, excluded[], paymentNotExported: [], unmappedCategories[] }`
- **ชื่อไฟล์** `สมุดรายวันซื้อ-<ชื่อร้าน ≤ 40>-<ช่วง>.xlsx`
- **แผ่นที่ 1 `สมุดรายวันซื้อ`** — 25 คอลัมน์ตาม `PURCHASE_JOURNAL_COLUMNS` (แถวหัวตรึง):

  | # | key | หัวคอลัมน์ | รูปแบบ/ที่มา |
  |---|---|---|---|
  | 1 | `document_date` | วันที่เอกสาร | Excel serial date (`Date.parse(…)/86400000 + 25569`, style 4) |
  | 2 | `vendor_document_number` | เลขที่ตามเอกสาร | ข้อความ |
  | 3 | `expense_number` | เลขที่รายการ | ไม่มี → "ยังไม่มีเลขที่" |
  | 4 | `source_document_type` | ประเภทเอกสาร | label ไทย; ไม่มี → "ยังไม่ระบุ" |
  | 5 | `vendor_name` | ผู้ขาย/ผู้รับเงิน | |
  | 6 | `vendor_tax_id` | เลขประจำตัวผู้เสียภาษีผู้ขาย | |
  | 7 | `vendor_branch` | สาขาผู้ขาย (00000 = สำนักงานใหญ่) | `padStart(5,'0')` |
  | 8 | `account_code` | รหัสบัญชี | จากการผูกหมวด→บัญชีของผู้ทำบัญชี (FR-TAX-037); ไม่ผูก → ว่าง |
  | 9 | `account_name` | ชื่อบัญชี | |
  | 10 | `category_name` | หมวดค่าใช้จ่าย | หลายหมวดคั่นด้วย `, ` |
  | 11 | `description` | รายละเอียด | หมายเหตุรายจ่าย [+ ` · ` + คำอธิบายบรรทัดแรกเมื่อมีหลายกลุ่ม] |
  | 12 | `vat_treatment` | การใช้ VAT | `VAT 0%` / `ยกเว้น VAT` / `ไม่มี VAT` / `VAT <อัตรา×100>%` |
  | 13 | `taxable_amount` | มูลค่าก่อน VAT | number (style 3) |
  | 14 | `vat_amount` | VAT | number |
  | 15 | `grand_total_amount` | ยอดรวม | `taxable + vat` |
  | 16 | `input_vat_right` | สิทธิภาษีซื้อ | FR-TAX-035 |
  | 17 | `wht_form` | แบบ ภ.ง.ด. | `ภ.ง.ด.2`/`ภ.ง.ด.3`/`ภ.ง.ด.53`/`ยังไม่ระบุ`; ไม่มีหัก → ว่าง |
  | 18 | `wht_income_type` | ประเภทเงินได้ | ชื่อไทย |
  | 19 | `wht_base_amount` | ฐานหัก ณ ที่จ่าย | number |
  | 20 | `wht_rate` | อัตราหัก (%) | number หรือ "ยังไม่ระบุ" |
  | 21 | `wht_amount` | หัก ณ ที่จ่าย | number |
  | 22 | `net_payable_amount` | ยอดจ่ายสุทธิ | `grand_total − wht_amount` |
  | 23 | `payment_status` | สถานะการจ่าย | label ไทย |
  | 24 | `last_paid_at` | วันที่จ่ายล่าสุด | date; ยังไม่ยืนยันวันที่ → ข้อความ |
  | 25 | `advanced_by` | สำรองจ่ายโดย | ผู้ขอเบิก/ผู้สำรองจ่าย |

- **แผ่นที่ 2 `เกี่ยวกับไฟล์นี้`** — `หัวข้อ`/`ค่า`: `ร้าน`, `ช่วงวันที่`, `จำนวนแถว`, `สกุลเงิน` = `บาท`, `ช่องว่าง` = "ไม่มีข้อมูลนี้ในมั่งมี หรือไม่เกี่ยวกับรายการนี้", `รายการที่ไม่ได้ใส่` (จำนวน) ตามด้วยหนึ่งแถวต่อรายการที่ตัดออก (`เลขที่รายการ`, เหตุผล)
- **กฎการสร้างแถว** (`buildPurchaseJournalRows`)
  1. เรียงรายจ่ายตามวันที่เอกสาร แล้วเลขที่รายการ
  2. สกุลเงินไม่ใช่ `THB` → ตัดออก เหตุผล `foreign_currency` ("ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท")
  3. **จัดกลุ่มบรรทัด** (`groupExpenseLines`) ด้วย key `[บัญชีที่ผูก หรือหมวด, vatTreatment, vatRate, inputVatRight, มีหัก ณ ที่จ่ายแยกบรรทัด, รหัสประเภทเงินได้, อัตราหัก]` — หนึ่งแถวในไฟล์ต่อหนึ่งกลุ่ม; `vatTreatment` อนุมานจาก snapshot (`ZERO_RATED`/`EXEMPT` คงเดิม; `NON_TAXABLE`/`OUTSIDE_SCOPE` → `NON_VAT`; อัตรา > 0 → `STANDARD`)
  4. **กระทบกลับยอดหัวเอกสาร** (`allocateToHeader`): ผลต่าง `header.taxableAmount − Σ กลุ่ม` และ `header.vatAmount − Σ กลุ่ม` ต้อง ≤ `EXPENSE_TOTALS_TOLERANCE` (มิฉะนั้น throw); เศษฐานลงที่กลุ่มใหญ่สุด (กลุ่มมี VAT ถ้าหัวเอกสารมี VAT), เศษ VAT ลงที่กลุ่มที่มี VAT ใหญ่สุดเท่านั้น (เศษ VAT ต้องไม่ตกในกลุ่มยกเว้น/0%)
  5. **หัก ณ ที่จ่าย** (`withholdingForGroups`): ข้อมูลเก่าที่หักรายบรรทัด (ไม่มี `whtInputJson` และมี > 1 บรรทัด) → ฐาน = Σ `taxableAmount` ของบรรทัดที่หัก, ภาษี = Σ `whtAmount`; มิฉะนั้นใส่ทั้งเอกสารที่กลุ่มใหญ่สุด: ฐาน = `expenseWhtIncomeBase`, อัตรา = `expenseWhtHeaderRate`, ภาษี = `record.whtAmount`
  6. ทุกยอดปัด `Decimal.toFixed(2)`
- **เหตุผลตัดออกที่ประกาศไว้** (`ACCOUNTING_EXPORT_EXCLUSION_REASONS`): `foreign_currency`, `not_confirmed`, `vat_not_representable`, `wht_not_representable`, `wht_without_vendor_tax_id`, `wht_form_not_supported`, `wht_payee_kind_unknown`, `wht_mixed_income_types`, `wht_unpaid`, `wht_partly_paid`, `wht_paid_in_several_payments`, `wht_paid_date_unconfirmed`, `wht_payment_method_not_supported`, `account_unmapped`, `too_many_rows` — **ในโค้ดปัจจุบัน `buildPurchaseJournalRows` สร้างเฉพาะ `foreign_currency`**; เหตุผลอื่นมี label แต่ไม่พบจุดที่สร้าง (เหลือจากรุ่น preset เฉพาะโปรแกรม)
- **audit** `expense.accounting_software_export.create` (MEDIUM; metadata `preset`, `documentCount`, `rowCount`, `excludedCount`, `excludedByReason`)

### FR-TAX-037 การผูกหมวดค่าใช้จ่ายกับรหัสบัญชีของผู้ทำบัญชี

- ตารางจาก migration `20261104090000_expense_category_accountant_account`; อ่านผ่าน `repo.findCategoryAccountantAccounts(companyId, categoryIds)` → `{ expenseCategoryId, accountCode, accountName }`; หมวดที่ยังไม่ผูกถูกรายงานใน `unmappedCategories[]` และคอลัมน์รหัสบัญชีเว้นว่าง (ไม่ตัดแถวออก)
- เป็นรหัสบัญชีแบบข้อความอิสระของสำนักงานบัญชี **ไม่ผูกกับ `ChartOfAccount` ของโมดูล ledger** (ต่างจาก expense account binding ใน FR-TAX-076)
- API/หน้าจอสำหรับแก้ไขการผูกอยู่ในส่วนหมวดค่าใช้จ่ายของโมดูล `expenses` (ไม่ได้ตรวจ endpoint ในเอกสารนี้)

---

## 5. ส่วน C — โครงสร้างพื้นฐาน

### FR-TAX-040 ตั้งค่า tax code เริ่มต้นให้ร้านใหม่ (bootstrap)

- **คำอธิบาย** ร้านใหม่ต้องคำนวณภาษีซื้อขอคืนได้ตั้งแต่วันแรก โดยไม่ต้องเปิด Tax workspace
- **แพ็ก** ทุกแพ็ก (ทำงานตอน onboarding)
- **ขั้นตอน** `bootstrapCompanyTaxConfiguration` (`apps/api/src/modules/tax/application/services/tax-config-bootstrap.service.ts`): ใช้ template `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` สร้าง `CompanyTaxCodeProfile` สถานะ `ACTIVE` (version 1, `countryCode: 'TH'`, `effectiveFrom` = 1 ม.ค. ของ**ปีก่อน**ปีที่สมัคร เพราะภาษีซื้อขอคืนได้ย้อน 6 เดือน), `TaxCodeDefinition` 2 รหัส (`V7` "ภาษีซื้อขอคืนได้ 7%" และ `ND` "ภาษีซื้อขอคืนไม่ได้ 7%", `calculationMethod: EXCLUSIVE`), `TaxAccountDeterminationRule` ตาม `requiredAccountAssignments` โดยจับคู่ account role → รหัสบัญชีจาก `TH_SME_COA_V1_MAPPING_MANIFEST`, และ `TaxReportMappingRule` ตาม `requiredReportMappings`
- **กฎ** ผู้ตรวจที่บันทึกคือ actor ระบบ `system:tax-config-bootstrap` (ไม่อ้างว่ามนุษย์ตรวจแล้ว); ปฏิเสธการรันซ้ำ
- **ข้อผิดพลาด** (422) `tax_config_template_missing`, `tax_config_already_bootstrapped`, `tax_config_account_role_unmapped`, `tax_config_account_missing`
- **ข้อมูล** `CompanyTaxCodeProfile`, `TaxCodeDefinition`, `TaxAccountDeterminationRule`, `TaxReportMappingRule`, `ChartOfAccount`

### FR-TAX-041 ผังบัญชีมาตรฐานเริ่มต้น

- `apps/api/src/modules/ledger/application/services/chart-template-bootstrap.service.ts` ติดตั้งผังบัญชี `TH_SME_COA_V1` (`domain/catalog/th-sme-chart-of-accounts-v1.ts`, 293 บรรทัด) ให้ร้านตอน onboarding และประทับ provenance บน `Company` (`chartOfAccountsTemplateKey/Version/Checksum/AppliedAt`); เมื่อมี provenance แล้ว การลงบัญชีอัตโนมัติจะ**ไม่**ย้อนไปใช้รหัสบัญชี default แบบฝังในโค้ด (`requiresReviewedPostingRules`, FR-TAX-075)
- **แพ็ก** ทุกแพ็ก (เบื้องหลัง); หน้าจัดการผังบัญชีต้องมี `double_entry_ledger` (ส่วน E)
- **ทดสอบ** `chart-template-bootstrap.service.spec.ts`

---

## 6. ส่วน D — Tax workspace (`thai_tax`)

> **สถานะขอบเขต: ไม่มีแพ็กใดให้ feature `thai_tax`** (หัวข้อ 1.2) ทุกข้อในส่วนนี้ **แพ็ก: ไม่มี — เปิดได้เฉพาะ System Partner admin** บทบาทเริ่มต้นที่ถือสิทธิ์: FINANCE, ACCOUNTANT (อ่าน: + MANAGER, AUDITOR_READONLY บางคีย์) controller: `tax.controller.ts` และ `transaction-tax.controller.ts` (prefix `companies/:companyId/tax`) หน้าจอหลัก `/tax` (`TaxWorkspacePage`)

### FR-TAX-050 โปรไฟล์ภาษีของร้าน (company tax identity)

- **API** `GET tax/profile` (`tax.profile.read`) คืน `CompanyTaxProfile` หรือค่า default `{ vatRegistered: false, branchPolicy: 'HEAD_OFFICE_ONLY', taxReviewerRole: 'ACCOUNTANT', signatureMode: 'BLANK', signatureImageAttachmentId: null }`
- **การใช้ตัวตนภาษีของร้านในเอกสาร** เลขผู้เสียภาษีผู้จ่าย = `CompanyTaxProfile.taxId` ถ้ามี มิฉะนั้น `Company.taxId` (ตัดอักขระที่ไม่ใช่ตัวเลข); ชื่อ = `Company.registeredName`; ที่อยู่ = `Company.addressJson` (สำนักงานใหญ่) หรือ `Branch.addressJson`; รหัสสาขา = `Branch.taxBranchCode` (default `00000`) — `withholding-filing-validation.ts` และ `services/wht-payer-identity.ts`; ใบ 50 ทวิ ใช้ `whtPayerIdentity(prefill.payerSnapshot, currentWhtPayerDetails)` ซึ่งคืน `missing[]` ถ้าไม่ครบ; สถานะจด VAT ตามช่วงเวลาใช้ `effectiveVatStatus(registrationFacts, day)` (FR-TAX-034)
- **บทบาทผู้ตรวจภาษี** `taxReviewerRole` บังคับใช้กับ mark-filed และ resolve issue (FR-TAX-022)

### FR-TAX-051 งวดภาษีและรายการภาษี

- `GET tax/periods` (`tax.period.read`; query `taxType`, `status`, `page`, `pageSize` default 20); `GET tax/periods/:periodId/events` (`tax.event.read`); `POST tax/sync` (`tax.event.sync`; body `{ since? }`; scope `ALL` — FR-TAX-015)
- **periodKey** (`formPeriodKey`, `tax-period.logic.ts:22-40`): `PP30`/`PP36`/`PND2`/`PND3`/`PND53`/`CUSTOMS_SUPPORT` → `YYYY-MM`; `PND50` → `YYYY`; `PND51` → `YYYY-H1` (เดือน ≤ 6) หรือ `YYYY-H2`
- **วันครบกำหนด** `evaluateDueDate(periodKey, { type: 'day_of_next_month', day })` = วันที่ `day` ของเดือนถัดไป (UTC); กฎมาจาก config (`TaxCalendarRule`) ไม่ฝังในโค้ด; `pnd53PaperDueDay` ใช้วันที่ 7 เป็น default

### FR-TAX-052 รายงาน VAT (ภ.พ.30 / ภ.พ.36) จาก tax event

- **API** `POST tax/periods/:periodId/vat-report` (`tax.report.recompute`; body `{ formType?: 'PP30'|'PP36', periodKey }`)
- **การคำนวณ** (`domain/logic/vat-report.logic.ts`) จาก event `VAT_OUTPUT`, `VAT_INPUT`, `VAT_EXEMPT`, `VAT_REVIEW` ที่ `ACTIVE`:
  - `included = eventType ∉ {VAT_REVIEW, VAT_EXEMPT}`
  - `outputVatTotal = Σ taxAmount` ของ `VAT_OUTPUT` ที่ included; `inputVatTotal = Σ taxAmount` ของ `VAT_INPUT` ที่ included
  - **`netVatPayable = outputVatTotal − inputVatTotal`**
  - `reviewNeededTotal = Σ taxAmount` ของ `VAT_REVIEW`; `lineCount` = จำนวนบรรทัดที่ไม่ใช่ `VAT_REVIEW`
  - ใช้ `parseFloat` + `toFixed(4)`
- **คอลัมน์บรรทัด** `taxEventId`, `eventType`, `eventDate`, `counterpartyName`, `counterpartyTaxId`, `taxInvoiceNumber`, `taxableBase`, `taxAmount`, `outputTaxCode`, `included`, `reviewNote`, `sourceRef`
- **ผล** บันทึก `TaxReportSnapshot` (checksum sha256 ตัด 16) · **ทดสอบ** `vat-report.logic.spec.ts`
- **กฎภาษีซื้อ** (ใน sync, `sync-tax-events.use-case.ts`) event `VAT_INPUT` ของรายจ่ายสร้างเฉพาะเมื่อ `inputVatClaimStatus = CLAIMABLE` **และ** `taxEvidenceStatus = USABLE_FOR_TAX` (มิฉะนั้น supersede event เดิม); component ที่ `evidenceStatus ≠ VERIFIED` สร้าง issue BLOCKING `TAX_EVIDENCE_NOT_VERIFIED`; สกุลเงินของ snapshot ไม่ตรงสกุลฐาน → `FUNCTIONAL_CURRENCY_SNAPSHOT_INVALID`

### FR-TAX-053 กล่อง ภ.พ.30 (PP30 boxes)

- **API** `GET tax/reports/pp30-boxes` (`tax.report.read`)
- **สูตร** (`aggregatePp30Boxes`, `transaction-tax.logic.ts:384-405`) รวม `reportContributions` ของ `formType = PP30` ตาม `boxKey`:
  - `box1TotalSales = Σ box_1_total_sales`; `box2ZeroRatedSales = Σ box_2_zero_rated_sales`; `box3ExemptSales = Σ box_3_exempt_sales`
  - **`box4TaxableSales = box1 − box2 − box3`**
  - `box5OutputTax = Σ box_5_output_tax`; `box6EligiblePurchases = Σ box_6_eligible_purchases`; `box7InputTax = Σ box_7_input_tax`
  - **`box8TaxPayable = max(box5 − box7, 0)`**; **`box9TaxOverpaid = max(box7 − box5, 0)`**
  - ปัดตาม rounding policy (default `HALF_UP`, 2 ตำแหน่ง)

### FR-TAX-054 การคำนวณภาษีรายบรรทัด (transaction tax)

- **ไฟล์** `domain/logic/transaction-tax.logic.ts` (`calculateAmounts`, `resolveTransactionTaxPreview`)
- **rounding policy** default `{ roundingMode: 'HALF_UP', roundingScale: 2, taxAmountTolerance: '0.01' }`; โหมดที่รองรับ `HALF_UP`, `HALF_EVEN`, `DOWN`, `UP`
- **สูตร** (`rate` เป็นเปอร์เซ็นต์)
  - `INCLUSIVE` และ `rate > 0`: `base = gross × 100 / (rate + 100)`, `tax = gross − base`
  - `EXCLUSIVE` และ `rate > 0`: `base = net`, `tax = net × rate / 100`
  - นำเข้าบริการ self-assessed (ภ.พ.36): ใช้ `authoritativeSelfAssessedTaxBaseAmount`/`…TaxAmount` ถ้ามี มิฉะนั้น `net × rate / 100`
  - นำเข้าสินค้า: `base = authoritativeCustomsValue`, `tax = authoritativeImportVatAmount`
  - แล้วปัด `base` และ `tax` ตาม policy และคูณ `correctionSign` (±1)
  - แปลงสกุล: `amount × exchangeRate` เมื่อสกุลต้นทาง ≠ สกุลภาษี
- **การตรวจ** treatment `ZERO_RATED`/`EXEMPT`/`NON_TAXABLE`/`OUTSIDE_SCOPE` แต่ภาษี ≠ 0 → `zero_tax_treatment_has_tax_amount`; ภาษีที่ผู้ใช้กรอกต่างจากที่คำนวณเกิน tolerance → `entered_tax_amount_outside_tolerance`
- **API** `POST tax/resolve-preview` (`company.branch.read`) — ใช้โดยฟอร์มรายจ่าย/เอกสารขาย (`TransactionTaxLineSelector`)
- **ทดสอบ** `transaction-tax.logic.spec.ts`, `e2e/transaction-tax.spec.ts`

### FR-TAX-055 Tax code profile และ template

- **API** `GET tax/code-profiles` (`tax.profile.read`), `GET tax/code-profile-templates`, `POST tax/code-profile-templates/:templateKey` (`tax.profile.manage` + `tax.config.manage`), `POST tax/code-profiles`, `PATCH tax/code-profiles/:profileId`, `GET …/readiness` (`tax.profile.read` + `tax.config.read`), `POST …/activate`, `POST …/retire` (`tax.profile.manage`)
- **Template ในตัว** (`domain/tax-code-template.catalog.ts`)

  | key | รหัส |
  |---|---|
  | `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` | `V7` (ขอคืนได้ 7%), `ND` (ขอคืนไม่ได้ 7%) |
  | `SAP_ERP_TH_LEGACY` | `O7`, `O0`, `OX`, `O1` (10%), `DS`, `DT` |
  | `SAP_S4_TH_CURRENT` | ขาย: `O0`, `O1` (7%), `O2` (10%), `OX`, `WS`, `DL`, `DM`, `DN`; ซื้อ: `V0`, `V1` (7%), `V2` (10%), `VX`, `WP`, `V3`/`V4` (self-assessed นำเข้าบริการ, `PAYMENT_EVIDENCE`), `D0`–`D2`, `N1`/`N2`, `U1`/`U2` |

- **กฎ** profile มีสถานะ (`TaxCodeProfileStatus`); activate ต้องผ่าน readiness (ครบ account assignment และ report mapping ตาม `requiredAccountAssignments`/`requiredReportMappings` ใน `tax-configuration.logic.ts`)
- **หน้าจอ** `/settings/tax-codes` (`TaxCodeSettingsPage`) · **ทดสอบ** `transaction-tax-config.use-case.spec.ts`, `tax-code-template.catalog.spec.ts`, `tax-configuration.logic.spec.ts`

### FR-TAX-056 Tax code definition และการนำเข้า

- **API** `GET tax/code-definitions` (`company.branch.read`), `POST tax/code-definitions`, `PATCH tax/code-definitions/:taxCodeId` (`tax.config.manage`), `POST tax/code-profiles/:profileId/import-preview`, `…/import-apply` (`tax.config.manage`)
- **นำเข้า** (`tax-code-import.use-case.ts`) รูปแบบ `CSV` (แถวแรกเป็นหัวคอลัมน์) หรือ `JSON` (array ของ object); รับเฉพาะ regime `VAT`/`IMPORT_VAT`; `calculationMethod ∈ {EXCLUSIVE, INCLUSIVE, NONE}`; `claimabilityDefault ∈ {NOT_APPLICABLE, CLAIMABLE, PENDING_EVIDENCE, PARTIAL, NONDEDUCTIBLE_EXPENSE, NONDEDUCTIBLE_CAPITALIZED}`; ทำได้เฉพาะ profile สถานะ `DRAFT` (409); preview คืน checksum; apply ต้องส่ง checksum ตรงและ `canApply` (422 `tax_code_import_blocked`); รหัสที่นำเข้ามีสถานะ `REVIEW_REQUIRED`; transaction `Serializable`; audit `tax.code_definition.import`; outbox `tax.code_definitions.imported`
- **ทดสอบ** `tax-code-import.use-case.spec.ts`

### FR-TAX-057 การกำหนดบัญชีภาษี (account determination) และ report mapping

- **API** `GET tax/account-determination` (`ledger.posting-rule.read`), `PUT tax/account-determination` (`tax.config.manage` + `ledger.posting-rule.manage`), `GET tax/report-mappings` (`tax.config.read`), `PUT tax/report-mappings` (`tax.config.manage`)
- **กฎ** `selectTaxAccountRule` เลือกกฎที่เจาะจงที่สุด (transactionContext/sourceModule ว่าง = เจาะจงน้อยสุด); account role ตาม enum `TaxAccountRole` (เช่น `INPUT_VAT_PENDING`); report mapping ระบุ `formType`, `boxKey`, `amountSource` (`TAX_BASE`/`TAX_AMOUNT`/`GROSS`/`DUTY`/`OTHER`), `signRule` (`INVERT` คูณ −1)
- **หน้าจอ** `/settings/tax-accounts` (`TaxAccountSettingsPage`)

### FR-TAX-058 หลักฐานภาษีการค้า (trade evidence)

- **API** `GET tax/trade-evidence` (`tax.config.read`), `POST tax/trade-evidence` (`company.branch.read`), `POST tax/trade-evidence/:evidenceId/verify` (`tax.config.manage`)
- **กฎ** นโยบายหลักฐานอยู่ที่ `domain/logic/tax-evidence-policy.logic.ts` · **หน้าจอ** `/tax/evidence` (`TradeTaxEvidencePage`) · **ทดสอบ** `tax-evidence-policy.logic.spec.ts`, `trade-tax-evidence-preview.spec.ts`

### FR-TAX-059 กระทบยอดภาษี (tax reconciliation)

- **API** `POST tax/reconciliations` (`tax.report.recompute`), `GET tax/reconciliations`, `GET tax/reconciliations/:runId` (`tax.report.read`), `POST tax/reconciliations/:runId/review` (`tax.review_issue.resolve`)
- **สูตร** (`reconcileTaxFact`, `domain/logic/tax-reconciliation.logic.ts:55-89`) ต่อ fact (key `sourceType|sourceId|sourceLineKey|componentKey`):
  - ถ้าภาษีต้นทางและ event เป็น 0 ทั้งคู่ (จัดประเภท 0%): `sourceEventDelta = sourceBase − eventBase`, `eventReportDelta = eventBase − report`; มิฉะนั้น `sourceEventDelta = sourceTax − eventTax`, `eventReportDelta = eventTax − report`
  - `eventJournalDelta = eventTax − journalTax`
  - tolerance default `0.01`
  - **ลำดับ issue code** (อันแรกที่เข้า): `MISSING_TAX_CODE` (component `VAT`/`IMPORT_VAT`/`PP36_OUTPUT`/`PP36_INPUT` ไม่มีรหัส) → `EVIDENCE_PENDING` → `MISSING_ACCOUNT_RULE` → `MISSING_REPORT_RULE` → `SOURCE_EVENT_MISMATCH` → `EVENT_JOURNAL_MISMATCH` → `REPORT_MISMATCH` → `MATCHED`; ทุกอย่างที่ไม่ใช่ `MATCHED` เป็น blocking
  - ค่า delta ปัด 4 ตำแหน่ง `ROUND_HALF_UP`
  - component ต่อแบบ (`taxComponentInForm`): PP36 ← `PP36_OUTPUT`; PP30 ← `VAT`, `IMPORT_VAT`, `PP36_INPUT`; `CUSTOMS_SUPPORT` ← `CUSTOMS_DUTY`, `EXCISE_TAX`, `OTHER_IMPORT_TAX`
- **หน้าจอ** `/tax/reconciliation` (`TaxReconciliationPage`) · **ทดสอบ** `tax-reconciliation.logic.spec.ts`, `transaction-tax-reconciliation.use-case.spec.ts`

### FR-TAX-060 ชุดไฟล์ตรวจภาษี (generic filing package)

- **API** `POST tax/periods/:periodId/filing-packages` (`tax.report.export`; body `{ exportFormat: 'REVIEW_JSON'|'CSV'|'XLSX'|'PDF', establishmentCode?, sequence? }`)
- **เงื่อนไข PP30/PP36** ต้องมี `TaxReconciliationRun` ล่าสุดสถานะ `REVIEWED` และ `blockingIssueCount = 0`, ไม่มี review issue BLOCKING, และข้อมูลต้นทางไม่เปลี่ยนหลังการ review (มิฉะนั้น 409)
- **โครงไฟล์** (`domain/logic/tax-export.logic.ts`; ชื่อ `tax-<formType>-<periodKey>.<ext>`)
  - แถวข้อมูล 11 field: `eventType`, `sourceType`, `sourceId`, `eventDate`, `outputTaxCode`, `taxInvoiceNumber`, `taxableBase`, `taxAmount`, `grossAmount`, `withheldAmount`, `reviewNote`
  - `CSV`: หัว = key ของแถวแรก, เซลล์ผ่าน `safeCsvCell`, คั่น `,` ขึ้นบรรทัด `\n` (ไม่มีแถว → ไฟล์ว่าง)
  - `XLSX`: แผ่นเดียวชื่อ `Tax Review`; ค่าที่เป็น ISO date แปลงเป็นวันที่ไทย; ไม่มีแถว → `message: No rows`
  - `REVIEW_JSON`: `{ generatedAt, period, latestReport, rows, reviewIssues, disclaimer }`
  - `PDF`: PDF หน้าเดียวแบบ minimal (Helvetica, **ไม่รองรับอักษรไทย**) 7 บรรทัด: หัว, `Form`, `Period`, `Status`, `Rows`, `Open review issues`, "Manual filing only. Confirm with accountant/RD before submission."
- สำหรับ `PND3`/`PND53` + `PDF`/`XLSX` endpoint นี้ทำงานเหมือน FR-TAX-019/020; หลังสร้าง (กรณีไม่ใช่ ภ.ง.ด.) งวดเป็น `EXPORTED`
- **ทดสอบ** `tax-export.logic.spec.ts`

### FR-TAX-061 บันทึกยื่น/ชำระ (แบบที่ไม่ใช่ ภ.ง.ด.3/53)

- `PATCH tax/periods/:periodId/mark-filed` (`tax.filing.mark_filed` + บทบาทผู้ตรวจ): งวดต้อง `EXPORTED`, มี package สถานะ `GENERATED`/`DOWNLOADED`, ไม่มี issue BLOCKING, PP30/PP36 ต้องมี reconciliation `REVIEWED` และไม่มี event ที่ `updatedAt` หลังการ review/การสร้าง package → งวดเป็น `FILED`, package `ACCEPTED_MANUAL`
- `PATCH tax/periods/:periodId/mark-paid` (`tax.filing.mark_paid`): งวดต้อง `FILED` → `PAID`; audit `tax.period.mark_paid` (CRITICAL)

### FR-TAX-062 ออก 50 ทวิ จาก tax event (ทาง Tax workspace แบบเดิม)

- `POST tax/wht-certificates` (`tax.certificate.issue`): `CreateWhtCertificateUseCase` รับ `taxPeriodId` + `taxEventIds` (ต้องเป็น event WHT ทั้งหมด; "Some WHT tax events were not found.", "50 Tawi certificate can include WHT events only."); ตรวจ launch route เดียวกับ FR-TAX-005; ประเภทที่ไม่รองรับ → `wht_certificate_income_unsupported`; ใช้ renderer และเลข `tax.wht_certificate` เดียวกัน · **ทดสอบ** `create-wht-certificate.use-case.spec.ts`

### FR-TAX-063 Review issues ทั่วไป

- `GET tax/periods/:periodId/review-issues` (`tax.review_issue.read`; query `status`), `PATCH tax/review-issues/:issueId/resolve` (`tax.review_issue.resolve` + บทบาทผู้ตรวจ)

### FR-TAX-064 ปฏิทินภาษีเงินได้นิติบุคคล (CIT)

- `GET tax/cit-calendar` (`tax.period.read`): งวด `taxType = CIT` (สูงสุด 50) + `citLedgerSummary` → `{ formType: 'PND50'|'PND51', periodKey, accountingPeriodId, dueDate, onlineExtensionDueDate: null, status, hasLedgerSummary }` — **แสดงปฏิทินเท่านั้น ไม่มีการคำนวณภาษีหรือจัดทำแบบ ภ.ง.ด.50/51**

### FR-TAX-065 แก้ข้อมูลภาษีรุ่นเก่า (legacy remediation)

- `POST tax/legacy-remediation/preview`, `…/apply` (`tax.config.manage` + `tax.review_issue.resolve`) — ไม่ได้อ่านเนื้อใน (`transaction-tax-config.use-case.ts`)

### FR-TAX-066 ขั้นตอนตั้งค่าบัญชีและภาษี (setup wizard)

- **หน้าจอ** `/settings/accounting-tax-setup` → `/profile` → `/prerequisites` → `/chart` → `/chart/review` → `/mappings` → `/review` (`apps/web/src/features/accounting-tax-setup`); เป็น UI ที่ร้อย API ของ FR-TAX-050, 055–057, 071–072, 076 — ไม่มี endpoint ของตัวเองในโมดูล tax
- **ทดสอบ** `accounting-tax-setup.logic.spec.ts` · **หมายเหตุ** ไม่ได้อ่านโค้ด UI ทุกไฟล์

---

## 7. ส่วน E — Ledger (`double_entry_ledger`)

> **สถานะขอบเขต: ไม่มีแพ็กใดให้ `double_entry_ledger` / `expense_auto_post`** — **แพ็ก: ไม่มี** (System Partner admin เปิดรายร้าน; `expense_auto_post` ต้องเปิดพร้อม `double_entry_ledger` ตาม `FEATURE_DEPENDENCIES`) controller: `apps/api/src/modules/ledger/presentation/http/ledger.controller.ts` (prefix `companies/:companyId`)

### FR-TAX-070 ผังบัญชี (chart of accounts)

- **API** `GET chart-of-accounts`, `GET chart-of-accounts/:accountId` (`ledger.account.read`); `POST chart-of-accounts`, `PATCH chart-of-accounts/:accountId` (`ledger.account.manage`)
- **กฎ** ต้องมีรหัสและชื่อไทย ("รหัสบัญชีและชื่อบัญชีภาษาไทยจำเป็น"); รหัสซ้ำไม่ได้ ("รหัสบัญชี … มีอยู่แล้ว"); บัญชีแม่ต้องอยู่ในร้านเดียวกัน; บัญชีระบบแก้ไม่ได้ ("บัญชีระบบไม่สามารถแก้ไขได้"); แต่ละบัญชีมี `accountClass`, `normalBalance` (`DEBIT`/`CREDIT`), `reportGroup`, `isPosting`, `status`
- **audit** `ledger.account.create`, `ledger.account.update`
- **หน้าจอ** `/settings/chart-of-accounts` (`ChartOfAccountsSettingsPage`) · **ทดสอบ** `account.use-case.spec.ts`, `chart-master.logic.spec.ts`

### FR-TAX-071 Template ผังบัญชี (preview / apply)

- **API** `GET chart-of-accounts/templates`, `GET …/templates/:templateKey/preview` (`ledger.account.read`), `POST …/templates/:templateKey/apply` (`ledger.account.manage`)
- **กฎ** (`application/services/chart-template.service.ts`, `domain/logic/chart-template.logic.ts`) template เดียวคือ `TH_SME_COA_V1`; apply ต้องส่ง checksum ของ preview ที่เห็น; ข้อผิดพลาด `coa_template_not_found`, `coa_template_invalid`, `coa_template_checksum_mismatch`, `coa_preview_changed`, `coa_semantic_conflict` (รหัสเดียวกันแต่ความหมายต่าง), `coa_account_in_use_conflict` (บัญชีที่ชนถูกใช้ลงบัญชีแล้ว), `coa_postcondition_failed`; suggestion ทุกตัวใน mapping manifest ถูกตรึงเป็น `REVIEW_REQUIRED`
- **audit** `ledger.chart_template.preview`, `…apply`, `…apply_failed`, `…unused_conflict_replace`
- **ทดสอบ** `chart-template.service.spec.ts`, `chart-template.logic.spec.ts`, `chart-template-query.service.spec.ts`

### FR-TAX-072 ความพร้อมของผังบัญชี (readiness)

- `GET chart-of-accounts/readiness` (`ledger.account.read`) — `ChartReadinessService`; audit `ledger.readiness.view`

### FR-TAX-073 สมุดรายวัน: ดู / สร้าง manual / ผ่านรายการ / กลับรายการ

- **API** `GET journal-entries`, `GET journal-entries/:journalId` (`ledger.journal.read`); `POST journal-entries/manual` (`journal.entry.create`); `POST journal-entries/:journalId/post` (`journal.entry.post`); `POST journal-entries/:journalId/reverse` (`journal.entry.reverse`)
- **กฎความสมดุล** (`validateJournalBalance`, `domain/logic/journal-balance.logic.ts`) ใช้ `decimal.js`:
  - ต้องมีอย่างน้อย 2 บรรทัด ("รายการสมุดรายวันต้องมีอย่างน้อย 2 บรรทัด")
  - ต่อบรรทัด: จำนวนไม่ติดลบ; ห้ามมีทั้งเดบิตและเครดิตในบรรทัดเดียว; ต้องมีอย่างใดอย่างหนึ่ง
  - **สมดุลเมื่อ `|Σเดบิต − Σเครดิต| < 0.0001` และ `Σเดบิต > 0`** (0.0001 = หนึ่งหน่วยของคอลัมน์ `Decimal(18,4)`)
  - ข้อความเมื่อไม่สมดุล: `ยอดเดบิต (x.xxxx) ไม่เท่ากับยอดเครดิต (y.yyyy)`
- **กฎอื่น** manual journal ใช้ได้เฉพาะบัญชี/สาขาที่อนุญาต (`manual_journal_account_not_available`, `manual_journal_branch_not_available`); งวดปิดแล้ว → `period_closed`; ผ่านรายการได้เฉพาะ `DRAFT` ("Only DRAFT journals can be posted"); `manual_journal_provenance_forbidden`; กลับรายการได้เฉพาะ `POSTED` และยังไม่เคยกลับ (`journal_already_reversed`)
- **การกลับรายการ** (`buildReversalLines`) สลับเดบิต/เครดิตทุกบรรทัด เติมคำอธิบาย `[กลับรายการ] …`; รายการเดิม**คงสถานะ `POSTED`** เพื่อให้รายการเดิม + รายการกลับ หักกันเป็นศูนย์ในรายงาน (รายงานนับเฉพาะ `POSTED`)
- **audit** `ledger.journal.create`, `ledger.journal.post`, `ledger.journal.reverse`
- **หน้าจอ** `/journal` · **ทดสอบ** `journal-balance.logic.spec.ts`, `manual-journal-invariants.use-case.spec.ts`, `journal-reversal-net-zero.use-case.spec.ts`, `ledger.dtos.spec.ts`, `e2e/journal.spec.ts`

### FR-TAX-074 สร้างรายการบัญชีจากเอกสารต้นทาง

- **API** `POST posting/generate` (`journal.entry.create` + `journal.entry.post`) — `GenerateJournalFromSourceUseCase`
- **ต้นทางที่รองรับ** เอกสารขาย (`accounting.invoice.issued`, `…debit_note.issued`, `…billing_note.issued`, `…credit_note.issued`), รับ/จ่ายชำระ (`accounting.payment.received`, `accounting.payment.made`), รายจ่าย (`expense.confirmed`, `expense.posted`, `expense.claim.confirmed`, `expense.payment`), เบิกจ่าย (`reimbursement.payment`), เจ้าหนี้ (`procurement.vendor_bill.approved`, `…pp36_payment`, `procurement.supplier_payment.pp36_payment`), `tax.pp36_input_claim.released`
- **ข้อผิดพลาด** `unsupported_posting_source`, `company_mismatch`, `expense_not_confirmed`, `expense_payment_not_recorded`, `claim_expense_settles_via_reimbursement`, `reimbursement_payment_not_recorded`, `posting_rule_missing`, `posting_unbalanced`, `tax_functional_currency_mismatch`, `functional_currency_fx_required`, `legacy_o0_tax_review_required`, `legacy_tax_snapshot_review_required`
- **audit** `ledger.journal.generate` · **ทดสอบ** `payment-posting-source.use-case.spec.ts`, `expense-payment-posting.use-case.spec.ts`, `claim-payment-posting.pg.spec.ts`, `template-company-posting.use-case.spec.ts`, `journal-vat-invariant.use-case.spec.ts`

### FR-TAX-075 กฎลงบัญชี default (ร้านที่ยังไม่มีผังบัญชีแบบ governed)

- **ไฟล์** `domain/logic/posting-engine.logic.ts`; ทุกยอดปัด `Decimal.toDecimalPlaces(4, ROUND_HALF_UP)`; ให้ `net = totalAmount`, `vat = taxTotal`, `wht = whtTotal`, **`excVat = net − vat`**
- **รหัสบัญชี default** (`DEFAULT_ACCOUNT_CODES`): ลูกหนี้ `1210-00`, เงินสด/ธนาคาร `1110-01`, รายได้ `4100-01`, ภาษีขาย `2210-01`, เจ้าหนี้การค้า `2120-01`, เจ้าหนี้พนักงาน `2130-01`, ค่าใช้จ่ายทั่วไป `5310-01`, ภาษีซื้อ `1280-00`, ภาษีหัก ณ ที่จ่ายค้างจ่าย `2210-02`, ภาษีถูกหัก ณ ที่จ่าย `1270-00`

  | เหตุการณ์ | เดบิต | เครดิต |
  |---|---|---|
  | ออกใบแจ้งหนี้ / ใบเพิ่มหนี้ / ใบวางบิล | ลูกหนี้ `net` | รายได้ `excVat`; ภาษีขาย `vat` (ถ้า > 0) |
  | ใบลดหนี้ | รายได้ `excVat`; ภาษีขาย `vat` | ลูกหนี้ `net` |
  | รับชำระ | เงินสด `net − wht`; ภาษีถูกหัก ณ ที่จ่าย `wht` | ลูกหนี้ `net` |
  | ยืนยันรายจ่าย (`expense.confirmed`/`posted`) | ค่าใช้จ่าย `excVat`; ภาษีซื้อ `vat` | ภาษีหัก ณ ที่จ่ายค้างจ่าย `wht`; เจ้าหนี้การค้า `net − wht` |
  | ยืนยันรายจ่ายจากใบเบิก (`expense.claim.confirmed`) | เหมือนข้างบน | … เจ้าหนี้**พนักงาน** `net − wht` |
  | จ่ายคืนพนักงาน (`reimbursement.payment`) | เจ้าหนี้พนักงาน `net` | เงินสด `net` |
  | อนุมัติใบแจ้งหนี้ผู้ขาย | ค่าใช้จ่าย `excVat`; ภาษีซื้อ `vat` | ภาษีหัก ณ ที่จ่ายค้างจ่าย `wht`; เจ้าหนี้การค้า `net − wht` |
  | จ่ายชำระ (`expense.payment`, `accounting.payment.made`) | เจ้าหนี้การค้า `net` | เงินสด `net − wht`; ภาษีหัก ณ ที่จ่ายค้างจ่าย `wht` |
  | `…pp36_payment`, `tax.pp36_input_claim.released` | (ไม่มีบรรทัดพื้นฐาน — มีเฉพาะบรรทัดภาษีจาก tax snapshot) | |

- **ร้านที่ใช้ template ผังบัญชี** (`requiresReviewedPostingRules` = มี provenance ใด ๆ) ต้องใช้ `PostingRule.mappingJson` (`{ debitAccountCode, creditAccountCode, whtAccountCode?, memo? }`) หรือ expense binding (FR-TAX-076) — ไม่ย้อนไปใช้ default; กฎที่ต้องมีสำหรับ auto-post: `expense.confirmed`, `expense.claim.confirmed` (`REQUIRED_EXPENSE_AUTO_POST_RULES`)
- **บรรทัดภาษี** (`buildTransactionTaxPostingLines`) สร้างจาก tax snapshot ที่ server เก็บไว้เท่านั้น (ไม่รับ account id จากผู้เรียก); ภาษีซื้อถูกแยกออกจากฝั่งเดบิตค่าใช้จ่าย; ภาษีซื้อที่ขอคืนไม่ได้ถูกรวมกลับเข้าต้นทุน
- **ทดสอบ** `transaction-tax-posting.logic.spec.ts`, `wht-payment-posting.logic.spec.ts`, `reimbursement-expense-posting.logic.spec.ts`

### FR-TAX-076 ผูกหมวดค่าใช้จ่ายกับบัญชี (expense account binding)

- **API** `GET posting/expense-account-bindings` (`ledger.posting-rule.read`), `PUT posting/expense-account-bindings/:categoryId` (`ledger.posting-rule.manage`)
- **กฎ** บัญชีต้อง active และลงรายการได้ (`ledger_account_not_postable`); หมวดต้องเป็นของร้าน; การลงบัญชีรายจ่ายแบบ bound (`buildBoundExpenseAccrualLines`) แยกเดบิตตามบัญชีของหมวดแต่ละบรรทัด ยอดเป็น **gross** ทั้งสองฝั่ง (VAT ถูกแยกออกโดยบรรทัดภาษี); **รายจ่ายที่มีหัก ณ ที่จ่ายยังลงแบบ bound ไม่ได้** (บัญชีภาษีหักค้างจ่ายแยกตามแบบ: `2132-03` ภ.ง.ด.3, `2132-04` ภ.ง.ด.53) — ถูกรายงานแทนการเดา
- **หน้าจอ** `/settings/accounting-tax-setup/mappings` · **ทดสอบ** `expense-account-binding.use-case.spec.ts`, `expense-account-binding.logic.spec.ts`

### FR-TAX-077 ลงบัญชีรายจ่ายอัตโนมัติ (`expense_auto_post`)

- **API ภายใน** `POST internal/ledger/expense-auto-post/drain` (`expense-auto-post-internal.controller.ts`) — `DrainExpenseAutoPostUseCase` ดึงรายจ่ายที่ยืนยันแล้วของร้านที่เปิด feature มาสร้างและผ่านรายการ
- **ไม่มีเมนู/หน้าจอ** (เป็นพฤติกรรมเบื้องหลัง) · **ทดสอบ** `expense-auto-post.use-case.spec.ts`, `expense-auto-post-internal.controller.spec.ts`
- **หมายเหตุ** ไม่ได้อ่านเงื่อนไขภายในทุกบรรทัด (348 บรรทัด)

### FR-TAX-078 ลงบัญชีย้อนหลัง (expense backfill)

- **API** `GET posting/expense-backfill-preview`, `POST posting/expense-backfill` (ทั้งคู่ต้อง `expense.read` + `journal.entry.create` + `journal.entry.post`)
- **ข้อผิดพลาด** `expense_auto_post_not_enabled`, `expense_backfill_confirmation_required`; audit `ledger.expense_backfill.run` · **ทดสอบ** `expense-backfill.use-case.spec.ts`

### FR-TAX-079 งวดบัญชี

- **API** `GET periods` (`ledger.period.read`), `POST periods/ensure/:periodKey` (`ledger.period.read`; รูปแบบไม่ถูก → "Invalid monthly period key.")
- `derivePeriodKey` คำนวณ `YYYY-MM` จากวันที่ในเขตเวลาไทยของบริษัท · **ทดสอบ** `posting-date.logic.spec.ts`

### FR-TAX-080 ตรวจก่อนปิดงวด (close checks)

- **API** `POST periods/:periodId/close-checks` (`ledger.period.read`)
- **รายการตรวจ** (`RunPeriodCloseChecksUseCase`, `period.use-case.ts:82-335`)

  | checkKey | ผ่านเมื่อ |
  |---|---|
  | `no_draft_journals` | ไม่มีสมุดรายวันค้างร่างในงวด |
  | `trial_balance_balanced` | Σเดบิต = Σเครดิต ของงวด |
  | `source_postings_complete` | เอกสารต้นทางที่ finalize แล้วทุกใบมีรายการบัญชี |
  | `no_source_posting_errors` | ไม่มีเอกสารที่ลงบัญชีผิดพลาดค้าง |
  | `chart_conflict_remediation_clear` | ไม่มีข้อขัดแย้งของผังบัญชีค้างแก้ |
  | `chart_semantics_valid` | แถวผังบัญชีไม่มีความหมายผิด |
  | `suspense_balance_zero` | บัญชีพัก (`SUSPENSE`) ยอดเป็นศูนย์ |
  | `tax_account_mapping_valid` | การผูกบัญชีภาษีถูกต้อง |
  | `transaction_tax_reconciliation_clear` | ไม่มีบรรทัดกระทบยอดภาษีและ issue ภาษี blocking ค้าง |
  | `reimbursement_postings_complete` | การจ่ายเบิกที่ `PAID` มีรายการบัญชีครบ |

- **ทดสอบ** `period-chart-close.use-case.spec.ts`, `period-reimbursement-close.use-case.spec.ts`, `period-transaction-tax-close.use-case.spec.ts`

### FR-TAX-081 ปิดงวด / เปิดงวดคืน

- **API** `POST periods/:periodId/close` (`ledger.period.close`), `POST periods/:periodId/unclose` (`ledger.period.unclose`)
- **กฎ** ปิดซ้ำ → "งวดบัญชีถูกปิดแล้ว"; รัน close checks ก่อนเสมอ; check ที่ `FAILED` และ `severity = ERROR` → 400 `close_check_failed` พร้อมรายการ; เปิดคืนต้องมีหมายเหตุ ("หมายเหตุการเปิดงวดคืนจำเป็น"), งวดต้อง `CLOSED` ("งวดบัญชียังไม่ถูกปิด"), และ**ห้ามเปิดคืนถ้ามี `TaxPeriod` ของเดือนเดียวกันที่ `FILED`/`PAID`/`CLOSED`** (400 `tax_period_filed`)
- **audit** `ledger.period.close`, `ledger.period.unclose` (CRITICAL); outbox `period.closed`, `period.reopened`
- **หน้าจอ** `/period-closing` (เมนู `closing` สถานะ **`planned`** — ไม่แสดงในเมนูหลัก)

### FR-TAX-082 รายงานบัญชี (GL / งบทดลอง / กำไรขาดทุน / ฐานะการเงิน)

- **API** `GET reports/general-ledger`, `GET reports/trial-balance`, `GET reports/profit-and-loss`, `GET reports/balance-sheet` (`ledger.report.read`; query `periodKey`, GL รับ `accountId`)
- **สูตร** (`application/use-cases/report.use-case.ts`; ใช้ `parseFloat` + `toFixed(4)`; กรองสาขาตาม `ctx.scopes.branchIds`; ไม่พบงวด → ค่าว่าง)
  - **ยอดบัญชี** (`deriveBalance`): บัญชี normal `DEBIT` → `Σเดบิต − Σเครดิต`; `CREDIT` → `Σเครดิต − Σเดบิต`
  - **GL** ต่อบัญชี: `openingBalance = '0.0000'` (ไม่มียอดยกมา), `totalDebit`, `totalCredit`, `endingBalance`, และบรรทัด (`journalEntryId`, `entryNumber`, `entryDate`, `memo`, `debitAmount`, `creditAmount`, `sourceType`, `sourceId`)
  - **งบทดลอง**: ต่อบัญชี `totalDebit`, `totalCredit`, `balance`; รวม `totalDebit`, `totalCredit`, **`difference = |ΣDr − ΣCr|`**; เรียงตามรหัสบัญชี
  - **กำไรขาดทุน**: หมวด `REVENUE`, `COST`, `EXPENSE`, `TAX_EXPENSE`; **`grossProfit = revenue − totalCost`**; **`netProfit = grossProfit − totalExpense − taxExpense`**
  - **ฐานะการเงิน**: หมวด `ASSET`, `LIABILITY`, `EQUITY`; `totalAssets`, `totalLiabilities`, `totalEquity` — **เฉพาะรายการของงวดที่เลือก ไม่ใช่ยอดสะสม** และไม่ตรวจสมการ สินทรัพย์ = หนี้สิน + ทุน
- **หน้าจอ** `LedgerReportsPage` · **ทดสอบ** `ledger.logic.spec.ts`

### FR-TAX-083 ส่งออกรายงานบัญชี

- **API** `POST reports/:reportType/export` (`ledger.export`; ชนิด `general-ledger`/`trial-balance`/`profit-and-loss`/`balance-sheet`)
- **สถานะจริง** **ยังไม่ได้ทำ** — โค้ดบันทึก audit `ledger.report.export` แล้วคืน `{ status: 'export_not_implemented', message: 'การส่งออกไฟล์ XLSX ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }` (`report.use-case.ts:176-189`)

### FR-TAX-084 สมุดรายรับ-รายจ่าย (`/income-expense-ledger`)

- route gate `accounting.document.read` หรือ `expense.read`; API `income-expense-ledger/availability|summary|entries|export` อยู่ในโมดูล `accounting-documents` (ไม่ใช่ ledger) — บันทึกไว้เพื่อการอ้างอิงข้ามเอกสาร; **ไม่ได้ตรวจในเอกสารนี้** (`e2e/income-expense-ledger.spec.ts`)

---

## 8. ส่วน F — Banking (`bank_reconciliation`)

> **สถานะขอบเขต: ไม่มีแพ็กใดให้ `bank_reconciliation`** — **แพ็ก: ไม่มี** controller อยู่ใน `apps/api/src/modules/banking/presentation/http/` (prefix `companies/:companyId/banking`) ตรรกะบริสุทธิ์ที่ `domain/logic/banking.logic.ts` — **เลขเงินทั้งหมดคำนวณเป็นจำนวนเต็มสตางค์ (`bigint`)**: `toCents` ตัดจุลภาค, เติม/ตัดทศนิยมให้เหลือ 2 ตำแหน่ง (**ตัดทิ้ง ไม่ปัด**), `fromCents` คืน string 2 ตำแหน่ง

### FR-TAX-090 บัญชีธนาคารของร้าน

- **API** `GET bank-accounts`, `GET bank-accounts/:id` (`bank.account.read`); `POST bank-accounts`, `PATCH bank-accounts/:id`, `POST bank-accounts/:id/deactivate` (`bank.account.manage`)
- **กฎ** บัญชี ledger ที่ผูกต้องเป็นบัญชีเงินสด/ธนาคารที่ใช้ได้ (`ledger_account_invalid_for_bank`, `domain/logic/bank-ledger-account.logic.ts`); เลขบัญชีแสดงแบบปิดบัง — `maskAccountNumber` แสดงเฉพาะ 4 หลักท้าย, `extractLast4`; เลขเต็มต้องมี `bank.account.sensitive_read`; ขอบเขตสาขาตาม `bank-branch-scope.ts`
- **audit** `bank.account.create/update/deactivate` · **หน้าจอ** `/banking?tab=accounts` · **ทดสอบ** `bank-account.use-case.spec.ts`

### FR-TAX-091 นำเข้า statement: สกัดข้อมูล (extract)

- **API** `POST bank-accounts/:bankAccountId/statement-imports/extract` (`bank.statement.import`)
- **แหล่ง** (`VALID_SOURCE_KINDS`): `csv_xlsx`, `pdf_text` (อ่าน text layer ของ PDF แล้วจัดกลุ่มเป็นตารางแบบ deterministic ด้วย `clusterPdfTextRows` — ไม่ใช้ AI), `ocr` (ส่ง AI อ่าน ผ่าน `statement-ai-extract.client.ts`)
- **ข้อผิดพลาด OCR** `extract_ocr_not_configured`, `extract_ocr_disabled`, `extract_ocr_limit_exceeded`, `extract_ocr_duplicate_request`, `extract_ocr_quota_unavailable`, `extract_ocr_failed`
- **audit** `bank.statement.extract`

### FR-TAX-092 นำเข้า statement: preview และ commit

- **API** `POST …/statement-imports/preview`, `POST …/statement-imports/commit` (`bank.statement.import`); `GET …/statement-imports`, `GET …/statement-lines` (`bank.statement.read`)
- **normalize แถว** (`normalizeStatementRow`) — ชื่อคอลัมน์ที่รับ (ตามลำดับความสำคัญ):

  | ข้อมูล | alias |
  |---|---|
  | วันที่ | `postedDate`, `date`, `Transaction Date`, `วันที่ทำรายการ`, `วันที่` |
  | รายละเอียด | `description`, `Details`, `รายการ`, `รายละเอียด` |
  | ถอน (เดบิต) | `debit`, `Debit`, `ถอน`, `เดบิต` |
  | ฝาก (เครดิต) | `credit`, `Credit`, `ฝาก`, `เครดิต` |
  | จำนวนเงินมีเครื่องหมาย | `amount`, `Amount`, `จำนวนเงิน` |
  | ยอดคงเหลือ | `balance`, `Balance`, `ยอดคงเหลือ` |
  | เลขอ้างอิง | `bankReference`, `Reference`, `อ้างอิง` |

  ถ้ามีคอลัมน์ถอน/ฝาก: **`signedAmount = ฝาก − ถอน`**; มิฉะนั้นใช้จำนวนเงินมีเครื่องหมาย; ทิศทาง `DEPOSIT` (> 0), `WITHDRAWAL` (< 0), `ZERO`; สกุลเงินคงที่ `THB`; ขาดวันที่/จำนวน → `errors[]` ("Missing posted date", "Missing amount")
- **กันซ้ำ** `statementLineHash` = sha256 ของ `companyId|bankAccountId|postedDate|signedAmount(2 ตำแหน่ง)|CURRENCY|bankReference|normalizedDescription|runningBalance`
- **ตรวจความต่อเนื่องยอดคงเหลือ** `checkRunningBalanceContinuity`: ยอดคงเหลือของแถว = ยอดก่อนหน้า + จำนวนของแถว; แถวที่ไม่มียอดคงเหลือเริ่มสายใหม่; คืนเลขแถว (เริ่ม 1) ที่ขาดสาย — สัญญาณว่า OCR อ่านผิด
- **audit** `bank.statement.import.preview`, `bank.statement.import.commit`
- **หน้าจอ** `/banking?tab=import` (`StatementImportPanel`) · **ทดสอบ** `statement-import.use-case.spec.ts`, `banking.logic.spec.ts`, `banking.dtos.spec.ts`

### FR-TAX-093 เพิ่มรายการเดินบัญชีด้วยมือ / ยกเลิกการนำเข้า

- `POST bank-accounts/:id/statement-lines` (`bank.statement.manual_line`; audit `bank.statement.line.create_manual`); `POST statement-imports/:importId/void` (`bank.statement.void`; audit `bank.statement.import.void`)

### FR-TAX-094 แนะนำคู่จับ (match candidates) และคะแนน

- **API** `GET bank-accounts/:id/match-candidates` (`bank.match.read`)
- **สูตรคะแนน 0–100** (`scoreMatchCandidate`)
  - สกุลเงินไม่ตรง → 0; **จำนวนเงิน (ค่าสัมบูรณ์เป็นสตางค์) ไม่เท่ากันพอดี → 0**
  - ฐาน **50**
  - วันที่ห่าง 0 วัน **+30**; ≤ 3 วัน **+20**; ≤ 7 วัน **+10**; > 7 วัน +0
  - เลขอ้างอิงของธนาคาร "มี" เลขอ้างอิงของรายการ (ไม่สนตัวพิมพ์) **+15**
  - รายละเอียด "มี" ชื่อคู่ค้า **+5**
  - `min(100, รวม)`
- **แหล่ง candidate** (`infrastructure/prisma-match-source.query.ts`): รับชำระลูกค้า, จ่ายผู้ขาย, จ่ายรายจ่าย, จ่ายเบิก, รายการปรับปรุง ฯลฯ ตาม `BankMatchSourceType`; ยอดที่จับคู่ยืนยันแล้วถูกหักออก (`applyConfirmedAllocations`) รายการที่ไม่เหลือยอดถูกตัด
- **ทดสอบ** `matching.use-case.spec.ts`, `prisma-match-source.query.spec.ts`

### FR-TAX-095 ยืนยัน / ปฏิเสธ / ยกเลิกการจับคู่ และข้ามรายการ

- **API** `POST statement-lines/:id/matches` (`bank.match.confirm`; การข้ามเกณฑ์ต้อง `bank.match.override`), `POST matches/:matchId/reject` (`bank.match.confirm`), `POST matches/:matchId/void` (`bank.match.unmatch`), `POST statement-lines/:id/ignore` (`bank.match.override`)
- **กฎการจัดสรร** (`validateMatchAllocation`): ห้ามจับคู่รายการทิศทาง `ZERO`; ทิศทางของรายการธนาคารและรายการต้นทางต้องตรงกัน; ยอดจัดสรรต้อง > 0; **`ยอดจัดสรรแล้ว + ยอดใหม่ ≤ |ยอดรายการธนาคาร|`** (มิฉะนั้น "Over-allocation: remaining unmatched amount is …")
- **สถานะรายการ** (`calculateStatementLineMatchStatus`): Σจัดสรร ≤ 0 → `UNMATCHED`; ≥ |ยอด| → `MATCHED`; มิฉะนั้น `PARTIALLY_MATCHED`
- **audit** `bank.match.confirm`, `bank.match.reject`, `bank.match.void`, `bank.statement.line.ignore`
- **หน้าจอ** `/banking?tab=matching` (`MatchingPanel`)

### FR-TAX-096 รอบกระทบยอด (reconciliation session)

- **API** `GET reconciliations`, `GET reconciliations/:sessionId` (`bank.reconciliation.read`); `POST reconciliations` (`bank.reconciliation.create`); `POST reconciliations/:id/complete` (`bank.reconciliation.complete`); `POST reconciliations/:id/reopen` (`bank.reconciliation.reopen`)
- **สูตร**
  - เริ่มรอบ (`calculateInitialReconciliationSession`): `calculatedStatementMovementAmount = closing − opening`; `calculatedBookMovementAmount = 0.00`; `calculatedBookBalanceAmount = opening`; `differenceAmount = closing − opening`
  - ระหว่างรอบ (`calculateReconciliationBalance`): `closingStatementBalance = openingStatement + Σ statementMovements`; `calculatedBookBalance = openingBook + Σ reconciledMovements`; **`difference = closingStatementBalance − calculatedBookBalance`**
- **เงื่อนไขปิดรอบ** (`canCompleteReconciliation`) — ทุกข้อเป็น blocker: มีรายการที่ยังไม่จับคู่และไม่ได้ข้าม; มีรายการที่ข้ามโดยยังไม่ผ่านการตรวจ; **`difference ≠ 0`**; บัญชีธนาคารยังไม่ผูกบัญชี ledger; งวดบัญชีปิดแล้ว
- **audit** `bank.reconciliation.create/complete/reopen` · **หน้าจอ** `/banking?tab=reconciliations` · **ทดสอบ** `reconciliation.use-case.spec.ts`
- **หมายเหตุ** schema มี model `BankReconciliationEvidenceExport` และ permission `bank.reconciliation.export` แต่**ไม่พบ endpoint ส่งออกหลักฐานการกระทบยอดใน controller**

### FR-TAX-097 รายการปรับปรุงธนาคาร (bank adjustment)

- **API** `GET adjustments`, `GET adjustments/:id` (`bank.adjustment.read`); `POST adjustments`, `POST adjustments/:id/submit` (`bank.adjustment.create`); `POST adjustments/:id/approve` (`bank.adjustment.approve`); `POST adjustments/:id/void` (`bank.adjustment.void`)
- **สถานะ** `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `POSTED` / `POSTING_ERROR`; `VOIDED`; หมวดตาม `BankAdjustmentCategory`
- **การลงบัญชี** (`buildAdjustmentPostingInput`): ต้องมีทั้ง `ledgerDebitAccountId` และ `ledgerCreditAccountId`; สร้าง 2 บรรทัดด้วย **`|signedAmount|`** (เดบิตบัญชีหนึ่ง เครดิตอีกบัญชี) คำอธิบายเดียวกัน
- **audit** `bank.adjustment.create/submit/approve/void` · **หน้าจอ** `/banking?tab=adjustments`

### FR-TAX-098 สถานะเงินสด (cash position)

- **API** `GET cash-position` (`bank.cash.read`) — ต่อบัญชี: วันที่/ยอดที่กระทบยอดล่าสุด, จำนวนรายการที่ยังไม่กระทบยอด/ไม่จับคู่, รายการปรับปรุงที่รอ, วันที่ statement ล่าสุด (เป็นแหล่งของรายงาน `bank.cash_position`, FR-TAX-113)
- **หน้าจอ** `/banking?tab=cash`

### FR-TAX-099 ทดสอบ end-to-end ของ Banking

- `e2e/banking.spec.ts`, `apps/web/src/features/banking/banking.logic.spec.ts`

---

## 9. ส่วน G — Reports

> **สถานะขอบเขต: ไม่มีแพ็กใดให้ feature `reports`** — **แพ็ก: ไม่มี** ทุกคำขอใหม่ผ่าน `ReportEntitlementService.assertEnabled` (`apps/api/src/modules/reports/application/report-entitlement.service.ts`); หลังปิด feature ผู้ถือ `report.snapshot.read` ยังเปิดหน้าประวัติอย่างเดียวได้ (`retainedGatePermissions`) controller: `reports/presentation/http/report.controller.ts` (prefix `companies/:companyId/reports`) หน้าจอ `/reports` (`ReportsWorkspacePage`)

### FR-TAX-110 แคตตาล็อกรายงาน

- **API** `GET reports/catalog` (`report.catalog.read`)
- สถานะต่อชุดข้อมูล (`visibleDatasetStatus`, `domain/report-permission.logic.ts`): ต้องมี report permission ทั้งหมด (ยกเว้น `report.query.run`) และ source permission ตามโหมด `all`/`any` มิฉะนั้น `FORBIDDEN`
- **ชุดข้อมูลทั้งหมด 18 ชุด** (`domain/report-catalog.ts`) — ทุกชุดต้องมี `report.catalog.read` + `report.dataset.read` + `report.query.run`

  | code | ชื่อ | source permission (โหมด) | ตัวกรอง | chart | SLA ความสด (วินาที) |
  |---|---|---|---|---|---|
  | `financial.general_ledger` | บัญชีแยกประเภท | `ledger.report.read` (all) | `periodKey` | table | 300 |
  | `financial.trial_balance` | งบทดลอง | `ledger.report.read` | `periodKey` | table, bar | 300 |
  | `financial.profit_and_loss` | งบกำไรขาดทุน | `ledger.report.read` | `periodKey` | table, bar | 300 |
  | `financial.balance_sheet` | งบแสดงฐานะการเงิน | `ledger.report.read` | `periodKey` | table, bar | 300 |
  | `ar.aging` | อายุหนี้ลูกหนี้การค้า | `accounting.document.read` (any) | `asOfDate` | table, aging_bucket | 300 |
  | `ap.aging` | อายุหนี้เจ้าหนี้การค้า | `procurement.ap.report` | `asOfDate` | table, aging_bucket | 300 |
  | `sales.summary` | สรุปยอดขาย | `accounting.document.read`, `crm.report.read` (any) | `fromDate`, `toDate` | table, kpi, bar | 300 |
  | `sales.pipeline` | โอกาสการขาย | `crm.report.read` | `scope` (`own`/`all`) | table, kpi, bar | 300 |
  | `inventory.stock_balance` | ยอดคงเหลือสินค้า | `inventory.report.read` | `productId`, `locationId` | table, bar | 120 |
  | `inventory.stock_movement` | ความเคลื่อนไหวสินค้า | `inventory.movement.read` | `fromDate`, `toDate` | table, bar | 120 |
  | `inventory.reorder` | สินค้าใกล้ถึงจุดสั่งซื้อและเสี่ยงขาด | `inventory.report.read` | — | table, bar | 120 |
  | `expense.summary` | สรุปค่าใช้จ่าย | `expense.read`, `expense.review`, `expense.read_own` (any; เรียงกว้าง→แคบ) | `fromDate`, `toDate` | table, kpi, bar | 300 |
  | `expense.accountant_evidence` | หลักฐานค่าใช้จ่ายสำหรับสำนักงานบัญชี | `expense.export` | `fromDate`, `toDate` | table | 300 |
  | `tax.summary` | สรุปภาษี | `tax.report.read` | `periodKey` | table, kpi, bar | 600 |
  | `bank.cash_position` | สถานะเงินสด | `bank.cash.read` | — | table, bar | 300 |
  | `ops.workflow_sla` | ภาพรวมระบบอัตโนมัติ | `workflow.run.read`, `workflow.task.read` (any) | `fromDate`, `toDate` | table, kpi, bar | 300 |
  | `ops.dashboard_health` | ภาพรวมการทำงาน | `dashboard.read` | — | table, kpi, bar | 300 |
  | `ai.suggestion_summary` | สรุปคำแนะนำจาก AI | `ai.suggestion.read`, `ai.suggestion.read_own` (any) | — | table, kpi, bar | 300 |

### FR-TAX-111 รันรายงาน (query)

- **API** `POST reports/query` (`report.catalog.read` + `report.dataset.read` + `report.query.run`) body `ReportQueryInput { datasetCode, filters, dimensions, measures, sort, chartKind, page, pageSize }`; ผลผ่าน `reportResultForPeople` (แปลงค่ารหัสเป็นคำไทยสำหรับคนอ่าน; เครื่องมือ AI เรียก use case ตรงและได้ค่าดิบ)
- **การตรวจ** (`validateReportQuery`, `domain/report-query-validator.logic.ts`)
  - ค่าเริ่มต้น: รายงานที่รับ `periodKey` และไม่ส่งตัวกรองวันที่ → เดือนปัจจุบัน (เขตเวลาบริษัท); รายงานที่รับ `fromDate` → วันที่ 1 ของเดือนถึงวันนี้
  - ตัวกรองที่ไม่รู้จัก → 400 `invalid_filter`; `fromDate`/`toDate`/`asOfDate` ต้องเป็น `YYYY-MM-DD`; `periodKey` ต้องเป็น `YYYY-MM`; `fromDate` และ `toDate` ต้องมาคู่กันและ `from ≤ to`; ห้ามใช้ `periodKey` ร่วมกับช่วงวันที่
  - `invalid_dimension`, `invalid_measure`, `invalid_sort` (ทิศ `asc`/`desc`), `invalid_page`, `invalid_page_size` (**1–100**, `REPORT_MAX_PAGE_SIZE`), `invalid_chart_kind`
- **ผล** บันทึก `ReportRun` (พร้อม `sourceFreshness`), audit `report.query.run`; `GET reports/runs`, `GET reports/runs/:runId` (`report.snapshot.read`) อ่านประวัติ — ผู้ใช้เห็นเฉพาะ run ของตนเอง เว้นแต่ถือ `report.audit.read` (`report.use-cases.ts:364, 414`); การจัดการ saved view ของผู้อื่นต้องมี `report.view.manage` (`:546, 591`)

### FR-TAX-112 คอลัมน์และการคำนวณของรายงานการเงิน/บัญชี

(`application/report-source-adapters.ts`)

| รายงาน | คอลัมน์ (label → key, ชนิด) | การคำนวณ |
|---|---|---|
| `financial.general_ledger` | รหัสบัญชี `accountCode`; บัญชี `accountName`; เดบิต `totalDebit` (money); เครดิต `totalCredit`; ยอดสุทธิในงวด `endingBalance` | ตาม FR-TAX-082; **ไม่รวมยอดยกมา** |
| `financial.trial_balance` | รหัสบัญชี; บัญชี; ประเภทบัญชี `accountClass`; เดบิต; เครดิต; ยอดสุทธิในงวด `balance` | FR-TAX-082 |
| `financial.profit_and_loss` | หมวด `section`; ยอดรวม `total` | FR-TAX-082 |
| `financial.balance_sheet` | หมวด `section`; ยอดรวม `total` | FR-TAX-082 (เฉพาะงวด ไม่ใช่ยอดสะสม) |
| `ar.aging` | เลขที่เอกสาร `documentNumber`; ลูกค้า `counterpartyName`; วันที่เอกสาร `documentDate`; วันครบกำหนด `dueDate`; ยอดค้างชำระ `outstandingAmount`; สกุลเงิน `currency`; สถานะการชำระ `paymentStatus` | ใบแจ้งหนี้ที่ยังชำระไม่ครบ ณ `asOfDate` |
| `ap.aging` | ผู้ขาย `supplierDisplayName`; ยอดค้างชำระ `totalOutstanding`; ยังไม่ถึงกำหนด `notDue`; ค้างไม่เกิน 30 วัน `days0To30`; ค้าง 31 ถึง 60 วัน `days31To60`; ค้าง 61 ถึง 90 วัน `days61To90`; ค้างเกิน 90 วัน `days91Plus` | 5 bucket จาก use case AP aging ของ procurement |

- **การกระทบกับบัญชีคุม** (`ledgerControlReconciliation`, ใช้กับ AR/AP aging): ถ้าผู้ใช้ไม่มี `ledger.report.read` → warning `ledger_control_permission_missing`; ถ้า `|ยอดรวมต้นทาง| < 0.005` ข้าม; ดึงงบทดลองของเดือน `asOfDate`, รวม `balance` ของบัญชีที่ `reportGroup` = `accounts_receivable` / `accounts_payable`; **`ledgerControlDifference = ยอดรวมต้นทาง − ledgerControlAmount`**; `|difference| ≥ 0.005` → warning `ledger_control_mismatch`; ไม่พบบัญชี → `ledger_control_account_not_found_or_unposted`; ผล totals: `ledgerControlAmount`, `ledgerControlDifference`, `ledgerControlPeriodKey`, `ledgerControlAccountCodes`

### FR-TAX-113 คอลัมน์ของรายงานรายจ่าย / ภาษี / ธนาคาร

| รายงาน | คอลัมน์ |
|---|---|
| `expense.summary` | สถานะ `status`; สกุลเงิน `currency`; จำนวนรายการ `count`; ยอดรวม `grandTotalAmount`; ชำระแล้ว `paidAmount`; ยอดค้างชำระ `outstandingAmount` |
| `expense.accountant_evidence` | เลขที่ค่าใช้จ่าย `expenseNumber`; วันและเวลาที่อัปโหลด `uploadedAt` (datetime); วันที่เอกสาร `expenseDate`; ผู้ขาย `vendorName`; ประเภทเอกสารต้นทาง `sourceDocumentType`; หลักฐานรายจ่าย `taxEvidenceStatus`; สถานะ `expenseStatus`; สิทธิภาษีซื้อ `inputVatClaimStatus`; เหตุผลสิทธิภาษีซื้อ `inputVatReason`; ผู้ตรวจสิทธิภาษีซื้อ `inputVatDecidedBy`; หมวดค่าใช้จ่าย `category`; สกุลเงิน; ยอดรวม `grandTotalAmount`; ภาษีมูลค่าเพิ่ม `vatAmount`; ภาษีหัก ณ ที่จ่าย `whtAmount` |
| `tax.summary` | ประเภทภาษี `taxType`; แบบภาษี `formType`; งวด `periodKey`; สถานะ `status`; วันครบกำหนด `dueDate`; จำนวนรายการ `activeEventCount`; จำนวนรายการที่ต้องตรวจ `reviewIssueCount`; จำนวนรายการที่ยังเปิดอยู่ `openIssueCount`; ฐานภาษี `taxableBase`; ยอดภาษี `amount` |
| `bank.cash_position` | บัญชีธนาคาร `bankAccountDisplayName`; สกุลเงิน; วันที่กระทบยอดล่าสุด `lastReconciledDate`; ยอดเงินล่าสุด `lastReconciledBalance`; รายการที่ยังไม่กระทบยอด `unreconciledLineCount`; รายการที่ยังไม่จับคู่ `unmatchedLineCount`; รายการปรับปรุงที่รอดำเนินการ `pendingAdjustmentCount`; วันที่รายการเดินบัญชีล่าสุด `lastStatementDate` |

### FR-TAX-114 คอลัมน์ของรายงานขาย / สินค้า / งานระบบ / AI

| รายงาน | คอลัมน์ |
|---|---|
| `sales.summary` | ช่องทาง `source`; สกุลเงิน `currency`; จำนวนรายการ `count`; ยอดเงิน `amount` |
| `sales.pipeline` | รายการ `metric`; จำนวน `value` |
| `inventory.stock_balance` | สินค้า `productName`; ที่เก็บสินค้า `locationName`; จำนวน `quantity`; สินค้าใกล้ถึงจุดสั่งซื้อ `isLowStock` (boolean) |
| `inventory.stock_movement` | เลขที่เคลื่อนไหว `movementNumber`; สินค้า; ที่เก็บสินค้า; ประเภทความเคลื่อนไหว `movementType`; ทิศทาง `direction`; จำนวน `quantity`; วันและเวลาที่เกิดรายการ `occurredAt` (datetime) |
| `inventory.reorder` | สินค้า; ที่เก็บสินค้า; จำนวน |
| `ops.workflow_sla` | รายการ `metric`; จำนวน `value`; ระดับความสำคัญ `severity` |
| `ops.dashboard_health` | รายการ; จำนวน (string); ระดับความสำคัญ; ความใหม่ของข้อมูล `freshnessStatus` |
| `ai.suggestion_summary` | รายการ; จำนวน; ระดับความสำคัญ |

(รายงานกลุ่มนี้อ่านจากโมดูลอื่น — sales_documents/inventory/crm/workflow — ซึ่งบางส่วนอยู่นอกแพ็กเช่นกัน; รายละเอียดการคำนวณต้นทางอยู่ในเอกสารของโมดูลนั้น)

### FR-TAX-115 มุมมองที่บันทึกไว้ (saved views)

- **API** `GET reports/views` (`report.view.read`), `POST reports/views` (`report.view.create`), `PATCH reports/views/:viewId`, `POST reports/views/:viewId/archive` (`report.view.update_own`)
- **กฎ** visibility ที่ไม่ใช่ `PRIVATE` ต้องมี `report.view.share`; audit `report.view.create/update/archive`

### FR-TAX-116 ส่งออกรายงานเป็น CSV

- **API** `POST reports/exports` (`report.export`), `GET reports/exports`, `GET reports/exports/:exportId/download` (anyOf `report.export.read_own`, `report.export.manage`)
- **กฎ** รองรับ **เฉพาะ `CSV`** (รูปแบบอื่น → `export_format_unavailable`; enum มี `XLSX` แต่ไม่ได้ทำ); สูงสุด **5,000 แถว** (`REPORT_SYNC_EXPORT_MAX_ROWS`) เกิน → `export_too_large` ("รายงานมีมากกว่า 5,000 แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่"); ผลไม่ครบ → `export_result_incomplete`; ไฟล์หมดอายุใน **7 วัน** (`report_export_expired`); ตรวจ checksum และความเป็นเจ้าของ storage ตอนดาวน์โหลด (`report_export_integrity_failed`, `report_export_unavailable`, `report_export_not_ready`, `legacy_export_not_materialized`); ถ้า entitlement เปลี่ยนระหว่างทำ → `report_entitlement_changed` / `report_artifact_authority_changed`
- **โครง CSV** (`buildReportCsv`, `domain/report-csv.logic.ts`): ขึ้นต้นด้วย BOM `﻿`; แถวหัว = `label` ของคอลัมน์ (ภาษาไทย); คั่น `,`; ขึ้นบรรทัด `\n`; ทุกเซลล์ผ่าน `safeCsvCell` (กัน CSV injection); คอลัมน์ `date` → `YYYY-MM-DD` ตามวันของบริษัท; `datetime` → `YYYY-MM-DD HH:mm` (เขตเวลา `DEFAULT_COMPANY_TIME_ZONE`, 24 ชั่วโมง)
- **ชื่อไฟล์** (`reportCsvFileName`) `<ชื่อรายงานภาษาไทย>-<YYYY-MM-DD>[-ข้อมูลบางส่วน].csv` (อักขระนอก ไทย/`A-Za-z0-9_-` → `-`; ว่าง → `รายงาน`)
- **audit** `report.export.request`, `report.export.download` (MEDIUM) · **ทดสอบ** `report-csv.logic.spec.ts`, `report.use-cases.spec.ts`

### FR-TAX-117 เจาะดูต้นทาง (drilldown)

- **API** `POST reports/drilldown` (สิทธิ์เดียวกับ query) — คืนลิงก์ไปหน้าต้นทางหลังตรวจ permission ของต้นทาง; ทุกครั้งบันทึก `ReportDrilldownAccessLog` (ผล `ReportDrilldownAccessResult`)

### FR-TAX-118 รั้วสิทธิ์ตาม entitlement และการแข่งขัน

- `withEnabledFence` ล็อก entitlement ของร้านแบบ shared ใน transaction และเทียบ stamp (`present`, `epoch`, `lastSeq`) — งานที่เริ่มก่อนการปิด feature จะเขียนผลไม่ได้ (409 `report_entitlement_changed`)
- **ทดสอบ** `report-entitlement.race.spec.ts`, `report-source-adapters.spec.ts`, `report-permission.logic.spec.ts`, `report-query-validator.logic.spec.ts`, `e2e/reports.spec.ts`, `e2e/reports-bi-smoke.spec.ts`, `reports-ui.logic.spec.ts`

---

## 10. สรุปสูตรคำนวณและการปัดเศษ

| # | การคำนวณ | สูตร | การปัดเศษ / ชนิดเลข | ไฟล์ |
|---|---|---|---|---|
| 1 | ส่วนแบ่งฐานเงินได้/ภาษีต่อการจ่าย | สะสม: `round2(total × paid_k / net) − Σ ก่อนหน้า`; การจ่ายที่ปิดยอดรับเศษที่เหลือ | `Prisma.Decimal`, 2 ตำแหน่ง `ROUND_HALF_UP`, clamp `[0, total]` | `tax/domain/logic/expense-payment-withholding.logic.ts` |
| 2 | ฐานเงินได้ย้อนจากภาษี | `round(withheld / (rate/100) × 100) / 100` | JS number, แสดง 4 ตำแหน่ง | `tax/domain/logic/wht-report.logic.ts` |
| 3 | ตรวจยอดภาษีกับอัตรา | `|round(income × rate) / 100 − withheld| ≤ 0.02` | JS number | `tax/application/services/withholding-filing-validation.ts` |
| 4 | รวมยอดแบบ ภ.ง.ด. (หน้ารายเดือน) | `Σ paid`, `Σ withheld` | `Prisma.Decimal`, `toFixed(4)` | `tax/application/use-cases/generate-wht-report.use-case.ts` |
| 5 | รวมยอดบน PDF ภ.ง.ด. | `Σ line.income`, `Σ line.withheld`; เงินเพิ่ม = 0; รวมทั้งสิ้น = รวมภาษี (แบบปกติ) | JS number, `toFixed(2)` แยกบาท/สตางค์ | `tax/domain/logic/pnd53-official-form.logic.ts`, `pnd3-official-form.logic.ts` |
| 6 | จำนวนแผ่นใบแนบ | `ceil(กลุ่มผู้รับ / 6)`; กลุ่ม ≤ 3 การจ่าย | จำนวนเต็ม | `pnd53-official-form.logic.ts` |
| 7 | แถวรวม XLSX ผู้ทำบัญชี / e-WHT | `Σ` ต่อสกุลเงิน | `Prisma.Decimal`, `toFixed(2)` | `withholding-accountant-export.ts`, `generate-wht-report.use-case.ts` |
| 8 | กลุ่มผู้รับในรายงาน WHT | key `ชื่อ|เลขภาษี|ประเภทเงินได้|อัตรา`; `Σ gross/withheld/netPaid` | `parseFloat`, `toFixed(4)` | `wht-report.logic.ts` |
| 9 | ยอดภาษีเป็นตัวอักษรบน 50 ทวิ | `thaiBahtText(withheldAmount)` — ปัดสตางค์จากทศนิยมตำแหน่งที่ 3 (`(หลักพัน + 5) / 10`) | `BigInt` | `expenses/domain/logic/substitute-receipt.logic.ts` |
| 10 | วันครบกำหนดแบบ | วันที่ 7 ของเดือนถัดไป (หรือ `TaxPeriod.dueDate`); เลยกำหนดเมื่อ > `T16:59:59.999Z` ของวันนั้น | UTC | `tax-period.logic.ts`, `withholding-filing-validation.ts` |
| 11 | VAT สุทธิ | `outputVat − inputVat` | `parseFloat`, `toFixed(4)` | `tax/domain/logic/vat-report.logic.ts` |
| 12 | กล่อง ภ.พ.30 | `box4 = box1 − box2 − box3`; `box8 = max(box5 − box7, 0)`; `box9 = max(box7 − box5, 0)` | `decimal.js`, policy default `HALF_UP` 2 ตำแหน่ง | `tax/domain/logic/transaction-tax.logic.ts` |
| 13 | ภาษีรายบรรทัด | รวมภาษี: `base = gross × 100 / (rate + 100)`, `tax = gross − base`; แยกภาษี: `tax = net × rate / 100` | policy: mode `HALF_UP`/`HALF_EVEN`/`DOWN`/`UP`, scale 2, tolerance 0.01 | `transaction-tax.logic.ts` |
| 14 | กระทบยอดภาษี | `sourceTax − eventTax`, `eventTax − journalTax`, `eventTax − report`; tolerance 0.01 | `decimal.js`, 4 ตำแหน่ง `ROUND_HALF_UP` | `tax/domain/logic/tax-reconciliation.logic.ts` |
| 15 | ความสมดุลสมุดรายวัน | `|ΣDr − ΣCr| < 0.0001` และ `ΣDr > 0` | `decimal.js`, `toFixed(4)` | `ledger/domain/logic/journal-balance.logic.ts` |
| 16 | บรรทัดลงบัญชี default | `excVat = net − vat`; เจ้าหนี้ = `net − wht`; เงินสด = `net − wht` | `decimal.js`, 4 ตำแหน่ง `ROUND_HALF_UP` | `ledger/domain/logic/posting-engine.logic.ts` |
| 17 | ยอดบัญชี / งบ | DEBIT-normal: `Dr − Cr`; CREDIT-normal: `Cr − Dr`; `grossProfit = revenue − cost`; `netProfit = gross − expense − taxExpense`; `difference = |ΣDr − ΣCr|` | `parseFloat` (JS number), `toFixed(4)` | `ledger/application/use-cases/report.use-case.ts` |
| 18 | เงินใน banking | จำนวนเต็มสตางค์; แปลงจาก string โดย**ตัด**ทศนิยมเกิน 2 ตำแหน่ง | `bigint` | `banking/domain/logic/banking.logic.ts` |
| 19 | คะแนนจับคู่ธนาคาร | 50 + วันที่ (30/20/10/0) + อ้างอิง 15 + ชื่อ 5, สูงสุด 100; ยอดไม่เท่ากันพอดี = 0 | จำนวนเต็ม | `banking.logic.ts` |
| 20 | ผลต่างกระทบยอดธนาคาร | `(openingStmt + Σ stmt) − (openingBook + Σ reconciled)`; ต้อง = 0 จึงปิดรอบได้ | `bigint` สตางค์ | `banking.logic.ts` |
| 21 | กระทบ aging กับบัญชีคุม | `sourceTotal − Σ balance(reportGroup)`; เตือนเมื่อ `≥ 0.005` | `decimal.js` | `reports/application/report-source-adapters.ts` |
| 22 | สมุดรายวันซื้อ: กระทบยอดหัวเอกสาร | เศษ `header − Σ กลุ่ม` ≤ 0.05 ลงกลุ่มใหญ่สุด; `grand_total = taxable + vat`; `net_payable = grand_total − wht` | `decimal.js`, `toFixed(2)`; tolerance `EXPENSE_TOTALS_TOLERANCE = 0.05` | `expenses/domain/logic/accounting-software-export.logic.ts`, `expense-totals.logic.ts:146` |
| 23 | รวมรายงานภาษีซื้อ | `Σ base`, `Σ vat` ต่อบล็อกเดือน×สาขา | `decimal.js`, 2 ตำแหน่ง `ROUND_HALF_UP` | `expenses/domain/logic/expense-export.logic.ts` |
| 24 | วันที่ Excel | `Date.parse('YYYY-MM-DDT00:00:00Z') / 86,400,000 + 25,569` | serial number | `accounting-software-export.logic.ts` |

---

## 11. สรุปโครงไฟล์ส่งออก

| ไฟล์ | ชื่อไฟล์ | รูปแบบ | โครง | FR |
|---|---|---|---|---|
| หนังสือรับรอง 50 ทวิ | `หนังสือรับรอง-50-ทวิ-<WHT-YYYY-NNNNN>.pdf` | PDF 2 หน้า (สองฉบับ) บน `rd-wht50bis.pdf` | ตารางช่องใน FR-TAX-009 | 005–009 |
| ภ.ง.ด.3 + ใบแนบ | `ภ.ง.ด.3-<YYYY-MM>-<สาขา 5 หลัก>[-เพิ่มเติมครั้งที่-N].pdf` | PDF: แบบหลัก 1 หน้า + ใบแนบ `ceil(n/6)` หน้า บน `rd-pnd3-main.pdf` / `rd-pnd3-attachment.pdf` | FR-TAX-019 | 019 |
| ภ.ง.ด.53 + ใบแนบ | `ภ.ง.ด.53-<YYYY-MM>-<สาขา>[-เพิ่มเติมครั้งที่-N].pdf` | PDF บน `rd-pnd53-main.pdf` / `rd-pnd53-attachment.pdf` | FR-TAX-019 | 019 |
| รายการให้ผู้ทำบัญชี (ภ.ง.ด.) | `รายการให้ผู้ทำบัญชี-<PND3|PND53>-<YYYY-MM>-<สาขา>[-เพิ่มเติมครั้งที่-N].xlsx` | XLSX: แผ่น `ภ.ง.ด.3`/`ภ.ง.ด.53` (+ `ภ.ง.ด.2`) | 11 คอลัมน์ + แถวรวมต่อสกุล | 020 |
| รายการ e-WHT | `จ่ายผ่าน e-WHT-<YYYY-MM>.xlsx` | XLSX แผ่นเดียว | 10 คอลัมน์ + แถวรวมต่อสกุล | 025 |
| แบบที่ restore (งวดเก่า) | `[รายการให้ผู้ทำบัญชี-]ภ.ง.ด.3|53-<YYYY-MM>-<สาขา>[…].pdf|xlsx` | PDF หรือ XLSX (10 คอลัมน์ ไม่มีสกุลเงิน) | จากแถวแช่แข็ง | 023 |
| ไฟล์สรุปรายจ่าย / สารบัญ | `รายจ่าย-<ร้าน>-<ช่วง>.xlsx` (ใน ZIP: `สารบัญ.xlsx`) | XLSX สูงสุด 8 แผ่น | FR-TAX-031 | 031 |
| ชุดหลักฐาน | `หลักฐาน-<ร้าน>-<ช่วง>[-ชุดที่-n].zip` | ZIP ไม่บีบอัด; ≤ 60 ไฟล์ และ ≤ 60 MB ต่อชุด | โฟลเดอร์ตาม FR-TAX-033 + `สารบัญ.xlsx` + `ไฟล์ที่ไม่ได้รวม.txt` | 032–033 |
| เอกสารรายการ | `ชุดเอกสารรายการ/<เลขที่>.pdf` | PDF: ปก → หลักฐานการจ่าย → เอกสารประกอบ → 50 ทวิ → เอกสารค่าใช้จ่าย → ใบรับรองแทน → ใบเบิก | FR-TAX-033 | 033 |
| สมุดรายวันซื้อ | `สมุดรายวันซื้อ-<ร้าน>-<ช่วง>.xlsx` | XLSX 2 แผ่น | 25 คอลัมน์ + แผ่นเกี่ยวกับไฟล์ | 036 |
| ชุดไฟล์ตรวจภาษี (generic) | `tax-<formType>-<periodKey>.json|csv|xlsx|pdf` | 4 รูปแบบ | 11 field | 060 |
| รายงาน BI | `<ชื่อรายงาน>-<YYYY-MM-DD>[-ข้อมูลบางส่วน].csv` | CSV UTF-8 + BOM | หัวเป็น label ไทย ตามคอลัมน์ใน FR-TAX-112–114 | 116 |
| รายงานบัญชี (ledger export) | — | **ยังไม่ได้ทำ** (`export_not_implemented`) | — | 083 |

ทุก artifact ของโมดูล tax คืนเป็น `{ fileName, mimeType, contentBase64, checksum (sha256 hex), byteLength }` ใน JSON; ชุด ZIP ของผู้ทำบัญชีคืนเป็น stream; XLSX ทุกไฟล์สร้างด้วย `apps/api/src/common/export/xlsx.logic.ts` (`buildWorkbook` / `buildXlsx`), วันที่ใน XLSX ใช้ `formatThaiExportDate` (`common/export/thai-date.logic.ts`)

---

## 12. ถ้อยคำ

โค้ดแยกถ้อยคำสองระดับอย่างตั้งใจ (สอดคล้องกับเป้าหมายผลิตภัณฑ์ "ภาษาง่ายสำหรับคนที่ไม่ใช่นักบัญชี ศัพท์บัญชีเฉพาะในเอกสารของผู้ทำบัญชี/กรมสรรพากร"):

| ที่ปรากฏ | ลักษณะถ้อยคำ | หลักฐานในโค้ด |
|---|---|---|
| ข้อความปฏิเสธ/คำแนะนำในหน้าภาษีหัก ณ ที่จ่าย (ร้าน) | ภาษาง่าย บอกสิ่งที่ต้องทำต่อ: "ยังไม่รู้ว่า … เป็นบริษัทหรือบุคคล เปิดคู่ค้าแล้วเลือกประเภทก่อน", "ยังไม่มีเลขผู้เสียภาษีของ … เปิดรายจ่ายหรือคู่ค้าแล้วกรอกเลขผู้เสียภาษี 13 หลัก", "มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี", "ดาวน์โหลดแบบใหม่ก่อนยื่น" — ใช้คำว่า **บริษัท/บุคคล** แทน นิติบุคคล/บุคคลธรรมดา, **ยอดจ่าย/ภาษีที่หักไว้** แทน เงินได้พึงประเมิน | `PND3_FILING_REVIEW_MESSAGES`, `makeReviewIssue`, `withholdingIssueDescription` (`tax/domain/logic/tax-period.logic.ts:107-172`) |
| e-WHT (ร้าน) | ตารางคำกลาง `E_WHT_WORDS` รหัส `S-*` (ตั้งค่า), `W-F*` (ฟอร์ม), `W-D*`/`W-V*` (รายละเอียด), `W-P*` (การจ่าย), `W-T*` (หน้าภาษี), `W-X*` (ไฟล์ส่งออก), `W-R*` (ข้อความปฏิเสธ): เช่น "ร้านยื่นแบบเอง", "ธนาคารนำส่ง (e-WHT)", "ธนาคารนำส่งภาษีให้ ไม่ต้องยื่นแบบและไม่ต้องออก 50 ทวิสำหรับรายการนี้" | `packages/contracts/src/tax.ts:81-125` |
| เรื่องที่ระบบทำให้ไม่ได้ | ชี้ไปที่ผู้ทำบัญชีเสมอ: "ให้ผู้ทำบัญชีจัดทำแบบให้", "ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร", "ผู้ทำบัญชีจัดทำแบบนี้เอง ดาวน์โหลดรายการให้ผู้ทำบัญชีแทน" | `tax.controller.ts`, `generate-tax-filing-package.use-case.ts`, `whtFilingRouteHint` |
| เมนู/การ์ดแพ็ก | "ภาษีหัก ณ ที่จ่าย", "ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ", "ออกหนังสือรับรอง 50 ทวิในระบบ", "จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ" | `menu-entitlements.ts`, `capability-pack.registry.ts` |
| แบบ ภ.ง.ด.3/53 และ 50 ทวิ (กรมสรรพากร) | ใช้ถ้อยคำบนแบบพิมพ์ของกรมสรรพากรทั้งหมด — ระบบวางเฉพาะ "ค่า" ทับช่อง ไม่พิมพ์ label เอง | `assets/rd-*.pdf`, `*-official-form.logic.ts`, `wht-certificate-pdf.logic.ts` |
| แผ่น `รายงานภาษีซื้อ` (ผู้ทำบัญชี/กรมสรรพากร) | ศัพท์ทางการตามรายงานภาษีซื้อ: "ชื่อผู้ขายสินค้า/ผู้ให้บริการ", "เลขประจำตัวผู้เสียภาษีอากรของผู้ขายสินค้า/ผู้ให้บริการ", "สถานประกอบการ", "มูลค่าสินค้าหรือบริการ", "จำนวนเงินภาษีมูลค่าเพิ่ม" | `expense-export.logic.ts:548-549, 596-598` |
| แผ่นอื่นของไฟล์ผู้ทำบัญชี / สมุดรายวันซื้อ | ศัพท์บัญชีระดับกลาง: "มูลค่าก่อน VAT", "สิทธิภาษีซื้อ", "ฐานหัก ณ ที่จ่าย", "รหัสบัญชี", "แบบ ภ.ง.ด.", "ประเภทเงินได้" — ค่าที่ไม่มีใช้ "ยังไม่ระบุ" ไม่ใช่รหัสภายใน | `packages/contracts/src/expenses.ts:2077-2282` |
| รายงาน BI (หน้า `/reports`) | หัวคอลัมน์ไทย; ค่ารหัสถูกแปลงเป็นคำไทยด้วย `reportResultForPeople` (`reports/domain/report-row-text.logic.ts`) ส่วนเครื่องมือ AI ได้ค่ารหัสดิบ; ชื่อหมวดบัญชีมาจาก `LEDGER_ACCOUNT_CLASS_LABELS` | `report.controller.ts:52-55`, `report-catalog.ts` |
| ข้อความที่ยัง**เป็นอังกฤษ** | ข้อความ error ของ Tax workspace เต็ม, ledger (บางส่วน), banking และ reports ส่วนใหญ่ยังเป็นอังกฤษเชิงเทคนิค (เช่น "Tax period must have a current reviewed export package before filing", "Over-allocation: remaining unmatched amount is …", "fromDate must not be after toDate") และ PDF generic ของ FR-TAX-060 เป็นอังกฤษล้วน — สอดคล้องกับที่โมดูลเหล่านี้ไม่ได้ขายในแพ็ก | ไฟล์ตามที่อ้างในส่วน D–G |
| ข้อห้ามด้านรูปแบบ | ไม่ใช้รหัสภายใน/enum ในเซลล์ที่คนอ่าน; ไฟล์หลายสกุลเงินไม่รวมยอดข้ามสกุล ("อย่ารวมต่างสกุล") | `buildAccountantWorkbook`, `withholdingAccountantExport` |

---

## 13. Non-functional requirements

| ID | ข้อกำหนด | หลักฐาน |
|---|---|---|
| NFR-301 | **การแยกข้อมูลรายร้าน**: ทุก endpoint ตรวจ `assertRouteCompany` และทุก query มี `companyId`; ขอบเขตสาขาใช้ `branchScopeWhere(ctx.scopes)` / `isBranchInScope`; issue ของสาขาอื่นถูกซ่อนรายละเอียด | `tax.controller.ts`, `withholding-filing-validation.ts` (sanitize), `wht-handoff-read-scope.ts` |
| NFR-302 | **Idempotency**: handoff (`creationCommandId`), การจดใบนอกระบบ (`commandId`), การจองเลขเอกสาร (idempotency key), tax event (`idempotencyKey` + `sourceHash`), การแข่งขันออกใบ (conditional `updateMany` + `FOR UPDATE`) | `wht-certificate-handoff.use-case.ts`, `issue-wht-certificate-from-handoff.use-case.ts`, `tax-event.logic.ts` |
| NFR-303 | **ความถูกต้องภายใต้การทำงานพร้อมกัน**: การดาวน์โหลดแบบและการบันทึกยื่นใช้ transaction `Serializable`; การอ่านหน้ารายเดือนและ e-WHT export ใช้ `RepeatableRead`; serialization failure ถูกแปลงเป็น 409 ที่ผู้ใช้ลองใหม่ได้ | `generate-tax-filing-package.use-case.ts`, `tax.controller.ts:324-356`, `generate-wht-report.use-case.ts` |
| NFR-304 | **ความแม่นยำของเลขเงิน**: เส้นทางที่ขายในแพ็ก (ปันส่วนการจ่าย, ยอดแบบ, ไฟล์ผู้ทำบัญชี) ใช้ `Prisma.Decimal`/`decimal.js`; banking ใช้ `bigint` สตางค์; **ข้อจำกัดที่ทราบ**: รายงานบัญชี (FR-TAX-082), รายงาน VAT/WHT snapshot (FR-TAX-026, 052) และผลรวมบน PDF ภ.ง.ด. ใช้ JS `number`/`parseFloat` — ผู้พัฒนาต่อควรเปลี่ยนเป็น Decimal | ไฟล์ในหัวข้อ 10 |
| NFR-305 | **เอกสารที่ยื่นแล้วแก้ไม่ได้**: แบบที่ `FILED` คืนไฟล์เดิมจาก storage พร้อมตรวจ sha256; แถวถูกแช่แข็งใน `WhtFilingLine.lineJson`; งวดล็อกไม่ถูก sync ทับ; ใบ 50 ทวิ ที่อยู่ในงวดยื่นแล้วแก้ข้อเท็จจริงไม่ได้ | FR-TAX-019, 022, 007, 015 |
| NFR-306 | **Audit**: ทุกการกระทำสำคัญบันทึกผ่าน `AuditService` พร้อม risk level — `CRITICAL`: `tax.period.mark_filed`, `tax.period.mark_paid`, `ledger.period.close/unclose`; `HIGH`: `tax.wht_certificate.issue/cancel`, `tax.filing_package.generate`, `tax.wht_payer_mode.answer`, `tax.withholding.e_wht_export`, `tax.review_issue.resolve`, `tax.code_definition.import`; `MEDIUM`: การ export รายจ่าย/รายงาน | ตามที่อ้างในแต่ละ FR |
| NFR-307 | **Launch gate แยกจาก entitlement**: การออก/แก้/ทำใบแทน 50 ทวิ ตรวจ route `cap.wht50bis` (`SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION`, `SYSTEM_REPLACEMENT_COPY`) ทุกครั้ง; ข้อผิดพลาดอื่นที่ไม่ใช่ "ปิดอยู่" ต้องส่งต่อ ไม่ตีความว่าปิด | `isLaunchRouteOpen` |
| NFR-308 | **ความปลอดภัยของไฟล์ส่งออก**: CSV กัน formula injection (`safeCsvCell`: ขึ้นต้นด้วย `= + - @` หรือ tab/CR/LF ถูกเติม `'`); ชื่อไฟล์ผ่าน `bundleName`/`reportCsvFileName`; ZIP ส่งด้วย `Cache-Control: private, no-store`; export ของรายงานหมดอายุ 7 วันและตรวจ checksum + ความเป็นเจ้าของ storage | `common/export/csv.logic.ts`, `expense.controller.ts:270-279`, `report.use-cases.ts` |
| NFR-309 | **ขีดจำกัด**: handoff list 200 แถว; รายงาน 100 แถว/หน้า และ export 5,000 แถว; ชุดหลักฐาน 60 ไฟล์ / 60 MB ต่อชุด; ไฟล์ใบนอกระบบ 10 MB; `expenseIds` ≤ 10,000; หน้าอ่านรายจ่าย 500 แถว | ตามที่อ้าง |
| NFR-310 | **การพึ่งพา asset และไลบรารี**: PDF ภาษีต้องมีไฟล์ 5 ไฟล์ใน `apps/api/src/modules/tax/assets/` (`rd-wht50bis.pdf`, `rd-pnd3-main.pdf`, `rd-pnd3-attachment.pdf`, `rd-pnd53-main.pdf`, `rd-pnd53-attachment.pdf`) ถูก copy ไปกับ build, ไลบรารี `pdf-lib` และ `sharp`, และฟอนต์ `Noto Sans Thai` ติดตั้งใน image (overlay เป็น SVG → PNG density 192); ตำแหน่งช่องของ ภ.ง.ด. เป็นค่าคงที่ที่วัดจากแบบรุ่นนี้ — **ถ้ากรมสรรพากรเปลี่ยนแบบต้องวัดใหม่** ส่วน 50 ทวิ อ่านตำแหน่งจาก AcroForm field ของแบบ | `*-official-form.logic.ts`, `wht-certificate-pdf.logic.ts` |
| NFR-311 | **เขตเวลา**: เดือนภาษี/วันที่จ่ายคิดตามเขตเวลาของบริษัท (default `Asia/Bangkok`) ผ่าน `civilDate`/`civilPeriodKey`; วันที่บนแบบเป็น พ.ศ. (`ค.ศ. + 543`) | `tax-period.logic.ts`, `wht-certificate-payment.ts` |
| NFR-312 | **ระบบไม่ยื่นภาษีแทนผู้ใช้**: ไม่มีการเชื่อมต่อ e-Filing กรมสรรพากรหรือธนาคาร; ทุกแบบเป็นไฟล์ให้พิมพ์ เซ็น และยื่นเอง; สถานะ "ยื่นแล้ว/ชำระแล้ว" เป็นการบันทึกด้วยมือ (`ACCEPTED_MANUAL`, `filedManuallyAt`) | FR-TAX-019, 022, 025, 061 |

---

## 14. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

ไม่มี tier ใดใน `TIER_FEATURE_PRESETS` ให้ feature ต่อไปนี้ (เปิดได้เฉพาะ System Partner admin ผ่าน preset `standard`/`full` หรือรายคีย์) รายละเอียดเชิงเทคนิคบันทึกไว้ในส่วน D–G เพื่อการสร้างระบบใหม่:

- **`thai_tax` — Tax workspace** (`/tax`, `/tax/evidence`, `/tax/reconciliation`, `/settings/tax-codes`, `/settings/tax-accounts`, `/settings/accounting-tax-setup`): งวดภาษี, VAT ภ.พ.30/ภ.พ.36, กล่อง ภ.พ.30, tax code profile/definition/import, account determination, report mapping, trade evidence, tax reconciliation, generic filing package, mark filed/paid, ออก 50 ทวิ จาก tax event, ปฏิทิน CIT, legacy remediation (FR-TAX-050 … 066)
- **`double_entry_ledger` — บัญชีแยกประเภท** (`/journal`, `/settings/chart-of-accounts`, `/period-closing`): ผังบัญชี, template, สมุดรายวัน, posting, งวดบัญชี, close checks, ปิด/เปิดงวด, GL/งบทดลอง/กำไรขาดทุน/ฐานะการเงิน (FR-TAX-070 … 083); เมนู `closing` "ปิดงวด" ยังมีสถานะ `planned`
- **`expense_auto_post` — ลงบัญชีค่าใช้จ่ายอัตโนมัติ** (ไม่มีเมนู; FR-TAX-077 … 078); preset `full` ก็จงใจตัดคีย์นี้ออก
- **`bank_reconciliation` — ธนาคารและกระทบยอด** (`/banking`): บัญชีธนาคาร, นำเข้า statement, จับคู่, กระทบยอด, รายการปรับปรุง, สถานะเงินสด (FR-TAX-090 … 099)
- **`reports` — รายงาน/BI** (`/reports`): แคตตาล็อก 18 ชุด, query, saved view, CSV export, drilldown (FR-TAX-110 … 118)
- **ภ.ง.ด.2** (`PND2`): มี enum, tax event `WHT_PND2` และแผ่น `ภ.ง.ด.2` ในไฟล์ผู้ทำบัญชี แต่**ไม่มีแบบ ภ.ง.ด.2** — ระบบตอบ `WHT_PND2_SEPARATE` ให้ผู้ทำบัญชีทำเอง
- **ภ.ง.ด.50 / ภ.ง.ด.51**: มีเฉพาะปฏิทิน (`GET tax/cit-calendar`) ไม่มีการคำนวณหรือแบบ
- **`CUSTOMS_SUPPORT`, ภ.พ.36, นำเข้าสินค้า/บริการ**: มีตรรกะ tax component แต่อยู่ใต้ `thai_tax`
- **เมนู `accounting` "บัญชี" และ `salesdoc`/`sales`** (สถานะ `planned`, feature `sales_documents`): ไม่ได้ขายและไม่อยู่ในเอกสารนี้
- **สมุดรายรับ-รายจ่าย** (`/income-expense-ledger`, โมดูล `accounting-documents`): ไม่ใช่โมดูล ledger; ไม่ได้ตรวจในเอกสารนี้ (FR-TAX-084)

---

## 15. สิ่งที่ยังตรวจไม่ครบ

### 15.1 ตรวจไม่ครบทุกบรรทัด (ให้ยึดไฟล์ที่อ้างเป็นหลัก)

- `wht-certificate-handoff.use-case.ts` บรรทัด 195–971: อ่านเฉพาะโครง method, error code และ `createOrReplay`; กฎละเอียดของ `listPaged`, `changeExternal`, `removeExternal`, `linkExternal`, `saveAddressToRegistry` ไม่ได้อ่านทุกบรรทัด
- `sync-tax-events.use-case.ts` บรรทัด 200–421 (ส่วน VAT ขายจากเอกสาร, ส่วนสร้าง WHT event จากรายจ่าย/เจ้าหนี้): สรุปจากชื่อ method, spec และผลลัพธ์ ไม่ได้อ่านทุกเงื่อนไข
- `prisma-tax.repository.ts` (`recordWithholdingDownload`, `markWithholdingFilingFiled`, `rollUpWithholdingPeriod`, `readWhtPayerMode`, `answerWhtPayerMode`) และ `withholding-establishments.ts`, `withholding-filing-history.ts`: ไม่ได้อ่านเนื้อใน
- `transaction-tax-config.use-case.ts` (794 บรรทัด), `transaction-tax-reconciliation.use-case.ts`, `tax-configuration.logic.ts`, `tax-evidence-policy.logic.ts`, `get-tax-summary.use-case.ts`: บันทึกจาก controller และ logic ที่เกี่ยวข้องเท่านั้น
- Ledger: `journal.use-case.ts` (746 บรรทัด), `expense-auto-post.use-case.ts`, `expense-backfill.use-case.ts`, `chart-template*.ts`, `th-sme-chart-of-accounts-v1.ts` (รายการบัญชีทั้งผัง), `prisma-ledger.repository.ts`: อ่านเฉพาะ error code/โครง — **รายการรหัสบัญชีทั้งหมดของ `TH_SME_COA_V1` ไม่ได้คัดลอกลงเอกสารนี้**
- Banking: `statement-import.use-case.ts`, `reconciliation.use-case.ts`, `matching.use-case.ts`, `bank-adjustment.use-case.ts`, DTO และขีดจำกัดขนาดไฟล์/จำนวนแถวของการนำเข้า ไม่ได้อ่านเนื้อใน (บันทึกจาก controller + `banking.logic.ts`)
- Reports: `report.use-cases.ts` (891 บรรทัด) อ่านเฉพาะ error code; การคำนวณภายในของ adapter แต่ละตัว (เช่น bucket ของ AR aging, metric ของ workflow/dashboard) ไม่ได้อ่าน
- Expenses: `expense-evidence.use-case.ts` ส่วน `workbookProjection` (บรรทัด 380–500) และ `buildAccountantMonthSummary`, `buildAccountantFollowUpRows`, `expense-record-pdf.logic.ts` อ่านบางส่วน; ความกว้างคอลัมน์และ style ของ XLSX ไม่ได้บันทึก
- ฝั่งเว็บ: ตรวจเฉพาะ route, permission gate และชื่อ component; ไม่ได้อ่านพฤติกรรม UI ของ `WithholdingPage`, `WhtCertificatesPage`, `BankingPages`, `ReportsWorkspacePage`, wizard ตั้งค่าบัญชีและภาษี
- สิทธิ์ตามบทบาทในหัวข้อ 1.4 ได้จากการ grep `ROLE_GRANTS`; กลุ่ม `report.*` ที่แจกผ่านค่าคงที่ `REPORT_BI_*` ไม่ได้ไล่ครบทุกบทบาท
- การ provision feature ของ `FREE_TRIAL_15` ไม่ได้ตรวจที่ผู้เรียก `billingFeaturePlan` ทุกจุด
- **ไม่ได้รัน test, build หรือโค้ดใด ๆ** (ตามกติกา read-only) — พฤติกรรมทั้งหมดได้จากการอ่านโค้ด

### 15.2 พบใน docs/โค้ดประกาศไว้ แต่ไม่พบการทำงานจริงในโค้ด

- **e-withholding / e-Filing**: ไม่มีการเชื่อมต่อธนาคารหรือกรมสรรพากร; "e-WHT" ในระบบคือการ**ติดป้าย**ว่ารายการนั้นธนาคารนำส่ง แล้วตัดออกจากแบบ + ออกไฟล์ XLSX สรุป (FR-TAX-025)
- **ส่งออกรายงานบัญชีเป็น XLSX** (`POST reports/:reportType/export`): endpoint มี แต่คืน `export_not_implemented` (FR-TAX-083)
- **ส่งออกรายงาน BI เป็น XLSX**: enum `ReportExportFormat.XLSX` มี แต่ use case รับเฉพาะ `CSV`
- **ส่งออกหลักฐานการกระทบยอดธนาคาร**: มี model `BankReconciliationEvidenceExport` และ permission `bank.reconciliation.export` แต่ไม่มี endpoint
- **preset ไฟล์นำเข้าเฉพาะโปรแกรมบัญชี** (เช่น Express/PEAK/FlowAccount): มีเพียง preset `purchase_journal`; เหตุผลตัดออก 14 จาก 15 รายการใน `ACCOUNTING_EXPORT_EXCLUSION_REASONS` ไม่มีจุดที่สร้าง (FR-TAX-036)
- **permission ที่ประกาศใน capability pack แต่ไม่พบ endpoint ใน controller ที่ตรวจ**: `tax.certificate.read`, `tax.certificate.void`, `tax.adjustment.create`, `tax.period.manage`, `bank.match.suggest`, `bank.reconciliation.export`, `report.subscription.manage` — ตรวจด้วย `git grep` ใน `apps/api/src` ไม่พบการใช้นอก registry (model `TaxAdjustment`, `TaxVerificationChecklist` มีใน schema แต่ไม่พบ endpoint ใน `tax.controller.ts` / `transaction-tax.controller.ts`)
- **ยอดยกมา (opening balance) และงบแสดงฐานะการเงินแบบสะสม**: `JournalEntryType` มี `OPENING_BALANCE`/`CLOSING` แต่รายงานคืน `openingBalance: '0.0000'` คงที่และคิดเฉพาะงวดเดียว
- **ภ.ง.ด.2, ภ.ง.ด.50, ภ.ง.ด.51**: มี enum/ปฏิทิน ไม่มีแบบ (หัวข้อ 14)
- เอกสาร spec ใน `docs/specs/` ไม่ได้ถูกเทียบทีละข้อกับโค้ดในงานนี้ (เวลาใช้ไปกับการตรวจโค้ด) — รายการข้างบนมาจากสิ่งที่โค้ด**ประกาศ**ไว้เองแต่ไม่ได้ทำ ไม่ใช่การเทียบกับ spec ทั้งชุด


