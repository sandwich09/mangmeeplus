# แผนและสถานะ Postmark environment isolation

สถานะ 2026-09-16: source หลักเข้า `develop` และ `main` แล้วผ่าน PR #558/#577 และข้อกำหนด OTP ผ่าน #575/#582. เอกสารนี้ปรับจากงานที่คัดออกจาก stash ให้ตรงกับ source ปัจจุบัน. ไม่ใช่หลักฐานว่า UAT/Production ได้ deploy หรือผ่าน native application acceptance แล้ว.

ฐานข้อกำหนด: [provider spec](../specs/mangmee-transactional-email-provider-spec-th.md), [รายละเอียด PE01–PE09](../research/postmark-environment-isolation-review-2026-09-15-th.md), [OTP/billing spec](../specs/signup-optional-email-otp-billing-spec-th.md) และ [activation/recovery runbook](../runbooks/postmark-environment-activation.md).

## ขอบเขตปัจจุบัน

- Shared Postmark send ตรวจ deployment environment, server token→ID, Live mode, active Transactional stream, From และ web origin ก่อน POST. UAT ใช้ exact normalized recipient allowlist; ไม่เปลี่ยนผู้รับเงียบ ๆ และไม่รับ Cc/Bcc. Native GET ที่ล้มเหลวหยุดก่อนส่ง.
- [Canonical config](../../infra/postmark/config.json) กำหนด Postmark สำหรับ release ปกติทั้งสอง environment, มี server IDs และ secret references แยกระบบ รวม OTP HMAC key/version. ข้อความเก่าที่ให้ UAT ใช้ SES/Production disabled จนเปิด flag ภายหลังถูกแทนด้วยข้อกำหนด OTP แล้ว. Local development ยังเลือก disabled/local-console ได้.
- ECS และ Kamal ใช้ [config loader](../../infra/postmark/config.py) เดียวกัน. Kamal resolve เฉพาะ AWSCURRENT, เก็บ resolved ARN/version ใน inventory, เขียน sanitized native readiness และตรวจ version อีกครั้งก่อน mutation. Canonical settings ต้อง override legacy ECS values.
- ค่าใน repository เป็น nonsecret configuration และ secret references; ไม่ยืนยันว่า secret/provider integration จริงพร้อม. Missing/wrong secret, token/server/stream หรือ OTP key ต้องหยุด release preflight.
- Callback auth/binding/dedupe และ drain/recovery ใช้ contract ปัจจุบันใน runbook. ห้ามแก้ normal-release provider กลับเป็น disabled เพื่อผ่าน gate; การหมุน OTP key ต้อง drain และจัดการ pending proof ตาม runbook ไม่เดิน key หลายเวอร์ชันร่วมฐานเดียวกัน.
- ไม่เปลี่ยน signup, permission, billing authorization, UI, schema หรือ runtime behavior ในงานนำเอกสารและ regression กลับเข้ารอบนี้.

## งานและหลักฐาน

| งาน | สถานะ | หลักฐาน/ขั้นถัดไป |
| --- | --- | --- |
| Shared send guard และ canonical ECS/Kamal integration | SOURCE MERGED | [Postmark client](../../apps/api/src/modules/auth/infrastructure/postmark.client.ts), [Kamal release](../../infra/kamal/release.py), [config tests](../../infra/postmark/config_test.py) |
| Required Postmark/OTP release configuration และ native preflight | SOURCE MERGED | [OTP delivery evidence](../evidence/signup-optional-email-local-2026-09-16.md#ci-gated-source-delivery) |
| ตัวอย่าง `.env` และ Kamal regression เพิ่มเติม | รอบ integration นี้ | [task memory](../agent-memory/stash-useful-integration-2026-09-16.md); ทดสอบด้วย synthetic secret/provider เท่านั้น |
| Native server/From และ provider UI test delivery | มีหลักฐานวันที่ 2026-09-15 | UAT `20950027` / developer, Production `20950034` / contact; [native evidence](../evidence/postmark-native-delivery-2026-09-15.md) บันทึกทั้งฉบับผิดผู้ส่งและฉบับแก้ไข |
| Actual secrets, UAT tester allowlist, native application OTP/inbox และ callback acceptance | ยังต้องพิสูจน์ต่อ environment | ทำตาม activation runbook และ acceptance ของ OTP; ไม่ใช้ UI test delivery แทนผลแอป |
| UAT/Production release และ customer OPEN | ไม่ได้ดำเนินการในรอบนี้ | ใช้ [deployment protocol](../runbooks/uat-production-v2-deployment.md) เมื่อมีงาน release ที่อนุมัติ |

## Acceptance ของ regression ที่นำกลับเข้า

1. UAT และ Production resolve canonical secret references ด้วย AWSCURRENT; OTP HMAC key ยังคง contract ปัจจุบัน.
2. Provider/From/origin ที่คืนให้ Kamal แทนค่า baseline เก่า และ secret inventory เดิมยังอยู่ครบ.
3. Native server/stream preflight ทำงานก่อนคืน config และเขียนเฉพาะ safe readiness fields; unit test ใช้ HTTP responses สังเคราะห์ทั้งหมด.
4. Wrong origin หยุดก่อนอ่าน secret หรือเรียก provider. Secret เปลี่ยน AWSCURRENT หลัง capture ต้องหยุดก่อน mutation.
5. ไม่เพิ่ม CI invocation ซ้ำ เพราะ pipeline ปัจจุบันรัน config/release tests อยู่แล้ว. ไม่เปลี่ยน package.json หรือ production maintenance pins ในงาน test/docs นี้.
