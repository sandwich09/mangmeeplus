# Production Stripe live enablement

เปิด billing โหมด live บน production — ต้องมีครบ 4 ค่านี้ก่อน deploy ถึงจะทำงานได้จริง (สร้าง 2026-09-20)

## ค่าที่ต้องมี และที่เก็บ

| ค่า | เก็บที่ |
| --- | --- |
| `BILLING_MODE=live` | tracked `infra/kamal/config.json` → `production.api-web` |
| `STRIPE_ACCOUNT_ID` | tracked `infra/kamal/config.json` → `production.api-web` (ไม่ใช่ secret) |
| `STRIPE_SECRET_KEY` | AWS Secrets Manager: `watchdog-bms/production/stripe/STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | AWS Secrets Manager: `watchdog-bms/production/stripe/STRIPE_WEBHOOK_SECRET` |

Secret สองตัวบน Secrets Manager owner สร้างไว้แล้ว (2026-09-19/20) เป็น plaintext secret ชื่อตรงเป๊ะตามตาราง

## ก่อน deploy: ต้อง enroll secret เข้า baseline ของ service (ECS Express Mode)

Kamal release จับ config จาก **service configuration ของ ECS Express Mode** ที่จอดไว้ (`describe-express-gateway-service` →
`activeConfigurations[0].primaryContainer.secrets`) — ดู `infra/dev-kamal/capture-config.py` — ไม่ใช่จาก task definition revision
และต้องการ `valueFrom` เป็น ARN ใต้ `watchdog-bms/production/...` เท่านั้น ถ้า baseline ยังไม่มี entry ชี้ไปสอง ARN ข้างบน
deploy จะไม่เห็น secret เลยแม้ตั้ง `BILLING_MODE=live` แล้วก็ตาม (ฝั่ง UAT ทำด้วยมือกับ `watchdog-bms/uat/stripe/...` เมื่อ 2026-09-16)

วิธี enroll = API round-trip ตามรันบุ๊ก cloud-environment-operations §3: `describe-express-gateway-service` → คัดลอก 9 คีย์
(`serviceArn`, `executionRoleArn`, `healthCheckPath`, `primaryContainer`, `taskRoleArn`, `networkConfiguration`, `cpu`, `memory`,
`scalingTarget`) มาเป๊ะ ๆ เพิ่มเฉพาะ 2 แถวใน `primaryContainer.secrets` แล้ว `update-express-gateway-service` ด้วยสิทธิ์ owner
(deploy role ไม่มี ecs:ListServices/Update) จากนั้นรอจน `activeConfigurations` เหลือ 1 ตัว (~3 นาที) ก่อน dispatch deploy
สคริปต์ที่ใช้ 2026-09-20: `enroll-stripe-secrets-production.sh` (dry-run พิมพ์ diff ก่อน แล้ว `--apply`; service
`arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-prod/watchdog-bms-api-web-pub`, capacity คงเดิม 0/0)

## Stripe live mode checklist (ทำใน Stripe Dashboard)

- เปิด Live mode toggle
- คัดลอก API keys (secret + publishable) ของ live mode
- Account ID: Settings → Business
- Webhook destination: `https://mangmeeplus.com/api/v1/public/stripe-events`, API version
  `2026-08-26.dahlia`, events: `checkout.session.*`, `invoice.*`,
  `customer.subscription.{created,updated,deleted}`, `charge.refunded` + `charge.dispute.*`, `refund.*`
- Products/prices: 8 paid + 8 zero (4 tier × month/year × paid/prepaid) — **ไม่ต้องกดใน Dashboard**
  ใช้สคริปต์ในหัวข้อ "แคตตาล็อก Stripe" ข้างล่างแทน แล้วผูกรหัสในหน้าตั้งค่า
- เปิด Customer Portal
- ตั้งค่า tax

## แคตตาล็อก Stripe (Product/Price) — `create-catalog-prices.ts`

Phase 6 (มติ Owner 2026-09-21) เปิดขาย `ENTERPRISE_1999` → แคตตาล็อกมี **4 tier × (month|year) × (paid|prepaid)
= 8 paid + 8 zero**. UAT มี 3 tier แรกอยู่แล้ว (สร้างมือ 2026-09-16); live mode ยังไม่มีอะไรเลย.
สคริปต์นี้สร้างส่วนที่ขาดให้ครบ **แบบ idempotent** (หาเจอด้วย `lookup_key` ก็ใช้ตัวเดิม ไม่สร้างซ้ำ) และอ่าน
Price กลับมาตรวจด้วย `assertStripePrice` ซึ่งเป็นตัวเดียวกับที่หน้าตั้งค่าใช้ตอนผูก.

ข้อตกลงชื่อ (ตามที่ UAT ใช้อยู่ ห้ามเปลี่ยน):

