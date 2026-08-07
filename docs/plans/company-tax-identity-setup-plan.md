# Plan: Company Tax Identity Setup ("Step 0") — v2.9

Status: DRAFT v2.9 — 2026-08-04; คู่กับ spec v2.9 ซึ่งเป็น authority ฉบับเดียว
Gating: Release A เมื่อ **QP1+QP2+QC1** ตอบ · B preflight/Release B1 เมื่อ reconciliation=0 + QD2 · B2 เมื่อทุก serving task ≥B1 + TAX_ID PENDING=0 + legacy issue telemetry=0 ต่อเนื่อง 7 UTC days หลัง B1 + ไม่มี registered external caller · C1 เมื่อประสาน decoupling catalog 20→21 · C2 เมื่อ evidence §13 + Q3 + **exact-build acceptance path ผ่าน integration test**

## Release A — Expand & Observe (N/N-1 compatible)

### A1 Contracts + permissions
- [ ] contracts: identity DTOs + **readiness section แบบ absent เมื่อไม่มีสิทธิ์** (spec §4.4), `PutVatRegistrationDto` union **discriminator `command.kind`** (**ไม่มี client fingerprint**), create/PATCH document fields, `IssueAccountingDocumentDtoV2` + `IssueAccountingDocumentResult` (`replayed:boolean`), legacy `{}` compatibility, typed `BuyerEvidenceRevisionDto`, **`BuyerSnapshotV1` + `validBuyerSnapshotV1` (module เดียวใน `packages/contracts`) และ `civil-date` helper**
- [ ] permissions: legal identity read/manage, VAT read/manage, `system.identity_reconciliation.resolve` CRITICAL, **`accounting.tax_document_buyer_evidence.manage` HIGH — ลงทะเบียนใน `permission-registry.ts` ก่อน แล้วใส่ `pack.tax_invoice.issue` (ไม่ใช่ `pack.billing.issue`) + เพิ่ม grant FINANCE อย่างชัดแจ้ง + อัปเดต parity test 6.3**; endpoint ต้องถือ `accounting.tax_invoice.issue` ร่วม; grants ตาม QP2
- [ ] แก้ `permission-matrix.md` conflict และ prefix-filter proof เมื่อ `thai_tax` OFF
- Verify: contract validation + permission registry/preset parity + old `{}`/new V2 caller matrix

### A2 Additive schema + migration
- [ ] ตารางใหม่ 9: VAT State/Command/Fact/Prompt, `CompanyLegalIdentityRevision`, `CompanyIdentityReconciliationItem` (**partial unique `(companyId,kind,discriminator) WHERE status='PENDING'` — raw SQL; RESOLVED สะสมได้**), **`AccountingDocumentIssueCommand` COMPLETED-only**, **`AccountingDocumentBuyerEvidenceRevision` append-only**, **`AccountingIssueAuthzObservation` (would-deny store ของ report 1)**
- [ ] Company ×16 รวม `legalIdentityCaptureCompletedAt` + durable authoritative latch; Branch establishment; counterparty buyer dimensions; document seller/buyer fields; TaxEvent seller branch
- [ ] **enum ใหม่ตามตารางใน spec §4.1** (LegalIdentityAuthorityReason/ChangeKind/CorrectionReason, TinExistenceStatus, VatDetailStatus, VerificationAttemptStatus, BuyerEntityKind/VatStatus, VatFactSource, Reconciliation{Kind,SourceState,Status}, BuyerEvidenceChangeKind) — ห้ามใช้ String ที่ไม่อยู่ในตาราง
- [ ] issue command เก็บ documentId/actor/fingerprint/result + **`entitlementEpochsJson`/`launchEntriesJson`/`availabilityVectorHash` (+`preGateCutoff` ช่วง A–B1)**; evidence เก็บ revision/schemaVersion/command fingerprint; ไม่มี IN_PROGRESS/current pointer
- [ ] additive migrations: state v0, dated-true VAT seed, branch establishment backfill; **ไม่มี generator/assertion/partial unique ใน A migration**
- [ ] **DB-backed test gate**: script `test:tax-identity-pg` (รวมทุก `.pg.spec` ของฟีเจอร์นี้) + CI step ใหม่ที่ผูก service postgres เดิม, รัน `prisma migrate deploy` ก่อน แล้วตั้ง `DATABASE_URL`; spec ทุกไฟล์ใช้ pattern **hard-fail เมื่อไม่มี DB — ห้าม `t.skip`** (ต่างจาก race spec เดิมที่ skip ได้) เพราะ AC7/14/20/23/27/28/30/31 พิสูจน์ได้เฉพาะบน PostgreSQL จริง (advisory lock, SERIALIZABLE, partial unique, `_prisma_migrations`)
- [ ] onboarding: VAT state v0 + HO establishment ใน company txn
- Verify: Prisma validate/generate + fresh-clone migrate deploy + rollback fixture + **`test:tax-identity-pg` exit nonzero เมื่อไม่ตั้ง `DATABASE_URL`**

