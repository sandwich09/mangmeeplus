# แผนงาน: บัญชีรับเงินคืนของผู้เบิก และสลิปการจ่ายเงินคืน

วันที่: 1 ตุลาคม 2569

สถานะ: แผนพร้อม ยังไม่เริ่ม implement รอเจ้าของสั่งเริ่ม และรอคำตอบคำถามเปิดในสเปค §24 เฉพาะงานที่ระบุว่ารอ

ฐานโค้ดที่ตรวจ: `origin/develop` `219c2369`

## เอกสารที่เชื่อมโยง

- สเปค: [reimbursement-payout-account-and-payment-slip-spec-th.md](../specs/reimbursement-payout-account-and-payment-slip-spec-th.md)
- สถานะงาน: [reimbursement-recipient-bank-account.md](../agent-memory/reimbursement-recipient-bank-account.md)
- ผลวิเคราะห์ผลกระทบ: [reimbursement-recipient-bank-account-impact-2026-09-29-th.md](../research/reimbursement-recipient-bank-account-impact-2026-09-29-th.md)
- สเปคที่เกี่ยวข้อง: [reimbursement-step-journey-spec-th.md](../specs/reimbursement-step-journey-spec-th.md), [reimbursement-approval-spec.md](../specs/reimbursement-approval-spec.md), [reimbursement-approver-routing-policy-spec.md](../specs/reimbursement-approver-routing-policy-spec.md), [permission-matrix.md](../specs/permission-matrix.md)
- Runbook เมื่อถึงเวลา deploy: `docs/runbooks/uat-production-v2-deployment.md`
- แนวทาง: `docs/guidelines/web-frontend-code-style.md`, `docs/guidelines/backend-hexagonal-code-style.md`, `.agents/skills/ponytail/SKILL.md`

วิธีอ้างไฟล์ในแผนนี้: path ที่ขึ้นต้นด้วย `application/`, `domain/`, `infrastructure/`, `presentation/` และ `reimbursements.module.ts` อยู่ใต้ `apps/api/src/modules/reimbursements/` ชื่อไฟล์ที่ไม่มี path อยู่ใต้ `apps/web/src/features/reimbursements/` (ไฟล์ `.tsx` และไฟล์ที่ขึ้นต้นด้วย `reimbursements.`) หรือใต้ `apps/api/src/modules/reimbursements/**` (ไฟล์อื่น) ตัวเลขหลัง `:` คือเลขบรรทัดที่ `origin/develop` `219c2369`

## จุดประสงค์

ทำให้ผู้อนุมัติและผู้จ่ายเห็นบัญชีรับเงินคืนที่ผ่านการตรวจของคน ใบที่จ่ายด้วยการโอนมีสลิป และบัญชีผิดแก้ได้ในใบเดิม ตามคำตัดสิน P1, D1 ถึง D4 ในสเปค §2.2 โดยไม่เพิ่มสถานะคำขอ enum ค่าใหม่ permission key หรือสวิตช์ฟีเจอร์

## กติกาการทำงาน

- ทำตาม ponytail full: diff สั้นที่สุด ใช้แบบแผนเดิม ไม่สร้าง abstraction ล่วงหน้า ไม่เพิ่ม dependency
- ไม่แก้ `package.json` เทสต์ API ใหม่ใส่ในไฟล์ spec ที่อยู่ในรายการของ script `test` ใน `apps/api/package.json` แล้ว เว็บใช้ glob จึงเพิ่มไฟล์ spec ใหม่ได้ spec ที่ไม่อยู่ในรายการ (เช่น `reimbursement-approval-backlog.use-case.spec.ts`, `packages/contracts/src/reimbursements.spec.ts`) ต้องรันเองและบันทึกผล
- ทุก mutation อยู่บนเว็บและ API ไม่มีงานใดย้ายไป LINE หรือ AI Gateway
- migration เป็นการเพิ่มอย่างเดียว คอลัมน์ใหม่ nullable ไม่มี backfill ไม่มี enum ค่าใหม่
- ข้อความบนหน้าจอผ่านการตรวจภาษาไทยธรรมดา (`ReimbursementPages.plain-thai.qa.spec.ts`) และออกแบบที่ 390 px ก่อน
- เลขบัญชีเต็มออกจากระบบได้ทางเดียวคือคำสั่งแสดงเลขบัญชี ทุก PR ต้องมีเทสต์ยืนยันว่า projection อื่นไม่มีเลขเต็ม
- การตรวจในเครื่อง: typecheck ของ api, web, contracts ชุดเทสต์เว็บ และ spec ที่แตะ ชุดเต็มรันใน CI ครั้งเดียวตอนเปิด PR ตามแนวทางของเจ้าของ
- รวมงานของแต่ละ phase ให้จบก่อนเปิด PR และถามเจ้าของก่อนขึ้น production ทุกครั้ง
- ทุก phase จบด้วยการตรวจอย่างน้อยหนึ่งอย่างที่รันได้จริง และบันทึกผลในสถานะงาน

## ภาพรวม phase

| Phase | เนื้อหา | ปล่อยเดี่ยวได้ | ต้องมีก่อน | ขนาดโดยประมาณ |
|---|---|---|---|---|
| 0 | แก้หน้าจอเร่งด่วน และสิทธิ์บันทึกจ่ายของบทบาทเก่า | ได้ | — | 1.5 วัน |
| 1 | บัญชีประจำ สำเนาในใบ การรับรองตอนอนุมัติ การแสดงและยืนยันตอนจ่าย การปิดบัง | ได้ | — | 6 วัน |
| 2 | สลิปตอนบันทึกจ่าย และการย้ายสลิปที่แนบผิดช่อง | ได้ | — (ไม่ขึ้นกับ Phase 1 ทำสลับหรือขนานได้) | 3.5 วัน |
| 3 | ส่งกลับแก้บัญชีและอนุมัติใหม่ (3A แล้ว 3B) | ได้ | Phase 1 | 6 วัน (3A 4 วัน, 3B 2 วัน) |
| 4 | ใบพิมพ์ ประวัติ แจ้งเตือน คู่มือ | ได้ | Phase 1 และ 2 ส่วนของรอบแก้บัญชีต้องมี Phase 3 | 3 วัน |

รวมประมาณ 20 วันทำงาน ลำดับที่แนะนำ: 0 → 2 กับ 1 ขนานกัน → 3A → 4 → 3B

เหตุผลของลำดับ: Phase 0 หยุดปัญหาเดิมไม่ให้เกิดซ้ำได้ทันที Phase 2 เล็กกว่าและตอบเรื่องสลิปที่เกิดจริง Phase 1 ใหญ่ที่สุดและเป็นฐานของ Phase 3 ระหว่างที่ Phase 1 ปล่อยแล้วแต่ Phase 3 ยังไม่ปล่อย บัญชีผิดหลังอนุมัติยังต้องยกเลิกแล้วสร้างใหม่ หน้าใบต้องบอกตรง ๆ (สเปค §14.8) จึงควรปล่อย 3A ให้ใกล้ Phase 1 ที่สุด

## Phase 0: แก้หน้าจอเร่งด่วน

