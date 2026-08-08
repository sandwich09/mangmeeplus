# Production Migration Reconciliation — item11b checksum drift

ตรวจจริงจาก production DB ผ่าน bastion เมื่อ 2026-08-08 | คู่กับ
`docs/agent-memory/migration-drift-diagnosis.md` (การวิเคราะห์ต้นเหตุ) และ
`infra/production/inspect-migration-state.sh` (เครื่องมือตรวจ)

---

## สิ่งที่ตรวจพบ

Production DB **ไม่ใช่ DB ว่าง** — repo เก่า (`sandwich09/WatchDog-BMS`) deploy production ไว้ช่วง
ก.ค. 2026 (`GIT_SHA=6d66bdc7`, 2026-07-19) ตาราง `_prisma_migrations` มี **70 แถว**

เทียบ checksum ทั้ง 70 กับไฟล์ใน repo ปัจจุบัน (Prisma checksum = plain sha256 ของ `migration.sql`):

```
ตรง 69 · drift 1 · orphan 0 · failed/in-progress 0
```

**Drift ตัวเดียว:** `20260714120000_item11b_transaction_tax_schema`

| | ค่า |
| --- | --- |
| checksum ใน prod (draft เก่า) | `5582767ba1f939f0010dfd9885d457101092f34fc74b27f54ee7ba0ad992905c` |
| checksum ไฟล์ปัจจุบันใน repo | `1e8e73d2e430a22b1442f2c40965545c60822ad103336812d7c185e8a91651bc` |

## ทำไมถึงเกิด (จาก migration-drift-diagnosis.md + ตัว heal เอง)

Production **dirty-deploy** ไฟล์เวอร์ชันก่อน commit เมื่อ 2026-07-14 (workstation deploy ก่อนมี
immutable pipeline) แถวถูก mark `applied` แต่ `ALTER TABLE` column-adds บางส่วนไม่ลง —
checksum ที่บันทึกจึงเป็นของ draft ที่ไม่เคย commit

**สำคัญ: schema ถูกแก้ไปแล้ว** — migration `20260715120000_heal_item11b_tax_columns`
(prod applied แล้ว, อยู่ในลิสต์ 70 แถว) เติม enum types + tax-snapshot columns ที่ขาดแบบ idempotent
ตาม comment ในไฟล์ heal เอง: *"re-asserts ONLY the enum types + tax-snapshot columns, idempotently...
adds the missing columns on drifted ones"*

⇒ **ข้อมูลและ schema ถูกต้องแล้ว** เหลือแค่ตัวเลข checksum ในตาราง metadata ที่ยังชี้ draft เก่า

## ทำไมมันบล็อก deploy

release task รัน `prisma migrate deploy` ก่อน rollout ทุกครั้ง คำสั่งนี้เทียบ checksum ของทุกแถวที่
applied กับไฟล์ ถ้าเจอไม่ตรงแม้แต่ตัวเดียว **จะปฏิเสธทั้ง batch ก่อนแตะ migration ใหม่ 51 ตัว**
(repo มี 121, prod มี 70) — ไม่ใช่ข้อมูลเสีย แต่ deploy เดินหน้าไม่ได้

`verify-applied-migration-catalog.ts` ก็เทียบ name+sha256 เช่นกัน จึงจับตัวนี้ด้วย

## ทางแก้: metadata-only update (proposal (a) ของ diagnosis doc)

ปลอดภัยเพราะ schema ถูกต้องแล้วจาก heal — เป็นการอัปเดต **ตัวเลข checksum อย่างเดียว** ไม่แตะ schema
ไม่แตะข้อมูล ไม่รัน DDL

```sql
UPDATE "_prisma_migrations"
   SET checksum = '1e8e73d2e430a22b1442f2c40965545c60822ad103336812d7c185e8a91651bc'
 WHERE migration_name = '20260714120000_item11b_transaction_tax_schema'
   AND rolled_back_at IS NULL;
```

**ทำไมไม่ใช้ `prisma migrate resolve`:** คำสั่งนั้นรับเฉพาะ migration ที่อยู่สถานะ *failed*
แต่ตัวนี้ succeeded ไปแล้ว — diagnosis doc ยืนยันว่า supported remedy คือ metadata update ตรง ๆ

