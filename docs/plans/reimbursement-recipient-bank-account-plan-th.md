# Plan: หลายบัญชีรับเงินคืนที่ผู้เบิกเลือกต่อใบ

> **หมายเหตุผู้ควบคุมงาน 2026-10-05:** แผนนี้อิงโค้ดก่อนมีฟีเจอร์บัญชีรับเงินคืน (#962/#963) แผนที่ใช้ลงมือทำคือ [แผนหลายบัญชีรับเงินคืน ฉบับปรับตามระบบจริง](reimbursement-multi-payout-accounts-plan-th.md)

วันที่: 2026-10-05
สถานะ: Design/audit complete; implementation ยังไม่เริ่ม
เจ้าของ: Codex / ผู้ใช้

[Spec](../specs/reimbursement-recipient-bank-account-spec-th.md) · [Audit และ 84 scenarios](../research/reimbursement-multi-account-gap-impact-2026-10-05-th.md) · [Memory](../agent-memory/reimbursement-recipient-bank-account.md)

## Product evidence

- [x] ผู้เบิกเก็บหลายบัญชีและเลือกต่อใบเอง; หนึ่งใบหนึ่งบัญชี จ่ายเต็มจำนวน
- [x] คง human verification; ผู้ใช้ยืนยันบัญชีบุคคลอื่นได้เมื่อผู้อนุมัติตรวจและยอมรับ (2026-10-05)
- [x] คำชี้แจง: รับคืนให้คนนอกที่ไม่มี user/membership ได้ A ยื่น/เลือก/ยืนยันเอง ไม่ต้องให้คนนอก login; supersede external-payee exclusion ปี 2026-09-11
- [x] ระบุ self-service/ทำแทน/threshold/finance OFF/solo-owner/third-party approval floor
- [x] ระบุ empty/loading/error/permission/stale/paid states และ correction ทุกสถานะ
- [x] แยก design proposals ออกจากพฤติกรรมปัจจุบัน ไม่อ้างว่า deploy แล้ว

## Architecture evidence

- [x] trace contract → schema → request → approval/finance → payment → print/signature → source/banking
- [x] company-member wallet แยกจากบัญชีบริษัท; snapshot ไม่อ่าน master สด
- [x] กำหนด actor authority, field authorization, masked/full read, confirmation/review/hash versions
- [x] ใช้ request/payment lock และ cancellation/projection cleanup เดิม; ไม่มี generic workflow engine ใหม่
- [x] มี legacy/rollout/rollback/external-transfer recovery และ idempotency สองชั้น
- [x] ระบุ gaps ที่ยืนยันจากโค้ดและสิ่งที่ยังต้องพิสูจน์แยกกันใน audit

## Implementation sequence

### Phase 1 — Schema และ contracts ที่เข้ากันกับใบเก่า

- [ ] เพิ่ม recipient account company/member scope, versioned master data with immutable claim/payment snapshots, ACTIVE/ARCHIVED, version, unique scoped fingerprint และ idempotent create
- [ ] เพิ่ม claim-scoped beneficiary snapshot แยกจาก requester และ source payer binding ต่อ line; bank holder ไม่มี required User FK และไม่สร้าง employee/supplier อัตโนมัติ
- [ ] เพิ่ม nullable repayment schema marker/snapshots/confirmation/human-review/third-party acceptance/payment-execution fields และ relation constraints
- [ ] ใช้ encryption helper/config เดิม ตรวจ key rotation และ fail-closed; digest ไม่อิง ciphertext
- [ ] เพิ่ม contracts/DTO/errors/mappers masked default; ห้าม server-owned field ใน input; method/currency/source-bank checks
- [ ] เลือก migration path ที่ไม่เปลี่ยน legacy approval/signature hashes; เก็บ revision evidence เมื่อ return แทนการลบประวัติที่ต้องใช้
- [ ] เพิ่ม own-account capability ใน existing member self-service pack รวม custom roles; ไม่แก้ `package.json`

ตรวจรับ: A05–A08, B01/B06/B07/B16, D10/D11, E04/E05/E06/E09/E13; migration forward/backward read compatibility และ constraints ใน PostgreSQL ไม่ใช้ mock อย่างเดียว

### Phase 2 — เลือกบัญชี/ยืนยัน/submit/approve

- [ ] APIs จัดการบัญชีตนและ sensitive-read ตาม scope โดยไม่มี wallet browsing ของผู้อื่น
- [ ] requester-only destination fields; proxy draft ต้องรอผู้เบิก confirm current contents hash
- [ ] submit validates selected ACTIVE account/member/source/version ใน transaction; stable snapshot และ explicit selection
- [ ] แยก REQUESTER/EXTERNAL_PERSON beneficiary; ทุกรายการผู้สำรองจ่ายเดียวกัน ตรวจ external binding โดย approver พร้อม source/checksum/version โดยไม่เปลี่ยนผู้จ่ายเป็น uploader
- [ ] ปรับ source options/attachment alias/submit/approval/projection/payment ให้ external path เดินครบ และ member wrong-payer/settled/tax/duplicate guards ยังป้องกันได้
- [ ] approval floor ของ EXTERNAL_PERSON หรือ THIRD_PARTY ใน policy snapshot + relationship/reason + explicit approver acceptance
- [ ] SELF review paths ครบ approval/finance/payer; preserve self-approval/solo policy
- [ ] stale checks และ review invalidation ทุก return/resubmit; no silent account/method replacement

ตรวจรับ: A01–A04/A09–A16, B02–B05/B08–B24, C01–C05/C09–C12; test ทุก routing combination ไม่เฉพาะ owner role

### Phase 3 — จ่าย/แก้ไข/recovery แบบครบปลายทาง

- [ ] เพิ่ม prepare/resolve/takeover execution ภายใต้ request lock; no auto-expiry ที่เปิดช่องโอนซ้ำ
- [ ] record payment bind attempt/recipient snapshot และ compare ทุก idempotent/early replay path
- [ ] ปิด F09 currency mismatch และ F10 invalid source bank ด้วย regression ก่อนแก้
- [ ] ป้องกัน cancel/reopen/significant correction ขณะ execution active/unknown แม้ยังไม่มี payment row
- [ ] cancel/reissue สำหรับ approved/projection claims พร้อม relation old/new และ source/evidence cleanup guard
- [ ] void/reversal ไม่เปิดให้จ่ายใหม่จน resolveเงินจริง; unknown/wrong transfer มี recovery ที่ไม่อ้างว่าจ่ายถูกบัญชีแล้ว
- [ ] payment/projection/reporting แสดงผู้รับคืนจริง B คู่กับผู้ยื่น A และมี beneficiary snapshot; external mode ไม่ใช้ requester name เป็น actual payee โดยปริยาย
- [ ] คง ledger posting/mirror/sourcePaymentRef/reconciliation rules และ duplicate controls

ตรวจรับ: C06–C08 และ D01–D16 กับ real transaction/concurrency + manual external-outcome rehearsal ใช้ simulator/stubs ที่แยก unknown/success/failed ไม่โอนเงินจริงเพื่อทดสอบ

### Phase 4 — Web/เอกสาร/ช่องทางอื่น

- [ ] own-account management ในบริบทใบเบิกและส่วนบัญชีของฉัน ไม่สร้าง HR module ใหม่
- [ ] create/edit selector + add inline + third-party reason + explicit preview/confirmation
- [ ] เพิ่ม UI ผู้ยื่น/ผู้รับคืน/เจ้าของบัญชีแยกกัน และ flow A คืนเงินคนนอกโดยไม่รอ external login/signature; ไม่ auto-link คนชื่อเหมือนกันหรือคนที่สมัครภายหลัง
- [ ] finance prepare-for-other flow; request/approval/payment journey และ queue ใช้ server action capabilities
- [ ] payment method readonly จากใบ; pending owner/unknown outcome/retry save messages
- [ ] print/export masked + sensitive action แบบ authorize/no-store; use request/payment snapshots
- [ ] แก้ F08 โดยผูก digital/paper acknowledgement กับ revision/hash under lock; รักษา legacy layouts
- [ ] audit/outbox/LINE/AI ส่ง status และ web links อย่างปลอดภัย ไม่มี full bank number; AI Gateway ไม่เข้าถึง repo โดยตรง
- [ ] ถ้ามี grouped voucher consumer ที่ตรวจพบตอน implement ให้แยก destination group; ไม่สร้าง bulk payment feature ใหม่ในงานนี้

ตรวจรับ: W cases ใน matrix, E01–E03/E06–E11/E16 โดยต่อ `e2e/reimbursements.spec.ts`, `e2e/reimbursement-receipt.spec.ts`; mobile + desktop + keyboard, ลงชื่อ/scan ก่อนจ่ายได้ตามเดิม

### Phase 5 — Migration และ release evidence

- [ ] inventory ใบเก่าแยก status/currency/partial/member state/projection lock และโอนแล้วแต่ยังไม่บันทึก/ผลไม่ทราบ
- [ ] ระบุเจ้าของ recovery แต่ละกลุ่มและ settle ก่อนเปิด enforcement; ไม่มี synthetic bank snapshot/review
- [ ] deploy additive reader/schema/API/permission/client ตามลำดับ แล้วเปิด feature เมื่อ C/D/E gates ผ่าน
- [ ] ทดสอบ stale clients/feature OFF/rollback โดยไม่ให้ old writer ล้าง snapshot หรือ bypass payment safety
- [ ] เก็บหลักฐานของ P1 ทั้งหมดและแจ้งข้อจำกัดที่ยังเปิดอยู่ ไม่ใช้ baseline 92 tests แทน feature acceptance
- [ ] หากจะทำ cloud/UAT/Production จริง อ่าน runbooks ที่ AGENTS.md บังคับก่อนทุก action และบันทึก exact run IDs ตาม protocol

## Verification commands และสถานะ

ทำแล้วเฉพาะ baseline จาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts
```

PASS 92 tests / 22 suites (2026-10-05), ไม่ใช่ feature tests

ชุด regression เดิมที่ใช้ต่อเมื่อ implement (ยังไม่ได้รันในงาน design นี้):

- `reimbursement-request.use-case.spec.ts`, `reimbursement-approval.use-case.spec.ts`, `reimbursement-finance.use-case.spec.ts`
- `reimbursement-related-access.use-case.spec.ts`, `reimbursement-branch-scope.use-case.spec.ts`, `reimbursement-claim-signature.use-case.spec.ts`, `reimbursement-claim-form.use-case.spec.ts`
- `prisma-reimbursement.repository.draft-submit-race.spec.ts`, `prisma-reimbursement.repository.payment-mirror.spec.ts`, `void-reimbursement-payment-reversal.use-case.spec.ts`
- focused contract/DTO/unit tests สำหรับ normalization/hash/third-party approval floor และ PostgreSQL concurrency tests ตาม matrix
- browser E2E เดิมสองไฟล์ข้างต้นเพิ่ม journeys ใหม่ ไม่ทดสอบเฉพาะ component snapshot

ตรวจ scopes/diff/links ของเอกสารหลังจบ และบันทึกคำสั่ง/ผลจริงใน memory ไม่มี legacy role-gate sections จึงไม่ใช้ `pnpm agent:gates`

## Integration exit criteria

- [ ] account → claimant selection → approval/acceptance → finance optional → external outcome → record → print/history เดินครบ
- [ ] ไม่มีทางเลือกบัญชีแทนผู้เบิกหรือเปลี่ยนปลายทางหลังตรวจผ่าน API/replay/old client
- [ ] external payee B ไม่มี user สามารถรับเงินคืนได้ตั้งแต่ standalone evidence/eligible linked source ถึง payment/print โดย A เป็นผู้ยื่น; ไม่มี employee payable ของ A ที่เกิดจากการใส่ชื่อผิด
- [ ] P1 findings และ matrix cases มีผลทดสอบ พร้อมเหตุผลสำหรับรายการที่ใช้ manual rehearsal
- [ ] F08–F10 มี failing-before/fixed-after evidence; ถ้ายัง reproduce ไม่ได้ให้บันทึกสาเหตุและขอบเขต ไม่ปิดจาก static assumption
- [ ] source/ledger/bank/permission/document regressions ผ่าน ไม่มี unknown transfer หรือ migration class ที่ไร้ recovery owner
- [ ] memory/spec/plan สะท้อนสถานะที่ทำจริงและข้อจำกัดครบก่อน handoff

Next: implement ตาม phases เมื่อผู้ใช้สั่ง implementation; งานปัจจุบันส่งมอบ design/spec/audit ไม่แก้ runtime code
