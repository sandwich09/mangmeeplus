# Agent Memory: company-data-deletion-brainstorm

Status: **SUPERSEDED BY SPEC/PLAN P31** — เอกสารนี้เก็บไว้เป็นหลักฐานการสำรวจและมติ ไม่ใช่ source of truth อีกต่อไป
Owner: thawatchai (Owner ตัดสิน xx วัน และขอบเขต)
Date: 2026-09-15

Spec: [P31](../specs/mangmee-company-data-lifecycle-deletion-spec-th.md) — Plan: [P31](../plans/mangmee-company-data-lifecycle-deletion-plan-th.md)

Scope: ประเมิน impact / bug / gap ของการ "ลบข้อมูลร้านค้า" สองทริกเกอร์ —
(ก) ลูกค้าร้องขอลบ (PDPA ม.33) และ (ข) ยกเลิกบริการ / หมดอายุเกิน xx วัน

---

## 1. สองทริกเกอร์นี้ไม่ใช่เรื่องเดียวกัน (สำคัญที่สุด)

เอกสารกฎหมายที่เผยแพร่แล้ว (`docs/plans/mangmeeplus-privacy-terms-data-deletion-plan.md` §3)
แยกไว้ชัดว่า **"การยกเลิกบริการ" ไม่ใช่คำขอลบตาม PDPA** และหน้า `/data-deletion` ปัจจุบัน
*จงใจไม่ประกาศ* นโยบาย "เก็บกู้ 45 วันแล้วลบอัตโนมัติ 1 ปี" เพราะโค้ดยังทำไม่ได้

| | (ก) ลูกค้าร้องขอลบ | (ข) ยกเลิก/หมดอายุเกิน xx วัน |
|---|---|---|
| ฐาน | PDPA ม.33 — ต้องทำภายใน **90 วัน** | เงื่อนไขสัญญา/Terms ที่เรากำหนดเอง |
| ผู้ตัดสิน | ต้องยืนยันตัวตน + อำนาจลงนาม (DBD) | ระบบตัดสินเองจากวันที่ |
| ขอบเขต | เฉพาะข้อมูลส่วนบุคคลที่ไม่มีฐานเก็บต่อ | ทั้ง workspace ตามสัญญา |
| ข้อยกเว้น | บัญชี/ภาษี/ข้อพิพาท เก็บต่อได้ | เหมือนกัน |

ถ้าเอามารวมเป็นปุ่มเดียว จะได้ทั้ง "ลบของที่กฎหมายสั่งให้เก็บ" และ
"ไม่ลบของที่ลูกค้ามีสิทธิ์ให้ลบ" พร้อมกัน

---

## 2. ของที่มีอยู่แล้ว ใช้ซ้ำได้ (อย่าสร้างใหม่)

- `CompanyStatus = ACTIVE | SUSPENDED | DISABLED | ARCHIVED` + คอลัมน์
  `activatedAt / disabledAt / archivedAt` — วงจรชีวิตร้านมีครบแล้ว
- `PartnerLifecycleTransitionUseCase` — เปลี่ยนสถานะ + เขียน AuditLog `CRITICAL` แล้ว
- `CompanyPlanTerm.termDisabledAt` + sweep — มีคนปิดร้านอัตโนมัติเมื่อหมดอายุอยู่แล้ว
- `DataRightsCase` + `/system/data-rights` + permission `system.data_rights.manage` (CRITICAL)
  — control plane ของเคสมีแล้ว แต่ **จงใจไม่มี hard-delete endpoint**
- CRM มี pattern การลบจริงแล้ว: `CrmCustomer.personalDataErasedAt` + `CrmDataSubjectRequest`
  → ใช้เป็นแบบ (anonymise แทน delete) ได้
- S3 เปิด versioning + `NoncurrentVersionExpiration: 1 วัน` (`infra/object-storage-lifecycle.json`)
  → **ถ้าลบ object ได้ ของเก่าหายจริงภายใน 1 วัน** ข่าวดี
- RDS prod `BackupRetentionPeriod = 35` วัน → สำเนาใน backup หมดอายุเองภายใน 35 วัน
  ซึ่งอยู่ในเพดาน 90 วันของ PDPA พอดี

---

## 3. Bug / Gap ที่เจอจริงในโค้ด (เรียงตามความแรง)

### G1 — BLOCKER: `prisma.company.delete()` ล้มทันทีทุกร้านที่ใช้งานจริง

FK ที่กันไว้เป็น `Restrict` (ไม่ใช่ Cascade) ทำให้ DELETE ทั้งก้อน rollback:

| ตาราง | เหตุ |
|---|---|
| `CompanyOnboardingRun` | `@relation(...)` ไม่ระบุ `onDelete` → required relation = **Restrict โดยปริยาย** |
| `ExpenseSubstituteReceiptEvidence` | `onDelete: Restrict` ชัดเจน |
| `CrmDataSubjectRequest` → `CrmCustomer` | `onDelete: Restrict` — Company cascade ลง `CrmCustomer` แล้วไปชนกำแพงชั้นสอง |

หลักฐานว่าเกิดขึ้นจริง: smoke script ทุกตัวต้องลบมือก่อน เช่น
`apps/api/src/scripts/signup-journey-smoke.ts:189`
(`companyOnboardingRun.deleteMany(...)` แล้วค่อย `company.delete(...)`)

### G2 — HIGH: 20 ตารางถือ `companyId` แบบ String เปล่า ไม่มี FK → **รอด cascade แบบเงียบ**

สถิติจาก `schema.prisma`: 194 model มี `companyId`, ผูก FK ไป Company แบบ Cascade ~162,
แต่ **27 model ไม่มี relation ไป Company เลย** (7 ตัวรอดเพราะ cascade ทางอ้อม เหลือ 20 ตัวเป็น orphan จริง)

ตัวที่อันตรายเพราะถือข้อมูลส่วนบุคคล:

- `LineCompanyContext` — เก็บ `lineUserId` ดิบ + `aiPausedUntil`, unique ที่ `lineUserId`
- `LineWebhookEventLog` (+ `LineTurnOutcome` ที่ห้อยอยู่), `LineIntakeState`,
  `LineIntakePendingMedia`, `LineSupportRequest` (ข้อความที่ลูกค้าพิมพ์ + `lineUserId`)
- `LineWebLoginTransaction`, `LineWebHandoffToken`
- `CrmBookingProposal`, `CrmChannelAutoReplyUsage`
- `LegalDocumentActionRecord` (หลักฐานการยอมรับ — อันนี้ควรเก็บ แต่ต้อง *ตั้งใจ* เก็บ)
- `DataRightsCase` (ควรเก็บ), `Role` (`companyId String?`), `PlatformAiBudgetConfig`,
  `RemoteReleaseMutationIntent`
- กลุ่มบิล: `BillingAccount`, `BillingIssue`, `BillingOperation`, `BillingOperatorScope`, `BillingQuote`

Impact: ลบร้านแล้วบอกลูกค้าว่า "ลบครบ" ทั้งที่ `lineUserId` และข้อความแชทยังอยู่ = คำแถลงเท็จตาม runbook §9

### G3 — HIGH (เรื่องเงิน): `BillingAccount` ไม่มี FK → Stripe ยังเก็บเงินต่อ

`BillingAccount` ถือ `customerId` / `baseSubscriptionId` / `subscriptionState` / `cancelAtPeriodEnd`
แต่ไม่มี relation ไป Company เลย ขณะที่ `BillingReceiptGrant` และ `CompanyPlanTerm` เป็น Cascade

ลบร้าน → plan term กับ grant หาย, `BillingAccount` เหลือลอย ชี้ไป Stripe subscription ที่ยัง active
→ **ตัดบัตรลูกค้าต่อไปเรื่อย ๆ** และตามหาไม่เจอเพราะ `companyId` ที่มันถือไม่มีตัวตนแล้ว
→ ต้อง **ยกเลิก subscription ที่ Stripe ให้สำเร็จก่อน** จึงจะเริ่มลบ DB ได้ ไม่ใช่หลัง

### G4 — HIGH (ไฟล์): ลบแถวได้ แต่ไฟล์ใน S3 อยู่ต่อตลอดกาล

`AttachmentObject` เป็น Cascade → แถวหาย แต่ไม่มีใครเรียก `deleteObject()` ตอนลบร้าน
(`s3-storage.adapter.ts:139` มี method อยู่ ใช้อยู่แค่ substitute-receipt กับ smoke)

ผลคือ **รูปใบเสร็จ/สลิป/ลายเซ็น กลายเป็น orphan ที่ค้นไม่เจอ** เพราะ index (`bucket`,`objectKey`)
อยู่ในแถวที่เพิ่งลบไป → กู้รายการไม่ได้ ลบทีหลังก็ไม่ได้

ลำดับที่ถูกคือ **ลบไฟล์ก่อน → แล้วค่อยลบแถว** (versioning + noncurrent 1 วัน จะปิดงานให้เอง)
ต่อยอดจาก `getExactObjectVersionInventory` ที่มีอยู่แล้ว

### G5 — MEDIUM: `AuditLog` / `OutboxEvent` เป็น `SetNull`

relation เป็น `Company?` ไม่ระบุ `onDelete` → Prisma default = **SetNull**
แถวรอด (ดีสำหรับ audit) แต่ `companyId` กลายเป็น null → สืบย้อนว่าเป็นของร้านไหนไม่ได้อีก
และยังถือ `actorUserId` + `metadataJson` ที่อาจมี PII
→ ควรเป็น "เก็บโดยตั้งใจ + ย่อ PII + คงตัวชี้ร้านไว้เป็น tombstone" ไม่ใช่ null เงียบ ๆ

### G6 — MEDIUM (กฎหมายชนกันเอง)

- พ.ร.บ.การบัญชี ม.14 → เอกสารบัญชีเก็บ **อย่างน้อย 5 ปี** (สั่งเพิ่มถึง 7 ปีได้)
- ประมวลรัษฎากร ม.87/3 → เอกสาร VAT **5 ปี** มีกฎเลิกกิจการแยก
- PDPA → คำขอลบที่ชอบด้วยกฎหมาย **ไม่เกิน 90 วัน**

"ลบร้านทั้งก้อน" = ทำลายเอกสารที่กฎหมายอีกฉบับสั่งให้เก็บ
→ ต้องมี **ตู้เซฟบัญชี**: แยก `AccountingDocument` / `JournalEntry` / `TaxEvent` /
`WhtCertificate` / `ExpenseRecord` ออกจากการลบรอบแรก เก็บจนครบ 5 ปีจากวันปิดงวด แล้วลบรอบสอง
และต้องเสนอ **export ก่อนลบเสมอ** (runbook §7 บังคับอยู่แล้ว)

### G7 — MEDIUM: "เกิน xx วัน" ชนกับเส้นทางกู้คืนที่ตั้งใจเปิดไว้

มีอย่างน้อย 8 จุดที่จงใจปล่อยให้ `DISABLED + termDisabledAt` **ยังล็อกอินได้** เพื่อกลับมาต่ออายุ:
`password-login.use-case.ts:84`, `exchange-liff-session.use-case.ts:116`,
`exchange-line-handoff-token.use-case.ts:104`, `legal-acceptance.service.ts:613`,
`auth.controller.ts:1064`, `get-line-signup-status.use-case.ts:59`,
`process-line-webhook.use-case.ts:1372/2245/4627`, `email-recovery-lock.ts:5`

ถ้าเพิ่มการลบเมื่อครบ xx วัน ต้องตอบให้ครบ:
1. นับ xx วันจากอะไร — `termEndsAt` หรือ `disabledAt`? (`termDisabledAt` ถูกเคลียร์เมื่อแอดมินสั่งปิดเอง)
2. ทั้ง 8 จุดต้องเปลี่ยนข้อความจาก "ต่ออายุได้" → "ถูกลบแล้ว/สมัครใหม่" ไม่งั้นลูกค้าเจอ error กำกวม
3. ร้านที่ **ไม่มีแถว `CompanyPlanTerm`** (legacy/grandfathered — contract บอกว่า "unlimited") จะไม่ถูกนับเลย

