# วงจรชีวิตข้อมูลร้านค้าและการลบข้อมูล — Spec P31

สถานะ: **SPEC APPROVED — ยังไม่ implement** (Owner ตัดสินครบทั้ง 4 ข้อ 2026-09-15; ยังไม่มีการแก้โค้ดใด ๆ)

แผนส่งมอบ: [แผน P31](../plans/mangmee-company-data-lifecycle-deletion-plan-th.md)
ที่มาการสำรวจ: [brainstorm + หลักฐานรายข้อ](../agent-memory/company-data-deletion-brainstorm.md)

เอกสารที่เกี่ยวข้องและยังเป็น source of truth ของส่วนตัวเอง:
- [Privacy/Terms/Data Deletion plan](../plans/mangmeeplus-privacy-terms-data-deletion-plan.md) — §6 ข้อ 4 คือ release blocker ที่ spec นี้มาปิด
- [User and Company Data Rights runbook](../runbooks/user-company-data-rights.md) — ขั้นตอนปฏิบัติของ operator
- [P29 Company Plan Term](mangmee-company-plan-term-spec-th.md) — เจ้าของ `termEndsAt` / `termDisabledAt` / sweep

---

## 0. ที่มา

Owner ถามว่าถ้าต้องลบข้อมูลร้านค้า — ทั้งกรณีลูกค้าร้องขอ และกรณียกเลิกบริการเกิน xx วัน —
จะกระทบอะไรบ้าง การสำรวจพบว่า**วันนี้เราลบร้านไม่ได้เลย** และถึงลบได้ก็จะลบไม่สะอาด
พร้อมกับพบว่าสถานะ `ARCHIVED` ที่มีอยู่แล้วไม่ได้ตัดการเข้าถึงจริง ซึ่งเป็นปัญหาที่ใหญ่กว่า

## 1. Current truth (สำรวจโค้ด 2026-09-15)

### 1.1 `prisma.company.delete()` ล้มทันทีทุกร้านที่ใช้งานจริง (G1)

FK สามจุดเป็น `Restrict` ทำให้ DELETE ทั้งก้อน rollback:

| ตาราง | เหตุ |
|---|---|
| `CompanyOnboardingRun` | `@relation` ไม่ระบุ `onDelete` → required relation = Restrict โดยปริยาย |
| `ExpenseSubstituteReceiptEvidence` | `onDelete: Restrict` ชัดเจน |
| `CrmDataSubjectRequest` → `CrmCustomer` | `onDelete: Restrict` — Company cascade ลง `CrmCustomer` แล้วชนกำแพงชั้นสอง |

หลักฐาน: smoke script ทุกตัวต้องลบมือก่อน เช่น `apps/api/src/scripts/signup-journey-smoke.ts:189`

### 1.2 ตารางที่รอด cascade แบบเงียบ (G2)

`schema.prisma` มี 194 model ที่ถือ `companyId`, ผูก FK ไป Company แบบ Cascade ~162,
แต่ **27 model ไม่มี relation ไป Company เลย** โดย 7 ตัวรอดเพราะ cascade ทางอ้อม
(`AttachmentBlob`, `AttachmentLink`, `NotificationDelivery`, `NotificationRecipient`,
`ProductBarcode`, `WorkflowRuleVersion`, `CrmDataSubjectRequest`)

เหลือ **20 ตารางที่เป็น orphan จริง**:

```
BillingAccount  BillingIssue  BillingOperation  BillingOperatorScope  BillingQuote
CrmBookingProposal  CrmChannelAutoReplyUsage  DataRightsCase  LegalDocumentActionRecord
LineCompanyContext  LineIntakePendingMedia  LineIntakeState  LineSupportRequest
LineTurnOutcome  LineWebHandoffToken  LineWebLoginTransaction  LineWebhookEventLog
PlatformAiBudgetConfig  RemoteReleaseMutationIntent  Role
```

กลุ่ม LINE ถือ `lineUserId` ดิบและข้อความที่ผู้ใช้พิมพ์ → เป็นข้อมูลส่วนบุคคลที่จะค้างอยู่

### 1.3 `BillingAccount` ไม่มี FK → Stripe เก็บเงินต่อ (G3)

`BillingAccount` ถือ `customerId` / `baseSubscriptionId` / `subscriptionState` / `cancelAtPeriodEnd`
แต่ไม่ผูกกับ Company ขณะที่ `CompanyPlanTerm` และ `BillingReceiptGrant` เป็น Cascade
→ ลบร้าน = term หาย แต่ subscription ยัง active และตามหาไม่เจอเพราะ `companyId` ที่มันถือไม่มีตัวตนแล้ว

### 1.4 ไฟล์ใน object storage ไม่ถูกลบ (G4)

