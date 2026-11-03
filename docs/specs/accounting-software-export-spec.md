# Accounting Software Export Spec — ส่งออกไฟล์ที่โปรแกรมบัญชีนำเข้าได้

Status: DRAFT — sold-feature ceiling and traceability updated 2026-10-26; controller checked 2026-11-04; FlowAccount Phase 0 still required; Re-anchored to develop e7c422802 on 2026-11-04
Owner: Expenses lane (controller review)
Related: backlog ข้อ 13 ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md`, `docs/specs/accountant-export-cleanup-spec.md` (ข้อ 25 — ทำก่อน), `docs/plans/accounting-software-export-plan.md`, `docs/agent-memory/accountant-exports.md`, `docs/specs/expense-category-default-tax-code-spec.md`, `docs/guidelines/thai-ux-standard.md`
Baseline: develop `e7c4228026eec3c696fa76986420d2c97cb26676`, re-read 2026-11-04 in this worktree; supersedes citation baseline `0f938a361` (2026-10-26).

## 0. Accepted design and implementation boundary

The 2026-10-24 R3-F2 design review (document VAT decision AND line restriction) is retained; it is not an implementation claim. Cleanup RC-F2 is a current co-voucher selection leak, redesigned 2026-10-26; design accepted by controller 2026-11-04, implementation pending. See `docs/specs/accountant-export-cleanup-spec.md` R8 and plan 0.1/1.2/1.4. This export uses the scoped `readPackageRows` path, not raw filing/voucher expansion IDs; do not reintroduce a union after the load.

**Sold scope:** starter expense screens and their recorded facts only (`packages/contracts/src/menu-entitlements.ts:432-450`, `:496-501`). No income–expense ledger, internal posting/JV columns, bank reconciliation, procurement, CRM, inventory, sales documents, reports, VAT/ภ.พ.30 workspace or shop LINE OA. Reading expense category codes and existing VAT/WHT snapshots is allowed; do not require ledger enrollment, a ledger account lookup or a tax-workspace permission. No new feature/permission key or environment feature switch.

This round edits documents only. External vendor/legal research below is retained from the dated previous research and has not been re-opened here (no network in this brief). FlowAccount still waits for the real template/import proof in Phase 0; no new claim of vendor compatibility is made.

### 0.1 Re-anchor findings — 2026-11-04 (existing behavior, not new implementation)

| Current finding / evidence opened | Effect on this design and plan |
|---|---|
| `expense-evidence.use-case.ts`, `expense-document.use-case.ts` and `apps/api/src/modules/tax` have no tree diff from `0f938a361`. RC-F2 remains at `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:370-375`. | Keep the controller-accepted intersect and full-voucher guards; implementation is still pending. Do not reopen its design gate. |
| **Date behavior already fixed**, commit `8c112ea70`: `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:148` uses `expenseDocumentDateStatus(...) !== 'unverified'`; `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:561-567` uses the document date for `implausible`, upload date only for unread dates. | Preserve this baseline. An unusual 18 Mar 2024 receipt uploaded in Oct 2026 stays in Mar 2024 and retains its warning. No date-bug implementation step remains; adapt workbook/projection tests, not the shared date predicate. |
| **B26 changed, not fixed**, commit `049aa51de`: `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:95-114` rechecks free eligibility and creator/draft state but still loads with `findById`; the detail reader scopes first at `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:227-244`. | Keep cleanup S, now for free and paid callers; preserve free source-only persistence, quota completion/refund and the additional creator/state restriction. |
| **B23 remains**: `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:11136-11140` swallows queue failure; `:11212` still promises reading. Free PDF also uses `captureLineFile` at `:9931-9939`. | Keep cleanup 3.5 for both paths; distinguish requested queue failure from deliberate image persistence with `read: 'none'` (`:11243-11244`). A retry rechecks the original actor/source and current allowance; no new draft, chat model or financial action. |
| Welcome/advisor shipped in `9036b8552`: `apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:402-428` verifies creation marker, current recipient, free eligibility and allowance; `apps/api/src/modules/auth/presentation/auth.controller.ts:529-546` serves a public read-only advisor. | Preserve `docs/specs/new-shop-welcome-package-advisor-spec-th.md`. Neither greeting nor advisor grants export access, resets allowance or adds an owner notification. No welcome/advisor implementation in these plans. |
| Activity history shipped in `1fbba874e`, simplified in `884ba5307`: `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:2078-2135` projects human activity; `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:85-93` renders actor/action/time only. | Preserve `docs/specs/expense-activity-history-spec.md`. Export audit remains audit; do not add export payloads, field tables or a second activity modal. Row selection and history state must survive export dialog changes. |
| Delivered confirmation suppression shipped in `3f6db1729`: `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3717-3731`. Company commands retain queue ordering at `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:506-516`. | Existing behavior to protect in cleanup 3.5. Do not send a new confirmation for an already accepted result or overtake a company switch. The buffer file itself has **no diff between these two baselines**; it is not a new repair in this round. |

### 0.2 Free and paid paths — R17

Free source drafts are inside the product ceiling, but are **not a paid starter export entitlement**. `docs/specs/free-expense-drafts-spec-th.md:67-78` permits three monthly receipt reads and source drafts, excludes typed questions (D04), and expressly excludes exports at `:77`. Eligibility is the existing historical/lifecycle resolver, not merely a tier string (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:17-51`); quota counts usable persisted results (`apps/api/src/modules/line-ai/application/free-expense-quota.ts:24-28`, `:44-57`). Reuse it; no environment switch, free export allowance or new permission.