### G8 — MEDIUM: `ARCHIVED` มีสถานะ แต่ยังไม่บังคับใช้จริง

`PartnerLifecycleTransitionUseCase` เขียน `status` + timestamp + audit เท่านั้น — ไม่ได้
เพิกถอน `AuthSession`, ไม่ยกเลิก Stripe, ไม่ปิด `LineChannelBinding`, ไม่หยุด `OutboxEvent`/worker
→ ร้านที่ archive แล้ว session เดิมยังใช้ได้จนกว่า token จะหมดอายุ และ LINE webhook ยังเดินต่อ
(runbook §7 บังคับ "stop new writes" ก่อน — ยังไม่มีใครทำ)

### G9 — MEDIUM: ผู้ใช้ข้ามร้าน

`User` เป็น global, `CompanyMembership` Cascade ตาม Company (ถูกแล้ว — ไม่ไปลบ account คนอื่น)
แต่ user ที่เหลือ 0 membership จะกลายเป็น **บัญชีลอย**: ล็อกอินได้ ไม่มีร้าน
`ExternalIdentity` (LINE) ยังผูกอยู่ → ทักเข้า LINE OA แล้วระบบจะตอบยังไง ยังไม่นิยาม

### G10 — LOW/MEDIUM: backup restore ปลุกข้อมูลที่ลบไปแล้วกลับมา

35 วันหมดอายุเอง (ดี) แต่ยังไม่มี tombstone manifest + replay ตาม runbook §8
→ ถ้า restore จริงในช่วง 35 วัน ข้อมูลที่ลบไปแล้วจะกลับมาใช้งานปกติโดยไม่มีใครรู้

### G11 — LOW: วันนี้เป็น manual ล้วน

`DataRightsCase` สถานะ `EXECUTING` เป็นแค่ "จุดควบคุมของ operator" — ไม่ใช่ execution engine
หลักฐาน `run://` / `evidence://` เป็นคำรับรองที่พิมพ์มือ ยังไม่ resolve กับ evidence store ใด ๆ

---

## 3.5 Owner decision 2026-09-15: ลบเองแบบ manual หลังลูกค้ายื่นคำร้องทางอีเมล

Owner ยืนยัน: **ไม่มีปุ่มให้เจ้าของร้านกดลบเอง** ลูกค้าส่งคำร้องมาทางอีเมล แล้วเราเป็นคนลบให้

### ผลที่ตามมา — ข่าวดี (ตัดงานออกไปเยอะ)

1. **ไม่ต้องออก Terms/Privacy ฉบับใหม่** หน้า `/data-deletion` ที่เผยแพร่แล้วอธิบาย
   "ช่องทางคำขอที่ตรวจสอบตัวตน" ตรงกับที่ Owner เลือกพอดี → ไม่มี re-acceptance event ที่
   บังคับผู้ใช้ทุกคนกดยอมรับใหม่
2. **โครงเคสมีครบแล้วทั้งหมด** ไม่ต้องออกแบบใหม่:
   - `DataRightsRequestSource.EMAIL` ← ช่องทางที่ Owner เลือก มีเป็น enum แล้ว
   - `DataRightsCaseType.COMPANY_WORKSPACE_OFFBOARDING`
   - UI ครบ: `apps/web/app/system/data-rights/` (list / new / [caseId])
   - 12 `DataRightsDecisionCategory` ตรงกับช่องโหว่ที่เจอในข้อ 3 แทบทุกข้อ
     (`ATTACHMENTS_OBJECT_VERSIONS` = G4, `PROCESSORS` = G3, `BACKUPS` = G10,
     `ACCOUNTING_TAX_DOCUMENTS` = G6, `QUEUES_CACHES`, `AUDIT_SECURITY_LOGS` = G5)
   - `DataRightsDisposition` = DELETE / ANONYMIZE / RESTRICT / RETAIN / RETURN / NOT_APPLICABLE
   - dual control + `dueAt` (นาฬิกา 90 วัน) + evidence record พร้อม sha256
3. **ไม่ต้องเขียน cron auto-purge** สำหรับเส้นทางคำร้อง

### ผลที่ตามมา — ของใหม่ที่เพิ่งโผล่เพราะเลือกทางนี้

#### B1 — BLOCKER คน: เคสหนึ่งต้องใช้ **อย่างน้อย 3 คน** ที่มี permission CRITICAL

> **Owner ยืนยัน 2026-09-15: โปรเจคนี้ทำคนเดียว มีแอดมินคนเดียว**
> → B1 ไม่ใช่ "ข้อควรพิจารณา" แต่เป็น **blocker ตายตัว** ดูทางออกที่ §3.7

`data-rights.service.ts` บังคับแยกบทบาทจริง (โยน `ForbiddenException`):

| บรรทัด | กฎ |
|---|---|
| 552 | ผู้สร้างเคส ≠ ผู้อนุมัติ |
| 570 | ผู้อนุมัติ ≠ ผู้ลงมือลบ |
| 584 | ผู้ลงมือลบ ≠ ผู้ตรวจสอบ |
| 612 | ผู้ลงมือลบ ≠ ผู้ปิดเคส |

`system.data_rights.manage` เป็น CRITICAL และ **ไม่มี tenant role ไหนได้รับเลย**
(`permission-registry.ts:504`) → ต้องเป็น SYSTEM_ADMIN เท่านั้น

ถ้าทีมมีคนเดียว **เคสจะเดินไม่ได้** ติดตั้งแต่ RECEIVED → APPROVED
นี่คือสิ่งที่ต้องตัดสินก่อนเขียนโค้ดบรรทัดแรก

#### B2 — ของที่ขาดจริงเหลือ "ชิ้นเดียว": ตัวลงมือลบ + หลักฐาน