`AttachmentObject` เป็น Cascade → แถวหาย แต่ไม่มี caller ไหนเรียก `deleteObject()` ตอนลบร้าน
(`s3-storage.adapter.ts:139` มี method อยู่) index `(bucket, objectKey)` อยู่ในแถวที่เพิ่งลบ
→ รูปใบเสร็จ/สลิป/ลายเซ็นกลายเป็น orphan ที่ค้นไม่เจอและลบทีหลังไม่ได้

**ข่าวดี:** bucket เปิด versioning และ `infra/object-storage-lifecycle.json` ตั้ง
`NoncurrentVersionExpiration: { NoncurrentDays: 1 }` → ถ้าลบ current version ได้ ของเก่าหายจริงภายใน 1 วัน

### 1.5 `AuditLog` / `OutboxEvent` เป็น SetNull (G5)

relation เป็น `Company?` ไม่ระบุ `onDelete` → Prisma default = SetNull
แถวรอด (ดีสำหรับ audit) แต่ `companyId` กลายเป็น null → สืบย้อนไม่ได้ว่าเป็นของร้านไหน
และยังถือ `actorUserId` + `metadataJson`

### 1.6 `ARCHIVED` มีสถานะแต่ไม่บังคับใช้ (G8) — **ปัญหาที่ใหญ่ที่สุดในทางปฏิบัติ**

`CompanyStatus = ACTIVE | SUSPENDED | DISABLED | ARCHIVED` และ
`PartnerLifecycleTransitionUseCase` เขียน `status` + timestamp + AuditLog CRITICAL เท่านั้น
**ไม่เพิกถอน `AuthSession`, ไม่ปิด `LineChannelBinding`, ไม่ยกเลิก Stripe, ไม่หยุด `OutboxEvent`**

runbook §7 บังคับ "stop new writes and revoke memberships/access" ไว้แล้ว — ยังไม่มีใครทำ

### 1.7 เส้นทางกู้คืนที่ตั้งใจเปิดไว้ (G7)

มีอย่างน้อย 8 จุดที่จงใจปล่อยให้ `DISABLED + termDisabledAt` ยังล็อกอินได้เพื่อกลับมาต่ออายุ:
`password-login.use-case.ts:84`, `exchange-liff-session.use-case.ts:116`,
`exchange-line-handoff-token.use-case.ts:104`, `legal-acceptance.service.ts:613`,
`auth.controller.ts:1064`, `get-line-signup-status.use-case.ts:59`,
`process-line-webhook.use-case.ts:1372/2245/4627`, `email-recovery-lock.ts:5`

เส้นทางนี้ต้องคงอยู่สำหรับ `DISABLED` และต้อง**ปิดสำหรับ `ARCHIVED`**

### 1.8 ผู้ใช้ข้ามร้าน (G9)

`User` เป็น global, `CompanyMembership` Cascade ตาม Company (ถูกแล้ว — ไม่ไปลบ account คนอื่น)
แต่ user ที่เหลือ 0 membership จะเป็นบัญชีลอย: ล็อกอินได้ ไม่มีร้าน และ `ExternalIdentity` (LINE) ยังผูกอยู่

### 1.9 Backup (G10)

prod RDS `BackupRetentionPeriod = 35` (`infra/production/bootstrap-data.sh:279`)
→ สำเนาหมดอายุเองภายใน 35 วัน ซึ่งอยู่ในเพดาน 90 วันของ PDPA
แต่ยังไม่มี tombstone manifest + replay ตาม runbook §8 → restore ในช่วง 35 วันจะปลุกข้อมูลกลับมา

### 1.10 control plane ของเคสมีครบแล้ว

- `DataRightsCase` + `DataRightsDecisionRecord` + `DataRightsEvidenceRecord` + `DataRightsCaseActionRecord`
- UI: `apps/web/app/system/data-rights/` (list / new / `[caseId]`)
- permission `system.data_rights.manage` riskLevel CRITICAL, ไม่มี tenant role ใดได้รับ
- `DataRightsRequestSource.EMAIL` และ `DataRightsCaseType.COMPANY_WORKSPACE_OFFBOARDING` มีอยู่แล้ว
- 12 `DataRightsDecisionCategory` × 6 `DataRightsDisposition`
- `assertExecutionEvidence()` บังคับ `sha256` ตรง `/^[0-9a-f]{64}$/` จริง
- `assertRetentionDatesCurrent()` บังคับ `RETAIN`/`RESTRICT` ต้องมี `retentionUntil` อนาคต + `accessRestriction` ไม่ว่าง

**สิ่งที่ขาดคือชิ้นเดียว: ตัวลงมือและตัวผลิตหลักฐาน** — runbook §7 ยอมรับว่า `run://` / `evidence://`
เป็นคำรับรองที่พิมพ์มือ ยังไม่ resolve กับ evidence store ใด ๆ

### 1.11 `CompanyBusinessPolicy.retentionPolicyJson` เป็นช่องว่างเปล่า

คอลัมน์ `Json @default("{}")` มีอยู่ แต่ grep แล้วไม่มีโค้ด production ตัวไหนอ่านเลย

