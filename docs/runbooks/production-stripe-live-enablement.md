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
- Products/prices: 6 paid + 6 zero (ให้ตรงกับ test mode)
- เปิด Customer Portal
- ตั้งค่า tax

## Guard ในโค้ด

`apps/api/src/modules/billing/infrastructure/stripe.client.ts` ปฏิเสธทุก billing call ถ้า live mode
แล้ว key ไม่ขึ้นต้นด้วย `sk_live_` — กัน live mode หลุดไปรันด้วย test key

## Verify หลัง deploy

1. `POST /v1/billing/configuration-checks` (permission `system.billing.reconcile.run`) ต้องผ่าน
2. Stripe Dashboard → webhook → "Send test event" ต้องได้ HTTP 200
3. Owner ทำรายการซื้อจริงขั้นต่ำ 1 ครั้ง + refund 1 ครั้ง

## Rollback

เปลี่ยน `BILLING_MODE` กลับเป็นค่าที่ไม่ใช่ live (เช่น `disabled`/`test`) ใน `infra/kamal/config.json` แล้ว deploy ใหม่
