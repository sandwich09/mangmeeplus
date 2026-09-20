# Production hotfix สองรอบ — 18 กันยายน 2026

สถานะ: ทั้งสอง Hotfix ขึ้น Production และ merge กลับ main + develop แล้ว
เวลาทั้งหมดด้านล่างเป็น UTC; เวลาไทย = UTC + 7 ชั่วโมง

## ขอบเขตและพฤติกรรม

1. รอบแรก: ตอบนโยบายทดลองใช้ฟรีแบบแน่นอนโดยไม่เรียก AI และแก้การยืนยันใบเสร็จหลังยกเลิกใบทดแทน
   source `0b0058adbc7353ec906a33746867af2a235b0934` ต่อจาก `8f5b508a` บนฐาน Prod `fc2838c4`.
   รวมการย้าย ECS ไป Kamal ที่เจ้าของอนุมัติแยกต่างหาก จึงไม่ใช่เวลา hotfix ปกติ
2. รอบสอง: แสดงคำตอบใน LINE Flex card รูปแบบเดียวกับระบบ พร้อมปุ่มดูแพ็กเกจ และรองรับ
   “หลังหมดโปรฟรีแล้วเป็นยังไงต่อ” กับคำถามจบช่วงทดลองใช้ฟรีที่มีความหมายเดียวกัน
   source `1406d3825db2eb7d70987b207c80f89ae05edb3b` บนฐานรอบแรกเท่านั้น
   เปลี่ยน 5 application/test paths และ memory 1 ไฟล์ ไม่มี schema, dependency, package หรือ config ใหม่

ข้อความยืนยันว่าใช้ฟรีไม่มีค่าใช้จ่าย มีค่าใช้จ่ายเมื่อเลือกซื้อแพ็กเกจและยืนยันการชำระเงิน
เมื่อหมดช่วงทดลองใช้ฟรีและยังไม่ซื้อ ระบบไม่เรียกเก็บเงินอัตโนมัติ; ดูแพ็กเกจต่อได้จากเว็บทางการ
ไม่ได้สัญญาว่าใช้ฟรีตลอดไป และคำถามผสมกับคำสั่งธุรกิจ/ข้อความอ้างอิงไม่ถูก FAQ แย่งตอบ
ทั้งสอง source แยกจาก main/develop/UAT backlog; ไม่ได้นำฟีเจอร์ Stripe มาขึ้น Prod ในงานนี้

## เวลาจริงและข้อจำกัดการเปรียบเทียบ

| รายการ | รอบแรก: hotfix + ย้ายระบบ | รอบสอง: การ์ด |
| --- | ---: | ---: |
| Build แยกก่อน apply | 360.504 วินาที | 194.790 วินาที |
| Preparation (ไม่ใช่ deploy) | 64.852 วินาที | 57.009 วินาที |
| Apply ถึงเว็บพร้อม | 759.766 วินาที (12:39.766) | 230.844 วินาที (3:50.844) |
| Native rollout/readback | 569.821 วินาที | 82.306 วินาที |
| Apply ถึง terminal acceptance | 5,508.737 วินาที (1:31:48.737) | 252.880 วินาที (4:12.880) |
| CI integration exact head | 24:02 | 23:59 |

รอบแรกเริ่ม 11:37:40.734456, เว็บพร้อม 11:50:20.497214, ปิดผลแบบ owner waiver 13:09:29.471638.
รอ browser acceptance ก่อนเจ้าของสั่งหยุด 4,287.612 วินาที จึงห้ามเรียกเวลา 1 ชั่วโมง 31 นาทีว่า rollout.
ตัวเลข apply ไม่รวม build ที่ทำล่วงหน้า, CI, การตั้ง infrastructure, ความล้มเหลวก่อนหน้า และเวลาวิเคราะห์.
งานเหล่านี้บางส่วนทำซ้อนกัน จึงห้ามบวกทุกช่องเพื่ออ้าง wall time ตั้งแต่ผู้ใช้สั่งงาน

รอบสอง apply ครั้งแรก `20260918T133750Z-80b36194` ล้มก่อนเปลี่ยนบริการใน 374.262 วินาที
เพราะ tools image upload เกิน timeout 240 วินาที. ตรวจจริงครบ 4 containers ยังเป็น source รอบแรก,
restart=0 และไม่มี active/remote lock. ECR มี 3 application images แต่ยังไม่มี tools tag.
ทำเฉพาะ tools publication ให้จบใน 258.563 วินาที (13:50:04.824108–13:54:23.389772) พร้อมตรวจ digest.
ไม่ได้ลบรันล้ม/ลบ lock เพื่อข้าม guard. Retry ที่มีเหตุผลรองรับเริ่ม 14:38:00.736904
เป็น `20260918T143800Z-e6c3b860` ด้วย build เดิม; ช่องว่างก่อน retry รวมอยู่ใน elapsed timeline
แต่ไม่อ้างว่าเป็นเวลาที่ deploy process ทำงาน

