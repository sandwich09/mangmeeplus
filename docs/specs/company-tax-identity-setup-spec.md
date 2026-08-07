# Spec: ตั้งค่าตัวตนภาษีบริษัท (Company Tax Identity Setup — "Step 0")

Status: DRAFT v2.9 — 2026-08-04. ประวัติ review: v1..v2.8 = No-Go สิบรอบ (log §20) — v2.9 ปิด P0×4 + P1×1 ของรอบสิบด้วยหลักฐานโค้ดและคำอธิบาย field จาก RD; self-contained เต็มไฟล์เดียว
เอกสาร normative (verify แล้วทุกฉบับ): `feature-entitlement-decoupling-spec.md` (CC4 บรรทัด 219–227; U5 amendments 2026-08-03), `tax-thailand-2026-spec.md` (~1744), `permission-matrix.md` (~353 ขัดกับ ~389 — งานนี้ต้องแก้), `feature-disabled-error-honesty-spec.md`, `docs/agent-memory/migration-drift-diagnosis.md` (drift healed 2026-07-31 — **ห้าม `resolve --applied`**), ม.86/4, ม.86/11, ประกาศอธิบดีฯ ฉบับที่ 199 · ที่มาของรหัส RA-xx = `accounting-tax-readiness-assessment.md` (RA-23 identity ไม่มี write path / RA-26 ไม่ enforce VAT / RA-17 สาขาไม่เข้า tax event / RA-13 เอกสารขาด seller-buyer data + แม่แบบพิมพ์)

## 1. เป้าหมายและขอบเขต

ให้บริษัทกรอก/แก้ตัวตนภาษีของตัวเองผ่าน wizard 5 ขั้น (เลขผู้เสียภาษี+ชื่อจดทะเบียน / ที่อยู่ / สถานประกอบการ ภ.พ.20 / สถานะ VAT / ตรวจทาน) พร้อมตรวจกับทะเบียน RD, validation ต่อฟิลด์, และเส้นทางบังคับใช้ตอนออกใบกำกับภาษีที่เปิดแบบปลอดภัย

ปิด gap: **RA-23** (identity ไม่มี write path), **RA-26** (ไม่ enforce สถานะ VAT), **RA-17 ฝั่งขาย** (สาขาผู้ขายไม่เข้า tax event), **RA-13 บางส่วน** (data ฝั่ง seller+buyer เท่านั้น — แม่แบบพิมพ์/ต้นฉบับ-สำเนายังไม่อยู่ใน scope, **ห้าม mark RA-13 closed**)

**นอกขอบเขต** (ระบุที่ไป): แม่แบบ PDF/การพิมพ์ (spec ถัดไป) · ใบกำกับอย่างย่อ/POS · CRM master enrichment เชิงลึก · correction model ของ backdated-cross-filed (แผนใหญ่: `feature-entitlement-decoupling-spec.md` CC4 บรรทัด 219–227 และ CC5 บรรทัด 229–232 + `tax-thailand-2026-spec.md` v5.1) · **numbering policy รายสาขา** (อนาคต — ดู §8.6) · payroll/ภ.ง.ด. files

## 2. ข้อเท็จจริงโค้ด/สเปคที่ v2.9 ยึด (verify สะสม 10 รอบ, 2026-08-04)

### ฝั่ง identity/tax
1. `Company.taxId/vatRegistered/addressJson/registeredName` อ่านได้ 7 จุด ไม่มีผู้เขียน; onboarding เขียนแค่ `name`+`businessCategory`+สาขา HO (`taxBranchCode:'00000'`); `CompanyTaxProfile` มาจาก seed เท่านั้น; จุด fallback profile-first มี**จุดเดียว** = `create-wht-certificate.use-case.ts:70` (procurement/expense/reimburse/AI อ่าน Company ตรง)
2. CC4:219–227: shape `CompanyVatRegistrationState(companyId,version)` / `CompanyVatRegistrationCommand(companyId, commandId, payloadFingerprint, expectedStateVersion, resultStateVersion, resultFactId?, resultKind)` / `CompanyVatRegistrationFact(status∈{REGISTERED,NOT_REGISTERED}, effectiveFrom, effectiveTo?, source, evidenceRef?, answeredAt, actorId)`; lookup-before-CAS; fact ห้ามซ้อน; **legacy `vatRegistered` บน wire เก่า = stored last-known/default bit เท่านั้น** (fact หมดอายุ → status UNKNOWN โดย bit ไม่เปลี่ยน); tax spec:1744 กำหนด endpoint `GET/PUT /v1/companies/:companyId/vat-registration` verbatim
3. `TaxReviewIssue.taxPeriodId` เป็น required → ใช้เป็น shared review seam ตอน `thai_tax` ปิดไม่ได้
4. seed มี `vatRegistered:true` แบบ**ไม่มีวันที่** (seed.ts:3062) — เป็น hint ห้าม seed เป็น fact
5. `sync-tax-events.use-case.ts:184` ใส่ `doc.branchCode` เข้า `payeeSnapshot.branchCode` (**ฝั่งผู้ซื้อ**); `TaxEvent` มี `branchId` ไม่มี seller field; sync มี**สอง path** (legacy header + finalized component) + void และ legacy path อ่าน counterparty master สด
6. RD มี 2 service: TIN existence (rd.go.th/42533 — ไม่มีชื่อ/ที่อยู่) / VAT detail (42535 — ชื่อ/ที่อยู่**รายสาขา** + `BusinessFirstDate`, เฉพาะผู้จด)

### ฝั่งเอกสาร/เลข
7. Document API มี read/create/issue/void/convert/approval — **ไม่มี PATCH และ issue ไม่มี body** (controller:83); permission `accounting.document.update` (MEDIUM) มีแล้ว (registry:90) อยู่ใน **`pack.billing.operate`**
8. **Issue ปัจจุบันไม่ atomic**: `reserveNumber` ถูกเรียกหลัง advisory checks แต่**ก่อน** Serializable txn ของ `issueDocument` และเปิด `$transaction` ของตัวเอง เพิ่ม `nextNumber` ทันที (use case:182; sequence repo:73-74 scope+txn, :142-145 increment); เอกสาร flip ISSUED ใน txn (`prisma-accounting.repository.ts:301`) แต่ commit เลขอยู่**หลัง** txn (use case:248); ล้มเหลว → `cancelNumber` ตั้งสถานะ CANCELLED; **audit เขียนหลัง txn และ outbox เป็น `void` fire-and-forget ที่กลืน error** (use case:258/264, OutboxAppendService catch) → crash ให้ `ISSUED` ที่ไม่มี event/audit ได้; `AuditService.log(entry, tx)` แบบ in-txn (throws) มีอยู่แล้ว (audit.service:65-66)
9. `DocumentNumber` มี `@@unique([companyId, documentType, idempotencyKey])` (schema:815) และ **idempotency lookup ไม่กรองสถานะ** → retry ได้แถว CANCELLED กลับ; enum สถานะ = `RESERVED|COMMITTED|CANCELLED|VOIDED` (schema:144-149)
10. `branchScopeKey` อยู่บน **`DocumentSequence`** (`@@unique([companyId, branchScopeKey, documentType, periodKey])`); resolution ปัจจุบัน = `input.branchId ?? 'GLOBAL'`; seed สร้างชุด GLOBAL; **admin สร้าง branch-scoped sequence ได้อยู่แล้ว** (`UpsertDocumentSequenceDto.branchId?` — dtos:64) → มีลูกค้าใช้ branch sequence ได้จริง ห้าม migrate ทุกคนเป็น GLOBAL
11. เอกสาร `branchId=null` = company-central มองเห็น**ทุก** scope (branch.logic:42) → bind สาขาให้เอกสารต้องเช็ค `ctx.scopes.branchIds`
12. `AccountingCounterparty` มี `taxId?/branchCode?/billingAddressJson?` แต่ไม่มี entity kind / VAT status (schema:1378)

### ฝั่งสิทธิ์/launch/อื่น
13. FINANCE preset ถือ `accounting.document.issue` + `tax_invoice/credit_note/debit_note.issue` ครบ (registry:667+); ACCOUNTANT = read เท่านั้น; parity test 6.3 pin ว่า finance presets ออกใบกำกับได้; **custom role ถือ raw advanced key ข้าม pack/entitlement filtering ได้** (จำกัดแค่ต้องเป็น registered company key + อยู่ใน granter scope — capability.logic:61-71); `pack.billing.issue` ตั้งใจแยก `tax_invoice.issue` ออก แต่รวม `credit_note/debit_note.issue`
14. `company.setup.read/manage` = LOW และแจกกว้าง → ไม่พอสำหรับ legal identity
15. Launch (U5 2026-08-03): catalog 20/20 = 13 async DEFAULT + 3 synchronous-only + 3 WHT specialist + 1 FORBIDDEN; "aggregate count or a direct bucket insert is not route evidence"; observation ต้องผ่าน production call site **≥2 UTC hours**; `synchronous.journeysPassed = null` ปัจจุบัน; **enforcement/GA ต้องมี moderated usability 2 รอบ × 5 คนจริง (≥4/5 unaided, zero severe false beliefs) + automated accessibility — ห้ามใช้ agent แทน**; แถวใหม่เปลี่ยน counts 20→21 (sync 3→4)
16. Audit sanitizer เป็น substring regex — ห้ามเติม pattern กว้าง (เติม `taxId` จะโดน `taxIdLast4`)
17. `migrate deploy` รัน pending migrations ต่อเนื่องไม่มีจังหวะหยุดให้มนุษย์ resolve
18. permission-matrix.md ขัดกันเอง (~353 baseline pack vs ~389 narrow pack สำหรับ `company.vat_registration.*`)
19. **Final-mutation lock protocol** (decoupling spec :92): lock ตามลำดับ company entitlement ก่อน global gate; shared ฝั่ง mutation/exclusive ฝั่ง disable/OPEN/CLOSE; อ่าน entitlement epoch + gate generation แบบ uncached ใน txn เดียวกับ mutation; launch `state=OPEN` อย่างเดียวไม่พอ — code ปัจจุบันตรวจ live transition ของ environment/build ด้วย (`launch-gate.guard.ts:145-160`)
20. **Sequence lazy-create เป็น baseline**: เมื่อไม่มี sequence ของ `(scope, documentType, periodKey)` repo สร้างใหม่จาก previous period ของ scope เดิมหรือ default config (sequence repo:95-112) — "ไม่มี sequence ใหม่" จึงไม่ใช่ invariant ของ baseline
21. Production deploy ใช้ N/N-1: old/new api-web tasks ใช้ DB เดียวกันระหว่าง bake (`deploy-wave-rollout-and-prod-promotion-spec.md:83-89`) และ browser/API caller เก่าอาจยิง task ใหม่ — contract/mirror cleanup จึงห้ามทำพร้อม reader flip

## 3. โครงส่งมอบ

| Release | เนื้อหา | เงื่อนไขก่อน |
|---|---|---|
| **A — Expand & Observe** | schema additive ทั้งหมด (ไม่มี constraint ใหม่), generators + resolver per-kind, endpoints identity/VAT, wizard, RD adapters (mode=off), **issue-flow atomic restructure**, เอกสาร PATCH endpoint + ฟอร์ม buyer + seller-establishment write contract/UI, sync สอง path + void ใช้ frozen snapshots + `TaxEvent.sellerBranchCode`, janitor report-only, issue-command registry, buyer-evidence flow (§7.3), would-deny authz observation + reports 6 ฉบับ — พฤติกรรมภายนอกเท่า baseline (ยกเว้นการ validate ค่า explicit ใน field ใหม่ — §8.5) | **QP1 + QP2 + QC1** |
| **(ops window)** | resolve reconciliation 3 ชนิดจน PENDING=0; **รัน operational generator command ซ้ำ (นอก migration — persist items ได้จริง) แล้ว resolve จนศูนย์อีกครั้ง**; อ่าน would-deny report; QB3 กับนักบัญชี | — |
| **B preflight** | signed/read-only invariant command ใต้ release-operation lock; PENDING/duplicate ≠ 0 → หยุดก่อน `migrate deploy` จึงไม่สร้าง failed-migration row | operational generator รอบสุดท้ายได้ศูนย์ + QD2 บน report จริง |
| **B1 — Flip, Constrain, Enforce** | reader ทุกตัว flip เป็น Company-first, partial unique constraints, type-permission enforce; **ยัง dual-write Profile mirror** เพื่อรองรับ A task ที่ยังอยู่ระหว่าง rolling bake | B preflight ผ่าน |
| **B2 — Compatibility cleanup** | หลังทุก serving task ≥ B1: freeze taxId mirror, retire TAX_ID Profile-reconciliation lane และเลิกรับ legacy `{}` issue body | serving-build proof + TAX_ID PENDING=0 + legacy-call count=0 ต่อเนื่อง 7 UTC days หลัง B1 + ไม่มี registered external caller |
| **C1 — Gate registration & observation** | register/seed gate row CLOSED + activate observation ที่ dormant issue evaluator จาก A + synchronous journey/artifacts | ประสาน decoupling workstream |
| **(evidence window)** | observation ≥2 UTC hours + journey pass + remediation/blocked-drafts + buyer coverage/accepted residual + human evidence (accessibility + usability 2×5) | — |
| **C2 — OPEN** | owner เปิด gate ตาม runbook | Q3 + evidence ครบ |

## 4. Domain A — Company legal identity

### 4.1 ข้อมูลบน `Company`
ฟิลด์เดิมที่ได้ write path: `registeredName` (ชื่อนิติบุคคลไทย; `name` = ชื่อแสดงผล ไม่แตะ) · `taxId` (เก็บ digits 13 ล้วน) · `addressJson` โครงบังคับ `{line1, line2?, subdistrict, district, province, postalCode(5 หลัก)}` — server ปฏิเสธ key นอกโครง
ฟิลด์ใหม่ **16 ตัว**: `legalIdentityVersion Int @default(0)` · **`legalIdentityCaptureCompletedAt DateTime?`** (ปิด capture window — §4.3(1)) · `lastLegalChangeEffectiveDate DateTime? @db.Date` · **`legalIdentityAuthoritativeAt DateTime?` · `legalIdentityAuthoritativeReason LegalIdentityAuthorityReason?` · `legalIdentityAuthoritativeRef String?`** · `tinExistsStatus TinExistenceStatus?` · `tinExistsAt DateTime?` · `tinSubjectHmac String?` · `tinSubjectHmacKeyVersion Int?` · `vatDetailStatus VatDetailStatus?` · `vatDetailAt DateTime?` · `vatDetailSelectedBranchCode String?` · `vatDetailSnapshotJson Json?` · `verificationLastAttemptStatus VerificationAttemptStatus?` · `verificationLastAttemptAt DateTime?`

**ชนิด/ค่าของคอลัมน์ใหม่ที่เป็น "ชุดค่าปิด" ทุกตัว** (คอลัมน์ใหม่อื่น ๆ เป็น scalar ตรงไปตรงมา — `DateTime?`, `Json?`, `String?` อิสระ, `Int?` — ประกาศชนิดไว้ที่จุดนิยามของมันเอง; **ห้ามใช้ String กับคอลัมน์ที่อยู่ในตารางนี้**):

