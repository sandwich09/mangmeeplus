# พนักงานหลายบริษัทบน LINE (Active-Membership Policy) — Spec P13

สถานะ: DRAFT — policy/security change รอเข้าคิว implement (หลัง P12 canonical channel); แผนส่งมอบเขียนตอนเข้าคิว

ที่มา: [แผนหลัก P13 + §13.5 กฎ multi-company](../plans/mangmee-brain-2-5-day-priority-plan-th.md); ปิด MULTI-01, MULTI-02 (§13.3)

## 1. Current truth — ความไม่สมมาตรที่ต้องแก้ (สำรวจ 2026-08-26)

| ช่องทาง | พฤติกรรมวันนี้ | หลักฐาน |
|---|---|---|
| **เว็บ** | สลับได้ทุก active membership ไม่สนบทบาท — switcher ใน header, `GET /auth/me/companies` คืนทุก ACTIVE membership, per-request stateless | `auth.controller.ts:640-660`; multi-company-branch-scope-spec §3/§7 (Approved 2026-07-03) |
| **LINE** | ผู้ใช้ ≥2 membership ถูกปฏิเสธทั้งหมด **เว้นแต่เป็น OWNER ของทุกบริษัท** (`memberships.every(isOwnerMembership)`) — พนักงาน 2 บริษัทไม่มีทาง LINE เลย แม้แต่ picker; ข้อความ: `🔒 ผู้ใช้หลายบริษัทต้องเป็น OWNER ของทุกบริษัทก่อนเลือกบริบทใน LINE ค่ะ` | `process-line-webhook.use-case.ts:164,967-993,3045-3121` |
| จุดบังคับที่สอง (ตอน link) | `Only OWNER users can select among multiple companies.` | `link-line-identity.use-case.ts:114-117` |
| Context ปัจจุบัน | `LineCompanyContext` **หนึ่งแถวต่อ lineUserId ทั้งระบบ** (`@@unique([lineUserId])`, ไม่มี FK) — เลือกบริษัทเดียว global | `schema.prisma:3064-3073` |
| การสลับที่มีอยู่ | คำสั่ง `/companies` + `/company <n>` ทำงานแล้ว (เฉพาะ owner-all) + audit `ai.line.company_context.switch` LOW + redact lineUserId | `:3045-3121` |

หมายเหตุ: multi-company-branch-scope-spec §6 อ้างว่า LINE สลับได้แล้ว — จริงเฉพาะกลุ่ม owner-all; spec นี้คือส่วนที่ทำให้ข้ออ้างนั้นเป็นจริงกับพนักงาน

## 2. นโยบายใหม่ (จาก §13.5 — บังคับทุกข้อ)

1. **อนุญาตจาก active membership ไม่ใช่ Owner เท่านั้น** — แก้เงื่อนไขทั้งสองจุด (§1 แถว 2–3): ผู้ใช้หลาย membership เห็น picker เสมอ (ทุกบริษัทที่ ACTIVE ทั้ง membership และ company)
2. **สิทธิ์คำนวณใหม่ต่อ company/branch/feature ทุก LINE turn** — pattern เดิมของ webhook คงอยู่ (ทุก turn resolve membership+permission สด) — spec เพิ่ม negative test บังคับ
3. **ห้าม union role/permission ข้ามบริษัท** (MULTI-02) — permission set มาจาก membership ของบริษัทใน context เท่านั้น
4. **สลับบริษัท = ล้าง/แยก namespace ของ conversation context ที่ไม่ปลอดภัย**: intake state (`LineIntakeState` owner triple มี companyId อยู่แล้ว — ✓ by design), draft conversation context, pending media — ทุกตัวต้อง key ด้วย companyId หรือถูก invalidate ตอนสลับ (audit จุดที่ยัง global ตอน implement)
5. **Draft/mutation เริ่มที่บริษัท A อยู่บริษัท A** — สลับไป B แล้วกลับมาทำต่อต้องยืนยันใหม่; ห้าม carry เอกสารข้ามบริษัท
6. Audit `company_context.switch` ทุกครั้ง (มีแล้ว — คง actor/from/to/channel/requestId, ห้าม LINE ID ดิบ) + แสดงชื่อบริษัท+บทบาทปัจจุบันบนทุกคำตอบที่ผูกบริษัท (MULTI-02 UI)

## 3. การเปลี่ยนที่ต้องทำ (ระดับ spec)

- ลบเงื่อนไข owner-all สองจุด → แทนด้วย active-membership; picker `/companies` แสดงทุกบริษัท (ชื่อ+บทบาท) — เลือกแล้ว upsert `LineCompanyContext` เดิม
- คงข้อความปฏิเสธเดิมไว้เฉพาะกรณี 0 membership; เพิ่มข้อความ "คุณอยู่บริษัท X (บทบาท Y) — พิมพ์ /companies เพื่อสลับ" ใน onboarding ของ turn แรกหลัง link
- `LineCompanyContext` คงหนึ่งแถวต่อผู้ใช้ (OA เดียว) — ไม่แก้ schema; เพิ่ม validation: context ชี้บริษัทที่ membership หาย → บังคับเลือกใหม่ (มีแล้ว `:986-990` — คงไว้)
- ประตูเปิด: flag `LINE_MULTI_COMPANY_STAFF_ENABLED` default off ทุก env จน negative suite ผ่าน (นโยบายความปลอดภัยเปลี่ยน = ต้อง flag + หลักฐาน)

## 4. Gates/tests (ยกจาก §15 แถว Multi-company คำต่อคำ + เพิ่ม LINE)

- user เดียว STAFF บริษัท A + ADMIN บริษัท B ใช้ได้ทั้งเว็บ/LINE; **negative cross-tenant = 0 disclosure**; permission ไม่ union; draft ไม่ย้ายบริษัท
- LINE เพิ่ม: สลับแล้วถามข้อมูล → ได้เฉพาะบริษัทปัจจุบัน (ยิงคำถามชุด security corpus ข้ามบริษัท); intake/draft ที่ค้างของ A ไม่โผล่ใน B; audit switch ครบทุกครั้ง

## 5. คำถาม Owner

1. ยืนยันนโยบาย (คำถาม §11 ข้อ 9 เดิม): พนักงานทุก role ที่มี active membership สลับบริษัทบน LINE ได้ — ใช่หรือไม่ (spec นี้ assume ใช่ตาม §13.5)
2. พนักงานที่บริษัทเดียว + ถูกเพิ่มบริษัทที่สอง: แจ้งใน LINE อัตโนมัติหรือเงียบไว้จนพิมพ์ /companies