รอบสองจบ 14:42:13.723972, signed `ACCEPTED_WITH_BROWSER_HTTP_WAIVER`.
Command รวม process startup/cleanup 253.009 วินาที; receipt clock252.880 วินาที.
Sign/verify phase1.269 วินาที. SHA256 `5e4ff39fe097b2e65409d736d8ce93b6abdeba6892234a1ebfc0e7f1130fc5f9`.
Timeline จากเริ่ม apply ที่ล้ม13:37:50 ถึงจบรอบสำเร็จ14:42:13 =64นาที23วินาที รวมช่วงวิเคราะห์/รอ.
ไม่ควรกล่าวว่า Hotfix รอบสองทั้งหมดใช้เพียง4นาที13วินาที เพราะเป็นเฉพาะคำสั่งรอบที่สำเร็จ

## หลักฐานรอบแรกและ rollback ที่เกิดขึ้นจริง

- Forward `20260918T113740Z-2b1e04fa`: `OWNER_ACCEPTED_BROWSER_HTTP_WAIVED`, KMS ECDSA_SHA_256 verified.
  `accepted.json` SHA256 `438fde898c33ee708069e935be59935e04bb305251883c1e5acaa82eed64c71e`.
- Owner สั่ง “ไม่ต้องตรวจแล้ว เสียเวลา ฉัน้ข้าไปลองแล้ว”. เก็บ waiver ตรงไปตรงมา:
  current identity/flags/logout 204/post-logout 401 ที่ยังไม่ได้สังเกต **ไม่ได้ถูกบันทึกว่าผ่าน**.
  Original interrupted receipt และ customer-acceptance phase FAILED ยังคงอยู่.
- Snd Prd: ใช้ใบเสร็จเดิม LeoPard 845 บาท สร้างใบทดแทนกระดาษ unsigned `SRC-202609-00003`
  ด้วยข้อมูลระบุชัดว่าเป็นการทดสอบ → ยกเลิก → ยืนยันใบเสร็จเดิมสำเร็จเป็น `EXP-202609-00002`.
  ยังไม่ชำระเงิน/ลงบัญชี และไม่มีการลงนามหรือจ่ายเงินจริงในงานทดสอบนี้
- ก่อน forward รอบที่สำเร็จ มี failed migration 2 รอบ: AMI permission และ CloudFormation output IAM read.
  Recovery `20260918T103003Z-7bfbc4ef` กลับ ECS สำเร็จพร้อม KMS และ owner-provided browser evidence.
  เวลาคำสั่งจริง 959.242 วินาที (15:59.242), restore traffic/consumers 465.032 วินาที,
  customer acceptance 454.240 วินาที, sign/verify 1.573 วินาที.
  Recovery นี้เป็น rollback ของ migration ครั้งก่อน ไม่ใช่การทดสอบ rollback ของการ์ดรอบใหม่
- ปิด ECS rollback window ภายหลัง: API STOPPED 13:17:57, AI STOPPED 13:18:31,
  ทุก service capacity 0/0, ไม่มี running task. Old worker task หมดอายุจาก ECS API แล้ว;
  อาศัย signed STOPPED evidence เดิมและ current running=0 โดยไม่สร้างสถานะขึ้นเอง
- Retire obsolete authority 16 rows ผ่านเส้นทาง audit เดิม; ลบเฉพาะ temporary migration IAM policy.
  เก็บ ECS config/image/history, ALB/RDS/Redis เดิม. Subsequent rollback ใช้ Kamal previous snapshot.
  Closure signed SHA256 `a928b7f9ada25b164d531c022fa24cf3c3c411529eb286c284e0ca449b9e46dc`.

## Tests, integrations และ UAT comparison