---

## 2. มติ Owner 2026-09-15 (ทั้งหมด 4 ข้อ)

| # | มติ | ผล |
|---|---|---|
| **D1** | ลบแบบ **manual** หลังลูกค้ายื่นคำร้อง**ทางอีเมล** ไม่มีปุ่ม self-service | ไม่ต้องออก Terms/Privacy ฉบับใหม่ — หน้า `/data-deletion` ที่เผยแพร่แล้วอธิบาย "ช่องทางคำขอที่ตรวจสอบตัวตน" ตรงอยู่แล้ว |
| **D2** | **ไม่มีคำร้อง = ห้ามลบจนกว่าจะครบอายุตามกฎหมาย** | "เกิน xx วัน" ไม่ใช่ทริกเกอร์ลบ เป็นทริกเกอร์ `ARCHIVED` เท่านั้น; ไม่ต้องมี cron auto-purge ทั้งสองเส้นทาง |
| **D3** | โปรเจคมี **System Admin คนเดียว** → เปิด single-admin mode ตามแบบ `selfApproved` | ไม่บล็อก แต่บันทึกตามจริงว่าคนเดียวทำทุกบทบาท |
| **D4** | **รอ 1 วันหลังอนุมัติเป็นค่าตั้งต้น** + มีปุ่มลบทันทีที่ต้องยืนยันซ้ำ | ปุ่มลบทันทีต้องพิมพ์เหตุผล ไม่ใช่ดับเบิลคลิก |

---

## 3. ขอบเขต

### 3.1 In scope

- ทำให้ `ARCHIVED` ตัดการเข้าถึงจริง (§4)
- เครื่องมือนับของ (inventory) แบบอ่านอย่างเดียว (§5)
- นาฬิกาเก็บรักษาสองชั้นและวันครบกำหนดที่เก็บไว้ได้ (§6)
- ปิดรู FK ให้ลบได้สะอาด (§7)
- single-admin mode + ด่านที่เครื่องตรวจ (§8)
- executor + ตัวผลิตหลักฐาน 6 ชิ้น (§9)

### 3.2 Non-goals

- **ไม่มีปุ่มลบให้เจ้าของร้านกดเอง** (D1)
- **ไม่มี cron ลบข้อมูลอัตโนมัติ** (D2) — ทุกการลบต้องมีคนกด
- ไม่แก้กติกาการกู้คืนของ `DISABLED` (§1.7) — คงไว้ทั้งหมด
- ไม่ทำ backup tombstone/replay ในรอบนี้ (§1.9) — บันทึกเป็นข้อจำกัดที่ประกาศตามจริง
- ไม่แตะ CRM end-customer erasure ที่มีอยู่แล้ว (`CrmCustomer.personalDataErasedAt`)
- ไม่เผยแพร่ระยะเวลาเก็บรักษาที่แน่นอนบนหน้าสาธารณะ จนกว่า Operations จะพิสูจน์ได้จริง
  (ข้อจำกัดเดิมจาก privacy plan §5)

---

## 4. วงจรชีวิตร้านค้า

```
ACTIVE
  │
  ├─(ยกเลิก / term หมด)──────────→ DISABLED        ← สถานะเดิม ไม่เปลี่ยนพฤติกรรม
  │                                   • เส้นทางกู้คืน §1.7 ยังทำงานครบ
  │                                   • ต่ออายุแล้วกลับ ACTIVE ได้
  │
  ├─(ครบ xx วัน / แอดมินสั่ง)─────→ ARCHIVED        ← §4.1 ต้องล็อกประตูจริง
  │                                   • เข้าไม่ได้ทุกช่องทาง
  │                                   • ข้อมูลยังอยู่ครบ ถือไว้ตาม §6
  │                                   • แอดมินสั่งกลับ ACTIVE ได้
  │
  └─(มีคำร้อง §9 / ครบอายุกฎหมาย §6)→ PURGED
```

`SUSPENDED` เป็นสถานะความปลอดภัยแยกต่างหาก ไม่อยู่ในวงจรนี้
(`PartnerLifecycleTransitionUseCase` ปฏิเสธ `SUSPENDED` เป็น target อยู่แล้ว)

### 4.1 `ARCHIVED` ต้องทำอะไรเพิ่มจากวันนี้

ใน transaction เดียวกับที่เปลี่ยน `status`:

| # | การกระทำ | เหตุผล |
|---|---|---|
| A1 | เพิกถอน `AuthSession` ทุกใบของทุก membership ในร้านนั้น | ปิด G8 |
| A2 | ปิด `LineChannelBinding` ของร้าน + หยุดตอบ LINE | ปิด G8 |
| A3 | สั่งยกเลิก Stripe subscription ให้สำเร็จ **ก่อน** เปลี่ยนสถานะ | ปิด G3 — ห้ามตัดบัตรร้านที่ปิดแล้ว |
| A4 | หยุดส่ง `OutboxEvent` / worker ของร้าน | runbook §7 "stop new writes" |
| A5 | ปิดเส้นทางกู้คืน §1.7 สำหรับ `ARCHIVED` (คงไว้เฉพาะ `DISABLED`) | ไม่ให้เข้าร้านที่ปิดถาวร |
| A6 | บันทึก AuditLog CRITICAL พร้อมผลของ A1–A5 รายข้อ | หลักฐาน |

