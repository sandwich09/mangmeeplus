# Agent Memory: company-tax-identity-setup

Status: SPEC+PLAN **v2.9** 2026-08-04 — review 10 รอบ; v2.9 ปิด P0×4 + P1×1 ของรอบสิบ (RD field semantics, as-of correction, exact-build rollout, legacy VAT proxy, replay DTO)
Implementation: **Release A กำลังทำเป็นชิ้น ๆ** — A1 (contracts + permissions) DONE · A2 (schema + migration + PG gate) DONE · A3a (fingerprint + identity change-kind rules) DONE · A3b (VAT interval facts) DONE · เหลือ A3c (generator/resolver/reports), A4 (endpoints + RD + wizard), A5 (issue atomicity)

A3a/A3b ที่ลงแล้ว (domain ล้วน ไม่มี I/O): `apps/api/src/common/security/canonical-fingerprint.ts` (§12.1 + golden vectors) · `.../data-model-core/domain/logic/company-legal-identity.logic.ts` (§4.3 capture window/latch/changeKind + §12 validation + checksum เป็น warning) · `.../company-vat-registration.logic.ts` (§5.3 accessor tri-state + planVatFactChange + CANCEL_FUTURE restore + filed-period overlap)
**หลักฐาน A3**: unit 22 + 16 ผ่าน; ทุก spec ลงทะเบียนใน apps/api test list แล้ว

A2 ที่ลงแล้ว: migration `20260804180000_company_tax_identity_step0` (9 ตาราง, Company +16, Branch/counterparty/document/TaxEvent, 14 enums, partial unique ของ item, backfill 3 ชุด) · `test:tax-identity-pg` hard-fail เมื่อไม่มี DB + CI step ที่สร้าง DB ใหม่แล้ว `migrate deploy` (= fresh-clone check) · onboarding สร้าง HO เป็น establishment + VAT state v0 ใน txn เดียว · parity registry ลง 14 คู่
**หลักฐาน A2**: fresh-clone `migrate deploy` ผ่านบน DB เปล่า · `test:tax-identity-pg` 7/7 (รวม session TZ = Asia/Bangkok) · ไม่มี DATABASE_URL → exit 1 · onboarding spec 21/21 · contracts 89/89
**ข้อควรรู้**: `CompanyTaxProfile.vatEffectiveDate` ไม่มีโค้ดไหนเขียนเลย → backfill 3 ปัจจุบัน seed ศูนย์แถวจริง (เก็บไว้สำหรับข้อมูลที่กรอกมือ) · Branch/HO partial unique ยังเป็นของ B1 ตาม §6.3

A1 ที่ลงแล้ว: `packages/contracts/src/{civil-date,buyer-snapshot-v1,company-tax-identity}.ts` + specs; permission keys 6 ตัว + grants (OWNER auto / ACCOUNTANT VAT read+manage / FINANCE VAT read + buyer evidence / SYSTEM_ADMIN reconciliation); pack ungated 2 ตัว (`pack.company.legal_identity.manage`, `pack.company.vat_registration.manage`) + buyer-evidence key เข้า `pack.tax_invoice.issue`; prefix-filter proof + parity 6.3/6.3b; permission-matrix.md แก้ข้อขัดแย้ง ~353 vs ~389 แล้ว
**สมมุติฐานที่ใช้แทนคำตอบ owner** (เปลี่ยนได้บรรทัดเดียวเมื่อ QP1/QP2/QC1 ตอบ): QP1 = default §15/§10 ตามสเปก · QP2 = `company.legal_identity.*` ให้ OWNER เท่านั้น (ACCOUNTANT ยังไม่ให้), MANAGER ไม่ได้ `company.vat_registration.read` · QC1 = precedence §6.4 ตามที่เขียนไว้
Owner: thawtchai
Scope: Step 0 ตัวตนภาษี 4 domain (identity, VAT-CC4, establishment, buyer+issuance); Release A → ops → B preflight → B1 → B2 → C1 → evidence → C2

Decisions: **spec v2.9 ทั้งไฟล์เป็น authority เดียว** (`docs/specs/company-tax-identity-setup-spec.md`); memory นี้ไม่ทำสำเนา decision เพื่อลด drift
Open questions: QP1+QP2+QC1 block Release A · QD2 block B1 · QB3 block CN/DN deregistration authority · Q3+evidence+exact-build acceptance path block C2 · Q1/Q2/Q4/QM1 non-blocking ตาม spec §19