- Product: `มั่งมี Plus Starter|Basic|Pro|Enterprise` + ` (ทดสอบ)` เฉพาะ uat ·
  metadata `{environment, managed_by, plan_tier}`
- Price `lookup_key`: `mangmee_<env>_v1_<tier>_<price>_<month|year>_<paid|prepaid>`
  เช่น `mangmee_uat_v1_enterprise_1999_year_paid` · metadata `{environment, managed_by, offer_key, purpose}`
- `prepaid` = ราคา 0 บาท ซึ่งระบบเก็บไว้ใน `zeroPriceIds`

### รัน (ทำ test mode ให้จบก่อน แล้วค่อย live)

`STRIPE_SECRET_KEY` อ่านจาก environment เท่านั้น และสคริปต์ไม่เคยพิมพ์ค่านี้ออกมา.
`--environment uat` บังคับคีย์ `sk_test_`, `--environment production` บังคับ `sk_live_` + `--yes`.
`--tax-treatment` ต้องตรงกับนโยบายที่กำลังจะประกาศ (live mode ยังไม่มีนโยบาย ระบบจึงไม่อ่านฐานข้อมูล).
ค่าที่ใช้จริง 2026-09-21 = `NOT_VAT_REGISTERED` (บริษัทยังไม่จด VAT และ Price เดิมของ UAT มี `tax_behavior=unspecified`
จึงผ่านการอ่านกลับเฉพาะค่านี้). Price ที่สคริปต์สร้างใหม่มี `tax_behavior=inclusive` → ถ้าภายหลังประกาศนโยบาย
`INCLUSIVE_VAT_7` ยังใช้ชุดเดิมได้ แต่ถ้าเป็น `EXCLUSIVE_VAT_7` ต้องสร้างชุดใหม่ (lookup_key ใหม่).

```bash
# 1) ซ้อมก่อน (ไม่เขียนอะไรเลย, exit 0)
STRIPE_ACCOUNT_ID=acct_xxx STRIPE_SECRET_KEY=sk_test_xxx \
  pnpm --filter @watchdog-bms/api exec tsx src/scripts/create-catalog-prices.ts \
  --environment uat --tax-treatment NOT_VAT_REGISTERED --dry-run

# 2) รันจริงบน test mode
STRIPE_ACCOUNT_ID=acct_xxx STRIPE_SECRET_KEY=sk_test_xxx \
  pnpm --filter @watchdog-bms/api exec tsx src/scripts/create-catalog-prices.ts \
  --environment uat --tax-treatment NOT_VAT_REGISTERED

# 3) รันจริงบน live mode (ไม่ต้องรอ deploy — สคริปต์ไม่แตะระบบ แค่สร้างของใน Stripe)
STRIPE_ACCOUNT_ID=acct_xxx STRIPE_SECRET_KEY=sk_live_xxx \
  pnpm --filter @watchdog-bms/api exec tsx src/scripts/create-catalog-prices.ts \
  --environment production --tax-treatment NOT_VAT_REGISTERED --yes
```

stdout มีแค่ตารางที่ก๊อปไปวางได้ บรรทัดละ offer key (รายละเอียด/โหมด/คำเตือนไปที่ stderr):

```
STARTER_249:month paid=price_… zero=price_…
STARTER_249:year  paid=price_… zero=price_…
…
ENTERPRISE_1999:year paid=price_… zero=price_…
```

### ผูกรหัสในระบบ (สคริปต์ไม่ผูกให้ — ตั้งใจ)

Price id เข้าสู่นโยบายได้ทางเดียวคือหน้าแอดมิน → `PUBLISH_POLICY` → `parseBillingPolicy` →
`validateProvider` (ยิง `GET /prices` + `assertStripePrice` ทุกตัวที่กรอก) ไม่มี seed/env ใด ๆ

1. ระบบ → การชำระเงิน → ตั้งค่า → หัวข้อ **"ราคาและสิทธิ์ของแพ็กเกจ"**
2. แต่ละแถวชื่อ `<ชื่อแพ็กเกจ> · รายเดือน|รายปี` มีสองช่อง:
   **`· ราคาเก็บเงิน`** ← ใส่ `paid=` และ **`· ราคาศูนย์สำหรับช่วงจ่ายล่วงหน้า`** ← ใส่ `zero=`
   (เช่น `ธุรกิจ (ENTERPRISE) · รายปี · ราคาเก็บเงิน`)
3. กรอกเหตุผล → ขออนุมัติ → อนุมัติ → ประกาศ (PUBLISH_POLICY)
4. ตรวจ: `GET /v1/billing/catalog` ต้องเห็น `ENTERPRISE_1999` เป็น `availability: "AVAILABLE"`
   (ก่อนผูกจะเป็น `COMING_SOON` — เป็นสถานะที่ถูกต้อง ไม่ใช่ข้อผิดพลาด)