### A3 Read-only generator + resolver + reports
- [ ] internal endpoints ตาม spec §16: generate ต่อบริษัท, paginated list, resolver 3 kinds, **`repair-tax-id` (เส้นซ่อมหลัง B2 ไม่มี item — provenance `repairCommandId`)**, reports; system-admin/CRITICAL only
- [ ] generator **ห้าม mutate domain**; item = ALIGNED/PENDING_ONE_SIDED/PENDING_CONFLICT; **upsert ด้วย unique key เฉพาะแถว PENDING — drift หลัง RESOLVED = insert แถวใหม่ ไม่ reopen**
- [ ] resolver: command replay + fingerprint CAS + company/item lock + revision/audit; taxId แยก LEGAL_CHANGE กับ DATA_RECONCILIATION (`RECONCILIATION_CORRECTION`, no fence); Profile mirror ใช้ upsert
- [ ] reports 6 ฉบับ; legacy buyer coverage ใช้ `validBuyerSnapshotV1` เดียวกับ issue; **report 1 = static (registry+grants) + observed (`AccountingIssueAuthzObservation` รายชั่วโมง)**
- Verify: generator rerun zero domain writes; resolver replay/stale/postcondition; pagination/checkpoint; reconciliation history AC28 — **รันผ่าน `test:tax-identity-pg`**

### A4 Identity + VAT + RD + wizard
- [ ] identity GET/PATCH/**`POST …/identity/complete-capture`**/verify: permission-filtered readiness (**section absent**) + **block `control` (version/window/latch) ให้ `company.setup.read` เสมอ + 200 body ของ PATCH/complete-capture คืน version**, revision/fence, **capture window** (INITIAL_CAPTURE จนกว่าจะปิด — ปิดได้ 3 ทาง: ปุ่มขั้น 5 / LEGAL_CHANGE แรก / issue เอกสารภาษีขณะ identity ครบ; ปิดซ้ำ = no-op), authoritative latch write-once **ทุก trigger ต้องมี `sellerIdentityCompleteHO`** และยังไม่บังคับระหว่าง window เปิด, CAS, safe audit; **Profile upsert dual-write ถึง B1** โดย preserve config
- [ ] VAT service/endpoints: server canonical fingerprint, union cancel/upsert, lookup-before-CAS, interval rules (**backdated ใช้ `isPeriodLocked` เดิมจาก TaxPeriod ที่มีจริง; ห้ามใช้เอกสาร legacy เป็น VAT proxy**), stored-bit mirror; no worker
- [ ] RD adapters/hardening/HMAC rotation; setting mode off default; `businessFirstDate` prefill effectiveFrom เฉพาะ REGISTERED แบบ suggestion ที่ต้องยืนยัน (NOT_REGISTERED ห้ามใช้)
- [ ] wizard 5 ขั้น (ขั้น 1–3 ส่ง INITIAL_CAPTURE; ขั้น 5 มีปุ่ม `complete-capture` + สถานะที่สามของบรรทัด VAT) + หน้าแก้ไขหลังปิด window ที่เสนอเฉพาะ changeKind ที่ server จะรับ + branch UI + settings/prerequisite links + **15 error labels**
- Verify: CC4/time-shift + latch survives taxId verification reset/concurrent trigger + no readiness permission leak + **AC1/AC29 (บริษัทที่เคยออกใบกำกับยังเดิน wizard ครบโดยไม่เกิด fence)** + **AC32 (fingerprint/civil date + current repair และ historical segment as-of)** + web/browser `thai_tax` OFF