**Existing enforcement:** `freeExpenseDraftPermissions` omits `expense.export` (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:58-68`), and the resolver intersects grants (`apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:130`). HTTP rejects routes outside the source-draft allowlist (`apps/api/src/modules/auth/presentation/auth.guard.ts:295-326`); `isFreeExpenseDraftRoute` denies the existing accountant endpoint and does not allow POST software-export or bundle routes (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:76-83`). Web hides the export action/dialog even with stale capability props (`apps/web/src/features/expenses/expenses.model.ts:1631-1632`, `apps/web/src/features/expenses/ExpensesPages.tsx:3001`). LINE returns before model/tool routing in free mode (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933-6941`). These guards exist; do not rebuild them.

**S-G4 — in-scope boundary gap, not a demonstrated HTTP bypass:** `readPackageRows` checks permissions/scope and then loads rows, but never re-reads commercial state (`apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:317-324`). A direct call carrying stale trial-era export permissions can reach the loader after a never-paid trial expires into free mode; a formerly paid shop is not eligible for this mode. Cleanup **0.2** reuses `assertExpenseFinancialAccess(ctx, this.prisma.client)` from `apps/api/src/modules/expenses/application/expense-commercial-access.ts:22-24` at that shared boundary for customer contexts, before row/file/WHT work; retain the existing `SYSTEM_ADMIN` exemption from `auth.guard.ts:325`; software export reuses the same guarded loader. Current non-free lifecycle failure still fails closed; normal paid permissions and scope remain required. Keep staff/system-admin HTTP behavior outside this customer design.

**S-G5 — in-scope refusal exit:** a free typed export request currently falls back to the one-line free-chat refusal (`apps/api/src/modules/line-ai/domain/logic/free-expense-line.logic.ts:1`, `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6938-6939`), with no action from `mediaChoiceQuickReply` (`:543-549`). Preserve that truthful refusal and D04; pass a `เมนูหลัก` quick reply through existing `lineChoiceQuickReply`/`deliverReply` (`:2659-2669`) so the actor can reach the existing model-free draft menu. Do not classify the request with AI or add an export tool. On web, a denied/stale export view offers `กลับไปรายการค่าใช้จ่าย`; no promise that purchase fixes a permission or outage.

**S-G6 — runner gap, outside code scope:** `apps/api/src/modules/system-partner-management/application/free-expense-access.spec.ts:107-115` has route tests but `grep -c` in `apps/api/package.json` is 0. Add export assertions to registered `src/modules/auth/auth.guard.spec.ts` and `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`; do not add tests to the unregistered file or change package.json.

Impact: paid output formats still follow this spec’s R1–R11/R13/R15; free receives no files/ZIP/links, even for retained or selected IDs. cleanup R16/R17/R19/R20 affect receipt facts on **both** paths; a free successful read remains only a draft. software R12/R14/R16/R17 verify both paths. The Traceability path column is normative for every requirement. No export path changes quota, payment, tax, history, welcome or notification writers.

The software-export endpoint still does not exist in `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:257-278`; its free-route denial is a requirement for the planned endpoint, not a claim that it shipped. Mapping management remains paid-only; free category lookup is not authority to write mappings.

## 1. ปัญหา

### 1.1 วันนี้ในระบบ

- ไฟล์ให้นักบัญชีมีแบบอ่านอย่างเดียว หนึ่งแถวต่อเอกสาร ([expense-export.logic.ts:250-272](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)); สเปกเดิมสั่ง "Do not copy or depend on a vendor-specific proprietary format" ([expense-receipt-upload-spec.md:181](expense-receipt-upload-spec.md)) — สำนักงานบัญชีต้องคีย์ใหม่ทีละรายการ (backlog ข้อ 13)
- รหัสบัญชีในมั่งมีเป็นผังของเรา `ExpenseCategory.ledgerAccountCode` ตามผัง `TH_SME_COA_V1` ([schema.prisma:2576-2606](../../apps/api/prisma/schema.prisma), [expense-category-bootstrap.service.ts:28-33](../../apps/api/src/modules/expenses/application/services/expense-category-bootstrap.service.ts)) ไม่ใช่ผังของสำนักงานบัญชี
- หมวดที่ร้านเห็นมาจาก `selectExpenseCategoryScope` ([prisma-expense.repository.ts:499-513](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)): ร้านที่ผ่าน bootstrap หมวด (มีหมวดของร้านที่ `ledgerAccountReviewedByUserId = 'system:expense-category-bootstrap'`) เห็น **เฉพาะหมวดของร้าน** ([:505-507](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)); ร้านอื่นเห็นหมวดของร้าน + หมวดกลาง (`companyId = null`) ที่ชื่อ/hint ไม่ซ้ำ — หมวดกลางใช้ร่วมหลายร้าน จึงเก็บรหัสบัญชีของสำนักงานบัญชีบนแถวหมวดไม่ได้; และรายการเก่าอาจอ้างหมวดกลางที่ตอนนี้ถูกซ่อนแล้ว
- บรรทัดรายจ่ายเก็บหมวด อัตรา VAT การยกเว้น VAT ยอด VAT และหัก ณ ที่จ่ายรายบรรทัด ([schema.prisma:2933-2958](../../apps/api/prisma/schema.prisma)); หัวเอกสารเป็นตัวจริงของยอด (`grandTotal = taxable + vat` [expense-totals.logic.ts:150-155](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)); เอกสารหนึ่งใบมีบรรทัด 7% ปนยกเว้น/0%/ไม่มี VAT ได้ ([expense-totals.logic.spec.ts:41-45](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); ยอด VAT ที่ผู้ใช้กรอกตามใบถูกเก็บไว้แม้ต่างจากอัตรา×ฐาน (ฐาน 300 VAT 21.01 [:690-697](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); ฐานหัก ณ ที่จ่ายต่างจากมูลค่าได้ (70.50 / 270.50 [:178-185](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts)); หักแบบกรอกยอดเงินไม่มีอัตรา ([expense-wht-input.logic.ts:8-9](../../apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts))
- รายจ่ายมีสกุลเงินอื่นได้ ([expense-draft.use-case.ts:169](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts))

### 1.2 ผลค้นคว้ารูปแบบนำเข้า (ตรวจ 2026-10-23/24)

| โปรแกรม | สรุป | ยืนยันแล้ว | ยังยืนยันไม่ได้ | แหล่ง |
|---|---|---|---|---|
| FlowAccount — นำเข้าค่าใช้จ่าย | มี | ค่าใช้จ่าย › "นำเข้าบิลและใบเสร็จ" › .xlsx หรือ .csv; แพ็ก Standard ขึ้นไป; ≤ 500 แถวต่อไฟล์, ≤ 300 แถวต่อเลขอ้างอิง; มีขั้น "จับคู่คอลัมน์" (เลือกว่าราคารวมภาษีหรือไม่ ทั้งไฟล์); คอลัมน์บังคับ วันที่เอกสาร, รายละเอียดค่าใช้จ่าย, ผังบัญชี, ราคาต่อหน่วย, ผู้จำหน่าย; ภาษี `7%`/`0%`/`ยกเว้นภาษี` ว่าง = 7%; หัก ณ ที่จ่ายต้องครบ แบบฟอร์ม (ภ.ง.ด.3 หรือ 53) + ประเภทเงินได้ + อัตรา ไม่ครบนำเข้าไม่ได้; ต้องกรอกคำอธิบายประเภทเงินได้เมื่อเลือกข้อ 6 (อื่น ๆ), 4(ข)(2.5), 4(ข)(1.3); ใช้ได้เฉพาะบรรทัดบัญชีค่าใช้จ่ายและผู้จำหน่ายต้องมีเลขผู้เสียภาษี; **ระบุวันที่ชำระโดยไม่มีวิธีการชำระนำเข้าไม่ได้**, วิธีการชำระว่าง = ค้างจ่าย, **เอกสารที่จะออกหนังสือรับรอง (มีหัก) ต้องระบุวิธีการชำระ**, **เลขอ้างอิงเดียวกันต้องใช้ประเภทเงินได้เดียวกัน**; แถวเลขอ้างอิงเดียวกัน = เอกสารเดียว (ข้อมูลระดับเอกสารต้องตรงกัน); **ผู้จำหน่ายต้องมีอยู่แล้ว** (ไม่สร้างให้); ผังบัญชีรูปแบบ "เลข / ชื่อบัญชี" | หัวคอลัมน์/ลำดับจริงของแม่แบบ (ต้องล็อกอิน); เซลล์วันที่แบบไหนอ่านได้; ผู้จำหน่ายใส่ชื่ออย่างเดียวได้ไหม; ข้อความตัวเลือกประเภทเงินได้; มีคอลัมน์ยอด VAT ไหม / FA ปัดเศษ VAT รายบรรทัดหรือท้ายเอกสาร; ค่าวิธีการชำระที่รับ (บัตร/อื่น ๆ) | https://flowaccount.com/help-center/category/expense/import-expense (อ่านเอง 2026-10-23, ผู้ประสานงานตรวจซ้ำ 2026-10-24) |
| FlowAccount — AI Connector | มี | ใช้ได้ทุกแพ็กเกจ ("แพ็กเกจไหนก็ใช้ได้") | ความสามารถสร้างค่าใช้จ่ายครบหรือไม่ | https://flowaccount.com/functions/ai-connector (ผู้ประสานงานตรวจ 2026-10-24) — **นอกขอบเขต** |
| FlowAccount — OpenAPI | มี `POST /expenses` | ต้องใช้แพ็ก Pro Business ตามรอบค้นคว้า (**ไม่ได้เปิดซ้ำ**) | — | https://flowaccount.com/developers — **นอกขอบเขต** |
| PEAK | มี | รายจ่าย › นำเข้าเอกสาร › "รูปแบบ PEAK" › บันทึกค่าใช้จ่าย › "ดาวน์โหลดไฟล์ตัวอย่าง บันทึกค่าใช้จ่าย (.xlsx)"; ให้อ่าน Description ในไฟล์; ฟิลด์บนจอ: วันที่เอกสาร, ผู้รับเงิน/คู่ค้า, เลขที่/วันที่ใบกำกับฯ, ประเภทราคา, ค่าใช้จ่าย/บัญชี, คำอธิบาย (≤ 1,000), จำนวน/ราคา (≤ 4 ตำแหน่ง), ภาษี, หัก ณ ที่จ่าย, ภ.ง.ด., ชำระโดย, ชำระเงิน (0 = ตั้งหนี้) | หัวคอลัมน์/ลำดับ/รหัสของแม่แบบ (ในแอปเท่านั้น); แพ็กและเพดานแถว (รายงาน Pro Plus/5,000 แถว — เปิดซ้ำไม่ได้) | https://www.peakaccount.com/peak-manual/peak-others/import-documents/import-expense-record , https://intercom.help/peak/en/articles/7324017-import-expense-ne004 |
| Express (เอ็กซ์เพรส) | **มีโปรแกรมเสริม** | ผู้ดูแลของ ESG โพสต์ 3 ม.ค. 2567 ว่ามี "โปรแกรมเสริมสำหรับการนำเข้าข้อมูลจากไฟล์ Excel" ครอบคลุม "ทั้งบิลซื้อ บิลขาย" (บทความเคล็ดลับเก่าที่บอกว่านำเข้าเฉพาะข้อมูลหลัก https://esg.co.th/tiptech/showcont.php?clid=113 ไม่มีวันที่และถูกแทนแล้ว) | แม่แบบ/คอลัมน์/ราคาของโปรแกรมเสริม | https://esg.co.th/phpBB3/viewtopic.php?f=1&t=18976 (ผู้ประสานงานตรวจ 2026-10-24) |
| SAP Business One (DTW) | มี | DTW ใช้ไฟล์ `*.txt` และ `*.csv` (หรือ ODBC) ไม่ใช่ xlsx | คอลัมน์ | https://help.sap.com/docs/SAP_BUSINESS_ONE/25bde9551224405e84e69c760e272e89/4925e081b34d14cde10000000a42189b.html?locale=es-ES |
| TRCloud, WINSpeed, Formula, MAC-5, Bplus, AccRevo | TRCloud มีนำเข้ารายการบัญชี | — | คอลัมน์ทั้งหมด | https://www.trcloud.co/tips-item.php?id=234 (รอบค้นคว้า) |
| แบบรายงานภาษีซื้อ (กรมสรรพากร) | — | คอลัมน์ตามแบบแนบท้ายประกาศ VAT ฉบับ 202 (accountant-export-cleanup-spec §5.2) | — | https://rd.go.th/27985.html , https://www.rd.go.th/fileadmin/images/image_law/images/vat-202-02.pdf |

### 1.3 การตัดสินใจจากหลักฐาน

1. **"สมุดรายวันซื้อ" ก่อน** — ไม่ขึ้นกับสิ่งที่ยืนยันไม่ได้, คงยอดเงินทุกตัวตามที่บันทึก (VAT บนใบ ฐานหัก) จึงไม่มีกรณีที่แสดงไม่ได้; ใช้คีย์มือหรือจับคู่คอลัมน์ในโปรแกรมใดก็ได้ที่รับ xlsx
2. **FlowAccount ตัวที่สอง หลังประตู Phase 0** — โปรแกรมเดียวที่ประกาศกติการะดับคอลัมน์ต่อสาธารณะ แพ็ก Standard นำเข้าได้ บริษัทเจ้าของใช้ FlowAccount อยู่; กรณีที่ไฟล์ FlowAccount แทนไม่ได้ **ไม่ใส่และบอกเหตุผล** (§7.4) ไม่ส่งข้อมูลที่ผิดเงียบ ๆ
3. **PEAK และ Express รอแม่แบบจริง** — ทั้งคู่มีการนำเข้า แต่หัวคอลัมน์อยู่ในแอป/โปรแกรมเสริม ยืนยันจากแหล่งสาธารณะไม่ได้; ระหว่างนี้ใช้สมุดรายวันซื้อ
4. **CSV ยังไม่ทำ** — โปรแกรมเป้าหมายที่ยืนยันแล้ว (FlowAccount, PEAK) รับ xlsx; SAP B1 DTW ต้อง txt/csv แต่ไม่ใช่เป้าหมายของร้าน SME ที่ขาย

## 2. เป้าหมาย

1. ร้านดาวน์โหลด "สมุดรายวันซื้อ" แยกแถวตามบัญชีของสำนักงานบัญชีและการใช้ VAT; ผลรวมทุกแถวเท่ายอดหัวเอกสารทุกตัว (มูลค่า VAT หัก ยอดรวม)
2. ร้านใส่รหัสและชื่อบัญชีของสำนักงานบัญชีให้แต่ละหมวดได้ครั้งเดียว (รวมหมวดเก่าที่ยังมีรายการ)
3. (หลัง Phase 0) ไฟล์ FlowAccount นำเข้าได้โดยไม่มีแถวผิด; เอกสารที่แทนไม่ได้ถูกบอกชื่อและเหตุผลบนหน้าจอ
4. ไม่มีลิงก์ ไม่มีรหัสภายใน คำไทยตาม accountant-export-cleanup-spec

## 3. Non-goals

- เชื่อม API/MCP ของโปรแกรมบัญชี (PEAK API, FlowAccount OpenAPI/AI Connector)
- ซิงก์อัตโนมัติ / ส่งทางอีเมลหรือ LINE
- ฝั่งรายรับ (`sales_documents` ไม่ได้ขาย), E5 income–expense ledger, internal ledger/posting/JV, VAT workspace/ภ.พ.30, bank reconciliation, procurement, CRM, inventory, reports และ LINE OA ของร้าน
- ส่งออกรายชื่อผู้จำหน่ายให้ FlowAccount นำเข้าก่อน — ผลจาก Phase 0 ตัดสิน (G1)
- CSV (§1.3 ข้อ 4)
- แปลงเงินต่างสกุล — ไฟล์นำเข้ารับ THB เท่านั้น ต่างสกุลถูกบอกเป็นรายการที่ไม่ได้ใส่
- เปลี่ยนไฟล์ Excel สำหรับนักบัญชี/ZIP (สเปกข้อ 25)

## 4. ผู้ใช้และ journey

| ผู้ใช้ | สิทธิ์ | เว็บ | LINE |
|---|---|---|---|
| ผู้ดูแลหมวดหมู่ | `expense.category.manage` ([expense.controller.ts:745-761](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts)) | ค่าใช้จ่าย › หมวดหมู่ › ใส่ "รหัสบัญชี" + "ชื่อบัญชี" ต่อหมวด (รวมส่วน "หมวดเก่าที่ยังมีรายการ") | ไม่มี |
| เจ้าของกิจการ / การเงิน / นักบัญชีสมาชิก | `expense.export` + `expense.read` | J1 หน้ารายการ › "ส่งออก Excel ให้สำนักงานบัญชี" › `รูปแบบไฟล์` › "ดาวน์โหลด Excel"; J2 หน้าหลักฐานทางบัญชี › `รูปแบบไฟล์ Excel` › "ดาวน์โหลด Excel" | การ์ดคู่มือ `expense.export` เดิม (ยังจริง) |
| สำนักงานบัญชีที่ใช้ FlowAccount | บัญชี FlowAccount | สร้างผู้จำหน่ายที่ยังไม่มี › ค่าใช้จ่าย › นำเข้าบิลและใบเสร็จ › จับคู่คอลัมน์ ("ราคาไม่รวมภาษี") › ตรวจ › นำเข้า; บันทึกเอกสารที่ไม่ได้ใส่ด้วยมือจากไฟล์สำหรับนักบัญชี | — |
| สำนักงานบัญชีที่ใช้ PEAK / Express / อื่น ๆ | — | สมุดรายวันซื้อ: คีย์ตามแถว หรือจับคู่คอลัมน์ในโปรแกรม | — |

## 5. กติกา/ข้อยกเว้น

- R1 **รายการที่ใส่**: ตัวกรองและประตูสิทธิ์เดียวกับการส่งออกให้นักบัญชี; **สถานะที่ไม่ส่งมาถือเป็น `CONFIRMED`** (กติกาเดิม `request.status ?? 'CONFIRMED'` [expense-evidence.use-case.ts:321](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) — DTO ปล่อยว่างได้ [expense.dtos.ts:272](../../apps/api/src/modules/expenses/presentation/http/expense.dtos.ts) และหน้ารายการไม่ส่ง status); สถานะอื่นที่ส่งมาชัดเจน (เช่น `VOIDED`) → ปฏิเสธพร้อมทางออก (T8)
- R2 **แถว** = เอกสาร × บัญชี × การใช้ VAT × สิทธิภาษีซื้อ × ชุดหัก ณ ที่จ่าย: รวมบรรทัดตาม (บัญชีที่ map — ไม่ map ใช้หมวด, `vatTreatment`/ประเภทภาษีของบรรทัด, อัตรา VAT, **สิทธิภาษีซื้อที่มีผลของบรรทัด (R3-F2 — ปิดแล้ว §0)** = ประตูระดับเอกสาร**ปัจจุบัน** **และ** ข้อจำกัดของบรรทัด — ไม่มีฝั่งใดยกข้อจำกัดของอีกฝั่ง: ประตูเอกสารแบบเดียวกับที่บัญชีและการ sync ใช้ (`inputVatClaimStatus === 'CLAIMABLE' && taxEvidenceStatus === 'USABLE_FOR_TAX'` [posting-engine.logic.ts:298-299](../../apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts), [sync-tax-events.use-case.ts:139](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) — ผู้ตรวจที่ปฏิเสธภายหลัง (`NON_CLAIMABLE` 'ใช้ส่วนตัว' [prisma-expense.repository.ts:655](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) จึงชนะ snapshot `CLAIMABLE` ของบรรทัดเสมอ; ข้อจำกัดบรรทัดใช้เมื่อ `taxComponentsJson` ไม่ว่าง: `claimabilitySnapshot` (รหัส `V7` = `CLAIMABLE`, `ND` = `NONDEDUCTIBLE_EXPENSE` [tax-code-template.catalog.ts:47-48](../../apps/api/src/modules/tax/domain/tax-code-template.catalog.ts)) และผลตรวจหลักฐานของบรรทัด `taxEvidenceReviewStatus` (ว่าง = `REVIEW_REQUIRED` [prisma-expense.repository.ts:353](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts); sync ไม่ใช้ที่ไม่ `VERIFIED` [sync-tax-events.use-case.ts:148](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); ฟิลด์ [schema.prisma:2964-2986](../../apps/api/prisma/schema.prisma); ผลที่เข้มที่สุดชนะตามคอลัมน์ 16 — บรรทัด 100+7 แบบ V7 กับ 100+7 แบบ ND ในบัญชีเดียวจึงเป็นสองแถว ไม่ถูกรวมเป็น 200+14 ที่ใช้สิทธิได้ทั้งหมด, **หมวดเงินได้และอัตราหักของบรรทัด** เมื่อเป็นบรรทัดเก่าที่หักแยกรายบรรทัด) — บรรทัดค่าเช่าหัก 5% กับค่าบริการหัก 2% ในบัญชีและ VAT เดียวกันจึงเป็นสองแถว (fixture [expense-source.adapter.spec.ts:100-109](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.spec.ts)); บรรทัดที่ไม่หักไม่รวมกับบรรทัดที่หัก; บรรทัดค่าบริการเพิ่ม (`chargeKind`) ใช้หมวดของหัวเอกสาร ([schema.prisma:2939-2943](../../apps/api/prisma/schema.prisma)); เรียง วันที่เอกสาร › เลขที่รายการ › รหัสบัญชี › อัตรา VAT › หมวดเงินได้
- R3 **ยอดรายแถว (คงยอดที่บันทึก)**: มูลค่า = Σ `line.taxableAmount`, VAT = Σ `line.vatAmount` (ยอดหลังกระทบยอดกับใบ — คงสตางค์ที่ผู้ใช้กรอก เช่น 21.01), ยอดรวม = มูลค่า + VAT; ผลรวมทุกแถวต้องเท่าหัวเอกสาร (`taxableAmount`, `vatAmount`) — ส่วนต่างที่เหลือ (ในขอบ 0.05 ของ identity [expense-totals.logic.ts:146](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)) ปรับเข้าแถวที่มูลค่ามากที่สุด **ในกลุ่ม VAT เดียวกัน**
- R4 **หัก ณ ที่จ่าย (สมุดรายวันซื้อ)**: ใช้ข้อเท็จจริงชุดเดียวกับ ภ.ง.ด. ระดับเอกสาร — บรรทัดเก่าที่มีหมวด/อัตราของตัวเอง (`!whtInputJson` และหลายบรรทัด แบบ `split` [expense-source.adapter.ts:104-107](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) อยู่ในแถวที่มีชุดหักเดียวกันตาม R2 (ฐาน = Σ มูลค่าบรรทัดในแถว, อัตรา = อัตราของชุด, ยอด = Σ ยอดหักบรรทัด, หมวด = หมวดของชุด) — แต่ละแถวจึงมีหมวด/อัตราเดียวเสมอ; หักทั้งใบอยู่แถวที่มูลค่ามากที่สุด ฐาน = `expenseWhtIncomeBase` (อาจต่างจากมูลค่า), อัตรา = `expenseWhtHeaderRate` (ไม่มี → `ยังไม่ระบุ`); แบบ ภ.ง.ด. = `withholdingFormFor` (บุคคล → ภ.ง.ด.2 เมื่อ `SEPARATE_PND2` มิฉะนั้น ภ.ง.ด.3; นิติบุคคล → ภ.ง.ด.53; ไม่รู้ → `ยังไม่ระบุ` — [sync-tax-events.use-case.ts:60-77](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); **การยื่นรายเดือนตามการจ่ายใช้แผ่น `หัก ณ ที่จ่าย` ของไฟล์สำหรับนักบัญชี** (สเปกข้อ 25 §5.3) ไม่ใช่สมุดรายวันซื้อ
- R5 **VAT ต้องห้าม** ตาม ม.82/5 นำมาหักภาษีขายไม่ได้ (ประกาศ VAT ฉบับ 17 ออกตาม ม.82/5 https://rd.go.th/3409.html) — สมุดรายวันซื้อแยก `VAT` กับ `สิทธิภาษีซื้อ` **ต่อแถว** (ตามสิทธิที่มีผลของบรรทัดใน R2) ให้นักบัญชีตัดสิน; สิทธิที่มีผล = ประตูเอกสารปัจจุบัน **และ** ข้อจำกัดบรรทัด (R2) — การตัดสินระดับเอกสารไม่ยกข้อจำกัด `ND` ของบรรทัด และ snapshot `CLAIMABLE` ของบรรทัดไม่ฟื้นสิทธิที่ผู้ตรวจปฏิเสธระดับเอกสาร
- R6 re-anchor: preserve `8c112ea70` through the shared loader (`prisma-expense.repository.ts:556-568`, `:4853`). Do not replace an unusual printed date with upload date or blank it using the old `expenseDateIsReadable` gate. The software export remains CONFIRMED-only; an unusual `NEEDS_REVIEW` record is still rejected by R1. Existing date regressions are retained; add a software projection/selection regression, not another date fix.
- R6 **วันที่** เป็นเซลล์วันที่จริง (style 4 แสดง `13 ต.ค. 2569` [xlsx.logic.ts:251](../../apps/api/src/common/export/xlsx.logic.ts)); เลขประจำตัว/สาขาผู้ขาย (5 หลัก `00000` = สำนักงานใหญ่) เป็นข้อความ
- R7 **สกุลเงิน**: ไฟล์นำเข้าใส่เฉพาะ THB; ต่างสกุล → ไม่ใส่ + บอกใน `excluded`
- R8 **ไม่ใช้ feature switch**; สิทธิ์ `expense.export` เดิมในทุก sold tier (owner ceiling 2026-10-26)
- R9 **FlowAccount** ≤ 500 แถวต่อไฟล์ แบ่งระหว่างเอกสาร; เอกสารเกิน 300 แถว → ไม่ใส่ + เหตุผล
- R10 **ไม่มีข้อมูลผิดเงียบ ๆ**: ถ้ารูปแบบปลายทางแทนข้อเท็จจริงของเอกสารไม่ได้ครบ ให้ไม่ใส่เอกสารนั้นและส่งชื่อ+เหตุผลใน `excluded` (API และหน้าจอ) — นักบัญชีบันทึกเองจากไฟล์สำหรับนักบัญชี

## 6. R11 — Data model and mapping (additive)

```prisma
/// รหัสบัญชีในโปรแกรมบัญชีของสำนักงานบัญชี ต่อร้าน ต่อหมวด — แยกตารางเพราะหมวดกลาง (companyId null)
/// ใช้ร่วมหลายร้าน. ไม่ใช่ผังของมั่งมี (`ExpenseCategory.ledgerAccountCode`) และไม่ใช้ลงบัญชีในระบบ.
model ExpenseCategoryAccountantAccount {
  id                String          @id @default(cuid())
  companyId         String
  expenseCategoryId String
  accountCode       String          @db.VarChar(20)
  accountName       String          @db.VarChar(120)
  updatedByUserId   String
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  company           Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  expenseCategory   ExpenseCategory @relation(fields: [expenseCategoryId], references: [id], onDelete: Cascade)

  @@unique([companyId, expenseCategoryId])
  @@index([companyId])
}
```

- back-relation ใน `Company` และ `ExpenseCategory`; migration ใหม่ (CREATE TABLE + unique + index + 2 FK) ไม่มี backfill
- หมวดที่ตั้ง mapping ได้ = หมวดที่ร้านเห็นตาม `selectExpenseCategoryScope` **∪ หมวดที่รายจ่าย/บรรทัดของร้านนี้อ้างถึง** (รวมหมวดกลางที่ถูกซ่อนหลัง bootstrap) — ไม่งั้นรายการเก่าจะไม่มีทางมีรหัสบัญชี
- หมวดถูกปิด → mapping คงอยู่; หมวดถูกลบ (cascade) → mapping หาย; สองหมวดชี้บัญชีเดียวกันได้

## 7. Contracts/API

### 7.1 Contracts (`packages/contracts/src/expenses.ts`)

```ts
export type ExpenseCategoryAccountantAccount = { accountCode: string; accountName: string };
// ExpenseCategorySummary: + accountantAccount?: ExpenseCategoryAccountantAccount | null; + referencedOnly?: true (หมวดเก่าที่ซ่อนแต่ยังมีรายการ)
export type SetExpenseCategoryAccountantAccountInput = ExpenseCategoryAccountantAccount;
export const ACCOUNTING_SOFTWARE_EXPORT_PRESETS = ['purchase_journal', 'flowaccount'] as const; // Phase 1 มีแค่ 'purchase_journal'
export type AccountingSoftwareExportPreset = (typeof ACCOUNTING_SOFTWARE_EXPORT_PRESETS)[number];
export type AccountingSoftwareExportRequest = SharedEvidenceFilter & { preset: AccountingSoftwareExportPreset };
export const ACCOUNTING_EXPORT_EXCLUSION_REASONS = ['foreign_currency', 'not_confirmed', 'vat_not_representable',
  'wht_not_representable', 'wht_without_vendor_tax_id', 'wht_form_not_supported', 'wht_payee_kind_unknown',
  'wht_mixed_income_types', 'wht_unpaid', 'wht_partly_paid', 'wht_paid_in_several_payments', 'wht_paid_date_unconfirmed',
  'wht_payment_method_not_supported', 'account_unmapped', 'too_many_rows'] as const;
export type AccountingSoftwareExportResult = {
  preset: AccountingSoftwareExportPreset;
  files: { fileName: string; xlsxBase64: string; rowCount: number }[];
  documentCount: number; rowCount: number;
  excluded: { expenseNumber: string; reason: (typeof ACCOUNTING_EXPORT_EXCLUSION_REASONS)[number]; detail: string }[];
  paymentNotExported: { expenseNumber: string; detail: string }[];   // FlowAccount: ส่งเป็นค้างจ่าย
  unmappedCategories: { id: string; name: string }[];
};
export const PURCHASE_JOURNAL_COLUMNS = [...] as const; // §7.3
```

`detail` เป็นคำไทยจาก `ACCOUNTING_EXPORT_EXCLUSION_LABELS` (contracts) เช่น `ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท`

### 7.2 R11/R14 — Endpoints

| Method/Path | สิทธิ์ | Body | ผล |
|---|---|---|---|
| `GET /v1/companies/:companyId/expense-categories/manage` (เดิม) | `expense.category.manage` | — | หมวดเดิม + `accountantAccount` + หมวดที่ซ่อนแต่ยังมีรายการ (`referencedOnly: true`) |
| `PUT /v1/companies/:companyId/expense-categories/:categoryId/accountant-account` | `expense.category.manage` | `{ accountCode, accountName }` trim; รหัส 1–20 ชื่อ 1–120; **ทั้งค่าไม่มีอักขระควบคุม** และตัวแรกไม่ใช่ `= + - @` (`@Matches(/^[^=+\-@\u0000-\u001F\u007F][^\u0000-\u001F\u007F]*$/)`) | 200; หมวดไม่อยู่ใน (ที่ร้านเห็น ∪ ที่รายการของร้านอ้าง) → 404; audit `expense.category.accountant_account.set` (LOW) |
| `DELETE …/accountant-account` | `expense.category.manage` | — | 204; audit `…clear` |
| `POST /v1/companies/:companyId/expenses/accounting-software-export` | `expense.export` (+ `expense.read` และสาขาเหมือน `readPackageRows` [expense-evidence.use-case.ts:317-320](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts)) | `AccountingSoftwareExportDto extends AccountantPackageDto` (สเปกข้อ 25 §7.5 — มี `page`/`pageSize`) `{ @IsIn(PRESETS) preset }` | 200 result; `status` ว่าง → `CONFIRMED`; `status` ≠ `CONFIRMED` → 422 `accounting_export_confirmed_only`; FlowAccount + หมวดที่ใช้ในช่วงนี้ไม่ map → 422 `accounting_export_accounts_unmapped` + `categories`; ทุกเอกสารถูก exclude หรือ 0 รายการ → 200 `files: []` + `excluded`; audit `expense.accounting_software_export.create` (MEDIUM) `{ preset, documentCount, rowCount, excludedCount, filterSummary }` |

use-case `CreateAccountingSoftwareExportUseCase` (ไฟล์ `expense-evidence.use-case.ts`, ใช้ `readPackageRows` ร่วม) + logic บริสุทธิ์ใหม่ `apps/api/src/modules/expenses/domain/logic/accounting-software-export.logic.ts`

### 7.3 สมุดรายวันซื้อ (`purchase_journal`)

แผ่น `สมุดรายวันซื้อ` + `เกี่ยวกับไฟล์นี้` (รวมรายการที่ไม่ได้ใส่ + เหตุผล); ชื่อไฟล์ `สมุดรายวันซื้อ-<ชื่อร้าน>-<ช่วง>.xlsx`

| # | หัวคอลัมน์ | ค่า | เซลล์ |
|---|---|---|---|
| 1 | วันที่เอกสาร | `expenseDate` | วันที่ |
| 2 | เลขที่ตามเอกสาร | `vendorDocumentNumber` | ข้อความ |
| 3 | เลขที่รายการ | `expenseNumber` | ข้อความ |
| 4 | ประเภทเอกสาร | `SOURCE_DOCUMENT_TYPE_LABELS` | ข้อความ |
| 5 | ผู้ขาย/ผู้รับเงิน | snapshot | ข้อความ |
| 6 | เลขประจำตัวผู้เสียภาษีผู้ขาย | snapshot | ข้อความ |
| 7 | สาขาผู้ขาย (00000 = สำนักงานใหญ่) | `vendorBranchCodeSnapshot` | ข้อความ 5 หลัก |
| 8 | รหัสบัญชี | mapping; ไม่ map → ว่าง | ข้อความ |
| 9 | ชื่อบัญชี | mapping; ไม่ map → ว่าง | ข้อความ |
| 10 | หมวดค่าใช้จ่าย | ชื่อหมวด (หลายหมวดในบัญชีเดียว → คั่น `, `) | ข้อความ |
| 11 | รายละเอียด | `note`; หลายแถว → ต่อคำอธิบายบรรทัดแรกของกลุ่ม | ข้อความ |
| 12 | การใช้ VAT | `VAT 7%` / `VAT 0%` / `ยกเว้น VAT` / `ไม่มี VAT` (`vatTreatment`/อัตรา) | ข้อความ |
| 13 | มูลค่าก่อน VAT | R3 | เงิน |
| 14 | VAT | R3 (ยอดที่บันทึก) | เงิน |
| 15 | ยอดรวม | 13 + 14 | เงิน |
| 16 | สิทธิภาษีซื้อ | ต่อแถวตาม R2 ผลที่เข้มที่สุดชนะ: `ใช้ไม่ได้` (เอกสาร `NON_CLAIMABLE`; หลักฐาน `SUPPORTING_ONLY`/`NOT_TAX_EVIDENCE`; บรรทัด `NONDEDUCTIBLE_EXPENSE`/`NONDEDUCTIBLE_CAPITALIZED`; ผลตรวจบรรทัด `REJECTED`) › `รอตรวจสอบ` (เอกสารหรือหลักฐาน `NEEDS_REVIEW`; บรรทัด `PENDING_EVIDENCE`; ผลตรวจบรรทัด `DRAFT`/`REVIEW_REQUIRED`) › `ใช้ได้บางส่วน` (บรรทัด `PARTIAL`) › `ใช้ได้ตามเงื่อนไข`; ไม่มี VAT (`NOT_APPLICABLE` หรือ VAT 0) → `ไม่มี VAT` | ข้อความ |
| 17 | แบบ ภ.ง.ด. | R4 (`ภ.ง.ด.2`/`ภ.ง.ด.3`/`ภ.ง.ด.53`/`ยังไม่ระบุ`; ไม่มีหัก → ว่าง) | ข้อความ |
| 18 | ประเภทเงินได้ | `WhtIncomeCategory.nameTh` | ข้อความ |
| 19 | ฐานหัก ณ ที่จ่าย | R4 | เงิน |
| 20 | อัตราหัก (%) | R4 (`ยังไม่ระบุ` เมื่อไม่มีอัตรา) | ตัวเลข/ข้อความ |
| 21 | หัก ณ ที่จ่าย | R4 | เงิน |
| 22 | ยอดจ่ายสุทธิ | 15 − 21 | เงิน |
| 23 | สถานะการจ่าย | `EXPENSE_PAYMENT_STATUS_LABELS` (`ยังไม่ชำระ`/`ชำระบางส่วน`/`ชำระแล้ว` — คำเดิม [expenses.ts:266-271](../../packages/contracts/src/expenses.ts)) | ข้อความ |
| 24 | วันที่จ่ายล่าสุด | `max(ExpensePayment.paidAt)` `RECORDED` (สเปกข้อ 25 §7.2 #22) | วันที่/ข้อความ |
| 25 | สำรองจ่ายโดย | สเปกข้อ 25 §7.3 | ข้อความ |

ไม่ใส่ (exclude) ใน purchase journal เฉพาะ: ต่างสกุล (R7) — นอกนั้นทุกกรณีแทนได้เพราะคงยอดทุกตัว

### 7.4 R13 — FlowAccount (`flowaccount`) — **ทุกแถวที่ "ยังไม่ยืนยัน" ต้องผ่าน Phase 0 ก่อนเปิด**

แผ่นเดียว `นำเข้าค่าใช้จ่าย` (ไม่มีแผ่นข้อมูล — `excluded`/`paymentNotExported` อยู่ใน API และหน้าจอเท่านั้น); ชื่อไฟล์ `FlowAccount-ค่าใช้จ่าย-<ชื่อร้าน>-<ช่วง>[-ส่วนที่-N].xlsx`; ผู้ใช้เลือก "ราคาไม่รวมภาษี" ตอนจับคู่คอลัมน์

| หัวคอลัมน์ (คำตามหน้าช่วยเหลือ) | ค่า | สถานะ |
|---|---|---|
| วันที่เอกสาร | `expenseDate` เซลล์วันที่ | ยังไม่ยืนยันรูปแบบเซลล์ |
| เลขอ้างอิง | `vendorDocumentNumber` ถ้าไม่ว่างและไม่ซ้ำกับเอกสารอื่นในไฟล์; ไม่เช่นนั้น `<vendorDocumentNumber> (<expenseNumber>)` หรือ `expenseNumber` — กันสองผู้ขายที่ใช้ "001" ถูกรวม | กติกาจัดกลุ่มยืนยันแล้ว |
| ผู้จำหน่าย | ชื่อผู้ขาย (แม่แบบใช้ "รหัส / ชื่อ" — Phase 0 ตัดสินว่าต้องมี mapping รหัสผู้จำหน่ายหรือไม่) | ยังไม่ยืนยัน |
| เลขประจำตัวผู้เสียภาษี / ที่อยู่ผู้จำหน่าย | snapshot | คอลัมน์มีจริง |
| รายละเอียดค่าใช้จ่าย | `<ชื่อหมวด> · <note>` ตัด 1,000 ตัว | ความยาวสูงสุดยังไม่ยืนยัน |
| ผังบัญชี | `<accountCode> / <accountName>` | ยืนยันรูปแบบแล้ว |
| จำนวน | `1` | มีคอลัมน์ |
| ราคาต่อหน่วย | มูลค่าก่อน VAT ของแถว (R3) | — |
| ภาษี | `VAT 7%` ที่**แถวนั้น**ใช้สิทธิได้ (R2) → `7%`; `ZERO_RATED` → `0%`; ยกเว้น/ไม่มี VAT → `ยกเว้นภาษี` | ค่ายืนยันแล้ว; การใช้ `ยกเว้นภาษี` แทน "ไม่มี VAT" ยังไม่ยืนยัน |
| วิธีการชำระ + วันที่ชำระ | ส่งคู่กันเสมอ: `PAID` ด้วยการจ่ายครั้งเดียวที่ยืนยันวันที่แล้ว และวิธีจ่าย `CASH`/`BANK_TRANSFER`/`CHEQUE` → `เงินสด`/`โอนเงิน`/`เช็ค` + วันที่; มิฉะนั้นเว้นว่างทั้งสองช่อง (วันที่โดยไม่มีวิธีนำเข้าไม่ได้) → เอกสารเข้าเป็นค้างจ่าย. **เอกสารที่ไม่มีหัก**: ยังไม่จ่าย → ค้างจ่ายถูกต้อง ไม่เตือน; จ่ายแล้ว/จ่ายบางส่วน แต่ส่งเป็นค้างจ่าย → อยู่ใน `paymentNotExported` พร้อมเหตุผลจริง (`จ่ายด้วยบัตรหรือวิธีอื่น`, `จ่ายบางส่วน`, `จ่ายหลายครั้ง`, `วันที่จ่ายยังไม่ยืนยัน`). **เอกสารที่มีหัก** ต้องมีวิธีการชำระ (FlowAccount: "เอกสารที่จะออกหนังสือรับรองจึงต้องระบุวิธีการชำระ") → ส่งคู่ไม่ได้ = ไม่ใส่ (ตารางล่าง) | กติกายืนยันแล้ว; ค่าที่รับยังไม่ยืนยัน |
| หัก ณ ที่จ่าย: แบบฟอร์ม / ประเภทเงินได้ / อัตรา (+ คำอธิบายประเภทเงินได้) | `ภ.ง.ด.3`/`ภ.ง.ด.53`; ตาราง map `WHT_*` → ตัวเลือก FlowAccount (จาก Phase 0) พร้อมธง "ต้องมีคำอธิบาย" สำหรับข้อ 6 (อื่น ๆ), 4(ข)(2.5), 4(ข)(1.3) → คำอธิบาย = `<nameTh> · <note>` (เช่น `WHT_OTHER_IND`/`WHT_OTHER_JUR` [seed.ts:2952](../../apps/api/prisma/seed.ts)); อัตรา | กติกาสามช่อง+คำอธิบายยืนยันแล้ว; ข้อความตัวเลือกยังไม่ยืนยัน |
| หมายเหตุ | `มั่งมี <expenseNumber>` | — |

เอกสารที่ **ไม่ใส่** (`excluded`, R10):

| เหตุผล | เงื่อนไข | คำบนหน้าจอ |
|---|---|---|
| `foreign_currency` | `currency ≠ THB` | `ยอดเป็นสกุลเงินอื่น นำเข้าได้เฉพาะเงินบาท` |
| `vat_not_representable` | VAT ที่ FlowAccount จะคำนวณจากราคา×อัตรา (วิธีปัดตาม Phase 0) ≠ VAT ที่บันทึก (เช่น ใบ 300 VAT 21.01); หรือแถวที่มี VAT > 0 แต่สิทธิที่มีผล (R2) ไม่ใช่ `ใช้ได้ตามเงื่อนไข` (วิธีบันทึกใน FlowAccount ยังไม่ยืนยัน) | `VAT บนใบต่างจากที่ FlowAccount คำนวณ` / `ภาษีในรายการนี้ใช้ลดภาษีไม่ได้` / `ยังต้องตรวจภาษีในรายการนี้` |
| `wht_not_representable` | หักแบบยอดเงินไม่มีอัตรา; หลายอัตราในแถวเดียว; ฐานหัก ≠ ราคาแถวที่หัก; round2(อัตรา × ฐาน) ≠ ยอดหักที่บันทึก | `ยอดภาษีที่หักไว้ใส่ในไฟล์นี้ไม่ได้` |
| `wht_without_vendor_tax_id` | หัก > 0 และไม่มีเลขผู้เสียภาษีผู้ขาย (FlowAccount ปฏิเสธ) | `ยังไม่มีเลขผู้เสียภาษีของผู้ขาย` |
| `wht_form_not_supported` | แบบ ภ.ง.ด.2 (FlowAccount รับ 3/53) | `ภาษีของรายการนี้ใส่ในไฟล์ FlowAccount ไม่ได้` |
| `wht_payee_kind_unknown` | หัก > 0 และไม่รู้ประเภทผู้รับเงิน | `ยังไม่ระบุว่าผู้รับเงินเป็นบุคคลหรือนิติบุคคล` |
| `wht_mixed_income_types` | หัก > 0 และแถวของเอกสารเดียวกัน (ทุกบัญชีรวมกัน) map ไปตัวเลือกประเภทเงินได้ของ FlowAccount มากกว่าหนึ่งค่า — FlowAccount: "เลขอ้างอิงเดียวกันต้องใช้ประเภทเงินได้เดียวกัน" (แยกเป็นสองเอกสารไม่ได้เพราะเป็นใบเดียวกันของผู้ขาย) | `รายการนี้หักภาษีหลายประเภท` |
| `wht_unpaid` | หัก > 0 และยังไม่มีการจ่าย | `รายการนี้ต้องจ่ายก่อนส่งเข้า FlowAccount` |
| `wht_partly_paid` | หัก > 0 และจ่ายยังไม่ครบ | `จ่ายยังไม่ครบ` |
| `wht_paid_in_several_payments` | หัก > 0 และจ่ายครบด้วยการจ่ายมากกว่าหนึ่งครั้ง (ภ.ง.ด. แบ่งตามการจ่าย — ไฟล์นำเข้าแถวเดียวแทนไม่ได้) | `จ่ายหลายครั้ง` |
| `wht_paid_date_unconfirmed` | หัก > 0 และวันที่ของการจ่ายยังไม่ยืนยัน (`paidAtConfirmed = false`) | `วันที่จ่ายยังไม่ยืนยัน` |
| `wht_payment_method_not_supported` | หัก > 0 จ่ายครั้งเดียว แต่วิธีจ่าย `CARD`/`OTHER`/ไม่ระบุ (ยังไม่มีค่าที่ยืนยันใน FlowAccount — Phase 0 อาจเพิ่มได้) | `วิธีจ่ายนี้ใส่ในไฟล์นำเข้าไม่ได้` |
| `too_many_rows` | > 300 แถวในเอกสารเดียว | `เอกสารมีบรรทัดมากเกินที่ FlowAccount รับ` |

## 8. R14 — สิทธิ์ ABAC และขอบเขต tenant

- ตั้ง/ลบ mapping: `expense.category.manage`; `companyId` ใน path ต้องตรง `ctx.companyId` (guard เดิม); หมวดต้องอยู่ใน (ที่ร้านเห็น ∪ ที่รายการของร้านอ้าง); ไม่ผูกสาขา (หมวดเป็นของทั้งร้าน)
- ส่งออก: ประตูเดียวกับการส่งออกให้นักบัญชี; แถวจาก `listSharedEvidence` ที่กรองด้วย `ctx.scopes`; mapping/บรรทัด/การจ่ายอ่านด้วย `companyId`; `WhtIncomeCategory` เป็น catalog กลาง อ่านด้วย `code` อย่างเดียว ([schema.prisma:5607-5623](../../apps/api/prisma/schema.prisma))
- ไม่มีสิทธิ์ใหม่; ไม่มี entitlement key ใหม่ (owner sold ceiling); ไม่เรียก AI ไม่คิดเครดิต ไม่เขียนจาก LINE

## 9. State transitions

- Mapping: ไม่มี → มี (PUT) → แก้ (PUT) → ไม่มี (DELETE); upsert บน unique — สองคนพร้อมกัน คนหลังชนะ; audit ทั้งสองครั้ง
- การส่งออก: อ่านอย่างเดียว (ไม่มีสถานะ "ส่งออกแล้ว" — Q4)

## 10. R12 — UI

### 10.1 Dialog หน้ารายการ และการ์ดส่งออกหน้าหลักฐาน

Owner 2026-10-26: หน้าจอ/LINE/help ใช้คำธรรมดา; ชื่อทางบัญชีอยู่ในไฟล์เท่านั้น. UI เรียก preset `purchase_journal` ว่า **ไฟล์แยกตามหมวด**; ชื่อแผ่น/ไฟล์ยังเป็น `สมุดรายวันซื้อ` ตาม §7.3. ฟิลด์ mapping บนเว็บใช้ **รหัสหมวดในไฟล์** / **ชื่อหมวดในไฟล์**; หัวไฟล์ยังใช้ `รหัสบัญชี` / `ชื่อบัญชี`. ไม่เพิ่มการเปลี่ยนชื่อเมนูหรือพื้นผิวของ lane อื่น.


- `รูปแบบไฟล์` (ThemedSelect) แทน "รายละเอียดในไฟล์" ที่สเปกข้อ 25 ตัด; จำค่าด้วย `useMenuFilterState('expenses.export.format')`
- ตัวเลือก: `Excel สำหรับสำนักงานบัญชี` (ค่าตั้งต้น) · `ไฟล์แยกตามหมวด` · `FlowAccount` (หลัง Phase 2)
- ใต้ช่อง: หนึ่งบรรทัดตามตัวเลือก (T1/T2) แล้วคำเตือน (T3–T5)
- หลังดาวน์โหลด: `excluded.length > 0` → บรรทัด T11 + ปุ่ม `ดูรายการ` เปิดรายการเลขที่+เหตุผลในกล่องเดิม (ไม่ซ่อนในไฟล์ เพราะไฟล์ FlowAccount มีแผ่นเดียว); `paymentNotExported.length > 0` → T12; ทุกเอกสารถูก exclude → ไม่มีไฟล์ + T11 + `ดูรายการ`
- 390 px: ช่องและปุ่มเต็มความกว้าง; 1280/~1,556 px: dialog `sm` เดิม; การ์ดหน้าหลักฐานเต็มความกว้าง ช่องรูปแบบ (~18rem) ซ้ายปุ่ม Excel แถวเดียว ปุ่มสูงเท่ากัน

### 10.2 หน้าหมวดหมู่

- คอลัมน์ `รหัสหมวดในไฟล์` (~8rem) + `ชื่อหมวดในไฟล์` ต่อจาก "ภาษีซื้อเริ่มต้น" ใน `CategoryManagePanel` ([ExpensesWorkspacePanels.tsx:216-224](../../apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx)); 1280/~1,556 px เป็นคอลัมน์ตาราง; 390 px อยู่ใต้ชื่อหมวดในการ์ดแถว
- ส่วนท้าย `หมวดเก่าที่ยังมีรายการ` (มีเมื่อมี `referencedOnly`) — ใส่รหัสได้ เปิด/ปิดหมวดไม่ได้
- T6 เหนือรายการ; บันทึกเมื่อออกจากช่องที่สองและทั้งสองช่องมีค่า; ล้างทั้งสอง = ลบ; ล้มเหลว → T7 ใต้ช่อง ค่าคงอยู่

### 10.3 ข้อความ (คำตรงตัว)

| id | ข้อความ | เมื่อ |
|---|---|---|
| T1 | `แยกรายการตามหมวดสำหรับส่งเข้าโปรแกรมบัญชี` | เลือกสมุดรายวันซื้อ |
| T2 | `เพิ่มผู้ขายใน FlowAccount ก่อนนำเข้าไฟล์นี้` + ลิงก์ `ดูวิธีนำเข้า` ไปคู่มือทางการที่ยืนยันใน Phase 0 | เลือก FlowAccount |
| T3 | มีสิทธิ์จัดการหมวด: `ยังไม่ได้ใส่รหัสหมวดในไฟล์ N หมวด` + ปุ่ม `ใส่รหัสหมวด`; ไม่มีสิทธิ์: `ยังไม่ได้ใส่รหัสหมวดในไฟล์ N หมวด` + ปุ่ม `ใช้ไฟล์แยกตามหมวด` | FlowAccount และมีหมวดไม่ map (กดดาวน์โหลดแล้วแสดง — UX standard 2.9) |
| T4 | `มี N หมวดที่ยังไม่มีรหัสในไฟล์` | สมุดรายวันซื้อ และมีหมวดไม่ map |
| T6 | `ใช้รหัสและชื่อหมวดที่สำนักงานบัญชีให้มา` | หน้าหมวดหมู่ |
| T7 | `บันทึกไม่ได้ ข้อมูลยังอยู่` + ปุ่ม `ลองอีกครั้ง` | PUT ล้มเหลว |
| T8 | `ไฟล์นำเข้าใช้ได้กับรายการที่ยืนยันแล้วเท่านั้น` + ปุ่ม `ดูรายการที่ยืนยันแล้ว` | กรองสถานะยกเลิกแล้วเลือกรูปแบบนำเข้า |
| T9 | `ดาวน์โหลดไฟล์แล้ว N รายการ` / `ดาวน์โหลดไฟล์ FlowAccount แล้ว N รายการ ใน M ไฟล์` | สำเร็จ |
| T10 | `ไม่มีรายการตามที่เลือก` + ปุ่ม `เปลี่ยนช่วงวันที่` | 0 รายการ |
| T11 | `มี N รายการที่ใส่ในไฟล์นี้ไม่ได้` + ปุ่ม `ดูรายการ` และ `ดาวน์โหลด Excel สำหรับสำนักงานบัญชี` ในกล่องเดิม | `excluded.length > 0` |
| T12 | `บันทึกการจ่ายของ N รายการใน FlowAccount เพิ่มเอง` + ปุ่ม `ดูรายการ` | `paymentNotExported.length > 0` |

(T5 เดิมถูกแทนด้วยเหตุผล `wht_without_vendor_tax_id` ใน T11)

ตารางพื้นผิว × กรณี:

| ประโยค | หน้ารายการ | หน้าหลักฐาน | ไม่มีสิทธิ์จัดการหมวด | ไม่มีหมวดไม่ map | > 500 แถว | 0 รายการ | ทุกเอกสารถูก exclude |
|---|---|---|---|---|---|---|---|
| T1/T2 | จริง | จริง | จริง | จริง | จริง | จริง | จริง |
| T3 | จริง | จริง | แบบไม่มีปุ่มไปหน้าหมวด | ไม่แสดง | จริง | ไม่แสดง | ไม่แสดง (422 ก่อน) |
| T4 | จริง | จริง | จริง | ไม่แสดง | — | ไม่แสดง | จริงถ้ามี |
| T9 | จริง (นับจาก response) | จริง | จริง | จริง | `ใน M ไฟล์` จริง | ไม่แสดง (T10) | ไม่แสดง |
| T11 | จริง | จริง | จริง | จริง | จริง | ไม่แสดง | จริง (ไม่มีไฟล์) |
| T12 | จริง | จริง | จริง | จริง | จริง | ไม่แสดง | ไม่แสดง |

### 10.4 LINE

ไม่มีการ์ด/ข้อความใหม่; การ์ด `expense.export` ยังจริง — ไม่แก้

**R15 — Export-only vocabulary and privacy:** ชื่อทางบัญชี/ภาษีของ §7.3–7.4 อยู่ใน exported file หรือขั้นนำเข้าของสำนักงานบัญชี; เว็บใช้ §10.3. ไม่มี URL แอป, cuid หรือ posting fields ในไฟล์. Every exclusion has `ดูรายการ` and the same-screen accountant-file fallback; mapping failures keep typed values and a retry button. No new notifications/AI call/charge.

## 11. Impact analysis

| พื้นที่ | กระทบ |
|---|---|
| Prisma schema + migration | ตารางใหม่ 1 ตาราง (additive) |
| contracts `expenses.ts` | §7.1 |
| API expenses | DTO 2 คลาส, controller 3 route, use-case 3 (set/clear/export), repository (mapping + หมวดที่ถูกอ้าง), logic ใหม่ 1 ไฟล์ |
| API tax | ใช้ `withholdingFormFor` (ยกจาก sync ในสเปกข้อ 25) และ `expenseWhtIncomeBase`/`expenseWhtHeaderRate` เดิม |
| เว็บ | `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx` (การ์ดส่งออก + CategoryManagePanel), `expenses.api.ts`, `expenses.model.ts`, `workspace-dictionary.ts` |
| AI Gateway / LINE / เครื่องมือ AI / การแจ้งเตือน | ไม่กระทบ |
| billing/entitlement | ไม่มีคีย์ใหม่; ทุก sold tier ใช้ starter เดิม; ไม่แก้ `FEATURE_CATALOG`/`TIER_FEATURE_PRESETS` |
| W00 manifest | ไฟล์ที่ hash ไม่ถูกแตะ → รัน `line-ai-capability-manifest.spec.ts` ยืนยัน |
| whole-chain catalog | ไม่แก้ |
| browser journeys | `evidence-and-settings.journey.spec.ts` (ใส่รหัสบัญชี → ส่งออกสมุดรายวันซื้อ → ตรวจหัวและผลรวม); `e2e/expenses.spec.ts` EXP-EXPORT (select ใหม่, body `preset`) |
| seed | ไม่ต้อง |
| ผังบัญชีของมั่งมี / ledger | ไม่แตะ |

### 11.1 Changes, concrete failures and boundaries

These presets/mappings do not exist yet; grouping/rounding examples below are **acceptance hazards for the new export**, not newly alleged current-code arithmetic bugs. Current code supplies document-level accountant output (`expense-export.logic.ts:250-270`) and the stored facts cited in R2–R5.

| Requirements / scenario today or hazard | Smallest files/functions | Shared readers/writers and risk / tests first |
|---|---|---|
| R11/R14: office asks for category code 52031; current manage response has only internal category fields (`prisma-expense.repository.ts:4066`) | Add per-company mapping table; `listAllCategories`, set/clear use-cases and three category routes in existing expenses files (§7.2, plan 1.1–1.2). | Web is the only new writer; export reads mapping. LINE/AI/capture writers and `ledgerAccountCode` unchanged. Cross-tenant writes, hidden historical categories and uniqueness/cascade are first tests; real PG required. |
| R2–R5: 100@7% + 100 exempt, or V7+ND, or RENT5%+SERVICE2% in one account cannot be flattened without losing facts | New pure `accounting-software-export.logic.ts` uses expense lines and existing `expenseWhtIncomeBase`/`expenseWhtHeaderRate`; document current gate AND line restrictions, no ledger imports. | No tax/ledger posting or recalculation write. Preserve 21.01 VAT and explicit 270.50 WHT base; grouping/allocation tests before builder. |
| R1/R6–R8/R10/R15: only a document index exists, not a lossless file for the office's program | `CreateAccountingSoftwareExportUseCase` in `expense-evidence.use-case.ts` calls scoped `readPackageRows`, loads data only for those IDs, then new builder + DTO/controller. | Reuses expense filters/permissions without `bundleContents` expansion. Other exports keep their behavior. Risk: default status, empty/page selection, branch leakage, date serial or foreign currency; tests first. |
| R9/R13: a file cannot be claimed compatible without the real FlowAccount template; examples include 21.01 VAT and multi-payment WHT | Phase 0 evidence; Phase 2 builder in the same logic file and one preset constant addition, only after proof. | Local export is read-only; authorized test-company import is an external mutation in the later round. Never import in the live company. Exclude whole document when facts cannot be represented; precise reason and fallback. |
| R12: new format/mapping/exclusion controls must be understandable to a non-accountant | Existing `ExpensesPages.tsx` dialog and `ExpensesWorkspacePanels.tsx` category/export panels; API helper methods; labels §10.3. | Preserve filters/typed values; one primary action, equal buttons, phone first. No generic menu renaming, notices or LINE changes. Test all-excluded and no-manage permission fallback. |
| R16: current journey only proves ZIP/XLSX file magic (`evidence-and-settings.journey.spec.ts:69-82`) | Extend same journey, unzip amounts/headers and capture three widths. | No new seed framework. A test DB skip, a mock or a header-only download is insufficient acceptance. |

## 12. Gaps

- G1 **ผู้จำหน่ายต้องมีอยู่ใน FlowAccount ก่อน** (FlowAccount ไม่สร้างให้) — สำนักงานบัญชีสร้างเองก่อนนำเข้า (T2 บอก); ถ้า Phase 0 พบว่าต้องใช้ "รหัส / ชื่อ" ต้องเพิ่ม mapping ผู้จำหน่ายก่อนเปิด
- G2 ไม่มีสถานะ "ส่งออกแล้ว" — นำเข้าซ้ำได้; `เลขอ้างอิง` + `มั่งมี <เลขที่>` ช่วยตรวจ (Q4)
- G3 เอกสารที่ FlowAccount แทนไม่ได้ (§7.4) ต้องบันทึกมือ — ลดได้เมื่อ Phase 0 พบคอลัมน์ยอด VAT/ยอดหัก
- G4 PEAK, Express ยังไม่มี preset (รอแม่แบบ); API integration ไม่อยู่ในแผน
- G5 ต่างสกุลไม่อยู่ในไฟล์นำเข้า

## 13. Bugs ที่พบในโค้ดปัจจุบัน

บั๊กของไฟล์ส่งออกเดิม (B1–B29) อยู่ใน accountant-export-cleanup-spec §13 — B15 (body ไม่ผ่าน validator) ต้องแก้ก่อนเพราะ endpoint ใหม่ใช้ DTO แบบเดียวกัน; B17 (เลขที่เอกสารปลอมผ่านการตรวจ) กระทบคอลัมน์ `เลขที่ตามเอกสาร`/`เลขอ้างอิง` ของไฟล์นี้

### 13.1 New gaps verified 2026-10-26

- **S-G1 (in scope, test-plan gap):** `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.tax-snapshot.spec.ts:21-36` builds an in-memory `client`/`$transaction`; the old plan called it PostgreSQL evidence. Keep it for mapping behavior if needed, but prove unique/cascade/tenant isolation with the existing real harness in `prisma-expense.repository.payment.spec.ts:415-443` (registered); a skipped PG run is not acceptance.
- **S-G2 (in scope, current capability gap):** `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:4066` returns category fields without an accountant mapping; `apps/api/prisma/schema.prisma:2588` is the internal `ledgerAccountCode`, not an office-specific code. Input category “ค่าขนส่ง”, office code 52031 → no place to persist that office code today. R11 adds only the per-shop mapping table/API; no ledger module work.
- **S-G3 (in scope, wording gap):** old proposed T1/format labels required accounting knowledge. R12 keeps exact terminology inside the export and uses plain Thai on the two existing sold export screens (`apps/web/src/features/expenses/ExpensesPages.tsx:3001-3021`, `ExpensesWorkspacePanels.tsx:899-915`). This is a design correction, not a claim that the new preset already exists.

## 14. R16 — Test plan (ยังไม่ได้รัน; documents-only round)

API (ไฟล์ที่ลงทะเบียน):
- `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` (import โมดูลใหม่): แยกแถวตามบัญชี×VAT (100@7% + 100 ยกเว้น ในบัญชีเดียว → 2 แถว VAT 7.00/0.00); VAT ที่กรอกตามใบ 21.01 คงอยู่ทุกสตางค์; ผลรวมเท่าหัวเอกสารใน VAT_INCLUDED, ค่าบริการเพิ่ม, ส่วนต่าง 0.01; **ค่าเช่า 5% + ค่าบริการ 2% ในบัญชีและ VAT เดียวกัน (fixture adapter) → สองแถว หมวด/อัตรา/ฐาน/ยอดของตัวเอง**; **100+7 `V7` + 100+7 `ND` บัญชีเดียว → สองแถว สิทธิต่างกัน และ `flowAccountEligibility` ให้ `vat_not_representable`**; **(R3-F2) บรรทัด `V7` เอกสาร `CLAIMABLE` → `NON_CLAIMABLE` 'ใช้ส่วนตัว' → `ใช้ไม่ได้` + excluded, กลับเป็น `CLAIMABLE` → `ใช้ได้ตามเงื่อนไข`; เอกสาร `CLAIMABLE` + หลักฐาน `NEEDS_REVIEW` → `รอตรวจสอบ`; เอกสาร `CLAIMABLE` + บรรทัด `ND` → `ใช้ไม่ได้`; ผลตรวจบรรทัด `REVIEW_REQUIRED` → `รอตรวจสอบ`**; บรรทัดหักกับไม่หักในบัญชีเดียว → สองแถว; หักทั้งใบฐาน 270.50 → ฐาน 270.50; หักแบบยอดเงิน → อัตรา `ยังไม่ระบุ`; ภ.ง.ด.2; ต่างสกุล → excluded; `flowAccountEligibility` (Phase 1, §16) ให้เหตุผลถูกทุกกรณีด้านล่าง; FlowAccount (Phase 2): ทุกเหตุผลใน §7.4 รวม `wht_mixed_income_types` (สองบัญชีคนละประเภทเงินได้ในเอกสารเดียว), `wht_unpaid`/`wht_partly_paid`/`wht_paid_in_several_payments`/`wht_paid_date_unconfirmed`/`wht_payment_method_not_supported`; เอกสารไม่มีหักที่ยังไม่จ่าย → ไม่อยู่ใน `paymentNotExported`; เอกสารไม่มีหักที่จ่ายด้วยบัตร → ค้างจ่าย + `paymentNotExported`; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; ไม่มีเอกสารมีหักแถวใดไม่มีวิธีการชำระ; คำอธิบายประเภทเงินได้สำหรับข้อ 6; เลขอ้างอิงไม่ซ้ำ; แบ่ง 500 แถว
- `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`: status ว่าง → ใช้ CONFIRMED (หน้ารายการ); `VOIDED` → 422; FlowAccount ไม่ map → 422; ไม่มีสิทธิ์ 403; ระบุ `branchId` นอกขอบเขต 403; selected IDs นอกขอบเขตไม่คืนแถว; ทุกเอกสาร excluded → `files: []`; mapping set/clear, หมวดร้านอื่น 404, หมวดกลางที่ซ่อนแต่รายการร้านอ้าง → ตั้งได้, หมวดกลางที่ไม่เกี่ยว → 404; audit
- `src/modules/expenses/presentation/http/expense.dtos.spec.ts`: preset ไม่รู้จัก; รหัสยาวเกิน; ขึ้นต้น `=`; **แท็บ/ขึ้นบรรทัดกลางค่า** ถูกปฏิเสธ; `page`/`pageSize` ผ่าน
- PostgreSQL จริง `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` (ใช้ harness ที่ `:415-443`; tax-snapshot spec เป็น mock ไม่ใช่ PG): upsert สองครั้งแถวเดียว; ลบหมวด cascade; ร้าน A ไม่เห็น mapping ร้าน B; migration deploy สะอาด
- `pnpm --filter @watchdog-bms/api prisma:validate`

เว็บ: `CategoryManagePanel.spec.ts` (รวมส่วนหมวดเก่า), `ExpenseList.rendered.spec.ts` (select, T1–T4, T11–T12), `EvidencePanel.qa.spec.ts`

เบราว์เซอร์ (thai-ux-standard.md §7): journey ข้างบน ภาพจริงที่ 390, 1280, ~1,556 px + วัดปุ่ม

Phase 0 (มือ บันทึกใน memory): นำเข้าไฟล์ตัวอย่างเข้า FlowAccount บริษัททดลอง: สองบัญชี; ผสม 7% กับยกเว้น; VAT 21.01 บนฐาน 300; หัก 3% นิติบุคคล; หักข้อ 6 (อื่น ๆ); จ่ายด้วยบัตร (ไม่มีหัก) — ยืนยันว่าเข้าเป็นค้างจ่าย; หักแต่ไม่มีวิธีการชำระ — ยืนยันว่า FlowAccount ปฏิเสธ; สองประเภทเงินได้ในเลขอ้างอิงเดียว — ยืนยันว่า FlowAccount ปฏิเสธ; ร้านไม่จด VAT

## 15. Acceptance criteria

- AC-1 ใส่รหัสบัญชี "ค่าขนส่ง" = `52031` / `ค่าขนส่ง` ได้จากหน้าหมวดหมู่ทั้งที่ 390, 1280, ~1,556 px (ภาพจริง); รีเฟรชแล้วยังอยู่; ร้านอื่นไม่เห็น; หมวดเก่าที่ยังมีรายการตั้งได้
- AC-2 เอกสาร 1,070 (1,000 + VAT 70) สองหมวด (600/400) → 2 แถว ผลรวม 1,000.00 / 70.00 / 1,070.00
- AC-3 เอกสาร 100@7% + 100 ยกเว้น หมวดเดียว → 2 แถว VAT 7.00 และ 0.00
- AC-4 เอกสารฐาน 300 VAT 21.01 → สมุดรายวันซื้อ VAT 21.01; FlowAccount → อยู่ใน `excluded` (`vat_not_representable`) เว้นแต่ Phase 0 พบทางแทน
- AC-5 หักค่าบริการ 3% นิติบุคคล → `ภ.ง.ด.53`, `ค่าบริการ (นิติบุคคล)`, ฐาน 1,000.00, `3`, 30.00; บุคคลธรรมดา + `SEPARATE_PND2` → `ภ.ง.ด.2` (FlowAccount: excluded)
- AC-6 ไม่มี URL, cuid, enum อังกฤษ; วันที่เปิดใน Excel เป็นวันที่
- AC-7 ตัวกรองยกเลิก + รูปแบบนำเข้า → T8 ไม่มีไฟล์; หน้ารายการ (ไม่ส่ง status) ส่งออกได้
- AC-8 (Phase 2) ไฟล์ FlowAccount จาก AC-2/AC-3/AC-5 + ใบไม่มี VAT นำเข้าบริษัททดลองผ่าน 0 แถวแดง VAT/หักตรงทุกสตางค์; ไม่มีแถวใดมีวันที่ชำระโดยไม่มีวิธี; ทุกเอกสารที่มีหักมีวิธีการชำระ; ไม่มีเลขอ้างอิงใดมีประเภทเงินได้สองค่า
- AC-13 สมุดรายวันซื้อของเอกสารค่าเช่า 5% + ค่าบริการ 2% บัญชีเดียวกัน มีสองแถว ผลรวมฐาน/ยอดหักเท่าหัวเอกสาร
- AC-14 (R3-F2) เอกสาร 100+7 (`V7`) + 100+7 (`ND`) บัญชีเดียวกัน → สมุดรายวันซื้อสองแถว `ใช้ได้ตามเงื่อนไข` 7.00 และ `ใช้ไม่ได้` 7.00; FlowAccount → เอกสารอยู่ใน `excluded` (`vat_not_representable`, มี VAT ที่ใช้สิทธิไม่ได้) จนกว่า Phase 0 ยืนยันวิธีบันทึก
- AC-15 (R3-F2) บรรทัด `V7` (snapshot `CLAIMABLE`) ในเอกสารที่ผู้ตรวจเปลี่ยนเป็น `NON_CLAIMABLE` 'ใช้ส่วนตัว' → สมุดรายวันซื้อ `ใช้ไม่ได้` 7.00 และ FlowAccount อยู่ใน `excluded`; ผลตรงกับที่บัญชี (`posting-engine.logic.ts:298-299`) และการ sync (`sync-tax-events.use-case.ts:139`) ไม่นับ VAT นี้; เอกสาร `CLAIMABLE` ไม่ทำให้บรรทัด `ND` เป็น `ใช้ได้ตามเงื่อนไข`
- AC-9 > 500 แถว → หลายไฟล์ ไม่มีเอกสารถูกแบ่ง
- AC-10 รายการที่ไม่ได้ใส่แสดงชื่อและเหตุผลบนหน้าจอ รวมกรณีทุกรายการถูก exclude
- AC-11 W00 spec ผ่านโดยไม่ regenerate
- AC-12 dialog/การ์ด/หน้าหมวดหมู่ มีภาพเบราว์เซอร์จริงที่ 390, 1280, ~1,556 px; ปุ่มกลุ่มเดียวกันสูง/กว้างเท่ากัน (วัด); ไม่มีเลื่อนแนวนอน

- AC-16 All four sold tiers can use existing expense permissions; no ledger/VAT workspace/procurement/CRM/menu activation or posting columns. `ledgerAccountCode` remains unchanged when setting the office mapping.
- AC-17 Mapping errors and excluded/all-excluded exports have the same-screen retry/fallback; UI uses plain Thai labels while exported accounting headings stay exact.
- AC-19 R17: ร้านฟรีไม่สามารถเข้าถึง software export หรือ accountant workbook/ZIP ผ่านเว็บ, URL/API ตรง หรือ LINE; ไม่มีไฟล์/ลิงก์/โมเดล/ค่าใช้จ่าย; stale paid permission ไม่ข้าม commercial guard; ทางกลับร่าง/เมนูเดิมยังใช้ได้ และ paid path ผ่านสิทธิ์เดิม.
- AC-20 R6: software export retains document-month semantics from `8c112ea70` without relaxing CONFIRMED-only selection; no substitution of upload date for an unusual printed date.
- AC-18 Unique mapping, cascade and tenant isolation pass on actual local PostgreSQL; mock-only or skipped results are not evidence.

## 16. Risks / rollout

- FlowAccount เปลี่ยนแม่แบบ → หัวคอลัมน์อยู่ที่เดียวใน contracts; ขั้นจับคู่คอลัมน์ลดผลกระทบ
- นำเข้าซ้ำ (G2) — Q4
- สัดส่วนเอกสารที่ถูก exclude สูง (เช่น ร้านที่หักแบบยอดเงินบ่อย จ่ายหลายงวด) จะทำให้ FlowAccount preset มีประโยชน์น้อย — **Phase 1 จึงมีตัวจำแนก `flowAccountEligibility(record, lines, payments)`** (ฟังก์ชันบริสุทธิ์ ใช้เฉพาะข้อเท็จจริงในมั่งมี: สกุล, รูปหัก ณ ที่จ่าย, การจ่าย, ภ.ง.ด.2, ประเภทผู้รับเงิน, หลายประเภทเงินได้; VAT ใช้ตัวแทนคือ "VAT ที่บันทึก ≠ round2(อัตรา × มูลค่า) ต่อแถว") และบันทึกจำนวนต่อเหตุผลใน audit ของการส่งออกสมุดรายวันซื้อ (`flowAccountIneligibleByReason`) — ข้อมูลนี้ใช้ตัดสินลงทุน Phase 2; Phase 2 ปรับเฉพาะส่วนที่ขึ้นกับผล Phase 0 (วิธีปัด VAT, ค่าที่รับ)
- ไม่มี feature switch: Phase 1 ออกได้หลังสเปกข้อ 25 Phase 1; ตัวเลือก FlowAccount ใส่ในโค้ดเมื่อ Phase 0 ผ่านเท่านั้น
- migration additive; revert โค้ดไม่ต้องลบตาราง

## 17. Open questions (เรื่องธุรกิจ)

- Q1 **resolved by owner ceiling 2026-10-26**: ทุก sold tier ใช้ `expense.export` เดิม; ไม่มีทางเลือกเพิ่ม entitlement หรือเปิด ledger. ไม่ถามซ้ำ.
- Q2 อนุญาตให้ทีมดาวน์โหลดแม่แบบ "นำเข้าบิลและใบเสร็จ" จาก FlowAccount ของบริษัทคุณ (ดูอย่างเดียว) ทดลองนำเข้าใน **บริษัททดลอง** ของ FlowAccount และให้นักบัญชีของคุณดูวิธีบันทึก VAT ที่ใช้สิทธิไม่ได้? — **แนะนำ: ได้** (block เฉพาะ Phase 2)
- Q3 PEAK และ Express: รอให้ลูกค้า/สำนักงานบัญชีที่ใช้ส่งไฟล์แม่แบบ (PEAK) หรือแม่แบบโปรแกรมเสริม (Express) มาก่อน? — **แนะนำ: รอ**
- Q4 ต้องการให้ระบบจำว่ารายการไหน "ส่งออกไปโปรแกรมบัญชีแล้ว"? — **แนะนำ: ยังไม่ต้อง**

**Runner limitation rechecked 2026-11-04:** `grep -c 'src/modules/line-ai/line-ai-capability-manifest.spec.ts' apps/api/package.json` = 0. W00 here means the existing separately invoked frozen-artifact check (`apps/api/src/modules/line-ai/line-ai-capability-manifest.spec.ts:72`), not new API tests or package-suite coverage. New API assertions go only in the registered files named above; no package.json edit. Correction on re-anchor: `thai-date.logic.spec.ts` has no direct registration, but registered `apps/api/src/modules/expenses/domain/logic/expense-export.logic.spec.ts:3` imports and executes it (introduced by `31ad07964`); update existing callers only, with new assertions in registered specs.

## Traceability

R1–R10 keep their existing rule text except the owner ceiling clarification in R8. R11–R16 label the existing data/API/UI/verification rules and the owner wording update. Test names below are planned additions; API paths are relative to `apps/api`. Money, tax and permission tests precede implementation. External primary-source links are retained prior-round research, pending Phase 0 revalidation where stated.

| Requirement | Path covered | Evidence opened (`file:line` + short quote) or primary source | Plan step | Test file + test name | Acceptance | First source document |
|---|---|---|---|---|---|---|
| R1 Confirmed/scoped sources | Paid output; free denied by R17 | `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:321` “request.status ?? 'CONFIRMED'”; `:324` “ctx.scopes” | 1.4 | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “software export defaults to confirmed and respects selected scoped pages” | AC-7 | `docs/agent-memory/accountant-exports.md` F21 |
| R2 Group by account/VAT/effective right/WHT | Paid output; free denied by R17 | `apps/api/prisma/schema.prisma:2950` “vatTreatment”; `:2982` “claimabilitySnapshot”; `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:104` “const split” | 1.3/1.4 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “purchase journal separates VAT rights and mixed withholding groups” | AC-2/AC-3/AC-13/AC-14 | `docs/agent-memory/accountant-exports.md` F5, round 2 F2, R3-F2 |
| R3 Preserve stored money | Paid output; free denied by R17 | `apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts:696` “vatAmount: '21.01'”; `apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts:146` “new Decimal('0.05')” | 1.3 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “purchase journal preserves stored VAT and reconciles header totals within the same VAT group” | AC-2/AC-4 | `docs/agent-memory/accountant-exports.md` F6 |
| R4 WHT base/rate/form | Paid output; free denied by R17 | `apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts:23` “expense.whtInputJson.baseAmount”; `:9` “input.inputType === 'RATE'”; `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts:74` “SEPARATE_PND2” | 1.3/1.4 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “purchase journal keeps explicit WHT base, amount-only rate and PND2 route” | AC-5/AC-13 | `docs/agent-memory/accountant-exports.md` F1/F4/F7/F10 |
| R5 Current document restriction wins | Paid output; free denied by R17 | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:655` “inputVatClaimStatus: input.toStatus”; `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts:139` “source.inputVatClaimStatus !== 'CLAIMABLE'” | 1.3/1.4 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “current document refusal cannot be lifted by a claimable line snapshot” | AC-14/AC-15 | `docs/agent-memory/accountant-exports.md` R3-F2 focused review |
| R6 Dates/text identifiers | Paid output; free denied by R17 | `apps/api/src/common/export/xlsx.logic.ts:251` “[$-107041E]d mmm bbbb”; `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:148` “!== 'unverified'” | 1.3/1.4 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “purchase journal writes date serials and preserves leading-zero tax identifiers”; `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “software export preserves document-month semantics without relaxing confirmed-only selection” | AC-6/AC-20 | `docs/specs/accounting-software-export-spec.md` R6 |
| R7 THB only | Paid output; free denied by R17 | `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:169` “currency: input.currency ?? 'THB'” | 1.3/1.4 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “foreign currency is excluded without converting the stored amount” | AC-10 | `docs/agent-memory/accountant-exports.md` F3 |
| R8 Sold permissions/no switch | Paid output; free denied by R17 | `packages/contracts/src/menu-entitlements.ts:497-500` “FEATURE_PACKAGE_PRESETS.starter.featureKeys”; `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:318` “expense.export” | 1.1/1.4/2.2 | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “all sold tiers export with existing expense permissions and no ledger entitlement” | AC-16 | `docs/agent-memory/accountant-exports.md` 2026-10-26 owner ceiling |
| R9 Vendor row limits / whole documents | Paid output; free denied by R17 | [FlowAccount expense import](https://flowaccount.com/help-center/category/expense/import-expense) (prior-round research; exact template pending) | 0/2.1 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “FlowAccount splits at 500 rows without splitting a document and excludes over-300-row documents” | AC-9 | `docs/specs/accounting-software-export-spec.md` §1.2 |
| R10 No silently unrepresentable output | Paid output; free denied by R17 | `apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts:9` “: null”; `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts:111` “payment.paidAtConfirmed” | 1.3/1.4/2.1 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “FlowAccount exclusions preserve whole-document tax and payment facts”; `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “all-excluded exports return no files and explain each document” | AC-4/AC-8/AC-10 | `docs/agent-memory/accountant-exports.md` F17/F19 and round 2 F6/F15 |
| R11 Per-shop office mapping, historical categories, additive schema | Paid output; free denied by R17 | `apps/api/prisma/schema.prisma:2578` “String?”; `:2588` “ledgerAccountCode”; `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:507` “return companyCategories” | 1.1/1.2 | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “office mapping allows referenced hidden categories without changing ledger codes”; `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` — “office mappings are unique per shop, tenant isolated and cascade on category deletion” | AC-1/AC-16/AC-18 | `docs/specs/accounting-software-export-spec.md` §6; `docs/agent-memory/accountant-exports.md` F20 |
| R12 Plain Thai UI/states/same-screen fallback | Free + paid; source/denial and regression | `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:220` “taxCodeSelect”; `apps/web/src/features/expenses/ExpensesPages.tsx:3010` “ThemedSelect”; `docs/guidelines/thai-ux-standard.md:22` “a way out on the same screen” | 1.5/2.2 | `apps/web/src/features/expenses/CategoryManagePanel.spec.ts` — “office mapping keeps input and offers retry”; `apps/web/src/features/expenses/ExpenseList.rendered.spec.ts` — “export format and exclusions use plain Thai with an accountant-file fallback”; `apps/web/src/features/expenses/EvidencePanel.qa.spec.ts` — “no-manage users can choose a usable export on the same screen” | AC-12/AC-17 | `docs/specs/accounting-software-export-spec.md` §10; `docs/agent-memory/accountant-exports.md` 2026-10-26 owner wording |
| R13 Prove FlowAccount before exposing preset | Paid output; free denied by R17 | [FlowAccount expense import](https://flowaccount.com/help-center/category/expense/import-expense) (prior-round public constraints; logged-in template not obtained) | 0/2.1/2.2/2.3 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “FlowAccount fixture matches the verified template and supported payment pairs”; manual nine-case test-company import recorded in memory | AC-8 | `docs/specs/accounting-software-export-spec.md` §1.2/§7.4 |
| R14 Tenant/permissions/audit/input validation | Free + paid; source/denial and regression | `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:746` “expense.category.manage”; `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts:320` “isBranchInScope” | 1.1/1.2/1.4 | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “mapping and exports enforce tenant scope permissions and audit”; `src/modules/expenses/presentation/http/expense.dtos.spec.ts` — “office mapping rejects formula prefixes and controls anywhere in values” | AC-1/AC-7/AC-16/AC-18 | `docs/specs/accounting-software-export-spec.md` §8; memory F33 |
| R15 File terminology/privacy; no unsold dependency | Paid output; free denied by R17 | `apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:261` “HYPERLINK”; `packages/contracts/src/menu-entitlements.ts:500` “wht_50bis” | 1.3/1.5 | `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — “software export contains office headings without URLs IDs or posting fields”; `apps/web/src/features/expenses/ExpenseList.rendered.spec.ts` — “technical accounting names remain inside the downloaded file” | AC-6/AC-16/AC-17 | `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` items 13/25; owner 2026-10-26 |
| R16 Integration proof | Free + paid; source/denial and regression | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts:415` “real PostgreSQL”; `e2e/journeys/evidence-and-settings.journey.spec.ts:69` “pressForDownload” | 1.6/2.3/3 | `e2e/journeys/evidence-and-settings.journey.spec.ts` — “office mapping survives reload and exported totals match at 390, 1280 and 1556”; existing W00 manual check, no new assertions there | AC-11/AC-12/AC-18 | `docs/guidelines/thai-ux-standard.md`; `docs/specs/accounting-software-export-spec.md` §14 |
| R17 Free shops cannot use either export | Free + paid; source/denial and regression | `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:76` “return false”; `apps/api/src/modules/expenses/application/expense-commercial-access.ts:24` “FREE_EXPENSE_DRAFTS_ONLY”; `apps/web/src/features/expenses/expenses.model.ts:1632` “!freeExpenseDrafts” | cleanup 0.2; 1.4/1.5/1.6 | `src/modules/auth/auth.guard.spec.ts` — “free draft mode denies both export routes and bundle parts”; `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` — “software export rechecks free access before loading rows”; `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — “free export requests remain model-free with a menu exit”; `e2e/journeys/evidence-and-settings.journey.spec.ts` — “free shops cannot open either export at 390, 1280 and 1556” | AC-19 | `docs/specs/free-expense-drafts-spec-th.md` §4/D04; this spec §0.2 |