เครื่องจักรเคส **รู้อยู่แล้วว่าต้องการหลักฐานอะไร** และเช็คของจริง —
`assertExecutionEvidence()` บังคับ `sha256` ต้องตรง `/^[0-9a-f]{64}$/`

`COMPANY_WORKSPACE_OFFBOARDING` ต้องมีครบ 6 ชิ้น
(`dataRightsRequiredExecutionEvidence`, `packages/contracts/src/data-rights.ts:216`):

```
ACCESS_REVOCATION  DATABASE_EXECUTION  OBJECT_STORAGE_INVENTORY
QUEUE_CACHE_PURGE  PROCESSOR_CONFIRMATION  BACKUP_MANIFEST
```
+ `INDEPENDENT_VERIFICATION` ตอนปิดเคส

**ไม่มีโค้ดตัวไหนผลิตหลักฐาน 6 ชิ้นนี้เลย** — runbook §7 ยอมรับตรง ๆ ว่า `run://` / `evidence://`
เป็น "คำรับรองที่พิมพ์มือ ยังไม่ resolve กับ evidence store ใด ๆ"

#### B3 — `PROCESSOR_CONFIRMATION` ทำให้เคสแรกปิดไม่ลง

หลักฐานชิ้นนี้ **บังคับ** สำหรับ company offboarding แต่ทะเบียน processor
(`docs/security-evidence/processor-cross-border-register.md`) ยังเป็น `[OBTAIN]` ทั้งแผง
→ เคสจริงเคสแรกจะจบได้แค่ `COMPLETED_WITH_EXCEPTION` ไม่ใช่ `COMPLETED`
ซึ่งไม่ผิด แต่ต้องรู้ล่วงหน้าเพื่อเขียนจดหมายแจ้งผลให้ตรง

#### B4 — นาฬิกา 90 วันเริ่มตอนอีเมลเข้า ไม่ใช่ตอนเราเปิดเคส

`dueAt` เก็บไว้แล้ว แต่ `contact@mangmeeplus.com` **ยังไม่ได้รับการอนุมัติเป็นช่องทางที่มีคนเฝ้า**
(plan §6 ข้อ 1 ยังค้าง) → ถ้าไม่มีใครเปิดกล่องจดหมาย นาฬิกาก็เดินอยู่ดี
ต้องมีคนรับผิดชอบเฝ้ากล่อง + SLA ตอบรับ ก่อนจะประกาศช่องทางนี้เป็นทางการ

#### B5 — รันสคริปต์ทำลายข้อมูลบน prod ต้องผ่านอุโมงค์

prod DB เข้าถึงได้ทางเดียวคือ SSM port-forward ผ่าน bastion (ดู memory `prod-bastion-tunnel-recipe`)
ซึ่งยิงเมลแจ้งเตือนความปลอดภัยถึง Owner ทุกครั้ง → ต้องเขียนขั้นตอนนี้ลง runbook
และเก็บ output ของสคริปต์เป็นไฟล์ที่ hash ได้ ไม่ใช่ copy จากหน้าจอ

### เส้นทางของเคสจริง — ติดตรงไหนบ้าง

```
RECEIVED           ✓ ทำได้
IDENTITY_VERIFIED  ✓ manual ตาม runbook §2/§5
RETENTION_REVIEW   ✓ กรอก 12 decision
APPROVED           ✗ ติด B1 — ต้องคนที่ 2
EXECUTING          ✗ ติด B1 — ต้องคนที่ 3
  หลักฐาน 6 ชิ้น   ✗ ติด B2 — ไม่มีเครื่องมือผลิต / ติด G1-G4 — ลบจริงยังไม่ได้
VERIFICATION       ✗ ติด B1
COMPLETED          ✗ ติด B3 — จะได้ COMPLETED_WITH_EXCEPTION แทน
```

### เส้นทาง "ยกเลิก/หมดอายุเกิน xx วัน" ควรแยกออกจาก DataRightsCase

เพราะ manual แล้ว ทริกเกอร์ xx วันไม่ควรเป็น auto-purge และ **ไม่ควรยัดเข้า `DataRightsCase`**:
ไม่มีใครยื่นคำร้อง → ไม่มีตัวตนให้ยืนยัน ไม่มีอำนาจให้ตรวจ และ `requestSource` ไม่มีค่าที่ตรงความจริง
(ใส่ `OTHER_MONITORED_CHANNEL` = โกหกในหลักฐาน)

ควรเป็นเรื่อง **วงจรชีวิตร้านตามสัญญา** แทน: ครบ xx วัน → `ARCHIVED` (สถานะมีแล้ว)
+ ขึ้น worklist ให้แอดมินเห็น แล้วการลบจริงยังเป็นการตัดสินใจของคน ไม่ใช่ cron

---

## 3.6 Owner decision 2026-09-15 (ต่อ): ไม่มีคำร้อง = เก็บจนครบตามกฎหมายก่อนถึงลบได้

Owner ยืนยัน: **ถ้าไม่มีคำร้องจากลูกค้า ห้ามลบจนกว่าจะครบระยะเก็บตามกฎหมาย**

→ ทริกเกอร์ "ยกเลิก/หมดอายุเกิน xx วัน" **ไม่ใช่ทริกเกอร์ลบอีกต่อไป** เป็นแค่ทริกเกอร์ปิดการเข้าถึง

```
มีคำร้องทางอีเมล  → DataRightsCase → PDPA 90 วัน → ลบ (บัญชี/ภาษี RETAIN ต่อ)
ไม่มีคำร้อง        → ARCHIVED เมื่อครบ xx วัน → ถือไว้จนครบอายุตามกฎหมาย → ค่อยลบ
```

### ผลดี: ตัดงานออกไปอีกก้อนใหญ่

