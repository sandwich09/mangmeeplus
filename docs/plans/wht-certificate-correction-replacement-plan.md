# WHT Certificate Correction & Replacement Plan — แก้ไข/ออกใบแทน 50 ทวิ ที่ระบบออกให้

Status: READY (docs-first; ยังไม่เริ่ม implement)
Spec: `docs/specs/wht-certificate-correction-replacement-spec.md`
Memory: `docs/agent-memory/wht-certificate-correction-replacement.md`
Scope: เปิดปุ่ม "แก้ไขหนังสือรับรอง"/"ออกใบแทน" ที่สองจุดเข้าเดียวกับ SYSTEM_INITIAL_ISSUE (AP payment WHT tab,
Expenses) — เฉพาะ handoff ที่ `status === 'SYSTEM_ISSUED'` เท่านั้น
หลักการ: ponytail full — เดินตาม `IssueWhtCertificateFromHandoffUseCase`'s pattern เป๊ะ ๆ (idempotency key,
P2002 catch-and-replay, conditional `updateMany`, reuse `ReserveDocumentNumberUseCase`/renderer/audit) ไม่มี
abstraction ใหม่, ไม่สร้าง `WhtCommandRegistry`/`WhtCorrectionCase` เต็มรูปแบบ (สเปก §3 non-goal), ไม่มี
dependency ใหม่, ต่อยอด `WhtCertificate`/`WhtCertificateHandoff` แบบ additive เท่านั้น
Baseline discovery: 2026-09-22 บน `codex/wht-gate-unlock-20260922` (`d7b78436`)

## ลำดับที่บังคับ

Phase 1 (schema) → 2 (correction use case + route) → 3 (replacement use case + route) → 4 (PDF template) →
5 (frontend AP + Expenses) → 6 (tests) → 7 (open-question resolution, process only)
Phase 2/3 ทั้งคู่ต้องรอ Phase 1 (schema) และ Phase 4 (PDF template) เสร็จก่อนถึงจะ end-to-end ได้ แต่ตัว use
case/route ของ Phase 2 กับ 3 เขียนแยกไฟล์ ไม่ผูกกัน ส่งเป็นคนละ commit ได้ — Phase 5 (frontend) ต้อง 2+3+4
เสร็จก่อน (ปุ่มต้องมี endpoint จริงให้เรียก) ทุก phase ก่อน 5 ไม่ user-facing เพราะยังไม่มี UI เรียก

---

## Phase 1 — Schema (additive)

### 1.1 `WhtCertificate` additions

`apps/api/prisma/schema.prisma` ([:5121-5151](../../apps/api/prisma/schema.prisma)) เพิ่ม (spec §5.2):

```prisma
supersededByCertificateId   String?   @unique
supersedesCertificateId     String?   @unique
correctionReason            String?
replacementCopyCount        Int       @default(0)
lastReplacementCopyAt       DateTime?
lastReplacementCopyByUserId String?
```

ไม่เพิ่ม self-relation FK ระดับ Prisma (`@relation`) เพราะ Prisma ไม่รองรับ self-relation ที่ต่างทิศทางสอง
ฟิลด์ชี้กันเองแบบตรงไปตรงมาโดยไม่ระบุชื่อ relation แยก — เก็บเป็น plain `String?` (เหมือน
`WhtCertificateHandoff.certificateId` ที่เป็น plain string ชี้ไป `WhtCertificate` โดยไม่มี `@relation` เช่น
กัน, [:5215](../../apps/api/prisma/schema.prisma)) แอปพลิเคชันเป็นผู้ดูแลความสอดคล้องเอง (mirror pattern ที่
มีอยู่แล้วในไฟล์เดียวกัน ไม่ใช้ pattern ใหม่)

Migration ใหม่: `apps/api/prisma/migrations/2026xxxx_wht_certificate_correction_replacement/migration.sql`
— `ALTER TABLE "WhtCertificate" ADD COLUMN ...` ทั้งหกคอลัมน์ พร้อม unique index สองตัว (`supersededByCertificateId`,
`supersedesCertificateId`) — Verify: `pnpm --filter @watchdog-bms/api prisma:validate`, `prisma generate`