| คอลัมน์ | ชนิด | ค่า |
|---|---|---|
| `Company.legalIdentityAuthoritativeReason` | enum `LegalIdentityAuthorityReason` | `TIN_VERIFIED` · `VAT_MATCHED` · `TAX_DOCUMENT_ISSUED` |
| `Company.tinExistsStatus` | enum `TinExistenceStatus` | `VERIFIED` · `NOT_FOUND` |
| `Company.vatDetailStatus` | enum `VatDetailStatus` | `MATCHED` · `NOT_FOUND` · `MISMATCH` |
| `Company.verificationLastAttemptStatus` | enum `VerificationAttemptStatus` | `VERIFIED` · `NOT_FOUND` · `MISMATCH` · `SERVICE_UNAVAILABLE` |
| `CompanyLegalIdentityRevision.changeKind` | enum `LegalIdentityChangeKind` | `INITIAL_CAPTURE` · `CORRECTION` · `LEGAL_CHANGE` · `RECONCILIATION_CORRECTION` |
| `CompanyLegalIdentityRevision.correctionReason` | enum `LegalIdentityCorrectionReason?` | `TYPO` · `FORMATTING` · `TRANSLITERATION` |
| `Branch.isVatEstablishment` | `Boolean @default(false)` | — |
| `AccountingCounterparty.entityKind` | enum `BuyerEntityKind?` | `JURISTIC` · `INDIVIDUAL` |
| `AccountingCounterparty.vatStatus` | enum `BuyerVatStatus?` | `VAT_REGISTERED` · `NOT_REGISTERED` · `UNKNOWN` |
| `CompanyVatRegistrationFact.source` | enum `VatFactSource` | `LEGACY_SEED` · `USER_ANSWER` · `RD_VERIFIED` · `RECONCILIATION` |
| `CompanyIdentityReconciliationItem.kind` | enum `ReconciliationKind` | `TAX_ID` · `BRANCH_DUP` · `VAT_HINT` |
| `CompanyIdentityReconciliationItem.sourceState` | enum `ReconciliationSourceState` | `ALIGNED` · `PENDING_ONE_SIDED` · `PENDING_CONFLICT` |
| `CompanyIdentityReconciliationItem.status` | enum `ReconciliationStatus` | `PENDING` · `RESOLVED` |
| `AccountingDocumentBuyerEvidenceRevision.changeKind` | enum `BuyerEvidenceChangeKind` | `INITIAL_REMEDIATION` · `DATA_CORRECTION` |
| `Company.vatDetailSelectedBranchCode`, `tinSubjectHmac`, `*Ref` | `String?` | ค่าอิสระ ไม่ใช่ชุดปิด |

### 4.2 ตาราง revision (ใหม่)
`CompanyLegalIdentityRevision`: `companyId` · `legalIdentityVersion` (**`@@unique([companyId, legalIdentityVersion])`**) · `snapshotJson` (ค่า identity เต็มหลังแก้) · `changeKind` (**Prisma enum** `INITIAL_CAPTURE|CORRECTION|LEGAL_CHANGE|RECONCILIATION_CORRECTION`) · `effectiveFrom DateTime? @db.Date` (เฉพาะ LEGAL_CHANGE) · `correctionReason` (**Prisma enum** `LegalIdentityCorrectionReason?` = `TYPO|FORMATTING|TRANSLITERATION` — บังคับเมื่อ CORRECTION) · `reconciliationItemId String?` + `repairCommandId String?` (**`@@unique([companyId, repairCommandId])` เพื่อให้ replay ของ repair เป็น idempotent ที่ระดับ DB ไม่ใช่แค่ระดับ lock**; **RECONCILIATION_CORRECTION ต้องมีอย่างใดอย่างหนึ่งเสมอ**: `reconciliationItemId` + FK สำหรับเส้น resolver (§16), หรือ `repairCommandId` สำหรับเส้น repair หลัง B2 ที่ไม่มี item — ห้ามว่างทั้งคู่) · `note String?` · `evidenceRef String?` · `actorUserId` · `createdAt` — **append-only ไม่มี update/delete**; การอ่าน snapshot เต็มต้อง `company.legal_identity.read` (ไม่มีสิทธิ์ → เห็น masked)

### 4.3 กติกา changeKind (fence)
1. **Capture window**: `INITIAL_CAPTURE` ใช้ได้ตราบที่ `legalIdentityCaptureCompletedAt IS NULL` (ไม่ผูกกับ version) — wizard บันทึกทีละขั้นได้โดยขั้น 1–3 ส่ง `changeKind=INITIAL_CAPTURE` และ version เดินขึ้นตามปกติ; **window ปิดอัตโนมัติเมื่อเกิดข้อใดก่อน** (ทุกกรณีเป็น write-once ใน txn เดียวกับเหตุการณ์นั้น; ปิดซ้ำ = no-op):
   (ก) ผู้ใช้กดยืนยันท้ายขั้น 5 (§4.4 `POST …/identity/complete-capture`)
   (ข) `LEGAL_CHANGE` สำเร็จครั้งแรก (เส้นทาง API — UI ไม่เสนอ changeKind นี้ระหว่าง window เปิด)
   (ค) **เอกสารตระกูลภาษีถูก issue ขณะที่ `sellerIdentityCompleteHO` เป็นจริง** (§8.1 — จุดเดียวกับที่ set authoritative latch §4.3(4)(ข)) — กันไม่ให้บริษัทออกใบกำกับด้วยข้อมูลครบแล้วยัง "ค้าง window" เพื่อแก้ชื่อ/ที่อยู่ซ้ำ ๆ โดยไม่เกิด fence
   ปิดแล้วเปิดใหม่ไม่ได้ และ `INITIAL_CAPTURE` ถูกปฏิเสธตลอดไปด้วย 422 `identity_change_kind_not_allowed`
   ทุก revision ระหว่าง window (INITIAL_CAPTURE) เข้ารายงานฉบับที่ 5 เช่นเดียวกับ CORRECTION — ช่วงเก็บข้อมูลจึงตรวจสอบย้อนหลังได้ ไม่ใช่ช่องมืด
2. `LEGAL_CHANGE` ต้องมี `effectiveFrom` (civil date, timezone บริษัท) และ **monotonic**: `effectiveFrom ≥ lastLegalChangeEffectiveDate` เดิม **และ `effectiveFrom ≤ today` (§12.1)** — identity ไม่มีกลไก future fact/CANCEL_FUTURE แบบ §5.3 จึงห้ามลงวันอนาคต (ปฏิเสธเป็น 422 validation ปกติ ไม่มี code ใหม่); สำเร็จแล้วอัปเดต `lastLegalChangeEffectiveDate`
3. `CORRECTION` ต้องมี `correctionReason` + `note`; **ห้ามแก้ `taxId` เสมอ** (เปลี่ยนเลขระหว่าง capture window = INITIAL_CAPTURE; หลังปิด window = LEGAL_CHANGE หรือ resolver §16 เท่านั้น); **ไม่แตะ `lastLegalChangeEffectiveDate` เด็ดขาด**; ขอบเขตที่ CORRECTION ใช้ได้: **ระหว่าง capture window เปิด** ใช้ได้กับ `registeredName`/`addressJson` ทุกกรณี (แม้ latch ถูกบันทึกแล้ว — ผลของ latch ยังไม่บังคับตาม (4)(ข); UI ใช้ INITIAL_CAPTURE เป็นหลักอยู่แล้ว); **หลังปิด window** ใช้ได้เฉพาะ field ที่ยังไม่ติด per-field latch และบริษัทยังไม่ติด authoritative latch — นอกนั้น server ตอบ 422 `identity_change_kind_not_allowed` พร้อมบอก changeKind ที่ถูกต้อง
4. **Per-field latch + durable authoritative point**: (ก) field ใด (`registeredName` / `addressJson`) ที่เคยมี revision แบบ LEGAL_CHANGE แล้ว การแก้ field นั้นครั้งถัดไปต้องเป็น LEGAL_CHANGE เท่านั้น; (ข) ใน txn ของเหตุการณ์แรกที่มีหลักฐานจริง — `TIN_VERIFIED` · `VAT_MATCHED` · `TAX_DOCUMENT_ISSUED` — **ทุก trigger ต้องมี `sellerIdentityCompleteHO` (§8.1) เป็นจริง ณ เวลานั้น** (TIN service ไม่คืนชื่อ/ที่อยู่ตาม §2 ข้อ 6 จึงห้าม latch ชื่อ/ที่อยู่จากผลตรวจเลขเพียงอย่างเดียว; บริษัทที่ identity ยังว่าง/ไม่ครบ **ไม่ set latch** ไม่ว่า trigger ใด) — ให้ set `legalIdentityAuthoritativeAt/Reason/Ref` แบบ **write-once (`WHERE legalIdentityAuthoritativeAt IS NULL`)**; ค่านี้เป็น latch ถาวร การแก้ taxId/ล้าง verification/rollback build **ห้ามล้างหรือย้อนค่า**; **ผลของ latch เริ่มบังคับหลัง capture window ปิดแล้วเท่านั้น** — เมื่อ `legalIdentityCaptureCompletedAt IS NOT NULL` และ latch ติด การแก้ `registeredName`/`addressJson` ต้องเป็น LEGAL_CHANGE เสมอ; ระหว่าง capture window เปิด latch ถูกบันทึกไว้เฉย ๆ ไม่ block INITIAL_CAPTURE
5. ทุก revision ชนิด `INITIAL_CAPTURE` และ `CORRECTION` ขึ้นรายงานฉบับที่ 5 ของ §17 — บันทึก + ป้องกันตาม (1)(3)(4) ไม่ใช่บันทึกอย่างเดียว
6. `RECONCILIATION_CORRECTION` ใช้ได้เฉพาะ **route ของ §16 ที่ guard ด้วย `system.identity_reconciliation.resolve` (resolver แบบมี item หรือ repair แบบไม่มี item หลัง B2)**, ต้องมี provenance ครบตาม §4.2 (item หรือ repairCommandId) + fingerprint + note + evidenceRef, ห้ามผ่าน PATCH ปกติ และ **ไม่สร้าง legal-date fence**
7. Fence เอกสาร: เมื่อ gate OPEN ให้ reconstruct identity ตาม §8.3; ถ้า `documentDate` อยู่ก่อน LEGAL_CHANGE แถวแรกและไม่มี revision ก่อนแถวนั้นให้ใช้เป็นฐาน → 422 `document_backdated_across_identity_revision`; เอกสารที่อยู่ในช่วงซึ่ง reconstruct ได้ออกได้ปกติโดย freeze ชุดของช่วงนั้น; INITIAL_CAPTURE, CORRECTION และ RECONCILIATION_CORRECTION ไม่สร้าง legal-date boundary แต่ snapshot ของมันอาจเป็นฐานก่อน LEGAL_CHANGE ถัดไป

### 4.4 Endpoints
- `GET /companies/:companyId/identity` — ประกอบ DTO ราย section ตามสิทธิ์: identity (masked: เลขเหลือ 4 ตัวท้าย, ที่อยู่เหลือจังหวัด) ← `company.setup.read`; identity เต็ม ← `company.legal_identity.read`; vatRegistration ← `company.vat_registration.read`; branches ← `company.branch.read`; readiness แยกตามสิทธิ์: identity flag/reasons เฉพาะผู้มี identity section, VAT eligibility เฉพาะ `company.vat_registration.read`, branch readiness เฉพาะ `company.branch.read` — **ห้าม reason/detail จาก section ที่ถูกตัดรั่วผ่าน readiness**
  **Contract ของ section ที่ถูกตัด: key หายไปจาก DTO ทั้งก้อน (absent) — ไม่ใช่ `null` และไม่ใช่ object เปล่า** (`readiness.vat` absent = "ไม่มีสิทธิ์ดู" คนละความหมายกับ `readiness.vat.eligible=false`); web ต้องแยกสองกรณีนี้เสมอ (§11 ขั้น 5)
  **Block `control` (ไม่ผูกกับ section ใด — ให้ผู้ถือ `company.setup.read` เสมอ, ไม่มีค่า identity ในนั้น)**: `{legalIdentityVersion, captureWindowOpen: boolean, authoritativeLatched: boolean, fieldLatched: {registeredName: boolean, addressJson: boolean}}` — wizard ต้องใช้ค่าพวกนี้เป็น CAS token และเป็นตัวตัดสินว่าจะเสนอ changeKind ใด (§11); ส่วน `legalIdentityAuthoritativeReason/Ref` และ `lastLegalChangeEffectiveDate` ยังต้อง `company.legal_identity.read` เพราะเป็นรายละเอียดของ identity section
- `PATCH /companies/:companyId/identity` — guard `company.legal_identity.manage` (HIGH) + `assertRouteCompany`; body: fields + `changeKind` + `effectiveFrom?` + `correctionReason?/note?/evidenceRef?` + **CAS `expectedLegalIdentityVersion` (stale → 409 conflict ปกติ ไม่มี code ใหม่)**; ใน txn เดียว: validate §4.3 → เขียน Company → **ช่วง Release A–B1: `CompanyTaxProfile.upsert` เฉพาะ `taxId/updatedByUserId` เป็น documented legacy mirror (create ใช้ default ของฟิลด์อื่น, update ห้ามทับ branch policy/period/reviewer/notes)** → append revision (version+1) → แก้ `taxId` ⇒ ล้าง verification ทั้งชุดแต่ **ห้ามล้าง authoritative latch** → audit CRITICAL (§15); **200 body = `{legalIdentityVersion, revisionId}`** เพื่อให้ wizard บันทึกขั้นถัดไปได้โดยไม่ต้อง refetch
- `POST /companies/:companyId/identity/verify-tin` — guard `company.legal_identity.manage`; rate-limit 5 ครั้ง/นาที/บริษัท
- **`POST /companies/:companyId/identity/complete-capture`** — guard `company.legal_identity.manage` + `assertRouteCompany`; body `{expectedLegalIdentityVersion}`; set `legalIdentityCaptureCompletedAt = now()` แบบ write-once (`WHERE legalIdentityCaptureCompletedAt IS NULL`); **ปิดซ้ำ = 200 no-op** (idempotent, ไม่ 409); ปฏิเสธเมื่อ `sellerIdentityCompleteHO` (§8.1) ยังไม่จริง (422 `company_tax_identity_incomplete` — ห้ามปิด window ทับข้อมูลที่ยังไม่ครบ); audit CRITICAL `{closedBy:'USER_CONFIRM'}`; การปิดอัตโนมัติตาม §4.3(1)(ข)/(ค) audit ด้วย `closedBy:'LEGAL_CHANGE'|'TAX_DOCUMENT_ISSUED'`; **200 body = `{legalIdentityVersion, captureWindowOpen:false}` ทั้งกรณีปิดจริงและ no-op**

### 4.5 Projection และ reader flip (Release B1/B2)
`companyTaxIdentity(companyId)` → `{taxId, registeredName, displayName, addressJson}` จาก Company เท่านั้น; **ช่วง Release A–B1** dual-write mirror ต่อ; **B1** ถอด fallback `profile?.taxId ?? company?.taxId` ที่ WHT cert + converge ผู้บริโภคอื่น แต่ยัง dual-write เพื่อให้ A task ที่ค้างใน rolling bake อ่านถูก; **B2** ทำได้เมื่อ serving-build proof ยืนยันทุก task ≥ B1 แล้วจึง freeze mirror ตลอดไป

### 4.6 Reconciliation (identity)
Generator (**read-only operational command — ไม่อยู่ใน migration**, guard เดียวกับ resolver §16): เทียบ `CompanyTaxProfile.taxId` ↔ `Company.taxId`; ตรงกัน = item `status=RESOLVED, sourceState=ALIGNED`, ฝ่ายเดียวมี = `PENDING/PENDING_ONE_SIDED`, ต่างกัน = `PENDING/PENDING_CONFLICT`; **generator ห้ามแก้ Company/Profile/revision** — mutation ทุกกรณีผ่าน resolver ที่มี CAS+revision+audit
Lifecycle: TAX_ID lane ใช้เฉพาะ A→B1 compatibility; B2 ต้อง PENDING=0 แล้ว mark lane `RETIRED` ใน config/code — หลังจากนั้น **generator** TAX_ID ตอบ internal `reconciliation_lane_closed` และ **ห้ามเทียบ deprecated Profile อีก**; identity ปกติแก้ผ่าน Company/revision เท่านั้น
**แต่เส้นทางซ่อมยังคงอยู่หลัง B2**: `POST /v1/system/identity-reconciliation/companies/:companyId/repair-tax-id` (guard เดียวกับ resolver, **ไม่ต้องมี item** เพราะ generator lane ปิดแล้ว) รับ `{commandId, manualValue, note, evidenceRef, expectedLegalIdentityVersion}` แล้ว append `RECONCILIATION_CORRECTION` + CRITICAL audit ด้วยกติกาเดียวกับ `resolveTaxId` แบบ `DATA_RECONCILIATION` — เพราะเมื่อ window ปิดและ latch ติดแล้ว การแก้ typo ของ `taxId` จะเหลือแต่ LEGAL_CHANGE ซึ่งสร้าง fence ย้อนหลังทั้งที่เลขไม่เคยเปลี่ยนตามกฎหมาย; เส้นทางนี้ยังคง append `RECONCILIATION_CORRECTION` (ไม่สร้าง fence) + CRITICAL audit เหมือนเดิม

## 5. Domain B — VAT registration (CC4)

### 5.1 Schema
ตาม CC4:219 verbatim (§2 ข้อ 2) + เพิ่มบน Fact: `supersededAt DateTime?`, `supersededByCommandId String?` — accessor ไม่นับแถว superseded; `VatRegistrationPrompt(companyId, context, promptVersion, promptedAt, resolvedAt)`