**A3 ต้องเป็น fail-closed:** ถ้ายกเลิก Stripe ไม่สำเร็จ ห้ามเปลี่ยนสถานะเป็น `ARCHIVED`
ให้เคสค้างไว้และแจ้ง operator แทน — เพราะสถานะที่บอกว่า "ปิดแล้ว" ขณะที่ยังตัดบัตรอยู่ คือคำโกหก

### 4.2 xx วัน

- นับจาก `Company.disabledAt` (ไม่ใช่ `termEndsAt`) เพราะ `termDisabledAt` ถูกเคลียร์เมื่อแอดมินสั่งปิดเอง
  (`partner-lifecycle-transition.use-case.ts` บรรทัดที่เคลียร์ `termDisabledAt`)
- ค่าตั้งต้นที่เสนอ: **90 วัน** — ตรงกับเพดาน PDPA ที่ประกาศไว้ และยาวกว่า backup 35 วัน
- ร้านที่ไม่มีแถว `CompanyPlanTerm` (legacy/grandfathered) **ไม่ถูกนับ** และไม่ถูกย้ายสถานะอัตโนมัติ
- การย้าย `DISABLED → ARCHIVED` ขึ้น worklist ให้แอดมินเห็น **ไม่ใช่ cron ที่ย้ายเอง** (D2)

---

## 5. เครื่องมือนับของ (Inventory)

อ่านอย่างเดียว ไม่แก้ข้อมูลใด ๆ รับ `companyId` คืน JSON ที่ hash ได้

ต้องรายงานอย่างน้อย:

1. จำนวนแถวต่อตารางทั้ง 194 ตารางที่ถือ `companyId` **รวม 20 ตาราง orphan ใน §1.2**
   (orphan ต้องถูกนับด้วย `companyId` ตรง ๆ เพราะไม่มี FK ให้ join)
2. จำนวน `AttachmentObject` + จำนวน object/version จริงใน storage ต่อยอด
   `getExactObjectVersionInventory` / `object-version-inventory.logic.ts` ที่มีอยู่
3. สถานะ Stripe: `subscriptionState`, `cancelAtPeriodEnd`, `paidThrough`, `baseSubscriptionId`
4. จำนวน `AuthSession` ที่ยัง active และ `LineChannelBinding` ที่ยังผูกอยู่
5. วันครบกำหนดเก็บรักษาที่คำนวณได้ตาม §6
6. รายการ FK ที่จะบล็อกการลบ (§1.1) ถ้ายังไม่ได้แก้

ผลลัพธ์ต้องเป็นไฟล์ที่ hash ด้วย SHA-256 ได้ ไม่ใช่ข้อความบนหน้าจอ
เพราะจะถูกใช้เป็นหลักฐาน `OBJECT_STORAGE_INVENTORY` และครึ่ง "ก่อน" ของ `DATABASE_EXECUTION`

**ต้องรันได้บน production ผ่าน SSM port-forward** ตาม `docs/runbooks/` ที่มีอยู่
และต้องประกาศให้ Owner ทราบก่อนเปิด session เพราะทุก session ยิงเมลแจ้งเตือนความปลอดภัย

---

## 6. นาฬิกาเก็บรักษาสองชั้น

### 6.1 หลักการ

D2 บอกว่า "ไม่มีคำร้อง = เก็บจนครบอายุตามกฎหมาย" แต่ถ้าอ่านว่า "เก็บทุกอย่าง 5 ปี"
จะ**ผิด PDPA อีกทาง**: แชท LINE, ข้อมูลลูกค้า CRM, AI turn, webhook log ไม่มีฐานกฎหมายให้เก็บ 5 ปี
และ PDPA ม.37(3) สั่งให้ลบเมื่อพ้นวัตถุประสงค์

จึงต้องแยกสองนาฬิกา ซึ่งโครงสร้างรองรับอยู่แล้วเพราะ `DataRightsDecisionCategory`
แยก 12 หมวดพร้อม disposition รายหมวดมาตั้งแต่ต้น

### 6.2 ตารางนาฬิกา

