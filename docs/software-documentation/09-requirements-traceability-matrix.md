# 09 — ตารางโยงข้อกำหนด (Requirements Traceability Matrix)

เอกสารนี้โยงข้อกำหนดเชิงฟังก์ชันทุกข้อ (`FR-*`) ในเล่ม 02a–02f ไปยังแพ็กที่ได้ใช้ สิทธิ์ที่ต้องมี API หน้าจอ และจำนวนไฟล์ทดสอบที่อ้างถึง สร้างด้วยสคริปต์จากเนื้อหาของเล่ม 02a–02f โดยตรง (commit `08850deaf`) จึงตรงกับเล่มต้นทางทุกแถว รายละเอียดเต็มของแต่ละข้ออยู่ในเล่มที่ระบุ

## วิธีอ่าน

- **แพ็ก**: ถ้าเล่มต้นทางระบุแพ็กไว้ในข้อนั้น จะคัดข้อความมาตรง ๆ ถ้าลงท้ายด้วย `*` แปลว่าเล่มต้นทางไม่ได้ระบุรายข้อ ค่านี้กำหนดจากกฎระดับหมวดของเล่มนั้น (ดูหัวข้อ "ขอบเขต" ของแต่ละเล่ม และตารางฟีเจอร์ต่อแพ็กในเล่ม 01 ซึ่งเป็นตัวตัดสิน)
- **สิทธิ์ / API / หน้าจอ**: แสดง 2 รายการแรก และ `(+n)` คือจำนวนที่เหลือในเล่มต้นทาง
- **ทดสอบ**: จำนวนไฟล์ทดสอบที่ข้อนั้นอ้างถึง (ชื่อไฟล์ตรวจแล้วว่ามีจริงในโค้ด) `—` แปลว่าเล่มต้นทางไม่ได้อ้างไฟล์ทดสอบเฉพาะข้อ ไม่ได้แปลว่าไม่มีการทดสอบ
- ขอบเขตของชุดเอกสารคือทุกฟีเจอร์ที่ขายถึงแพ็ก `ENTERPRISE_1999` ข้อที่เป็น "นอกขอบเขต" คือมีโค้ดแต่ไม่อยู่ในแพ็กใด

## สรุปจำนวนข้อกำหนด

| AREA | เล่ม | ในขอบเขต | นอกขอบเขต | รวม |
|---|---|---:|---:|---:|
| CORE | 02a | 93 | 0 | 93 |
| EXP | 02b | 69 | 10 | 79 |
| TAX | 02c | 39 | 51 | 90 |
| CRM | 02d | 54 | 0 | 54 |
| LINE | 02e | 92 | 0 | 92 |
| BILL | 02f | 91 | 0 | 91 |
| **รวม** | | **438** | **61** | **499** |

## ดัชนีข้อกำหนดที่ไม่ใช่ฟังก์ชัน (NFR)

| ช่วงรหัส | เล่ม | เรื่อง |
|---|---|---|
| `NFR-001…034` | 03 | ข้อกำหนดระดับระบบ (ประสิทธิภาพ ความพร้อมใช้ ความปลอดภัย PDPA การดูแลรักษา ต้นทุน) |
| `NFR-101…126` | 02a | ระบบแกนกลาง การยืนยันตัวตน และสิทธิ์ |
| `NFR-EXP-01…14` | 02b | ค่าใช้จ่าย เบิกจ่าย เอกสาร |
| `NFR-301…312` | 02c | ภาษี บัญชี ธนาคาร รายงาน |
| `NFR-400…418` | 02d | การจัดการร้านค้า อายุแพ็กเกจ รายงานผู้บริหาร workflow |
| `NFR-501…520` | 02e | LINE และ AI |
| `NFR-BILL-001…016` | 02f | ระบบเก็บเงินและหลังบ้าน |
| `NFR-API-001…012` | 05 | API |
| `NFR-601…612` | 06 | หน้าจอและประสบการณ์ผู้ใช้ |
| `NFR-701…711` | 07 | การทดสอบและคุณภาพ |
| `NFR-801…818` | 08 | การติดตั้งและการดูแลระบบ |
| `NFR-901…913` | 04 | ฐานข้อมูล |

ข้อกำหนดทางธุรกิจ `BR-001…052` อยู่ในเล่ม 01 และข้อกำหนดเชิงหน้าจอ `FR-UI-001…024` กับ `FR-API-001…018` อยู่ในเล่ม 06 และ 05 ตามลำดับ (เป็นมุมมองตามชั้นของระบบ ซ้อนกับ FR ตาม AREA ด้านล่าง)