### 5.2 Endpoints (tax spec:1744 verbatim)
- `GET /v1/companies/:companyId/vat-registration` — `company.vat_registration.read`; query `asOf?`; ตอบ `{status: REGISTERED|NOT_REGISTERED|UNKNOWN, effectiveFrom?, effectiveTo?, version}` + deprecated tuple `(vatRegistered, vatEffectiveDate)` เพื่อ wire เก่า
- `PUT /v1/companies/:companyId/vat-registration` — `company.vat_registration.manage`; body เป็น **discriminated union โดย property ชื่อ `command.kind`**:

```ts
// PutVatRegistrationDto — ValidationPipe ของระบบเป็น whitelist + forbidNonWhitelisted
// จึงต้องประกาศ discriminator ให้ class-validator ตรง ๆ:
//   @Type(() => VatCommandBase, { discriminator: { property: 'kind',
//     subTypes: [{ value: UpsertFactCommandDto, name: 'UPSERT_FACT' },
//                { value: CancelFutureCommandDto, name: 'CANCEL_FUTURE' }] },
//     keepDiscriminatorProperty: true })
{ commandId: string,            // ≤64
  expectedVersion: number,
  command:
    | { kind: 'UPSERT_FACT',   status: 'REGISTERED'|'NOT_REGISTERED',
        effectiveFrom: string /* YYYY-MM-DD */, replaceFactId?: string }
    | { kind: 'CANCEL_FUTURE', replaceFactId: string } }   // ห้ามมี status/effectiveFrom
```
   `CANCEL_FUTURE` ที่แนบ `status`/`effectiveFrom` ถูก pipe ปฏิเสธเป็น unknown field; **server normalize civil date/enum/id แล้วคำนวณ canonical `payloadFingerprint` เอง — ไม่รับ fingerprint จาก client** (อัลกอริทึม §12.1); ลำดับ: lookup command ก่อน (fingerprint เดิม→คืนผลเดิม; commandId ซ้ำ+payload ต่าง→reject; ห้าม create-then-catch-P2002) → CAS `expectedVersion` → interval rules §5.3 ตาม variant → append/supersede fact + **อัปเดต mirror `Company.vatRegistered` = (accessor(today)==REGISTERED) ใน txn เดียวกัน** → audit HIGH
- `GET tax/profile` (เดิม): เพิ่ม tri-state fields (additive); ฟิลด์ `vatRegistered` เดิม = **stored bit** (อาจ lag — semantics ตาม CC4; ไม่คำนวณตอนอ่าน); PUT ด้วย shape เก่า: echo tuple เดิม = no-op, ค่าเปลี่ยน → 409 `vat_registration_contract_upgrade_required`
- **ไม่มี boundary worker** — mirror อัปเดตเฉพาะตอน PUT; ผู้อ่าน runtime ทุกจุดใช้ accessor จึงไม่มีใครพึ่ง bit นี้หลัง Release B1; วันเลิกใช้ bit = QM1

### 5.3 Interval rules (ครึ่งเปิด `[effectiveFrom, effectiveTo)`, วันปฏิทิน timezone บริษัท)
1. มี future fact (effectiveFrom > วันนี้) ค้างและไม่ได้ส่ง `replaceFactId` → 409 `vat_registration_future_fact_conflict`
2. `replaceFactId` ต้องชี้ future fact ล่าสุด → mark superseded; แล้ว: ถ้าไม่มี fact ใหม่แทน (คำสั่ง "ยกเลิก future") → **restore** fact ก่อนหน้าให้ open-ended (`effectiveTo = null`) — ห้ามทิ้งช่อง UNKNOWN โดยไม่ตั้งใจ; ถ้าแทนด้วย fact ใหม่ที่วัน G → ปรับ `effectiveTo` ของ fact ก่อนหน้าเป็น G
3. fact ปัจจุบันครอบ F → ตั้ง `effectiveTo = F` แล้ว insert fact ใหม่ `[F, null)`
4. Backdated: ถ้า `[F, ขอบเขตที่กระทบ)` ทับงวดภาษีที่ `isPeriodLocked(status)` เป็นจริง → 422 `vat_registration_backdated_crosses_filed_period` (**ใช้ helper เดิม `tax-period.logic.ts` ห้าม fork รายการสถานะเองในสเปกนี้**; ปัจจุบัน FILED/PAID/CLOSED และ AMENDED ไม่ล็อกตาม pinning test) — ใช้เฉพาะแถว `TaxPeriod` ที่มีจริง; เมื่อ `thai_tax` ปิดและไม่มีแถวงวด ระบบไม่มีหลักฐาน filed-period ให้ block จึงบันทึก fact+audit ตามปกติ
   **ห้ามใช้การมี TAX_INVOICE/CN/DN legacy เป็นตัวแทนสถานะจด VAT**: baseline เดิมไม่ได้ enforce RA-26 เอกสารเหล่านั้นจึงพิสูจน์สถานะกฎหมายไม่ได้ และ resolver §16 ไม่มี dated-VAT correction route; correction model ของงวดที่ยื่นแล้วอยู่นอกขอบเขต (§1)
5. `F ≤ วันนี้ + 365 วัน`
6. สถานะซ้ำกับ fact ที่ติดกัน**โดยไม่มีช่องว่าง** = no-op ระดับ fact (บันทึกที่ command result); มีช่องว่าง (UNKNOWN คั่น) = fact ใหม่ตามปกติ

### 5.4 Seeding (Release A migration)
`vatRegistered=true` + มี `vatEffectiveDate` → seed fact REGISTERED `[vatEffectiveDate, null)` source=`LEGACY_SEED` ครั้งเดียว; `true` ไม่มีวันที่ = hint → reconciliation item ชนิด VAT-hint; `false` ไม่ seed; state version 0 backfill ทุกบริษัท + onboarding สร้างใน txn เดียวกับ company

### 5.5 Prompt
ตัวเลือก "จดทะเบียนแล้ว / ไม่ได้จดทะเบียน / ไม่แน่ใจ" — "ไม่แน่ใจ" resolve prompt โดยไม่สร้าง fact (สถานะคง UNKNOWN); `promptResolved` เก็บใน `VatRegistrationPrompt.resolvedAt`; ask-once ต่อ context

## 6. Domain C — Establishment / branch

### 6.1 สองมิติแยกจริง
`Branch.isVatEstablishment Boolean @default(false)` (คอลัมน์ใหม่) — **อิสระจาก `type`**; กติกา: `isVatEstablishment=true` ⇔ ต้องมี `taxBranchCode` (HO='00000', อื่น 5 หลัก); `false` ⇔ `taxBranchCode = null`; type ไม่ derive ทั้งสองทาง (WAREHOUSE ที่จดเป็นสาขา ภ.พ.20 ก็ตั้ง true ได้; BRANCH ที่ไม่จดก็ false ได้); backfill: แถวที่มี `taxBranchCode` → true

### 6.2 ที่อยู่สถานประกอบการ
establishment ที่ไม่ใช่ HO **ต้องมี `Branch.addressJson` ของตัวเอง**; HO อนุญาต fallback `Company.addressJson` (สถานที่เดียวกัน); readiness ฝั่งผู้ขายใช้กติกานี้

### 6.3 Constraints (Release B1 เท่านั้น)
partial unique `(companyId, taxBranchCode) WHERE taxBranchCode IS NOT NULL` + `(companyId) WHERE type='HEAD_OFFICE' AND status='ACTIVE'` — ก่อน ADD: migration ตรวจซ้ำเป็นศูนย์ใน txn เดียวกัน (fail closed)
**กันข้อมูลใหม่ระหว่าง ops window (Release A)**: branch create/update ถือ **company-scoped advisory transaction lock** (`pg_advisory_xact_lock(hash(companyId, 'branch_tax_identity'))`) ครอบทั้ง check+write สำหรับทั้ง duplicate `taxBranchCode` (→ 409 `branch_tax_code_duplicate`) และ single-ACTIVE-HEAD_OFFICE — ระบุ lock จริง ไม่ใช่แค่คำว่า serialized

### 6.4 Seller establishment ของเอกสาร (write contract ครบ)
- คอลัมน์ใหม่ 2 ตัวบนเอกสาร: `AccountingDocument.sellerEstablishmentBranchId String?` — **มี composite FK `[companyId, sellerEstablishmentBranchId] → Branch[companyId, id]`** (pattern เดียวกับ `branchId` เดิม — ไม่พึ่ง application check อย่างเดียว) และ `AccountingDocument.sellerSnapshotJson Json?` (snapshot ผู้ขายที่ freeze ตอน issue — §8.3; schema ปัจจุบันมีเฉพาะ `counterpartySnapshotJson`)
- เขียนได้ที่: `CreateAccountingDocumentDto.sellerEstablishmentBranchId?` (ใหม่) · `PATCH` เอกสาร DRAFT (§7.2) · `IssueAccountingDocumentDto.sellerEstablishmentBranchId?` (override ตอน issue)
- **Precedence ตอน issue**: explicit (issue DTO) → ค่าบนเอกสาร (จาก create/PATCH) → `doc.branchId` **เฉพาะเมื่อ branch นั้น `isVatEstablishment=true`** → HO ที่ผู้ใช้เข้าถึงได้ → ไม่มี → 422 `document_branch_required`
- WAREHOUSE/ONLINE (`isVatEstablishment=false`) ไม่มีทางกลายเป็น seller establishment โดยอัตโนมัติ; เลือกตรง ๆ ก็ไม่ผ่าน (`document_branch_not_tax_establishment`)
- **ABAC**: ค่าที่ resolve ได้ต้องอยู่ใน `ctx.scopes.branchIds` — ผู้ใช้เลือก branch นอก scope โดยตรง → **403 + DENIED audit**; ผู้ใช้ scope จำกัดที่ระบบหา establishment ใน scope ไม่ได้ → 422 `document_branch_required`; ตรวจทั้ง preflight และซ้ำใน txn
- UI: ฟอร์มสร้าง/แก้เอกสาร + หน้าก่อน issue มี selector "สถานประกอบการผู้ขาย" แสดงเฉพาะ establishment ใน scope
- หมายเหตุ: `doc.branchId` (operational) **ไม่ถูกแตะ** — เอกสาร null-branch ยังเป็น company-central ตามเดิม

### 6.5 Seller ลง tax event
คอลัมน์ใหม่ `TaxEvent.sellerBranchCode String?`; **ทั้งสอง sync path + void** อ่านจาก **frozen snapshots ของเอกสาร** (`sellerSnapshotJson`/`counterpartySnapshotJson`) ไม่อ่าน master สด; seller fields รวมเข้า canonical source hash เพื่อให้ supersede ทำงาน; `payeeSnapshot.branchCode` คงเป็นของผู้ซื้อเท่านั้น (มี direction test)

## 7. Domain D ส่วนที่ 1 — Buyer + เอกสาร

### 7.1 Buyer matrix (สองมิติ)
`buyerEntityKind ∈ {JURISTIC, INDIVIDUAL}` × `buyerVatStatus ∈ {VAT_REGISTERED, NOT_REGISTERED, UNKNOWN}` + `isForeign?/country?`
| เงื่อนไข | ต้องมี ณ document-ready |
|---|---|
| `VAT_REGISTERED` (นิติหรือบุคคล — ประกาศ 199 ครอบ "ผู้ประกอบการจดทะเบียน" ทุกรูป) | ชื่อ + ที่อยู่ + เลขภาษีไทย 13 + สนญ./สาขา 5 หลัก — **แม้ `isForeign=true`** (ต่างชาติที่จด VAT ไทย); `isForeign` มีผลแค่รูปแบบที่อยู่ |
| `NOT_REGISTERED` (นิติ/บุคคล) | ชื่อ + ที่อยู่ (ม.86/4); เลขภาษี optional |
| `UNKNOWN` | **ออกใบกำกับภาษีไม่ได้** → 422 `buyer_vat_status_confirmation_required` (ต้องยืนยันเป็นค่าใดค่าหนึ่งก่อน — ต่อใบหรือที่ master) |
| `isForeign` + ไม่จด VAT ไทย | ชื่อ + ที่อยู่ + ประเทศ; ไม่มี field ไทย |

### 7.2 Persistence + endpoints
- คอลัมน์ใหม่ `AccountingDocument.buyerTaxIdentityDraftJson {buyerEntityKind, buyerVatStatus, isForeign?, country?, name?, taxId?, branchCode?, addressText?}`
- รับได้ทั้ง: `CreateAccountingDocumentDto.buyerTaxIdentityDraft?` (ใหม่ additive) และ **endpoint ใหม่ `PATCH /companies/:companyId/accounting/documents/:documentId`** — guard `accounting.document.update` (มีแล้วใน `pack.billing.operate`) + `assertRouteCompany` + `isBranchInScope(doc.branchId)` + เฉพาะสถานะ DRAFT + CAS `expectedUpdatedAt` + audit MEDIUM; **allowlist ของ PATCH มีสองฟิลด์เท่านั้น: `buyerTaxIdentityDraftJson` และ `sellerEstablishmentBranchId`** (ไม่มี "contract update เดิม" — ระบบไม่มี update use case ของเอกสารอยู่ก่อน; ฟิลด์อื่นใดถูก reject)
- default จาก `AccountingCounterparty` (คอลัมน์ใหม่ `entityKind BuyerEntityKind?`, `vatStatus BuyerVatStatus?` — **Prisma enum ตาม §4.1** + `taxId/branchCode/billingAddressJson` เดิม); precedence ตอน freeze: **draft บนเอกสาร > master**
- ตอน issue: merge → validate §7.1 → freeze snapshot schema v1 เข้า `counterpartySnapshotJson`; หลัง issue = immutable; **CN/DN ใช้ valid snapshot ต้นฉบับ หรือ evidence revision ตาม §7.3** ไม่ re-derive

**Buyer snapshot v1 + `validBuyerSnapshotV1` (นิยามเดียวที่ issue / CN-DN / evidence endpoint / report 6 ต้อง import ร่วมกัน — module `packages/contracts/src/buyer-snapshot-v1.ts`)**