| นาฬิกา | หมวด | ครบกำหนดเมื่อ | disposition |
|---|---|---|---|
| **A — สั้น** | `AI_OCR_DATA`, `QUEUES_CACHES`, ตาราง LINE/CRM ที่ไม่ผูกเอกสารบัญชี | ตอนเข้า `ARCHIVED` | `DELETE` / `ANONYMIZE` |
| **B — ยาว** | `ACCOUNTING_TAX_DOCUMENTS` + `ATTACHMENTS_OBJECT_VERSIONS` ของเอกสารเหล่านั้น | ตาม §6.3 | `RETAIN` แล้วค่อย `DELETE` |
| **B — ยาว** | `AUDIT_SECURITY_LOGS`, `LEGAL_ACCEPTANCE_EVIDENCE` | ตาม §6.3 | `RETAIN` |

นาฬิกา A ไม่ขัดกับ D2 เพราะของกลุ่มนี้ "ครบตามกฎหมาย" ตั้งแต่วันเลิกใช้แล้ว —
ไม่มีกฎหมายไหนสั่งให้เก็บต่อ

### 6.3 วันครบกำหนดนับราย**เอกสาร** ไม่ใช่รายร้าน

- พ.ร.บ.การบัญชี ม.14 → อย่างน้อย **5 ปี นับจากวันปิดบัญชี** (สั่งขยายได้ถึง 7 ปี)
- ประมวลรัษฎากร ม.87/3 → **5 ปี** มีจุดเริ่มของตัวเองและกฎเลิกกิจการแยก

→ ร้านที่ยกเลิกวันนี้ เอกสารเมื่อ 3 ปีก่อนเหลืออีก 2 ปี แต่เอกสารเดือนที่แล้วเหลืออีกเกือบ 5 ปี
→ **วันลบของร้าน = วันครบกำหนดที่ช้าที่สุดในบรรดาเอกสารทั้งหมด**

จุดยึดที่มีอยู่แล้วในสคีมา: `AccountingPeriod.endDate` / `AccountingPeriod.closedAt`
(+ `LedgerPeriodStatus`) และ `TaxPeriod`

### 6.4 ต้องเก็บเป็นค่าที่อ่านและแก้ได้ ไม่ใช่คำนวณสด

เพราะ ม.14 เปิดช่องให้สั่งขยายถึง 7 ปี และกรณีเลิกกิจการ VAT มีกฎแยก
→ ค่าวันครบกำหนดต้องเป็นค่าที่บันทึกไว้ แก้ได้ พร้อมเหตุผลและผู้แก้ ไม่ใช่ constant ในโค้ด

`CompanyBusinessPolicy.retentionPolicyJson` (§1.11) เป็นที่ที่ใกล้เคียงที่สุดและยังว่างอยู่
แต่ยังไม่มีสคีมา — แผนต้องกำหนดรูปร่างของ JSON นี้ให้ชัดก่อนเขียน

---

## 7. ปิดรู FK

### 7.1 แก้ตัวบล็อก (§1.1)

| ตาราง | จากเดิม | เป็น |
|---|---|---|
| `CompanyOnboardingRun` | ไม่ระบุ (Restrict) | `onDelete: Cascade` |
| `ExpenseSubstituteReceiptEvidence` | `Restrict` | `Cascade` |
| `CrmDataSubjectRequest` → `CrmCustomer` | `Restrict` | `Cascade` |

`ExpenseSubstituteReceiptEvidence` เป็น `Restrict` โดยตั้งใจเพื่อกันลบหลักฐานใบแทนใบเสร็จ
การเปลี่ยนเป็น Cascade ต้องมาคู่กับ §6 ที่จัดหมวดมันไว้ในนาฬิกา B —
ห้ามเปลี่ยนเป็น Cascade เฉย ๆ โดยไม่มีนาฬิกาคุม

### 7.2 ผูก FK ให้ 20 ตาราง orphan (§1.2)

ผูก `companyId` → `Company.id` พร้อม `onDelete` ที่เหมาะกับหมวดของมันใน §6.2:

- กลุ่ม LINE / CRM ที่เป็นนาฬิกา A → `Cascade`
- `DataRightsCase`, `LegalDocumentActionRecord` → **ห้าม Cascade** ใช้ `SetNull` หรือคงไว้แบบมีตัวชี้
  เพราะเป็นหลักฐานที่ต้องอยู่ต่อหลังร้านหายไป (นาฬิกา B)
- `BillingAccount` + `BillingIssue` / `BillingOperation` / `BillingQuote` / `BillingOperatorScope`
  → ต้องผูก FK เพื่อให้ตามเจอ แต่การลบต้องผ่าน A3 (ยกเลิก Stripe) ก่อนเสมอ
- `Role` (`companyId String?`) → `SetNull` หรือ `Cascade` ตามว่าเป็น role ของร้านหรือ role กลาง
- `PlatformAiBudgetConfig`, `RemoteReleaseMutationIntent` → ตรวจว่าเป็นข้อมูลระดับแพลตฟอร์มหรือของร้าน

**ต้องตรวจทีละตารางว่าเป็นของร้านจริงหรือเป็นข้อมูลกลางที่บังเอิญมี `companyId`**
ห้ามใส่ Cascade ยกแผงโดยไม่ดู

