# Agent Memory: WHT settlement capture (จ่ายหัก ณ ที่จ่าย + ถูกหักตอนรับ)

Status: PHASE 1 + 2 DONE + ปิด blocker หมวดเงินได้ + e2e A1/B1 ผ่านจริง — commit ในเครื่อง, ยังไม่ push
Owner: Finance/Accounting lane (สั่งงานโดย owner: "focus ข้อ 1–2 ทำ spec+plan มอง gap/bug/impact รอบ ๆ ให้ถี่ถ้วน")
Scope: `docs/specs/wht-settlement-capture-spec.md` + `docs/plans/wht-settlement-capture-plan.md` — Phase 1 supplier payment WHT (RA-20 payment seam), Phase 2 accounting receivable WHT (RA-22 settlement+GL)

## Decisions (ล็อกแล้ว — รายละเอียดในหัวข้อท้าย plan)

1. `allocations[].amount` = ยอดตัดหนี้ (รวม WHT); ฟิลด์เงินสด (`netPaidAmount`, `AccountingPayment.amount`) คงความหมายเดิมเพราะ bank rec + PP36 proration + void restore พึ่งอยู่
2. Validation ฝั่งจ่ายสลับจาก `Σ alloc == netPaid` → `Σ alloc == gross` (backward-compat เมื่อ wht=0)
3. WHT ไม่ยกเป็น `TaxComponentKey`; posting-rule ขยาย field เดียว `mappingJson.whtAccountCode`, ไม่มี → fail closed `posting_rule_missing`
4. formType จาก `supplierType` (INDIVIDUAL→PND3, JURISTIC_PERSON→PND53, อื่น→PND53 fallback); ฐานเงินได้ = round2(wht ÷ rate%) เพราะ payment gross รวม VAT
5. Void: WHT tax events → REVERSED (pattern PP36), handoff REQUIRED → CANCELLED, handoff ผูกหนังสือรับรองแล้ว → block void
6. ไม่แตะ TH SME COA catalog (checksum machinery); ฝั่งรับ นักบัญชีเพิ่ม/เลือกบัญชีภาษีถูกหักเอง
7. หมวดเงินได้หน้า AP ผ่าน endpoint ใหม่ guard `procurement.supplier_payment.read` (ของเดิมติด `tax.config.read`)

## Bugs/gaps ที่ discovery ยืนยัน (แก้ใน plan นี้)

- `buildSupplierPaymentPostingSource` ฮาร์ดโค้ด `whtTotal:'0'`, totalAmount=net → GL ผิดถ้าจ่ายแบบหักผ่าน API วันนี้
- ไม่มีโค้ดไหนเขียน `WhtHandoffStatus.CANCELLED` → void ทิ้ง handoff ค้าง REQUIRED
- WHT tax event มาจาก expense เท่านั้น (`accounting-payment-source.adapter.ts` เป็น stub)
- `resolvePostingLinesFromRule` 2 บรรทัด gross — บริษัท template (รวม seed) แสดง journal มี WHT ไม่ได้
- `AccountingPayment`/allocation ไม่มีฟิลด์ WHT; `WHT_RECEIVABLE 1270-00` ประกาศแต่ไม่เคยใช้; ผัง TH SME ไม่มีบัญชีภาษีถูกหักฝั่งรับ (มีแต่ 2132-03/04 ฝั่งจ่าย)

## Phase 1 — สิ่งที่ตัดสินเพิ่มระหว่างทำ (ไม่อยู่ใน spec เดิม)