## เล่ม 02a

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-CORE-001 | ค้นหาช่องทางเข้าสู่ระบบ | [PUBLIC] | — | `GET /v1/auth/login-channels` | `/login` | 2 |
| FR-CORE-002 | เข้าสู่ระบบด้วยชื่อผู้ใช้/อีเมลและรหัสผ่าน | [ALL] (ล็อกอินได้แม้แพ็กหมดอายุแบบ term-disabled เพื่อเข้าหน้าต่ออายุ) | — | `POST /v1/auth/password/login` | `/login` | 7 |
| FR-CORE-003 | ลืมรหัสผ่าน — รหัสชั่วคราวทาง LINE | [ALL] | — | `POST /v1/auth/password/reset-request` | `/forgot-password` | 4 |
| FR-CORE-004 | ลืมรหัสผ่าน — ลิงก์รีเซ็ตทางอีเมล | [ALL] | — | `POST /v1/auth/password/email-reset-request`<br>`POST /v1/auth/password/email-reset-confirm` | `/forgot-password`<br>`/reset-password` | 2 |
| FR-CORE-005 | เปลี่ยนรหัสผ่าน และการบังคับเปลี่ยนรหัสผ่านชั่วคราว | [ALL] | `account.password.change` | `POST /v1/auth/password/change`<br>`GET /v1/auth/me` | `/change-password`<br>`/companies/*` (+2) | 3 |
| FR-CORE-006 | ตั้งรหัสผ่านครั้งแรกของบัญชี LINE-first | [ALL] | `account.password.change` | `POST /v1/auth/me/password/set` | `/companies/[companyId]/account`<br>`/companies/[companyId]/settings/profile` | 2 |
| FR-CORE-007 | การออก token, session และการหมุน refresh token | [ALL] | — | `POST /v1/auth/session/refresh` | — | 3 |
| FR-CORE-008 | ออกจากระบบ และยกเลิก session อื่น | [ALL] | `account.session.read` | `POST /v1/auth/logout`<br>`POST /v1/auth/sessions/revoke-others` | — | 1 |
| FR-CORE-009 | บริบทคำขอ (RequestContext) และ AuthGuard | [ALL] | — | — | — | 2 |
| FR-CORE-010 | เข้าสู่ระบบด้วย LINE บนเว็บ (OAuth Authorization Code + PKCE) | [ALL] | — | `POST /v1/auth/line/login/callback` | `/login` | 2 |
| FR-CORE-011 | เข้าสู่ระบบบนเดสก์ท็อปด้วย QR (LINE web QR transaction) | [ALL] | `account.session.read` | `POST /v1/auth/line/qr/create\|redeem\|approve` | `/login`<br>`/line-qr/[code]` | 2 |
| FR-CORE-012 | ลิงก์ handoff จาก LINE สู่เว็บ (single-use token) | [ALL] | — | `POST /v1/auth/line/handoff/exchange` | — | 3 |
| FR-CORE-013 | หน้า LIFF ที่ API ให้บริการ และการแลก LIFF session | [PUBLIC] / [ALL] | — | — | — | 5 |
| FR-CORE-014 | ผูกและยกเลิกผูก LINE identity ของบัญชี | [ALL] | `account.identity.link`<br>`account.identity.unlink` | `POST /v1/auth/line/link`<br>`POST /v1/auth/line/link/oauth` (+1) | `/companies/[companyId]/settings/profile` | 4 |
| FR-CORE-015 | พนักงานผูก LINE ด้วย QR/ลิงก์ที่ผู้ดูแลออกให้ | [ALL] | `access.employee.line_link.issue` | `POST /v1/auth/line/employee-link`<br>`GET /v1/auth/line/link-page/employee` | — | 1 |
| FR-CORE-016 | รวมบัญชี (account merge) เมื่อ LINE ถูกผูกกับบัญชีอื่นอยู่แล้ว | [ALL] | `account.identity.link` | `POST /v1/auth/account-merge`<br>`POST /v1/auth/account-merge/preview` | `/login`<br>`/api/auth/account-merge/ticket` | 1 |
| FR-CORE-017 | ยืนยันและเปลี่ยนอีเมลบัญชีด้วยรหัส OTP 6 หลัก | [ALL] (เข้าถึงได้แม้แพ็กหมดอายุ | `account.session.read`<br>`account.password.change` | `GET /v1/auth/account/email/otp`<br>`GET /v1/auth/account/email/otp/:id` (+4) | `/account/email`<br>`/companies/[companyId]/settings/profile` | 5 |
| FR-CORE-018 | เปิด/ปิดการเข้าสู่ระบบด้วยอีเมล และการยืนยันตัวตนซ้ำผ่าน LINE | [ALL] | `account.password.change` | `POST /v1/auth/account/email/otp/login-method`<br>`POST …/line-reauth/start` (+1) | `/account/email` | 2 |
| FR-CORE-019 | เข้าสู่ระบบด้วยอีเมล (email access OTP) | [PUBLIC] / [ALL] | — | `POST /v1/public/email-access/request\|confirm\|signup\|status` | `/email-access` | 1 |
| FR-CORE-020 | การยอมรับข้อกำหนดการใช้งานและประกาศความเป็นส่วนตัว (legal acceptance gate) | [ALL] | `account.session.read` | `GET\|POST /v1/auth/legal-acceptance` | `/legal-acceptance`<br>`/terms` (+2) | 3 |
| FR-CORE-021 | ข้อมูลบัญชีของตนเอง (me, บริษัทของฉัน, ชื่อที่แสดง, เบอร์ติดต่อ, ความปลอดภัยบัญชี, ผู้ช่วย AI) | [ALL] | `account.session.read`<br>`account.password.change` | — | `/companies/[companyId]/account`<br>`/companies/[companyId]/settings/profile` | 3 |
| FR-CORE-022 | เปิด/ปิดการเข้าใช้งานของลูกค้าทั้งแพลตฟอร์ม (platform access) | [PLATFORM] | `system.launch_gate.manage` | `GET /v1/auth/platform-access`<br>`GET\|PUT /v1/system/platform-access` | `/system/platform-access`<br>`/maintenance` | 2 |
| FR-CORE-023 | รับ webhook ของ LINE Messaging (OA ของระบบ) | [ALL] (รองรับ `ai_line_assistant`) | — | `POST /v1/line/webhook`<br>`POST /v1/webhooks/line` | — | 1 |
| FR-CORE-024 | ตอบกลับอัตโนมัติของ Official OA (เมนูติดต่อ/โซเชียล) | [PUBLIC] | — | `POST /v1/line/official/webhook` | — | 1 |
| FR-CORE-025 | การส่งอีเมลระบบ, เหตุการณ์จาก Postmark และคอนโซลตรวจการส่งอีเมล | [PLATFORM] | `system.email_delivery.read`<br>`system.email_delivery.manage` | `POST /v1/public/postmark-events`<br>`GET /v1/system/email-delivery` (+3) | `/system/email-delivery`<br>`/system/signup-requests/[id]/mail` | 5 |
| FR-CORE-026 | Dev token (เฉพาะเครื่องนักพัฒนา) | ไม่เกี่ยวกับแพ็ก (เครื่องมือพัฒนา) | — | `POST /v1/auth/dev/token` | — | 1 |
| FR-CORE-030 | ปฏิเสธโดยปริยาย (deny-by-default) และ metadata สิทธิ์ของ route | [ALL] | — | — | — | 3 |
| FR-CORE-031 | การ resolve สิทธิ์ของผู้ใช้ต่อบริษัท (permission resolver) | [ALL] | — | `GET /v1/auth/me` | — | 1 |
| FR-CORE-032 | การตัดสิทธิ์ตาม feature entitlement ของบริษัท | [ALL] (เป็นกลไกที่ทำให้ "แพ็กไหนได้อะไร" มีผลจริง) | — | — | — | 5 |
| FR-CORE-033 | ขอบเขตสาขา (branch scope ABAC) | [ALL] (จำนวนสาขาที่มีได้ขึ้นกับแพ็ก | `access.employee.update` | — | — | 5 |
| FR-CORE-034 | นโยบายขอบเขตผู้เช่า (tenant boundary) และเจ้าของรายการ (own record) | [ALL] | — | — | — | 1 |
| FR-CORE-035 | ผู้มีสิทธิ์จัดการแพ็กเกจ (plan manager) | [ALL] | `company.plan.manage` | `POST /v1/companies/:companyId/package-change-requests` | `/companies/[companyId]/billing`<br>`/companies/[companyId]/renew` | 1 |
| FR-CORE-036 | ทะเบียน permission, บทบาทระบบ และการ sync ลงฐานข้อมูล | [ALL] | — | — | — | 3 |
| FR-CORE-040 | ดูรายชื่อและรายละเอียดพนักงาน | [ALL] | `access.employee.read`<br>`access.employee.update` | `GET /v1/companies/:companyId/settings/employees`<br>`GET …/employees/:employeeId` | `/companies/[companyId]/settings/employees`<br>`/companies/[companyId]/settings/access-overview` | 3 |
| FR-CORE-041 | เพิ่มพนักงาน (wizard: ร่าง → ทำให้เสร็จ) และการผูกบัญชีที่มีอยู่แล้ว | [ALL] | `access.employee.create` | `POST /v1/companies/:companyId/settings/employees`<br>`POST …/employees/:employeeId/complete` | `/companies/[companyId]/settings/employees` | 4 |
| FR-CORE-042 | แก้ไขพนักงาน บทบาท ตำแหน่งงาน และขอบเขตสาขา | [ALL] | `access.employee.update` | `PATCH /v1/companies/:companyId/settings/employees/:employeeId` | `/companies/[companyId]/settings/employees`<br>`/companies/[companyId]/settings/access-overview` | 4 |
| FR-CORE-043 | ระงับ ปิด เปิดใช้งานพนักงาน และลบร่าง | [ALL] | `access.employee.disable` | `POST …/employees/:employeeId/disable`<br>`DELETE …/employees/:employeeId/draft` | `/companies/[companyId]/settings/employees` | 1 |
| FR-CORE-044 | ออกรหัสผ่านชั่วคราวใหม่ให้พนักงาน | [ALL] | `access.employee.credential.issue` | `POST /v1/companies/:companyId/settings/employees/:employeeId/credentials/regenerate` | `/companies/[companyId]/settings/employees` | 1 |
| FR-CORE-045 | ออกและเพิกถอน QR/ลิงก์ผูก LINE ของพนักงาน | [ALL] | `access.employee.line_link.issue`<br>`access.employee.line_link.revoke` | `POST …/employees/:employeeId/line-link-token`<br>`POST …/employees/:employeeId/line-link-token/revoke` | `/companies/[companyId]/settings/employees` | 2 |
| FR-CORE-046 | จัดการบทบาทของบริษัท | [ALL] | `access.role.read`<br>`access.role.manage` (+2) | `GET\|POST /v1/companies/:companyId/settings/roles`<br>`GET\|PATCH …/roles/:roleId` (+2) | `/companies/[companyId]/settings/permissions`<br>`/settings/roles` | 5 |
| FR-CORE-047 | แค็ตตาล็อก permission, capability pack และ role template | [ALL] (pack ที่ผูกกับฟีเจอร์ที่บริษัทไม่ได้เปิดจะไม่ให้สิทธิ์ที่ใช้งาน | `access.permission.read`<br>`access.role.manage` (+2) | `GET /v1/companies/:companyId/settings/permissions` | `/companies/[companyId]/settings/permissions` | 3 |
| FR-CORE-048 | สิทธิ์ที่มีผลจริง (effective access) และตารางสิทธิ์ (access matrix) | [ALL] | `access.effective.read`<br>`access.role.read` (+1) | — | `/companies/[companyId]/settings/access-overview`<br>`/companies/[companyId]/settings/permissions` | 1 |
| FR-CORE-049 | ฐานข้อมูลที่อยู่ไทย (address master) | [ALL] (เข้าถึงได้แม้แพ็กหมดอายุเมื่อมี permission ที่ตรง) | `access.employee.read`<br>`access.employee.create` (+4) | `GET /v1/companies/:companyId/settings/address-master` | `/companies/[companyId]/settings/profile` | 1 |
| FR-CORE-050 | แก้ข้อยกเว้นการ normalize entitlement (ผู้ดูแลระบบ) | [PLATFORM] | `system.entitlement_exception.manage` | `GET /v1/system/entitlement-exceptions`<br>`POST /v1/system/entitlement-exceptions/resolve` | `/system/partners/[companyId]` | 2 |
| FR-CORE-051 | สมัครเปิดร้านจากฟอร์มเว็บสาธารณะ (Flow B) | [PUBLIC] → ได้ `FREE_TRIAL_15` เมื่อ provision | — | — | `/signup`<br>`/signup/status/[requestId]` | 5 |
| FR-CORE-052 | Claim link: ตั้งรหัสผ่านหรือผูกกับบัญชีเดิม แล้วเปิดร้าน | [PUBLIC] | — | `POST /v1/public/signup-claims/info\|set-password\|attach` | `/claim-account`<br>`/signup/welcome` | 3 |
| FR-CORE-053 | สมัครเปิดร้านผ่าน LINE (LIFF, LINE-first) | [PUBLIC] → `FREE_TRIAL_15` | — | — | — | 9 |
| FR-CORE-054 | สมัครเปิดร้านด้วยอีเมล (email-first) | [PUBLIC] → `FREE_TRIAL_15` | — | `POST /v1/public/email-access/signup`<br>`POST /v1/public/email-access/status` | `/email-access` | 1 |
| FR-CORE-055 | คิวคำขอสมัครสำหรับผู้ดูแลระบบ และการตัดสิน | [PLATFORM] | `system.company_onboarding.read`<br>`system.company_onboarding.create` | — | `/system/signup-requests`<br>`/system/signup-requests/[id]/mail` | 4 |
| FR-CORE-056 | Provisioning ร้านจากคำขอสมัคร | [PUBLIC] → `FREE_TRIAL_15` | — | — | `/signup/welcome` | 3 |
| FR-CORE-057 | งานเบื้องหลังของการสมัคร: outbox drain, การเตือน, การหมดอายุ, เหตุการณ์ SES | [PLATFORM] | — | — | — | 5 |
| FR-CORE-058 | คำขอเปลี่ยนแพ็กเกจจากร้าน | [ALL] (ใช้ได้แม้ร้าน `DISABLED` เพราะแพ็กหมดอายุ; ร้าน `SUSPENDED`/`AR | `company.plan.manage` | `POST\|GET /v1/companies/:companyId/package-change-requests` | `/companies/[companyId]/renew`<br>`/companies/[companyId]/billing` | 1 |
| FR-CORE-059 | กล่องคำขอความช่วยเหลือจาก LINE (ผู้ดูแลระบบ) | [PLATFORM] | `system.partner_company.update` | `POST /v1/public/line-signups/support` | `/system/support-requests` | 2 |
| FR-CORE-060 | เปิดร้านให้ลูกค้า (company onboarding) | [PLATFORM] | `system.company_onboarding.create` | `POST /v1/system/company-onboardings` | `/system/company-onboardings/new` | 2 |
| FR-CORE-061 | อ่านผล onboarding, ออกรหัสผ่านชั่วคราวใหม่ของเจ้าของ, ออก QR ผูก LINE ของเจ้าของใหม่ | [PLATFORM] | `system.company_onboarding.read`<br>`system.company_onboarding.regenerate_temporary_password` | — | `/system/partners/[companyId]`<br>`/system/company-onboardings/new` | 2 |
| FR-CORE-062 | จัดการสาขา | [ALL] | `company.branch.read`<br>`company.branch.manage` | `GET\|POST /v1/companies/:companyId/branches`<br>`PATCH …/branches/:branchId` | `/companies/[companyId]/settings/branches` | 7 |
| FR-CORE-063 | ตัวตนของบริษัท: ข้อมูลร้าน ตัวตนทางภาษี และประเภทธุรกิจ | [ALL] (อ่าน/แก้ได้แม้แพ็กหมดอายุสำหรับผู้มีสิทธิ์ที่ตรง | `company.setup.read`<br>`company.setup.manage` (+2) | `GET\|PATCH /v1/companies/:companyId/identity`<br>`POST …/identity/complete-capture` (+1) | `/companies/[companyId]/settings/profile`<br>`/companies/[companyId]/account` | 7 |
| FR-CORE-064 | สถานะการจดทะเบียน VAT ของบริษัท (ข้อเท็จจริงแบบมีช่วงวันที่) | [ALL] (เส้นทางกู้คืนเมื่อแพ็กหมดอายุ) | `company.vat_registration.read`<br>`company.vat_registration.manage` | `GET\|PUT /v1/companies/:companyId/vat-registration` | `/companies/[companyId]/settings/profile` | 2 |
| FR-CORE-065 | ไฟล์แนบ: อัปโหลด ตรวจ ดาวน์โหลด ผูก และลบ | [ALL] | `attachment.create`<br>`attachment.read` (+1) | — | — | 9 |
| FR-CORE-066 | Storage adapter (S3 และ local) และ endpoint ของ local storage | ไม่เกี่ยวกับแพ็ก (โครงสร้างพื้นฐาน) | — | — | — | — |
| FR-CORE-067 | ลำดับเลขที่เอกสาร (document sequence) และการจองเลข | [ALL] (ใช้โดยเอกสารค่าใช้จ่าย/เบิกจ่ายของ starter preset และโมดูลอื่น) | `document.sequence.read`<br>`document.sequence.manage` | `GET /v1/companies/:companyId/document-sequences`<br>`PUT …/document-sequences/:documentType` | — | 5 |
| FR-CORE-068 | Outbox event (เขียนเหตุการณ์ในธุรกรรมเดียวกับข้อมูล) | [ALL] | — | — | — | 2 |
| FR-CORE-069 | การล้าง object version ใน storage (งานภายใน) | [PLATFORM] | — | — | — | 2 |
| FR-CORE-070 | การกำหนดสาขาของรายการธุรกรรม | [ALL] | — | — | — | 2 |
| FR-CORE-071 | บันทึก audit log | [ALL] | — | — | — | 3 |
| FR-CORE-072 | อ่าน audit log ของบริษัท | [ALL] | `audit.log.read` | `GET /v1/companies/:companyId/audit/logs` | — | 1 |
| FR-CORE-073 | เคสสิทธิ์เจ้าของข้อมูลและการยุติการใช้งาน (PDPA case control plane) | [PLATFORM] | `system.data_rights.manage` | — | `/system/data-rights`<br>`/system/data-rights/new` (+2) | 4 |
| FR-CORE-074 | แดชบอร์ดของบริษัท (snapshot) | [ALL-DN] | `dashboard.read`<br>`dashboard.snapshot.generate` | — | `/companies/[companyId]/dashboard` | 5 |
| FR-CORE-075 | ยอดค่าใช้จ่ายรายเดือนบนแดชบอร์ด | [ALL-DN] | `dashboard.read` | — | `/companies/[companyId]/dashboard` | 1 |
| FR-CORE-076 | ศูนย์แจ้งเตือน (กระดิ่ง) | [ALL-DN] | `notification.read` | — | `/companies/[companyId]/notifications` | 2 |
| FR-CORE-077 | ตั้งค่าการแจ้งเตือนของผู้ใช้ | [ALL-DN] | `notification.preference.manage` | — | `/companies/[companyId]/notifications/preferences`<br>`/companies/[companyId]/settings/notifications` | 2 |
| FR-CORE-078 | กฎการแจ้งเตือนของบริษัท | [ALL-DN] | `notification.rule.manage` | — | `/companies/[companyId]/notifications/rules`<br>`/companies/[companyId]/settings/notification-rules` | 1 |
| FR-CORE-079 | การส่งแจ้งเตือน (เว็บ + LINE push) และการลองใหม่ | [ALL-DN] | `notification.delivery.read`<br>`notification.delivery.retry` | — | — | 3 |
| FR-CORE-080 | งานกวาดของ worker สำหรับแดชบอร์ดและการแจ้งเตือน | [PLATFORM] (ทำงานให้บริษัทที่เปิด `dashboard_notifications`) | — | — | — | 2 |
| FR-CORE-081 | คำสั่งเปิด/ปิด launch gate และมุมมองสุขภาพการเปิดตัว | [PLATFORM] | `system.launch_gate.manage`<br>`system.launch_gate.read` | `POST /v1/system/launch-gates/commands`<br>`GET /v1/system/launch-gates/health` | `/system/platform-access` | 6 |
| FR-CORE-082 | การบังคับใช้ launch gate ขณะรัน (guard) | [ALL] (มีผลกับฟีเจอร์ที่ขาย: `expenses`, `cap.wht50bis`, LINE AI; และก | — | — | — | 3 |
| FR-CORE-083 | การสังเกตแบบ shadow และ ExecutionAttempt (ยังไม่เปิดบังคับ) | [PLATFORM] | — | `GET /v1/system/launch-gates/health` | — | 5 |
| FR-CORE-084 | วงจร runoff เมื่อปิดฟีเจอร์ของบริษัท | [PLATFORM] | — | — | — | 3 |
| FR-CORE-085 | Health check | ไม่เกี่ยวกับแพ็ก | — | `GET /v1/health`<br>`GET /v1/internal/health/readiness` | — | 1 |
| FR-CORE-086 | ธีมอีเวนต์ของหน้าแรกสาธารณะ | [PUBLIC] / [PLATFORM] | `system.home_theme.manage` | — | `/system/home-theme`<br>`/` (+1) | 3 |
| FR-CORE-087 | การกระทบยอดตัวตนภาษีของบริษัทโดยผู้ดูแลระบบ | [PLATFORM] | `system.identity_reconciliation.resolve` | — | — | 2 |
| FR-CORE-088 | Rate limiting | [ALL] | — | — | — | 3 |
| FR-CORE-089 | Endpoint ภายในของ worker (worker token) | [PLATFORM] | — | `internal/health/readiness`<br>`internal/notifications/*` (+4) | — | 2 |
| FR-CORE-090 | Idempotency และ fingerprint ของคำสั่ง | [ALL] | — | — | — | 1 |
| FR-CORE-091 | Validation, การจัดการข้อผิดพลาด, logging และ security event | [ALL] | — | — | — | 8 |
| FR-CORE-092 | การระบุ IP ของผู้ใช้จริงหลัง proxy | [ALL] | — | — | — | 1 |
| FR-CORE-093 | Proxy ของเว็บ: security header, CSRF, เส้นทางที่ต้องล็อกอิน, เบราว์เซอร์ที่ไม่รองรับ | [ALL] | — | — | — | 7 |
| FR-CORE-094 | BFF ของการยืนยันตัวตนและ cookie session | [ALL] | — | — | `/login`<br>`/change-password` (+3) | 15 |
| FR-CORE-095 | Layout ของ workspace, เมนู และการกันเส้นทาง | [ALL] | — | — | — | 10 |
| FR-CORE-096 | ศูนย์ตั้งค่าบริษัท (settings hub) | [ALL] | `company.settings.view`<br>`company.setup.manage` | — | `/companies/[companyId]/settings`<br>`/settings/profile` (+4) | 4 |
| FR-CORE-097 | หน้าบัญชีและความปลอดภัยของผู้ใช้เอง | [ALL] | — | — | — | 8 |
| FR-CORE-098 | หน้าสาธารณะ | [PUBLIC] | — | — | — | 4 |
| FR-CORE-099 | โครงหน้าของคอนโซลผู้ดูแลระบบ (`/system`) | [PLATFORM] | — | — | — | 2 |

## เล่ม 02b

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-EXP-001 | สร้างร่างรายจ่ายด้วยมือ | S/B/P/E | `expense.create`<br>`expense.receipt.upload` | `POST /expenses` | `/expenses/manual` | 6 |
| FR-EXP-002 | อัปโหลดใบเสร็จ (ไฟล์เดียว) | S/B/P/E และโหมดร่างฟรี (เฉพาะร่างของตน) | `expense.receipt.upload`<br>`expense.review` | `POST /expenses/receipt-uploads`<br>`POST /expenses/:expenseId/receipt-uploads/:attachmentId/complete` | `/expenses/upload` | 4 |
| FR-EXP-003 | Capture group (รับเอกสารหลายไฟล์ต่อหนึ่งรายการ) | S/B/P/E | `expense.receipt.upload`<br>`expense.create` (+3) | — | `/expenses/upload` | 9 |
| FR-EXP-004 | อ่านเอกสารด้วย AI (OCR / extraction) | S/B/P/E (นับโควตาใบเสร็จของแพ็ก); โหมดร่างฟรี 3 ใบ/เดือน | `expense.ocr.request`<br>`expense.review` (+1) | `POST /expenses/:expenseId/extraction-request`<br>`GET /expenses/:expenseId/read-status` (+1) | `/expenses/upload`<br>`/expenses/[expenseId]` | 5 |
| FR-EXP-005 | สถานะการอ่านและการ poll | S/B/P/E และโหมดร่างฟรี | `expense.read` | `GET /expenses/capture-groups/:groupId/read-status`<br>`GET /expenses/:expenseId/read-status` | — | 1 |
| FR-EXP-006 | โหมดร่างรายจ่ายฟรี และโควตา | ทุกแพ็ก* | `expense.read`<br>`attachment.read` (+1) | — | — | 1 |
| FR-EXP-007 | นโยบายการแสดงคำถามภาษี (capture policy) | ทุกแพ็ก* | — | `GET /expenses/capture-policy?on=` | — | 2 |
| FR-EXP-008 | รายการรายจ่าย ตัวกรอง และขอบเขตการอ่าน | ทุกแพ็ก* | `expense.read` | `GET /expenses` | `/expenses` | 6 |
| FR-EXP-009 | รายละเอียดรายจ่าย | ทุกแพ็ก* | `expense.read` | `GET /expenses/:expenseId`<br>`GET /expenses/:expenseId/source-posting-input` | `/expenses/[expenseId]` | 2 |
| FR-EXP-010 | แก้ร่างรายจ่าย | ทุกแพ็ก* | `expense.update` | `PATCH /expenses/:expenseId`<br>`PATCH /expenses/:expenseId/review-fields` | `/expenses/[expenseId]` | 6 |
| FR-EXP-011 | พรีวิวยอดรวม | ทุกแพ็ก* | `expense.update`<br>`expense.review` | `POST /expenses/:expenseId/totals-preview` | — | 2 |
| FR-EXP-012 | หมวดค่าใช้จ่าย | ทุกแพ็ก* | `expense.category.manage` | `GET /expense-categories`<br>`GET /expense-categories/manage` (+2) | `/expenses/categories` | 2 |
| FR-EXP-013 | รหัสบัญชีของนักบัญชีต่อหมวด | ทุกแพ็ก* | `expense.category.manage` | `PUT /expense-categories/:categoryId/accountant-account`<br>`DELETE /expense-categories/:categoryId/accountant-account` | `/expenses/categories` | — |
| FR-EXP-014 | ลบใบเสร็จ/หลักฐานออกจากรายจ่าย | ทุกแพ็ก* | `expense.update`<br>`expense.review` | `DELETE /expenses/:expenseId/receipts/:attachmentId` | — | 1 |
| FR-EXP-015 | Override การจัดประเภท "ไม่ใช่เอกสารรายจ่าย" | ทุกแพ็ก* | `expense.review` | `POST /expenses/:expenseId/non-expense-classification-override` | — | — |
| FR-EXP-016 | รับทราบส่วนต่างยอดรวมกับ OCR | ทุกแพ็ก* | `expense.review` | `POST /expenses/:expenseId/ocr-total-acknowledgement` | — | 1 |
| FR-EXP-017 | ตรวจและจัดการรายการซ้ำ | ทุกแพ็ก* | `expense.review`<br>`expense.duplicate.resolve` | `POST /expenses/:expenseId/duplicate-check`<br>`POST …/duplicates/:candidateId/dismiss` (+1) | — | 3 |
| FR-EXP-018 | สิทธิภาษีซื้อ (input VAT right) | ทุกแพ็ก* | `expense.review` | `POST /expenses/:expenseId/input-vat-decision`<br>`POST /expenses/:expenseId/buyer-match/confirm` | `/expenses/[expenseId]` | 3 |
| FR-EXP-019 | ส่งให้ตรวจ (mark ready) และรายชื่อผู้ตรวจ | ทุกแพ็ก* | `expense.update`<br>`expense.review` | `GET /expenses/:expenseId/reviewers`<br>`POST …/mark-ready` (+1) | `/expenses/[expenseId]` | — |
| FR-EXP-020 | ยืนยันรายจ่าย | ทุกแพ็ก* | `expense.confirm` | `POST /expenses/:expenseId/confirm` | `/expenses/[expenseId]` | 5 |
| FR-EXP-021 | ส่งกลับ/ไม่อนุมัติ (reject) | ทุกแพ็ก* | `expense.reject` | `POST /expenses/:expenseId/reject` | — | — |
| FR-EXP-022 | เปิดรายจ่ายที่ยืนยันแล้วกลับมาแก้ (reopen) | ทุกแพ็ก* | `expense.confirm` | `POST /expenses/:expenseId/reopen` | `/expenses/[expenseId]` | 1 |
| FR-EXP-023 | ยกเลิกรายจ่าย (void) | ทุกแพ็ก* | `expense.void` | `POST /expenses/:expenseId/void` | `/expenses/[expenseId]` | 2 |
| FR-EXP-024 | ประวัติกิจกรรมของรายจ่าย | ทุกแพ็ก* | — | `GET /expenses/:expenseId/history?page=` | — | — |
| FR-EXP-025 | ลบร่างรายจ่าย | ทุกแพ็ก* | `expense.delete`<br>`expense.update` | `DELETE /expenses/:expenseId` | — | 1 |
| FR-EXP-026 | บันทึกการจ่ายเงินรายจ่าย | ทุกแพ็ก* | `expense.payment.record` | `POST /expenses/:expenseId/payment`<br>`POST …/payments/slip-upload-intent` (+1) | `/expenses/[expenseId]` | 2 |
| FR-EXP-027 | ยกเลิกการจ่าย และยืนยันวันที่จ่าย | ทุกแพ็ก* | `expense.payment.record` | `POST /expenses/:expenseId/payments/:paymentId/cancel`<br>`POST …/payments/:paymentId/confirm-date` | — | — |
| FR-EXP-028 | ใบสำคัญรับเงิน (payment voucher PDF) | ทุกแพ็ก* | `expense.read` | `GET /expenses/:expenseId/payment-voucher.pdf` | — | 1 |
| FR-EXP-029 | ใบเตรียมจ่าย: จัดทำและแก้ไข | ทุกแพ็ก* | `expense.disbursement.prepare` | `GET /disbursement-vouchers/payees`<br>`GET …/payable-expenses` (+7) | `/expenses/disbursement-vouchers`<br>`/expenses/disbursement-vouchers/new` (+1) | 1 |
| FR-EXP-030 | ใบเตรียมจ่าย: ส่ง อนุมัติ ส่งกลับ ถอน ยกเลิก เตือน | ทุกแพ็ก* | — | `POST /disbursement-vouchers/:id/submit` | — | — |
| FR-EXP-031 | ใบสำคัญจ่าย: บันทึกจ่าย ออกจากการจ่ายเดิม ออกใบแทน และ PDF | ทุกแพ็ก* | `expense.disbursement.pay`<br>`expense.disbursement.issue` (+1) | `POST /disbursement-vouchers/:id/pay`<br>`POST /disbursement-vouchers/from-payment` (+3) | `/expenses/disbursement-vouchers/[id]` | — |
| FR-EXP-032 | ใบสำคัญจ่าย: ไฟล์ประกอบและหลักฐานการจ่าย | ทุกแพ็ก* | — | `GET /disbursement-vouchers/:id/supporting-files`<br>`POST …/supporting-files/slip-upload-intent` (+8) | — | 1 |
| FR-EXP-033 | ใบรับรองแทนใบเสร็จรับเงิน: จัดเตรียมและแก้ไข | ทุกแพ็ก* | `expense.review` | `POST /expenses/:expenseId/substitute-receipt`<br>`PATCH …/substitute-receipt/:evidenceId` (+6) | `/expenses/substitute-receipts/new`<br>`/expenses/substitute-receipts/[evidenceId]` | 11 |
| FR-EXP-034 | ใบรับรองแทนใบเสร็จ: ลงนามดิจิทัลและอนุมัติ | ทุกแพ็ก* | `expense.read_related`<br>`expense.confirm` | `POST …/:evidenceId/preview`<br>`POST …/:evidenceId/certify` (+3) | — | 2 |
| FR-EXP-035 | ใบรับรองแทนใบเสร็จ: ลงนามบนกระดาษ | ทุกแพ็ก* | `expense.review`<br>`expense.confirm` | `GET …/:evidenceId/form.pdf`<br>`POST …/paper/upload-intent` (+3) | — | — |
| FR-EXP-036 | ใบรับรองแทนใบเสร็จ: รายการ ไฟล์ที่ออก และพิมพ์ฉบับยกเลิก | ทุกแพ็ก* | `expense.review` | `GET /substitute-receipts`<br>`GET /substitute-receipts/candidates` (+3) | `/expenses/substitute-receipts` | 2 |
| FR-EXP-037 | นโยบายใบรับรองแทนใบเสร็จของร้าน | ทุกแพ็ก* | `company.setup.manage` | `GET /expense-settings/substitute-receipt`<br>`GET /expense-settings/substitute-receipt/runtime` (+1) | `/settings/substitute-receipt` | 1 |
| FR-EXP-038 | ลายเซ็นประจำตัว | ทุกแพ็ก* | `expense.signature.self_manage`<br>`expense.review` (+2) | `GET /expense-signatures`<br>`GET /expense-signatures/images/:attachmentId` (+5) | `/expenses/signatures` | — |
| FR-EXP-039 | หลักฐานทางบัญชี (shared evidence view) | ทุกแพ็ก* | `expense.evidence.read`<br>`expense.export` | `GET /expenses/shared-evidence` | `/expenses/evidence` | — |
| FR-EXP-040 | ชุดส่งนักบัญชี (accountant package) | ทุกแพ็ก* | `expense.export`<br>`expense.read` | `POST /expenses/accountant-package`<br>`POST /expenses/accountant-package/bundle-plan` (+1) | `/expenses/evidence` | 2 |
| FR-EXP-041 | ส่งออกเข้าโปรแกรมบัญชี (สมุดรายวันซื้อ) | ทุกแพ็ก* | `expense.export` | `POST /expenses/accounting-software-export` | — | 1 |
| FR-EXP-042 | สวิตช์ e-WHT ของร้าน | ทุกแพ็ก* | `company.setup.manage` | `GET /expense-settings/e-wht`<br>`PATCH /expense-settings/e-wht` | `/settings/e-wht` | — |
| FR-EXP-043 | หมวดเงินได้ WHT สำหรับฟอร์มรายจ่าย | ทุกแพ็ก* | `expense.create` | `GET /expenses/wht-income-categories` | — | — |
| FR-EXP-044 | จุดเชื่อมหนังสือรับรอง 50 ทวิ (ENTERPRISE_1999) | ENTERPRISE_1999 เท่านั้น (`wht_50bis`, `wht_pnd53`) | — | — | `/expenses/wht-certificates` | — |
| FR-EXP-045 | การรับรายจ่ายจาก LINE (ส่วนที่อยู่ในโมดูล expenses) | ทุกแพ็ก* | `expense.receipt.line_upload` | `GET /expenses/:expenseId/substitute-receipt/continuations/:workflowId` | — | 5 |
| FR-EXP-050 | สร้างและแก้ร่างใบเบิก | S/B/P/E | `reimbursement.create`<br>`reimbursement.update_own_draft` (+1) | `POST /reimbursements`<br>`PATCH /reimbursements/:requestId` (+1) | `/reimbursements/new`<br>`/reimbursements/[requestId]/edit` | 7 |
| FR-EXP-051 | รายการ ฮับ สรุป และรายละเอียดใบเบิก | ทุกแพ็ก* | `reimbursement.read`<br>`account.session.read` | `GET /reimbursements`<br>`GET /reimbursements/hub` (+2) | `/reimbursements`<br>`/reimbursements/[requestId]` | 2 |
| FR-EXP-052 | ส่งใบเบิก | ทุกแพ็ก* | `reimbursement.submit`<br>`reimbursement.finance_review` | `POST /reimbursements/:requestId/submit` | — | 2 |
| FR-EXP-053 | เส้นทางผู้อนุมัติ และผู้อนุมัติหลายบทบาท | ทุกแพ็ก* | — | `GET /reimbursement-policy/approver-options`<br>`GET /reimbursements/approval-queue` | — | 2 |
| FR-EXP-054 | อนุมัติ / ปฏิเสธ และ self-approval | ทุกแพ็ก* | `reimbursement.approve`<br>`reimbursement.reject` | `POST /reimbursements/:requestId/approve`<br>`POST …/reject` | `/reimbursements/[requestId]` | 2 |
| FR-EXP-055 | เปิดใบที่ถูกปฏิเสธกลับมาแก้ และ "ดำเนินการต่อ" | ทุกแพ็ก* | `reimbursement.update_own_draft`<br>`account.session.read` | `POST /reimbursements/:requestId/reopen`<br>`POST …/resume` | — | — |
| FR-EXP-056 | ตรวจการเงิน (finance review) | ทุกแพ็ก* | `reimbursement.finance_review`<br>`reimbursement.duplicate.resolve` (+1) | `POST /reimbursements/:requestId/finance-review`<br>`GET /reimbursements/finance-queue` | — | 1 |
| FR-EXP-057 | Projection: สร้างรายจ่ายจากใบเบิก | ทุกแพ็ก* | — | — | — | 3 |
| FR-EXP-058 | รายการซ้ำของใบเบิก | ทุกแพ็ก* | — | `POST /reimbursements/:requestId/finance-review` | — | — |
| FR-EXP-059 | บันทึกการจ่ายใบเบิก | ทุกแพ็ก* | `reimbursement.payment.record` | `POST /reimbursements/:requestId/payments`<br>`GET /reimbursements/posting/pending` | — | 2 |
| FR-EXP-060 | สลิปการจ่าย | ทุกแพ็ก* | `reimbursement.payment.record` | `POST /reimbursements/:requestId/payments/slip-upload-intent`<br>`POST …/payments/slip-uploads/:attachmentId/complete` (+2) | — | — |
| FR-EXP-061 | ยกเลิกการจ่ายใบเบิก | ทุกแพ็ก* | `reimbursement.payment.void` | `POST /reimbursements/:requestId/payments/:paymentId/void` | — | 1 |
| FR-EXP-062 | ยกเลิกใบเบิก ลบร่าง และถอนคำขอยกเลิก | ทุกแพ็ก* | `reimbursement.cancel_own`<br>`reimbursement.finance_review` (+1) | `DELETE /reimbursements/:requestId`<br>`POST …/cancel` (+1) | — | — |
| FR-EXP-063 | บัญชีรับเงินของสมาชิก (default และหลายบัญชี) | ทุกแพ็ก* | `reimbursement.create`<br>`access.employee.read` (+1) | `GET\|PUT\|DELETE /reimbursements/payout-accounts/me`<br>`POST …/payout-accounts/me/reveal` (+5) | `/reimbursements/payout-account` | — |
| FR-EXP-064 | ปลายทางรับเงินของใบเบิก และการแก้หลังอนุมัติ | ทุกแพ็ก* | `reimbursement.update_own_draft`<br>`reimbursement.finance_review` (+1) | `PUT /reimbursements/:requestId/payout-destination`<br>`POST …/payout-destination/reveal` (+1) | — | — |
| FR-EXP-065 | แบบฟอร์มใบเบิก ลายเซ็น และ "ลงนามหลังจ่าย" | ทุกแพ็ก* | `reimbursement.read` | `POST /reimbursements/:requestId/claim-form/preview`<br>`POST …/claim-form/signature-upload-intent` (+2) | — | 3 |
| FR-EXP-066 | สำเนาแบบฟอร์มที่ลงนามด้วยมือ | ทุกแพ็ก* | — | `POST /reimbursements/:requestId/claim-form/signed-copies` | — | — |
| FR-EXP-067 | นโยบายใบเบิก | ทุกแพ็ก* | `reimbursement.policy.read`<br>`reimbursement.policy.manage` | `GET /reimbursement-policy`<br>`PUT /reimbursement-policy` (+1) | `/reimbursements` | — |
| FR-EXP-068 | บันทึกภายใน, ร่างจาก LINE และส่งออกหลักฐาน | ทุกแพ็ก* | — | — | — | 3 |
| FR-EXP-070 | ทะเบียนคู่ค้า: รายการและรายละเอียด | S/B/P/E (ฝั่งผู้ขาย) | `accounting.counterparty.read`<br>`expense.read_related` (+6) | `GET /accounting/counterparties`<br>`GET /accounting/counterparties/:counterpartyId` | `/counterparties`<br>`/counterparties/[counterpartyId]` | 4 |
| FR-EXP-071 | ทะเบียนคู่ค้า: สร้างและแก้ไข | ทุกแพ็ก* | `accounting.counterparty.manage` | `POST /accounting/counterparties`<br>`PATCH /accounting/counterparties/:counterpartyId` | `/counterparties/[counterpartyId]` | — |
| FR-EXP-072 | บันทึกผู้ขายอัตโนมัติจากรายจ่าย | ทุกแพ็ก* | — | — | — | 3 |
| FR-EXP-073 | ใช้ที่อยู่ที่เคยเห็นเป็นที่อยู่หลัก | ทุกแพ็ก* | — | `POST /accounting/counterparties/:counterpartyId/promote-seen-address` | — | — |
| FR-EXP-074 | เอกสารขาย: ชนิด สร้าง แก้ (ไม่ได้ขาย) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET\|POST /accounting/documents`<br>`GET\|PATCH /accounting/documents/:documentId` (+1) | `/sales-documents`<br>`/sales` (+1) | 4 |
| FR-EXP-075 | เอกสารขาย: ออกเลข อนุมัติใบเสนอราคา แปลง ยกเลิก (ไม่ได้ขาย) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST /accounting/documents/:documentId/issue` | — | 5 |
| FR-EXP-076 | รับชำระเงิน (ไม่ได้ขาย) | นอกขอบเขต (ไม่มีในแพ็กใด)* | `accounting.payment.read` | `GET\|POST /accounting/payments`<br>`GET /accounting/payments/:paymentId` (+1) | — | — |
| FR-EXP-077 | บันทึกรายรับอย่างง่าย และหมวดรายรับ (ไม่ได้ขาย) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST /accounting/simple-income`<br>`GET /revenue-categories` (+3) | `/sales-documents/record-income`<br>`/sales-documents/revenue-categories` | — |
| FR-EXP-078 | สมุดรายรับ-รายจ่าย (ไม่ได้ขาย) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET /income-expense-ledger/availability` | `/income-expense-ledger` | 1 |
| FR-EXP-079 | PDF และการพิมพ์เอกสารที่ยกเลิก | ทุกแพ็ก* | — | — | — | 1 |
| FR-EXP-080 | แค็ตตาล็อก template และสถานะผู้ให้บริการ | นอกขอบเขต (ไม่มีในแพ็กใด)* | `ai.suggestion.read_own` | `GET /ai/suggestion-templates`<br>`GET /ai/provider-status` | `/ai-suggestions` | — |
| FR-EXP-081 | ขอคำแนะนำ | นอกขอบเขต (ไม่มีในแพ็กใด)* | `ai.suggestion.request`<br>`ai.draft.request` | `POST /ai/suggestions/requests`<br>`POST /internal/ai/draft-requests/drain` (+1) | — | 3 |
| FR-EXP-082 | สร้างคำแนะนำ (generation) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 3 |
| FR-EXP-083 | อ่านและตรวจคำแนะนำ | นอกขอบเขต (ไม่มีในแพ็กใด)* | `ai.suggestion.read_own`<br>`ai.suggestion.read` (+1) | `GET /ai/suggestions`<br>`GET /ai/suggestions/:id` (+1) | — | 2 |
| FR-EXP-084 | ตรวจและสร้างร่างในโมดูลต้นทาง | นอกขอบเขต (ไม่มีในแพ็กใด)* | `ai.draft.review`<br>`ai.draft.create_source_draft` | `POST /ai/suggestions/:id/actions/:actionId/validate`<br>`POST /ai/suggestions/:id/actions/:actionId/create-source-draft` | — | 2 |

## เล่ม 02c

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-TAX-001 | สร้างรายการ "ต้องออก 50 ทวิ" (handoff) จากรายการจ่าย | ทุกแพ็ก (pack `pack.wht.certificate.manage` ไม่ผูก feature) | — | — | `/expenses/wht-certificates` | 2 |
| FR-TAX-002 | ดูรายการ / ค้นหา / รายละเอียด handoff และประวัติใบของรายจ่าย | ทุกแพ็ก | `wht.certificate.read`<br>`wht.certificate.issue` (+2) | `GET wht/payment-handoffs`<br>`GET wht/payment-handoffs/:handoffId` (+1) | `/expenses/wht-certificates` | 5 |
| FR-TAX-003 | เติมที่อยู่ผู้รับเงินที่ prefill ไม่มี | ทุกแพ็ก | `wht.external_certificate.link`<br>`wht.certificate.issue` | `POST wht/payment-handoffs/:handoffId/payee-address` | — | 2 |
| FR-TAX-004 | จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ (link / change / remove + แนบไฟล์) | ทุกแพ็ก | `wht.external_certificate.link` | `POST wht/payment-handoffs/:id/external-certificate/file-upload-intent`<br>`POST …/external-certificate/file-uploads/:attachmentId/complete` (+4) | `/expenses/wht-certificates` | 2 |
| FR-TAX-005 | ออกหนังสือรับรอง 50 ทวิ ในระบบจาก handoff | `ENTERPRISE_1999` (feature `wht_50bis`); ร้านเดิมที่มี `thai_tax` คงสิ | `wht.certificate.issue` | `POST wht/payment-handoffs/:handoffId/system-certificate` | `/expenses/wht-certificates` | 4 |
| FR-TAX-006 | ดาวน์โหลด 50 ทวิ ที่ระบบออกแล้ว | ทุกแพ็กที่มีใบอยู่ (การออกต้อง ENTERPRISE) | — | `GET wht/payment-handoffs/:handoffId/system-certificate` | — | — |
| FR-TAX-007 | แก้ไข 50 ทวิ ที่ระบบออก (ออกเลขใหม่ แทนใบเดิม) | ทุกแพ็ก (ไม่ผูก feature | `wht.certificate.correct` | `POST wht/payment-handoffs/:handoffId/system-certificate/correction` | — | 1 |
| FR-TAX-008 | ออกใบแทน (สำเนาเลขเดิม) | ทุกแพ็ก | `wht.certificate.correct` | `POST wht/payment-handoffs/:handoffId/system-certificate/replacement-copy` | — | 1 |
| FR-TAX-009 | โครง PDF หนังสือรับรอง 50 ทวิ | ทุกแพ็ก* | — | — | — | 1 |
| FR-TAX-010 | ลายเซ็นบน 50 ทวิ | `ENTERPRISE_1999` (`wht_50bis`) หรือ legacy `thai_tax` | `company.tax_signature.manage` | `GET tax/profile/signature`<br>`PATCH tax/profile/signature` | `/settings/tax-signature` | 2 |
| FR-TAX-011 | ประเภทเงินได้หัก ณ ที่จ่าย (catalog กลางของระบบ) | การใช้งาน (เลือกประเภทในรายจ่าย) ทุกแพ็ก; การเปิด/ปิดทำโดย SYSTEM_ADMI | `system.wht_income_category.manage`<br>`tax.config.read` (+1) | — | `/system/wht-income-categories` | 2 |
| FR-TAX-012 | เลือกแบบ ภ.ง.ด. จากชนิดผู้รับเงิน | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-013 | ปันส่วนฐานเงินได้และภาษีตามการจ่ายแต่ละครั้ง | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-014 | ฐานเงินได้ที่คำนวณย้อนจากภาษี | ทุกแพ็ก* | — | — | — | 1 |
| FR-TAX-015 | ดึงรายการหักภาษีเข้างวด (sync) | `ENTERPRISE_1999` | `wht.pnd53.prepare` | — | — | 5 |
| FR-TAX-016 | หน้ารายเดือนภาษีหัก ณ ที่จ่าย | `ENTERPRISE_1999` | `wht.pnd53.read` | `GET tax/withholding/months`<br>`GET tax/withholding/months/:periodKey` | `/tax/withholding`<br>`/tax/pnd53` | 3 |
| FR-TAX-017 | ใครเป็นผู้จ่ายและหักภาษี (payer mode) และสถานประกอบการ | ใช้กับ ภ.ง.ด. (`ENTERPRISE_1999`); หน้าตั้งค่าอยู่ใต้ตั้งค่าสาขา (ทุกแ | `wht.pnd53.read`<br>`company.legal_identity.manage` (+1) | `GET tax/withholding/payer-mode?periodKey=`<br>`POST tax/withholding/payer-mode` | — | 1 |
| FR-TAX-018 | ตรวจความพร้อมของแบบก่อนดาวน์โหลด | ทุกแพ็ก* | — | — | — | 2 |
| FR-TAX-019 | ดาวน์โหลดแบบ ภ.ง.ด.3 / ภ.ง.ด.53 (PDF บนแบบกรมสรรพากร) | `ENTERPRISE_1999` | `wht.pnd53.prepare` | `POST tax/pnd53/periods/:periodId/export`<br>`POST tax/withholding/:formType/periods/:periodId/export` | — | — |
| FR-TAX-020 | "รายการให้ผู้ทำบัญชี" (XLSX ของ ภ.ง.ด.) | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-021 | แบบเพิ่มเติม (ยื่นเพิ่มเติมครั้งที่ N) | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-022 | บันทึกว่ายื่นแบบแล้ว | `ENTERPRISE_1999` | `wht.pnd53.prepare` | `PATCH tax/pnd53/periods/:periodId/mark-filed`<br>`PATCH tax/withholding/:formType/periods/:periodId/mark-filed` | — | — |
| FR-TAX-023 | ยืนยันแถวของแบบที่ยื่นไว้ก่อนระบบแช่แข็งแถว | ทุกแพ็ก* | `wht.pnd53.prepare` | `POST tax/withholding/filings/:filingId/confirm-rows` | — | — |
| FR-TAX-024 | รายการที่ต้องแก้ (review issues) ของ ภ.ง.ด. | ทุกแพ็ก* | — | `GET tax/pnd53/periods/:periodId/review-issues`<br>`PATCH tax/pnd53/review-issues/:issueId/resolve` | — | — |
| FR-TAX-025 | e-WHT (ธนาคารนำส่งภาษี) | การตั้งค่าและเลือกในรายจ่าย: ทุกแพ็ก (อยู่ใน feature `expenses`); รายง | `company.setup.manage`<br>`wht.pnd53.read` | — | — | 2 |
| FR-TAX-026 | สรุปยอดแบบ (WHT report snapshot) | ทุกแพ็ก* | `wht.pnd53.prepare`<br>`tax.report.recompute` | — | — | — |
| FR-TAX-027 | ประวัติใบ 50 ทวิ ต่อรายการ | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-028 | การเปิดแก้รายจ่ายที่มีใบ 50 ทวิ / ยื่นแบบแล้ว | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-029 | เครื่องมือ LINE AI ที่อ่านข้อมูลภาษีหัก ณ ที่จ่าย | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-030 | มุมมองหลักฐานทางบัญชี (shared evidence) | ทุกแพ็ก* | `expense.evidence.read`<br>`expense.export` | `GET expenses/shared-evidence` | `/expenses/evidence` | 4 |
| FR-TAX-031 | ไฟล์สรุปรายจ่ายสำหรับผู้ทำบัญชี (workbook) | ทุกแพ็ก* | — | `POST expenses/accountant-package` | — | 2 |
| FR-TAX-032 | แผนชุดเอกสาร (bundle plan) และดาวน์โหลด ZIP | ทุกแพ็ก* | — | `POST expenses/accountant-package/bundle-plan`<br>`POST expenses/accountant-package/bundle/:part` | — | 2 |
| FR-TAX-033 | PDF หนึ่งไฟล์ต่อหนึ่งรายการ และกฎตั้งชื่อไฟล์ในชุด | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-034 | แผ่น "รายงานภาษีซื้อ" (รูปแบบรายงานภาษีซื้อของกรมสรรพากร) | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-035 | สิทธิภาษีซื้อที่มีผล (input VAT right) | ทุกแพ็ก* | — | — | — | 1 |
| FR-TAX-036 | ไฟล์นำเข้าโปรแกรมบัญชี — "สมุดรายวันซื้อ" | ทุกแพ็ก* | — | `POST expenses/accounting-software-export` | — | — |
| FR-TAX-037 | การผูกหมวดค่าใช้จ่ายกับรหัสบัญชีของผู้ทำบัญชี | ทุกแพ็ก* | — | — | — | — |
| FR-TAX-040 | ตั้งค่า tax code เริ่มต้นให้ร้านใหม่ (bootstrap) | ทุกแพ็ก (ทำงานตอน onboarding) | — | — | — | — |
| FR-TAX-041 | ผังบัญชีมาตรฐานเริ่มต้น | ทุกแพ็ก (เบื้องหลัง); หน้าจัดการผังบัญชีต้องมี `double_entry_ledger` ( | — | — | — | 1 |
| FR-TAX-050 | โปรไฟล์ภาษีของร้าน (company tax identity) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/profile` | — | — |
| FR-TAX-051 | งวดภาษีและรายการภาษี | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-052 | รายงาน VAT (ภ.พ.30 / ภ.พ.36) จาก tax event | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST tax/periods/:periodId/vat-report` | — | 1 |
| FR-TAX-053 | กล่อง ภ.พ.30 (PP30 boxes) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/reports/pp30-boxes` | — | — |
| FR-TAX-054 | การคำนวณภาษีรายบรรทัด (transaction tax) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST tax/resolve-preview` | — | 2 |
| FR-TAX-055 | Tax code profile และ template | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/code-profiles`<br>`GET tax/code-profile-templates` (+6) | `/settings/tax-codes` | 3 |
| FR-TAX-056 | Tax code definition และการนำเข้า | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/code-definitions`<br>`POST tax/code-definitions` (+2) | — | 1 |
| FR-TAX-057 | การกำหนดบัญชีภาษี (account determination) และ report mapping | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/account-determination`<br>`PUT tax/account-determination` (+2) | `/settings/tax-accounts` | — |
| FR-TAX-058 | หลักฐานภาษีการค้า (trade evidence) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET tax/trade-evidence`<br>`POST tax/trade-evidence` (+1) | `/tax/evidence` | 2 |
| FR-TAX-059 | กระทบยอดภาษี (tax reconciliation) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST tax/reconciliations`<br>`GET tax/reconciliations` (+2) | `/tax/reconciliation` | 2 |
| FR-TAX-060 | ชุดไฟล์ตรวจภาษี (generic filing package) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST tax/periods/:periodId/filing-packages` | — | 1 |
| FR-TAX-061 | บันทึกยื่น/ชำระ (แบบที่ไม่ใช่ ภ.ง.ด.3/53) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-062 | ออก 50 ทวิ จาก tax event (ทาง Tax workspace แบบเดิม) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 1 |
| FR-TAX-063 | Review issues ทั่วไป | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-064 | ปฏิทินภาษีเงินได้นิติบุคคล (CIT) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-065 | แก้ข้อมูลภาษีรุ่นเก่า (legacy remediation) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-066 | ขั้นตอนตั้งค่าบัญชีและภาษี (setup wizard) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | `/settings/accounting-tax-setup`<br>`/profile` (+5) | 1 |
| FR-TAX-070 | ผังบัญชี (chart of accounts) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET chart-of-accounts`<br>`GET chart-of-accounts/:accountId` (+2) | `/settings/chart-of-accounts` | 2 |
| FR-TAX-071 | Template ผังบัญชี (preview / apply) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET chart-of-accounts/templates`<br>`GET …/templates/:templateKey/preview` (+1) | — | 3 |
| FR-TAX-072 | ความพร้อมของผังบัญชี (readiness) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-073 | สมุดรายวัน: ดู / สร้าง manual / ผ่านรายการ / กลับรายการ | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET journal-entries`<br>`GET journal-entries/:journalId` (+3) | `/journal` | 5 |
| FR-TAX-074 | สร้างรายการบัญชีจากเอกสารต้นทาง | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST posting/generate` | — | 5 |
| FR-TAX-075 | กฎลงบัญชี default (ร้านที่ยังไม่มีผังบัญชีแบบ governed) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 3 |
| FR-TAX-076 | ผูกหมวดค่าใช้จ่ายกับบัญชี (expense account binding) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET posting/expense-account-bindings`<br>`PUT posting/expense-account-bindings/:categoryId` | `/settings/accounting-tax-setup/mappings` | 2 |
| FR-TAX-077 | ลงบัญชีรายจ่ายอัตโนมัติ (`expense_auto_post`) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST internal/ledger/expense-auto-post/drain` | — | 2 |
| FR-TAX-078 | ลงบัญชีย้อนหลัง (expense backfill) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET posting/expense-backfill-preview`<br>`POST posting/expense-backfill` | — | 1 |
| FR-TAX-079 | งวดบัญชี | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET periods`<br>`POST periods/ensure/:periodKey` | — | 1 |
| FR-TAX-080 | ตรวจก่อนปิดงวด (close checks) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST periods/:periodId/close-checks` | — | 3 |
| FR-TAX-081 | ปิดงวด / เปิดงวดคืน | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST periods/:periodId/close`<br>`POST periods/:periodId/unclose` | `/period-closing` | — |
| FR-TAX-082 | รายงานบัญชี (GL / งบทดลอง / กำไรขาดทุน / ฐานะการเงิน) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET reports/general-ledger`<br>`GET reports/trial-balance` (+2) | — | 1 |
| FR-TAX-083 | ส่งออกรายงานบัญชี | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST reports/:reportType/export` | — | — |
| FR-TAX-084 | สมุดรายรับ-รายจ่าย (`/income-expense-ledger`) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 1 |
| FR-TAX-090 | บัญชีธนาคารของร้าน | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET bank-accounts`<br>`GET bank-accounts/:id` (+3) | `/banking?tab=accounts` | 1 |
| FR-TAX-091 | นำเข้า statement: สกัดข้อมูล (extract) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST bank-accounts/:bankAccountId/statement-imports/extract` | — | — |
| FR-TAX-092 | นำเข้า statement: preview และ commit | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST …/statement-imports/preview`<br>`POST …/statement-imports/commit` (+2) | `/banking?tab=import` | 3 |
| FR-TAX-093 | เพิ่มรายการเดินบัญชีด้วยมือ / ยกเลิกการนำเข้า | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-094 | แนะนำคู่จับ (match candidates) และคะแนน | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET bank-accounts/:id/match-candidates` | — | 2 |
| FR-TAX-095 | ยืนยัน / ปฏิเสธ / ยกเลิกการจับคู่ และข้ามรายการ | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST statement-lines/:id/matches`<br>`POST matches/:matchId/reject` (+2) | `/banking?tab=matching` | — |
| FR-TAX-096 | รอบกระทบยอด (reconciliation session) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET reconciliations`<br>`GET reconciliations/:sessionId` (+3) | `/banking?tab=reconciliations` | 1 |
| FR-TAX-097 | รายการปรับปรุงธนาคาร (bank adjustment) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET adjustments`<br>`GET adjustments/:id` (+4) | `/banking?tab=adjustments` | — |
| FR-TAX-098 | สถานะเงินสด (cash position) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET cash-position` | `/banking?tab=cash` | — |
| FR-TAX-099 | ทดสอบ end-to-end ของ Banking | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 2 |
| FR-TAX-110 | แคตตาล็อกรายงาน | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET reports/catalog` | — | — |
| FR-TAX-111 | รันรายงาน (query) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST reports/query` | — | — |
| FR-TAX-112 | คอลัมน์และการคำนวณของรายงานการเงิน/บัญชี | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-113 | คอลัมน์ของรายงานรายจ่าย / ภาษี / ธนาคาร | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-114 | คอลัมน์ของรายงานขาย / สินค้า / งานระบบ / AI | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | — |
| FR-TAX-115 | มุมมองที่บันทึกไว้ (saved views) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `GET reports/views`<br>`POST reports/views` (+2) | — | — |
| FR-TAX-116 | ส่งออกรายงานเป็น CSV | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST reports/exports`<br>`GET reports/exports` (+1) | — | 2 |
| FR-TAX-117 | เจาะดูต้นทาง (drilldown) | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | `POST reports/drilldown` | — | — |
| FR-TAX-118 | รั้วสิทธิ์ตาม entitlement และการแข่งขัน | นอกขอบเขต (ไม่มีในแพ็กใด)* | — | — | — | 7 |

## เล่ม 02d

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-CRM-001 | รายการร้านลูกค้า | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_dashboard.read` | `GET /v1/system/partners` | `/system/partners` | 2 |
| FR-CRM-002 | รายละเอียดร้านลูกค้า | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_dashboard.read` | `GET /v1/system/partners/:partnerCompanyId` | `/system/partners/[companyId]` | 2 |
| FR-CRM-003 | แก้โปรไฟล์ร้านและป้ายรายงาน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `PATCH /v1/system/partners/:partnerCompanyId` | `/system/partners/[companyId]` | 3 |
| FR-CRM-004 | แก้ตัวตนทางกฎหมายของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.identity_reconciliation.resolve`<br>`system.partner_company.update` | `GET /v1/system/partners/address-master`<br>`GET\|PATCH /v1/system/partners/:partnerCompanyId/identity` | `/system/partners/[companyId]` | 1 |
| FR-CRM-005 | บันทึกทีมของร้าน (company team note) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_dashboard.read`<br>`system.partner_company.update` (+2) | `GET\|PUT /v1/system/partners/:partnerCompanyId/team-note` | `/system/partners/[companyId]`<br>`/system/executive/companies/[targetCompanyId]` | 1 |
| FR-CRM-006 | เปลี่ยนสถานะวงจรชีวิตของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.lifecycle.manage` | `POST /v1/system/partners/:partnerCompanyId/lifecycle` | `/system/partners/[companyId]` | 1 |
| FR-CRM-007 | รายชื่อสมาชิกของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.read` | `GET /v1/system/partners/:partnerCompanyId/members` | `/system/partners/[companyId]` | 1 |
| FR-CRM-008 | ยกเลิกการผูก LINE ของสมาชิก | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | — | 1 |
| FR-CRM-009 | ออก QR ผูก LINE ใหม่ให้สมาชิก | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `POST /v1/system/partners/:partnerCompanyId/members/:memberUserId/line-link-token` | — | 1 |
| FR-CRM-010 | รีเซ็ตรหัสผ่านชั่วคราวของสมาชิก | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `POST …/members/:memberUserId/password/reset` | — | 1 |
| FR-CRM-011 | เปิดดูรหัสผ่านชั่วคราวที่ระบบออกให้ | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `POST …/members/:memberUserId/password/reveal` | — | 1 |
| FR-CRM-012 | แก้อีเมล/เบอร์โทรของสมาชิก | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `PATCH …/members/:memberUserId/contact` | — | 1 |
| FR-CRM-013 | แก้ชื่อที่แสดงของบัญชีเจ้าของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.manage` | `PATCH …/members/:memberUserId/display-name` | — | — |
| FR-CRM-014 | ค้นหาผู้ใช้ข้ามร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_member.read` | `GET /v1/system/users/lookup` | `/system/partners`<br>`/system/users` | 1 |
| FR-CRM-015 | ตั้ง feature entitlements ของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_feature.manage` | `PUT /v1/system/partners/:partnerCompanyId/features` | `/system/partners/[companyId]` | 3 |
| FR-CRM-016 | สวิตช์ทางเข้าเว็บของ "บันทึกด้วยมือ" | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_feature.manage` | `PUT …/manual-expense-web-entry` | — | 3 |
| FR-CRM-017 | สวิตช์ทางเข้าเว็บของ "ใบสำคัญจ่าย" | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | `PUT …/disbursement-voucher-web-entry` | — | — |
| FR-CRM-018 | ตอบ/แก้สถานะจดทะเบียน VAT ของร้านแทนลูกค้า | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `PUT …/vat-registration` | — | — |
| FR-CRM-019 | ตั้งโมเดล AI และงบ AI รายเดือนของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_ai_model.manage` | `PUT …/ai-model` | `/system/partners/[companyId]` | 3 |
| FR-CRM-020 | ตั้งค่า OCR และโควตาอ่านใบเสร็จของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_ai_model.manage` | `PUT …/ocr-config` | — | — |
| FR-CRM-021 | มิเตอร์การใช้ AI ของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_dashboard.read`<br>`system.partner_ai_model.manage` | `GET …/ai-usage` | — | 1 |
| FR-CRM-022 | ประวัติการปรับ AI ของร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_ai_model.manage` | `GET …/ai-adjustments?cursor=` | — | — |
| FR-CRM-023 | กระทบยอดเครดิต AI ที่ค้างกัน (credit holds) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_dashboard.read`<br>`system.partner_ai_model.manage` | `GET …/ai-credit-holds`<br>`POST …/ai-credit-holds/:reservationId/{release\|charge-at-bound\|acknowledge-breach}` | — | 1 |
| FR-CRM-024 | งบ AI ระดับแพลตฟอร์ม | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_ai_model.manage` | `GET\|PUT /v1/system/ai-budget` | `/system/ai-budget` | 1 |
| FR-CRM-025 | กุญแจ LINE Messaging API ของ OA กลาง | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.shared_line_credential.manage` | `GET /v1/system/line/shared-credentials`<br>`PUT /v1/system/line/shared-credentials/:credentialKind` | `/system/line-settings` | 1 |
| FR-CRM-026 | ไทม์ไลน์ของร้าน (เครื่องมือซัพพอร์ต) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.company_onboarding.read` | `GET …/timeline` | — | 2 |
| FR-CRM-027 | ส่งข้อความ LINE จากผู้ดูแลถึงร้าน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `POST …/line-message` | — | 2 |
| FR-CRM-028 | คิวคำขอเปลี่ยนแพ็กเกจจาก LINE | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `GET /v1/system/package-change-requests`<br>`POST /v1/system/package-change-requests/:id/decision` | `/system/signup-requests` | 1 |
| FR-CRM-029 | อ่าน plan term และประวัติการปรับของร้าน | ทุกแพ็ก (พื้นผิวของผู้ดูแล) | `system.partner_dashboard.read` | `GET …/plan-term`<br>`GET …/plan-term/history?cursor=` | `/system/partners/[companyId]` | 2 |
| FR-CRM-030 | ตั้ง/แก้ plan term (แพ็กและขีดจำกัด) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `PUT /v1/system/partners/:partnerCompanyId/plan-term` | — | 1 |
| FR-CRM-031 | ต่ออายุ plan term | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | `POST …/plan-term/renew` | — | 1 |
| FR-CRM-032 | ยุติเพดาน warm-up ก่อนกำหนด | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.partner_company.update` | `POST …/plan-term/end-warmup` | — | — |
| FR-CRM-033 | ขีดจำกัดสาขาและพนักงานตามแพ็ก | ทุกแพ็กที่มีแถว term; ค่าขีดจำกัดตามตารางต้นส่วนนี้ หรือค่าที่ผู้ดูแลต | — | — | — | 2 |
| FR-CRM-034 | โควตาอ่านใบเสร็จต่อเดือนและข้อความเมื่อเต็ม | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-CRM-035 | กวาดอายุแพ็กเกจ: ปิดร้านที่หมดอายุ แจ้งเตือน และลบร้านเดโม | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | `POST /v1/internal/plan-term/sweep` | — | 2 |
| FR-CRM-036 | สถานะอายุแพ็กสำหรับผู้ใช้ของร้าน และการล็อกเมื่อหมดอายุ | ทุกแพ็ก | `account.session.read` | `GET /v1/plan-term/notice` | — | 5 |
| FR-CRM-037 | สิทธิ์ใช้ฟรีแบบร่างค่าใช้จ่ายหลังช่วงทดลองหมด (free expense drafts) | `FREE_TRIAL_15` ที่หมดอายุเท่านั้น | — | — | — | 2 |
| FR-CRM-038 | บริบทของรายงาน (context) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read` | `GET /v1/system/executive/context` | `/system/executive` | 2 |
| FR-CRM-039 | ภาพรวม (overview) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read` | `GET /v1/system/executive/overview` | `/system/executive` | 2 |
| FR-CRM-040 | รายการร้าน (companies directory) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read`<br>`system.executive.contact.read` | `GET /v1/system/executive/companies` | `/system/executive/companies` | 2 |
| FR-CRM-041 | การวิเคราะห์ (usage / revenue / customers / compare) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read` | `GET /v1/system/executive/analysis` | `/system/executive/usage`<br>`/system/executive/revenue` (+2) | 5 |
| FR-CRM-042 | รายละเอียดร้านและประวัติเหตุการณ์ | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read`<br>`system.executive.contact.read` | `GET /v1/system/executive/companies/:targetCompanyId`<br>`GET …/:targetCompanyId/history?page&pageSize` | `/system/executive/companies/[targetCompanyId]` | 2 |
| FR-CRM-043 | แก้บันทึกทีมจากหน้ารายงาน | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read`<br>`system.executive.company_note.manage` | `PATCH /v1/system/executive/companies/:targetCompanyId` | — | — |
| FR-CRM-044 | ส่งออกรายงานเป็น XLSX | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive.read`<br>`system.executive.export` (+1) | — | — | 2 |
| FR-CRM-045 | สร้างตารางสรุปของรายงาน (rebuild) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | `POST /v1/internal/executive/rebuild` | — | 2 |
| FR-CRM-046 | จัดการบัญชีผู้บริหาร | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | `system.executive_user.manage` | `GET\|POST /v1/system/executive-users`<br>`GET /v1/system/executive-users/:userId` (+3) | `/system/executive-users`<br>`/system/executive-users/new` (+1) | 2 |
| FR-CRM-047 | รับเหตุการณ์จาก outbox และจับคู่กับกฎ | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 4 |
| FR-CRM-048 | รันกฎ: dedup, cooldown, เงื่อนไข และ action | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-CRM-049 | ทำ action ที่ปลอดภัย, retry และ dead letter | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 4 |
| FR-CRM-050 | สแกนตามเวลา/ค่าเกณฑ์/SLA | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-CRM-051 | เทมเพลตที่เปิดอัตโนมัติให้ทุกร้าน (แจ้งเตือนการเบิกจ่าย) | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-CRM-052 | ปิดงานอนุมัติเมื่อใบเบิกเปลี่ยนสถานะ | ระบบหลังบ้าน/เบื้องหลัง (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-CRM-053 | รายการประเภทเงินได้สำหรับหักภาษี ณ ที่จ่าย | ทุกแพ็กผ่าน `expense.create` (ฟีเจอร์ `expenses.manual`); การออกแบบ ภ. | `procurement.supplier_payment.read`<br>`expense.create` | `GET /v1/companies/:companyId/accounts-payable/wht-income-categories` | — | — |
| FR-CRM-054 | บทบาทที่ได้รับยกเว้นกฎ maker-checker | ทุกแพ็ก (ผ่านฟีเจอร์ `expenses`) | — | — | — | — |

## เล่ม 02e

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-LINE-001 | รับ webhook ของ OA หลักและตรวจลายเซ็น | P-PUBLIC | — | `POST /v1/line/webhook`<br>`POST /v1/webhooks/line` | — | 1 |
| FR-LINE-002 | แปลง event เป็น envelope และแยก control ของ postback | P-PUBLIC | — | — | — | 2 |
| FR-LINE-003 | Message buffer: รวมหลายฟอง กันซ้ำ และกู้ event ค้าง | P-PUBLIC | — | `POST /v1/internal/ai/line-ledger/sweep-orphan-events` | — | 4 |
| FR-LINE-004 | Official OA: ตอบคำสำคัญด้วยการ์ดสำเร็จรูป | P-PUBLIC | — | `POST /v1/line/official/webhook` | — | 1 |
| FR-LINE-005 | กุญแจ LINE Messaging ที่ใช้ร่วมกัน: อ่านสถานะและเปลี่ยนกุญแจ | ไม่ใช่ของร้าน (พื้นผิวผู้ดูแลระบบ) | `system.shared_line_credential.manage` | `GET /v1/system/line/shared-credentials`<br>`PUT /v1/system/line/shared-credentials/:credentialKind` | `/system/line-settings` | 1 |
| FR-LINE-006 | ส่งข้อความกลับ: reply, push, loading และบันไดข้อความรอ | P-PUBLIC | — | — | — | 2 |
| FR-LINE-007 | Delivery plan v2: แช่แข็งคำตอบก่อนส่ง แบ่งชุด และส่งต่อเมื่อผู้ใช้ขอ | P-PUBLIC | — | — | — | 4 |
| FR-LINE-008 | Ledger ของ turn, การ reclaim และงาน drain ภายใน | P-ALL (ผูกกับ `ai_line_assistant`) | — | `POST /v1/internal/ai/line-ledger/drain`<br>`POST /v1/internal/ai/line-ledger/sweep-orphan-events` (+2) | — | 4 |
| FR-LINE-010 | ระบุตัวตนจาก LINE และการ์ดประตูสำหรับคนที่ยังไม่มีบัญชี | P-PUBLIC | — | — | — | 2 |
| FR-LINE-011 | ต้อนรับเมื่อเพิ่มเพื่อน | P-PUBLIC | — | — | — | 2 |
| FR-LINE-012 | เปิดร้านใหม่ผ่าน LIFF (สมัครอัตโนมัติ) | P-PUBLIC (ผลลัพธ์คือร้านใหม่ที่ยังไม่มีแพ็ก; สิทธิ์ P-FREE เริ่มหลังเป | — | `GET /v1/auth/line/link-page/signup`<br>`GET /v1/auth/line/link-page.js` (+4) | — | 4 |
| FR-LINE-013 | ประตูพนักงานและการเชื่อม LINE ของพนักงาน | P-ALL (`employee_access`) | — | `POST /v1/auth/line/employee-link`<br>`POST /v1/auth/line/link` (+4) | — | 1 |
| FR-LINE-014 | เลือกบริษัทและการ์ด "บริษัทของฉัน" | P-PUBLIC (ร้านที่ถูกล็อกยังเลือกได้ เพื่อไปซื้อแพ็ก) | — | — | — | 3 |
| FR-LINE-015 | ด่านยอมรับเอกสารกฎหมาย | P-PUBLIC | — | — | `/companies/:companyId` | 2 |
| FR-LINE-016 | ด่าน PDPA: ผู้ใช้ปิดการประมวลผลด้วย AI | P-PUBLIC | — | — | — | 1 |
| FR-LINE-017 | ร้านที่ถูกล็อกและสิทธิ์ใช้ฟรี | P-FREE และร้านที่หมดอายุ | `company.plan.manage` | — | — | 3 |
| FR-LINE-018 | ลิงก์เข้าเว็บแบบแตะครั้งเดียวและหน้า LIFF "เริ่มใช้งาน" | P-PUBLIC | — | `POST /v1/auth/line/handoff/exchange`<br>`POST /v1/auth/line/liff/session` (+1) | `/l/<token>` | 2 |
| FR-LINE-019 | ข้อจำกัดของแชตกลุ่มและห้อง | P-ALL | — | — | — | 1 |
| FR-LINE-020 | Rich menu ของ OA หลัก | P-PUBLIC | — | `/v2/bot/richmenu*` | — | — |
| FR-LINE-021 | เมนูหลัก (เมนูพนักงานแบบ quick reply) | P-ALL | — | — | — | 1 |
| FR-LINE-022 | เมนูถามข้อมูล | P-ALL | — | — | — | 1 |
| FR-LINE-023 | การ์ดรายการรออนุมัติ | คิวใบเบิก P-ALL (`reimbursement`); คิวจัดซื้อไม่มีแพ็ก | `reimbursement.approve`<br>`procurement.purchase_request.approve` (+1) | — | `/companies/:companyId/reimbursements?tab=approvals` | 2 |
| FR-LINE-024 | เชิญส่งใบเสร็จ | P-ALL และ P-FREE (`expenses.upload`) | `expense.receipt.line_upload`<br>`expense.receipt.upload` (+1) | — | — | 1 |
| FR-LINE-025 | การ์ดบริการที่ร้านเปิดใช้ | P-ALL | — | — | — | 1 |
| FR-LINE-026 | การ์ดติดต่อเรา | P-PUBLIC | — | — | — | 1 |
| FR-LINE-027 | ปุ่ม "คุยกับน้องมั่งมี" และคำทักทายตรงตัว | P-PUBLIC (คำตอบ AI ที่ตามมาต้องผ่าน PRE-AI) | — | — | — | 1 |
| FR-LINE-028 | คำถาม "ทำอะไรได้บ้าง" | P-PUBLIC (คนแปลกหน้า), P-ALL (ผู้ใช้ที่ผูกบัญชี) | — | — | — | 2 |
| FR-LINE-029 | โปรโมชั่นและแพ็กเกจ | P-PUBLIC | — | — | — | 2 |
| FR-LINE-030 | คำตอบนโยบายสาธารณะ | P-PUBLIC | — | — | — | 2 |
| FR-LINE-031 | Fixed read: ค่าใช้จ่ายเดือนนี้ | P-ALL | `expense.read`<br>`expense.list_recent` | `POST /v1/internal/ai/tools/invoke` | `/companies/:companyId/expenses` | 2 |
| FR-LINE-032 | "ฉันมีส่วนลดไหม" (ส่วนลดจากงานอีเวนต์) | P-PUBLIC ถึง P-ALL | — | `GET /v1/auth/line/link-page/event-discount` | — | 1 |
| FR-LINE-033 | จำรูปแบบคำตอบที่ชอบ | P-ALL | — | — | — | 2 |
| FR-LINE-034 | ชวนใส่อีเมลหรือเบอร์กันบัญชีหลุด | P-PUBLIC | — | — | — | 1 |
| FR-LINE-040 | ซื้อหรือเปลี่ยนแพ็กเกจผ่านแชต | P-PUBLIC (ใช้ได้กับร้านที่ถูกล็อกและร้านที่ไม่มี AI) | `company.plan.manage` | — | `/companies/:companyId/billing?channel=line` | 2 |
| FR-LINE-041 | คำขอเปลี่ยนแพ็กเกจ (ทางสำรอง) | P-PUBLIC (รวมร้านที่หมดอายุ ซึ่งมาที่แชตเพื่อทำสิ่งนี้) | — | — | — | 1 |
| FR-LINE-042 | ขอให้ทีมงานติดต่อกลับเรื่องแพ็กเกจ | P-PUBLIC | — | — | — | 1 |
| FR-LINE-043 | ผู้ช่วยเลือกแพ็กเกจ (LIFF package advisor) | P-PUBLIC | — | `GET /v1/auth/line/link-page/package-advisor`<br>`GET /v1/auth/line/package-advisor.js` (+2) | — | — |
| FR-LINE-044 | ติดต่อเจ้าหน้าที่ การพัก AI 24 ชั่วโมง และการกลับมาคุยกับ AI | P-PUBLIC | — | `POST /v1/system/partners/:partnerCompanyId/line-message` | — | 3 |
| FR-LINE-050 | ส่งรูปหรือไฟล์ใบเสร็จผ่าน LINE เพื่อสร้างร่างรายจ่าย | P-ALL และ P-FREE (`expenses.upload`); จำนวนใบต่อเดือนตามแพ็ก: FREE 3,  | `expense.receipt.line_upload`<br>`expense.receipt.upload` (+1) | `POST /internal/ai/receipt-ocr`<br>`POST /internal/ai/capture-read` (+3) | — | 8 |
| FR-LINE-051 | รูปที่ระบบยังไม่แน่ใจ: ถามกลับ เอกสารที่ไม่ใช่ใบเสร็จ และใบแจ้งยอด (check bill) | P-ALL, P-FREE | — | — | — | 3 |
| FR-LINE-052 | ถามผลของไฟล์ที่เพิ่งส่ง และปุ่มอ่านซ้ำ | P-ALL (`expenses`) | — | — | — | 1 |
| FR-LINE-053 | แนบสลิปเป็นหลักฐานการจ่ายของรายจ่ายที่มีอยู่ | P-ALL | — | — | — | — |
| FR-LINE-054 | ถามคำถามเกี่ยวกับเอกสารที่ส่งมา (Document QA) | P-ALL | — | `POST /internal/ai/line-document-qa`<br>`POST /v1/internal/ai/line-document-qa/drain` | — | 4 |
| FR-LINE-055 | ส่งรูปลายเซ็นเข้าคลังลายเซ็น | P-ALL (`expenses.signatures`) | — | `expenses/signatures` | — | — |
| FR-LINE-056 | ใบรับรองแทนใบเสร็จ: เตรียมและทำต่อผ่านแชต | P-ALL (`expenses`) | `expense.read`<br>`expense.read_own` (+3) | — | — | 2 |
| FR-LINE-060 | ตัวจำแนกงาน (workflow classifier) หนึ่งการเรียกต่อข้อความ | P-ALL | — | `POST /internal/ai/line-workflow-classify` | — | 1 |
| FR-LINE-061 | เริ่มงานจากเมนู จากคำสั่งพิมพ์ และตัวเลือกงาน | ตามตาราง 8.2 | — | — | — | 3 |
| FR-LINE-062 | สร้างใบเบิกผ่านแชต | P-ALL (`reimbursement`) | `reimbursement.create`<br>`reimbursement.draft.preview_create` | — | — | 4 |
| FR-LINE-063 | ส่งใบเบิกเพื่ออนุมัติ และยกเลิกใบเบิก | P-ALL | — | — | — | 2 |
| FR-LINE-064 | อนุมัติและไม่อนุมัติใบเบิก | P-ALL | `reimbursement.approve`<br>`reimbursement.reject` | — | — | 2 |
| FR-LINE-065 | บันทึกจ่ายคืนใบเบิก | P-ALL | — | — | — | 1 |
| FR-LINE-066 | ส่งตรวจ ยืนยัน ลบร่าง และยกเลิกรายจ่าย | P-ALL | — | — | — | 2 |
| FR-LINE-067 | บันทึกจ่ายรายจ่าย | P-ALL | — | — | — | 2 |
| FR-LINE-068 | ใบเตรียมจ่าย (ใบสำคัญจ่าย) | P-ALL (`expenses`) | `expense.disbursement.read` | — | — | 1 |
| FR-LINE-069 | ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) | P-ENT (`wht_50bis`) | `wht.certificate.issue` | — | — | — |
| FR-LINE-070 | แก้ร่างรายจ่ายด้วยข้อความ (S-4 draft edit) | P-ALL | `expense.update` | `POST /v1/internal/ai/tools/invoke`<br>`POST /internal/ai/line-draft-edit-capability` | — | 3 |
| FR-LINE-071 | เพิ่มและแก้ไขคู่ค้า ผู้ขาย หรือผู้รับเงิน | P-ALL (tool ผูกกับ feature `expenses` หรือ `sales_documents`) | `accounting.counterparty.read`<br>`accounting.counterparty.manage` | — | — | 1 |
| FR-LINE-072 | เพิ่มและแก้ไขพนักงานและสาขา | P-ALL (`employee_access`, `company_settings.branches`); จำนวนตามแพ็ก ( | — | — | — | 2 |
| FR-LINE-073 | บันทึกรายจ่ายด้วยข้อความ และการแก้ร่างที่เพิ่งบันทึก | P-ALL | `expense.create` | `POST /internal/ai/line-intake-route` | — | 2 |
| FR-LINE-080 | ขอบเขตภายในของ gateway: ความลับร่วม guard และโหมดบำรุงรักษา | ไม่ผูกกับแพ็กโดยตรง (ผู้เรียกเป็นผู้ตรวจแพ็ก) | — | — | — | 5 |
| FR-LINE-081 | Intake router: จำแนกเส้นทางของข้อความก่อนลงมือ | P-ALL | `ai.tool.invoke` | `POST /internal/ai/line-intake-route` | — | 3 |
| FR-LINE-082 | AI turn: สามเส้นทางของการประมวลผล | P-ALL | — | `POST /internal/ai/line-turn` | — | 4 |
| FR-LINE-083 | Orchestrator และวงเรียก tool | P-ALL | — | `POST /v1/internal/ai/tools/invoke` | — | 8 |
| FR-LINE-084 | Semantic turn v2: วางแผนทั้งคำขอและตอบทุกส่วน | P-ALL | — | `POST /internal/ai/line-turn` | — | 4 |
| FR-LINE-085 | Prepared simple read: คำตอบอ่านข้อมูลแบบเร็วที่โค้ดประกอบเอง | P-ALL (family ของ `sales.*` และ `accounting.get_summary` ต้องมี featur | — | — | — | 4 |
| FR-LINE-086 | Agent registry และ specialist | ตาม tool | — | `GET /internal/ai/agents` | — | 4 |
| FR-LINE-087 | อธิบายรายการรายจ่าย ("ทำไมยอดเป็นแบบนี้") | P-ALL | — | — | — | 2 |
| FR-LINE-088 | ที่ปรึกษารายจ่าย ความรู้ที่อนุมัติ และคำแนะนำการใช้ผลิตภัณฑ์ | P-ALL; การ์ดและคำแนะนำภาษีหัก ณ ที่จ่ายผูกกับ P-ENT ตาม feature ของการ | — | — | — | 3 |
| FR-LINE-089 | บุคลิก "น้องมั่งมี" การคุยเล่น และคลังมุข | P-ALL | — | — | — | 3 |
| FR-LINE-090 | ผู้เรียบเรียงคำตอบและการตรวจ grounding | P-ALL | — | — | — | 4 |
| FR-LINE-091 | Coverage critic: ตรวจว่าตอบครบทุกคำขอ | P-ALL **เงื่อนไขก่อนทำ** เส้นวง tool แบบ native | — | — | — | 1 |
| FR-LINE-092 | นโยบายขอบเขต: เรื่องนอกแพ็กและคำขอทำรายการ | P-ALL | — | — | — | 1 |
| FR-LINE-093 | ความปลอดภัยของบทสนทนาและการปฏิเสธ | P-ALL **เงื่อนไขก่อนทำ** — | — | — | — | 3 |
| FR-LINE-094 | การเรียก tool ของ ERP: delegation, การตรวจสิทธิ์ซ้ำ และ audit | ตาม feature ของ tool | `ai.tool.invoke` | `POST /v1/internal/ai/tools/invoke` | — | 6 |
| FR-LINE-095 | ทะเบียน tool | ตามคอลัมน์สุดท้าย | — | `POST /v1/internal/ai/tools/invoke` | — | 6 |
| FR-LINE-096 | การเลือกผู้ให้บริการและโมเดล | — | `system.partner_ai_model.manage` | `PUT /v1/system/partners/:partnerCompanyId/ai-model` | — | 4 |
| FR-LINE-097 | Prompt caching และโครงสร้างของ prompt | — **เงื่อนไขก่อนทำ** ผู้ให้บริการ Bedrock (Converse) หรือ Anthropic AP | — | — | — | 2 |
| FR-LINE-098 | อ่านเอกสาร: receipt-ocr, capture-read, capture-extract, bank-statement-extract | `receipt-ocr`, `capture-*`: P-ALL และ P-FREE; `bank-statement-extract` | — | `POST /internal/ai/receipt-ocr` | — | 2 |
| FR-LINE-099 | คำถามทั่วไปของผู้ที่ไม่มีบริบทส่วนตัว และการค้นข้อมูลสาธารณะ | ขึ้นกับการรับเข้า; ช่องทางที่อนุญาตตั้งด้วย `LINE_AI_DELIVERY_PLAN_V2_ | — | `POST /internal/ai/line/public-general` | — | 4 |
| FR-LINE-100 | AgentCore runtime | — | — | `POST /invocations`<br>`GET /ping` | — | 4 |
| FR-LINE-101 | AI แนะนำ (ai-draft) | เมนู `ai-suggestions` ผูกกับ `ai_line_assistant` (P-ALL) แต่แม่แบบทั้ง | `ai.suggestion.request`<br>`ai.suggestion.read_own` (+3) | `POST/GET /v1/companies/:companyId/ai/suggestions…`<br>`GET …/ai/suggestion-templates` (+4) | `/companies/[companyId]/ai-suggestions` | 3 |
| FR-LINE-102 | AI ของ CRM ใน gateway (crm-customer-ai) | ไม่มีแพ็กขาย (ต้องมี feature `crm` / `crm.inbox` / `line_oa`) ดูหัวข้อ | — | `POST /internal/ai/crm-*` | `/companies/[companyId]/settings/line-oa` | 2 |
| FR-LINE-110 | วัดการใช้ AI ทุกการเรียก | ทุกแพ็กที่ใช้ AI | `system.partner_dashboard.read` | `GET /v1/system/partners/:partnerCompanyId/ai-usage` | — | 5 |
| FR-LINE-111 | เพดานความปลอดภัยค่า AI ต่อเดือน | ทุกแพ็ก | `system.partner_ai_model.manage` | `GET /v1/system/ai-budget`<br>`PUT /v1/system/ai-budget` (+2) | `/system/ai-budget` | 3 |
| FR-LINE-112 | เครดิตแชต AI: ล็อต ลำดับการใช้ และรอบแพ็กเกจ | P-ALL: เครดิตเริ่มต้น 50 ต่อรอบ (`DEFAULT_CHAT_CREDIT_SATANG = 5_000`, | `system.partner_ai_model.manage` | — | — | 5 |
| FR-LINE-113 | จองก่อนเรียก ชำระหลังเรียก (reservation / step / settle) | ทุกแพ็กที่ใช้ AI | — | `POST /v1/internal/ai/budget-step`<br>`POST /v1/internal/ai/budget-settle` | — | 4 |
| FR-LINE-114 | ไม่คิดเงินร้านเมื่อการเรียก AI ล้มเหลว | ทุกแพ็กที่ใช้ AI | — | `POST /v1/internal/ai/budget-settle` | — | 2 |
| FR-LINE-115 | ข้อความเมื่อเครดิตหรืองบ AI ไม่พอ | ทุกแพ็ก | `company.plan.manage` | — | — | 2 |
| FR-LINE-116 | สิทธิ์อ่านเอกสาร (OCR governance) และอัตราแลกเปลี่ยน | ตามจำนวนใบของแพ็ก (FR-LINE-050) และ add-on `RECEIPT_IMAGE_20` (349 บาท | `system.partner_ai_model.manage` | `PUT /v1/system/partners/:partnerCompanyId/ocr-config` | — | 4 |
| FR-LINE-117 | การจัดการเงินจองที่ค้างโดยผู้ดูแล | — | `system.partner_dashboard.read`<br>`system.partner_ai_model.manage` | `/v1/system/partners/:partnerCompanyId/` | — | 2 |
| FR-LINE-120 | ลิงก์เดโม่สำหรับเซลล์ | ร้านเดโม่ถูกสร้างเป็น `ENTERPRISE_1999` พร้อม feature ตาม `TIER_FEATUR | `sales.demo_link.create` | `POST/GET /v1/sales/demo-links`<br>`PATCH /v1/sales/demo-links/:id` (+3) | `/sales/demo-links`<br>`/system/demo-links` (+2) | 10 |
| FR-LINE-121 | แชท LINE จำลองบนเว็บของร้านเดโม่ | ร้านเดโม่ (FR-LINE-120) | `account.session.read` | `POST /v1/companies/:companyId/demo-chat/messages`<br>`POST …/demo-chat/files` (+1) | — | 7 |

## เล่ม 02f

| รหัส | ชื่อ | แพ็ก | สิทธิ์ | API | หน้าจอ | ทดสอบ |
|---|---|---|---|---|---|---:|
| FR-BILL-001 | แค็ตตาล็อกแพ็กเกจสาธารณะ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/billing/catalog` | `/companies/[companyId]/billing` | 3 |
| FR-BILL-002 | สถานะ billing ของร้าน (หน้าแพ็กเกจ) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /`<br>`POST /refresh` | — | 5 |
| FR-BILL-003 | ขอใบเสนอราคา (Quote) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /quote`<br>`GET /capacity?offerKey&interval` | `/companies/[companyId]/billing/preview` | 9 |
| FR-BILL-004 | เริ่มชำระเงิน (Checkout) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /checkout` | — | 5 |
| FR-BILL-005 | ดู/กลับไปจ่าย/ยกเลิกรายการชำระเงิน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /attempts/:attemptId`<br>`POST /attempts/:attemptId/resume` (+1) | `/companies/[companyId]/billing/return` | 2 |
| FR-BILL-006 | ประวัติการชำระเงินและเอกสาร (ใบแจ้งหนี้/ใบเสร็จ/ใบลดหนี้) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /history`<br>`GET /invoices/:documentId/adjustments/:kind` (+1) | `/companies/[companyId]/billing`<br>`/billing/invoices/[invoiceId]` | 2 |
| FR-BILL-007 | ส่งเอกสารซ้ำทางอีเมล | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /documents/:documentId/resend`<br>`POST /invoices/:id/send` (+1) | — | 1 |
| FR-BILL-008 | ผู้รับเอกสาร (อีเมล) และการเปลี่ยนด้วย OTP | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /recipient`<br>`POST /recipient/otp/request` (+4) | — | 5 |
| FR-BILL-009 | ข้อมูลออกเอกสารของบริษัท (billing profile gate) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | `/billing/preview` | 3 |
| FR-BILL-010 | เลือกสาขา/ผู้ใช้ที่คงไว้เมื่อเกินเพดาน (capacity selection และการซ่อม) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /capacity`<br>`POST /attempts/:attemptId/capacity` (+1) | — | 1 |
| FR-BILL-011 | ยกเลิก/กลับมาต่ออายุอัตโนมัติ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /collection/preview`<br>`GET /collection/:id` (+1) | — | 3 |
| FR-BILL-012 | Downgrade ปลายรอบ (และยกเลิก downgrade) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-013 | Upgrade ทันทีแบบคิดส่วนต่าง | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-014 | ซื้อซ้ำ/ต่ออายุล่วงหน้า (REPEAT) และเปลี่ยนแพ็กของแบบจ่ายครั้งเดียว | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-015 | เริ่มใหม่หลังสิทธิ์หมด (RESTART) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-016 | จัดการบัตร (Stripe Billing Portal) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /portal` | — | — |
| FR-BILL-017 | ต่ออายุด้วย QR (PromptPay renew) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-018 | ใช้ส่วนลดจากงาน (event discount) ตอนซื้อ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /event-discount`<br>`POST /quote` | — | 3 |
| FR-BILL-019 | โปรโมชันแถมเดือน (promotion campaign) ตอนซื้อ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-020 | ชำระข้อเสนอพิเศษจากทีมขาย (sales deal) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 7 |
| FR-BILL-021 | ยกยอดใบเสร็จช่วงทดลองเมื่อซื้อครั้งแรก (trial carryover) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-030 | รับ webhook จาก Stripe | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /v1/public/stripe-events` | — | 1 |
| FR-BILL-031 | ประมวลผล event (drain) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /v1/internal/billing/drain` | — | — |
| FR-BILL-032 | กระทบสถานะบัญชีกับ Stripe (reconcile account + scan) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /v1/internal/billing/scan` | — | 2 |
| FR-BILL-033 | ตรวจหลักฐานและให้สิทธิ์จากใบแจ้งหนี้ subscription (`paidInvoiceEvidence` + `applyInvoice`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-034 | ตรวจหลักฐานและให้สิทธิ์จาก Checkout จ่ายครั้งเดียว (`paidPackageCheckoutEvidence` + `reconcileOneTime`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-035 | การต่ออายุ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-036 | Grace period เมื่อเก็บเงินต่ออายุไม่ได้ (`enforceGrace`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-037 | ติดตามการคืนเงินและ dispute (`billing-financial.ts`, `observeBillingCharges`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-038 | ตรวจพบและปิด issue อัตโนมัติ (`billing-issues.ts`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-039 | การแจ้งเตือน billing (`billing-notifications.service.ts`) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /v1/internal/billing/notifications/drain`<br>`GET system/billing/companies/:id/deliveries[/:deliveryId]` | — | 1 |
| FR-BILL-040 | ชุดเมนูตามแพ็ก (feature plan) และการย้ายเมนู | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-041 | บัญชีใบเสร็จ (receipt grants) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-042 | กฎการจบคำสั่ง, lease และ idempotency (billing command end rules) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 3 |
| FR-BILL-050 | ภาพรวมร้าน, รายละเอียดร้าน, timeline และการส่งออก | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.read`<br>`system.billing.export` (+1) | `GET overview`<br>`GET companies/:id` (+2) | `/system/billing`<br>`/system/billing/companies/[id]` | 1 |
| FR-BILL-051 | คิว issue และบันทึกการติดตาม (support outcome) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.read`<br>`system.billing.issue.manage` | `GET issues`<br>`GET issues/:id` (+5) | `/system/billing/issues`<br>`/system/billing/issues/[id]` | — |
| FR-BILL-052 | คำสั่งซ่อม (repair operations) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `reconcile.run`<br>`apply.retry` (+1) | `GET operations`<br>`GET operations/:id` (+5) | `/system/billing/operations/[id]`<br>`/companies/[id]/apply-invoices` (+1) | — |
| FR-BILL-053 | Provider events | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.read`<br>`system.billing.reconcile.run` | `GET provider-events`<br>`GET provider-events/:id` (+1) | `/system/billing/provider-events`<br>`/[id]` | — |
| FR-BILL-054 | Provider scans, ตารางสแกนอัตโนมัติ และ invoice scans/findings | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.read`<br>`system.billing.reconcile.run` | `GET/POST provider-scans`<br>`GET provider-scans/:id` (+10) | `/system/billing/provider-scans[/id]`<br>`/companies/[id]/invoice-scans[/scanId]` | — |
| FR-BILL-055 | Settlement และการกระทบยอดเงินเข้า | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.financial.read`<br>`system.billing.reconcile.run` | `GET/POST settlements`<br>`GET settlements/:id` (+2) | `/system/billing/settlements[/id]` | 1 |
| FR-BILL-056 | การตั้งค่า: policy, gate, ร่าง, ตั้งเวลา, ปิดฉุกเฉิน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET settings`<br>`GET configuration-changes` (+6) | `/system/billing/settings`<br>`/configuration-changes/[id]` (+1) | — |
| FR-BILL-057 | ตรวจการตั้งค่ากับ Stripe (configuration checks) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `reconcile.run` | `GET configuration-checks[/id]`<br>`POST configuration-checks` (+1) | `/system/billing/configuration-checks[/id]` | — |
| FR-BILL-058 | ยืนยันรหัสผ่านซ้ำ (reauthentication) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-059 | การอนุมัติและ dual control | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-060 | ขอบเขตผู้ปฏิบัติงาน (operator scopes) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `admin.role.manage` | `GET operator-scopes`<br>`GET scope-directory/:kind` (+3) | `/system/billing/operator-scopes`<br>`/scope-changes/[id]` | — |
| FR-BILL-061 | คืนเงิน และยุติแพ็กเกจหลังคืนเงิน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `financial.read`<br>`refund.manage` | `GET companies/:id/invoices/:invoiceId/refund-review`<br>`POST …/refund-preview` (+5) | `/system/billing/companies/[id]/invoices/[invoiceId]`<br>`/system/billing/refunds/[id]` | 2 |
| FR-BILL-062 | สั่งให้ Checkout ที่ค้างหมดอายุ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `gate.manage` | `GET companies/:id/checkouts`<br>`GET companies/:id/checkouts/:attemptId` (+4) | `/system/billing/companies/[id]/checkouts[/attemptId]`<br>`/checkout-expiry/[id]` | 1 |
| FR-BILL-063 | Batch reconcile | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `reconcile.run` | `GET batches`<br>`POST batches/preview` (+3) | `/system/billing/batches[/id]` | — |
| FR-BILL-064 | ปรับสิทธิ์แพ็กเกจของร้าน (plan adjustments) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `financial.read`<br>`override.manage` (+1) | `GET companies/:id/plan-adjustments`<br>`POST …/plan-adjustments/preview` (+2) | — | 2 |
| FR-BILL-065 | แถม/ถอนใบเสร็จ (receipt adjustments) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `override.manage`<br>`financial.read` | `GET companies/:id/receipt-adjustments`<br>`POST …/receipt-adjustments/preview` (+2) | `/system/billing/companies/[id]/receipt-adjustments`<br>`/receipt-adjustments/[id]` | — |
| FR-BILL-066 | แถม/ถอน add-on (credit grants) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `override.manage` | `GET companies/:id/credits`<br>`POST companies/:id/credit-grants/preview` (+2) | `/system/billing/companies/[id]` | 2 |
| FR-BILL-067 | เครื่องมือเอกสาร: เปิดเอกสาร, เปลี่ยนผู้รับแทนร้าน, ส่งซ้ำ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET companies/:id/invoices/:invoiceId/recipient-requests`<br>`GET recipient-changes/:id` (+1) | `/system/billing/companies/[id]/invoices/[invoiceId]/recipient`<br>`/recipient-changes/[id]` | 2 |
| FR-BILL-068 | ค้นด้วยเลขอ้างอิง | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.billing.read` | — | — | 1 |
| FR-BILL-069 | แคมเปญโปรโมชัน (ผู้ดูแล) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `policy.manage` | `GET promotion-campaigns`<br>`GET promotion-campaigns/:campaignId` (+6) | `/system/billing/campaigns`<br>`/campaigns/new` (+1) | 2 |
| FR-BILL-070 | สถานะของการขาย add-on ผ่าน Stripe | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-080 | อายุแพ็กเกจ (plan term) และการล็อกร้าน | ทุกแพ็ก | — | — | — | 2 |
| FR-BILL-081 | ผู้ดูแลตั้ง/ต่ออายุ plan term ด้วยมือ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.partner_dashboard.read`<br>`system.partner_company.update` | `GET system/partners/:id/plan-term`<br>`GET …/plan-term/history` (+3) | `/system/partners/[companyId]` | 2 |
| FR-BILL-082 | Sweep วันหมดอายุและบันไดเตือน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-083 | เพดานสาขาและพนักงาน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-084 | โควตาอ่านรูปใบเสร็จ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-085 | การทดลองใช้ฟรี และการปิดทดลองสำหรับผู้สมัครใหม่ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-086 | สิทธิ์ใช้ฟรีหลังทดลองหมด (free expense drafts) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-087 | คำขอเปลี่ยนแพ็กเกจจากลูกค้า (LINE) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.partner_company.update` | `GET system/package-change-requests`<br>`POST system/package-change-requests/:id/decision` | — | 1 |
| FR-BILL-090 | เข้าคอนโซลขายและงานของฉัน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/sales/my-work`<br>`GET /v1/sales/deals` (+2) | `/sales`<br>`/sales/my-work` (+2) | — |
| FR-BILL-091 | ค้นหาร้าน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `sales.company.search` | `GET /v1/sales/companies` | `/sales/companies` | — |
| FR-BILL-092 | สร้าง/แก้/ส่งดีล | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `sales.deal.create`<br>`sales.console.read` | `POST /v1/sales/deals`<br>`PUT /v1/sales/deals/:dealId` (+3) | `/sales/deals/new`<br>`/sales/deals/[id]` | 2 |
| FR-BILL-093 | อนุมัติ/ปฏิเสธ/จบดีล | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `sales.deal.approve` | `POST /v1/sales/deals/:dealId/approve \| reject \| end` | — | — |
| FR-BILL-094 | Sweep ของดีล | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST /v1/internal/sales/deals/expire-sweep`<br>`POST …/deals/renewal-sweep` (+1) | — | 1 |
| FR-BILL-095 | งานอีเวนต์: ชุดส่วนลด (batch) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `sales.event.manage`<br>`sales.console.read` | `POST/GET /v1/sales/events/batches`<br>`GET/PATCH …/batches/:batchId` (+2) | `/sales/events`<br>`/sales/events/[batchId]` | 1 |
| FR-BILL-096 | QR และการรับตั๋วส่วนลด | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 2 |
| FR-BILL-097 | รายการตั๋ว เพิกถอน และรายงานงาน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/sales/events/batches/:batchId/tickets`<br>`POST /v1/sales/events/tickets/:ticketId/revoke` (+1) | — | 1 |
| FR-BILL-098 | ทีมขายและโปรไฟล์เซลล์ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | `/sales/team`<br>`/system/sales-team` | — |
| FR-BILL-099 | การนับยอดขาย (attribution), ธงตรวจสอบ และรายงาน | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `PATCH /v1/system/partners/:id/referral`<br>`GET /v1/system/sales-attribution/flags` (+2) | `/sales/reports` | 1 |
| FR-BILL-110 | สร้างลิงก์เดโม | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `sales.demo_link.create` | `POST /v1/sales/demo-links` | — | — |
| FR-BILL-111 | เปิดลิงก์เดโม | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 5 |
| FR-BILL-112 | จัดการลิงก์เดโม | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/sales/demo-links`<br>`PATCH /:id` (+2) | `/sales/demo-links`<br>`/system/demo-links` | — |
| FR-BILL-113 | แชต AI ในหน้าเดโม | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-114 | ข้อจำกัดของร้านเดโมและการล้างข้อมูล | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | 1 |
| FR-BILL-120 | รายการร้านและรายละเอียดร้าน (partners) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | `system.identity_reconciliation.resolve`<br>`system.company_onboarding.read` | `GET /`<br>`GET /:id` (+14) | — | 2 |
| FR-BILL-121 | คำขอสมัครและการสร้างบริษัท (signup requests, company onboardings) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET system/signup-requests`<br>`GET …/auto-approved` (+7) | `/system/signup-requests`<br>`/system/signup-requests/[id]/mail` (+1) | 2 |
| FR-BILL-122 | การเปิด–ปิดแพลตฟอร์ม (platform access) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/auth/platform-access`<br>`GET/PUT /v1/system/platform-access` | — | — |
| FR-BILL-123 | บัญชีผู้บริหารและรายงานผู้บริหาร | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /`<br>`POST /` (+5) | `/system/executive-users`<br>`/new` (+8) | 1 |
| FR-BILL-124 | การส่งอีเมลของแพลตฟอร์ม (email delivery) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET system/email-delivery`<br>`GET …/connection` (+2) | `/system/email-delivery` | — |
| FR-BILL-125 | กล่องคำขอความช่วยเหลือ (support requests) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET system/support-requests`<br>`GET …/count` (+3) | `/system/support-requests` | 2 |
| FR-BILL-126 | สิทธิ์ของเจ้าของข้อมูล (data rights) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `POST/GET system/data-rights/cases`<br>`GET …/:caseId` (+1) | `/system/data-rights`<br>`/new` (+1) | — |
| FR-BILL-127 | ธีมหน้าแรก (home theme) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET /v1/public/home-theme`<br>`GET/PUT /v1/system/home-theme` | `/system/home-theme` | — |
| FR-BILL-128 | ตั้งค่า LINE กลาง (line settings) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET system/line/shared-credentials`<br>`PUT system/line/shared-credentials/:credentialKind` | `/system/line-settings` | — |
| FR-BILL-129 | งบ AI ของแพลตฟอร์ม (AI budget) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET/PUT system/ai-budget` | `/system/ai-budget` | 1 |
| FR-BILL-130 | ประเภทเงินได้หัก ณ ที่จ่าย (WHT income categories) | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | `GET system/wht-income-categories`<br>`PATCH …/:code` | `/system/wht-income-categories` | — |
| FR-BILL-131 | ทีมขายและลิงก์เดโมในคอนโซลระบบ | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
| FR-BILL-132 | API ระบบที่ไม่มีหน้าใน `/system/**` ของตัวเอง | ระบบขายและหลังบ้าน (รองรับทุกแพ็ก)* | — | — | — | — |