```ts
type BuyerSnapshotV1 = {
  snapshotSchemaVersion: 1
  // legacy keys เดิมคงไว้ทั้งหมด — old task ที่อ่าน snapshot ใหม่ต้องไม่พัง (N/N-1)
  id: string | null; displayName: string; legalName: string | null; taxId: string | null
  // v1 ที่เพิ่ม
  buyerEntityKind: 'JURISTIC' | 'INDIVIDUAL'
  buyerVatStatus: 'VAT_REGISTERED' | 'NOT_REGISTERED'   // UNKNOWN ออกใบไม่ได้ (§7.1) จึงไม่มีใน snapshot
  isForeign: boolean; country: string | null            // country บังคับเมื่อ isForeign
  addressText: string                                    // ข้อความที่พิมพ์ลงเอกสาร (คนละ field กับ addressJson ของผู้ขาย)
  branchCode: string | null                              // '00000' = สนญ.; 5 หลักเมื่อสาขา
}
```
`validBuyerSnapshotV1(x)` เป็นจริงเมื่อ: `snapshotSchemaVersion === 1` · `displayName` ไม่ว่าง · `addressText` ไม่ว่าง · `buyerEntityKind`/`buyerVatStatus` อยู่ในชุดค่า · `isForeign=true ⇒ country` ไม่ว่าง · **VAT_REGISTERED ⇒ `taxId` เป็นตัวเลข 13 หลัก และ `branchCode` เป็นตัวเลข 5 หลัก** (บังคับแม้ `isForeign=true`) · `buyerVatStatus==='NOT_REGISTERED' ⇒ taxId/branchCode เป็น null หรือค่าที่ผ่านรูปแบบเดียวกัน · key นอกรายการ = invalid (ไม่ ignore) · ค่าที่ขาด = invalid ไม่ใช่ null-tolerant
snapshot ที่ freeze ก่อนฟีเจอร์นี้ (4 keys เดิม ไม่มี `snapshotSchemaVersion`) จึง **invalid ตามนิยาม** และเป็นตัวขับ report 6/§7.3 โดยอัตโนมัติ
- Web: ฟอร์ม buyer ในหน้าสร้าง/แก้เอกสาร + แสดงสรุปก่อน issue

### 7.3 Legacy TAX_INVOICE remediation (สำหรับ CN/DN หลัง C2)
- ปัญหา: snapshot เดิมเก็บแค่ `{id, displayName, taxId, legalName}` (document.use-case:191) — CN/DN ที่อ้างใบกำกับเก่าจะติด buyer check ถาวรทั้งที่ธุรกรรมถูกต้อง
- ตารางใหม่ append-only `AccountingDocumentBuyerEvidenceRevision`: `companyId` · `documentId` (FK แบบ tenant-scoped ไป issued TAX_INVOICE) · `revision` · `commandId` · server-owned `payloadFingerprint` · `snapshotSchemaVersion=1` · `buyerSnapshotJson` **typed ตาม `BuyerSnapshotV1` §7.2** · `evidenceRef` (required) · `changeKind INITIAL_REMEDIATION|DATA_CORRECTION` · `note` (required เมื่อ DATA_CORRECTION) · `reviewedByUserId` · `createdAt`; unique `(companyId,documentId,revision)` และ `(companyId,documentId,commandId)`; ไม่มี update/delete/current pointer — current = revision สูงสุด
- Endpoint `POST /companies/:companyId/accounting/documents/:documentId/buyer-evidence-revisions` — guard **`accounting.tax_document_buyer_evidence.manage` (HIGH ใหม่) + `accounting.tax_invoice.issue`** + route/document/branch ABAC; body `{commandId, expectedCurrentRevision, changeKind, buyerSnapshot, evidenceRef, note?}`; ใน txn lock original document row → lookup command `(companyId,documentId,commandId)` ก่อน CAS → validate expected current revision + snapshot §7.1 + canonical fingerprint → append revision + audit HIGH; concurrent/retry payload เดิมคืน revision เดิม, payload ต่าง 409; การแก้ evidence ผิดทำด้วย DATA_CORRECTION revision ใหม่ ไม่ void/แก้ต้นฉบับ
- **Invariant กันเปลี่ยนตัวผู้ซื้อ: `buyerSnapshot.id` ต้องเท่ากับ `doc.counterpartyId` เสมอ** (null ทั้งคู่เมื่อเอกสารไม่มี counterparty) — ไม่ตรง → 422 `buyer_tax_identity_incomplete` พร้อม `details.reason='counterparty_anchor_mismatch'`, ตรวจใน txn เดียวกับที่ lock แถวต้นฉบับ; evidence จึงเติม/แก้รายละเอียดของผู้ซื้อรายเดิมได้ (ที่อยู่, entityKind/vatStatus, สาขา, typo ของเลข/ชื่อ) แต่ **สลับเป็นลูกค้าอีกรายไม่ได้**
- CN/DN ใช้ `validBuyerSnapshotV1(original.counterpartySnapshotJson)` ก่อน; ถ้าไม่ผ่านจึงใช้ latest valid evidence revision; **ห้าม presence-only** และห้าม re-derive จาก master สด
- **Report ฉบับที่ 6 (§17)**: ทุก issued TAX_INVOICE ที่ `validBuyerSnapshotV1` ไม่ผ่าน (รวม `buyerEntityKind`, `buyerVatStatus`, name/address และ taxId/branch ตาม status — ไม่ใช่เช็ค address/branch อย่างเดียว) + latest evidence revision/validity; ก่อน C2 ต้อง coverage valid = 100% หรือมี owner-signed acceptance ของ residual blocked count

## 8. Domain D ส่วนที่ 2 — Readiness + issue flow

### 8.1 Readiness สองระดับ (ชื่อสื่อความจริง)
- `sellerIdentityComplete(branchId)`: taxId 13 + registeredName + `Company.addressJson` ครบโครง + branch นั้น `isVatEstablishment` + address ตาม §6.2 + `promptResolved` — "ข้อมูลครบ" ไม่ตัดสินว่าออกใบกำกับได้
- **`sellerIdentityCompleteHO` = `sellerIdentityComplete(HO ที่ ACTIVE)`** — เป็นตัวที่ใช้ในเงื่อนไขระดับบริษัท: ปิด capture window (§4.3(1)(ค), §4.4 `complete-capture`) และ set authoritative latch (§4.3(4)(ข)); การ issue เอกสารจากสาขาอื่นใช้ `sellerIdentityComplete(effectiveBranch)` ของสาขานั้นตามปกติ แต่จะปิด window/ตั้ง latch ก็ต่อเมื่อ `sellerIdentityCompleteHO` เป็นจริงด้วย (สถานะ VAT ทุกค่ารวม UNKNOWN ไปตัดสินที่ `taxInvoiceEligible` — ทำให้ทั้งสอง branch ของ `vat_registration_required` reachable)
- `taxInvoiceEligible(companyId, date)`: `effectiveVatRegistration(companyId, date) === 'REGISTERED'`
- `taxInvoiceDocumentReady(document)`: `sellerIdentityComplete(effectiveBranch)` + `taxInvoiceEligible(documentDate)` + buyer ตาม §7.1 + tax code/ชนิดตาม role เดิม (`accounting-status.logic.ts`) + ไม่ติด fence §4.3(7)

### 8.2 Error precedence ต่อชนิดเอกสาร
- **TAX_INVOICE**: company scope (403) → permission (403) → seller-branch resolution (§6.4: explicit นอก scope = 403+DENIED; explicit ไม่ใช่ establishment = 422 `document_branch_not_tax_establishment` เสมอ; ระบบ resolve ไม่ได้ = 422 `document_branch_required` **เมื่อ gate OPEN**) → `sellerIdentityComplete` (422 `company_tax_identity_incomplete` รายข้อ) → `taxInvoiceEligible` (422 `vat_registration_required`; `details.status = UNKNOWN|NOT_REGISTERED` — ทั้งสองค่า reachable) → buyer (422 `buyer_vat_status_confirmation_required` | `buyer_tax_identity_incomplete`) → fence (422)
- **CREDIT_NOTE/DEBIT_NOTE**: original-linkage (ของเดิม) → **ถ้า `accessor(documentDate)==NOT_REGISTERED` และต้นฉบับออกช่วง REGISTERED → 422 `vat_deregistered_correction_requires_authority` (มาก่อน generic — เส้นทาง authority ตาม ม.86/11 รอ QB3; ไม่มี default allow)** → eligible → buyer ตามลำดับ: **valid frozen snapshot v1 ของต้นฉบับ → latest valid `AccountingDocumentBuyerEvidenceRevision` (§7.3) → 422 `buyer_tax_identity_incomplete`**; ไม่ re-derive จาก master และไม่แก้ต้นฉบับ
- เอกสารไม่ใช่ตระกูลภาษี: ไม่ตรวจชุดนี้เลย

### 8.3 Issue flow (atomic เต็ม)
`AccountingDocumentIssueCommand`: `companyId` · `commandId` · `documentId` · `actorUserId` · server-owned `payloadFingerprint` · `resultDocumentNumber` · **`entitlementEpochsJson` · `launchEntriesJson` · `availabilityVectorHash`** · `completedAt`; unique `(companyId,commandId)`; **ไม่มี IN_PROGRESS state** — แถวมีอยู่ได้เมื่อ issue ทั้งก้อน commit แล้วเท่านั้น

**Availability vector (กติกา decoupling: final-mutation row ต้องเก็บ "ทุก" epoch/gate ไม่ใช่แค่ของ feature ตัวเอง)** — สาม field ข้างบนมีรูปเดียวกับ `ExecutionAttempt`: `entitlementEpochsJson` = ทุก feature key ที่จำเป็นพร้อม epoch (อย่างน้อย `sales_documents`; `thai_tax` ไม่อยู่ในนี้เพราะการออกเอกสารไม่ขึ้นกับมัน), `launchEntriesJson` = ทุก `(gateKey, routeKey, generation)` ที่ต้อง OPEN — **ปัจจุบันสองแถว: `(cap.company_tax_identity, TAX_INVOICE_ISSUANCE_GATE)` และ `(sales_documents, DEFAULT)` ซึ่ง seed OPEN อยู่แล้ว**; **canonical sort สำหรับทั้ง lock และ hash: entitlement rows เรียงตาม feature key ก่อน แล้ว launch rows เรียงตาม `(gateKey, routeKey)`** (`cap.company_tax_identity` มาก่อน `sales_documents`) — บังคับใช้ลำดับนี้ทุก path เพื่อกัน deadlock กับ claimant อื่นที่ถือหลาย gate
ช่วง Release A–B1 แถว `cap.company_tax_identity` **ยังไม่ถูก register** (C1 ค่อย seed) → `launchEntriesJson` ของแถวช่วงนั้นบันทึกเฉพาะ gate ที่มีจริง และทำเครื่องหมาย `preGateCutoff: true`; **C1 ต้องมีขั้นตอน reconcile cohort นี้กับ cutoff ที่ตรึงไว้ (ห้าม back-stamp generation ปัจจุบันลงแถวเก่า)** — ดู §13

```
Endpoint: POST :documentId/issue
  preferred body IssueAccountingDocumentDtoV2
  { commandId (required, ≤64, client-stable ต่อความตั้งใจหนึ่งครั้ง),
    expectedUpdatedAt (required ISO — CAS),
    sellerEstablishmentBranchId? (override) }
  Release A–B1 compatibility: legacy `{}` ยังรับได้; server derive intent จากเอกสารที่โหลด
  มาแล้วและใช้ **commandId = `legacy:${documentId}:${doc.updatedAt.toISOString()}`**
  (+ expectedUpdatedAt = ค่าเดียวกัน) — **ห้ามใช้ requestId**: key ต้องเสถียรต่อ "เจตนาเดียวกัน"
  เพื่อให้ (ก) สอง legacy submit พร้อมกันจับ command lock ตัวเดียวกันแล้ว replay ผลเดียว
  (ข) ไม่ถอยหลังจาก baseline ซึ่ง dedupe ได้อยู่แล้วผ่าน key ร่วม `issue:${documentId}`
  → คุณสมบัติ concurrency/replay ของ V2 ใช้กับ legacy path ครบ (ต่างเพียง client เลือก
  commandId เองไม่ได้ จึง replay ข้าม "การกดใหม่หลังเอกสารถูกแก้" ไม่ได้ ซึ่งถูกต้องอยู่แล้ว);
  นับ telemetry ทุกครั้งที่เข้า path นี้; web ใหม่ส่ง V2 ตั้งแต่ A; B2 จึง reject legacy เมื่อ
  telemetry=0 ต่อเนื่อง 7 UTC days หลัง B1 และ support inventory ยืนยันว่าไม่มี registered
  external caller

Success contract (ทั้ง V2 และ legacy):
  `IssueAccountingDocumentResult = DocumentRecord & { replayed: boolean }`
  — fresh path คืน `replayed:false`; replay คืน `replayed:true`; field อื่นเหมือนกันทั้งหมด
  และยังคงเป็น document object ระดับบนสุดเพื่อให้ caller เก่าอ่าน `status`/`documentNumber` ได้เหมือนเดิม

Stage 0 — Authorization + fast replay (**ก่อน DRAFT-CAS แต่ไม่ก่อน auth**):
  assertRouteCompany → generic permission → load document ด้วย company+branch scope
  → type-specific permission (A log-only; B1+ enforce — ช่วง log-only บันทึก
    `AccountingIssueAuthzObservation` ใน txn สั้นของตัวเองแยกจาก flow นี้ §17)
  → server normalize intent และ hash ตาม §12.1 ตรง ๆ:
    {companyId, documentId, expectedUpdatedAt, sellerEstablishmentBranchId|null}
  → lookup `AccountingDocumentIssueCommand` (companyId, commandId):
    • พบ + documentId/fingerprint ตรง → **คืนเอกสารที่โหลดไว้แล้วใน Stage 0 (ISSUED + documentNumber)
      เป็น shape เดียวกับ fresh path ทุกประการ** + `replayed:true` (caller เก่าเมิน field เพิ่มได้)
      — **ห้ามคืน object สองฟิลด์**: มี success body แบบเดียวทั้ง fresh และ replay มิฉะนั้น web/e2e/
      registered caller ที่อ่าน `status`/`documentNumber` จะพังเฉพาะตอน retry ที่สำเร็จไปแล้ว
      (`resultDocumentNumber` ยังเป็นคอลัมน์ที่เก็บใน command row ตามเดิม — เปลี่ยนแค่สิ่งที่ตอบกลับ)
    • พบ + ต่าง → 409 `issue_command_conflict`
    • ไม่พบ → ไปต่อ
  (ผู้ถูกถอน type permission/branch scope replay ไม่ได้; registry ไม่ใช่ auth bypass)

Stage 1 — Preflight (อ่านอย่างเดียวต่อ domain state; ผิด → 403/409/422 โดย sequence/DocumentNumber
  /เอกสาร ไม่ถูกแตะ — ตัวนับ telemetry §17 อยู่นอกขอบเขตนี้):
  (auth/permission/type-permission ทำไปแล้วใน Stage 0 — ไม่ตรวจซ้ำ)
  → resolve effectiveBranch (precedence + error split ตาม §6.4/§8.2/§8.5)
  → ABAC branch scope (explicit นอก scope = 403+DENIED)
  → CAS: doc.status=DRAFT && doc.updatedAt==expectedUpdatedAt — ไม่ผ่าน → **409**
     (conflict ปกติ ไม่มี code ใหม่ใน CODE_LABELS; web แสดงผ่าน STATUS_LABELS)
  → advisory readiness (§8.1–8.2 — บังคับตาม gate ใน Stage 2)

Stage 2 — Serializable txn เดียว (use case เป็น transaction owner):
  canonical lock order ตาม decoupling :92:
  1) shared company-entitlement lock ของ `sales_documents` → uncached read/epoch;
     disabled ⇒ `feature_not_enabled` ก่อนแตะ sequence
  2) shared launch-gate lock **ของทุกแถวใน `launchEntriesJson` ตาม canonical sort**
     — ปัจจุบัน `(cap.company_tax_identity,TAX_INVOICE_ISSUANCE_GATE)` แล้ว
     `(sales_documents,DEFAULT)` — อ่าน uncached ทั้งคู่ใน txn นี้ (ชุด lock ต้องตรงกับ
     ชุดที่เข้า hash เสมอ);
     `sales_documents/DEFAULT` seed OPEN อยู่แล้ว: ไม่ OPEN/ไม่ attested = `feature_temporarily_unavailable`;
     `cap.company_tax_identity`: absent/CLOSED = readiness OFF; OPEN ต้องผ่าน `isOpenOnDeployment`
     ของ environment/build+generation ปัจจุบัน มิฉะนั้น `feature_temporarily_unavailable` (ห้าม
     silently downgrade OPEN เป็น CLOSED); OPEN+attested = readiness ON
  3) exclusive advisory xact lock `issue_command:${companyId}:${commandId}`
     → lookup command ซ้ำใต้ lock; same intent = replay result, different = 409
  → lock/reload document + revalidate status/updatedAt/branch/seller field/scope,
     branch ยัง ACTIVE establishment และ readiness/buyer/fence ตามค่าจาก gate
  → reserveNumberInTx(tx, { idempotencyKey: `issue:${documentId}:${commandId}`, branchId: doc.branchId, … })
    • scope เลข = `doc.branchId ?? 'GLOBAL'` เดิมทุกประการ (§8.6)
    • replay เป็นหน้าที่ของ command registry (Stage 0) ไม่ใช่ reservation — แถว
      RESERVED/COMMITTED ใต้ key นี้เกิดไม่ได้โดยไม่มี command COMPLETED (commit คู่กันใน
      txn เดียว ซึ่ง Stage 0 ตอบไปแล้ว); เจอแถว CANCELLED ใต้ key (defensive) →
      409 `issue_command_conflict`; unique constraint เดิม (schema:815) คงไว้ —
      flow ใหม่ล้มเหลว = rollback ทั้ง txn ไม่ทิ้งแถว (key format ใหม่ไม่ชน legacy
      `issue:${documentId}`)
  → freeze sellerSnapshotJson {registeredName, taxId, branchCode, branchAddress ตาม §6.2}
     **as-of `documentDate` โดยใช้ revision เดิม ไม่เพิ่มตาราง/คอลัมน์** (`D = civilDate(documentDate,tz)`):
     • ไม่มี LEGAL_CHANGE หรือ `D ≥ effectiveFrom` ของ LEGAL_CHANGE ล่าสุด → ใช้ Company ปัจจุบัน
       (จึงรวม CORRECTION/RECONCILIATION_CORRECTION ล่าสุด รวม `repair-tax-id` หลัง B2)
     • `D` อยู่ก่อน LEGAL_CHANGE ล่าสุด → หา LEGAL_CHANGE แถวแรกที่ `effectiveFrom > D`
       (tie-break ด้วย `legalIdentityVersion`) แล้วใช้ `snapshotJson` ของ revision ที่ version ก่อนหน้า
       ทันที — snapshot นี้คือ identity ก่อน boundary ถัดไปและรวม correction ทุกชนิดที่เกิดในช่วงนั้น
     • ไม่มี revision ก่อน boundary แรก → 422 `document_backdated_across_identity_revision`
     CORRECTION ปกติแก้เฉพาะช่วงที่ active ตอนแก้; การแก้ historical segment ที่ปิดไปแล้วอยู่นอก scope
     **ที่อยู่สาขาใช้ค่าปัจจุบันเสมอ** (Branch ไม่มี revision history — residual ที่ยอมรับ)
     + buyer merge (§7.2) → persist sellerEstablishmentBranchId
  → เอกสาร → ISSUED; DocumentNumber → COMMITTED (ใน txn เดียวกัน)
  → ถ้าเป็น TAX_INVOICE/CN/DN **และ `sellerIdentityCompleteHO` เป็นจริง ณ จุด freeze**:
     set Company authoritative latch **และปิด capture window** แบบ write-once ใน txn เดียวกัน
     (§4.3(1)(ค) + §4.3(4)(ข)); identity ไม่ครบ = ไม่ set ทั้งคู่
  → outbox append ใน txn (tx-aware, ห้ามกลืน error): `accounting.<type>.issued` + tax-facts
     finalize events เดิมทั้งหมด
  → audit ใน txn: this.audit.log(entry, tx) — HIGH (เดิม) และ CRITICAL เมื่อชนิด TAX_INVOICE/CN/DN
  → insert `AccountingDocumentIssueCommand` ผล COMPLETED (documentId/number + epoch/generation)
     เป็น write สุดท้ายใน txn; ไม่มี create-catch-P2002 เพราะ command lock serialize แล้ว
  → fresh response = เอกสารเต็ม + `replayed:false` ตาม success contract ข้างบน