## ⚠️ ข้อควรระวัง

- **ต้อง `WHERE ... rolled_back_at IS NULL`** เสมอ — กันการแก้แถวที่ถูก roll back
- **ตรวจก่อน UPDATE ว่าโดน 1 แถวเป๊ะ** — รัน `SELECT` เงื่อนไขเดียวกันก่อน ต้องได้ 1 row
- **ห้ามลบแถว** ใน `_prisma_migrations` — แก้ checksum อย่างเดียว
- ทำผ่าน **writer connection** (support_rw ทำไม่ได้ — ตั้งใจกันไว้) → ใช้ตอน bootstrap หรือ
  ปล่อยให้ **release task จัดการเอง** (ดูทางเลือกด้านล่าง)

## จะรันเมื่อไหร่ — สองทาง

**ทาง 1 — แก้ก่อน dispatch (แนะนำ):** รัน UPDATE ผ่าน bastion writer connection **ก่อน** trigger
production deploy เพื่อให้ `prisma migrate deploy` ผ่านตั้งแต่ครั้งแรก ไม่เสียเวลา build แล้วล้ม

**ทาง 2 — ปล่อย release task ล้มครั้งแรกแล้วแก้:** ไม่แนะนำ — เสีย build cycle เต็ม ๆ และ
release task รันใน Fargate ที่แก้ระหว่างทางไม่ได้

### ขั้นตอนทาง 1 (ผ่าน bastion)

```sh
# ต่อ writer (ตัด ?schema= ที่ libpq ไม่เข้าใจออก)
WRITER=$(aws secretsmanager get-secret-value --secret-id watchdog-bms/production/database-url \
  --query SecretString --output text --region ap-southeast-1)

# 1. ยืนยันว่าโดน 1 แถว และ checksum ยังเป็นตัวเก่า
psql "${WRITER%%\?*}" -c "SELECT migration_name, checksum FROM \"_prisma_migrations\"
  WHERE migration_name = '20260714120000_item11b_transaction_tax_schema' AND rolled_back_at IS NULL;"

# 2. UPDATE (writer connection มีสิทธิ์เขียน; นี่คือ metadata ไม่ใช่ default_transaction_read_only)
psql "${WRITER%%\?*}" -c "UPDATE \"_prisma_migrations\"
  SET checksum = '1e8e73d2e430a22b1442f2c40965545c60822ad103336812d7c185e8a91651bc'
  WHERE migration_name = '20260714120000_item11b_transaction_tax_schema' AND rolled_back_at IS NULL;"

# 3. ยืนยันด้วย inspect script — ต้องได้ PASS
bash infra/production/inspect-migration-state.sh   # (ถ้ามี repo บน bastion; ไม่งั้นเทียบมือ)
unset WRITER
```

## หลังแก้ — ยืนยันว่าไม่มี drift อื่น

รอบนี้ตรวจครบ 70 แถวแล้ว **drift มีตัวเดียว** ตัวอื่นที่ diagnosis doc เตือน (`company_booking_buffer`,
`crm_product_service_catalog` — CHECK constraint) **ไม่ปรากฏใน prod** เพราะ prod อยู่ที่ 07-19
ซึ่ง deploy จาก committed ref หลังจากนั้น (ตรงกับตาราง inference ใน diagnosis doc บรรทัด 149:
"none expected — UAT/prod recorded the committed files") — ยกเว้น item11b ที่ dirty-deploy 07-14
ก่อนหน้านั้น

## Migration ที่ prod ยังไม่มี — 51 ตัว

repo 121 − prod 70 = **51 migration ใหม่** ที่ release task จะ apply ครั้งแรก ครอบคลุมงานตั้งแต่
กลาง ก.ค. ถึง ส.ค. (h-fixes, substitute receipt, wht, ฯลฯ) — **จับเวลาตอน apply** เพราะ 51 ตัวบน
DB ที่มีข้อมูลจริงอาจนานกว่าที่คิด (บางตัวมี backfill) แต่ prod ตอนนี้ยังไม่มี user data มาก
จึงน่าจะเร็ว — ตั้งเป็น baseline สำหรับครั้งต่อไป