- First integration: pricing394 + atomic28 + contracts10 + web37 และ API typecheck ผ่าน.
  CI [35348631418](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35348631418) ผ่าน exact head
  `65e20e164cdab54bb4b9259b46c76ac9d0746f60`; ไม่มี rerun.
  [PR629](https://github.com/MangmeeDev/mangmeeplus/pull/629) → develop `6f4d1b913a4e5ecd740a761d6c6ae42522496111`,
  same validated head → main `75207d31660e75918d31eb248b37554ff59fb970`.
  Modern v2 มี receipt behavior ถูกต้องอยู่แล้ว จึงเพิ่ม regression ที่เก็บเหตุผลเก่าไว้ ไม่ทับด้วย guard รุ่นเก่า
- Card isolated source: 343 focused tests และ API typecheck ผ่าน.
  Integration: 427 focused tests ผ่าน; typecheck ใช้ heap8GB หลัง default4GB OOM (code ไม่เปลี่ยน).
  CI [35349893178](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35349893178) ผ่าน exact head
  `cefa946bf7ebb33978793c78eaf065db03bc6e9c`, 13:23:03–13:47:02, ไม่มี rerun.
  [PR639](https://github.com/MangmeeDev/mangmeeplus/pull/639) เก็บ diff isolated Prod;
  [PR640](https://github.com/MangmeeDev/mangmeeplus/pull/640) ใช้ merge behavior กลับสาขาปัจจุบัน
- Historical UAT `20260917T141152Z-297dcbcc`: 279.406 วินาที, 11 phases/KMS ผ่าน.
  เป็น smoke คนละ source/topology และไม่รวม first migration/browser acceptance จึงใช้เปรียบเทียบขอบเขตได้
  แต่ห้ามยืมเป็นหลักฐาน Prod รอบนี้. ไม่ได้ deploy UAT ใหม่ใน follow-up นี้
- UAT/READY/PROD workflow run IDs ของ local Kamal releases: `NOT_DISPATCHED`.
  ใช้ local operation IDs จริงด้านบน; ไม่สร้าง Passport/READY IDs สมมติ

## Operational boundaries

เปลี่ยน SSH allowlist เฉพาะ TCP22 สาม rule จาก49.229.201.224/32 เป็น49.228.220.223/32 ตาม Wi-Fi
ที่ owner แจ้ง; ไม่ขยาย CIDR. CloudFormation OperatorCidr ยังเก่า ต้องรักษา authorized drift นี้เมื่อแก้ stack.
Ordinary deploy/signing ใช้ non-root `mangmee-kamal-production`; `thawatchai` ใช้เฉพาะ infrastructure
prerequisite/retirement ที่ owner อนุมัติ. Legacy Production workflows ยังคง disabled.

Private evidence อยู่ใน `.env.kamal/production/runs/<operationId>/` และ migration-preparation;
ไม่เผยแพร่ env, secret, cookie, token หรือ raw runtime logs. Controller/application ขอบเขตเดิมไม่ถูกแก้
เพื่อทำให้ผลผ่าน. Browser waiver wrapper ใช้เฉพาะ candidate1406/base0b และ hash ผูกกับ signed acceptance.


## ผลรอบการ์ดหลัง deploy และการ merge

สังเกต3ครั้ง 14:42:42.150846–14:44:15.489017 (93.338วินาที): API2ตัว/AI/worker
เป็นsource1406d382ครบ, container IDsเดิมทุกครั้ง, restart0. bounded logs10นาที/ไม่เกิน5,000บรรทัดต่อตัว
ไม่พบ structured error/fatal, uncaught/module failure หรือ HTTP5xx ตามรูปแบบที่ตรวจ.
Public gate endpointและloginตอบ200ครบ6requests, latency130.9–260.2msจากเครื่องผู้ปฏิบัติงาน;
login HTMLมีopen markerครบ3ครั้ง. เป็นเพียงช่วงสังเกตสั้น ไม่ใช่ load test หรือหลักฐานเสถียรระยะยาว

ตัวเก็บสถิติสั้นอ่านเฉพาะfield effectiveState จึงเก็บnullเมื่อpublic APIใช้field state;
คงraw observationsไว้ตามจริง. Controllerอ่านfallbackสองfieldและผ่านOPENในsigned receipt.
การอ่านเสริมด้วยdefault urllibหลังจบได้403 (ยังไม่ทราบสาเหตุ), ไม่เปลี่ยนauth/securityและไม่อ้างว่าผ่าน

Alarm readback14:44UTC: Production19alarmsOK; แยกเป็นKamal host4 + DB/Redis6 + legacy ECS
security/log/rollback9. เก้าตัวเดิมไม่ใช่หลักฐานว่าครอบคลุมKamal logsใหม่. ECS TargetTrackingอีก6ตัว
เป็นINSUFFICIENT_DATAหลังpark0/0; ไม่กล่าวว่าalarmsทุกตัวOK. ไม่แก้alarm/IAMเพื่อทำให้ผลผ่าน

[PR640](https://github.com/MangmeeDev/mangmeeplus/pull/640) mergeเข้าdevelop14:45:05UTC
เป็น`70d1359d18d2db977be57dc8f621a59fdb70cce6`. Same validatedheadcefa946b mergeเข้าmain
เป็น`ad4250871a313908c21a036b20d420008575c87a`, dry merge treeและผลจริงตรงกัน
`a81d0a7403c5640571cf0bb9c1c37dd6654a588b`. ไม่รันfullCIซ้ำบนappsourceเดิม

PR639ปิดเป็นdeliveredหลังPR640integrationครบ; ไม่mergehistoricalProdbranchเข้าทับmodernbranches.
ทั้งสองintegrationมีapprovaladminจากเจ้าของ; ไม่เปลี่ยนbranchprotectionและไม่ข้ามexact-headCI.
ไม่มีการdeploymain/developbacklogตามหลังการmerge. NativeKamalrollbackของรอบการ์ดมีprevioussnapshot
แต่ไม่ได้สลับกลับเพื่อจับเวลา; 15:59ด้านบนเป็นrollbackECSที่เกิดขึ้นจริงก่อนหน้านี้เท่านั้น