เป้าหมาย: สเปค §18 และ §13.3 (F1, F2) ไม่มีตารางใหม่

งาน:

- [ ] 0.1 การ์ดสรุปและตัวกรองในหน้ารวม: แยก "รออนุมัติ/ตรวจสอบ" กับ "รอจ่ายเงินคืน" แตะการ์ดแล้วกรองรายการ
- [ ] 0.2 โน้ตขั้นเอกสารบอกชื่อผู้ที่ยังไม่ลงนาม
- [ ] 0.3 รายละเอียดใบเพิ่ม `paymentDesk` (ชื่อผู้ที่บันทึกจ่ายได้) โน้ตขั้นจ่ายเงิน บรรทัด "อยู่ที่" และเส้นทางของใบเลิกใช้คำว่า "ฝ่ายการเงิน" กับใบที่ไม่มีขั้นตรวจการเงิน รวมป้ายในคำตอบ AI เรื่องใบค้าง
- [ ] 0.4 ฟอร์มบันทึกจ่ายไม่เลือกเงินสดให้เอง ต้องเลือกวิธีจ่าย
- [ ] 0.5 ข้อความใต้ช่องและใน dialog "แนบใบเบิกที่เซ็นแล้ว" ว่าไม่ใช่ที่แนบสลิป
- [ ] 0.6 (รอ Q3) เพิ่ม `reimbursement.payment.record` และ `reimbursement.payment.void` ใน `COMPANY_ROLE_BACKFILLS` โดยยึด `reimbursement.approve`
- [ ] 0.7 ตัวเลือกบทบาทผู้อนุมัติเพิ่ม `canRecordPayment` และหน้าตั้งค่านโยบายแสดงคำเตือนเมื่อปิดตรวจการเงิน

ไฟล์ที่แตะ:

- เว็บ: `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` (`:239-246`, `:270-276`, `:286-291`, ส่วนนโยบาย `:886-907`), `reimbursements.logic.ts` (`:108-123`, `:301-321`, `:459-485`), `reimbursements.model.ts` (`:93-107`), `ReimbursementDetailSections.tsx` (`:260-283`, `:286-319`, `:718-723`), `ReimbursementJourneyPage.tsx` (`:229`, `:293`)
- API: `apps/api/src/modules/reimbursements/application/dto/reimbursement.mapper.ts` (`detailWithFileNames`), `infrastructure/prisma-reimbursement.repository.ts` (อ่านชื่อผู้ถือสิทธิ์บันทึกจ่ายที่ใช้งานอยู่และดูแลสาขาของใบ ใช้เงื่อนไขสาขาเดียวกับ `activeApproverMembershipWhere` `:77-93` และตัดสิทธิ์ตาม entitlement แบบเดียวกับ `loadCandidates` ใน `reimbursement-policy.use-case.ts:307-349`), `application/use-cases/reimbursement-policy.use-case.ts` (`:75-118`), `application/use-cases/reimbursement-summary.use-case.ts` (`:76-79`)
- สิทธิ์: `apps/api/src/modules/employee-access/domain/registries/company-role-backfill.registry.ts`, `docs/specs/permission-matrix.md`
- สัญญา: `packages/contracts/src/reimbursements.ts` (`paymentDesk` ในรายละเอียดใบ, `canRecordPayment` ใน `ReimbursementApproverRoleOption`)

Migration: ไม่มี การเติมสิทธิ์ทำงานผ่าน `apps/api/prisma/sync-permissions.ts` ตอน deploy และรันซ้ำได้

ทดสอบ:

- Unit เว็บ: `reimbursements.logic.spec.ts` (แก้ความคาดหวังที่ `:383-384`, `:402-403`, `:440`, `:466`, `:662`, `:682` และเพิ่มกรณีชื่อผู้ลงนามที่ขาด ชื่อผู้ที่จ่ายได้ ผู้อนุมัติที่จ่ายไม่ได้ ใบมีและไม่มีขั้นตรวจการเงิน), `reimbursements.model.spec.ts` (`:281`), `ReimbursementPages.plain-thai.qa.spec.ts` (การ์ดใหม่ ฟอร์มจ่ายไม่มีค่าเริ่ม)
- Unit API ในไฟล์ที่ลงทะเบียนแล้ว: `reimbursement-request.use-case.spec.ts` (รายละเอียดใบมี `paymentDesk` เฉพาะผู้ที่ดูแลสาขา), `apps/api/prisma/sync-permissions.spec.ts` (เติมเฉพาะบทบาทที่มี `reimbursement.approve` รันซ้ำผลเท่าเดิม), `apps/api/src/modules/employee-access/domain/logic/capability.logic.spec.ts` (ทุก pack ที่ให้ `reimbursement.approve` ให้สิทธิ์จ่ายด้วย)
- Spec ที่ไม่อยู่ในรายการ: `reimbursement-approval-backlog.use-case.spec.ts` รันเองหลังเปลี่ยนป้าย
- pg: ไม่มี
- E2E: `e2e/reimbursements.spec.ts` REIMB-07 เลือกวิธีจ่ายก่อนบันทึก

W00 manifest: ไม่ต้อง regenerate ไม่มีไฟล์ใน `sourceHashes` ถูกแตะ (`reimbursement-summary.use-case.ts` ไม่อยู่ในรายการ) ยืนยันด้วยการรัน manifest spec แบบไม่ตั้ง env แล้วรัน `node scripts/run-line-ai-whole-chain-acceptance.mjs` เพราะป้ายในคำตอบ AI เปลี่ยน

ความเสี่ยง:

- 0.6 เพิ่มสิทธิ์ระดับสูงให้บทบาทที่มีอยู่ของทุกบริษัท ต้องได้คำตอบ Q3 ก่อน และแจ้งใน release note
- การอ่านชื่อผู้ถือสิทธิ์เพิ่ม query ต่อการเปิดใบหนึ่งครั้ง ทำเฉพาะรายละเอียดใบ ไม่ทำในรายการ
- e2e และ spec เดิมอิงข้อความเก่า ต้องแก้พร้อมกัน

ขนาด: 1.5 วัน (1 วันถ้ายังไม่ทำ 0.6)

เกณฑ์ออก: AC27 (ส่วนข้อความ), AC28, AC38, AC39, AC40

## Phase 1: บัญชีประจำ สำเนาในใบ และการปิดบัง

เป้าหมาย: สเปค §8 ถึง §11, §12.1 ถึง §12.3, §15 (ส่วนบัญชี) สลิปยังไม่บังคับใน phase นี้

งาน:

- [ ] 1.1 schema และ migration: ตาราง `MemberPayoutAccount`, `ReimbursementPayoutDestination` และคอลัมน์ `payoutMethod`, `payoutDestinationVersion`, `payoutFingerprint` ของใบ กับ `payoutDestinationVersion`, `payoutConfirmedAt`, `methodMismatchReason` ของรายการจ่าย
- [ ] 1.2 สัญญา: ชนิดข้อมูลบัญชี ฟังก์ชันตรวจรูปแบบเดียวสำหรับ API และเว็บ รายชื่อธนาคารกลาง (ย้ายจาก `apps/web/src/features/sales-console/sales-console.logic.ts:517-524` แล้วให้ไฟล์เดิม re-export)
- [ ] 1.3 logic บัญชี: ข้อความ canonical, fingerprint แบบ HMAC ด้วย `credentialEncryptionKey`, การปิดบัง, กลุ่มผู้เปิดเลขเต็ม
- [ ] 1.4 บัญชีประจำ: ดู ตั้ง ลบ เปิดเลขเต็มของตัวเอง และตั้งให้พนักงานโดยผู้ถือ `access.employee.update` พร้อม audit
- [ ] 1.5 ร่าง: รับ `payout` ตอนสร้างและแก้ร่าง รวม `saveAsDefault` และการกรอกแทนโดยผู้จัดทำ
- [ ] 1.6 ส่งอนุมัติ: ตรวจวิธีรับเงินและบัญชี ตรึงเป็นเวอร์ชัน ใน transaction ของ `submitDraftAtomic`
- [ ] 1.7 hash: `computeSnapshotHash` และ `claimSignatureAckHash` เพิ่มส่วน `payout` แบบมีเงื่อนไข ใบเก่าได้ค่าเดิม
- [ ] 1.8 อนุมัติ: บังคับ `payoutVerifiedVersion` สำหรับใบที่รับโอน บันทึกผู้ตรวจใน transaction เดียวกับการตัดสิน
- [ ] 1.9 จ่าย: บังคับ `payoutDestinationVersion`, `payoutConfirmed` และเหตุผลเมื่อวิธีจ่ายต่างจากใบ ภายใต้ lock ของ `recordPaymentAtomic` เพิ่มเวอร์ชันบัญชีในการเทียบการจ่ายซ้ำ
- [ ] 1.10 คำสั่งแสดงเลขบัญชีของใบ พร้อม audit และการปฏิเสธผู้ที่ไม่อยู่ในกลุ่ม
- [ ] 1.11 projection: รายการ คิว รายละเอียด ส่งออก มีแค่ 4 ตัวท้าย
- [ ] 1.12 คำรับรองสำเนากระดาษเก็บเวอร์ชันบัญชีที่รับรอง (ใช้ใน Phase 3)
- [ ] 1.13 เว็บ: การ์ด "รับเงินคืนทาง" ในฟอร์มสร้างและแก้ไข บล็อกในขั้น 1 กล่องบัญชีและช่องรับรองในขั้นอนุมัติ กล่อง "โอนเข้าบัญชีนี้" ปุ่มคัดลอก และช่องยืนยันในขั้นจ่ายเงิน วิธีจ่ายเริ่มต้นตามใบ ปุ่มอนุมัติด่วนของใบที่รับโอนพาไปหน้าใบ
- [ ] 1.14 เว็บ: หน้า "บัญชีรับเงินคืนของฉัน" และการ์ดบัญชีในหน้าแก้ไขพนักงานกับรายชื่อพนักงาน
- [ ] 1.15 ใบเก่า: ขั้นจ่ายเงินแสดงข้อความใบเก่า และบัญชีประจำปัจจุบันของผู้เบิกพร้อมป้าย เก็บสำเนากับรายการจ่ายเมื่อใช้
- [ ] 1.16 ข้อความไทยของรหัสข้อผิดพลาดใหม่ใน `ERROR_CODE_LABELS`

ไฟล์ที่แตะ:

- ฐานข้อมูล: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<เวลา>_reimbursement_payout_account/migration.sql`
- สัญญา: `packages/contracts/src/reimbursements.ts`
- API ใหม่: `apps/api/src/modules/reimbursements/domain/logic/payout-destination.logic.ts`, `application/use-cases/reimbursement-payout.use-case.ts`
- API เดิม: `domain/logic/reimbursement.logic.ts` (`:212-257`), `domain/models/reimbursement.model.ts`, `application/use-cases/reimbursement-request.use-case.ts` (`:117-226`, `:431-722`), `application/use-cases/reimbursement-approval.use-case.ts` (`:216-388`), `application/use-cases/reimbursement-finance.use-case.ts` (`:349-440`, `:541-589`), `application/use-cases/reimbursement-claim-signature.use-case.ts` (`:242-253`), `application/dto/reimbursement.mapper.ts`, `infrastructure/prisma-reimbursement.repository.ts` (`submitDraftAtomic` `:744`, `beginApprovalDecisionAtomic` `:1268`, `recordPaymentAtomic` `:2409`, `linkSignedClaimFormCopy` `:3117`, ตัวแปลงแถว), `presentation/http/reimbursement.dtos.ts`, `presentation/http/reimbursement.controller.ts` (endpoint คงที่ต้องประกาศก่อน `:requestId` ตามหมายเหตุที่ `:105`), `reimbursements.module.ts`
- นอกโมดูล: `apps/api/src/scripts/production-a5-evidence.pg.ts` (`snapshotFields` `:108-142` ต้องส่งส่วนบัญชีเข้า hash เหมือนโค้ดหลัก มิฉะนั้นใบใหม่ที่รออนุมัติจะถูกจัดเป็น hash ไม่ตรง) และ query ที่อ่านหัวใบ `:219-234`
- ไม่แก้: `application/use-cases/line-reimbursement-draft.use-case.ts`, `applyDraftActionAtomic`, และไฟล์ฝั่ง LINE ร่างจาก LINE ตามบัญชีประจำโดยไม่มี field ใหม่
- เว็บ: `apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx`, `ReimbursementJourneyPage.tsx`, `ReimbursementDetailSections.tsx`, `ReimbursementsPages.tsx`, `reimbursements.logic.ts`, `reimbursements.model.ts`, `reimbursements.api.ts`, ไฟล์ใหม่ `ReimbursementPayoutAccountPage.tsx`, route ใหม่ `apps/web/app/(workspace)/companies/[companyId]/reimbursements/payout-account/page.tsx`, `apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx`, `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`, `apps/web/src/features/sales-console/sales-console.logic.ts`

Migration: 2 ตารางใหม่ และคอลัมน์ nullable 6 คอลัมน์ ไม่มี backfill ใบและรายการจ่ายเดิมมีค่าว่างทั้งหมด ซึ่งคือนิยามของใบเก่า

สัญญา: field ใหม่ทุกตัวเป็น field เสริม ชื่อ `accountNumber` ใช้เฉพาะข้อมูลขาเข้าและผลของคำสั่งแสดงเลขบัญชี ที่เหลือใช้ `accountLast4` (สเปค §11.3)

ทดสอบ:

- Unit API ในไฟล์ที่ลงทะเบียนแล้ว:
  - `reimbursement.logic.spec.ts`: hash ของใบที่ไม่มีวิธีรับเงินเท่าค่าเดิม (ค่าตายตัวในเทสต์) hash เปลี่ยนเมื่อวิธี เวอร์ชัน หรือ fingerprint เปลี่ยน กติการูปแบบเลขบัญชีและพร้อมเพย์ เลข 0 นำหน้า การปิดบัง fingerprint คงที่เมื่อเข้ารหัสซ้ำ `redactPayload` ตัด `accountNumber` แต่ไม่ตัด `accountLast4`
  - `reimbursement-request.use-case.spec.ts`: ตามบัญชีประจำ ระบุเอง เงินสด ไม่มีบัญชีประจำ ทำใบแทน `saveAsDefault` การตรึงตอนส่ง การส่งใหม่หลังปฏิเสธ
  - `reimbursement-approval.use-case.spec.ts`: ไม่รับรองถูกปฏิเสธ รับรองเวอร์ชันเก่าถูกปฏิเสธ ใบเงินสดและใบเก่าไม่ต้องรับรอง อนุมัติใบตัวเองบันทึกตามจริง
  - `reimbursement-finance.use-case.spec.ts`: ยืนยันบัญชี เวอร์ชันไม่ตรง เหตุผลเมื่อวิธีจ่ายต่าง การจ่ายซ้ำด้วยเวอร์ชันต่างถูกปฏิเสธ ใบเก่าจ่ายได้ ส่งออกมีแค่ 4 ตัวท้าย
  - `reimbursement-related-access.use-case.spec.ts`: ตารางผู้เปิดเลขเต็ม (ผู้เบิก ผู้อนุมัติที่ถูกตรึง ผู้ตัดสิน ผู้มีสิทธิ์จ่าย ผู้ตรวจการเงินอย่างเดียว ผู้ตรวจสอบ ผู้เกี่ยวข้องอื่น ต่างสาขา ต่างบริษัท)
  - `reimbursement.dtos.spec.ts`: DTO รับ field ใหม่ และปฏิเสธ field ที่ไม่รู้จัก
  - `prisma-reimbursement.repository.payment-mirror.spec.ts`: การป้องกันใน `recordPaymentAtomic`
  - `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts`: ผลของเครื่องมือ AI ไม่มี field บัญชี (เพิ่มเทสต์ ไม่แก้ไฟล์ use case)
  - `apps/api/src/scripts/production-a5-evidence.logic.spec.ts`: ใบรออนุมัติที่มีส่วนบัญชีถูกจัดเป็น hash ถูกต้อง
- pg (Postgres จริง): `prisma-reimbursement.repository.draft-submit-race.spec.ts` (การตรึงแข่งกับการแก้ร่างและการแก้บัญชีประจำ การอ่านกลับเลขที่ขึ้นต้นด้วย 0) และ `apps/api/src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts` (hash ของแถวเดิมไม่เปลี่ยน)
- Unit เว็บ: `reimbursements.logic.spec.ts`, `reimbursements.model.spec.ts`, spec ใหม่ของฟอร์มบัญชี, `ReimbursementCreatePage.qa.spec.ts`, `ReimbursementPages.plain-thai.qa.spec.ts`
- Spec ที่ไม่อยู่ในรายการ: `packages/contracts/src/reimbursements.spec.ts` รันเอง ฟังก์ชันตรวจรูปแบบถูกครอบด้วย spec เว็บและ API ด้วย
- E2E: `e2e/reimbursements.spec.ts` แก้ REIMB-02, REIMB-03, REIMB-07 ให้เลือกวิธีรับเงิน รับรอง และยืนยัน เพิ่มกรณีพนักงานตั้งบัญชี ส่งใบ ผู้อนุมัติรับรองและเห็นบัญชีในขั้นจ่าย และกรณีผู้ตรวจสอบเห็นแค่ 4 ตัวท้าย
- Browser 390 px: ฟอร์มใบเบิก หน้าใบทุกขั้น หน้าบัญชีของฉัน หน้าแก้ไขพนักงาน

W00 manifest: ไม่ต้อง regenerate ตราบที่ไม่แตะไฟล์ใน `sourceHashes` ไฟล์ที่ต้องระวังคือ `apps/web/src/features/reimbursements/ReimbursementDraftActionPage.tsx`, `apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts`, `apps/api/src/modules/line-ai/infrastructure/reimbursement-draft-tools.ts`, `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.ts`, `packages/contracts/src/line-ai.ts`, `packages/contracts/src/ai-tools.ts`, `packages/config/src/index.ts` ถ้าจำเป็นต้องแตะ ให้รันคำสั่ง regenerate ใน "รายการตรวจสอบ" และ commit ไฟล์ manifest ใน PR เดียวกัน

ความเสี่ยง:

- hash: ถ้าส่วน `payout` ถูกใส่ให้ใบเก่า การอนุมัติและลายเซ็นที่ค้างจะใช้ไม่ได้ทั้งระบบ กันด้วยค่าตายตัวในเทสต์และ pg spec
- rollback: ใบที่ส่งด้วยโค้ดใหม่มี hash ที่โค้ดเก่าคำนวณไม่ตรง โค้ดเก่าจะปฏิเสธการอนุมัติด้วย `stale_approval_snapshot` (ปลอดภัย แต่ค้าง) ทางออกคือผู้เบิกถอนใบแล้วส่งใหม่ หรือ roll forward
- กุญแจเข้ารหัส: ใช้ `CREDENTIAL_ENCRYPTION_KEY` เดิม ซึ่งการสร้างพนักงานต้องใช้อยู่แล้ว ต้องยืนยันว่าทุก environment ตั้งไว้ก่อนปล่อย
- เว็บรุ่นเก่าที่ค้างในเบราว์เซอร์จะอนุมัติหรือจ่ายใบที่รับโอนไม่ผ่านจนกว่าจะโหลดใหม่ ข้อผิดพลาดต้องเป็นข้อความที่บอกให้โหลดหน้าใหม่
- ปุ่มอนุมัติด่วนในคิวเปลี่ยนพฤติกรรมสำหรับใบที่รับโอน ต้องบอกในคู่มือ
- ขอบเขตหน้าพนักงาน: จำกัดที่การ์ดเดียว ไม่แตะ stepper เดิม
- ระหว่างรอ Phase 3 ใบที่บัญชีผิดหลังอนุมัติต้องยกเลิกแล้วสร้างใหม่

ขนาด: 6 วัน (API 3 วัน เว็บ 2.5 วัน ตรวจรวม 0.5 วัน)

เกณฑ์ออก: AC01 ถึง AC18, AC20, AC21, AC25 (ส่วนการตรึง), AC34, AC35, AC41 ถึง AC44

## Phase 2: สลิปตอนบันทึกจ่าย

เป้าหมาย: สเปค §12.4 ถึง §12.8, §15 (กฎสลิปของใบเก่า), §16

งาน:

- [ ] 2.1 migration: `slipAttachmentId`, `slipChecksumSha256` ของรายการจ่าย
- [ ] 2.2 ค่าคงที่ประเภทไฟล์: `targetType` `reimbursement_payment`, `purpose` `reimbursement.payment.slip`, ป้าย `generatedFor` ของ upload intent
- [ ] 2.3 endpoint ขอ upload intent และ complete ของสลิป ตามแบบไฟล์ลายเซ็น (`reimbursement-claim-signature.use-case.ts:121-164`) จำกัด PDF, PNG, JPEG ไม่เกิน 10 MB
- [ ] 2.4 `recordPaymentAtomic`: ตรวจสลิป สร้างลิงก์ใน transaction เดียวกับรายการจ่าย เก็บ checksum เพิ่มสลิปในการเทียบการจ่ายซ้ำทั้งสองจุด
- [ ] 2.5 บังคับสลิปเมื่อวิธีจ่ายคือโอน รวมใบเก่า
- [ ] 2.6 แนบสลิปเพิ่มให้รายการจ่ายที่บันทึกแล้ว และการย้ายไฟล์จาก "ใบเบิกที่เซ็นแล้ว" เป็นสลิป (ลบลิงก์เดิมใน transaction เดียว)
- [ ] 2.7 endpoint เปิดสลิปที่ตรวจกลุ่มผู้ดู และให้ endpoint ไฟล์แนบกลางปฏิเสธไฟล์ที่มีลิงก์สลิป ตามแบบ `isSubstituteRawSignature` (`apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts:43-45`)
- [ ] 2.8 การลบไฟล์แนบกลางปฏิเสธไฟล์ที่เป็นสลิปของรายการจ่าย
- [ ] 2.9 เว็บ: ช่องสลิปในฟอร์มบันทึกจ่าย (ทั้งในหน้าใบและ modal ของคิวการเงิน) ตัวเลือก "เลือกจากไฟล์ที่แนบไว้ในใบนี้" ปุ่มดูสลิปและ "ใช้ไฟล์ที่แนบไว้เป็นสลิป" ในแถวการจ่าย เว็บส่ง `idempotencyKey`
- [ ] 2.10 ข้อความเมื่ออัปโหลดสลิปสำเร็จแต่บันทึกจ่ายไม่สำเร็จ และการคงข้อมูลในฟอร์ม

ไฟล์ที่แตะ:

- ฐานข้อมูล: `apps/api/prisma/schema.prisma`, migration ใหม่
- API: `apps/api/src/modules/reimbursements/domain/reimbursement.constants.ts`, `application/use-cases/reimbursement-finance.use-case.ts`, `infrastructure/prisma-reimbursement.repository.ts`, `application/dto/reimbursement.mapper.ts`, `presentation/http/reimbursement.dtos.ts`, `presentation/http/reimbursement.controller.ts`, `apps/api/src/modules/data-model-core/application/use-cases/create-download-url.use-case.ts`, `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts`
- สัญญา: `packages/contracts/src/reimbursements.ts` (สลิปในรายการจ่าย ข้อมูลขาเข้าของการบันทึกจ่าย)
- เว็บ: `ReimbursementDetailSections.tsx`, `ReimbursementsPages.tsx` (`:782-788`), `reimbursements.api.ts`, `reimbursements.logic.ts`, `reimbursements.model.ts`

Migration: คอลัมน์ nullable 2 คอลัมน์ ไม่มี backfill รายการจ่ายเดิมไม่มีสลิปและไม่ถูกบังคับย้อนหลัง

ทดสอบ:

- Unit API ในไฟล์ที่ลงทะเบียนแล้ว: `reimbursement-finance.use-case.spec.ts` (ตารางวิธีจ่ายกับสลิป สลิปของคนอื่นหรือใบอื่น ผิดชนิด เกินขนาด การจ่ายซ้ำด้วยสลิปต่าง ยกเลิกการจ่ายแล้วสลิปยังอยู่), `reimbursement-claim-signature.use-case.spec.ts` (ย้ายแล้วไฟล์ออกจากสำเนา `documentSignedVia` เปลี่ยน), `reimbursement-related-access.use-case.spec.ts` (ผู้เปิดสลิป), `apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.spec.ts` และ `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.spec.ts` (endpoint กลางปฏิเสธสลิป ลบสลิปไม่ได้), `prisma-reimbursement.repository.payment-mirror.spec.ts`
- pg: `prisma-reimbursement.repository.draft-submit-race.spec.ts` (รายการจ่ายกับลิงก์สลิปสำเร็จหรือล้มเหลวพร้อมกัน บันทึกซ้อนสองคำขอได้รายการเดียว)
- Unit เว็บ: `reimbursements.logic.spec.ts` (ตรวจฟอร์มจ่าย), `ReimbursementPages.plain-thai.qa.spec.ts`
- E2E: จ่ายด้วยการโอนต้องมีสลิป ผู้เบิกเปิดสลิปได้ ผู้ตรวจสอบเปิดไม่ได้ ย้ายไฟล์ที่แนบผิดช่อง
- Browser 390 px: ฟอร์มบันทึกจ่ายพร้อมอัปโหลดจากกล้องและคลังรูป

W00 manifest: ไม่ต้อง regenerate

ความเสี่ยง:

- การเปลี่ยน endpoint ไฟล์แนบกลางกระทบทุกโมดูล ต้องจำกัดเงื่อนไขไว้ที่ลิงก์สลิปเท่านั้น และรัน spec ไฟล์แนบเดิมครบ
- อัปโหลดบนมือถือหลุดกลางทาง ต้องไม่ทำให้ผู้ใช้เข้าใจว่าบันทึกจ่ายแล้ว
- ไฟล์ที่อัปโหลดแล้วแต่ไม่ได้บันทึกจ่ายจะค้างเป็นไฟล์ที่ไม่มีลิงก์ ใช้การเก็บกวาดไฟล์ค้างที่มีอยู่
- ความเข้มของสิทธิ์เปิดสลิปขึ้นกับคำตอบ Q2
- ถ้าปล่อยก่อน Phase 1 ฟอร์มยังไม่มีบัญชีให้ยืนยัน กฎสลิปทำงานได้เอง ฟังก์ชันตัดสินกลุ่มผู้ดู (สเปค §11.1) ใช้ร่วมกับ Phase 1 phase ใดทำก่อนเป็นผู้สร้าง อีก phase นำไปใช้ ไม่เขียนซ้ำ

ขนาด: 3.5 วัน

เกณฑ์ออก: AC19, AC22 ถึง AC24, AC26, AC33

## Phase 3: ส่งกลับแก้บัญชีและอนุมัติใหม่

เป้าหมาย: สเปค §14 แบ่ง 3A (ใบที่มีผู้อนุมัติ ไม่มีขั้นตรวจการเงิน) และ 3B (ใบที่ผ่านตรวจการเงิน ใบที่ไม่ต้องอนุมัติ ใบเก่า)

งาน 3A:

- [ ] 3.1 migration: คอลัมน์รอบแก้บัญชี 5 คอลัมน์ของใบ
- [ ] 3.2 repository: ส่งกลับ (lock ชุดเดียวกับการบันทึกจ่าย) ส่งบัญชีใหม่ (เวอร์ชันใหม่ hash ใหม่ ขั้นอนุมัติใหม่ที่คัดลอกผู้อนุมัติจากขั้นเดิม) อนุมัติใหม่ใน transaction เดียว และส่งกลับอีกครั้ง
- [ ] 3.3 use case ส่งกลับ: สิทธิ์ตามสเปค §14.3 เหตุผลจากรายการตายตัว หมายเหตุห้ามมีเลขบัญชี audit และ outbox
- [ ] 3.4 `ApproveReimbursementUseCase` และ `RejectReimbursementUseCase` แยกทางเมื่ออยู่ในรอบแก้บัญชี
- [ ] 3.5 การป้องกัน: เปิดกลับเป็นร่างไม่ได้ระหว่างรอบและเมื่อมี projection ที่ยังมีผล `currentDesk` รู้จักช่วง A
- [ ] 3.6 ตัวเลือกขั้นอนุมัติล่าสุดทุกจุดข้ามขั้นที่ถูกทำเครื่องหมายว่าใช้ไม่ได้แล้ว (ใบพิมพ์ สิทธิ์ลงนาม เว็บ)
- [ ] 3.7 ลบลายเซ็นในระบบตอนส่งกลับ สำเนากระดาษไม่นับเมื่อเวอร์ชันบัญชีที่รับรองไม่ตรงกับปัจจุบัน
- [ ] 3.8 การสแกน SLA ข้ามช่วง A และนับอายุช่วง B จากเวลาที่ส่งบัญชีใหม่ ป้ายใบค้างของ AI สำหรับช่วง A
- [ ] 3.9 แจ้งเตือน: ผู้เบิกเมื่อถูกส่งกลับ ผู้อนุมัติเมื่อมีบัญชีใหม่ และ "พร้อมจ่าย" หลังอนุมัติใหม่ พร้อมกฎสถานะของแจ้งเตือนที่ยังต้องทำ
- [ ] 3.10 เว็บ: ปุ่มและ dialog ส่งกลับ ฟอร์มแก้บัญชีของผู้เบิก การ์ดเทียบบัญชีเดิมกับใหม่ ขั้นตอนและโน้ตของสองช่วง ป้ายสถานะในหน้ารวม

งาน 3B:

- [ ] 3.11 ใบที่ผ่านขั้นตรวจการเงิน: เก็บผลตรวจการเงิน ไม่ตรวจซ้ำ แถบขั้นตอนแสดงขั้นตรวจการเงินว่าผ่านแล้ว
- [ ] 3.12 ใบที่นโยบายไม่ต้องอนุมัติ: ส่งบัญชีใหม่แล้วกลับเป็นพร้อมจ่ายทันที ผู้จ่ายเป็นผู้ตรวจ
- [ ] 3.13 ใบเก่า: ใช้เส้นทางเดียวกันเพิ่มบัญชีให้ใบ

ไฟล์ที่แตะ:

- ฐานข้อมูล: `apps/api/prisma/schema.prisma`, migration ใหม่
- API: `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts` (`:342-353`, `:378-406`), ไฟล์ใหม่ `application/use-cases/reimbursement-payout-correction.use-case.ts`, `application/use-cases/reimbursement-approval.use-case.ts`, `application/use-cases/reimbursement-request.use-case.ts` (`:242-266`), `application/use-cases/reimbursement-claim-form.use-case.ts` (`:56-58`), `application/use-cases/reimbursement-claim-signature.use-case.ts` (`:44-47`), `application/use-cases/reimbursement-summary.use-case.ts`, `application/dto/reimbursement.mapper.ts`, `infrastructure/prisma-reimbursement.repository.ts` (`:2271-2335`, `:3083-3111`, method ใหม่), `presentation/http/reimbursement.controller.ts`, `presentation/http/reimbursement.dtos.ts`, `reimbursements.module.ts`
- นอกโมดูล: `apps/api/src/modules/workflow/application/use-cases/workflow-scan-candidates.use-case.ts` (`:77-141`), `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`, `apps/api/src/modules/dashboard-notifications/infrastructure/document-notification-state.ts`, `apps/api/src/scripts/production-a5-evidence.pg.ts` (`:164-213` ใบช่วง A ไม่มีขั้นปัจจุบันโดยตั้งใจ)
- สัญญา: `packages/contracts/src/reimbursements.ts` (`payoutCorrection`, `payoutCorrectionPhase`, ข้อมูลขาเข้าของสอง endpoint ใหม่)
- เว็บ: `reimbursements.logic.ts` (`buildJourneySteps`, `buildClaimTimeline`), `reimbursements.model.ts` (`:128-160`, ป้ายสถานะ), `ReimbursementJourneyPage.tsx`, `ReimbursementDetailSections.tsx`, `ReimbursementsPages.tsx`, `reimbursements.api.ts`

Migration: คอลัมน์ nullable 5 คอลัมน์ ไม่มี backfill แม่แบบแจ้งเตือนใหม่ซิงก์ผ่าน `apps/api/prisma/sync-workflow-templates.ts` แบบไม่เขียนทับกฎที่ผู้ดูแลแก้เอง

ทดสอบ:

- Unit API ในไฟล์ที่ลงทะเบียนแล้ว: `reimbursement.logic.spec.ts` (`currentDesk` ทุกช่วง hash หลังแก้บัญชี), `reimbursement-approval.use-case.spec.ts` (อนุมัติใหม่ ส่งกลับอีกครั้ง รับรองเวอร์ชันเก่า อนุมัติใบตัวเอง ผู้อนุมัติชุดเดิมไม่อยู่), `reimbursement-finance.use-case.spec.ts` (จ่ายระหว่างรอบถูกปฏิเสธ), `reimbursement-request.use-case.spec.ts` (เปิดกลับเป็นร่างถูกปฏิเสธ ยกเลิกคำขอยังทำได้), `claim-form.logic.spec.ts` และ `reimbursement-claim-form.use-case.spec.ts` (ช่องผู้อนุมัติว่างระหว่างรอบ), `reimbursement-claim-signature.use-case.spec.ts` (ลายเซ็นถูกลบ สำเนาเดิมไม่นับ), `reimbursement-projection-reconciler.service.spec.ts` (ตัวกู้ไม่แตะใบในรอบแก้บัญชี), `apps/api/src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts` และ `apps/api/src/modules/workflow/application/use-cases/workflow-template-auto-enable.spec.ts`
- pg: การส่งกลับแข่งกับการบันทึกจ่าย การอนุมัติใหม่สำเร็จหรือล้มเหลวทั้งก้อน projection และรายการค่าใช้จ่ายเท่าเดิมก่อนและหลังรอบ
- Spec ที่ไม่อยู่ในรายการ: `reimbursement-approval-backlog.use-case.spec.ts` รันเอง
- Unit เว็บ: `reimbursements.logic.spec.ts` (ขั้นตอน โน้ต ปุ่มของแต่ละช่วงและแต่ละผู้ดู), `reimbursements.model.spec.ts`, `ReimbursementPages.plain-thai.qa.spec.ts`
- E2E: ผู้จ่ายส่งกลับ ผู้เบิกแก้ ผู้อนุมัติอนุมัติใหม่ จ่ายเข้าบัญชีใหม่ เลขที่ใบเดิม
- Browser 390 px: dialog ส่งกลับ ฟอร์มแก้บัญชี การ์ดเทียบบัญชี

W00 manifest: ไม่ต้อง regenerate ไฟล์ workflow และ `reimbursement-summary.use-case.ts` ไม่อยู่ใน `sourceHashes` รัน whole-chain acceptance เพราะคำตอบ AI เรื่องใบค้างมีป้ายใหม่

ความเสี่ยง:

- แตะเส้นทางอนุมัติซึ่งเป็นจุดอ่อนไหวที่สุดของโมดูล ทางอนุมัติปกติต้องไม่เปลี่ยนพฤติกรรม ครอบด้วย spec เดิมทั้งชุด
- ใบสถานะ PENDING_APPROVAL ที่ไม่มีขั้นปัจจุบันเป็นสภาพใหม่ ทุกจุดที่อ่านสถานะนี้ต้องถูกไล่ตรวจ: คิวอนุมัติ การสแกน SLA ตัวกู้ projection คำตอบ AI แจ้งเตือนที่ยังต้องทำ และตัวจัดประเภทหลักฐาน A5 ซึ่งวันนี้นับสภาพนี้เป็นข้อมูลผิดปกติ (`apps/api/src/scripts/production-a5-evidence.pg.ts:170-171`)
- rollback ขณะมีใบอยู่ในรอบแก้บัญชี: โค้ดเก่าปฏิเสธการจ่ายและการอนุมัติของใบนั้น (ปลอดภัย แต่ค้าง) และผู้เบิกอาจเปิดใบช่วง B กลับเป็นร่างด้วย API ตรงได้ ก่อน rollback ต้องนับใบที่อยู่ในรอบ และปิดรอบให้หมดหรือยอมรับว่าต้อง roll forward
- การซิงก์แม่แบบแจ้งเตือนต้องเสร็จก่อนใช้งานในแต่ละ environment
- 3B ใช้ทางเดียวกับ 3A ถ้าเลื่อน 3B หน้าใบของใบกลุ่มนั้นต้องบอกทางเดิมให้ชัด

ขนาด: 6 วัน (3A 4 วัน, 3B 2 วัน)

เกณฑ์ออก: AC29 ถึง AC32 และ AC25 (ส่วนการแข่งกัน)

## Phase 4: ใบพิมพ์ ประวัติ แจ้งเตือน และคู่มือ

เป้าหมาย: สเปค §17 และคู่มือผู้ใช้

งาน:

- [ ] 4.1 ใบพิมพ์ผัง 2 ช่อง: บรรทัด "รับเงินคืนทาง" ผู้ตรวจบัญชี 4 ตัวท้ายในบรรทัดการจ่ายเงินคืน ช่องติ๊ก "หลักฐานการชำระเงิน" เมื่อมีสลิป ข้อความระหว่างรอบแก้บัญชี ผัง 4 ช่องเดิมและใบเก่าไม่เปลี่ยน
- [ ] 4.2 เส้นทางของใบเบิกและแถวการจ่ายแสดงข้อมูลบัญชี สลิป และรอบแก้บัญชีครบตามสเปค §17.2 และการ์ด "การรับเงินคืน" พร้อมประวัติเวอร์ชัน
- [ ] 4.3 แจ้งเตือนจ่ายแล้วถึงผู้เบิก: ข้อความที่ประกอบเสร็จเป็นภาษาไทยใน payload (วิธีจ่าย ยอด 4 ตัวท้าย มีสลิป) ลิงก์ไปหน้าใบ
- [ ] 4.4 แจ้งเตือนเมื่อผู้อื่นตั้งหรือแก้บัญชีประจำให้
- [ ] 4.5 คู่มือผู้ใช้: บัญชีรับเงิน การรับรอง สลิป การส่งกลับแก้บัญชี ใบเก่า
- [ ] 4.6 อัปเดต `docs/specs/reimbursement-step-journey-spec-th.md` ให้ชี้มาที่สเปคนี้ในส่วนขั้นจ่ายเงิน

ไฟล์ที่แตะ:

- API: `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts` (`:50-89`, `:228-232`, `:244-255`, `:312-316`, `:367-371`), `application/use-cases/reimbursement-claim-form.use-case.ts` (`:51-134`), `application/use-cases/reimbursement-finance.use-case.ts` (payload ของ `reimbursement.payment_recorded` `:425-429`), `application/use-cases/reimbursement-payout.use-case.ts`, `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts` (`:356-390`)
- เว็บ: `reimbursements.logic.ts`, `ReimbursementDetailSections.tsx`, `apps/web/src/features/user-guide/reimbursement-guide.content.ts`
- เอกสาร: `docs/specs/reimbursement-step-journey-spec-th.md`

Migration: ไม่มี แม่แบบแจ้งเตือนซิงก์ผ่าน release task เดิม

สัญญา: ไม่มี field ใหม่ ใช้ field ที่ Phase 1 ถึง 3 เพิ่มไว้ ยกเว้น payload ของเหตุการณ์จ่ายแล้วที่เพิ่มข้อความสรุปและ 4 ตัวท้าย

ทดสอบ:

- Unit API ในไฟล์ที่ลงทะเบียนแล้ว: `claim-form.logic.spec.ts` (ผัง 4 ช่องและใบเก่าเท่าเดิมทุกตัวอักษร บรรทัดใหม่ของโอน พร้อมเพย์ เงินสด ช่องติ๊ก ชื่อธนาคารและชื่อบัญชียาวไม่ล้นหน้า ไม่มีเลขเต็มในทุกกรณี), `reimbursement-claim-form.use-case.spec.ts`, `reimbursement-finance.use-case.spec.ts` (payload ไม่มีเลขเต็มและไม่มี id ไฟล์), `apps/api/src/modules/workflow/application/use-cases/workflow-template.use-case.spec.ts`
- Unit เว็บ: `reimbursements.logic.spec.ts` (เส้นทางของใบ), `ReimbursementPages.plain-thai.qa.spec.ts`
- ตรวจด้วยตา: render ใบพิมพ์ตัวอย่างลง scratchpad ทั้งแบบโอน พร้อมเพย์ เงินสด ใบเก่า และระหว่างรอบแก้บัญชี
- E2E: ผู้เบิกเปิดลิงก์จากแจ้งเตือนแล้วเห็นสลิป
- Browser 390 px: การ์ดการรับเงินคืนและแถวการจ่าย

W00 manifest: ไม่ต้อง regenerate ตราบที่ไม่แตะ `apps/api/src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.ts` ถ้าคำตอบ AI เรื่องสถานะใบต้องเปลี่ยนในไฟล์นั้น ให้ regenerate

ความเสี่ยง:

- ผังใบพิมพ์: บรรทัดใหม่ดันตำแหน่งส่วนล่าง ต้องตรวจทั้งแบบหน้าเดียวและแบบแบ่งหน้า
- การแก้แม่แบบแจ้งเตือนเดิมต้องไม่เขียนทับกฎที่ผู้ดูแลปิดไว้
- ข้อความแจ้งเตือนเดิมใช้ `{{amount}} {{currency}}` จาก payload ตรง ๆ (`apps/api/src/modules/workflow/domain/logic/workflow-render.logic.ts:2-10`) ข้อความใหม่ต้องประกอบเป็นภาษาไทยก่อนใส่ payload และควรตรวจว่าแม่แบบเบิกจ่ายเดิมแสดงยอดกับสกุลเงินเป็นภาษาไทยหรือไม่

ขนาด: 3 วัน

เกณฑ์ออก: AC36, AC37 และ AC17 (ส่วนใบพิมพ์กับแจ้งเตือน)

## Migration และการปล่อยใช้กับข้อมูลเดิม

- ข้อมูลเดิมไม่ถูกแก้ ทุกใบและทุกรายการจ่ายที่มีอยู่มีค่าว่างในคอลัมน์ใหม่
- ร่างที่มีอยู่: ตามบัญชีประจำ ต้องเลือกวิธีรับเงินตอนส่งถ้าผู้เบิกยังไม่มีบัญชีประจำ
- ใบที่ส่งแล้วก่อน Phase 1: เป็นใบเก่า อนุมัติและจ่ายได้ตามเดิม hash เดิม ไม่มีผลตรวจย้อนหลัง
- รายการจ่ายเดิม: ไม่มีสลิป ไม่บังคับย้อนหลัง แนบเพิ่มได้หลัง Phase 2
- ไม่มีสวิตช์ ทุกบริษัทได้พฤติกรรมใหม่พร้อมกันเมื่อ deploy ผลที่ผู้ใช้เห็นทันทีหลัง Phase 1: ใบใหม่ต้องเลือกวิธีรับเงินก่อนส่ง ใบที่รับโอนต้องรับรองก่อนอนุมัติและยืนยันก่อนจ่าย หลัง Phase 2: การบันทึกการโอนต้องมีสลิป ต้องแจ้งใน release note และคู่มือ
- ลำดับ deploy ต่อ environment: migrate แล้ว `sync-permissions` (Phase 0) แล้วซิงก์แม่แบบแจ้งเตือน (Phase 3 และ 4) ตาม release task เดิม API กับเว็บขึ้นพร้อมกัน
- UAT และ Production ทำตาม `docs/runbooks/uat-production-v2-deployment.md` บันทึก run ID และถามเจ้าของก่อนขึ้น production
- 6 ใบที่ค้างใน production: รอคำตอบ Q5 ถ้าเจ้าของเลือกบันทึกจ่ายทันที ทำได้ด้วยระบบปัจจุบัน สลิปที่แนบผิดช่องย้ายหลัง Phase 2 ด้วยปุ่ม "ใช้ไฟล์ที่แนบไว้เป็นสลิป"
- การตรวจข้อมูลจริงก่อนปล่อย Phase 0.6 (อ่านอย่างเดียว ต้องแจ้งเจ้าของก่อนเปิด session): นับบทบาทของบริษัทที่มี `reimbursement.approve` แต่ไม่มี `reimbursement.payment.record` และดูว่าผู้อนุมัติของ 6 ใบถือสิทธิ์บันทึกจ่ายหรือไม่ เพื่อยืนยันสาเหตุ
- Rollback: Phase 0 และ 2 ย้อนได้โดยไม่มีข้อมูลค้าง Phase 1 และ 3 มีข้อจำกัดตามที่ระบุในความเสี่ยงของแต่ละ phase คอลัมน์และตารางใหม่ปล่อยค้างไว้ได้ โค้ดเก่าไม่อ่าน

## รายการตรวจสอบก่อนปิดแต่ละ phase

- [ ] typecheck:

```bash
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
```

- [ ] spec ของ API ที่แตะ (ตัวอย่าง เพิ่มไฟล์ตาม phase):

```bash
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.spec.ts
```

- [ ] ชุดเทสต์เว็บ:

```bash
pnpm --filter @watchdog-bms/web test
```

- [ ] pg spec กับ Postgres ในเครื่อง (ตั้ง `DATABASE_URL` ตามสูตร local dev):

```bash
REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm --filter @watchdog-bms/api run test:reimbursement-compatibility
```

- [ ] migration ใช้ได้จากฐานว่างและจากฐานที่มีข้อมูลเดิม และ Prisma client ถูก generate ใหม่ใน worktree
- [ ] LINE-AI whole-chain และ manifest:

```bash
node scripts/run-line-ai-whole-chain-acceptance.mjs
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts
```

- [ ] ถ้า manifest spec ไม่ผ่านเพราะแตะไฟล์ใน `sourceHashes`: รัน `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` แล้วรันซ้ำแบบไม่ตั้ง env ให้ผ่าน และ commit `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`
- [ ] spec ที่ไม่อยู่ในรายการซึ่งเกี่ยวกับไฟล์ที่แตะ ถูกรันเองและบันทึกผล
- [ ] ค้นทั้ง diff ว่าไม่มี field ขาออกชื่อ `accountNumber` นอกคำสั่งแสดงเลขบัญชี และไม่มีเลขเต็มใน log, audit metadata, payload ของ outbox
- [ ] E2E ของเบิกจ่าย (`e2e/reimbursements.spec.ts`, `e2e/reimbursement-receipt.spec.ts`) ผ่าน หรือบันทึกเหตุที่ไม่ได้รัน
- [ ] เดินหน้าจอที่ 390 px ด้วยบัญชีเจ้าของ พนักงาน ผู้จัดการ และผู้ตรวจสอบ
- [ ] ข้อความใหม่ผ่านการตรวจภาษาไทยธรรมดา ไม่มี id enum รหัสสกุลเงิน
- [ ] `docs/specs/permission-matrix.md`, คู่มือผู้ใช้ และสถานะงานอัปเดตตาม phase
- [ ] `git diff --check` ผ่าน และ stage เฉพาะ path ที่ตั้งใจ
- [ ] ไม่มีการแก้ `package.json`

## ความเสี่ยงรวม

- ความเป็นส่วนตัว: จุดรั่วที่เป็นไปได้คือ projection ใหม่ payload ของเหตุการณ์ และไฟล์แนบ ทุก phase มีเทสต์ยืนยันว่าไม่มีเลขเต็ม
- ความเข้ากันได้ของ hash: จุดเดียวที่ทำให้ใบที่ค้างทั้งระบบเสียได้ ต้องมีค่าตายตัวในเทสต์ก่อนแก้
- ขอบเขตบวม: หลักฐานหน้าสมุดบัญชี การจองงานจ่าย การเตือนสลิปซ้ำ และพร้อมเพย์เลขบัตร อยู่นอกขอบเขต ไม่ทำแทรก
- เวลารวมประมาณ 20 วันทำงาน ถ้าต้องตัด ให้ตัดพร้อมเพย์ออกจาก Phase 1 (ประมาณครึ่งวัน) และเลื่อน 3B กับงาน 4.4

## คำถามเปิด

อยู่ในสเปค §24 (Q1 ถึง Q5) งานที่รอคำตอบ: 0.6 รอ Q3, สิทธิ์เปิดสลิปใน Phase 2 รอ Q2, ใบพิมพ์ใน Phase 4 รอ Q1, การตั้งบัญชีให้พนักงานโดยผู้จัดการใน Phase 1 รอ Q4 ทุกข้อมีค่าที่จะใช้ถ้ายังไม่ได้คำตอบ ระบุไว้ในสเปคแล้ว