- ไม่ต้องมี cron auto-purge เลย ทั้งสองเส้นทาง
- ไม่ต้องออกแบบ grace period / ปุ่มกู้คืน / นับถอยหลัง
- executor เหลือจำเป็นเฉพาะ**เส้นทางคำร้อง**เท่านั้น ซึ่งนาน ๆ เกิดที
- ร้านแรกที่จะถึงวันลบจริงอยู่อีกหลายปี → มีเวลาสร้างเครื่องมือแบบไม่รีบ

### กลไกที่รองรับนโยบายนี้ **มีอยู่แล้ว** ใน `DataRightsDecisionRecord`

```
disposition = RETAIN
retentionUntil    DateTime?   ← ต้องเป็นวันในอนาคต
accessRestriction String?     ← ต้องไม่ว่าง
```
บังคับจริงโดย `assertRetentionDatesCurrent()` — ถ้า `RETAIN`/`RESTRICT` แล้วไม่ใส่วันสิ้นสุด
หรือไม่ระบุการจำกัดการเข้าถึง จะ throw `data_rights_retention_review_expired`

**ช่องโหว่:** กลไกนี้อยู่ใน `DataRightsCase` เท่านั้น เส้นทาง "ไม่มีคำร้อง" ไม่มีเคส
→ **ไม่มีที่เก็บวันครบกำหนด** และ `CompanyBusinessPolicy.retentionPolicyJson`
เป็น `Json @default("{}")` ที่ **ไม่มีโค้ดตัวไหนอ่านเลย** (grep แล้วไม่เจอ) = ช่องว่างเปล่า

### R1 — ความเสี่ยงหลักของนโยบายนี้: เก็บข้อมูลส่วนบุคคลเกินจำเป็น

ถ้าอ่านตามตัวอักษร "เก็บทุกอย่างจนครบ 5 ปี" จะได้ผลข้างเคียงที่ **ผิด PDPA อีกทาง**:
แชท LINE, ข้อมูลลูกค้า CRM, AI turn, webhook log **ไม่มีฐานกฎหมายให้เก็บ 5 ปี**
PDPA ม.37(3) สั่งให้ลบเมื่อพ้นวัตถุประสงค์ การเก็บแชทลูกค้าไว้ 5 ปี
เพราะร้านมีเอกสารบัญชี ไม่ใช่เหตุผลที่อธิบายได้

**ข้อเสนอ: ใช้สองนาฬิกา ไม่ใช่อันเดียว** — ซึ่งโครงสร้างรองรับอยู่แล้ว เพราะ
`DataRightsDecisionCategory` แยก 12 หมวดพร้อม disposition รายหมวดตั้งแต่แรก

| นาฬิกา | หมวด | เมื่อครบ |
|---|---|---|
| **A — สั้น** (เสนอ: ตอน ARCHIVED หรือ +90 วัน) | `AI_OCR_DATA`, `QUEUES_CACHES`, และตาราง LINE/CRM ที่ไม่ผูกเอกสารบัญชี | ลบ/anonymise |
| **B — ยาว 5 ปี** | `ACCOUNTING_TAX_DOCUMENTS` + `ATTACHMENTS_OBJECT_VERSIONS` ของเอกสารเหล่านั้น + `AUDIT_SECURITY_LOGS` + `LEGAL_ACCEPTANCE_EVIDENCE` | ลบรอบสอง |

นาฬิกา A ไม่ขัดกับที่ Owner สั่ง เพราะของพวกนี้ "ครบตามกฎหมาย" ตั้งแต่วันที่เลิกใช้แล้ว
— ไม่มีกฎหมายไหนสั่งให้เก็บต่อ

### R2 — "ครบตามกฎหมาย" นับราย**เอกสาร** ไม่ใช่รายร้าน

พ.ร.บ.การบัญชี ม.14 นับจาก**วันปิดบัญชี** ไม่ใช่วันยกเลิกบริการ
ประมวลรัษฎากร ม.87/3 มีจุดเริ่มของตัวเองและมีกฎเลิกกิจการแยกต่างหาก

→ ร้านที่ยกเลิกวันนี้ เอกสารเมื่อ 3 ปีก่อนเหลืออีก 2 ปี แต่เอกสารเดือนที่แล้วเหลืออีกเกือบ 5 ปี
→ **วันลบของร้าน = วันครบกำหนดที่ช้าที่สุดในบรรดาเอกสารทั้งหมด**

จุดยึดในสคีมามีแล้ว: `AccountingPeriod.endDate` / `closedAt` (+ `LedgerPeriodStatus`)
แต่ยังไม่มีใครคำนวณค่านี้ และ ม.14 เปิดช่องให้สั่งขยายถึง 7 ปี
→ ต้องเป็น**ค่าที่เก็บไว้และแก้ได้** ไม่ใช่ค่าคงที่ที่คำนวณสด

### R3 — ต้นทุนและความเสี่ยงของการ "ถือไว้" 5 ปี

- แถวของร้านที่ตายแล้วอยู่ในตารางร้อนต่ออีก 5 ปี → index โต, ทุก query ที่ scope ตาม tenant
  ต้องกันไม่ให้หลุดต่อไปเรื่อย ๆ
- ไฟล์ S3 (รูปใบเสร็จ/สลิป) สะสมต่อเนื่อง — **ยังไม่มีตัวเลขว่าเท่าไร** ต้องวัดก่อน
- ข้อมูลที่ถือไว้คือข้อมูลที่รั่วได้ ยิ่งถือนานยิ่งต้องพิสูจน์ว่าคุมการเข้าถึงได้จริง

### R4 — G8 กลายเป็นงานเร่งด่วนที่สุด แทนที่ตัวลบ

นโยบายนี้แปลว่าเราจะ**ถือข้อมูลร้านที่ตายแล้วไว้นานมาก** → คำถามที่สำคัญที่สุดเปลี่ยนจาก
"ลบยังไง" เป็น **"ถือไว้แล้วปลอดภัยจริงหรือเปล่า"**

แต่ G8 บอกว่า `ARCHIVED` วันนี้เขียนแค่ `status` + timestamp + audit —
**ไม่เพิกถอน `AuthSession`, ไม่ปิด `LineChannelBinding`, ไม่ยกเลิก Stripe, ไม่หยุด outbox**