5. ลำดับที่ต้องทำ: รันสคริปต์ test mode และ live mode (**ทำแล้ว 2026-09-21** ดูตารางข้างล่าง) → deploy Phase 6 ขึ้น UAT →
   ผูกบน UAT → ตรวจการ์ด → deploy production → ผูกบน production

## Guard ในโค้ด

`apps/api/src/modules/billing/infrastructure/stripe.client.ts` ปฏิเสธทุก billing call ถ้า live mode
แล้ว key ไม่ขึ้นต้นด้วย `sk_live_` — กัน live mode หลุดไปรันด้วย test key

## Verify หลัง deploy

1. `POST /v1/billing/configuration-checks` (permission `system.billing.reconcile.run`) ต้องผ่าน
2. Stripe Dashboard → webhook → "Send test event" ต้องได้ HTTP 200
3. Owner ทำรายการซื้อจริงขั้นต่ำ 1 ครั้ง + refund 1 ครั้ง

## Rollback

เปลี่ยน `BILLING_MODE` กลับเป็นค่าที่ไม่ใช่ live (เช่น `disabled`/`test`) ใน `infra/kamal/config.json` แล้ว deploy ใหม่
### รหัสที่สร้างแล้ว 2026-09-21 (Owner ให้ controller รันเอง)

สคริปต์รันด้วยคีย์จาก Secrets Manager (`watchdog-bms/uat/stripe/…` = sandbox `acct_1UEk5IRvebw5L0s3`,
`watchdog-bms/production/stripe/…` = live `acct_1UEk51Rs6uvhhTkv`) — test mode ใช้ Price เดิม 12 ตัวและเพิ่ม ENTERPRISE 4 ตัว,
live mode สร้างใหม่ทั้งหมด 4 Product + 16 Price (ก่อนหน้านี้ว่างเปล่า). ทุกตัวผ่าน `assertStripePrice` ตอนอ่านกลับ.
รันซ้ำได้ทุกเมื่อ (จะพิมพ์ตารางเดิม ไม่สร้างซ้ำ). รหัสเหล่านี้ไม่ใช่ความลับ แต่**ห้ามส่งให้ Owner ในข้อความ** (กติกาสื่อสาร).

UAT (test mode):

```
STARTER_249:month paid=price_1UGBvQRvebw5L0s3Qkd2aOQl zero=price_1UGBvRRvebw5L0s3xfmGXch4
STARTER_249:year paid=price_1UGBvSRvebw5L0s3whIldbVI zero=price_1UGBvTRvebw5L0s3S8jTuere
BASIC_499:month paid=price_1UGBvURvebw5L0s3jwlXM5Pw zero=price_1UGBvVRvebw5L0s3nfBaBzBP
BASIC_499:year paid=price_1UGBvWRvebw5L0s3o5KhlHdN zero=price_1UGBvXRvebw5L0s3tCCfHzzt
PRO_999:month paid=price_1UGBvZRvebw5L0s3sRK0bhYD zero=price_1UGBvaRvebw5L0s3ijuZBKit
PRO_999:year paid=price_1UGBvbRvebw5L0s3D24P8Ira zero=price_1UGBvcRvebw5L0s3SPTn14ng
ENTERPRISE_1999:month paid=price_1UI453Rvebw5L0s3aL9eUuVJ zero=price_1UI454Rvebw5L0s3MSXva1SV
ENTERPRISE_1999:year paid=price_1UI455Rvebw5L0s3Ja1U994A zero=price_1UI455Rvebw5L0s3hfV6i4Fy
```

Production (live mode):

```
STARTER_249:month paid=price_1UI45dRs6uvhhTkvVTTP85kk zero=price_1UI45eRs6uvhhTkvqw8GJn2x
STARTER_249:year paid=price_1UI45fRs6uvhhTkvd93ZykQN zero=price_1UI45fRs6uvhhTkvBHdgvWXw
BASIC_499:month paid=price_1UI45hRs6uvhhTkveeIhrSL0 zero=price_1UI45iRs6uvhhTkvoqAfXf4P
BASIC_499:year paid=price_1UI45jRs6uvhhTkvLRIf1pCL zero=price_1UI45kRs6uvhhTkvathySSl8
PRO_999:month paid=price_1UI45mRs6uvhhTkvlYCIHFkg zero=price_1UI45mRs6uvhhTkvZQclsWb4
PRO_999:year paid=price_1UI45nRs6uvhhTkvrKuj6m0e zero=price_1UI45oRs6uvhhTkvszNrcM7G
ENTERPRISE_1999:month paid=price_1UI45qRs6uvhhTkvGxMJr0JE zero=price_1UI45rRs6uvhhTkvQDAC55mA
ENTERPRISE_1999:year paid=price_1UI45rRs6uvhhTkvSv8ZddBy zero=price_1UI45sRs6uvhhTkv97skjLCx
```