**Serialization policy (บังคับ — ไม่ใช่ทางเลือก)**: txn นี้เป็น `Serializable` และตอนนี้มี
`documentSequence.update({nextNumber:{increment:1}})` (และ upsert ตอนขึ้นงวดใหม่) อยู่ข้างใน
ร่วมกับ loop finalize tax รายบรรทัด → first-updater-wins ของ Postgres จะยิง `40001` (Prisma
`P2034`) ให้ผู้ออกเอกสารพร้อมกันคนที่สอง **แน่นอน** และ filter กลางแปลง P2034 เป็น 500 จึงต้องมี:
  • **bounded retry ฝั่ง server ใน use case**: จับ `P2034`/`40001` แล้วรัน Stage 0→2 ใหม่ทั้งชุด
    ด้วย commandId เดิม (idempotent เพราะ registry + reservation ผูก commandId) — 5 ครั้ง,
    backoff 20/40/80/160/320 ms + jitter; หมดแล้วตอบ 409 conflict (ไม่ปล่อยเป็น 500)
  • ตั้ง `$transaction` `timeout` 15s / `maxWait` 5s (default 5s/2s ไม่พอกับ 3 advisory locks
    + loop tax รายบรรทัด)
  • **ห้ามมี network I/O ใด ๆ ใน txn** (outbox = insert แถว, ไม่ dispatch)
  • legacy path retry ได้เพราะ commandId derive จาก `(documentId, updatedAt)` ไม่ใช่ requestId