### 1.2 ไม่แก้ `WhtCertificateHandoff` schema

`certificateId` ที่มีอยู่แล้วพอ — Phase 2/3 เขียนทับด้วย conditional `updateMany` (spec §5.2) ไม่ต้อง migration

---

## Phase 2 — Correction use case + route

### 2.1 Permission + pack (ทำครั้งเดียว ใช้ร่วมกับ Phase 3)

`apps/api/src/modules/auth/permission-registry.ts` ([:222-227](../../apps/api/src/modules/auth/permission-registry.ts)):

```
{ key: 'wht.certificate.correct', description: 'Correct or reissue a copy of a SYSTEM-issued 50 ทวิ certificate', riskLevel: 'HIGH' },
```

เพิ่ม `'wht.certificate.correct'` เข้า FINANCE ([:882](../../apps/api/src/modules/auth/permission-registry.ts)) และ
ACCOUNTANT ([:948](../../apps/api/src/modules/auth/permission-registry.ts)) ต่อท้าย `'wht.certificate.issue'`

`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts` — เพิ่ม
`'wht.certificate.correct'` เข้า `permissionKeys` ของ `pack.wht.certificate.manage` ที่มีอยู่แล้ว
([:450-454](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) —
**ไม่สร้าง pack ใหม่** (สเปก §7/§8.2 — ungated ตาม design เดิม จนกว่า owner จะยืนยันคำถามเปิดข้อ 1)

**หมายเหตุ implementer:** ถ้า owner ตอบคำถามเปิดข้อ 1 (สเปก §12) ว่าต้อง gate ด้วย `thai_tax` ก่อนเริ่ม phase
นี้ ให้สร้าง pack ใหม่ `pack.wht.certificate.correct` (`module: 'tax'`, `featureEntitlementKey: 'thai_tax'`,
มิเรอร์ `pack.wht.certificate.issue`) แทนขั้นตอนข้างบน — เปลี่ยนแค่จุดเดียวนี้ ไม่กระทบ 2.2/2.3/3.x เลย

### 2.2 Use case ใหม่ — `CorrectWhtCertificateUseCase`

**ไฟล์ใหม่:** `apps/api/src/modules/tax/application/use-cases/correct-wht-certificate.use-case.ts` (sibling ของ
`issue-wht-certificate-from-handoff.use-case.ts`)

**Input:** `{ ctx: RequestContext, handoffId: string, corrected: WhtCertificateCorrectionInput, reason: string }`
โดย `WhtCertificateCorrectionInput` (contract ใหม่ใน `packages/contracts/src/tax.ts`) มีฟิลด์เดียวกับ
`WhtCertificateFields` ([wht-certificate-pdf.logic.ts:16-27](../../apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts))
บวก payer/payee snapshot overrides — **ทุกฟิลด์ optional ยกเว้นที่บังคับ**: ค่าที่ผู้ใช้ไม่ส่งมา = คงค่าเดิมจาก
certificate ปัจจุบัน (ทำ merge ก่อน validate)

**Dependencies:** เหมือน `IssueWhtCertificateFromHandoffUseCase` ทุกตัว
([:22-35](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts))
บวก `PrismaTaxRepository`'s TaxPeriod lookup (มีอยู่แล้ว ไม่ต้อง inject ใหม่)

**Logic:**

1. โหลด handoff row, tenant check, 404 ถ้าไม่พบ
2. `if (handoff.status !== 'SYSTEM_ISSUED' || !handoff.certificateId)` → `ConflictException('wht_certificate_not_correctable')`
   — เฉพาะใบที่ระบบออกเองเท่านั้น ตรงตามสเปก §3/§4.1 (ไม่แตะ `EXTERNAL_LINKED`)
3. โหลด certificate ปัจจุบันจาก `handoff.certificateId`; `if (current.supersededByCertificateId)` →
   `ConflictException('wht_certificate_already_superseded')` (ป้องกัน correction ซ้ำบนใบที่ถูกแทนที่ไปแล้ว —
   ไม่ควรเกิดถ้า handoff.certificateId อัปเดตถูกต้องเสมอ แต่เป็น defense-in-depth ราคาถูก)
4. Route-readiness re-check: `isSystemContentCorrectionOpen()` (helper ใหม่ ดู 2.4) → ถ้าปิด
   `ConflictException('wht_system_correction_unavailable')`
5. Merge ค่าที่ผู้ใช้ส่งมากับค่าปัจจุบันของ `current` → ได้ค่าสุดท้าย
6. **ตรวจว่าเป็น financial change หรือไม่**: เทียบ `incomeCategoryCode`/`whtRate`/`grossAmount`/`withheldAmount`/
   `paymentDate`/`formType`/payee tax id ระหว่างค่าสุดท้ายกับ `current` — ถ้าต่างกันแม้แค่ฟิลด์เดียว = financial
7. **ถ้า financial**: โหลด `TaxPeriod` จาก `current.taxPeriodId`; `if (['FILED','PAID','CLOSED'].includes(period.status))`
   → `ConflictException('wht_certificate_correction_tax_period_locked', ...)` (สเปก §5.1 guard, mirror
   `wht_tax_period_locked_requires_amendment` เป๊ะ ๆ) — nonfinancial-only correction ข้ามการเช็คนี้ไปเลย
8. หา/สร้าง `TaxPeriod` ใหม่ (ถ้า `paymentDate`/`formType` เปลี่ยน periodKey อาจเปลี่ยน) ด้วย `upsertPeriod`
   เดิมทุกประการ ([issue-wht-certificate-from-handoff.use-case.ts:101-102](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts))
9. Reserve เลขใหม่พร้อม P2002 catch-and-replay — `idempotencyKey = wht_certificate_correction:${current.id}`
   (ผูกกับ**certificate เดิม** ไม่ใช่ handoff เพื่อไม่ให้สับสนกับ idempotency key ของ initial-issue) mirror
   ทุกขั้นตอนของ [:105-118](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts)
10. Render PDF ใหม่ (ไม่มี `replacementCopy`/`stateStamp` — เป็นใบปกติ)
11. ใน `$transaction` เดียว: create `WhtCertificate` ใหม่ (`supersedesCertificateId: current.id`) →
    `commitNumberInTransaction` → `tx.whtCertificate.updateMany({ where: { id: current.id, supersededByCertificateId: null }, data: { status: 'VOIDED', voidedAt, voidedByUserId, voidReason: 'SUPERSEDED_BY_CORRECTION', supersededByCertificateId: newRow.id, correctionReason: reason } })`
    (conditional — กันสอง correction พร้อมกันแข่งกันบนใบเดิมใบเดียว) → ถ้า `count === 0` แปลว่าแพ้ race, throw
    `ConflictException('wht_certificate_already_superseded')` → `tx.whtCertificateHandoff.updateMany({ where: { id: handoff.id, certificateId: current.id }, data: { certificateId: newRow.id } })`
    (conditional บน `certificateId` เดิม ไม่ใช่ `status` เพราะ status คงเป็น `SYSTEM_ISSUED` เหมือนเดิม)
12. `audit.log({ action: 'tax.wht_certificate.correct', riskLevel: 'HIGH', metadataJson: { originalCertificateId: current.id, newCertificateId: newRow.id, reason, financial: <boolean จากข้อ 6> } })`
    — action key ใหม่ (ไม่ reuse `tax.wht_certificate.issue` เพราะเป็นคนละ action ทาง audit ที่ควรกรองแยกได้)
13. คืน DTO + `pdfArtifact` (mirror sibling shape)

### 2.3 Route ใหม่

`apps/api/src/modules/tax/presentation/http/tax.controller.ts` ต่อจาก
`issueSystemWhtCertificate` ที่มีอยู่แล้ว:

```ts
@Post('wht/payment-handoffs/:handoffId/system-certificate/correction')
@HttpCode(200)
@RequirePermissions('wht.certificate.correct')
async correctSystemWhtCertificate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string, @Body() body: CorrectWhtCertificateDto) {
  assertRouteCompany(ctx, companyId);
  return this.correctCertificate.execute(ctx, handoffId, body.corrected, body.reason);
}
```

sibling URL family เดียวกับ `.../system-certificate` (`wht/payment-handoffs/*`, ไม่อยู่ใต้ `tax/` prefix — เหตุผล
เดียวกับที่ sibling plan §2.3 อธิบายไว้) `CorrectWhtCertificateDto` ใหม่ใน `tax.dtos.ts` + contract type ใน
`tax.ts`. Inject `CorrectWhtCertificateUseCase` เข้า `TaxController`, register ใน `tax.module.ts`

### 2.4 Route-readiness helper

`apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts` — เพิ่ม export function
คู่ขนานกับ `isLaunchRouteOpen`/`isSystemIssuanceOpen` ที่มีอยู่แล้ว ([:32,75-76](../../apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts)):

```ts
export async function isSystemContentCorrectionOpen(guard: LaunchGateGuardService) {
  return isLaunchRouteOpen(guard, 'cap.wht50bis', 'SYSTEM_CONTENT_CORRECTION');
}
export async function isSystemReplacementCopyOpen(guard: LaunchGateGuardService) {
  return isLaunchRouteOpen(guard, 'cap.wht50bis', 'SYSTEM_REPLACEMENT_COPY');
}
```

เพิ่ม `systemCorrectionOpen`/`systemReplacementOpen: boolean` ใน `WhtCertificateHandoffDto`
(`packages/contracts/src/tax.ts`, ข้าง `systemIssuanceOpen` ที่มีอยู่แล้ว) และ `toDto()`
([:451-475](../../apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts)) —
คำนวณครั้งเดียวต่อ request เหมือน `systemIssuanceOpen` เป๊ะ ๆ

### 2.5 Verify

```bash
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api prisma:validate
```

ไฟล์ทดสอบใหม่ `correct-wht-certificate.use-case.spec.ts`: nonfinancial correction สำเร็จ, financial correction
สำเร็จเมื่อ period OPEN, financial correction บล็อกเมื่อ period FILED/PAID/CLOSED, สอง correction พร้อมกันบน
handoff เดียวกัน (เลขไม่ชนกัน ผู้แพ้ race ได้ error ที่อ่านออก), handoff ที่ status ไม่ใช่ SYSTEM_ISSUED ถูก
ปฏิเสธ, gate ปิด → ConflictException, permission ไม่มี `wht.certificate.correct` → 403

---

## Phase 3 — Replacement (ใบแทน) use case + route

### 3.1 Use case ใหม่ — `IssueWhtReplacementCopyUseCase`

**ไฟล์ใหม่:** `apps/api/src/modules/tax/application/use-cases/issue-wht-replacement-copy.use-case.ts`

**Input:** `{ ctx: RequestContext, handoffId: string }` — ไม่มี body อื่น (spec §4.1, กดครั้งเดียวไม่มีฟอร์ม)

**Logic (สั้นกว่า correction มาก เพราะไม่มีการเปลี่ยนแปลงเนื้อหาเลย):**

1. โหลด handoff, tenant check, `status !== 'SYSTEM_ISSUED'` → `ConflictException('wht_certificate_not_correctable')`
   (reuse error code เดียวกับ correction — เหตุผลการปฏิเสธเหมือนกันทุกประการ: ไม่ใช่ SYSTEM_ISSUED)
2. โหลด certificate จาก `handoff.certificateId`; ถ้า `current.status === 'VOIDED'` → โหลดต่อผ่าน
   `supersededByCertificateId` chain จนเจอใบ active ล่าสุด (defense-in-depth เดียวกับ correction ข้อ 3 — ปกติ
   ไม่ควรเกิดเพราะ `handoff.certificateId` อัปเดตแล้วตอน correction)
3. Route-readiness re-check: `isSystemReplacementCopyOpen()` → ปิด → `ConflictException('wht_system_replacement_unavailable')`
4. **ไม่ reserve เลขใหม่ ไม่ derive periodKey ใหม่ ไม่แตะ TaxPeriod เลย** — อ่านฟิลด์ทั้งหมดจาก certificate
   ที่ active ตรง ๆ (`certificateNumber`, snapshots, amounts, `issuedAt` เดิม)
5. Render SVG ผ่าน `buildWhtCertificateSvg(...same fields..., signature, { issuedAt: new Date().toISOString() })`
   (พารามิเตอร์ที่หกใหม่จาก Phase 4.1) — ใช้ `certificateNumber`/เนื้อหาเดิมทั้งหมด
6. `tx.whtCertificate.update({ where: { id: current.id }, data: { replacementCopyCount: { increment: 1 }, lastReplacementCopyAt: now, lastReplacementCopyByUserId: ctx.userId } })`
   — plain `update` ไม่ใช่ conditional (ไม่มี race ที่ต้องกันเพราะไม่มี unique constraint ให้ชน — สอง
   ใบแทนพร้อมกันแค่ทำให้ counter บวกสองครั้ง ซึ่งถูกต้องอยู่แล้ว: ออกใบแทนสองครั้งจริง ๆ)
7. `audit.log({ action: 'tax.wht_certificate.replacement_copy', riskLevel: 'HIGH', metadataJson: { certificateId: current.id, copySeq: <replacementCopyCount ใหม่> } })`
8. คืน DTO + `pdfArtifact` (ไม่ต้อง `$transaction` ครอบทั้งหมดเพราะไม่มีหลาย write ที่ต้อง atomic ร่วมกัน —
   `update` เดียวพอ)

### 3.2 Route ใหม่

```ts
@Post('wht/payment-handoffs/:handoffId/system-certificate/replacement-copy')
@HttpCode(200)
@RequirePermissions('wht.certificate.correct')
async issueSystemWhtReplacementCopy(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
  assertRouteCompany(ctx, companyId);
  return this.issueReplacementCopy.execute(ctx, handoffId);
}
```

Inject `IssueWhtReplacementCopyUseCase`, register ใน `tax.module.ts`

### 3.3 Verify

```bash
pnpm --filter @watchdog-bms/api typecheck
```

ไฟล์ทดสอบใหม่ `issue-wht-replacement-copy.use-case.spec.ts`: ออกใบแทนสำเร็จ (เลขเดิม เนื้อหาเดิม, counter +1),
สองครั้งติดกัน (counter +2, ทั้งคู่สำเร็จ), handoff ไม่ใช่ SYSTEM_ISSUED ถูกปฏิเสธ, gate ปิด →
ConflictException, resolve ผ่าน supersession chain เมื่อ certificate เดิมถูก correction แทนที่ไปแล้ว

---

## Phase 4 — PDF template additions

### 4.1 `buildWhtCertificateSvg` — พารามิเตอร์ใหม่สำหรับป้าย "ใบแทน"

`apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts`
([:46-51](../../apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts)) เพิ่มพารามิเตอร์ที่ห้า
optional:

```ts
export function buildWhtCertificateSvg(
  fields: WhtCertificateFields,
  payerSnapshot: PayerSnapshot,
  payeeSnapshot: PayeeSnapshot,
  signature?: WhtCertificateSignature,
  replacementCopy?: { issuedAt: string },
): Buffer
```

เมื่อมีค่า `replacementCopy` → เพิ่มบรรทัด SVG `<text>` ใหม่หนึ่งบรรทัดใกล้ตำแหน่งเล่มที่/เลขที่ที่มีอยู่แล้ว:
`(ใบแทน — ออกซ้ำเมื่อ {formatCertDate(replacementCopy.issuedAt)})` — reuse `formatCertDate` ที่มีอยู่แล้ว
([:37-41](../../apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts)) ไม่ทับฟิลด์สถิติใด ๆ (สเปก
§6.1 — วางในพื้นที่ว่างข้างเลขที่เอกสาร ไม่ใช่ตรงกลางหน้าแบบ diagonal stamp)

### 4.2 `renderWhtCertificatePdf` — ส่งต่อ `stateStamp`

```ts
export async function renderWhtCertificatePdf(
  svg: Buffer,
  certificateNumber: string,
  options?: { stateStamp?: 'SUPERSEDED' },
): Promise<Buffer> {
  return renderSubstituteReceiptPdf(svg, certificateNumber, options);
}
```

ใช้เมื่อ re-render ใบเก่าที่ถูก correction แทนที่แล้ว (ถ้า flow ต้องการแสดง — ดู spec §12 open question 2; v1
ไม่มี endpoint ที่เรียกใช้ `stateStamp: 'SUPERSEDED'` จริงตอนนี้เพราะไม่มีการ persist PDF เก่าไว้ให้ re-render —
เพิ่ม parameter ไว้เป็น seam พร้อมใช้ ไม่ implement caller จนกว่า open question 2 ถูก resolve)

`TaxArtifactRendererService.renderWhtCertificate()` ส่งต่อ parameter ที่ห้า/หกใหม่ทั้งสองจุดตรง ๆ ไม่เปลี่ยน
signature เดิมของ `CreateWhtCertificateUseCase`/`IssueWhtCertificateFromHandoffUseCase` (ทั้งคู่ไม่ส่ง
`replacementCopy`/`options` เลย = ค่า default = พฤติกรรมเดิมทุกประการ)

### 4.3 Verify

`wht-certificate-pdf.logic.spec.ts` (มีอยู่แล้วจาก sibling feature) เพิ่มเคส: `replacementCopy` param → SVG มี
บรรทัดป้ายกำกับ, ไม่มี param → SVG เหมือนเดิมทุกประการ (regression); `options.stateStamp: 'SUPERSEDED'` ส่งผ่าน
ไปถึง `renderSubstituteReceiptPdf` จริง (mock/spy)

---

## Phase 5 — Frontend wiring

### 5.1 AP — `WhtHandoffDetail`

`apps/web/src/features/accounts-payable/AccountsPayablePages.tsx` บล็อก `issued`
([:1110-1118](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)):

- เพิ่ม pure predicate ใหม่ `canCorrectWhtCertificate(handoff, permissions)` ใน `accounts-payable.model.ts`
  (mirror `canIssueSystemWhtCertificate` เป๊ะ ๆ): `handoff.status === 'SYSTEM_ISSUED' && !!handoff.certificateId && handoff.systemCorrectionOpen && permissions.includes('wht.certificate.correct')`
  และ `canIssueWhtReplacementCopy` เหมือนกันทุกประการแค่เช็ค `handoff.systemReplacementOpen` แทน
- ปุ่ม "แก้ไขหนังสือรับรอง" (เปิดฟอร์มแก้ไข inline ในบล็อกเดียวกัน — prefill จาก field ที่ handoff/certificate
  DTO ส่งมาแล้ว, เพิ่ม client fn `correctSystemWhtCertificate` ใน `accounts-payable.api.ts`)
- ปุ่ม "ออกใบแทน" (เรียกทันที ไม่มีฟอร์ม, client fn `issueSystemWhtReplacementCopy`)
- ทั้งสองปุ่มดาวน์โหลด PDF ทันทีจาก response ด้วย `downloadArtifact` ที่มีอยู่แล้ว
  ([download-artifact.ts](../../apps/web/src/common/files/download-artifact.ts)) mirror sibling pattern
- Banner ที่ `issued` แสดงเลขที่ปัจจุบันต้องอัปเดตทันทีหลัง correction สำเร็จ (reload handoff ผ่าน callback
  เดิม `onLinked()`/เทียบเท่า — ใช้กลไก reload ที่มีอยู่แล้ว ไม่เพิ่มใหม่)

### 5.2 Expenses — จุดแสดงผลที่ต้องสำรวจก่อน (สเปก §4.2)

Implementer ต้องสำรวจก่อนเริ่ม: มีหน้ารายละเอียด/ประวัติ expense ที่ confirm แล้วซึ่ง**คงอยู่ข้าม session**
หรือไม่ (ต่างจาก `whtIssuedPdf` session-only state ปัจจุบัน,
[ExpenseReviewPage.tsx:1026](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) ถ้ามี → เพิ่มปุ่มสอง
ตัวที่นั่น (ดึง handoff ผ่าน `GET wht/payment-handoffs?sourcePaymentId=<expenseId>` ที่มีอยู่แล้วจาก sibling
Phase 4.2) ถ้าไม่มี → เป็นงานที่ใหญ่กว่าที่ประเมินไว้ (ต้องสร้างหน้าใหม่) ให้บันทึกไว้ใน task memory แล้วถาม
controller ก่อนขยายสโคป ไม่ implement เดาเอง

### 5.3 Verify

- `accounts-payable.model.spec.ts` เคสใหม่: `canCorrectWhtCertificate`/`canIssueWhtReplacementCopy` ทั้งสองแกน
  (gate + permission), ไม่ true เกิน SYSTEM_ISSUED
- Component/wiring spec ใหม่มิเรอร์ `WhtHandoffDetail.wiring.spec.ts` ที่มีอยู่แล้ว: ปุ่มสองตัวใหม่เรียก
  endpoint ที่ถูกต้อง, ฟอร์มแก้ไข prefill ถูกต้อง, banner อัปเดตหลังแก้ไขสำเร็จ

---

## Phase 6 — Full regression pass

```bash
pnpm --filter @watchdog-bms/contracts build && pnpm --filter @watchdog-bms/api lint && pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/api prisma:validate
pnpm --filter @watchdog-bms/web typecheck && pnpm --filter @watchdog-bms/web test
```

รายการที่มีอยู่แล้วต้องเขียวต่อ (touched โดยงานนี้): `issue-wht-certificate-from-handoff.use-case.spec.ts`,
`wht-certificate-handoff.use-case.spec.ts` (DTO เพิ่มฟิลด์ใหม่สองตัว), `wht-certificate-pdf.logic.spec.ts`,
`permission-registry.spec.ts`, `feature-gate.logic.spec.ts`, `accounts-payable.model.spec.ts`,
`WhtHandoffDetail.wiring.spec.ts`, `pp36-payment-reversal.repository.spec.ts` (void-guard ยังต้อง block
SYSTEM_ISSUED เดิมไม่เปลี่ยน แม้ certificate นั้นจะถูก correction แทนที่ไปแล้วก็ตาม — เพิ่มเคสใหม่: void ถูก
บล็อกด้วย certificate **ปัจจุบัน** ไม่ใช่ใบที่ถูก supersede แล้ว)

ตาม CI whole-chain lesson ในเมมโมรี รันก่อน push ถ้าแตะ `apps/api`:
```bash
node scripts/run-line-ai-whole-chain-acceptance.mjs
```

**หมายเหตุ owner minimal-testing directive:** ถ้ายังมีผลบังคับใช้อยู่ตอน implement จริง ให้รันเฉพาะ spec ที่
แตะ/เพิ่มใหม่โดยตรง ปล่อย full enumerated list ให้ CI ตอน merge เหมือนที่ sibling implementation session ทำ —
ตรวจสอบสถานะ directive นี้ก่อนเริ่ม ไม่ใช่สมมติว่ายังใช้อยู่เสมอ

---

## Phase 7 — Resolve open questions (process, ไม่ใช่โค้ด)

ก่อนเริ่ม Phase 2 จริง ต้องได้คำตอบจาก owner สำหรับสเปก §12 ข้อ 1 (`thai_tax` gate หรือไม่) — คำตอบเปลี่ยนแค่
Phase 2.1's pack placement บรรทัดเดียว (ดูหมายเหตุ implementer ใน 2.1) ไม่ต้องรอคำตอบก่อนเขียน schema (Phase 1)
หรือ use case logic ที่เหลือ (2.2 เป็นต้นไป) เพราะไม่ขึ้นกับคำตอบนี้เลย — บล็อกแค่จุดเดียวที่ระบุไว้