1. **Migration เดียวครอบ Phase 1 + Phase 2** (`20260805120000_wht_settlement_capture`) — owner สั่ง "เก็บข้อมูลไว้แม้ไม่ได้โชว์ เพื่อไม่ต้อง migrate อีก"; คอลัมน์ฝั่งรับ (`AccountingPayment.whtAmount`, `AccountingPaymentAllocation.whtAmount`) ลงแล้วแต่ยังไม่มีโค้ดใช้จนกว่า Phase 2
2. **`deriveWhtIncomeBase` อยู่ที่ `tax/domain/logic/wht-report.logic.ts`** และ procurement import เข้ามา — ทิศทาง procurement → tax มีอยู่แล้ว (handoff use case); แชร์เพราะ 50 ทวิ กับ ใบแนบ ภ.ง.ด. ต้องรายงานฐานเงินได้ตัวเดียวกัน
3. **Endpoint ใหม่ `GET accounts-payable/wht-income-categories`** guard `procurement.supplier_payment.read` (ของ tax ติด `tax.config.read` ซึ่งคน AP ไม่มี) — คืน ACTIVE เท่านั้น
4. **`VendorBillSummary` เพิ่ม `taxableAmount` + `whtAmount`** — API ส่ง `VendorBillRecord` เต็มอยู่แล้ว contract แค่แคบกว่าความจริง ไม่ใช่ API surface ใหม่
5. **ไม่เพิ่ม permission ใหม่สำหรับ void ที่มี WHT** — ต่างจาก PP36 ที่ขอ `tax.review_issue.resolve`; spec ไม่ได้กำหนด และการเพิ่มอาจบล็อกคนการเงินที่ไม่มีสิทธิ์ภาษี ตัวกั้นจริงคือ period lock + certificate-linked guard
6. **ไม่แตะ `SupplierPayment.taxSyncStatus`** — ตรวจแล้วไม่มีโค้ดไหนเลื่อนเป็น `synced` (ทั้ง vendor bill และ payment) ตั้ง `pending` จะได้สถานะค้างถาวรที่แย่กว่า `not_required`
7. **UI เสนอยอดหักเฉพาะตอนจ่ายเต็ม outstanding** — จ่ายบางส่วนไม่มีคำตอบเดียวว่างวดนี้ครอบฐานภาษีเท่าไร ให้กรอกเอง; มีข้อความอธิบายเมื่อปุ่มถูก disable

## บั๊กที่เจอระหว่างรีวิวตัวเองและแก้แล้ว

- เทสต์เดิม `payment-posting-source.use-case.spec.ts` **encode บั๊กไว้** (assert ว่า AP debit = netPaid ทั้งที่ปิดหนี้ gross) — เขียนใหม่ให้ยืนยันพฤติกรรมที่ถูก
- mock ของ `pp36-payment-reversal.repository.spec.ts` ไม่มี `whtCertificateHandoff` และ `taxEvent.findMany` ไม่สน `where` → query WHT ใหม่จะได้ row ของ PP36 มาด้วย; แก้ให้ตอบตาม sourceType
- handoff cancel เดิมยิงทุกครั้งที่ void; ใส่ guard `whtAmount > 0` (มีเฉพาะ payment ที่หักเท่านั้นที่มี handoff ได้)

## Phase 2 — สิ่งที่ตัดสินเพิ่มระหว่างทำ

1. **`AccountingPayment.amount` ยังเป็นเงินสดเสมอ** — bank reconciliation จับคู่ด้วยฟิลด์นี้; ยอด settle = `amount + whtAmount` คำนวณตอนใช้ ไม่ยัดรวมในคอลัมน์เดียว
2. **Re-check `cash + wht <= outstanding` ใน transaction** ที่ repo (อ่าน outstanding ใหม่) — use-case validate จาก read นอก tx ซึ่งสอง receipt พร้อมกันจะผ่านทั้งคู่แล้ว over-settle; เงินสดล้วนยัง clamp เป็น unapplied credit ได้เหมือนเดิม (เราถือเงินจริง) แต่ส่วนที่ถูกหักทำไม่ได้
3. **CRM LTV (`sumReceivedPaymentsByCounterparty`) = Σ(amount + whtAmount)** — ลูกค้าจ่ายจริงเท่ายอดที่ settle ภาษีที่หักไปก็เป็นเงินของเขาที่ส่งกรมสรรพากรแทนเรา ถ้านับแต่เงินสดจะต่ำกว่าจริงทุกรายที่หักภาษี
4. **เลข 50 ทวิ ที่ลูกค้าออกให้ เก็บที่ `externalReference` ที่มีอยู่แล้ว** — ไม่ต้องเพิ่มคอลัมน์/migration (ตรงกับคำสั่ง "เก็บข้อมูลไว้แม้ไม่ได้โชว์"); ฟอร์มรับชำระโชว์ช่องนี้เมื่อมียอดถูกหัก
5. **ฝั่งรับไม่สร้าง tax event** — เราเป็นผู้ถูกหัก หน้าที่ยื่น ภ.ง.ด. เป็นของลูกค้า; `accounting-payment-source.adapter.ts` คงเป็น stub พร้อมคอมเมนต์อธิบายเหตุผล
6. **prefill ยอดถูกหักจาก `doc.whtAmount` เฉพาะตอน `paidAmount === 0`** และ seed ครั้งเดียวต่อเอกสาร (useRef) เพื่อไม่ให้ค่าที่ผู้ใช้แก้เด้งกลับ
7. **`grandTotalAmount` ของเอกสารขายไม่หัก WHT** (ต่างจาก expense ที่มี `netPayableAmount`) — ลูกค้าเป็นหนี้เต็มจำนวน แล้ว settle ด้วยเงินสด + ภาษีที่หัก; outstanding จึงถูกต้องโดยไม่ต้องแก้สูตร