คุณสมบัติ: crash จุดใดก็ได้ = state ครบชุดหรือไม่มีอะไรเลย (เอกสาร+เลข+outbox+audit atomic);
retry หลัง transient/serialization failure ด้วย commandId เดิมสำเร็จ (ไม่มีแถวค้าง);
duplicate concurrent command รอ command lock แล้ว replay ผลเดียวกัน;
repo เพิ่ม seam `issueDocumentInTx`/`reserveNumberInTx` — เมธอดเดิมที่เปิด txn เองห้ามถูกเรียกซ้อน
Recovery ของแถว RESERVED/CANCELLED เก่าจาก flow ก่อน restructure: janitor report-only (ไม่ auto-แก้)
```

### 8.4 Snapshot coherence
ผลลัพธ์ coherent ตาม serialization order — PATCH identity/เอกสารที่ขนานกันจะแพ้/รีทราย ไม่มีค่าผสม; ไม่ guarantee "ค่าล่าสุด" แต่ guarantee ชุดที่สอดคล้องกันหนึ่งชุด

### 8.5 Gate behavior
Gate (`cap.company_tax_identity/TAX_INVOICE_ISSUANCE_GATE`) ควบคุมเฉพาะ **readiness 422** ของ §8.2 — รวม `document_branch_required`: absent/CLOSED = ข้าม readiness-block (resolution ล้มเหลว → ไม่ freeze seller snapshot และไม่ error — baseline); OPEN+current-build attestation = บังคับ; OPEN แต่ build ไม่ได้รับ attestation = 403 `feature_temporarily_unavailable` ไม่ใช่ CLOSED fallback; **validate เสมอไม่ขึ้น gate**: (ก) explicit `sellerEstablishmentBranchId` นอก scope = 403+DENIED / ไม่ใช่ establishment = 422 (ข) type permission ตั้งแต่ B1 รวม emergency CLOSE (ค) uncached `sales_documents` entitlement ใต้ shared lock ทุก release

### 8.6 Numbering — ไม่เปลี่ยนใน spec นี้
สูตร scope คงเดิม verbatim: `doc.branchId ?? 'GLOBAL'`; บริษัทที่ตั้ง branch sequence ไว้แล้ว (ผ่าน `UpsertDocumentSequenceDto.branchId`) ใช้ต่อเหมือนเดิมทุกประการ; **ไม่มีคอลัมน์/นโยบายใหม่**; งานอนาคต "numbering ตามสถานประกอบการ" ต้องมี spec แยกพร้อม: inference จาก sequence/DocumentNumber history + continuation migration + collision preflight — บันทึกเป็นข้อกำหนดของงานนั้น ไม่ใช่ของงานนี้; **AC: พฤติกรรมเลขเอกสารเท่า baseline ทุกกรณี**

## 9. RD verification (2 adapters)

- `RdTinExistenceAdapter` (ตรวจการมีอยู่ของเลข — ไม่มีชื่อ/ที่อยู่) + `RdVatDetailAdapter` (ชื่อ/ที่อยู่รายสาขา + `businessFirstDate` — เฉพาะผู้จด VAT) หลัง interface `TaxRegistryVerificationService` → `{tinExists, vatDetail?: {name, businessFirstDate?, branches:[{branchCode, name?, address}]}, partial}`
- Hardening: XML parser ปิด external entities (XXE) · response ≤256KB · allowlist host+path `rdws.rd.go.th` เท่านั้น · timeout 5s · circuit breaker · ไม่ log payload เต็ม · ส่งเฉพาะเลข 13 หลัก
- Config `RD_TIN_VERIFICATION_MODE = off|assist` (default **off**; โหมด off → web ซ่อนปุ่ม; local dev ต้องมี `NODE_EXTRA_CA_CERTS`)
- บริการไม่พร้อม (timeout / circuit-open / oversize): `POST …/verify-tin` ตอบ **503 `tin_verification_unavailable`** — web แสดง "ตรวจสอบกับสรรพากรไม่ได้ขณะนี้ บันทึกได้ตามปกติ" และเขียนเฉพาะ last-attempt fields
- ผลเขียนฟิลด์ §4.1: TIN แยกจาก VAT; `tinSubjectHmac` = keyed HMAC ของเลข + `keyVersion` (หมุน key → ค่ารุ่นเก่า = "ต้องตรวจใหม่" ไม่ถูกลบ); last-attempt แยกจาก last-success (SERVICE_UNAVAILABLE ไม่ทับหลักฐาน VERIFIED เดิม)
- Autofill: แถว HO → เสนอเข้า `Company.addressJson`; แถวสาขา → เสนอเข้า `Branch.addressJson` ของสาขานั้น**เท่านั้น**; ตามคำอธิบาย output ของ [RD VAT Service](https://rd.go.th/42535.html) `businessFirstDate` คือ **วันที่กรมสรรพากรอนุมัติให้เป็นผู้ประกอบการจดทะเบียน VAT** จึงเสนอเป็นค่าเริ่มต้นของ `effectiveFrom` §5.2 ได้ **เฉพาะคำตอบ REGISTERED** (ห้ามใช้เป็นวัน NOT_REGISTERED/เลิกจด); **ทุกกรณีเป็น suggestion ที่ผู้ใช้ต้องยืนยันก่อนเขียน ไม่มี auto-write**

## 10. Permissions

| การกระทำ | permission | หมายเหตุ |
|---|---|---|
| อ่าน identity (masked) | `company.setup.read` | เดิม (LOW, แจกกว้าง) |
| อ่าน identity เต็ม + revision snapshots | **`company.legal_identity.read` (MEDIUM ใหม่)** | QP1 |
| แก้ identity + verify TIN | **`company.legal_identity.manage` (HIGH ใหม่)** | pack ungated ใหม่ `pack.company.legal_identity.manage`; grants ตาม QP2 (OWNER implicit) |
| อ่าน/ตอบ VAT registration | `company.vat_registration.read` (LOW) / `.manage` (HIGH) — ใหม่ | pack ungated ใหม่ `pack.company.vat_registration.manage` (+read) ตาม permission-matrix บรรทัด compiler; **แก้บรรทัด ~353 ของ permission-matrix.md ให้ตรง** ; grants: OWNER, ACCOUNTANT (manage+read), FINANCE (read); MANAGER = QP2 |
| จัดการสาขา | `company.branch.read/manage` | เดิม |
| แก้เอกสาร DRAFT | `accounting.document.update` | มีแล้ว (`pack.billing.operate`) — ไม่ให้สิทธิ์แก้หลักฐานของ issued document |
| เพิ่ม/แก้ buyer evidence revision ของ issued TAX_INVOICE | **`accounting.tax_document_buyer_evidence.manage` (HIGH ใหม่) + `accounting.tax_invoice.issue`** | key ใหม่ต้อง (1) ลงทะเบียนใน `permission-registry.ts` ก่อน มิฉะนั้น compiler ทิ้งเป็น `unknown` (2) อยู่ใน **`pack.tax_invoice.issue`** — ไม่ใช่ `pack.billing.issue` ซึ่ง preset อย่าง `tpl.retail.cashier`/`tpl.ecom.order_ops` ถือโดยตั้งใจไม่ให้แตะใบกำกับ (3) **เพิ่ม grant ให้ FINANCE อย่างชัดแจ้ง** (รายการ FINANCE เป็น enumerated list — key ใหม่ไม่ตกมาเอง; OWNER ได้อัตโนมัติจาก `COMPANY_PERMISSION_KEYS`) และอัปเดต parity test 6.3; audit HIGH; ไม่แจก `pack.billing.operate` |
| ออกเอกสาร | `accounting.document.issue` + type-specific: `accounting.tax_invoice.issue` / `accounting.credit_note.issue` / `accounting.debit_note.issue` | Release A = would-deny log-only + report; **Release B1 เป็นต้นไป = enforce 403 unconditional ถาวร (ไม่ผูก gate)**; CN/DN keys อยู่ใน `pack.billing.issue` แล้ว; `tax_invoice.issue` แยกโดย design — QD2 ตัดสิน grant/ยอมรับจาก report จริง |
| generator + resolver + reconciliation reports | **`system.identity_reconciliation.resolve` (CRITICAL ใหม่)** | แก้ legal identity/VAT/branch ข้ามบริษัท — สูงกว่า scope ของ `system.company_onboarding.create` (HIGH สำหรับสร้างบริษัท); grant เฉพาะ system-admin role |

Prefix-filter proof test บังคับ: ปิด `thai_tax` แล้ว key `company.*` ทุกตัวอยู่ครบ (matrix ระบุ PREFIX filtering ไม่จับ `company.vat_registration.*`)

## 11. UX Wizard — 5 ขั้น

Route `/settings/company-identity` (settings menu section primary เหนือ accounting-tax-setup; binding `entitlementKeys: []` gate `company.setup.read`); stepper 1–5 + สถานะต่อขั้น; ย้อน/ถัดไป; **บันทึกจริงต่อขั้น**; resume = ขั้นแรกที่ยังไม่ผ่าน (ขั้น 4 ใช้ `promptResolved`); ทุก error ผ่าน `apiErrorMessage`; loading skeleton; error banner + retry; ไม่มี dead link
**changeKind ของ wizard**: ขั้น 1–3 ส่ง `changeKind=INITIAL_CAPTURE` เสมอตราบที่ capture window ยังเปิด (§4.3(1)) — UI ไม่ถามผู้ใช้เรื่อง changeKind/effectiveFrom/correctionReason เลย; ผู้ใช้ที่กลับมาแก้ **หลัง** window ปิดจะเห็นฟอร์มแก้ไขคนละหน้าจอกับ wizard ที่ **เสนอเฉพาะ changeKind ที่ server จะรับจริงตามสถานะของบริษัทและ field นั้น** (คำนวณจาก readiness/latch: บริษัทที่ติด authoritative latch หรือ field ที่ติด per-field latch → เหลือ LEGAL_CHANGE พร้อมวันมีผล; ที่ยังไม่ติด → เลือก CORRECTION พร้อมเหตุผลได้; `taxId` ไม่มีตัวเลือก CORRECTION เลย) — ห้ามแสดงตัวเลือกที่จะถูกปฏิเสธด้วย `identity_change_kind_not_allowed`
- **ขั้น 1 เลขผู้เสียภาษี+ชื่อ**: input 13 หลัก normalize; checksum มอด 11 = warning ไม่ block (Q1); ปุ่มตรวจ (ซ่อนเมื่อ mode=off) → ผล 4 แบบ: พบทะเบียน VAT (ชื่อ/ที่อยู่+รายการสาขา เลือกใช้ได้) / เลขถูกต้องแต่ไม่พบทะเบียน VAT / ไม่พบเลขนี้ / บริการไม่พร้อม-บันทึกได้; badge VERIFIED ผูก HMAC+keyVersion กับเลขปัจจุบัน; CTA `บันทึกและไปต่อ: ที่อยู่`
- **ขั้น 2 ที่อยู่จดทะเบียน**: ฟิลด์แยกตามโครง §4.1; จังหวัด dropdown; prefill จาก registry เมื่อผู้ใช้เลือก; CTA `บันทึกและไปต่อ: สาขา`
- **ขั้น 3 สถานประกอบการ**: read-only list แยกกลุ่ม "ภ.พ.20" / "operational" + deep link `จัดการสาขา` (หน้า branch settings ที่เพิ่ม `addressJson`+`isVatEstablishment`); **เงื่อนไขผ่านขั้น = HO establishment '00000' ครบที่อยู่เท่านั้น** (สอดคล้อง §8.1 per-branch — สาขาอื่นที่ไม่ครบเป็น warning/informational ไม่ block การไปขั้น 4); CTA `ไปต่อ: สถานะภาษีมูลค่าเพิ่ม`
- **ขั้น 4 สถานะ VAT**: 3 ตัวเลือก + effectiveFrom (บังคับทั้ง REGISTERED/NOT_REGISTERED) — เมื่อเลือก REGISTERED ช่องนี้ label **"วันที่เป็นผู้ประกอบการจดทะเบียน (ตาม ภ.พ.20)"** และ prefill `businessFirstDate` ได้พร้อมป้าย "ข้อมูลจาก RD — โปรดเทียบ ภ.พ.20"; เมื่อเลือก NOT_REGISTERED ใช้ label วันเลิกจด/วันที่ไม่มีสถานะตามหลักฐานของผู้ใช้และ **ห้าม prefill จาก `businessFirstDate`**; ผู้ใช้ต้องกดยืนยันก่อนบันทึก; read-only + บอก role เมื่อไม่มีสิทธิ์; CTA `บันทึกและไปต่อ: ตรวจทาน`
- **ขั้น 5 ตรวจทาน**: **สองบรรทัดแยกชัด** — บรรทัดแรก "ข้อมูลผู้ขายครบ (HO): ✅/⚠️ รายข้อ"; บรรทัดสองมี **สามสถานะ** ตาม readiness ที่ได้รับจริง (§4.4): `readiness.vat` present → "ออกใบกำกับภาษีได้: ✅" หรือ "✗ เพราะ [ยังไม่จด VAT | ยังไม่ยืนยันสถานะ]"; **`readiness.vat` absent (ไม่มี `company.vat_registration.read`) → "คุณไม่มีสิทธิ์ดูสถานะภาษีมูลค่าเพิ่ม — ติดต่อ [role]"** ห้ามเดาหรือแสดง ✗; ส่วน "ภาพรวมทุกสาขา" เป็นข้อมูล ไม่ใช่เงื่อนไข; ลิงก์ accounting-tax-setup เฉพาะเมื่อเมนู visible จริง มิฉะนั้น honesty copy
- **ปุ่มยืนยันท้ายขั้น 5** `ยืนยันข้อมูลบริษัท` → ปิด capture window (`legalIdentityCaptureCompletedAt`, write-once) แล้วแจ้งว่า "การแก้ไขหลังจากนี้ต้องระบุว่าเป็นการแก้คำผิดหรือการเปลี่ยนแปลงตามกฎหมาย"; ยังไม่กดก็ใช้งานระบบได้ปกติ (window เปิดค้างไม่ block อะไร)
- นอก wizard: หน้า `AccountingTaxSetupPage` (ขั้น prerequisites ของ wizard บัญชี-ภาษีเดิม) เพิ่มแถวเช็ค "Step 0 ข้อมูลบริษัทและภาษี" ลิงก์มาที่ wizard นี้เมื่อ readiness ไม่ผ่าน

## 12. Validation table

| ฟิลด์/การกระทำ | client | server (ซ้ำเสมอ) |
|---|---|---|
| taxId | 13 หลักตัวเลข; checksum มอด 11 → warning | normalize digits; ไม่บังคับ unique ข้ามบริษัท |
| registeredName | ไม่ว่าง ≤255 | trim |
| addressJson | บังคับทุกช่องยกเว้น line2; postal 5 หลัก | โครง §4.1 เท่านั้น; reject key แปลก |
| changeKind | LEGAL_CHANGE ต้องมี effectiveFrom; CORRECTION ต้องมี reason+note | กติกา §4.3 ครบ (latch/monotonic/taxId) + **`effectiveFrom ≤ today`** |
| taxBranchCode | 5 หลัก; HO='00000' | coupling `isVatEstablishment` §6.1 + duplicate check §6.3 |
| VAT effectiveFrom | บังคับทุกสถานะ | interval rules §5.3 |
| buyer draft | ตาม §7.1; แก้ได้เฉพาะ DRAFT | เหมือน + CAS + ABAC |
| buyer evidence revision | typed snapshot v1 + evidenceRef; DATA_CORRECTION ต้อง note | dedicated HIGH permission + route/branch ABAC + expectedCurrentRevision + server fingerprint |
| issue body | V2: commandId + expectedUpdatedAt; legacy `{}` เฉพาะ A–B1 | server fingerprint + compatibility telemetry; B2 บังคับ V2 |
| ทุก write | — | guard → validate → CAS (ตามชนิด: `legalIdentityVersion` / `expectedVersion` / `expectedUpdatedAt`) → เขียน → audit |

### 12.1 Canonical fingerprint + civil date (normative — ใช้ร่วมทุก command)

**Fingerprint** = `sha256hex(JSON.stringify(canonical))` โดย `canonical` = object ที่ (ก) เรียง key จากน้อยไปมากแบบ byte-order ทุกชั้น (ข) เขียน `null` ออกมาตรง ๆ ห้ามละ key (absent ≠ null ต้องแปลง absent → null ก่อน hash) (ค) civil date เป็น `YYYY-MM-DD` (ง) ตัวเลขเงิน/Decimal เป็น string ตามสเกลที่ตกลงไว้ (จ) ไม่มี field ที่ผันแปรตาม request (requestId/timestamp/actor) เว้นแต่ระบุไว้ · **field list ต่อ command ตรึงตลอดอายุฟีเจอร์** (เปลี่ยน = เปลี่ยน fingerprint version ใหม่พร้อม migration):

| command | field ที่เข้า hash |
|---|---|
| VAT `UPSERT_FACT` | `{companyId, kind:'UPSERT_FACT', status, effectiveFrom, replaceFactId}` |
| VAT `CANCEL_FUTURE` | `{companyId, kind:'CANCEL_FUTURE', replaceFactId}` |
| issue (V2 + legacy) | `{companyId, documentId, expectedUpdatedAt, sellerEstablishmentBranchId}` |
| buyer evidence revision | `{companyId, documentId, expectedCurrentRevision, changeKind, buyerSnapshot (canonical v1), evidenceRef, note}` |
| `resolveTaxId` | `{companyId, itemId, chosen, manualValue, resolutionKind, effectiveFrom, note, evidenceRef}` |
| `resolveBranchDuplicate` | `{companyId, itemId, action, targetBranchId, newCode}` |
| `resolveVatHint` | `{companyId, itemId, action, effectiveFrom, evidenceRef}` |
| `repair-tax-id` (หลัง B2) | `{companyId, manualValue, note, evidenceRef}` — `expectedLegalIdentityVersion` เป็น CAS token จึงไม่เข้า hash ตามกติกาท้ายตาราง |
| item `sourceFingerprint` | ค่าที่ generator อ่านจริง: TAX_ID `{companyTaxId, profileTaxId}` · BRANCH_DUP `{taxBranchCode, branchIdsSorted}` · VAT_HINT `{vatRegistered, vatEffectiveDate}` |

**กติกาเรื่อง CAS token ใน fingerprint**: token ที่ *นิยามเจตนา* เข้า hash (issue ใช้ `expectedUpdatedAt` — "ตั้งใจออกเอกสารเวอร์ชันนี้", buyer evidence ใช้ `expectedCurrentRevision`); token ที่เป็น *ตัวตรวจชนเฉย ๆ* ไม่เข้า hash (VAT `expectedVersion`, resolver `expectedSourceFingerprint`) — สองอย่างนี้ตรวจแยกหลัง replay lookup เพื่อให้ retry เจตนาเดิมยัง replay ได้แม้ version ขยับ

**Civil date** — ใช้ helper เดียว (`packages/contracts/src/civil-date.ts`): wire เป็น `YYYY-MM-DD` เสมอ · เขียนลงคอลัมน์ `@db.Date` โดยแปลงเป็น `Date` ที่ **UTC midnight** (ห้ามใช้ local midnight — จะเลื่อนวันสำหรับ Asia/Bangkok) · `today` = วันปฏิทินของ `now()` ที่เรนเดอร์ใน `Company.timezone` · กติกา §5.3(5) `F ≤ today+365` และ monotonic §4.3(2) ใช้ `today` ตัวนี้ · **fence §4.3(7) เรียก projector §8.3 ด้วย `civilDate(document.documentDate, Company.timezone)`**; `lastLegalChangeEffectiveDate` ใช้เฉพาะกฎ monotonic ไม่ใช่ตัวเลือก snapshot (เอกสารเก็บเป็น timestampจึงห้ามเทียบ Date object ตรง ๆ)

## 13. Launch & enforcement (C1/C2)

- Gate row: `cap.company_tax_identity/TAX_INVOICE_ISSUANCE_GATE` — ORDINARY, **seed CLOSED**, synchronous (แถว sync ที่ 4; catalog 20→21)
- **C1 (deploy, gate ยัง CLOSED)**: catalog code+JSON+MD+drift fixtures · `SYNCHRONOUS_ROWS` + health tracks + A5 evidence artifact (คนละความหมายกับ plan A5) · runbook/fixed-count/preflight · **เปิด observation ที่ issue evaluator ซึ่ง deploy แบบ dormant ตั้งแต่ A** (aggregate, tenant-anonymous) · synchronous journey registration/result — ประสาน decoupling workstream ก่อน merge
- **Evidence window**: observation ผ่าน production call site **≥2 UTC hours** + journey pass + remediation readiness + blocked-drafts + **legacy buyer coverage valid 100% หรือ owner-signed acceptance ของ residual CN/DN ที่จะถูก block** + human evidence: automated accessibility + moderated usability 2 รอบ × 5 คนจริง (post-fix ≥4/5 unaided ต่อ critical task, zero severe false beliefs; บันทึกจริง ห้าม agent แทน)
- **C1 NULL-cohort cutover**: แถว `AccountingDocumentIssueCommand` ที่สร้างช่วง A–B1 มี `launchEntriesJson` ที่ยังไม่มี `cap.company_tax_identity` และถูก mark `preGateCutoff: true` — C1 ต้องตรึง cutoff timestamp แล้วบันทึกว่า cohort ก่อน cutoff อยู่ภายใต้ policy "gate ยังไม่ถูก register" **ห้าม back-stamp generation ปัจจุบันลงแถวเก่า**; หลัง cutoff ทุกแถวใหม่ต้องมี entry ครบ
- **C2**: owner OPEN ตาม runbook (Q3) — spec และ plan ใช้ contract นี้ตรงกัน: C1 คือ deploy, C2 คือการเปิด
- **C2 OPEN เป็น per-build และยังมี deploy blocker ที่ต้องปิดก่อน OPEN**: guard ตรวจ attestation ของ build ที่กำลัง serving และ bootstrap ไม่ re-attest human lineage; ขณะเดียวกัน controller ปัจจุบันรับ `buildReleaseId` เป็น expected value แต่ derive build จริงจาก process ที่รับ request จึง **ห้ามใช้คำสั่งผ่าน load balancer ระหว่าง mixed-build rollout เป็น acceptance ของ build ใหม่** — อาจไปโดน build เก่าและกลายเป็น no-op ขณะที่ build ใหม่ตอบ 403
  ก่อน C2 decoupling workstream ต้องส่งมอบ exact-build acceptance path ที่ (ก) รันคำสั่ง authenticated-human เดิมบน incoming build identity ที่ server derive เอง ห้าม caller spoof actor/build (ข) ทำก่อน incoming build รับ tax-document traffic หรือมี traffic drain ที่พิสูจน์ว่าไม่มี mixed-build partial 403 (ค) รองรับ rollback ด้วย fresh acceptance ของ build ที่ย้อนกลับ และ (ง) health รายงาน `admitsRunningBuild` จาก predicate เดียวกับ guard; จนกว่าจะมี path+test นี้ **gate ต้องคง CLOSED และ C2 ห้าม OPEN**
- Error codes ทั้งหมดของฟีเจอร์ (15 ตัว — เข้า `CODE_LABELS` พร้อม copy ไทย): `company_tax_identity_incomplete` · `vat_registration_required` · `document_branch_not_tax_establishment` · `document_branch_required` · `buyer_tax_identity_incomplete` · `buyer_vat_status_confirmation_required` · `document_backdated_across_identity_revision` · `vat_deregistered_correction_requires_authority` · `vat_registration_future_fact_conflict` · `vat_registration_backdated_crosses_filed_period` · `vat_registration_contract_upgrade_required` · `tin_verification_unavailable` · `issue_command_conflict` (reuse commandId ผิด intent/เลข CANCELLED ใต้ key) · `branch_tax_code_duplicate` · **`identity_change_kind_not_allowed`** (changeKind ที่ส่งมาไม่ถูกกับสถานะ capture window/latch/field — response แนบ changeKind ที่ถูกต้อง) — รวม **15 ตัว** (สิทธิ์ขาด = 403; CAS = 409 ปกติไม่มี code)

## 14. Feature-off / baseline matrix

| กรณี | ผล |
|---|---|
| `thai_tax` OFF | wizard + `/vat-registration` + identity ครบทุกขั้น (packs ungated; prefix proof); ขั้น 5 ไม่มีลิงก์ตาย (honesty copy) |
| `sales_documents` OFF | wizard ปกติ; ไม่มีเอกสารให้ตรวจ |
| `double_entry_ledger` OFF | wizard ปกติ; chart reader ไม่ถูกเรียก |
| `company_settings` | ปิดไม่ได้ (platform invariant — `platform_feature_not_disableable` ซึ่งเป็น code เดิมของ decoupling อยู่นอกรายการ 15 ตัวของฟีเจอร์นี้) |
| ไม่กรอกอะไร + gate CLOSED (หลัง Release A) | พฤติกรรมภายนอกเท่า baseline: ไม่มี readiness block, ไม่มี permission เปลี่ยน (A = log-only), เลขเท่าเดิม; legacy issue caller ยังทำงาน; explicit field ใหม่เท่านั้นที่ validate เพิ่ม |
| หลัง Release B1, gate ยัง CLOSED | type-permission 403 ตาม QD2; readiness ยังไม่ block; readers เป็น Company-first แต่ dual-write mirror ต่อระหว่าง N/N-1 |
| หลัง Release B2 | ทุก serving task ≥B1; mirror freeze และ issue body V2 required; ไม่มี A reader/legacy caller เหลือตาม proof |
| gate OPEN แล้ว emergency CLOSE | readiness-block หยุดทันที; **สิทธิ์ไม่เปลี่ยน**; ไม่มีงานค้าง (ตรวจ synchronous); ไม่มี RUNOFF rows (platform-core ไม่ sellable) |
| ปิด `thai_tax` หลังกรอกครบ | ข้อมูล identity/VAT คงอยู่และอ่านได้; tax workspace หายตามปกติ; WHT handoff ทำงานต่อ (ungated เดิม) |
| สถานะ VAT = UNKNOWN | ไม่มีผู้อ่าน boolean ตรงหลัง Release B1 — ผลเฉพาะ readiness/wizard |

Honesty compliance: ทุกหน้าจอใหม่ใช้ `apiErrorMessage` seam เดียว; ไม่รวม `feature_not_enabled` กับ `feature_temporarily_unavailable`; copy ไม่สั่งการที่ทำไม่ได้; code แปลก pass-through

## 15. Audit & privacy

- Identity PATCH: CRITICAL; metadata ใช้ **safe keys**: `subjectLast4Prev/Next` (เลขภาษี), `addressFieldsChanged[]`, `registeredNameChanged: boolean`, `changeKind` — ไม่มีค่าเต็ม
- VAT PUT: HIGH `{statusPrev, statusNext, effectiveFrom}`; verify-tin: MEDIUM `{result, subjectLast4}`; PATCH เอกสาร: MEDIUM; buyer evidence revision (§7.3): HIGH `{documentId,revision,changeKind}` ไม่มี snapshot ดิบ; resolver: CRITICAL `{kind,itemId,action,resolutionKind}`; issue: HIGH/CRITICAL **ใน txn** (§8.3)
- Sanitizer: เพิ่มเป็น **exact-key set `{taxId, addressJson}`** (ห้าม append regex substring — จะ redact `subjectLast4*` เอง)
- DENIED audit: เฉพาะ ABAC ใน use case (`assertRouteCompany`, branch scope §6.4); permission guard 403 ไม่มี audit (พฤติกรรมระบบเดิม)
- Reconciliation/remediation/blocked-drafts reports: เก็บ masked (last4/จังหวัด); ค่าเต็มดูผ่านสิทธิ์ read ปกติ
- Revision snapshots: อ่านเต็มต้อง `company.legal_identity.read` (§4.2)
- Rate limit ตรวจ RD: 5/นาที/บริษัท; AI tool (`company.get_current_context`) คงพฤติกรรมเดิมชั่วคราว — อยู่ใน QP1

## 16. Reconciliation resolver (per-kind)

`CompanyIdentityReconciliationItem`: `kind ∈ {TAX_ID, BRANCH_DUP, VAT_HINT}` · `companyId` · **`discriminator String`** · `sourceState` · `payloadMaskedJson` · **`sourceFingerprint`** (hash ค่าจริงตอน generate — §12.1) · `status PENDING|RESOLVED` · `resolutionCommandId` · `resolutionJson` · `resolvedByUserId/At`; TAX_ID sourceState = `ALIGNED|PENDING_ONE_SIDED|PENDING_CONFLICT`
**Identity ของแถว: partial unique `(companyId, kind, discriminator) WHERE status='PENDING'`** (raw SQL เหมือน partial unique อื่นใน §6.3 — Prisma schema ประกาศ partial index ไม่ได้) โดย `discriminator` = `'TAX_ID'` / `'VAT_HINT'` (หนึ่งแถวต่อบริษัท) และ = `taxBranchCode` ที่ซ้ำ สำหรับ `BRANCH_DUP` (หลายแถวต่อบริษัทได้) — เหลือ **PENDING ได้มากสุดหนึ่งแถวต่อ key แต่ RESOLVED สะสมได้ไม่จำกัด**; generator upsert เฉพาะแถว PENDING; **แถว RESOLVED ไม่ถูกแตะตลอดกาล**: rerun ที่พบว่า source ผิดอีกครั้ง (fingerprint ไม่ตรงกับแถว RESOLVED ล่าสุดของ key เดียวกัน) จะ **insert แถว PENDING ใหม่** ไม่ใช่ reopen — ประวัติการ resolve จึงเป็น append-only จริงและ AC28 ตรวจได้

**Executable internal API** (ทุก route guard `system.identity_reconciliation.resolve`, internal system-admin surface): `POST /v1/system/identity-reconciliation/companies/:companyId/generate` (upsert item เท่านั้น ไม่แก้ domain) · `GET /v1/system/identity-reconciliation/items?status=&kind=&companyId=&cursor=&pageSize=` (`pageSize≤200`) · `GET /v1/system/identity-reconciliation/items?...` คืน `legalIdentityVersion` ของบริษัทมาด้วยสำหรับ item ชนิด TAX_ID (เป็นแหล่ง CAS token ของ `repair-tax-id`) · `POST /v1/system/identity-reconciliation/items/:itemId/resolve-tax-id|resolve-branch-duplicate|resolve-vat-hint` · **`POST /v1/system/identity-reconciliation/companies/:companyId/repair-tax-id`** (เส้นซ่อมหลัง B2 — ไม่มี item, provenance ใช้ `repairCommandId`) · `GET /v1/system/identity-reconciliation/reports/:reportKey`; ops runner เดิน company cursor จาก system company list และเก็บ checkpoint นอก command — ไม่มี unbounded all-company transaction

Commands: ทุกตัวเทียบ `expectedSourceFingerprint` กับค่าปัจจุบัน มิฉะนั้น 409 stale; `commandId` replay-safe; lock item/company → lookup command → CAS → mutation + mark RESOLVED + CRITICAL audit **ใน txn เดียว** + postcondition:
- `resolveTaxId {chosen: COMPANY|PROFILE|MANUAL, manualValue?, resolutionKind: LEGAL_CHANGE|DATA_RECONCILIATION, effectiveFrom?, note, evidenceRef?}` → เส้นทางเทียบ Profile ใช้ได้ถึง B1 (หลัง B2 เหลือโหมดซ่อม DATA_RECONCILIATION ตามท้าย §4.6); เขียน winner ลง `Company.taxId` และ `CompanyTaxProfile.upsert`; LEGAL_CHANGE ต้อง effectiveFrom และสร้าง fence; DATA_RECONCILIATION ต้อง item/provenance + note + evidenceRef, append `RECONCILIATION_CORRECTION` และไม่สร้าง fence; ห้ามใช้ CORRECTION ปกติแก้ taxId; postcondition Company/Profile ตรง winner
- `resolveBranchDuplicate {action: ARCHIVE|EDIT_CODE, targetBranchId, newCode?}` — postcondition: ไม่มี duplicate คู่นั้น
- `resolveVatHint {action: CONFIRM_FACT|DISMISS_UNKNOWN, effectiveFrom?, evidenceRef?}` → CONFIRM สร้าง fact ผ่าน service §5 (command ปกติ); DISMISS = บันทึกว่า hint ใช้ไม่ได้ สถานะคง UNKNOWN
**Staleness controls**: (ก) Release A ปิดทางเกิด conflict ใหม่ — identity PATCH dual-write mirror, branch write ถือ advisory lock §6.3, VAT ผ่าน command; (ข) generator read-only operational command รันซ้ำท้าย ops window แล้ว resolve จนศูนย์; (ค) **B signed preflight อยู่นอก migration** ใต้ release-operation lock นับ conflict สดทั้ง 3 ชนิด+branch duplicate — ≠0 หยุดก่อน `migrate deploy`; (ง) constraint migration ตรวจซ้ำใน transaction เดียวกับ ADD; หาก fail ให้แก้ข้อมูล/SQL และใช้ Prisma failed-migration recovery แบบ `resolve --rolled-back` หลังยืนยัน rollback เท่านั้น — **ห้าม `resolve --applied`**

## 17. Reports (6 ฉบับ)

1. **Custom-role impact** (Release A): สองส่วน — (ก) **static**: role/บริษัทที่ถือ `accounting.document.issue` โดยขาด type key ใด ๆ ใน {tax_invoice, credit_note, debit_note}.issue (รวม raw-key roles) คำนวณสดจาก permission registry + role grants; (ข) **observed**: would-deny จริงจากตารางใหม่ **`AccountingIssueAuthzObservation(companyId, roleKey, documentType, missingPermissionKey, hourBucketUtc, count)` + `@@unique([companyId, roleKey, documentType, missingPermissionKey, hourBucketUtc])`** — เมื่อ type-permission ไม่ผ่านช่วง log-only ให้ upsert เพิ่ม count **ใน transaction สั้นของตัวเอง แยกจาก preflight/issue txn** (preflight ยังคงเป็น read-only ต่อ domain state ตาม §8.3 — ตัวนับนี้เป็น telemetry ไม่ใช่ domain) และ **ห้าม throw/ห้ามเปลี่ยนผลลัพธ์ของ request**; ไม่ audit ตาม §15; เก็บ companyId/roleKey ได้เพราะเป็นตาราง internal ของ system-admin ไม่ใช่ launch observation bucket ที่ต้อง tenant-anonymous; อ่านผ่าน `GET reports/:reportKey` §16 → อินพุตของ QD2
2. **Reconciliation status** (3 ชนิด): PENDING/RESOLVED รายบริษัท (masked)
3. **Blocked-drafts**: draft เอกสารตระกูลภาษีที่จะติด fence/readiness เมื่อ OPEN
4. **Remediation readiness**: `sellerIdentityCompleteHO`/`taxInvoiceEligible` สดรายบริษัท + รายสาขา establishment ที่ยังไม่ครบ + **รายการ REGISTERED fact ที่ `effectiveFrom` ย้อนก่อน `Company.createdAt` (หรือก่อนงวดภาษีแรกที่ระบบมี) พร้อม `source`/`answeredAt`** ให้ owner review (ก่อน C2)
5. **Identity captures & corrections** (§4.3(5)): revision ชนิด `INITIAL_CAPTURE` และ `CORRECTION` ทั้งหมด (field ที่แก้, reason, actor, เวลา, สถานะ capture window ตอนนั้น) สำหรับ owner review — ทำให้ช่วงเก็บข้อมูลไม่กลายเป็นช่องแก้ซ้ำโดยไม่มีร่องรอย
6. **Legacy TAX_INVOICE buyer coverage** (§7.3): issued TAX_INVOICE ทุกใบที่ `validBuyerSnapshotV1` ไม่ผ่าน + latest `AccountingDocumentBuyerEvidenceRevision`/validity/reason; ใช้เป็น C2 gate หรือ residual-risk acceptance

## 18. Acceptance criteria (เต็ม — ไม่มีการอ้างเวอร์ชันก่อน)

1. **Wizard**: 5 ขั้นจบในเส้นทางเดียว บันทึกต่อขั้น **โดยขั้น 1–3 ส่ง INITIAL_CAPTURE และไม่ต้องกรอก effectiveFrom/reason** (ขั้น 2 หลังขั้น 1 ต้องผ่าน — เป็น regression test ของ capture window); refresh → resume ขั้นแรกที่ไม่ผ่าน; "ไม่แน่ใจ" → resume ขั้น 5 พร้อม warning ไม่วนกลับ; ขั้น 5 บรรทัดสองตรงข้อมูลจริงเสมอ (NOT_REGISTERED ⇒ "ข้อมูลครบ ✅ / ออกใบกำกับ ✗")
2. **GET identity**: ตัด section ตามสิทธิ์; masked ภายใต้ `company.setup.read`; เต็มเมื่อมี legal read; **section ที่ไม่มีสิทธิ์ = key หายจาก DTO (absent) ไม่ใช่ null/object เปล่า** และ readiness flag/reason ไม่รั่ว; ผู้ใช้ที่ไม่มี `company.vat_registration.read` เห็นขั้น 5 เป็นสถานะที่สาม ไม่ใช่ ✗; **block `control` มากับ `company.setup.read` เสมอ (version/window/latch booleans) และไม่มีเหตุผล/วันที่ของ latch รั่วเมื่อไม่มี `company.legal_identity.read`**; PATCH/complete-capture คืน version กลับมาให้ wizard เดินต่อได้โดยไม่ refetch
3. **CC4 matrix**: echo tuple no-op · legacy change → contract-upgrade error · server canonical fingerprint replayผลเดิม · client ส่ง fingerprint ถูก reject เป็น unknown field · commandId reuse ต่าง payload → reject · expectedVersion stale → 409 · ranges/replace/cancel/seed ครบ · **backdated ทับงวดที่ `isPeriodLocked` → 422 (AMENDED = ไม่ล็อก); เมื่อ `thai_tax` ปิด/ไม่มี TaxPeriod ให้บันทึกได้ และ TAX_INVOICE legacy ไม่ถูกใช้เป็นหลักฐาน VAT**
4. **Time-shift (ไม่มี PUT)**: future fact ถึงวัน → accessor เปลี่ยน; fact expire → UNKNOWN; `GET tax/profile.vatRegistered` (stored bit) **ไม่เปลี่ยนเอง** — tri-state เปลี่ยน
5. **Chart parity** (Release B1): บริษัทมี fact REGISTERED ⇒ `taxConfigurationRequired` เท่าพฤติกรรม `vatRegistered:true` เดิม; UNKNOWN ⇒ เท่า `false` เดิม; deploy หลัง VAT-hint RESOLVED เท่านั้น
6. **Feature-off**: ปิด `thai_tax` แล้วทุก endpoint/ขั้นของฟีเจอร์ทำงาน (prefix-filter proof test); ไม่มี dead link
7. **Atomicity**: ทุก 403/409/422 รวม entitlement/gate/build/CAS/readiness → sequence ไม่ขยับ/ไม่มี DocumentNumber; crash-injection → ไม่มี ISSUED ที่เลขไม่ COMMITTED หรือขาด outbox/audit/command result; retry หลัง transient สำเร็จ; CANCELLED ใต้ key ใหม่ → issue-command conflict
8. **Numbering baseline**: เอกสาร null-branch → GLOBAL sequence ต่อเนื่องเลขเดิม; เอกสารมี branchId ที่บริษัทตั้ง branch sequence ไว้ → sequence เดิมของสาขา; **provisioning เดิมไม่เปลี่ยน — รวม lazy-create ต่อ (scope, period) ที่ baseline ทำอยู่แล้ว (§2 ข้อ 20); seller establishment ไม่มีผลต่อ scope/provisioning ใด**; เท่าพฤติกรรมก่อน release ทุกกรณี
9. **Seller establishment**: precedence §6.4 ครบ (explicit → doc.branchId-ถ้า-establishment → HO → 422); WAREHOUSE/ONLINE ไม่ผ่าน (`document_branch_not_tax_establishment`); เลือก branch นอก scope → 403 + DENIED audit; ไม่มี establishment ใน scope → 422 `document_branch_required`; ตรวจซ้ำใน txn จับการแก้ขนาน
10. **Authz**: Release A log-only + report ครบ; Release B1 → type 403 unconditional; command replay หลังถอน type permission/branch scope ถูกปฏิเสธ; buyer evidence ต้อง dedicated HIGH key ไม่ใช่ document.update; FINANCE parity เดิมผ่าน
11. **Buyer**: UNKNOWN → 422 confirmation; VAT_REGISTERED+isForeign → บังคับเลขไทย+สาขา; draft รับได้ทั้ง create และ PATCH; PATCH: DRAFT เท่านั้น + CAS + `assertRouteCompany` + branch scope + audit MEDIUM; freeze draft>master; CN/DN ใช้ snapshot ต้นฉบับ; หลัง issue immutable
12. **CN/DN precedence**: deregistered-หลังต้นฉบับ → `vat_deregistered_correction_requires_authority` (ไม่ใช่ `vat_registration_required`)
13. **Fence**: LEGAL_CHANGE monotonic **และ `effectiveFrom ≤ today` (future-dated ถูกปฏิเสธ)**; CORRECTION แก้ taxId ไม่ได้; per-field latch; **INITIAL_CAPTURE ผูกกับ capture window (ไม่ใช่ version 0)**; authoritative latch write-once; RECONCILIATION_CORRECTION มีเฉพาะ route ของ §16 (resolver/repair) และไม่สร้าง fence; revision append-only
14. **Resolver**: generator read-only; internal routes เรียกได้จริง/paginated; 3 kinds idempotent; stale fingerprint 409; DATA_RECONCILIATION ไม่ปลอม legal date; postcondition ผ่าน; **`repair-tax-id` หลัง B2 ทำงานได้จริงโดยไม่ต้องมี item (provenance = repairCommandId) และไม่สร้าง fence — replay ด้วย commandId เดิมคืนผลเดิม**; B preflight conflict fixture หยุดก่อน migrate และไม่แตะ migration history
15. **Sync/seller**: `TaxEvent.sellerBranchCode` ถูกทั้งสอง path + void; `payeeSnapshot.branchCode` ไม่เปลี่ยนจาก baseline (direction test); hash รวม seller fields → supersede ทำงาน; ทุก path ใช้ frozen snapshots
16. **RD**: ทุก combination (TIN✓VAT✓ หลายสาขา / TIN✓VAT✗ / TIN✗ / timeout / oversize / circuit-open); autofill สาขาไม่แตะ company address; **`businessFirstDate` prefill effectiveFrom ได้เฉพาะ REGISTERED แบบ suggestion พร้อม label RD และต้องยืนยันก่อนเขียน; NOT_REGISTERED ไม่ถูก prefill**; HMAC keyVersion rotation → รุ่นเก่า = needs-refresh ไม่ถูกลบ; แก้เลข → ล้าง verification atomic
17. **Audit/privacy**: scan test — ไม่มีค่า taxId เต็ม/address ดิบใน audit metadata/reports; sanitizer exact-set ไม่ redact `subjectLast4*`; audit issue อยู่ใน txn (crash → ไม่มี ISSUED ที่ไร้ audit)
18. **Launch**: drift testsเขียว (counts 21, sync 4); journey result; C2 รวม human evidence + buyer coverage 100% หรือ signed residual acceptance; C1 CLOSED ไม่มี readiness block; **C2 เปิดไม่ได้จน exact-build acceptance path §13 ผ่าน test ว่า mixed-build rollout ไม่มี partial 403, incoming/rollback build ถูก attest จาก server-derived identity และคำสั่งผ่าน LB ระหว่าง mixed-build ถูกห้าม**
19. **Boot & registration**: spec files ใหม่ลงทะเบียนใน apps/api test list; swc build/test:boot ผ่าน; **`.pg.spec` ของฟีเจอร์นี้อยู่ใน script `test:tax-identity-pg` ซึ่ง CI รันบน PostgreSQL ที่ migrate แล้ว และ fail (ไม่ใช่ skip) เมื่อไม่มี DB — พิสูจน์ด้วยการรันโดยไม่ตั้ง `DATABASE_URL` แล้วต้อง exit nonzero**
20. **Command replay**: lost response → retry สำเร็จก่อน DRAFT-CAS แต่หลัง auth; payload ต่าง 409; concurrent duplicate ใช้ barrier ให้ทั้งคู่เห็น absent แล้วสุดท้ายได้ผลเดียวกัน ไม่มี P2002/IN_PROGRESS/stuck row — **ต้องผ่านทั้ง V2 และ legacy `{}` (legacy commandId derive จาก `(documentId, updatedAt)` จึงจับ lock เดียวกัน)**; **fresh/replay คืน `IssueAccountingDocumentResult` shape เดียวกันทุก field โดย `replayed=false/true` ตามลำดับ** — assert ด้วย e2e เดิมที่อ่าน `status==='ISSUED'` และ `documentNumber`
21. **Mirror ช่วง A–B1**: identity PATCH upsert Profile โดยไม่ทับ config; WHT ได้ค่าใหม่; B1 old/new tasks อ่านตรงกัน; B2 หยุด mirror หลัง serving-build proof
22. **CANCEL_FUTURE**: เรียกผ่าน union variant ได้จริง — ยกเลิก future fact → fact ก่อนหน้า restore เป็น open-ended; fingerprint replay ของ variant นี้คืนผลเดิม
23. **Concurrency × authority**: harness issue×disable พิสูจน์ entitlement lock; issue×OPEN/CLOSE พิสูจน์ gate lock; OPEN บน build ไม่มี attestation fail 403 ไม่ downgrade; lock order entitlement→gate→command เหมือนกันทุก path
24. **Legacy CN/DN**: invalid/legacy snapshot + ไม่มี valid evidence → 422; malformed evidence ถูก reject; **evidence ที่ `buyerSnapshot.id` ไม่ตรง `doc.counterpartyId` ถูก reject ด้วย 422 `buyer_tax_identity_incomplete` + `details.reason='counterparty_anchor_mismatch'` (ไม่ใช่ code ใหม่) — สลับผู้ซื้อไม่ได้ แต่เติมที่อยู่/สาขา/แก้ typo ของรายเดิมได้**; initial revision ปลดล็อก; DATA_CORRECTION revision แทนค่าผิดโดยไม่แก้/ลบประวัติ; report ใช้ validator เดียวกับ issue
25. **Authoritative latch**: latch persist หลัง trigger; เปลี่ยน taxId แล้วล้าง verification ไม่ล้าง latch; CORRECTION name/address ถูกปฏิเสธ **หลัง capture window ปิดแล้วเท่านั้น** ด้วย `identity_change_kind_not_allowed`; concurrent triggers set ค่าแรกครั้งเดียว; **ทุก trigger (TIN/VAT/issue) ต้องมี `sellerIdentityCompleteHO` — บริษัทที่ identity ว่างแล้ว verify TIN หรือออกใบกำกับ ไม่ set latch** (ทดสอบทั้งสองเคส + เคสครบเฉพาะสาขาแต่ HO ไม่ครบ = ไม่ set)
26. **N/N-1 issue contract**: old web `{}` ↔ A/B1 API ยัง issue ได้ atomic **และได้ body แบบเดิม (เอกสารเต็ม) ทั้ง fresh และ replay**; new web V2 ↔ old A API rollout path ไม่เสีย; **legacy double-submit พร้อมกันได้ผลเดียว (replay) ไม่ใช่ 500 และไม่แย่กว่า baseline ที่เคยได้ 409**; B2 reject legacy เฉพาะหลัง telemetry zero ตาม window
27. **Migration safety**: B conflict preflight คืน nonzero ก่อน `migrate deploy` และไม่มี failed `_prisma_migrations` row; constraint-failure drill บันทึก recovery `resolve --rolled-back` เท่านั้นหลัง verify rollback
28. **Reconciliation history**: one-sided/conflict ทุกแบบแก้ผ่าน resolver แล้วเพิ่ม version+revision+audit; generator rerun ไม่เปลี่ยน Company/Profile; DATA_RECONCILIATION ไม่ขยับ `lastLegalChangeEffectiveDate`; **rerun ที่เจอ drift หลัง RESOLVED สร้างแถว PENDING ใหม่ ไม่ reopen แถวเดิม** (partial unique เฉพาะ PENDING — ทดสอบว่ามี RESOLVED สองแถวขึ้นไปต่อ key ได้จริง); BRANCH_DUP หลายแถวต่อบริษัทอยู่ร่วมกันได้
29. **Capture window**: บริษัทที่เคยออกใบกำกับด้วย identity ว่าง ยังทำ wizard ครบ 5 ขั้นได้โดยไม่ต้องระบุ effectiveFrom และ **ไม่เกิด fence**; `POST …/identity/complete-capture` ปิด window (ซ้ำ = 200 no-op, identity ไม่ครบ = 422); ปิดอัตโนมัติเมื่อ issue เอกสารภาษีขณะ identity ครบ และเมื่อ LEGAL_CHANGE แรก; ปิดแล้ว INITIAL_CAPTURE → 422 `identity_change_kind_not_allowed` ถาวร; หลังปิด+latch → name/address ต้อง LEGAL_CHANGE และ UI ไม่เสนอ CORRECTION ให้เลือก
30. **Concurrency ของเลขเอกสาร**: ยิง issue พร้อมกัน **N=20** ชุด (documentType/บริษัท/งวดเดียวกัน + เคสขึ้นงวดใหม่ที่ต้อง lazy-create) **สำเร็จทุกชุด ไม่มี 500/P2034 หลุดออก API** ภายใน retry budget ที่กำหนด; ที่ระดับ concurrency สูงกว่า budget ผลลัพธ์ที่ยอมรับได้คือ 409 เท่านั้น (ห้าม 500) และต้องมี metric ให้เห็นอัตราการ retry; harness วัดว่าไม่มี network I/O ใน txn
31. **Availability vector**: แถว issue command เก็บ epoch/launch entries ครบตาม canonical sort; **ชุด gate ที่ถูก lock/อ่าน uncached ใน Stage 2 ตรงกับชุดที่เข้า hash ทุกแถว** (ปัจจุบัน 2 แถว); แถวช่วง A–B1 มี `preGateCutoff:true`; C1 reconcile cohort โดยไม่ back-stamp
32. **Fingerprint + civil date + as-of identity**: fingerprint ของ intent เดียวกันเท่ากันข้าม build/instance (golden vector ต่อ command type); absent vs null ให้ค่าเท่ากันหลัง normalize; `@db.Date` เขียน/อ่านไม่เลื่อนวันใน `Asia/Bangkok`; เอกสารเวลา 23:30 ของวันก่อนหน้าไม่ถูก block ผิด; **ช่วงปัจจุบันอ่าน Company จึงเห็น `repair-tax-id`/correction ล่าสุด, ช่วงก่อน boundary ถัดไปอ่าน revision ก่อน boundary, และก่อน boundary แรกที่ไม่มีฐาน → 422**

## 19. คำถามเปิด (10 ข้อ) + gating

| Q | เรื่อง | Block |
|---|---|---|
| QP1 | ยอมรับ default §15/§10: masked ภายใต้ setup.read + `company.legal_identity.read` ใหม่ + HMAC + ท่าที AI tool | **Release A** |
| QP2 | grants: `company.legal_identity.read|manage` (OWNER แน่; ACCOUNTANT?) และ MANAGER ควรได้ `company.vat_registration.read` ไหม | **Release A** |
| QC1 | ยืนยัน precedence §6.4 (รวม default HO และ 403/422 split) | **Release A** |
| QD2 | ตัดสินบน custom-role impact report: grant type keys ให้ role ไหน / ยอมรับตัดสิทธิ์ role ไหน | **ก่อน Release B1** |
| QB3 | เส้นทาง authority ม.86/11 ของ CN/DN หลังเลิกจด (นักบัญชี/ผู้เชี่ยวชาญ) | เส้นทาง CN/DN correction (ระหว่างรอ: block ตาม §8.2) |
| Q1 | fixture checksum (public juristic vectors เท่านั้น — ห้ามเลขบุคคลจริง) | ไม่ block (warning mode) |
| Q2 | egress rdws.rd.go.th UAT/prod | เปิด mode assist |
| Q3 | จังหวะ OPEN | **C2** |
| Q4 | UNKNOWN ควร trigger prompt ใน chart setup ไหม | ไม่ block (default = พฤติกรรมเดิม) |
| QM1 | วันเลิกใช้ stored bit `Company.vatRegistered` | เมื่อจะถอด bit |

## 20. Review log

- v1 (2026-08-03): P0×8 — source-of-truth, mirror ขัด CC4, สลับสาขาผู้ขาย/ผู้ซื้อ, readiness เกินจริง, RD service ผิดตัว, bootstrap lazy, permission bypass, snapshot นอก txn
- v2: P0×8 — ไม่ self-contained, mirror stale เมื่อเวลาเดิน + ไม่มี endpoint normative, interval/backdated, branch model+storage, buyer over-require, QD2 ขัด grants จริง, U5 evidence, CN/DN default-allow
- v2.1: P0×8 — buyer ไม่มี PATCH/ฟอร์ม/มิติ, wire เก่าคำนวณขัด CC4 + ไม่มี VAT-hint reconciliation, bind HO หลังจองเลข, authorization ผูก gate, address fallback ผิด + over-block, fence จาก initial capture, resolver ไม่มีจริง + `resolve --applied` อันตราย (drift healed), ตก U5 human-evidence
- v2.2: P0×7 — reserve ก่อนตรวจ + commit เลข/audit/outbox นอก txn, branchScopeKey บน sequence + GLOBAL, buyer UNKNOWN, resolver generic + release เดียว, fence ถูก CORRECTION ทับ, impact report ไม่ครอบ raw keys, false-ready + CN/DN precedence
- v2.3: P0×7 — **ไม่ self-contained (อ้าง v2.2 ที่ถูกลบ)**, ข้าม CANCELLED ชน unique + ไม่มี issue DTO, atomicity ไม่ครอบ audit/outbox, seller establishment ไม่มี write/UI contract, GLOBAL backfill ทับ branch sequences จริง, PENDING=0 stale ได้, Release C evidence วนกลับ, fence หลบผ่าน CORRECTION ชื่อ/ที่อยู่
- v2.4: P0×7 (state machine/rollout) — replay หลัง commit ชน DRAFT-CAS 409, Release A สร้าง Company↔Profile conflict ใหม่ + WHT อ่านเลขเก่าจนถึง B, CANCEL_FUTURE ไม่มี DTO path, issue ไม่มี final-mutation route lock (decoupling :92), generator ใน migration ไม่มี durable remediation, CN/DN จาก legacy TAX_INVOICE block ถาวร (snapshot เดิมไม่มี address/branch), per-field latch หลบได้ก่อน LEGAL_CHANGE แรก + P1 (memory ขัด spec, resolver permission ต่ำไป, wizard ขั้น 3 over-block, lazy-create เป็น baseline, PATCH allowlist, ลำดับ type-permission, composite FK)
- v2.5: P0×8 — issue-command ไม่มี linearization/fast replay auth, final-mutation ขาด entitlement+build authority, buyer evidence ใช้ draft permission/แก้ไม่ได้/ไม่มี validator, authoritative latch ไม่ durable, required issue body ขัด N/N-1, B freeze mirror ทำ WHT stale ระหว่าง bake, read-only assertion ใน migration สร้าง failed history, reconciliation ปลอม legal change/ข้าม revision + P1×6
- v2.6: ปิดรอบเจ็ด — command lock + COMPLETED-only registry; canonical entitlement→gate→command lock และ current-build attestation; typed append-only buyer-evidence revisions + HIGH permission; durable authoritative fields; legacy issue compatibility ถึง B2; B1 reader flip+dual-write/B2 freeze; signed pre-migrate assertion; read-only generator + RECONCILIATION_CORRECTION; server-owned fingerprints; permission-filtered readiness; executable internal reconciliation API; C2 buyer-coverage decision
- v2.7 self-check หลังแก้ (agent ตรวจซ้ำ): พบ 15 จุดที่เกิดจากการแก้เอง — heading §2 ค้าง v2.6, `ยกเว้น version 0` ค้างใน §4.3(3), ไม่มี endpoint ปิด capture window, window ไม่มีทางปิดอัตโนมัติ (เปิดค้าง = ช่องแก้ซ้ำไม่มี fence), CORRECTION กลายเป็น unreachable แต่ UI ยังเสนอ, TIN_VERIFIED latch โดยไม่มีหลักฐานชื่อ/ที่อยู่, lock 1 gate แต่ hash 2 gate, fingerprint ของ issue ไม่ตรงกันสองที่, unique key ของ item ทำให้ RESOLVED ที่สองเป็นไปไม่ได้, observation เขียนใน stage ที่ประกาศ read-only + ไม่มี unique key, `correctionReason`/counterparty ยังเป็น String, AC30 ไม่ bound N, taxId typo หลัง B2 ไม่มีทางซ่อมโดยไม่สร้าง fence, AC1 "ทุกขั้น", §7.3 อ้าง §7.1 แทน §7.2 — **แก้ครบทั้งหมดในฉบับนี้**
- v2.6 → รอบแปด P0×13 (verify กับโค้ดแล้วทุกข้อ): (1) INITIAL_CAPTURE ผูก version 0 ทำให้ wizard ขั้น 2 เดินต่อไม่ได้ (2) ย้าย sequence increment เข้า Serializable txn → 40001/P2034 ซึ่ง filter กลางปล่อยเป็น 500 และไม่มี retry (3) latch ติดบริษัทที่ identity ยัง null แล้วทำให้ typo แรกกลายเป็น LEGAL_CHANGE+fence (4) legacy commandId ผูก requestId → เสีย dedupe ที่ baseline มี (409 กลายเป็น 500) (5) command row เก็บ epoch/generation เป็น scalar ขัดกติกา availability vector + ไม่มี C1 cutover (6-13) `validBuyerSnapshotV1`/fingerprint algorithm/item unique key/ค่าของคอลัมน์ String/discriminator ของ union/contract ของ readiness section ที่ถูกตัด/กติกา civil date/ที่เก็บ would-deny observation ไม่มีนิยาม
- **v2.8**: ปิดรอบเก้า (5 มุมใหม่: ops/rollout, security-privacy, กฎหมายภาษีไทย, contract-frontend, คุณภาพ AC; 30 raw → 14 candidates → **ยืนยัน 8** หลัง verify แบบ refute-by-default) — (1) `POST /issue` มี success body สองแบบโดยไม่มีตัวแยก: replay คืน 2 ฟิลด์ ขณะที่ fresh คืนเอกสารเต็ม ทำให้ retry ที่สำเร็จแล้วพัง e2e/web/legacy caller → คืน shape เดียวกัน + `replayed:true` (2) buyer-evidence เปลี่ยนตัวผู้ซื้อของใบที่ออกแล้วได้ → invariant `buyerSnapshot.id == doc.counterpartyId` (3) **C2 OPEN เป็น per-build**: deploy ถัดไปทำให้ทุกการออกใบกำกับ 403 เพราะ bootstrap ไม่ re-attest human lineage → เพิ่มขั้นตอน acceptance OPEN ต่อ build ใน runbook + `admitsRunningBuild` ใน health (4) GET identity ไม่คืน version/window/latch ที่ wizard ต้องใช้เป็น CAS + ตัดสิน changeKind → block `control` + 200 body ของ PATCH/complete-capture (5) ไม่มี point-in-time identity: เอกสารย้อนหลังถูก fence แม้ข้อมูล ณ วันนั้นมีอยู่ → freeze as-of `documentDate` จาก LEGAL_CHANGE revision + บังคับ `effectiveFrom ≤ today` (6) AC ที่ต้องใช้ PostgreSQL จริงไม่มี gate ใน CI → script `test:tax-identity-pg` แบบ hard-fail (7) `businessFirstDate` ≠ วันจดทะเบียน VAT → ห้าม prefill (ม.85/1) (8) §5.3(4) พึ่ง `TaxPeriod` ที่ไม่มีเมื่อ `thai_tax` ปิด → เพิ่มเงื่อนไข source-independent จากเอกสารที่ออกแล้ว + ใช้ `isPeriodLocked` แทนการ fork รายการสถานะ
- **v2.9**: ปิดรอบสิบ P0×4 + P1×1 — แก้ `businessFirstDate` ตามคำอธิบาย output ทางการของ RD (เป็นวันอนุมัติจด VATและใช้ prefill แบบยืนยันได้); as-of projector ใช้ Company สำหรับช่วงปัจจุบันและ revision ก่อน boundary ถัดไปสำหรับช่วงอดีตจึงไม่ทิ้ง CORRECTION/RECONCILIATION; C2 block จนมี exact-build acceptance path จริง (ห้าม LB mixed-build); ถอน proxy ที่ใช้ tax document legacy เป็นหลักฐาน VAT เพราะ baseline ไม่ enforce และไม่มี resolver; success DTO ตรึง `replayed:boolean` (`false` fresh/`true` replay)
- v2.7: ปิดรอบแปด — capture window (`legalIdentityCaptureCompletedAt`) แทนเงื่อนไข version 0 + latch มีผลหลังปิด window และไม่ติดเมื่อ identity ไม่ครบ; serialization policy (bounded retry บน P2034 + timeout/maxWait + ห้าม I/O ใน txn); legacy commandId = `(documentId, updatedAt)`; availability vector 3 field + canonical sort + C1 NULL-cohort cutover; §12.1 canonical fingerprint + civil date; `BuyerSnapshotV1` + validator เดียว; unique key ของ reconciliation item + rule แถวใหม่เมื่อ drift; ตารางค่าของทุกคอลัมน์ใหม่ (enum vs String); DTO union พร้อม discriminator `command.kind`; readiness section = absent + สถานะที่สามในขั้น 5; `AccountingIssueAuthzObservation`; buyer-evidence key ย้ายไป `pack.tax_invoice.issue` + FINANCE grant ชัดแจ้ง; AC 28→32