การถือข้อมูล 5 ปีโดยที่การเข้าถึงยังไม่ถูกตัดจริง คือส่วนผสมที่แย่ที่สุดของทั้งสองทาง
และ runbook §7 บังคับ "stop new writes" ไว้อยู่แล้ว

---

## 3.7 ทางออกของ B1 เมื่อมีแอดมินคนเดียว (Owner ยืนยัน 2026-09-15)

### ประเด็นสำคัญ: การบล็อกไว้แบบนี้ไม่ได้ "ปลอดภัยกว่า"

โค้ดวันนี้ไม่ได้กันการลบที่ผิดพลาด — มันกัน **การลบทุกกรณี**
แปลว่าถ้าลูกค้ายื่นคำร้อง PDPA เข้ามา เราจะ**ทำไม่ทันกำหนด 90 วันเพราะกระบวนการของเราเอง**
ซึ่งเป็นผลเสียทางกฎหมายที่แย่กว่าการลบโดยคนเดียวที่บันทึกไว้ตามจริง

### runbook เองอนุญาตทีมเล็กอยู่แล้ว — โค้ดเข้มกว่าที่เอกสารกำหนด

`docs/runbooks/user-company-data-rights.md` §2 เขียนไว้ว่า:

> "One person may hold several roles in a small team, **but the executor must not approve
> their own evidence** for a full-company irreversible deletion."

คือยอมให้สวมหลายหมวกได้ ห้ามแค่ข้อเดียว แต่โค้ดบังคับ 4 ข้อ (บรรทัด 552/570/584/612)
→ **โค้ดเข้มเกินนโยบายที่เขียนไว้เอง** นี่คือช่องว่างที่แก้ได้โดยไม่ต้องลดมาตรฐาน

### repo นี้มีแบบแผนแก้ปัญหานี้อยู่แล้ว — อย่าคิดใหม่

โมดูล expenses เจอปัญหาเดียวกัน (ร้านเจ้าของคนเดียวอนุมัติตัวเองไม่ได้) และแก้ไปแล้ว
ด้วย Owner decision 2026-08-10 ที่ `substitute-receipt.use-case.ts:43-47`:

```
selfApprovalPermitted(approvalMode, roles)   ← OWNER/ADMIN/MANAGER ได้รับยกเว้น
...
selfApproved = evidence.payerUserId === ctx.userId
→ เก็บค่า selfApproved ลงในหลักฐานเสมอ (บรรทัด 1194)
```

**หลักการคือ: อนุญาตให้ทำคนเดียวได้ แต่บันทึกตามจริงว่าทำคนเดียว**
ไม่ใช่บล็อก และไม่ใช่แกล้งทำเป็นว่ามีสองคน

### ทางเลือก 3 ทาง

| | วิธี | ประเมิน |
|---|---|---|
| **ก** | สร้างบัญชีแอดมินที่สองให้ตัวเอง แล้วสลับล็อกอิน | **ห้ามทำ** — สร้างหลักฐานเท็จในบันทึกที่ใช้อ้างกับ regulator ว่ามีสองคนตรวจสอบ แย่กว่าไม่มีหลักฐานเลย |
| **ข** | ตอนมีคำร้องจริง ค่อยเชิญคนนอก (ผู้สอบบัญชี/ทนาย) มาถือบัญชีแอดมินชั่วคราว | **ดีที่สุดถ้าทำได้** — ไม่ต้องแก้โค้ดเลย หลักฐานแข็งแรงจริง และมีทนายอยู่ในลูป PDPA อยู่แล้ว ([[pdpa-lawyer-review-item52]]) แต่ต้องเตรียมคนไว้ล่วงหน้า ไม่ใช่หาตอนอีเมลเข้า |
| **ค** | เปิด single-admin mode ตามแบบ `selfApproved` + เพิ่มด่านที่เครื่องตรวจแทนคน | **ทำได้จริงและซื่อสัตย์** ถ้า ข ไม่เวิร์ก |

### Owner เลือก **ทางเลือก ค** (2026-09-15) + ขอปุ่มลบทันที

Owner ตัดสิน: เปิด single-admin mode แบบ `selfApproved` และ **รอ 1 วันเป็นค่าตั้งต้น
แต่ต้องมีปุ่มยืนยันซ้ำเพื่อลบทันทีได้ด้วย**

#### ด่านที่แบ่งเป็น 2 กลุ่ม — กลุ่มแรกข้ามไม่ได้ กลุ่มสองข้ามได้

คนที่สองกันความผิดพลาดได้ 2 แบบ ซึ่ง**ไม่เท่ากัน** จึงไม่ควรข้ามได้เหมือนกัน:

| | กันอะไร | ข้ามได้ไหม |
|---|---|---|
| **ลบผิดร้าน** | ความเสียหายถาวรกับคนที่ไม่เกี่ยวข้อง กู้ไม่ได้ | **ห้ามข้าม** |
| **ทำเร็วเกินไป** | ความเสียหายกับร้านที่ตั้งใจลบอยู่แล้ว | ข้ามได้ ถ้าบันทึกเหตุผล |

→ **ด่านบังคับ (ทั้งสองเส้นทาง ข้ามไม่ได้):**

1. **ต้องมีรายงานนับของที่ยัง "สด"** — รายงานตาม §8 ข้อ 2 ที่ hash แล้ว และต้องสร้างไม่นาน
   (เสนอ: ภายใน 1 ชม.) รายงานเก่า 3 สัปดาห์ไม่ได้บอกว่ากำลังจะลบอะไรอยู่
2. **พิมพ์ชื่อร้านให้ตรง** — ด่านเดียวที่กัน "ลบผิดร้าน" ได้จริง
3. **หลักฐานต้องมาจากเครื่อง ไม่ใช่พิมพ์มือ** — ปิดช่องที่ runbook §7 ยอมรับว่าเป็นคำรับรองลอย ๆ

→ **ด่านที่ข้ามได้:**

