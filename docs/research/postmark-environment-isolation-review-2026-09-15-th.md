# รายละเอียดการแยก Postmark UAT / Production

เริ่มตรวจ 2026-09-15; ปรับสถานะ source วันที่ 2026-09-16 จาก `main`/`develop` หลังรวม Stripe/Postmark และ optional-email OTP. เก็บเหตุผลและเกณฑ์ PE01–PE09 ที่ยังใช้ได้จากงานเดิม โดยไม่ใช้สถานะ runtime หรือผล typecheck เก่าเป็นสถานะปัจจุบัน. [แผน](../plans/postmark-environment-isolation-plan-th.md) และ [task memory รอบ integration](../agent-memory/stash-useful-integration-2026-09-16.md) ระบุขอบเขตและผลตรวจของรอบนี้.

## ตัวตนของ environment

From เป็นที่อยู่ผู้ส่งที่ผู้รับเห็น; การเปลี่ยน From อย่างเดียวไม่แยก token, activity หรือ callback. Contract ของแอปจึงตรวจ deployment environment, server ID, stream, sender และ web origin ร่วมกัน. `APP_ENV=production` ใช้ร่วมกันใน cloud ทั้งสองระบบ จึงไม่ใช้ค่านี้แยก UAT จาก Production.

| รายการ | UAT | Production |
| --- | --- | --- |
| Server ที่บันทึกใน canonical config | `20950027` | `20950034` |
| Mode / stream ที่ต้องตรวจ | Live / outbound Transactional | Live / outbound Transactional |
| From | `developer@mangmeeplus.com` | `contact@mangmeeplus.com` |
| Web origin | `https://uat.mangmeeplus.com` | `https://mangmeeplus.com` |
| ผู้รับ | Exact normalized allowlist ของผู้ทดสอบ | ผู้รับตาม business authorization |
| Credentials | Token, webhook auth, OTP key เฉพาะ UAT | Token, webhook auth, OTP key เฉพาะ Production |

ค่าอ้างอิงจาก [config.json](../../infra/postmark/config.json) ไม่ใช่การอ่าน provider/cloud ครั้งใหม่. [Native delivery evidence วันที่ 2026-09-15](../evidence/postmark-native-delivery-2026-09-15.md) ยืนยันการสร้าง Live servers และ Gmail SMTP รับข้อความผ่าน provider UI รวม 3 ฉบับ ซึ่งมี Production ฉบับแรกผิด From และฉบับแก้ไข. หลักฐานนี้ไม่ยืนยัน application OTP, inbox placement, callback หรือ deployed configuration.

## PE01–PE09 หลังรวม source

| ID | เหตุผลที่ต้องควบคุม | สถานะ source / หลักฐานที่ยังต้องมี |
| --- | --- | --- |
| PE01 | Deployment ต้องส่ง Postmark configuration/secret references ครบ | [ECS deploy](../../infra/prod-ecs-express/deploy.sh) ใช้ canonical config และ preflight แล้ว; native environment acceptance ยังแยกจาก source |
| PE02 | Kamal ต้องไม่กลับไปใช้ SES baseline ที่ capture มาจาก ECS | [postmark_configuration](../../infra/kamal/release.py) override legacy values, resolve AWSCURRENT และบันทึก version/readiness แล้ว; regression เพิ่มในรอบนี้ตรวจผลการเชื่อมต่อจริงของ functions ด้วย provider จำลอง |
| PE03 | Token ของ server ผิดต้องไม่ส่งก่อนตรวจ identity | [PostmarkClient](../../apps/api/src/modules/auth/infrastructure/postmark.client.ts) เรียก inspectConfiguration ก่อน cloud POST แล้ว; OTP ยังตรวจ source state ผ่าน before-dispatch callback ปัจจุบัน |
| PE04 | UAT Live ต้องไม่ส่งถึงผู้รับที่ไม่ได้รับอนุญาต | Shared send guard บังคับ exact allowlist, recipient เดียว และไม่มี Cc/Bcc; การเลือกผู้ทดสอบ/ตั้งค่าจริงต้องมีหลักฐาน |
| PE05 | Link/OTP journey ต้องกลับ environment ที่ถูกต้อง | Shared send และ release ตรวจ sender/origin ตาม environment แล้ว; native inbox journey ยังต้องพิสูจน์ |
| PE06 | Callback ต้องไม่แก้ attempt ของอีก environment | [Postmark events](../../apps/api/src/modules/auth/application/postmark-events.service.ts) ตรวจ Basic Auth, server/stream และ attempt binding; actual ingress/auth, duplicate/late events และ persistence retry ต้องผ่าน native acceptance |
| PE07 | Secret/server/OTP-key rotation ต้องไม่ทำให้ pending work ผิดตัวตน | ใช้ drain/rotation/recovery ใน [runbook](../runbooks/postmark-environment-activation.md); ไม่รับรอง webhook credential overlap หรือ zero downtime ที่ยังไม่มีหลักฐาน |
| PE08 | Readiness helper ต้องบังคับใช้จริง ไม่ใช่มี function แยกเฉย ๆ | Shared send และ release preflight ใช้ helper แล้ว; รอบนี้เพิ่มตัวอย่าง `.env` และ regression ไม่เพิ่ม invocation ใน CI ซ้ำ |
| PE09 | Source tests หรือ provider UI delivery ไม่เท่ากับ application acceptance | มี server/From/UI-delivery evidence แล้ว; actual environment secrets, app OTP/inbox, callbacks และ release/customer OPEN ต้องมีหลักฐานแยก |

## ข้อกำหนด configuration ปัจจุบัน

- [Loader](../../infra/postmark/config.py) บังคับ Postmark ใน normal UAT/Production release และแยก server IDs, sender, secret references กับ OTP key/version. ไม่คืนค่า default เก่า SES/disabled และไม่เพิ่ม feature flag เพื่อเปิดภายหลัง.
- Named secret references และ ARN ต้องผูก account/region/environment ที่กำหนด; หลัง resolve ต้องเก็บ ARN และ version ที่ตรวจแล้ว. Runtime secret values ไม่อยู่ใน Git.
- Native readiness ตรวจ Live server และ active Transactional stream ก่อน mutation และให้เฉพาะ safe projection เป็น evidence. อย่าเก็บ response ของ `/server` ทั้งก้อนเพราะมีข้อมูล credential.
- Webhook/key rotation และ pending-proof handling ใช้ runbook ปัจจุบัน; callback/financial recovery เดิมต้องคง source-state และ authorization boundaries.
- การทดสอบอัตโนมัติในรอบนี้ใช้ synthetic AWS responses และ native HTTP responses จำลอง. ผล provider UI, Sandbox หรือ transport-only test ไม่ใช้แทน application inbox acceptance.

## งานก่อน release

1. ยืนยัน actual secrets/token→server/stream, UAT allowlist และ environment origin ผ่าน release preflight.
2. พิสูจน์ OTP/link journey และ callbacks บน environment ที่อนุญาต โดยเก็บเฉพาะหลักฐานที่ไม่เผย secret/proof.
3. ตรวจ drain/recovery และ key-version compatibility ตาม [OTP spec](../specs/signup-optional-email-otp-billing-spec-th.md) และ activation runbook.
4. ทำ [deployment protocol](../runbooks/uat-production-v2-deployment.md) ถึง signed result และ customer OPEN. การนำเอกสารนี้เข้า branch ไม่ทำขั้นตอน cloud เหล่านี้.