**แก้บั๊ก 2026-08-05 (A3b interval accessor)** — ตอบสถานะ VAT ซ้ำด้วย `effectiveFrom` เดิม เคยได้ live fact ซ้อนกัน 2 แถว แล้ว `effectiveVatStatus` ตอบพลิกไปมาตามลำดับแถวที่ DB คืน ขัด invariant "fact ห้ามซ้อน" ของ spec เอง (§5.3(3) เขียนว่า "fact ปัจจุบันครอบ F → ตั้ง effectiveTo = F" แต่โค้ดเติมเงื่อนไข `<` เข้ามา) แก้ 3 ชั้น: planner supersede fact ที่ถูกแทนที่เมื่อวันเท่ากัน (ไม่ปิดเป็น `[F,F)` เพราะช่วงว่างยัง live อยู่ แล้ว `futureFacts` จะเห็นและ 409 ใส่ fact ที่ตายแล้ว) · comparator เพิ่ม tiebreak `answeredAt` → `id` และคืน 0 เมื่อเท่ากันจริง · ทั้ง 2 จุดโหลด (`company-vat-registration.use-case.ts`, `company-identity.use-case.ts`) select `answeredAt` + `orderBy` ไม่ต้อง migration ไม่ต้อง repair script
พิสูจน์กับ Postgres จริง: ก่อนแก้ 2 แถว live พร้อมกัน · หลังแก้เหลือ live แถวเดียว อีกแถว superseded · อ่านซ้ำ 5 ครั้งได้คำตอบเดียวกัน

บทเรียนสะสม (ใช้ซ้ำได้กับฟีเจอร์อื่น):
- ย้าย write ลงแถวร้อนเข้า Serializable txn ที่มีอยู่ = ต้องมี bounded retry เสมอ (filter กลางแปลง P2034 → 500 และไม่มี retry กลาง)
- compatibility path ต้อง derive idempotency key จาก "เจตนา" ไม่ใช่ requestId ไม่งั้นเสีย dedupe ที่ baseline มีอยู่
- latch/fence ต้องมี capture window ไม่งั้น onboarding flow ของฟีเจอร์เองเดินไม่ได้
- endpoint ที่มี replay ต้องมี result DTO เดียวและ discriminator ชัด (`replayed:false|true`) ไม่งั้น retry ที่สำเร็จแล้วทำ client/e2e พัง
- HUMAN-opened launch gate = per-build และคำสั่งผ่าน LB ระหว่าง mixed-build target build ไม่ได้; ต้องมี exact-build path ก่อน traffic หรือ proven drain
- อย่าเดาความหมาย external field จากชื่อ: RD นิยาม `businessFirstDate` ว่าเป็นวันอนุมัติจด VAT จึงใช้ prefill แบบผู้ใช้ยืนยันได้
- ไม่มี source fact ไม่ได้แปลว่าต้องสร้าง proxy: TAX_INVOICE legacy จาก baseline ที่ไม่ enforce VAT ใช้พิสูจน์สถานะจด VAT ไม่ได้
- AC ที่ต้องใช้ semantics ของ PostgreSQL จริง (advisory lock/SERIALIZABLE/partial unique) ต้องมี CI gate แบบ hard-fail ไม่ใช่ spec ที่ skip เงียบ ๆ
- กระบวนการ: หลังแก้ทุกครั้งให้รัน consistency agent ซ้ำจนสะอาด — แต่ละรอบมักเจอ defect ที่รอบก่อนหน้าสร้างเอง

Artifacts: `docs/specs/company-tax-identity-setup-spec.md` · `docs/plans/company-tax-identity-setup-plan.md`
Verification: v2.9 — sections 20 (+§12.1), AC 32, reports 6, ตารางใหม่ 9, Company +16 ฟิลด์, error codes 15, questions 10; ตรวจโค้ด launch controller/tax-period helper + RD VAT Service ก่อนแก้
Next: owner ตอบ QP1+QP2+QC1 แล้วเริ่ม Release A; QD2 ใช้ production report ก่อน B1
