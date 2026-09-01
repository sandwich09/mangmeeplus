# Agent Memory: owner-line-qr-expired-workaround

Status: ค้างที่ step "หา onboarding run ID" — รอ Owner รัน Session Manager จาก AWS Console

Owner: thawatchai

Scope: เคสโปรดักชัน ลูกค้า `Olive.wong` (companyId `cmtcn30q90ywx305mio9etpbi`, owner
`Monthakarn194`) ไม่ได้ล็อกอินครั้งแรก ทำให้ QR ผูก LINE ของเจ้าของหมดอายุ ต้องออก QR ใหม่
โดยไม่ทำลายรหัสผ่านที่ลูกค้าตั้งเอง

## Decisions

- **เคสนี้เป็น Case A** (QR หมดอายุอย่างเดียว) ยืนยันจากตาราง Members ในหน้า Partner Detail:
  คอลัมน์ LINE = `Not linked` และ Password = `—` โดย `—` มาจาก
  `hasTempPassword = tempPasswordEncrypted !== null` (`list-partner-members.use-case.ts:53`)
  ซึ่งถูกล้างเป็น null ตอนผู้ใช้เปลี่ยนรหัสเอง (`change-password.use-case.ts:42`)
  → เจ้าของตั้งรหัสผ่านของตัวเองแล้ว เข้าระบบได้ปกติ
- ต้องใช้ **Reissue owner LINE QR** เท่านั้น **ห้ามใช้ Regenerate temporary password**
  เพราะตัวหลังรีเซ็ตรหัสผ่านเสมอ จะทำให้เจ้าของเข้าไม่ได้ด้วยรหัสที่ใช้อยู่

## วิธีอ่านอาการจากหน้า Partner Detail (ไม่ต้องแตะ DB)

| LINE | Password | แปลว่า | ใช้ |
| --- | --- | --- | --- |
| `Not linked` | `—` | ตั้งรหัสเองแล้ว = Case A | Reissue owner LINE QR |
| `Not linked` | `••••••••` + `expires <อดีต>` | ไม่เคยเข้าระบบ = Case B | ออก QR + Reset password |

## ทำไมต้องมี onboarding run ID และหาไม่ได้จาก UI

- `POST /system/company-onboardings/:id/reissue-owner-line-link` รับเฉพาะ `CompanyOnboardingRun.id`
  (`reissue-owner-line-link.use-case.ts:26`) ไม่รับ companyId
- ไม่มี list endpoint — controller มีแค่ `@Get(':id')` (`system-onboarding.controller.ts:87`)
- run ID โผล่ครั้งเดียวบนหน้าจอตอนสร้างบริษัท (`SystemOnboardingNewPage.tsx:301`)
- audit row ตอนสร้างไม่ได้ใส่คอลัมน์ `companyId` (อยู่ใน `metadataJson`)
  (`create-company-onboarding.use-case.ts:341`) → หน้า audit ที่ scope ด้วย company หาไม่เจอ
- Partner Detail มีปุ่ม member แค่ **Unlink LINE** กับ **Reset/Reveal password**
  ไม่มีปุ่มออก QR (`partner.controller.ts:190–243`)
- เจ้าของที่มาจาก onboarding **ไม่ถูกสร้าง `EmployeeAccessProfile`** จึงใช้ปุ่ม
  "สร้าง QR เชื่อม LINE" ในหน้า Employee Access ไม่ได้

→ เหลือทางเดียวคืออ่าน `CompanyOnboardingRun` จาก prod DB

## Artifacts

- `4c81d0e1` fix(support): make bastion instance-count check portable to macOS
  — `connect-production.sh:64` เทียบ `wc -w` กับ `1` ตรงๆ แต่ BSD wc เติมช่องว่างนำหน้า
  ทำให้เคส instance เดียว (เคสปกติ) ตกไปเข้า branch "matches more than one running instance"
  ผลคือ **เปิด T1/T2 จากเครื่อง macOS ไม่ได้เลยมาตลอด** ยังไม่ push

## Verification

- ยืนยัน fix ด้วยการรัน case statement ทั้งสามกิ่งบน darwin:
  เดิม 1 instance → `FALLTHROUGH` (บั๊ก), ใหม่ → `MATCH`; ส่วน 0 → `ZERO` และ 2 → `FALLTHROUGH` ยังถูก
- `bash -n infra/support/connect-production.sh` ผ่าน
- ยังไม่ได้รัน query จริง — ติดสิทธิ์ (ดู Open questions)

## Open questions

- IAM user `watchdog-bedrock-dev` ไม่มี `ssm:StartSession` จึงเปิด T1 ไม่ได้
  (ผ่าน `ec2:DescribeInstances` และ `rds:DescribeDBInstances` แล้ว)
- มี profile `thawatchai` บนเครื่องที่เป็น **root access key** ของ account `311414082667`
  ควรลบทิ้งหลังจบเคสนี้

## Next

1. Owner เปิด AWS Console → Systems Manager → Session Manager → `watchdog-bms-ssm-bastion`
   (`i-0f3b3881690dcf874`, ap-southeast-1) แล้ว generate RDS auth token เชื่อม psql
   ในฐานะ `watchdog_support_ro`
2. `SELECT id, "createdAt" FROM "CompanyOnboardingRun" WHERE "companyId" = 'cmtcn30q90ywx305mio9etpbi' ORDER BY "createdAt" DESC;`
3. เอา run ID ไปวางที่ `/system/company-onboardings/new` → การ์ด Existing Onboarding Maintenance
   → ปุ่ม **Reissue owner LINE QR** → ส่ง `linkUrl` ให้ลูกค้าทางแชท (อายุ 72 ชม.)
4. ยืนยันผล: refresh Partner Detail คอลัมน์ LINE ของ `Monthakarn194` ต้องเป็น `Linked`
5. งานตามหลัง: เพิ่มช่องค้นหา onboarding run จาก companyId/ชื่อบริษัท ใต้ permission
   `system.company_onboarding.read` ที่มีอยู่แล้ว เพื่อไม่ต้องเปิด bastion ทุกครั้งที่เจอเคสนี้
