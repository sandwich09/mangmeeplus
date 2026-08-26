# Agent Memory: mangmee-income-expense-ledger

Status: Spec v1.3 + plan ACTIVE — **Phase 1–2 เสร็จ; Phase 3A backend เสร็จ 2026-08-26; ต่อไป Phase 3B UI**: atomic simple-income INVOICE→payment/allocation→evidence-only RECEIPT + command idempotency/fingerprint + composite permissions + in-tx audit; correction reason/source backend + attachment purposes; migration `20260826210000_simple_income_and_adjustment_reason`

Owner: thawatchai (Product Owner) + Lead dev 1 คน

Scope:

- ฟีเจอร์ "สมุดรายรับ–รายจ่าย" MVP (P27 ของแผนหลัก — **คิวหลักก่อนสาย P14→P26** ตามคำตอบ Owner ข้อ 1): เอกสารขายเป็นแกนรายรับ (ห่อ `AccountingDocument`/`AccountingPayment` เดิม), รายจ่ายใช้ engine เดิม, หมวดหมู่ 2 ชุด, หน้าสรุป + export, ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount — ไม่ทำธนาคาร/statement/กระทบยอด/Auto Revenue/ภาษียื่น/งบทางการ/สต็อก
- หลักฐานโค้ดจาก `develop` @ `beb0c5f6`; หลักฐาน FlowAccount จากบัญชีทดสอบ Owner (`advance.flowaccount.com/N9355777`, read-only, 2026-08-26)

Decisions:

- คำตอบ Owner §9 (2026-08-26): 1=P27 ก่อน billing, 2=auto-RECEIPT ทุกครั้ง, 3=ซ่อน VAT บริษัทไม่จด, 4=ใบลดหนี้เลียนแบบ FlowAccount, 5=ใช้ pattern ตาราง mapping taxcode เดิม ([expense-category-default-tax-code-spec](../specs/expense-category-default-tax-code-spec.md) v1.1 Implemented — external code ไม่มี FK; ค่า default หมวดรายรับ = null จนยืนยันกับ tax-2026-verified-rules), 6=ยืนยันชุดคำ 6 ตัวเลข
- Owner รอบสอง (2026-08-26): 7=spec ต้องรวมสเปกหน้าจอ specialist UX/UI ("ไม่เปิดก่อนให้กดแล้วเจอ error ตามหลัง") → spec §F-LED-7 (หลักการ 6 ข้อ, action-gating matrix, S1–S5, สถานะกลาง); 8=VAT ต่อหมวดกันเคส "คิด VAT 7 ที่ผัก" → spec §7.9: default VAT ต่อบรรทัดมาจากหมวดเท่านั้น (O7/OX/O0/ไม่กำหนด=บังคับเลือก) ห้ามเดา, ธุรกิจขายของยกเว้นเพิ่มหมวดแยกตาม tax behaviour, Owner ส่งแหล่งอ้างอิงรายการยกเว้น 28 ข้อ (rpacc.co.th, ม.81) — ค่า production รอนักบัญชีผ่าน tax-2026-verified-rules; ฝั่งรายจ่ายเคสผักปิดแล้ว (VAT-MIX-01 golden ข้อ 3); gap ใหม่ LED-FIN-06 (line แยกยกเว้น/0% ไม่ได้ด้วย vatRate เดียว → ห้ามโฆษณา ภ.พ.30 ฝั่งขาย)
- Owner รอบสาม (2026-08-26): **เป้าหมายรวม = FlowAccount parity ทั้งฝั่งขาย-รับเงิน และ ซื้อ-จ่ายเงินครบสาย** → บันทึกเป็น P28 ในแผนหลัก (spec-first แยกก่อน implement); current truth: procurement engine มีเกือบครบ (supplier/PR/PO/GR/vendor bill maker-checker+tax+void/supplier payment/AP aging/ภ.พ.36) แต่ web hub เดียว+ซ่อนจาก nav; gap หลัก: **ใบลดหนี้ฝั่งซื้อไม่มี** (vendor bill แก้ได้ด้วย void เท่านั้น) + ยังไม่รวมเข้าสมุดฝั่งจ่าย
- PR #238 review (Owner submit 2026-08-26): 3 P1 แก้ครบใน PR #251 (merged develop) — T0 golden baseline gate ที่ intersection ยืนยัน∩มีผล, T1 fallback fail-closed ก่อนส่ง, T2 get_summary เป็น groupBy เดียว snapshot-consistent; ตอบ+resolve ทั้ง 3 thread แล้ว; ข้อเรียกร้อง (2)-(4) ของ review = งาน UAT-phase ใน manifest
- ไม่สร้างตารางรายรับแยก (REVENUE-02); invariant "รับชำระไม่ลงรายได้/VAT ซ้ำ" โค้ดบังคับแล้ว ห้าม regression
- V1: `counterpartyId` nullable จริงทุกชั้น → **ไม่สร้าง row "ลูกค้าเงินสด"** (ไม่มี unique fence กันซ้ำ); UI ใช้ label "ลูกค้าทั่วไป (ขายเงินสด)"; payment/เอกสารต้อง match counterparty (null↔null ผ่าน)
- V6: **ห้าม chain use-case เดิม** → `recordSimpleIncomeBundle` repository method เดียว (Serializable tx + advisory lock + เลขสามชุด + audit ผ่าน tx) ตามแบบ `submitDraftAtomic`; `AccountingSimpleIncomeCommand` จำผลครบก้อน+payload fingerprint; PostgreSQL waiter อาจได้ P2034 แม้มี advisory lock จึง bounded-retry แล้วอ่านผู้ชนะ
- Auto-RECEIPT ใช้ `postingStatus=not_required`: `AccountingPayment` เป็น canonical settlement posting source; ถ้า receipt pending ด้วยจะเดบิตเงินสด/เครดิต AR ซ้ำ
- Plain INVOICE ไม่รับ transaction-tax code/snapshot ตาม engine; เก็บยอด VAT ต่อบรรทัดได้ แต่ immutable tax snapshot เกิดตอน TAX_INVOICE เท่านั้น — แก้คำสัญญาเดิมใน spec/plan แล้ว
- Correction source = TAX_INVOICE หรือ INVOICE เฉพาะ source+correction non-VAT; reason codes validate แยก CREDIT/DEBIT ตาม ม.82/9–82/10 + ประกาศอธิบดีฯ VAT ฉบับ 82; `OTHER_PRESCRIBED` ต้องมีรายละเอียด
- V3: RECEIPT ตั้ง `sourceDocumentId` ได้ (engine ตรวจ existence เท่านั้น) → auto-receipt ใน bundle; `taxInvoiceId` เป็น dead metadata
- F-LED-6 (FlowAccount findings): CN มี 2 ทางสร้าง (แยก/อ้างใบกำกับภาษี), สาเหตุบังคับตามรายการกฎหมาย 2 กลุ่ม, โมเดลมูลค่าเดิม→ถูกต้อง→ผลต่าง, ขายเงินสด = "ใบเสร็จรับเงิน (เงินสด)" ใบเดียวเลขชุด CA- → เรา: ขยาย CN/DN ให้อ้าง INVOICE ที่ issue แล้วได้ + M5 (`adjustmentReasonCode/Text`) + prefill จาก source; **ไม่ทำ CN แบบไม่อ้างเอกสารใน MVP**; รายการสาเหตุต้องตรวจกับต้นทางกรมสรรพากรก่อน copy
- หมวดรายรับ `RevenueCategory` company-scoped เท่านั้น (เลี่ยงบั๊ก NULL-distinct ฝั่ง expense); STOP-SHIP = LED-FIN-01 (float ใน `accounting-totals.logic.ts`); gap ใหม่ LED-FIN-05 (AI sales summary ไม่นับ payment ไม่มีลูกค้า — ปรับใน Phase 4)
- เปิดแบบ per-company allowlist: `PUT /v1/system/partners/:id/features` (V5 — CAS + normalization gate; off/on/off มี test พิสูจน์ epoch bump)

Open questions: — (ไม่มี; ทุกข้อปิดแล้ว)

Artifacts:

- `docs/specs/mangmee-income-expense-ledger-spec-th.md` v1.3 (Phase 3A evidence + M7 + correction source/reason truth + receipt posting invariant)
- `docs/plans/mangmee-income-expense-ledger-plan-th.md` ACTIVE ฉบับเต็มตามเดิม (Phase 0–2 ✅); คิวรวมสองฝั่งอยู่ที่ `docs/plans/mangmee-master-plan-index-th.md` — **สารบัญอย่างเดียว** (Owner 2026-08-26: "รวมแค่หัวข้อ แล้วมี link กลับไปที่เอกสารเดิม" — เคยรวมเนื้อหาเต็มในไฟล์เดียวแล้วถูกสั่งปรับกลับ)
- `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md` P27 + §10/§11 อัปเดตคิวตัดสินแล้ว
- PR #245 (docs ชุดแรก merged); PR ถัดไป = ชุดคำตอบ+Phase 0 นี้

Verification:

- หลักฐานโค้ดทุกข้อมี file:line จาก Explore agents (2026-08-26); FlowAccount ตรวจ read-only ไม่มี mutation ใด ๆ (ไม่กดบันทึกเอกสาร/ไม่รับ cookie banner แทนผู้ใช้)
- Phase 1 (branch `codex/ledger-p1-decimal`): specs ทั้ง module accounting-documents ผ่าน 144/144 (61+83 รวม golden ใหม่ 8 และ `spec-suite-coverage` guard); `tsc --noEmit` apps/api เงียบ; เอกสารเดิมไม่ถูกกระทบ — totals คำนวณเฉพาะตอน create/update draft ไม่มี migration/rewrite แถวเดิม และ `sales_documents` ปิด default ทุก env (DB seeded local ไม่ได้รัน จึงไม่มี count query — บันทึกตามจริง); ไม่มี spec เดิม exercise `createPayment` ตรง ๆ → เคส in-tx numbering คุมด้วย E2E LED-02 ใน Phase 6
- Phase 3A focused: 94 discovered; 92/92 non-PostgreSQL ผ่าน และ real PostgreSQL bundle 7/7 ผ่าน: reason/source rules, DTO, composite permission, VAT-registration guard, in-tx audit/no replay events, attachment purposes, atomic tax issue regression; late-audit failure rollback เหลือ 0 rows, 6 concurrent same-key callsได้ invoice ID เดียว/ผู้ชนะหนึ่ง, command 1/payment 1/allocation 1/docs 2/เลข COMMITTED 3, WHT 3 → cash 97 → invoice paid 100, receipt evidence-only; mixed 7%+0% = taxable 200/VAT 7/total+payment+receipt 207
- Prisma format/validate/generate + contracts build + API typecheck + `test:boot` ผ่าน (Nest resolve provider ครบ); local migration deploy ผ่าน และ fresh PostgreSQL database ใช้ migration ทั้ง 152 ตัวจากศูนย์ผ่านก่อนลบทิ้ง
- Full API `pnpm test` ผ่านทั้ง pretest/test; ระหว่าง verify พบ P11 observability evidence token เก่าที่อ้างหัวข้อซึ่งเปลี่ยนชื่อแล้ว จึงแก้ catalog ให้ชี้ `F-EM-2 Durable send ผ่าน outbox` และยืนยัน suite เขียวรอบถัดไป

หมายเหตุ spec-batch (2026-08-26): ตามคำสั่ง Owner "เขียน spec ที่เหลือให้ครบ" — เขียน 8 ฉบับใหม่ในวันเดียว: P10 external-signup, P11 email-claim, P12 line-login-link-journey (ฉบับรวม — มติเปิด line/exchange), P13 line-multi-company-staff, P15–P17 revenue-inbox-matching (ฉบับเดียว 3 หัวข้อ), P21 tax-workpaper-pp30, P24 growth-ux-full-pass, P26 billing-subscription (ราคารอ Owner); ทุกฉบับอิง Explore agents 3 ชุด (P26 billing / auth-LINE-signup / banking-tax) + แผนหลัก §13.5-13.6; matrix ในแผนหลักติ๊กครบ เหลือ P18–P20 ตั้งใจรอ provider

Next:

1. Phase 3B: หน้า "บันทึกรายรับ" mobile-first 2 โหมด + VAT ต่อบรรทัดจากหมวด/สถานะ VAT บริษัท + success path; source-first CN/DN UI
2. Phase 4 หน้าสมุด+export → Phase 5 จัดหมวดรายจ่ายซ้อน → Phase 6 เปิดระบบ/E2E/หลักฐาน
3. หมายเหตุข้ามงาน: PR #238 (release รอบก่อน develop→main) CI เขียวครบ ยังรอ Owner approve+merge → แล้วผม dispatch UAT ตาม runbook