4. **รอ 1 วันหลังกดอนุมัติ** = ค่าตั้งต้น
   ปุ่ม "ลบทันที" ต้อง**พิมพ์เหตุผล**ก่อน ไม่ใช่แค่กดซ้ำ
   แล้วบันทึก `cooldownWaivedAt` + เหตุผล + ผู้กด ลงในเคส

#### หมายเหตุการออกแบบปุ่ม: อย่าใช้ดับเบิลคลิกจริง ๆ

กดซ้ำห่างกัน 2 วินาทีไม่ใช่การคิดทบทวน และเผลอกดได้ง่ายเกินไปสำหรับงานที่ย้อนไม่ได้
ของที่ทำให้ "กดครั้งที่สอง" มีความหมายคือ**ต้องพิมพ์อะไรสักอย่าง** —
ซึ่งข้อ 2 (ชื่อร้าน) + ข้อ 4 (เหตุผล) ทำหน้าที่นั้นอยู่แล้ว

#### ธงที่ต้องติดไปถึงจดหมายแจ้งผลลูกค้า

- `selfExecuted = true` — คนเดียวทำทุกบทบาท
- `cooldownWaived = true` + เหตุผล — ถ้ากดลบทันที

หลักการเดิมจาก `selfApproved`: **ไม่บล็อก แต่บันทึกตามจริง**
ถ้าวันหนึ่งมีคนมาตรวจ เอกสารต้องเล่าเรื่องจริง ไม่ใช่เรื่องที่อยากให้เป็น

#### เหตุผลที่การรอ 1 วันยังมีค่า แม้ข้ามได้

ค่าตั้งต้นคือสิ่งที่เกิดขึ้นจริงเกือบทุกครั้ง การต้องพิมพ์เหตุผลเพื่อข้าม
สร้างจังหวะให้หยุดคิดหนึ่งครั้ง ซึ่งเป็นสิ่งเดียวกับที่คนที่สองให้ได้
สิ่งที่จะทำให้มันไร้ค่าคือปล่อยให้ข้ามได้โดยไม่ต้องพิมพ์อะไรเลย

### ยังไม่ต้องรีบตัดสิน

ไม่มีเคสค้างอยู่ และเส้นทาง "ไม่มีคำร้อง" เลื่อนไปอีกหลายปีตาม §3.6
→ **อย่าเพิ่งไปแก้โค้ด dual control ตอนนี้** ทำ §8 ข้อ 1–3 ก่อน
แล้วค่อยตัดสินระหว่าง ข กับ ค ตอนใกล้จะมีคำร้องจริง
แต่ต้อง**ตัดสินก่อนอีเมลฉบับแรกเข้ามา** ไม่ใช่หลัง เพราะนาฬิกา 90 วันเริ่มเดินทันที

---

## 4. ข้อเสนอการออกแบบ (ให้ Owner เลือก)

### อย่าใช้ `prisma.company.delete()` เป็นกลไก

cascade ~162 relation ในทรานแซกชันเดียว = all-or-nothing, ล็อกตารางยาว, ย้อนไม่ได้,
ไม่มี progress, และล้มที่ G1 อยู่ดี
→ ควรเป็น **purge job ไล่ตารางตามลำดับ idempotent + resumable** พร้อมนับจำนวนต่อตาราง

### เสนอ 4 สถานะ + 2 งานเบื้องหลัง

```
ACTIVE
  └─(ยกเลิก / term หมด)→ DISABLED        วันที่ 0
       • ยกเลิก Stripe subscription ให้สำเร็จก่อน  (ปิด G3)
       • เพิกถอน AuthSession + ปิด LineChannelBinding + หยุด outbox  (ปิด G8)
       • อ่านอย่างเดียว + ปุ่ม export + ปุ่มต่ออายุ     ← เส้นทาง G7 เดิมยังใช้ได้
  └─(ครบ xx วัน)→ ARCHIVED               เสนอ xx = 90 วัน
       • เข้าไม่ได้เลย, กู้คืนได้ด้วยคำสั่งแอดมิน, ยัง export ได้
  └─(ครบ yy วัน)→ PURGED                 เสนอ yy = +90 วัน (รวม 180)
       • ลบไฟล์ S3 ก่อน → แล้วลบแถว      (ปิด G4)
       • ลบ/anonymise ตาราง LINE + CRM + orphan ทั้ง 20 ตัว  (ปิด G2)
       • เก็บ "ตู้เซฟบัญชี" + AuditLog + LegalDocumentActionRecord ต่อ  (ปิด G6)
  └─(ครบ 5 ปีจากวันปิดงวด)→ ลบตู้เซฟบัญชี
```

ทำไม 90 วัน: ตรงกับเพดาน PDPA ที่ประกาศไปแล้ว และยาวกว่า backup 35 วัน
→ พอถึงวัน purge สำเนาใน backup ของช่วง ACTIVE หมดอายุไปแล้ว (บรรเทา G10 โดยไม่ต้องเขียน replay)

### ลำดับงานที่เล็กที่สุดที่ให้คุณค่าจริง

1. **ปิดรูก่อน (ไม่ต้องรอ feature)** — เติม FK/`onDelete` ให้ 20 ตาราง orphan
   + แก้ G1 (3 Restrict) + ผูก `BillingAccount` → Company
   = migration อย่างเดียว ยังไม่มีปุ่มลบ แต่ทำให้ "ลบแล้วสะอาด" เป็นไปได้
2. เขียน **purge inventory script** (อ่านอย่างเดียว): รับ companyId → รายงานจำนวนแถวต่อตาราง
   + จำนวน S3 object + สถานะ Stripe → ใช้เป็นทั้งหลักฐานก่อน/หลัง และเป็น test fixture
3. ค่อยต่อ executor เข้ากับ `DataRightsCase` ที่มีอยู่

---

## 5. Open questions

### ตัดสินแล้ว