### 7.3 `AuditLog` / `OutboxEvent` (§1.5)

คง `SetNull` ไว้ แต่ต้องเป็นการเก็บ**โดยตั้งใจ**:
บันทึก tombstone ที่ยังชี้ได้ว่าเคยเป็นของร้านไหน + ย่อ PII ใน `metadataJson` ตามหมวดนาฬิกา B

---

## 8. Single-admin mode และด่านที่เครื่องตรวจ

### 8.1 ปัญหา

`data-rights.service.ts` บังคับแยกบทบาท 4 ข้อ (throw `ForbiddenException`):

| บรรทัด | กฎ |
|---|---|
| 552 | ผู้สร้างเคส ≠ ผู้อนุมัติ |
| 570 | ผู้อนุมัติ ≠ ผู้ลงมือลบ |
| 584 | ผู้ลงมือลบ ≠ ผู้ตรวจสอบ |
| 612 | ผู้ลงมือลบ ≠ ผู้ปิดเคส |

ขณะที่ runbook §2 ของเราเองเขียนว่า
"One person may hold several roles in a small team, **but the executor must not approve
their own evidence** for a full-company irreversible deletion"

→ **โค้ดเข้มกว่านโยบายที่เอกสารกำหนดเอง** และเมื่อมีแอดมินคนเดียว (D3) เคสจะเดินไม่ได้เลย

### 8.2 การบล็อกไว้ไม่ได้ปลอดภัยกว่า

โค้ดวันนี้ไม่ได้กันการลบที่ผิดพลาด มันกันการลบทุกกรณี
ถ้าลูกค้ายื่นคำร้อง PDPA เข้ามา เราจะทำไม่ทันกำหนด 90 วันเพราะกระบวนการของเราเอง
ซึ่งเป็นผลเสียทางกฎหมายที่แย่กว่าการลบโดยคนเดียวที่บันทึกไว้ตามจริง

### 8.3 แบบแผนที่ repo นี้ใช้อยู่แล้ว — ห้ามคิดใหม่

`substitute-receipt.use-case.ts:43-47` (Owner decision 2026-08-10):

```
selfApprovalPermitted(approvalMode, roles)     ← OWNER/ADMIN/MANAGER ได้รับยกเว้น
selfApproved = evidence.payerUserId === ctx.userId
→ เก็บ selfApproved ลงในหลักฐานเสมอ (บรรทัด 1194)
```

**หลักการ: อนุญาตให้ทำคนเดียวได้ แต่บันทึกตามจริงว่าทำคนเดียว**
ไม่ใช่บล็อก และไม่ใช่สร้างบัญชีแอดมินที่สองให้คนเดียวกันสวมสองหมวก
(อย่างหลังคือการเขียนหลักฐานเท็จลงในบันทึกที่ใช้อ้างกับ regulator — แย่กว่าไม่มีหลักฐาน)

### 8.4 ด่านสองกลุ่ม

คนที่สองกันความผิดพลาดได้ 2 แบบซึ่งไม่เท่ากัน จึงไม่ควรข้ามได้เหมือนกัน:

| | กันอะไร | ข้ามได้ไหม |
|---|---|---|
| ลบผิดร้าน | ความเสียหายถาวรกับคนที่ไม่เกี่ยวข้อง กู้ไม่ได้ | **ห้ามข้าม** |
| ทำเร็วเกินไป | ความเสียหายกับร้านที่ตั้งใจลบอยู่แล้ว | ข้ามได้ ถ้าบันทึกเหตุผล |

**ด่านบังคับ — ข้ามไม่ได้ทั้งสองเส้นทาง:**

| # | ด่าน | เหตุผล |
|---|---|---|
| E1 | ต้องมีรายงานนับของ (§5) ที่ hash แล้ว และ **สร้างไม่เกิน 1 ชม.** ก่อนกด execute | รายงานเก่าไม่ได้บอกว่ากำลังจะลบอะไร |
| E2 | ต้องพิมพ์ชื่อร้านให้ตรง | ด่านเดียวที่กัน "ลบผิดร้าน" ได้จริง |
| E3 | หลักฐานทั้ง 6 ชิ้นต้องมาจากเครื่อง ไม่ใช่พิมพ์มือ | ปิดช่อง runbook §7 |

**ด่านที่ข้ามได้ (D4):**

| # | ด่าน |
|---|---|
| E4 | รอ **1 วัน** หลังกดอนุมัติ = ค่าตั้งต้น |
| E4' | ปุ่ม "ลบทันที" ต้อง**พิมพ์เหตุผล** (ไม่ใช่ดับเบิลคลิก — กดซ้ำห่างกัน 2 วินาทีไม่ใช่การคิดทบทวนและเผลอกดได้) แล้วบันทึก `cooldownWaivedAt` + เหตุผล + ผู้กด |