## Blocker ที่เจอตอนรัน e2e และปิดแล้ว (2026-08-05)

**หมวดเงินได้เปิดใช้งานไม่ได้เลย** — `WhtIncomeCategory` มี seed เป็น writer ตัวเดียวและเขียน DRAFT ทุกแถว; ไม่มี endpoint/UI/permission guard ไหนเลื่อนเป็น ACTIVE ได้ → dropdown ฝั่งจ่ายว่างตลอดกาล ฟีเจอร์ Phase 1 ใช้จริงไม่ได้เลย ปิดด้วย:

- `PATCH tax/wht-categories/:code` guard `tax.config.manage` (permission มีอยู่แล้ว แต่ก่อนหน้านี้ไม่ guard อะไรของตารางนี้) + audit HIGH เพราะเป็นการรับรองอัตราตามกฎหมายที่ certificate ทุกใบสืบทอด
- panel ในแท็บ WHT ของหน้า Tax ให้ผู้ทำบัญชีกดเปิด/คืนเป็นร่าง พร้อมนับ "เปิดใช้งานแล้ว N จาก 15"
- use-case ฝั่งจ่าย validate ว่า `whtCategoryCode` มีจริงและ ACTIVE (`findActiveWhtIncomeCategory`) — เดิมรับ string อะไรก็ได้ ซึ่งจะพิมพ์หมวดที่ไม่มีจริงลง 50 ทวิ
- แก้ type `WhtCategory` ใน web: เดิมประกาศ `descriptionTh` ซึ่งไม่เคยมีบน wire (คอลัมน์จริงคือ `nameTh`) จึง render ไม่ได้

## Open questions

- ไม่มีที่ block — FOREIGN supplier (ภ.ง.ด.54) ตกเป็น PND53 fallback ตาม spec §3/§6.4 ถ้า owner ต้องการเข้มกว่านี้ค่อยยก scope ใหม่

## Artifacts

- `docs/specs/wht-settlement-capture-spec.md` (acceptance A1–A7, B1–B5, C1–C2)
- `docs/plans/wht-settlement-capture-plan.md` (Phase 1→2→3 + verify commands)
- pointer เพิ่มใน `accounting-tax-readiness-assessment.md` (RA-20/RA-22) + master checklist Reorder Log

## Verification (Phase 1, 2026-08-05 — รันจริงทั้งหมด)

- `pnpm --filter @watchdog-bms/contracts build` ผ่าน
- `pnpm --filter @watchdog-bms/api lint` (tsc --noEmit) ผ่าน
- `pnpm --filter @watchdog-bms/api test` exit 0 (255 spec files)
- `pnpm --filter @watchdog-bms/web typecheck` ผ่าน; `pnpm --filter @watchdog-bms/web test` 697/697
- `prisma migrate deploy` บน local Postgres (docker-postgres-1, :15432) สำเร็จ; `migrate status` = up to date; ยืนยันคอลัมน์จริงด้วย `\d` ทั้ง `SupplierPayment` (whtCategoryCode/whtRate), `AccountingPayment` (whtAmount NOT NULL DEFAULT 0), `AccountingPaymentAllocation` (whtAmount nullable)
- spec ใหม่ที่เพิ่มเข้า list `apps/api/package.json` "test": `sync-tax-events-supplier-payment-wht.use-case.spec.ts`, `supplier-payment-source.adapter.spec.ts`, `wht-payment-posting.logic.spec.ts`
- **ยังไม่ได้รัน**: e2e (`accounts-payable.spec.ts` ไม่ได้แตะฟอร์มจ่าย จึงไม่กระทบ แต่ยังไม่มี scenario A1/A3 ใน e2e)

## Verification (Phase 2, 2026-08-05)

