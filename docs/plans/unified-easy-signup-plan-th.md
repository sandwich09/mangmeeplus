# แผนร่าง — สมัครเว็บง่ายเหมือน LINE

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป โดยมติ pack amendment2026-09-12 ให้ annual รับโควตาทั้งก้อนทันทีและไม่รีเซ็ตโควตา paid รายเดือน. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

สถานะ: **BRAINSTORM / NOT STARTED 2026-09-11**. [Spec และทิศทาง Owner](../specs/unified-easy-signup-spec-th.md) เป็น source of truth. LINE optional และ easy web signup ยืนยันแล้ว; วิธี email proof/login/auto approval ยังเป็นข้อเสนอ. ไม่เปลี่ยน runtime, เปิด provider, deploy หรือส่งข้อความในรอบนี้.

**Mail-provider decision 2026-09-11:** Owner เลือก Postmarkแล้ว. [M0–M4 / EM01–EM18](mangmee-transactional-email-provider-plan-th.md) เป็น delivery dependency ของ E1–E3; M0 docsพร้อม, M1/M2ต้องผ่านก่อนเปิดflowอีเมล และ M4แยกactual inboxจากsimulation. Receipt ค่า Postmarkใช้ลงบัญชีบริษัทเรา; Stripeออก/ส่งInvoice/Receiptของลูกค้า. B06ข้อมูลการคิดภาษีไม่ใช่fieldที่ต้องเพิ่มตอนเริ่มใช้ฟรี; custom fiscal generator/e-Taxไม่ใช่งานmail provider.

| ขั้น | งานและขอบเขต | หลักฐานก่อนถือว่าเสร็จ |
|---|---|---|
| E0 Contract | เลือก email proof + returning login/recovery ให้ครบ; ลด fields; แยกคำขอใหม่/legacy pending; eligibility/review/cap ข้ามช่องทาง; map state เดิมกับ flow ใหม่แบบ source/policy-aware | ไม่ทำลาย Flow B เดิม; existing/unverified/held identity และ signup→access journey ระบุได้ |
| E1 Identity + admission | reuse token/atomic-claim/session/consent/rate-limit/outbox/provision patterns; ไม่เอา AccountClaimToken เดิมมาให้สิทธิ์ login โดยขยายขอบเขตเงียบ ๆ; เพิ่ม schema/contract เท่าที่แบบที่เลือกต้องใช้ | real PG replay/concurrency/expiry/collision + negative authorization; ส่งเมลจำลองระบุขอบเขตชัด |
| E2 App + official | ฟอร์มสั้นในแอป, email verify/loading/pending/recovery/login, first receipt; official handoff และแยก contact lead; LINE entry ใช้ core ร่วมที่ปรับแล้ว | browser/API/DB end-to-end ไม่มี LINE, เปลี่ยนอุปกรณ์/หลายแท็บ/สมัครค้าง, link ทั้งสองทิศ, 390px/desktop/keyboard |
| E3 Delivery + rollout | ตรวจ provider/inbox/bounce และ latency จริงตาม runbooks; เปิดเฉพาะเมื่อ flow กลับเข้า/กู้บัญชีพร้อม, คง recovery ของคำขอเดิม, วัด signup→first receipt แยก source/method | local proof แยกจาก inbox/UAT/LIVE, no false-sent/ready state, release protocol ผ่านก่อนเปิดจริง |

ชุด regression ต้องครอบคลุม: new account/no LINE, existing verified account, unverified contact collision, repeat trial/shop, foreign membership/holds, same request parallel, cross-channel signup, OTP/link expiry/resend/rate limit, delivery disabled/failure, provisioning commit/response-loss, logout/return/recovery และ payment independence. ยังไม่มี test ใหม่นี้ถูกรัน; billing S-pre results ไม่ใช้แทน signup proof.

งานที่ทำแล้ว: ตรวจ actual official template, app Flow B/claim/provision, LINE AUTO_FREE admission, auth email-delivery guard/port/factory และ historical email readiness memo; บันทึก spec/plan/cross-repo links. OwnerเลือกPostmarkแล้วและยืนยันStripecustomerdocuments; ตรวจofficialAPIและระบุruntime migration/test planครบ. ยังไม่ตรวจlive environmentหรือactivateprovider.