### 8.5 ธงที่ต้องติดไปถึงจดหมายแจ้งผล

- `selfExecuted = true` — คนเดียวทำทุกบทบาท
- `cooldownWaived = true` + เหตุผล — ถ้ากดลบทันที

ถ้าวันหนึ่งมีคนมาตรวจ เอกสารต้องเล่าเรื่องจริง ไม่ใช่เรื่องที่อยากให้เป็น

### 8.6 สิ่งที่ห้ามแตะ

- ห้ามลด `system.data_rights.manage` จาก CRITICAL และห้ามให้ tenant role ใดได้รับ
- ห้ามปิด `assertExecutionEvidence()` หรือยอมรับ sha256 ปลอม
- ห้ามปิด `assertRetentionDatesCurrent()`
- single-admin mode ต้องเป็น**การตั้งค่าที่ประกาศชัด** ไม่ใช่ผลข้างเคียงจากการที่บังเอิญมีแอดมินคนเดียว

---

## 9. Executor และหลักฐาน 6 ชิ้น

### 9.1 หลักฐานที่เครื่องจักรเคสเรียกร้องอยู่แล้ว

`dataRightsRequiredExecutionEvidence('COMPANY_WORKSPACE_OFFBOARDING')`
(`packages/contracts/src/data-rights.ts:216`) ต้องครบ:

```
ACCESS_REVOCATION   DATABASE_EXECUTION      OBJECT_STORAGE_INVENTORY
QUEUE_CACHE_PURGE   PROCESSOR_CONFIRMATION  BACKUP_MANIFEST
```
+ `INDEPENDENT_VERIFICATION` ตอนปิดเคส

### 9.2 ลำดับการลบที่ถูกต้อง

```
1. ยกเลิก Stripe ให้สำเร็จ                    → PROCESSOR_CONFIRMATION
2. เพิกถอน session / LINE / outbox            → ACCESS_REVOCATION
3. รายงานนับของ "ก่อน" (§5)                   → E1
4. ลบไฟล์ใน object storage ก่อน               → OBJECT_STORAGE_INVENTORY
5. แล้วค่อยลบแถวในฐานข้อมูล                   → DATABASE_EXECUTION
6. ล้าง queue / cache / pending job            → QUEUE_CACHE_PURGE
7. บันทึก backup manifest / tombstone          → BACKUP_MANIFEST
8. รายงานนับของ "หลัง" → เทียบกับข้อ 3         → INDEPENDENT_VERIFICATION
```

**ข้อ 4 ต้องมาก่อนข้อ 5 เสมอ** เพราะ index `(bucket, objectKey)` อยู่ในแถวที่จะถูกลบ (§1.4)

### 9.3 ห้ามใช้ `prisma.company.delete()` เป็นกลไก

cascade ~162 relation ในทรานแซกชันเดียว = all-or-nothing, ล็อกตารางยาว, ย้อนไม่ได้, ไม่มี progress
→ ต้องเป็น purge job ไล่ตารางตามลำดับ **idempotent + resumable** พร้อมนับจำนวนต่อตาราง

### 9.4 `PROCESSOR_CONFIRMATION` จะทำให้เคสแรกปิดไม่ลง

ทะเบียน `docs/security-evidence/processor-cross-border-register.md` ยังเป็น `[OBTAIN]` ทั้งแผง
→ เคสจริงเคสแรกจะจบได้แค่ `COMPLETED_WITH_EXCEPTION` ไม่ใช่ `COMPLETED`
ซึ่งไม่ผิด แต่จดหมายแจ้งผลต้องเขียนตามนั้น ไม่ใช่เขียนว่า "ลบครบถ้วนสมบูรณ์"

---

## 10. ข้อจำกัดที่ต้องประกาศตามจริง

ห้ามบอกลูกค้าว่า "ลบถาวรทั้งหมด" จนกว่าจะพิสูจน์ได้ (runbook §9) โดยเฉพาะ:

1. **Backup** — สำเนาใน RDS หมดอายุเองภายใน 35 วัน แต่ยังไม่มี tombstone/replay
   → ถ้ามี restore ในช่วงนั้น ข้อมูลจะกลับมา ต้องเขียนในจดหมายตามจริง
2. **Processor** — ยังไม่มีหลักฐานยืนยันจากผู้ประมวลผลภายนอกครบทุกราย (§9.4)
3. **นาฬิกา B** — เอกสารบัญชี/ภาษีจะยังอยู่หลัง "ลบ" พร้อมวันสิ้นสุดและการจำกัดการเข้าถึง

---

## 11. Acceptance criteria

### 11.1 `ARCHIVED` (§4)

