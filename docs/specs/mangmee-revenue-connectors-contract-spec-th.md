# Revenue Connectors Contract — Spec P18/P19/P20

สถานะ: **PROVIDER-NEUTRAL CORE READY; ADAPTER BLOCKED** — เขียน shared contract/conformance harness ได้ แต่ห้ามเขียน production adapter หรือขอ credential จน Owner เลือก provider/account/source จริง; แผนส่งมอบอยู่ใน [Four-lane Gap Closure Plan](../plans/mangmee-four-lane-gap-closure-plan-th.md#p18p20--revenue-connectors)

ขอบเขต:

- P18: direct bank, QR หรือ payment gateway
- P19: marketplace settlement/import
- P20: POS/partner API

เอกสารแม่: [Revenue Inbox/Matching P15–P17](mangmee-revenue-inbox-matching-spec-th.md), [Bank Reconciliation](bank-reconciliation-spec.md), [Marketplace Import](marketplace-import-spec.md), [Accounting OS](mangmee-accounting-operating-system-spec-th.md)

## 1. Current truth ที่ตรวจจาก code/docs

1. ระบบมี statement import → preview → commit, `lineHash` dedup, manual match และ reconciliation แล้ว แต่ไม่มี direct connector ที่สร้าง inflow จาก provider.
2. `marketplace-import-spec.md`/plan ปัจจุบันเป็น backlog boundary สั้น ๆ ยังไม่มี provider contract, auth, settlement/refund semantics หรือ test fixture จึงยังไม่ coding-ready.
3. P15–P17 กำหนดไว้ถูกต้องว่าเงินเข้าทุกก้อนเริ่มเป็น `UNIDENTIFIED/NEEDS_REVIEW` และ connector ห้ามลงรายได้/VAT โดยตรง.
4. การอ่านเอกสารผู้ให้บริการตัวอย่างแบบ read-only ยืนยันว่าผู้ให้บริการแต่ละรายต่างกันทั้ง webhook signature, idempotency horizon, refund และ settlement export; หลักฐานของ provider หนึ่งรายห้ามนำไป assume กับอีกราย.

## 2. Boundary ที่ห้ามละเมิด

1. Connector ทำได้แค่รับ/ดึงข้อมูล, ตรวจ authenticity, เก็บ raw evidence, normalize และส่งเข้า P15/P16; **ห้ามสร้าง journal, revenue, VAT, payment allocation หรือ inventory mutation โดยตรง**.
2. Tenant boundary มาจาก `connectionId` ที่ระบบสร้างและ bind กับ `companyId`; ห้ามเชื่อ tenant/company จาก payload ภายนอก.
3. ทุก final mutation หลัง connector ต้องผ่าน permission-checked ERP application service เดิม. AI Gateway อ่าน/เสนอได้ แต่ไม่มี credential และไม่เรียก provider mutation.
4. เงินเป็น Decimal/currency explicit; ห้ามใช้ JS float หรือ assume THB.
5. Duplicate/out-of-order/replay เป็นเส้นทางปกติ ไม่ใช่ exception ที่ปล่อยให้สร้างผลซ้ำ.

## 3. Canonical inbound envelope

Shared contract ขั้นต่ำ (ชื่อ field สุดท้ายตรวจ pattern ตอน implement):

```text
providerKey, connectionId, externalEventId, eventType, schemaVersion
occurredAt, receivedAt, currency
grossAmount?, feeAmount?, withheldAmount?, refundAmount?, netAmount?
externalOrderId?, externalPaymentId?, externalSettlementId?, bankReference?
payloadSha256, rawEvidenceRef, verificationMethod, verificationKeyVersion
```

กติกา:

- DB unique อย่างน้อย `(connectionId, externalEventId)`; event id เดิม + hash เดิม = replay สำเร็จแบบ no-op, id เดิม + hash ต่าง = quarantine + alert.
- ถ้า provider ไม่มี stable event id ให้ derive key จาก documented immutable identifiers เท่านั้นและเก็บ derivation version; ห้าม hash payload อย่างเดียวเป็น business identity.
- Raw payload immutable, encrypted-at-rest, size-bounded, redacted จาก log, มี retention/delete policy ตาม PDPA; fixture ใน repo ต้อง sanitized.
- `payloadSha256` คำนวณจาก exact bytes ก่อน parse เพื่อพิสูจน์ signature/replay; parsed data ห้ามแทน raw evidence.
- Consumer ใช้ inbox/outbox durable state; ห้ามถือว่า provider retry window หรือ idempotency TTL ยาวพอสำหรับ accounting retention.

## 4. Auth/webhook/polling contract

1. Webhook verify exact raw body ก่อน JSON parse ตาม algorithm/version ของ provider; รองรับ current+previous secret ในช่วง rotation และบันทึก key version ไม่บันทึก secret.
2. ถ้า provider มี timestamp/nonce ให้ enforce clock window + replay store; ถ้าไม่มี ให้ใช้ event unique + rate limit + source IP/mTLS allowlist เฉพาะที่ provider รับรอง.
3. ตอบ provider หลัง durable receive เท่านั้น; downstream classification failure ห้ามทำให้ provider delivery สูญหาย.
4. Polling connector ใช้ least-privilege credential, cursor/checkpoint durable, bounded pages, retry/backoff/rate-limit และ overlap window ที่ dedup ได้.
5. Credential อยู่ secret manager/config boundary, ไม่อยู่ DB plaintext/log/browser/AI prompt; revoke/rotate/disconnect ต้อง audit HIGH และหยุด worker ได้.
6. Webhook ไม่ครบหรือ delay ต้อง reconcile กับ provider transaction/settlement report ตามรอบ; completeness วัดจาก report/cursor ไม่ใช่จำนวน webhook อย่างเดียว.

## 5. Semantics ต่อ P

### P18 — Direct bank/QR/gateway

- Normalize authorized/captured/failed/refunded/chargeback/settled แยก event; ห้ามถือ `authorized` = เงินเข้าธนาคาร.
- Gateway request mutation ที่อาจเพิ่มภายหลังต้องใช้ internal durable idempotency ของ Mangmee แม้ provider มี key ของตน.
- Match payment กับ source document ผ่าน P15–P17; refund/chargeback เป็น reversal candidate พร้อม source lineage ไม่ใช่ negative revenue ที่เดาเอง.

### P19 — Marketplace settlement

- เก็บ order, payment, refund, platform fee, shipping subsidy/charge, withholding tax และ settlement แยก component.
- ต้องพิสูจน์ `gross - fees - withheld - refunds ± adjustments = net settlement` ต่อ batch ภายใน tolerance ที่ประกาศ; mismatch เข้า exception queue.
- Order import กับ cash settlement เป็นคนละ state; duplicate order ห้ามทำให้รายได้หรือ stock ซ้ำ.

### P20 — POS/partner API

- Contract ต้องระบุ source-of-truth ต่อ order/payment/refund/inventory; Mangmee ไม่รับ ownership สองฝั่งพร้อมกัน.
- รองรับ offline/backfill/out-of-order ตาม sequence/cursor ของ provider; conflict ห้าม last-write-wins แบบเงียบ.
- Provider write-back ใด ๆ เป็น scope ใหม่ ต้องมี spec/permission/idempotency/audit แยก; P20 รอบแรก read-only ingest.

## 6. Provider selection gate

Owner ต้องเลือก provider + pilot account/source โดยมี evidence ต่อหัวข้อต่อไปนี้ก่อนเขียน adapter:

1. Production/sandbox access, auth/rotation/revoke และผู้ถือ credential
2. Webhook signature exact algorithm/raw-body/timestamp/retry/SLA และ stable event IDs
3. Poll/list APIs, pagination/cursor, rate limits, historical backfill และ completeness report
4. Payment/order/refund/chargeback/fee/WHT/settlement semantics พร้อม sample payload จริงที่ sanitize ได้
5. Commercial terms, production approval, data residency/PDPA/retention และ incident/support path
6. Pilot volume, currency, timezone/cutoff และ reconciliation owner

ถ้าข้อใดไม่มีเอกสารผู้ให้บริการ ให้บันทึก `UNKNOWN` และ block capability นั้น; ห้ามเติมจากความจำหรือจาก provider คู่แข่ง.

## 7. Conformance fixtures/tests

Shared harness ต้องรับ sanitized fixtures แล้วพิสูจน์อย่างน้อย:

- valid/invalid signature, wrong key, modified raw body, expired timestamp, replay
- duplicate same payload, duplicate conflicting payload, out-of-order, missing predecessor, retry after crash
- partial page/cursor restart, rate limit, provider timeout, revoked credential
- authorized≠captured≠settled, partial/full refund, chargeback+reversal
- net settlement with fee/WHT/refund and mismatch quarantine
- cross-tenant connection spoof = 0 disclosure/mutation
- connector creates canonical inbound records only; accounting/ledger row count remains unchanged until human-approved downstream use case

## 8. Exit criteria

- Shared envelope + verifier/poller ports + fixture runner: coding-ready จาก spec นี้.
- Provider adapter: ready เมื่อ selection gate ครบ, sample fixtures committed แบบ sanitized, Owner ระบุ pilot และ security review ผ่าน.
- Production activation: replay/reconciliation evidence, credential rotation drill, observability/runbook, P15–P17 human-review path และ cohort capacity gate ผ่าน.