### A5 Issue atomicity + buyer/seller
- [ ] endpoint accepts V2 and legacy `{}`; web sends stable command V2; **legacy path ใช้ `legacy:${documentId}:${doc.updatedAt.toISOString()}` (ห้าม requestId — ไม่งั้นเสีย dedupe ที่ baseline มี)** + telemetry
- [ ] Stage 0 = route→generic→scoped load→type policy→command replay; replay never bypasses current type/branch auth
- [ ] Serializable txn lock order: shared `sales_documents` entitlement → shared launch gate/current-build authority → exclusive issue-command lock → document/branch/sequence; reuse existing feature-launch helpers
- [ ] relookup command ใต้ lock; no IN_PROGRESS; same concurrent command replays one COMPLETED result; different intent 409
- [ ] readiness before number reservation; then number+snapshots (**seller as-of projector §8.3: Company สำหรับช่วงปัจจุบัน, revision ก่อน LEGAL_CHANGE boundary ถัดไปสำหรับช่วงอดีต**)+ISSUED+COMMITTED+authoritative latch + ปิด capture window (**เฉพาะเมื่อ `sellerIdentityCompleteHO`**)+outbox+audit+command result atomic through tx-aware seams
- [ ] **success DTO เดียวทั้ง fresh และ replay**: เอกสารเต็ม + `replayed:boolean` (`false`/`true`) — ห้ามคืน object สองฟิลด์
- [ ] **serialization policy**: bounded retry บน `P2034`/40001 (5 ครั้ง, backoff 20→320ms + jitter, commandId เดิม) → หมด budget ตอบ 409 ไม่ใช่ 500; `$transaction` timeout 15s/maxWait 5s; ห้าม network I/O ใน txn
- [ ] availability vector 3 field + canonical sort (entitlement ก่อน แล้ว `(gateKey,routeKey)`); ช่วง A–B1 mark `preGateCutoff`
- [ ] buyer evidence revision endpoint uses dedicated HIGH permission, typed validator, CAS/idempotency, **invariant `buyerSnapshot.id == doc.counterpartyId` → 422 `buyer_tax_identity_incomplete` + `details.reason='counterparty_anchor_mismatch'` (ไม่เพิ่ม code ที่ 16)**; correction appends revision
- [ ] seller establishment/UI + document PATCH; sync two paths+void use frozen snapshots; janitor report-only
- Verify: AC7–12,15,20,23–26 + **AC30 (N concurrent issues สำเร็จหมด ไม่มี 500 หลุด รวมกรณีขึ้นงวดใหม่)** + **AC31 (availability vector/cutover)** + crash/barrier harness + issue×disable/OPEN/CLOSE + old/new caller N/N-1 matrix รวม **legacy double-submit ต้อง replay ไม่ใช่ 500 และ fresh/replay ต้องคืน `replayed=false/true` บน shape เดียวกัน** — **ทั้งชุดรันผ่าน `test:tax-identity-pg`**

## Ops window

- Generate/resolve 3 kinds จน PENDING=0; rerun generatorท้าย window
- เก็บ would-deny report แล้ว QD2 ตัดสิน
- เติม buyer evidence จาก report 6; เก็บ coverage/residual count
- QB3 เดินคู่ขนานกับนักบัญชี

## B preflight — ก่อน migrate deploy

- [ ] signed read-only command ใต้ existing release-operation lock นับ TAX_ID/VAT_HINT/branch conflict สด + PENDING; nonzero หยุด release **ก่อน Prisma migrate**
- [ ] preflight artifact ผูก build/migration manifest และ verify ไม่มี domain write/ไม่มี `_prisma_migrations` row
- Verify: conflict fixture exit nonzero ก่อน migrate; clean fixture pass; **AC27 (`_prisma_migrations` ไม่มีแถว failed) รันผ่าน `test:tax-identity-pg`**

## Release B1 — Flip, Constrain, Enforce

- [ ] migration constraints partial unique 2 ตัว พร้อม in-transaction zero check; ถ้า migration fail ใช้ documented `resolve --rolled-back` หลัง verify rollback เท่านั้น — ห้าม `--applied`
- [ ] flip WHT/chart/consumers เป็น Company/accessor; **ยัง dual-write Profile mirror** เพื่อรองรับ A tasks ระหว่าง bake
- [ ] enforce type permissions 403 unconditional ตาม QD2
- Verify: old A + new B1 task compatibility, WHT identity parity, constraints, authz parity, fresh-clone migrate