- [ ] เปลี่ยนเป็น `ARCHIVED` แล้ว session เดิมทุกใบใช้ไม่ได้ทันที
- [ ] LINE ของร้านไม่ตอบข้อความอีก
- [ ] Stripe subscription ถูกยกเลิกสำเร็จ **ก่อน** สถานะเปลี่ยน; ถ้ายกเลิกไม่สำเร็จ สถานะไม่เปลี่ยน
- [ ] `OutboxEvent` / worker ของร้านหยุด
- [ ] เส้นทางกู้คืน §1.7 ทั้ง 8 จุดยังทำงานกับ `DISABLED` และปิดกับ `ARCHIVED`
- [ ] AuditLog CRITICAL บันทึกผล A1–A5 รายข้อ
- [ ] แอดมินสั่ง `ARCHIVED → ACTIVE` ได้ และ session/LINE/Stripe ไม่ฟื้นเองโดยไม่ตั้งใจ

### 11.2 Inventory (§5)

- [ ] รับ `companyId` คืน JSON ที่ hash ได้ ไม่แก้ข้อมูลใด ๆ
- [ ] นับครบทั้ง 194 ตาราง รวม 20 orphan
- [ ] นับ object/version จริงใน storage ไม่ใช่แค่แถวใน DB
- [ ] รายงาน FK ที่จะบล็อกการลบ
- [ ] รันบน production ผ่าน SSM port-forward ได้

### 11.3 นาฬิกา (§6)

- [ ] คำนวณวันครบกำหนดจาก `AccountingPeriod` ได้ และเก็บเป็นค่าที่แก้ได้พร้อมเหตุผล/ผู้แก้
- [ ] หมวดนาฬิกา A ลบได้ตอน `ARCHIVED` โดยไม่แตะหมวดนาฬิกา B
- [ ] ร้านที่ยังไม่ครบกำหนด ระบบปฏิเสธการลบหมวดนาฬิกา B (D2 fail-closed)

### 11.4 FK (§7)

- [ ] `prisma.company.delete()` บนร้านทดสอบที่มีข้อมูลครบทุกโมดูลไม่ error
- [ ] หลังลบ ไม่มีแถวค้างใน 20 ตาราง orphan
- [ ] `DataRightsCase` / `LegalDocumentActionRecord` **ยังอยู่** หลังร้านถูกลบ
- [ ] `AuditLog` ยังอยู่และยังสืบย้อนได้ว่าเคยเป็นของร้านไหน

### 11.5 Single-admin (§8)

- [ ] แอดมินคนเดียวพาเคสจาก `RECEIVED` ถึง `COMPLETED_WITH_EXCEPTION` ได้จบ
- [ ] เคสที่ทำคนเดียวติดธง `selfExecuted` และธงนี้ปรากฏในจดหมายแจ้งผล
- [ ] E1: รายงานเก่ากว่า 1 ชม. → execute ไม่ได้
- [ ] E2: พิมพ์ชื่อร้านผิด → execute ไม่ได้
- [ ] E4: ยังไม่ครบ 1 วัน และไม่กดลบทันที → execute ไม่ได้
- [ ] E4': กดลบทันทีโดยไม่พิมพ์เหตุผล → execute ไม่ได้
- [ ] กดลบทันทีพร้อมเหตุผล → execute ได้ และติดธง `cooldownWaived` + เหตุผลในจดหมาย
- [ ] `assertExecutionEvidence` / `assertRetentionDatesCurrent` ยังบังคับเหมือนเดิม
- [ ] sha256 ที่ไม่ตรงรูปแบบยังถูกปฏิเสธ

### 11.6 Executor (§9)

- [ ] ลบไฟล์ก่อนลบแถวเสมอ
- [ ] purge job idempotent — รันซ้ำได้ผลเดิม ไม่ error
- [ ] purge job resumable — ขาดกลางคันแล้วรันต่อได้
- [ ] รายงาน "หลัง" เทียบกับ "ก่อน" แล้วชี้ได้ว่าอะไรถูกลบ อะไรถูกเก็บต่อและเพราะอะไร

---

## 12. คำถามที่ยังเปิด

| # | คำถาม | บล็อกอะไร |
|---|---|---|
| Q1 | `xx` = 90 วันตามที่เสนอใน §4.2 หรือค่าอื่น | Phase D1 (ตั้งค่า worklist) |
| Q2 | แยกสองนาฬิกาตาม §6.2 หรือเก็บทุกอย่าง 5 ปี | Phase D3 |
| Q3 | เอกสารบัญชีหลังครบ 5 ปี — เก็บในฐานเดิมแล้วลบ หรือ export ส่งลูกค้าแล้วลบทันที (disposition `RETURN`) | Phase D3 |
| Q4 | user ที่เหลือ 0 membership — ปล่อย / ปิด / ถามผู้ใช้ | Phase D5 |
| Q5 | ใครเฝ้า `contact@mangmeeplus.com` และตอบรับภายในกี่วัน | ไม่บล็อกโค้ด แต่บล็อกการประกาศช่องทางเป็นทางการ |

Q1–Q4 ไม่บล็อก Phase D1/D2 ซึ่งเป็นงานที่เริ่มได้ทันที
