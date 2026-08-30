# Agent Memory: EasySlip v2 auto-register plan

Status: Docs-only direction recorded; no EasySlip/payment implementation
Owner: Product owner
Scope: บันทึก offer preview ของ auto-register และขอบเขต K BIZ Thai QR + EasySlip API v2 สำหรับ paid activation ในอนาคต โดยไม่แก้ schema/API/UI/config/dependency
Decisions:
- Catalog มี `FREE_TRIAL`, `MONTHLY_259`, `MONTHLY_599`, `MONTHLY_999`, `MONTHLY_1299`; ราคาเป็น 0/259/599/999/1299 บาทต่อเดือน
- หน้า auto-register ในอนาคตแสดงครบ แต่เปิดเลือกเฉพาะ Free; paid tiers disabled พร้อม “เร็ว ๆ นี้” และ server ต้อง reject paid key ด้วย `offer_not_available`
- `requestedOfferKey` ใน P10 เป็น attribution/audit เท่านั้น ห้ามเปิด entitlement หรืออนุมาน quota/feature
- Free path ห้ามพึ่ง EasySlip; paid path ในอนาคตเสียบก่อน provisioning โดยใช้ K BIZ Thai QR ล็อกยอดและให้ backend เรียก EasySlip v2 ตรวจ receiver/amount/duplicate
- ถ้ามี signup review/approval gate ต้องผ่านก่อนสร้าง payment attempt; EasySlip verification อย่างเดียวห้าม provision
- EasySlip mode เริ่ม `DISABLED`; tester quota ไม่ได้อนุญาตให้เปิด paid offer หรือ provision จากผลทดสอบ
Open questions:
- Free trial duration และ quota จริง
- ชื่อ marketing, quota และ feature snapshot ของ paid tiers
- Grace period, tax-document owner, receiver account/QR generation contract และ reconciliation/manual dispute policy ก่อนเปิด paid จริง
Artifacts:
- `docs/specs/mangmee-billing-subscription-spec-th.md`
- `docs/specs/mangmee-external-signup-contract-spec-th.md`
- `docs/plans/mangmee-four-lane-gap-closure-plan-th.md`
Verification:
- `git diff --check` ผ่านหลัง rebase บนฐาน `origin/develop@a151d836`
- Focused `rg` consistency check ผ่าน: offer keys/prices, enabled state, `offer_not_available`, attribution-only boundary, explicit cross-reference anchors และ EasySlip future boundary ตรงกันทั้งสามเอกสาร
- ตรวจ [EasySlip v2 image verification](https://document.easyslip.com/en/v2/verify/bank/image) ซ้ำเมื่อ 2026-08-29: endpoint, Bearer auth และชนิด `matchAccount`/`matchAmount`/`checkDuplicate` ตรงกับ spec
- Commit นี้ไม่มี schema/API/UI/config/dependency implementation
Next:
- ยังไม่ implement payment; เริ่ม P26 เฉพาะเมื่อ Owner สั่งและตอบ open questions/gates ที่เกี่ยวข้องแล้ว


## Superseded note 2026-08-30

Offer catalog 259/599/999/1299 ที่อ้างในไฟล์นี้ถูกแทนด้วยชุดจากเว็บ official (Owner ยืนยัน "อันล่าสุด"): STARTER 249 / BASIC 499 / PRO 999 (trial ฟรีผูกกับ PRO) / ENTERPRISE 1,999 — ดู Billing §8 ฉบับปัจจุบัน. แนวทาง EasySlip/payment ใน plan นี้ยังใช้ได้ แต่ mapping ราคา/key ต้องอ่านจาก Billing §8 เท่านั้น.