- ~~5. self-service หรือ manual?~~ → **manual ผ่านคำร้องทางอีเมล** (Owner 2026-09-15) ดู §3.5
- ~~3. ตู้เซฟบัญชี?~~ → **เก็บจนครบอายุตามกฎหมายก่อนถึงลบได้ ถ้าไม่มีคำร้อง** ดู §3.6
- ~~5(เดิม). xx วัน = ทริกเกอร์ลบ?~~ → **ไม่ใช่** เป็นทริกเกอร์ `ARCHIVED` เท่านั้น

### ต้องตัดสินก่อนเขียนโค้ด

1. **B1 — ใครเป็นคนที่ 2 และ 3** ที่จะถือ `system.data_rights.manage`?
   ถ้าหาไม่ได้จริง ๆ ทางเลือกคือ (ก) หาคนนอกที่ไว้ใจได้มาเป็น SYSTEM_ADMIN
   (ข) แก้กฎ dual control ให้ยอมคนเดียวได้ในบางสถานะ — **ไม่แนะนำ** เพราะ runbook §2
   เขียนไว้ชัดว่า "ผู้ลงมือต้องไม่รับรองหลักฐานของตัวเองสำหรับการลบทั้งบริษัท"
   และมันคือกันตัวเองพลาดในงานที่ย้อนไม่ได้

2. **B4 — ใครเฝ้า `contact@mangmeeplus.com`** และตอบรับภายในกี่วัน?

### ต้องตัดสินก่อน execute เคสแรก (ยังไม่บล็อกงานโค้ด)

3. **ตู้เซฟบัญชี (G6)** — เก็บต่อ 5 ปีในฐานเดิม (ต้องมี query กันหลุดทุกจุด)
   หรือ export เป็นไฟล์ส่งมอบลูกค้าแล้วลบจากฐานทันที?
   อย่างหลังง่ายกว่ามากและตรงกับ disposition `RETURN` ที่มีอยู่แล้ว
4. **บัญชีลอย (G9)** — user ที่เหลือ 0 ร้าน ปล่อยไว้ / ปิด / ถามผู้ใช้?
5. **xx วันของเส้นทางยกเลิก** — นับจาก `termEndsAt` หรือ `disabledAt`
   และร้าน legacy ที่ไม่มีแถว `CompanyPlanTerm` จะนับยังไง (ตอนนี้จะไม่ถูกนับเลย)

## 6. Artifacts อ้างอิง

- `docs/plans/mangmeeplus-privacy-terms-data-deletion-plan.md` §6 ข้อ 4 — งานนี้เป็น release blocker ที่ระบุไว้แล้ว
- `docs/runbooks/user-company-data-rights.md` §6–§9 — data map, execution controls, backup, completion letter
- `apps/api/prisma/schema.prisma` — FK/onDelete ทั้งหมด
- `apps/api/src/modules/data-rights/data-rights.service.ts` (1057 บรรทัด) — control plane ที่มีอยู่
- `infra/object-storage-lifecycle.json`, `infra/production/bootstrap-data.sh:279` — S3 / RDS retention

## 7. Verification

ยังไม่ได้รันคำสั่งทดสอบใด ๆ — เอกสารนี้มาจากการอ่าน schema/โค้ด/เอกสารเท่านั้น
ข้อที่ยืนยันได้ด้วยตาจากไฟล์: G1 (smoke script ต้องลบมือก่อน), G2 (นับจาก schema),
G3–G5 (relation ใน schema), G7 (8 call site), G8 (อ่าน use-case ทั้งไฟล์), G10 (ค่า infra)

## 8. Next

ลำดับใหม่ หลัง Owner เลือก manual (3.5) + ถือจนครบอายุกฎหมาย (3.6)
งานหลักเปลี่ยนจาก "สร้างตัวลบ" เป็น **"ถือของให้ปลอดภัยและพิสูจน์ได้"**

1. **G8 / R4 — ทำให้ `ARCHIVED` มีความหมายจริง** ← เร่งด่วนที่สุดแล้วตอนนี้
   เพิกถอน `AuthSession` + ปิด `LineChannelBinding` + ยกเลิก Stripe + หยุด outbox
   ต่อยอด `PartnerLifecycleTransitionUseCase` ที่มีอยู่ ไม่ใช่ของใหม่
   (ปิด G3 เรื่องตัดบัตรลูกค้าต่อไปด้วยในตัว)
2. **สคริปต์ inventory แบบอ่านอย่างเดียว** รับ `companyId` → JSON:
   แถวต่อตารางทั้ง 194 (รวม 20 ตัว orphan), S3 object + version, สถานะ Stripe, session ที่ยัง active
   → ปลอดภัย 100% รันบน prod ได้, ตอบ R3 ว่าเราถืออะไรไว้เท่าไร,
   และเป็นหลักฐาน `OBJECT_STORAGE_INVENTORY` + ครึ่ง "ก่อน" ของ `DATABASE_EXECUTION`
3. **เก็บวันครบกำหนดให้เป็นค่าที่อ่านได้ (R2)** — คำนวณจาก `AccountingPeriod.endDate`/`closedAt`
   เขียนลงที่เดียวที่ตรวจสอบได้ ไม่ใช่คำนวณสดทุกครั้ง (ต้องแก้ได้เพราะ ม.14 ขยายถึง 7 ปี)
   `CompanyBusinessPolicy.retentionPolicyJson` ที่ว่างอยู่คือที่ที่ใกล้เคียงที่สุด แต่ยังไม่มีสคีมา
4. **migration ปิดรู FK** — G1 (3 Restrict) + G2 (20 orphan) + G3 (`BillingAccount` → Company)
   ไม่เร่งแล้วเพราะยังไม่ลบอะไรเร็ว ๆ นี้ แต่ควรทำตอนสคีมายังเล็ก อีก 5 ปีจะแก้ยากกว่านี้มาก
5. **executor** — จำเป็นเฉพาะเส้นทางคำร้อง ทำหลังสุด ใช้สคริปต์ข้อ 2 เป็น before/after

ยังไม่เริ่มเขียนโค้ดจนกว่าจะมี spec + plan ตาม AGENTS.md