## Release B2 — Compatibility cleanup

- [ ] prove active serving builds ทุกตัว ≥B1 (สอง stable reads ตาม deploy pattern), TAX_ID PENDING=0 แล้วหยุด Profile mirror + retire TAX_ID Profile-reconciliation lane
- [ ] legacy issue telemetry=0 ต่อเนื่อง 7 UTC days หลัง B1 + support inventory ไม่มี registered external caller แล้วบังคับ V2 body; เก็บ legacy rejection contract
- Verify: no Profile writes, no Profile-first readers, old-body rejection/new-body replay, rollback target ไม่ต่ำกว่า B1

## Release C1 — Gate registration & observation (CLOSED)

- [ ] catalog code+JSON+MD+drift fixtures, row ORDINARY CLOSED, `SYNCHRONOUS_ROWS` 3→4, health/A5/runbook/count 20→21, production preflight, **NULL-cohort cutover ของ issue-command rows ช่วง A–B1 (ตรึง cutoff, ห้าม back-stamp)**
- [ ] activate readiness observation at dormant A issue evaluator + synchronous journey result; gate evaluation ใช้ state/generation **และ current-build attestation** ใต้ shared lock
- [ ] ประสาน decoupling ส่ง **exact-build acceptance path**: authenticated human authority เดิม + server-derived incoming build, ห้าม LB mixed-build targeting, ทำก่อนรับ tax-document trafficหรือมี proven drain, รองรับ rollback; จนผ่าน integration test ให้คง gate CLOSED
- Verify: CLOSED baseline; OPEN+attested enforces; OPEN+unattested 403; counts/journey/health green; exact incoming/rollback build acceptance + mixed-build no-partial-403 integration

## Evidence window → C2

- production observation ≥2 UTC hours + journey pass + remediation/blocked-drafts reports
- buyer evidence valid coverage 100% **หรือ owner-signed residual CN/DN acceptance**
- automated accessibility + moderated usability 2×5 คนจริง (≥4/5 unaided, zero severe false beliefs)
- C2 owner OPEN ตาม Q3 เฉพาะหลัง exact-build acceptance integration ผ่าน; plan ไม่เปิดเอง

## Deploy gates / repo traps

1. Fresh-clone migration ทุก release; B invariant เป็น preflight นอก migration; failed constraint recovery ใช้ `--rolled-back` หลัง verify เท่านั้น; ห้าม `resolve --applied`
2. N/N-1: A รับ old/new issue body; B1 reader flip แต่ dual-write; B2 cleanup หลัง serving-build+telemetry proof
3. Lock orderตายตัว entitlement→gate→command→domain/sequence; ห้าม network I/O ขณะถือ DB lock; export/reuse existing shared/exclusive launch helpers
4. Lookup-before-CAS ทุก command; fingerprint server-owned **ตามอัลกอริทึม §12.1 เท่านั้น (field list ตรึง — เปลี่ยนคือ version ใหม่)**; ห้าม create-catch-P2002; repository ใน txn ใช้ `*InTx` seams
7. **Serializable + write ลงแถวร้อน = ต้องมี retry**: filter กลางปล่อย P2034 เป็น 500 และไม่มี retry กลางในระบบ — ทุก path ที่ย้าย write เข้ามาใน txn ยาวต้องมี bounded retry ของตัวเอง
8. **Civil date ต้องผ่าน helper เดียว**: `@db.Date` + local midnight = เลื่อนวันใน Asia/Bangkok; fence เทียบกับ `civilDate(documentDate, tz)` ไม่ใช่ timestamp ดิบ
5. Numbering คง `doc.branchId ?? 'GLOBAL'` + lazy-create เดิม; seller establishment ไม่เปลี่ยน scope
6. Sanitizer exact-key set; audit/report ไม่มี taxId/address ดิบ; shared worktree ห้าม `git add -A`
9. **C2 OPEN เป็น per-build**: controller ปัจจุบัน target build ผ่าน LB ไม่ได้; C2 block จน exact-build path ใน C1 พิสูจน์ no mixed-build partial 403, incoming/rollback acceptance และ `admitsRunningBuild`; ห้ามแก้ด้วย caller-supplied build/actor