- `pnpm --filter @watchdog-bms/api lint` ผ่าน; `pnpm --filter @watchdog-bms/api test` exit 0
- `pnpm --filter @watchdog-bms/web typecheck` ผ่าน; `web test` 697/697
- `prisma migrate status` = up to date (คอลัมน์ฝั่งรับลงไปพร้อม migration ของ Phase 1 แล้ว ไม่มี migration ใหม่)
- เทสต์ที่เพิ่ม: money validation (8 เคส), posting ฝั่งรับ (2), posting source ฝั่งรับ (1), void restore คืนทั้งเงินสดและส่วนที่ถูกหัก (1)
- e2e `e2e/wht-settlement.spec.ts` — A1 และ B1 **ผ่านจริง** บน Postgres/Redis จริง (docker local) + API build จริง + Next dev
- เดินหน้าจอจริงครบทั้งสองเส้นทาง (temp walkthrough spec, ลบแล้ว): เปิดหมวด → กรอกหักที่หน้า AP → บันทึกจ่าย; และออกใบแจ้งหนี้ระบุอัตรา → รับชำระแยกเงินสด/ภาษีถูกหัก → PAID. เจอและแก้ layout ล้นของช่องเลข 50 ทวิ ในการ์ดรับชำระ

## Next

1. ก่อน deploy: audit query `SupplierPayment.whtAmount > 0` ใน UAT/prod (spec §11) — payment เก่าที่หักภาษีเคยลง journal แบบ net-only ผิด
2. คู่ขนาน (นอก scope โค้ด): นักบัญชี activate `WhtIncomeCategory` — ฟีเจอร์ฝั่งจ่าย unusable จนกว่าจะมีหมวด ACTIVE (UI แสดงคำแนะนำแล้ว)
3. บริษัทที่ใช้ผังบัญชี template ต้องเพิ่มบัญชี "ภาษีถูกหัก ณ ที่จ่าย" (ผัง TH SME v1 มีแต่ฝั่ง payable 2132-03/04) แล้ว map `whtAccountCode` ใน PostingRule ก่อนลงบัญชีการรับชำระที่ถูกหัก
4. ยังค้างตาม spec §3: CIT credit report จากยอด WHT receivable, bill-carried WHT → ภ.ง.ด. event, เปิด gate `cap.wht50bis`

## โฟกัส บิล + การเบิกจ่าย (2026-08-05 ช่วงบ่าย — คำสั่ง owner "ตอนนี้โฟกัสแค่ บิล เบิกจ่ายก่อน")

ตรวจความพร้อมใช้จริงสองโมดูลด้วย e2e ที่มีอยู่ + เดินหน้าจอ พบและแก้ 3 บั๊กที่บล็อกเส้นทางหลักของการเบิกจ่าย (ฝั่งบิล ACCT-01..05 เขียวตั้งแต่แรก):

1. **OWNER อนุมัติใบเบิกไม่ได้ + คิวอนุมัติว่างเปล่า** — regression จาก `a3fb68cc` (A5 hardening, 2026-08-04): eligibility เข้มขึ้นเป็น "ต้องถือ role ตรง `approverRoleSnapshot`" ซึ่ง default = MANAGER แต่เจ้าของถือแค่ OWNER → บริษัทใหม่ไม่มีใครอนุมัติได้เลย แก้ด้วย `matchesApproverRole` (role ตรง หรือ OWNER; step ที่ระบุตัวบุคคลยังเข้มเท่าเดิม) ใช้ร่วมทั้ง use-case และ repo re-check
2. **ใบเบิกไม่มีสาขาผ่าน finance review ไม่ได้** — `toRequest` แปลง branch NULL → undefined แต่ `buildItems` → null, guard เทียบ strict → 409 `reimbursement_projection_source_changed` ทุกครั้ง แก้ด้วย normalize สองข้างเป็น null
3. **ใบเบิกที่มีบรรทัดไม่มีใบเสร็จตายที่ finance review** — gate ใบแทนใบเสร็จ (เพิ่มใน f68dba77/dbe056d2) บังคับ artifact ISSUED กับทุก expense ที่มี `missingReceiptReason` รวมถึง projection จากใบเบิก ซึ่งสร้าง artifact ใน tx นั้นไม่ได้เลย — ขัดกับ `allowMissingReceiptWithReason` ที่ authority ส่งมาเอง แก้ทั้งสองชั้น (use-case gate + repo CAS `substituteCoveredByClaimForm`): confirm ใต้ authority ของใบเบิกใช้ใบเบิกที่ลงลายเซ็นเป็น instrument; expense ที่เข้าเส้น substitute-receipt จริงยังต้องมี artifact เหมือนเดิม

Verification: api test exit 0, web typecheck ผ่าน, e2e accounting+reimbursements+wht = 12 passed / 1 skipped (REIMBRCPT-01 ต้องการ MinIO :19000 + S3_E2E=1 — environmental by design), เดินหน้าจอครบ: คิวอนุมัติแสดงรายการ → อนุมัติ → คิวการเงิน → อนุมัติจ่าย → modal บันทึกจ่าย → PAID (screenshots ใน scratchpad shots/8,9,10a,10)
