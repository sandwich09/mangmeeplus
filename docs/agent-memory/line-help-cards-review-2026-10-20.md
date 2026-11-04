# LINE help cards: owner review — 2026-10-20

Status: APPROVED by the owner on 2026-10-21; reviewer `owner-review:2026-10-21`.
Owner: เจ้าของกิจการ — approved all guide bodies: “อนุมัติคู่มือทั้งหมด” (2026-10-21).
Scope: 68 cards = 12 existing approved topics + 4 previous drafts + 52 new topics; all 68 v6 bodies revised for this owner review.

v6 is APPROVED and active with reviewers [owner-review:2026-10-21]. All 68 answer bodies remain exactly as approved. The previous v4 record and its 12 bodies/source hashes are unchanged. Every v6 question keeps at least four everyday paraphrases. Routing offers a bounded eligible subset; rendering rechecks selected IDs against the full eligible pack, reviewer, hash, effective dates, permissions, features and capabilities.
Linked open-shop help reuses the existing reviewed public-policy `card` text and the current-company card. Owners receive the existing LIFF door only when signup is open and no application is pending. A staff/accountant membership gets the existing promotion pointer, never an owner signup URL. This reuses the existing public-policy text independently of the help pack and does not create a shop.

## Inventory and evidence

All six existing guide content files were inventoried (expenses, reimbursement, substitute receipts, disbursement voucher, tax, reports), including their section anchors; the new getting-started guide covers the missing common setup/LINE topics as well as short cross-feature answers.
Registry inventory: 31 LINE_CHAT_ACTIONS and 85 LINE_TOOL_REGISTRY entries. Sold-package eligibility uses the actual TIER_FEATURE_PRESETS, rather than a caller role or an assumed package name. Read-only/preview tools are not final mutations. Unsold sales/CRM, ledger, inventory and procurement registry actions are outside this guide inventory.

Eval evidence: T-116-a-owner-howto-category and T-118-a-manager-howto-signature are reproduced in `semantic-turn-v2-terminal-outcomes.spec.ts`; their exact question variants are covered by `expense.categories` and `signature.setup`. When no approved card is selected, the existing unavailable terminal result remains true; v6 now supplies reviewed cards for these topics. The gateway business-query corpus was checked alongside the capability/action registry.
Public-policy evidence: `line-public-policy.logic.ts` trial, trial_limits, card, data, paid_renewal, buy_early, quota, plan_change, cancellation and payment_failure answers. Package figures are the default `billingOffer`/PLAN_TIER_PRESETS values; current published offers can override them, so the card directs the reader to the live offer before buying.
Catalog mismatch: `reports` is absent from all four standard sold tier presets in this checkout. Report cards remain feature-gated and do not promise that the package includes reports. 50 ทวิ made outside the system is ungated by wht_50bis; issuing within the system requires wht_50bis and wht.certificate.issue. The previous draft meaning/calculation cards have the unnecessary wht_50bis restriction removed in v6 only.
The old 64-card/12-KiB metadata ceiling was insufficient for the requested inventory: v6 permits at most 80 cards/32 KiB metadata; older packs retain their limits. The body limit remains 4096 bytes, and hashes/approval/access checks are unchanged.

Verification (LINE-HELP-ALL-2): 2,149 gateway agent tests, 68 web guide tests, 780 API webhook/public-policy/staff-menu tests and 5 W00 manifest tests pass. Loading coverage: 673 covered, gaps=0. Typecheck exit lines are included in the final handoff. Whole-chain, PostgreSQL and browser proof are left to the controller outside this sandbox; no servers or Docker were started here. The existing shop-menus-everyday journey still opens and expands this guide on wide/phone layouts; it pins no changed FAQ body, so its steps are unchanged.

## Topic counts

- เริ่มใช้งานและเปิดร้าน: 4
- สาขา: 1
- พนักงาน: 1
- หน้าที่และสิทธิ์: 2
- แพ็กเกจและข้อมูล: 9
- ใช้งาน LINE: 5
- ค่าใช้จ่ายและหลักฐาน: 13
- บันทึกการจ่าย: 3
- ใบเบิกและบัญชีรับเงินคืน: 10
- ใบเตรียมจ่ายและใบสำคัญจ่าย: 4
- ใบรับรองแทนใบเสร็จ: 5
- 50 ทวิและ ภ.ง.ด.53: 6
- รายงาน: 2
- หน้าแรก: 1
- การแจ้งเตือน: 1
- ลายเซ็นของฉัน: 1

## เริ่มใช้งานและเปิดร้าน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| shop.open | เปิดร้านหรือเปิดร้านเพิ่ม | เปิดร้านยังไง / เปิดร้านเพิ่ม / เปิดอีกร้านได้ไหม / สมัครร้านใหม่ทำยังไง | เจ้าของกิจการพิมพ์ “เปลี่ยนบริษัท” แล้วกด “เปิดร้านใหม่” เมื่อช่องทางสมัครเปิดอยู่ได้ค่ะ 😄 ถ้ามีคำขอค้างอยู่ ดูสถานะคำขอเดิมก่อนได้เลย | สมาชิก; company.legal_identity.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#start (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| shop.staff-open | พนักงานอยากเปิดร้านของตัวเอง | เป็นพนักงานแต่อยากเปิดร้านเอง / เปิดร้านตัวเองจากบัญชีพนักงาน / พนักงานสมัครร้านได้ไหม / อยากมีอีกร้านแต่ไม่มีปุ่ม | ถ้าใช้ในมุมมองพนักงานและอยากเปิดร้านของตัวเอง กด “แพ็กเกจและราคา” ในเมนูด้านล่าง หรือพิมพ์ “โปรโมชั่น” เพื่อดูทางสมัครได้ค่ะ 😄 ส่วนปุ่ม “เปิดร้านใหม่” บนการ์ดร้านเป็นทางสำหรับเจ้าของกิจการค่ะ | สมาชิก; line.ai.query | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#start (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| shop.link-line | เชื่อมบัญชีกับ LINE | เชื่อมไลน์ยังไง / ผูก LINE กับพนักงาน / ลิงก์ไลน์หมดอายุทำไง / ยังไม่ได้เชื่อมไลน์ | ให้ผู้มีสิทธิ์จัดการพนักงานเปิดข้อมูลของคุณแล้วส่งลิงก์เชื่อม LINE ให้ค่ะ 🙂 เปิดด้วย LINE ของคุณเองได้เลย ถ้าลิงก์หมดอายุ ขอให้ส่งลิงก์ใหม่ได้ค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#start (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| shop.web-login | เปิดร้านบนเว็บ | เข้าเว็บยังไง / ล็อกอินเว็บจากไลน์ / เปิดเว็บร้านตรงไหน / ใช้คอมทำงานได้ไหม | พิมพ์ “เปลี่ยนบริษัท” แล้วกด “เปิดเว็บบริษัทนี้” ของร้านที่ต้องการค่ะ 🙂 ลิงก์นี้เป็นของคุณคนเดียว ใช้เข้าบัญชีของคุณบนเว็บได้เลยนะคะ | สมาชิก; line.ai.query | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#start (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## สาขา

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| branch.manage | เพิ่มหรือแก้สาขา | เพิ่มสาขายังไง / แก้ชื่อสาขาตรงไหน / เปิดอีกสาขา / ปิดสาขาที่ไม่ใช้ | เปิด “ตั้งค่าร้าน” แล้วเลือก “สาขา” ค่ะ 😄 ผู้มีสิทธิ์เพิ่มหรือแก้สาขาได้ตามจำนวนในแพ็กเกจ ส่วนสาขาที่เลิกใช้เปลี่ยนเป็นปิดใช้งานได้ค่ะ | สมาชิก; company.branch.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; company_settings.branches | getting-started#branches (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## พนักงาน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| staff.invite | เพิ่มพนักงานและเชื่อม LINE | เพิ่มพนักงานยังไง / เชิญคนเข้าร้าน / ให้ลูกน้องใช้ไลน์ได้ไหม / ส่งลิงก์ให้พนักงานตรงไหน | เปิด “พนักงาน” แล้วกด “เพิ่มพนักงาน” กรอกข้อมูล เลือกหน้าที่และสาขาค่ะ 🤗 เมื่อสร้างบัญชีแล้ว ส่งลิงก์เชื่อม LINE ให้เจ้าของบัญชีเปิดด้วย LINE ของตัวเองได้เลย | สมาชิก; access.employee.create | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; employee_access.employees | getting-started#staff (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## หน้าที่และสิทธิ์

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| staff.roles | กำหนดหน้าที่และสิทธิ์ | เปลี่ยนหน้าที่พนักงานยังไง / เพิ่มสิทธิ์อนุมัติให้ใคร / ตั้งสิทธิ์ตรงไหน / ทำไมเพื่อนเห็นเมนูมากกว่า | เปิด “กำหนดหน้าที่พนักงาน” เพื่อตรวจงานที่แต่ละหน้าที่ทำได้ค่ะ 🤗 เลือกงานและสาขาที่คนนั้นรับผิดชอบ ระบบให้มอบหมายได้ภายในสิทธิ์ของคุณค่ะ | สมาชิก; access.role.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; employee_access.roles | getting-started#roles (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| staff.missing-access | เมนูหรือสิทธิ์ไม่เหมือนกัน | ทำไมไม่มีเมนูนี้ / เพื่อนกดได้แต่ฉันกดไม่ได้ / สิทธิ์ไม่พอต้องทำไง / ขอสิทธิ์เพิ่มได้ที่ไหน | เมนูปรับตามแพ็กเกจ ช่องทางที่ร้านเปิด และสิทธิ์ของคุณค่ะ 🤗 บอกเจ้าของกิจการว่างานไหนและสาขาใดที่ต้องใช้ เพื่อช่วยตั้งสิทธิ์ให้กับบัญชีของคุณเองได้ค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#roles (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## แพ็กเกจและข้อมูล

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| package.compare | แต่ละแพ็กเกจต่างกันอย่างไร | แพ็กเกจมีอะไรบ้าง / 249 ได้กี่ใบ / 499 กับ 999 ต่างกันยังไง / 1999 ได้อะไรเพิ่ม | แพ็ก 249 / 499 / 999 ใช้เมนูหลักชุดเดียวกันค่ะ 🙂 คือผู้ช่วย LINE, “หน้าแรก”, “ค่าใช้จ่ายและใบเสร็จ”, “การเบิกจ่าย”, “พนักงานและสิทธิ์” และ “การแจ้งเตือน” ราคามาตรฐานต่อเดือน 249 / 499 / 999 / 1,999 บาท ตามลำดับได้ 1/2/5/10 สาขา ผู้ใช้ 2/5/10/30 คน ใบเสร็จ 30/50/100/500 ใบ รุ่น 1,999 เพิ่ม ภ.ง.ด.53 และออก 50 ทวิในระบบ ดูข้อเสนอปัจจุบันที่ “แพ็กเกจ” ก่อนซื้อค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.quota | นับจำนวนใบเสร็จอย่างไร | อ่านใบเสร็จไม่สำเร็จนับไหม / ใช้สิทธิ์ไปกี่ใบ / รายปีได้ใบเสร็จยังไง / ส่งซ้ำนับใบใหม่ไหม | ระบบนับเมื่อ AI อ่านและบันทึกผลสำเร็จค่ะ 😊 แก้ข้อมูลเองได้โดยใช้ผลอ่านเดิม ส่วนรายปีได้สิทธิ์อ่านครบทั้งรอบตั้งแต่เริ่ม ดูจำนวนที่เหลือได้ที่ “แพ็กเกจ” ค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.buy | ซื้อแพ็กเกจ | ซื้อแพ็กยังไง / จ่ายค่าแพ็กตรงไหน / สมัครแพ็ก 249 / เลือกแพ็กเกจให้ร้าน | เปิด “แพ็กเกจ” แล้วเลือกข้อเสนอที่เปิดขายได้ค่ะ 🙂 ตรวจราคา รอบเวลา และจำนวนใบเสร็จให้ตรงกับที่ต้องการ แล้วคุณเป็นคนยืนยันจ่ายบนเว็บค่ะ | สมาชิก; company.plan.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.renew | ต่ออายุแพ็กเกจ | ต่ออายุยังไง / ซื้อแพ็กเดิมซ้ำ / ต่อปีได้ไหม / ต่อก่อนหมดอายุได้ไหม | ซื้อแพ็กเกจเดิมซ้ำจะได้สิทธิ์อ่านเพิ่ม และต่อเวลาจากวันหมดอายุเดิมค่ะ 🙂 ถ้าหมดอายุแล้ว เริ่มจากวันที่จ่าย ตรวจรอบและเงื่อนไขที่ “แพ็กเกจ” ก่อนยืนยันได้เลย | สมาชิก; company.plan.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.change | เปลี่ยนแพ็กเกจ | อัปแพ็กยังไง / ลดแพ็กได้ไหม / เปลี่ยน 499 เป็น 999 / เพิ่มสาขาต้องเปลี่ยนแพ็กไหม | เพิ่มระดับมีผลหลังจ่ายส่วนต่าง โดยใช้วันหมดอายุเดิมค่ะ 🙂 ลดระดับมีผลเมื่อจบรอบที่จ่ายไว้ ตรวจข้อเสนอ จำนวนสาขาและผู้ใช้ที่รองรับที่ “แพ็กเกจ” ก่อนยืนยันนะคะ | สมาชิก; company.plan.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.expiry | หมดอายุแล้วข้อมูลอยู่ไหม | ไม่ต่อแพ็กข้อมูลหายไหม / หมดอายุแล้วดูอะไรได้ / ยังไม่จ่ายแพ็กจะเป็นอะไร / อยากเอาข้อมูลออกก่อนหมดอายุ | เมื่อยังไม่มีแพ็กเกจหรือหมดอายุ งานธุรกิจจะพักไว้ ส่วนข้อมูลยังเก็บอยู่ตามนโยบายค่ะ 🤗 💚 ติดต่อทีมงานมั่งมีให้ช่วยเรื่องการเข้าถึงหรือขอข้อมูลได้ หากต้องการลบข้อมูล แจ้งคำขอแยกกับทีมงานได้เลยนะคะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

| package.before-payment | เปิดร้านแล้วต้องซื้อทันทีไหม | เปิดร้านแล้วใช้ฟรีไหม / สมัครแล้วโดนเก็บเงินเลยไหม / ยังไม่ซื้อแพ็กใช้อะไรได้ / ร้านที่ทดลองฟรีอยู่ทำอย่างไร | สมัครแล้วตั้งค่าร้านและบัญชี พร้อมดู “แพ็กเกจ” ก่อนได้ค่ะ 😄 งานธุรกิจเริ่มเมื่อเลือกและจ่ายแพ็กเกจ คุณเลือกเวลาซื้อได้เอง ส่วนร้านที่มีสิทธิ์ทดลองเดิมใช้ต่อได้จนหมดช่วงค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.cancellation | ยกเลิกแพ็กเกจหรือขอคืนเงิน | ยกเลิกแพ็กยังไง / ขอเงินค่าแพ็กคืนได้ไหม / ไม่อยากต่อแพ็กแล้ว / หยุดใช้แล้วคืนเงินไหม | การยกเลิกแพ็กเกจมีผลเมื่อจบรอบที่จ่ายไว้ค่ะ 🤗 💚 เรื่องคืนเงิน ทีมงานมั่งมีช่วยตรวจเป็นรายกรณี พิมพ์ “ติดต่อเจ้าหน้าที่” เพื่อแจ้งคำขอได้เลยนะคะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| package.payment-failure | ชำระต่ออายุไม่สำเร็จ | ต่ออายุจ่ายไม่ผ่านทำไง / บัตรตัดค่าแพ็กไม่ได้ / ชำระต่ออายุล้มเหลว / จ่ายไม่ผ่านยังใช้ได้ไหม | แพ็กเกจที่ซื้อแล้วมีช่วงผ่อนผันมาตรฐาน 7 วันเมื่อจ่ายต่ออายุไม่สำเร็จค่ะ 🤗 💚 สิทธิ์อ่านของรอบใหม่เพิ่มเมื่อจ่ายแล้ว พิมพ์ “ติดต่อเจ้าหน้าที่” ให้ทีมงานช่วยตรวจสถานะและเงื่อนไขของร้านได้ค่ะ | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#packages (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ใช้งาน LINE

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| shop.switch | สลับร้านใน LINE | เปลี่ยนร้านยังไง / สลับบริษัท / ตอนนี้คุยอยู่ร้านไหน / เลือกร้านอื่นในไลน์ | พิมพ์ “เปลี่ยนบริษัท” แล้วเลือกร้านที่คุณเป็นสมาชิกได้ค่ะ 😄 ดูชื่อร้านให้ตรงก่อนส่งเอกสารหรือถามยอด เพื่อให้ข้อมูลอยู่กับร้านที่ต้องการค่ะ | สมาชิก; line.ai.query | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#line (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| line.receipt | ส่งใบเสร็จใน LINE | ส่งบิลยังไง / ส่งรูปใบเสร็จได้ไหม / น้องอ่านใบเสร็จให้หน่อย / บันทึกรายจ่ายจากรูป | ส่งรูปใบเสร็จชัด ๆ ใน LINE ของร้านที่ต้องการได้เลยค่ะ 😊 ถ้ามีหลายสาขา เลือกสาขาก่อน แล้วตรวจข้อมูลที่อ่านได้ การส่งรูปจะเตรียมร่างไว้ให้ ส่วนยืนยันเอกสารและบันทึกจ่ายทำเป็นขั้นตอนต่อค่ะ | สมาชิก; expense.receipt.line_upload หรือ expense.receipt.upload หรือ expense.create | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses.upload | getting-started#line (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| line.multiple | ส่งใบเสร็จหลายใบ | ส่งหลายบิลพร้อมกันได้ไหม / รูปเดียวหลายใบเสร็จ / ส่งรูปบิลหลายรูป / น้องแยกบิลให้ได้ไหม | ส่งรูปแต่ละใบให้เห็นชัด แล้วรอน้องมั่งมีอ่านได้เลยค่ะ 😊 ถ้ามีคำถามเรื่องรูป ให้เลือกตามเอกสารจริง แล้วตรวจจำนวนรายการกับยอดก่อนยืนยัน ใช้รูปที่ส่งไว้เดิมรอผลได้ค่ะ | สมาชิก; expense.receipt.line_upload หรือ expense.receipt.upload หรือ expense.create | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses.upload | getting-started#line (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| line.totals | ถามยอดรายจ่าย | รายจ่ายเดือนนี้เท่าไหร่ / ดูยอดสัปดาห์นี้ / ถามยอดของสาขาได้ไหม / น้องสรุปค่าใช้จ่ายให้หน่อย | บอกช่วงวันที่และสาขาที่ต้องการได้เลยค่ะ 😊 น้องมั่งมีดูข้อมูลตามสิทธิ์ของคุณ โดยแยกยอดรายจ่ายและยอดค้างจ่ายให้ตามคำถามค่ะ | สมาชิก; expense.read หรือ expense.read_own; ความสามารถ: expense.list_recent | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#line (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| line.support | ติดต่อทีมงาน | ติดต่อเจ้าหน้าที่ / อยากคุยกับคน / ระบบมีปัญหาติดต่อใคร / ขอทีมงานช่วย | พิมพ์ “ติดต่อเจ้าหน้าที่” แล้วบอกชื่อร้านกับเรื่องที่อยากให้ช่วยได้เลยค่ะ 💚 เก็บรหัสผ่านและรหัสยืนยันไว้กับตัวคุณเองนะคะ 🙂 | สมาชิก; สมาชิกทุกคน | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#line (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ค่าใช้จ่ายและหลักฐาน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| expense.start | เริ่มบันทึกค่าใช้จ่าย | เริ่มลงค่าใช้จ่ายยังไง / รายจ่ายเข้าระบบแล้วทำอะไรต่อ / เริ่มบันทึกบิลตรงไหน / รับใบเสร็จเข้าร้านยังไง | เริ่มจากเลือกสาขา แล้วส่งใบเสร็จหรือบันทึกด้วยมือตามช่องทางและสิทธิ์ที่ร้านเปิดไว้ค่ะ 😊 ระบบเก็บเป็นร่างให้ตรวจผู้ขาย เลขที่เอกสาร วันที่ ยอดและไฟล์แนบก่อน ร่าง การยืนยันเอกสาร และการบันทึกจ่ายเป็นคนละขั้นตอนนะคะ | สมาชิก; expense.read หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#overview (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.status | สถานะเอกสารกับสถานะจ่ายเงิน | ยืนยันแล้วแปลว่าจ่ายแล้วไหม / ทำไมสถานะมีสองบรรทัด / ยืนยันบิลแล้วต้องจ่ายอีกไหม / สถานะตรวจและจ่ายต่างกันไหม | ดูแยกกันได้เลยค่ะ 😊 สถานะเอกสารบอกความคืบหน้าการตรวจ ส่วนสถานะการจ่ายบอกว่าจ่ายให้ผู้ขายหรือยัง เอกสารยืนยันแล้วอาจรอจ่าย และรายการจ่ายแล้วอาจยังรอตรวจเอกสารค่ะ | สมาชิก; expense.read หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#overview (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.find | ค้นหารายการค่าใช้จ่าย | หาบิลร้านเดิมยังไง / ดูรายการตามสถานะที่ไหน / ค้นหาบิลเก่าที่ไหน / กรองบิลรอตรวจยังไง | ที่หน้า “ค่าใช้จ่ายและใบเสร็จ” เลือกช่วงเวลาและสถานะ แล้วค้นหาด้วยชื่อผู้ขายหรือเลขที่เอกสารได้ค่ะ 😉 เปิดรายการที่พบเพื่อดูรายละเอียดต่อได้เลย | สมาชิก; expense.read หรือ expense.read_own; ความสามารถ: expense.list_recent | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#list (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.draft | ร่างต่างจากยืนยันแล้วอย่างไร | ร่างใช้เป็นยอดบัญชีแล้วหรือยัง / บันทึกไว้ก่อนแล้วค่อยตรวจได้ไหม / ร่างคืออะไร / บันทึกแล้วทำไมยังไม่ยืนยัน | ร่างเก็บไว้แก้และตรวจรายละเอียดก่อนยืนยันได้ค่ะ 😊 หากต้องแก้หลังยืนยัน ผู้มีสิทธิ์ใช้ “แก้ไขเอกสาร” ตามเงื่อนไขของรายการ โดยใช้เลขเอกสารเดิม หน้ารายจ่ายจะแจ้งเหตุผลและคนที่ช่วยได้เมื่อมีงานเชื่อมอยู่ค่ะ | สมาชิก; expense.read หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#overview (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.vat-display | VAT ที่พบในเอกสารหมายถึงอะไร | ตัวเลข VAT ด้านบนขอคืนได้เลยไหม / ยอดภาษีในหน้ารายจ่ายคือยอดยื่นไหม / VAT ในรายการคือภาษีซื้อไหม / มี VAT แล้วใช้สิทธิ์ได้เลยไหม | ยอด VAT ในหน้ารายการคือยอดที่พบในเอกสารค่ะ 😊 ส่วนยอดภาษีซื้อที่ใช้ยื่นขึ้นกับประเภทเอกสารและเงื่อนไขของแต่ละรายการ ตรวจสิทธิ์ภาษีซื้อให้ครบก่อนนำไปยื่นนะคะ | สมาชิก; expense.read หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#list (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.export | ส่งเอกสารให้นักบัญชี | เตรียมข้อมูลให้นักบัญชียังไง / ส่งรายจ่ายพร้อมหลักฐานได้ไหม / ส่งออกให้นักบัญชีตรงไหน / ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี | ตรวจรายการและหลักฐานให้ครบก่อนยืนยัน แล้วส่งออกชุดรายการและหลักฐานบนเว็บตามสิทธิ์ได้ค่ะ 🙂 คุณเป็นคนกดส่งออกเมื่อพร้อม เพื่อนำให้นักบัญชีตรวจและบันทึกบัญชีต่อ | สมาชิก; expense.export | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#overview (`apps/web/src/features/user-guide/expenses-guide.content.ts`) |
| expense.confirm | ตรวจและยืนยันรายจ่าย | ยืนยันบิลยังไง / ตรวจใบเสร็จตรงไหน / รอตรวจต้องทำอะไร / ร่างพร้อมยืนยันหรือยัง | เปิดรายจ่าย แล้วตรวจผู้ขาย วันที่ ยอด ภาษีและหลักฐานทีละขั้นค่ะ 😊 เมื่อข้อมูลครบ ผู้มีสิทธิ์กด “ยืนยันเอกสาร” ได้ ส่วนบันทึกจ่ายทำแยกเมื่อจ่ายเงินจริงค่ะ | สมาชิก; expense.confirm | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.correct | แก้รายจ่ายที่ยืนยันแล้ว | ยืนยันบิลผิดแก้ยังไง / แก้ยอดหลังยืนยัน / แก้วันที่รายจ่ายที่ยืนยัน / บิลยืนยันแล้วแก้ได้ไหม | ผู้มีสิทธิ์เปิดรายจ่ายแล้วใช้ “แก้ไขเอกสาร” ตามเงื่อนไขของรายการได้ค่ะ 😊 ถ้ามีงานเชื่อมอยู่ หน้านั้นจะบอกเหตุผลและทางแก้ เพื่อให้ใช้รายการเดิมต่อได้ค่ะ | สมาชิก; expense.review หรือ expense.confirm | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.void-help | ยกเลิกรายจ่าย | ยกเลิกบิลยังไง / รายจ่ายนี้ไม่ใช้แล้ว / ลบบิลที่เคยจ่ายแล้วได้ไหม / บิลมีประวัติแต่ไม่เอาแล้ว | รายจ่ายที่มีประวัติการจ่ายหรือเอกสารเชื่อมจะเก็บประวัติไว้ค่ะ 😊 หากต้องการยกเลิก เปิดรายจ่ายแล้วใช้ “ยกเลิกเอกสาร” พร้อมเหตุผลตามสิทธิ์และเงื่อนไขที่หน้าจอแจ้งได้เลย | สมาชิก; expense.void | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.duplicates | ตรวจบิลที่อาจซ้ำ | บิลซ้ำต้องทำไง / ระบบบอกอาจซ้ำ / ปลดรายการซ้ำได้ไหม / ส่งใบเสร็จซ้ำโดยไม่ได้ตั้งใจ | เปิดรายการที่ระบบเทียบไว้ แล้วดูผู้ขาย เลขที่ วันที่และยอดค่ะ 😉 ถ้าเป็นคนละการซื้อ ผู้มีสิทธิ์ยืนยันว่าเป็นคนละรายการพร้อมเหตุผลได้ ถ้าเป็นใบเดียวกัน ใช้รายการเดิมต่อได้ค่ะ | สมาชิก; expense.review หรือ expense.confirm | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.categories | เพิ่มหมวดหมู่รายจ่าย | เพิ่ม category ค่าใช้จ่ายใหม่ทำยังไงครับ / เพิ่มหมวดใหม่ตรงไหน / เปลี่ยนชื่อหมวดได้ไหม / หมวดที่ต้องใช้ไม่มี | เปิดหน้าจัดการหมวดค่าใช้จ่าย แล้วกด “เพิ่มหมวดหมู่” ได้ค่ะ 😊 หมวดที่ร้านสร้างแก้ชื่อได้ ส่วนหมวดที่มากับระบบใช้ชื่อมาตรฐานเดียวกันค่ะ | สมาชิก; expense.category.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses.categories | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.vendors | จัดการคู่ค้าและข้อมูลผู้ขาย | เพิ่มผู้ขายยังไง / แก้ที่อยู่คู่ค้า / กรอกเลขผู้เสียภาษีร้านค้า / ร้านผู้รับเงินไม่มีในรายการ | เปิด “คู่ค้า” แล้วค้นหาชื่อที่มีอยู่ก่อนได้ค่ะ 🤗 ใช้ข้อมูลเดิมต่อหรือเพิ่มรายใหม่ พร้อมตรวจชื่อ ที่อยู่และเลขผู้เสียภาษีจากเอกสารจริงก่อนบันทึกค่ะ | สมาชิก; accounting.counterparty.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| expense.vat-credit | VAT ใช้เป็นภาษีซื้อได้ไหม | มี VAT แล้วขอคืนได้ไหม / ไม่มีรูปใบกำกับใช้ VAT ได้ไหม / ตรวจสิทธิ์ภาษีซื้อตรงไหน / ใบเสร็จธรรมดาใช้เครดิต VAT ได้ไหม | ตรวจประเภทเอกสารและคำตอบสิทธิภาษีซื้อก่อนใช้ VAT ยื่นค่ะ 😊 สิทธิ์ขึ้นกับเงื่อนไขของรายการ หากมีตัวจริงแต่ยังไม่มีรูป เลือก “มีตัวจริง ยังไม่ได้แนบรูป” แล้วแนบรูปทีหลังได้ค่ะ | สมาชิก; expense.review หรือ expense.confirm | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#expenses (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## บันทึกการจ่าย

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| payment.record | บันทึกว่าจ่ายรายจ่ายแล้ว | บันทึกจ่ายยังไง / จ่ายเงินแล้วต้องกดอะไร / โอนให้ร้านแล้ว / จ่ายเงินสดบันทึกได้ไหม | เปิดรายจ่ายที่พร้อมจ่าย ตรวจผู้รับเงิน ยอด วันที่และวิธีจ่ายค่ะ 😊 โอนผ่านธนาคารหรือจ่ายเงินสดจริงก่อน แล้วกลับมาบันทึกประวัติการจ่ายในระบบนะคะ | สมาชิก; expense.payment.record | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#payments (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| payment.slip | แนบหลักฐานการจ่าย | แนบสลิปยังไง / ลืมแนบหลักฐานตอนจ่าย / เพิ่มรูปการโอนทีหลัง / ดูสลิปเก่าตรงไหน | เปิดประวัติการจ่ายของรายจ่าย แล้วเพิ่มหลักฐานในครั้งที่จ่ายไว้ได้ค่ะ 😊 ตรวจยอดและวันที่ให้ตรง ใช้ประวัติเดิมแนบรูปเพิ่มได้เลยค่ะ | สมาชิก; expense.payment.record | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#payments (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| payment.partial | จ่ายบางส่วน | ทยอยจ่ายได้ไหม / จ่ายมัดจำยังไง / ยังจ่ายไม่ครบ / ค้างจ่ายหลังโอนบางส่วน | ใส่ยอดที่จ่ายจริงในครั้งนี้ได้ค่ะ 😊 ระบบเก็บประวัติแต่ละครั้งและยอดคงค้าง พอจ่ายส่วนที่เหลือแล้ว กลับมาบันทึกเพิ่มตามยอดจริงได้เลย | สมาชิก; expense.payment.record | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#payments (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ใบเบิกและบัญชีรับเงินคืน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| reimbursement.meaning | ใบเบิกคืออะไร | คำขอเบิกกับใบเบิกต่างกันยังไง / ฉันสำรองเงินเองแล้วต้องใช้เมนูไหน / ใบเบิกคืออะไร / จ่ายแทนร้านแล้วขอคืนอย่างไร | ใบเบิกใช้ขอเงินคืนเมื่อคุณสำรองจ่ายให้ร้านค่ะ 😊 ข้อความ LINE บางจุดเรียกว่าคำขอเบิก ซึ่งเป็นรายการเดียวกัน เริ่มได้ที่ “การเบิกจ่าย” แล้วตรวจร่าง ส่งอนุมัติ จ่ายคืน และเซ็นตามขั้นตอน จะใช้ฉบับพิมพ์เซ็นบนกระดาษก็ได้ค่ะ | สมาชิก; reimbursement.read หรือ reimbursement.read_related หรือ reimbursement.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | reimbursements#quick-start (`apps/web/src/features/user-guide/reimbursement-guide.content.ts`) |
| reimbursement.roles | ทำไมเห็นแท็บเบิกจ่ายไม่เหมือนกัน | เพื่อนเห็นแท็บแต่ฉันไม่เห็น / หาเมนูเบิกจ่ายไม่เจอ / ทำไมไม่เห็นแท็บอนุมัติ / ฝ่ายบัญชีเห็นใบเบิกแบบไหน | หน้า “การเบิกจ่าย” จัดงานตามหน้าที่และสิทธิ์ค่ะ 🤗 ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นแท็บต่างกัน หากต้องการใช้ส่วนอื่น ให้เจ้าของกิจการช่วยตรวจสิทธิ์ โดยใช้ใบเบิกเดิมต่อได้ค่ะ | สมาชิก; reimbursement.read หรือ reimbursement.read_related หรือ reimbursement.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | reimbursements#tabs (`apps/web/src/features/user-guide/reimbursement-guide.content.ts`) |
| claim.create | สร้างใบเบิก | ขอเบิกเงินยังไง / สำรองจ่ายแล้วเบิกคืน / สร้างใบเบิกในไลน์ / เริ่มใบเบิกจากรูป | บอกรายการและยอดที่สำรองจ่าย พร้อมหลักฐานกับวิธีรับเงินคืนค่ะ 😊 ตรวจร่างแล้วส่งอนุมัติ ส่วนการเซ็นทำหลังจ่ายคืนตามขั้นตอนค่ะ | สมาชิก; reimbursement.create; ความสามารถ: reimbursement.draft.get_options | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.approve | อนุมัติหรือไม่อนุมัติใบเบิก | อนุมัติใบเบิกตรงไหน / ใครกดอนุมัติได้ / ไม่อนุมัติใบเบิกยังไง / มีใบเบิกรอฉันทำอะไร | เปิดใบเบิกที่รอคุณ แล้วตรวจรายการกับหลักฐานก่อนตัดสินค่ะ 😊 ถ้าต้องส่งกลับ ระบุเหตุผลให้ผู้เบิกแก้ต่อได้ ส่วนการจ่ายคืนเป็นขั้นตอนหลังอนุมัติค่ะ | สมาชิก; reimbursement.approve; ความสามารถ: reimbursement.list_pending_approvals | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.pay | จ่ายคืนตามใบเบิก | จ่ายใบเบิกยังไง / บันทึกโอนคืนพนักงาน / แนบสลิปใบเบิก / ใบเบิกอนุมัติแล้วทำอะไรต่อ | เปิดใบเบิกที่พร้อมจ่าย ตรวจบัญชีรับเงินคืนและยอดค่ะ 😊 จ่ายจริงก่อนบันทึก ถ้าน้องมั่งมีขอหลักฐาน ส่งสลิปแล้วตรวจการ์ดยืนยันก่อนกดได้เลย | สมาชิก; reimbursement.payment.record; ความสามารถ: expense.action.preview | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.sign | เซ็นใบเบิกหลังจ่าย | เซ็นใบเบิกตรงไหน / ต้องเซ็นก่อนจ่ายไหม / เซ็นบนกระดาษได้ไหม / ทำไมใบเบิกยังไม่จบ | หลังจ่ายคืน ผู้เบิกและผู้อนุมัติเซ็นตามหน้าที่ได้ค่ะ ☺️ หรือแนบใบที่เซ็นบนกระดาษครบ แล้วเปิดใบเบิกดูช่องลายเซ็นที่ต้องเติมให้ครบค่ะ | สมาชิก; reimbursement.read หรือ reimbursement.read_related หรือ reimbursement.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.payout | บัญชีรับเงินคืน | เปลี่ยนบัญชีรับเงินคืน / เพิ่มบัญชีเบิกเงิน / รับเงินสดแทนโอนได้ไหม / บัญชีใบเบิกใช้ของใคร | เปิด “บัญชีรับเงินคืนของฉัน” เพื่อจัดการบัญชีของคุณค่ะ 😊 ตอนทำใบเบิก เลือกบัญชีของใบนั้นหรือรับเงินสดได้ ใบที่ส่งแล้วใช้บัญชีเดิมของใบนั้น แม้เปลี่ยนบัญชีประจำภายหลังค่ะ | สมาชิก; reimbursement.create หรือ reimbursement.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.send-back | ส่งใบเบิกกลับไปแก้บัญชี | บัญชีผิดหลังอนุมัติทำไง / ส่งกลับให้แก้บัญชีรับเงิน / ให้พนักงานเปลี่ยนบัญชีก่อนจ่าย / แก้ชื่อบัญชีหลังส่งใบเบิก | ถ้าพบบัญชีรับเงินผิดก่อนจ่าย ให้ผู้มีสิทธิ์ส่งใบเบิกกลับแก้บัญชีค่ะ 🙂 ผู้เบิกแก้ข้อมูลแล้วให้ผู้รับผิดชอบตรวจใหม่ เมื่อบัญชีตรงแล้วจึงโอนเงินนะคะ | สมาชิก; reimbursement.payment.record หรือ reimbursement.approve หรือ reimbursement.finance_review | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.cancel | ยกเลิกใบเบิก | ยกเลิกใบเบิกยังไง / ส่งใบเบิกผิด / ใบเบิกไม่ต้องใช้แล้ว / ค่าใช้จ่ายของใบเบิกถูกยกเลิก | เปิดใบเบิกแล้วใช้ “ยกเลิกใบเบิกนี้” พร้อมเหตุผลได้ตามสิทธิ์และเงื่อนไขค่ะ 😊 ถ้ารายจ่ายของใบเดิมถูกยกเลิกแล้ว ให้ยกเลิกใบเบิกนี้และทำใบใหม่สำหรับขั้นตอนจ่ายต่อค่ะ | สมาชิก; reimbursement.cancel_own หรือ reimbursement.finance_review | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| claim.submit | ส่งใบเบิกให้อนุมัติ | ส่งใบเบิกยังไง / ร่างใบเบิกแล้วทำอะไรต่อ / ส่งอนุมัติใบเบิก / ให้หัวหน้าตรวจใบเบิก | ตรวจรายการ หลักฐาน สาขาและวิธีรับเงินคืน แล้วกด “ส่งอนุมัติ” ค่ะ 😊 ถ้าส่งผ่าน LINE ตรวจการ์ดแล้วกดยืนยันเมื่อพร้อม คุณเป็นคนยืนยันส่งในขั้นตอนนี้ค่ะ | สมาชิก; reimbursement.submit; ความสามารถ: expense.action.preview | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; reimbursement | getting-started#claims (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ใบเตรียมจ่ายและใบสำคัญจ่าย

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| voucher.meaning | ใบสำคัญจ่ายคืออะไร ทำไมต้องทำ | ใบสำคัญจ่ายคืออะไร / ทำไมต้องทำใบสำคัญจ่าย / ใบเตรียมจ่ายกับใบสำคัญจ่ายต่างกันไหม / ร่างใบเตรียมจ่ายแปลว่าจ่ายแล้วไหม | ใบเตรียมจ่ายรวมรายจ่ายของผู้รับเงินคนเดียวให้ตรวจและอนุมัติก่อนจ่ายค่ะ 😊 ร่างคือช่วงจัดเตรียม รอจ่ายคืออนุมัติแล้วรอบันทึกจ่าย เมื่อจ่ายจริงและบันทึกแล้ว จึงเป็นใบสำคัญจ่ายค่ะ | สมาชิก; expense.disbursement.read | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | expenses#disbursement-vouchers (`apps/web/src/features/user-guide/disbursement-voucher-guide.content.ts`) |
| voucher.create | สร้างใบเตรียมจ่าย | ทำใบเตรียมจ่ายยังไง / รวมบิลจ่ายร้านเดียว / สร้าง PV จากอะไร / เลือกบิลเข้าใบเตรียมจ่าย | เปิดช่องทางใบเตรียมจ่ายที่ร้านเปิดไว้ เลือกผู้รับเงินกับรายจ่ายยืนยันแล้วที่ยังค้างจ่ายค่ะ 😊 ตรวจรายการ แล้วใช้ “บันทึกร่าง” และ “ส่งอนุมัติ” ตามขั้นตอนได้เลย | สมาชิก; expense.disbursement.prepare | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#vouchers (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| voucher.approve | อนุมัติใบเตรียมจ่าย | อนุมัติใบเตรียมจ่าย / ส่งกลับใบเตรียมจ่ายยังไง / คนทำอนุมัติเองได้ไหม / ต้องให้ใครตรวจใบเตรียมจ่าย | ผู้อนุมัติเปิดใบที่รอตนเอง ตรวจผู้รับเงินและรายการก่อนอนุมัติค่ะ 😊 ถ้าต้องแก้ ใช้ “ส่งกลับให้แก้” พร้อมเหตุผล ส่วนผู้จัดทำใช้ “กลับไปแก้” เมื่อหน้าจอเปิดให้ได้ค่ะ | สมาชิก; expense.disbursement.approve | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#vouchers (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| voucher.pay | ใบสำคัญจ่ายเกิดเมื่อใด | จ่ายใบเตรียมจ่ายยังไง / ทำไมยังไม่เป็นใบสำคัญจ่าย / บันทึกว่าจ่ายแล้วตรงไหน / จ่าย PV หลังอนุมัติ | หลังอนุมัติและจ่ายจริง ตรวจยอด วันที่ วิธีจ่ายและหลักฐาน แล้วกด “บันทึกว่าจ่ายแล้ว” ค่ะ 😊 เอกสารจะเป็นใบสำคัญจ่ายโดยใช้เลขที่เดิมค่ะ | สมาชิก; expense.disbursement.pay | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#vouchers (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ใบรับรองแทนใบเสร็จ

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| substitute.meaning | ใบรับรองแทนใบเสร็จคืออะไร | ร้านออกใบเสร็จไม่ได้ต้องทำไง / ใบทดแทนใช้ทำอะไร / ใบรับรองแทนใบเสร็จใช้ทำอะไร / แม่ค้าไม่มีใบเสร็จใช้อะไรแทน | ใบรับรองแทนใบเสร็จเป็นหลักฐานรายจ่ายของร้าน เมื่อจ่ายเงินจริงเพื่อกิจการแต่ผู้รับเงินมีเอกสารให้ไม่ครบค่ะ 😊 เปิดรายจ่ายที่เกี่ยวข้อง แล้วตรวจข้อมูลและหลักฐานตามขั้นตอนของร้านได้เลย | สมาชิก; expense.review หรือ expense.confirm หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | substitute-receipts#overview (`apps/web/src/features/user-guide/substitute-receipt-guide.content.ts`) |
| substitute.evidence | หลักฐานประกอบกับหลักฐานการจ่าย | สลิปกับรูปของซื้อใช้แทนกันไหม / ทำไมต้องแนบหลักฐานสองแบบ / ต้องมีหลักฐานอะไรบ้าง / รูปของกับหลักฐานโอนต่างกันไหม | แยกหลักฐานเป็นสองส่วนจะตรวจง่ายค่ะ 😊 หลักฐานประกอบบอกว่าซื้ออะไร เช่น บิลเขียนมือ ภาพสินค้า หรือข้อความสั่งซื้อ ส่วนหลักฐานการจ่ายบอกว่าจ่ายจริง เช่น สลิปหรือใบสำคัญรับเงินที่ผู้รับเงินเซ็นแล้ว | สมาชิก; expense.review หรือ expense.confirm หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | substitute-receipts#evidence (`apps/web/src/features/user-guide/substitute-receipt-guide.content.ts`) |
| substitute.review-sign | อ่านเอกสารก่อนเซ็น | ทำไมกดลงชื่อไม่ได้ / ต้องอ่านฉบับเต็มก่อนอนุมัติไหม / อ่านใบรับรองก่อนเซ็นที่ไหน / ตรวจใบที่เซ็นกระดาษยังไง | เปิดอ่านใบรับรองฉบับเต็มก่อนเซ็นหรืออนุมัติตามหน้าที่ได้เลยค่ะ ☺️ การเซ็น ยืนยันคำรับรอง และอนุมัติทำบนเว็บตามสิทธิ์ หากเซ็นบนกระดาษ ให้แนบฉบับที่เซ็นครบ ผู้ตรวจรับอ่านทุกหน้าก่อนตรวจรับค่ะ | สมาชิก; expense.review หรือ expense.confirm หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | substitute-receipts#sign (`apps/web/src/features/user-guide/substitute-receipt-guide.content.ts`) |
| substitute.create | ทำใบรับรองแทนใบเสร็จ | ไม่มีใบเสร็จทำยังไง / สร้างใบรับรองแทนใบเสร็จ / แม่ค้าออกบิลไม่ได้ / ค่าใช้จ่ายไม่มีเอกสาร | เปิด “ใบรับรองแทนใบเสร็จ” แล้วเลือกรายจ่ายหรือเริ่มรายการใหม่ตามสิทธิ์ค่ะ 😊 กรอกผู้รับเงิน เหตุผล รายการและหลักฐานจริงให้ครบ ก่อนออกใบตามขั้นตอนค่ะ | สมาชิก; expense.review หรือ expense.confirm หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#substitute (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| substitute.paper | เซ็นใบรับรองบนกระดาษ | ใบรับรองเซ็นกระดาษได้ไหม / ไม่มีลายเซ็นออนไลน์ / แนบใบรับรองที่เซ็นแล้ว / ผู้จ่ายเซ็นใบรับรองตรงไหน | เลือกวิธีเซ็นตามขั้นตอนของใบรับรองได้ค่ะ ☺️ ถ้าเซ็นบนกระดาษ แนบฉบับที่เซ็นครบให้ผู้ตรวจเปิดอ่านทุกหน้าก่อนตรวจรับบนเว็บค่ะ | สมาชิก; expense.review หรือ expense.confirm หรือ expense.read_own | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses | getting-started#substitute (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## 50 ทวิและ ภ.ง.ด.53

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| wht.certificate-meaning | 50 ทวิคืออะไร | 50 ทวิ คืออะไร / ทำไมต้องออก 50 ทวิ / ใบ 50 ทวิใช้ทำอะไร / มี 50 ทวิแล้วต้องยื่นอีกไหม | หนังสือรับรอง 50 ทวิเป็นใบที่ผู้จ่ายให้ผู้รับเงิน เพื่อบอกยอดจ่ายและภาษีที่หักไว้ค่ะ 😊 ส่วนการยื่นและนำส่งภาษีเป็นอีกขั้นตอนที่ทำต่อค่ะ | สมาชิก; wht.certificate.read | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | tax#wht (`apps/web/src/features/user-guide/tax-guide.content.ts`) |
| wht.pnd53-due | ภงด.53 ต้องยื่นเมื่อไหร่ | ภงด.53 ต้องยื่นเมื่อไหร่ / ภงด 53 นำส่งวันไหน / ดูวันครบกำหนด ภงด53 ตรงไหน / ต้องนำส่ง ภงด53 วันไหน | ดูวันครบกำหนดที่งวด “ภ.ง.ด.53” ได้ค่ะ 😊 ถ้ายังเว้นวันไว้ ระบบใช้วันที่ 7 ของเดือนถัดไปสำหรับแบบกระดาษ ตรวจวันของงวดก่อนเตรียมยื่นนะคะ | สมาชิก; wht.pnd53.read | ENTERPRISE 1999; wht_pnd53 | tax#wht (`apps/web/src/features/user-guide/tax-guide.content.ts`) |
| wht.calculation | หัก ณ ที่จ่ายคิดอย่างไร | หัก ณ ที่จ่ายคิดยังไง / ต้องหักเท่าไหร่ / คำนวณหักภาษีจากยอดไหน / หักภาษีรวม VAT หรือเปล่า | ใช้ยอดก่อน VAT คูณอัตราตามประเภทเงินได้ค่ะ 😊 เลือก “จ่ายค่าอะไร” ให้ตรงกับรายการก่อน เพื่อให้ระบบใช้อัตราของประเภทนั้นค่ะ | สมาชิก; expense.create หรือ procurement.supplier_payment.read | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | tax#wht (`apps/web/src/features/user-guide/tax-guide.content.ts`) |
| wht.outside | จดเลขที่ 50 ทวิที่ทำนอกระบบ | ไม่มีแพ็ก 1999 ทำ 50 ทวิยังไง / จดเลขที่ใบ 50 ทวิ / แนบรูปใบ 50 ทวิจากโปรแกรมอื่น / ทำใบนอกระบบแล้วบันทึกที่ไหน | ทำใบจากแบบฟอร์มกรมสรรพากรหรือโปรแกรมอื่น แล้วใช้ “จดเลขที่ใบ” ที่รายการ หรือ “จดเลขที่ใบ 50 ทวิ” ที่หน้ารายจ่ายค่ะ 😊 ใส่เลขที่และวันที่ แนบรูปหรือพีดีเอฟได้ถ้ามี ระบบช่วยเก็บเลขที่และไฟล์ของใบที่ทำนอกระบบไว้ให้ค้นเจอค่ะ | สมาชิก; wht.external_certificate.link | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999 | getting-started#wht (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| wht.system | ออก 50 ทวิในระบบ | ออก 50 ทวิในโปรแกรม / ดาวน์โหลดหนังสือรับรอง 50 ทวิ / แพ็ก 1999 ทำใบยังไง / ระบบออกเลขที่ 50 ทวิให้ได้ไหม | ร้านที่เปิดใช้การออก 50 ทวิในระบบและผู้มีสิทธิ์ออกใบ ตรวจผู้รับเงิน เลขผู้เสียภาษี ที่อยู่และการจ่ายได้ค่ะ 😊 จากนั้นออกใบตามรายการที่เลือก แล้วดาวน์โหลดเอกสารไปใช้ค่ะ | สมาชิก; wht.certificate.issue | ENTERPRISE 1999; wht_50bis | getting-started#wht (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |
| pnd53.prepare | เตรียม ภ.ง.ด.53 และบันทึกการยื่น | ทำ ภงด53 ยังไง / เตรียมภาษีหัก ณ ที่จ่ายส่งบัญชี / ดูสรุป ภงด53 เดือนก่อน / ออก 50 ทวิแล้วต้องทำอะไรต่อ | เปิดงวด “ภ.ง.ด.53” ของเดือนที่ต้องการ แล้วตรวจรายการหักภาษีกับข้อมูลผู้รับเงินค่ะ 😊 ผู้มีสิทธิ์ตรวจและส่งออกตามขั้นตอนของงวดได้ การยื่นและนำส่งภาษีทำต่อแยกจากการออก 50 ทวิค่ะ | สมาชิก; wht.pnd53.read; ความสามารถ: wht.get_month_summary | ENTERPRISE 1999; wht_pnd53 | getting-started#wht (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## รายงาน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| report.access | รายงานที่แต่ละคนเรียกดูได้ | ทำไมฉันเห็นรายงานน้อยกว่าเจ้าของ / ส่งออกแล้วตรวจสิทธิ์อีกไหม / เปิดรายงานแล้วไม่มีสิทธิ์ / บัญชีดูรายงานได้ทุกอย่างไหม | เปิด “รายงาน” แล้วดูรายการรายงานได้ค่ะ 😊 ป้าย “ไม่มีสิทธิ์” บอกว่ารายงานนั้นต้องขอสิทธิ์เพิ่มจากเจ้าของกิจการ การเปิดดูและส่งออกใช้สิทธิ์แยกกัน ระบบตรวจให้ทุกครั้งค่ะ | สมาชิก; report.catalog.read หรือ report.snapshot.read | ไม่อยู่ใน 4 แพ็กมาตรฐาน ต้องเปิด feature เพิ่ม; reports | reports#overview (`apps/web/src/features/user-guide/reports-guide.content.ts`) |
| report.run-help | เรียกและส่งออกรายงาน | เรียกรายงานยังไง / รายงานขึ้นไม่มีสิทธิ์ / เลือกรอบรายงานตรงไหน / ส่งรายงานให้นักบัญชี | เปิด “รายงาน” ที่ร้านเปิดใช้ เลือกงวดหรือวันที่ แล้วกด “เรียกรายงาน” ได้ค่ะ 😊 การดูและส่งออกใช้สิทธิ์ตามงาน หากต้องการสิทธิ์เพิ่ม ให้เจ้าของกิจการช่วยตรวจให้ได้ค่ะ | สมาชิก; report.catalog.read หรือ report.snapshot.read | ไม่อยู่ใน 4 แพ็กมาตรฐาน ต้องเปิด feature เพิ่ม; reports | getting-started#reports (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## หน้าแรก

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| home.range | ดูรายจ่ายเดือนเก่าที่หน้าแรก | หน้าแรกยอดศูนย์แต่มีบิล / เลือกวันที่หน้าแรก / ดูรายจ่ายเดือนที่แล้ว / ไตรมาสนี้ไม่เห็นบิลกันยายน | ที่ “หน้าแรก” กด “เลือกวันที่” แล้วเลือก “ตั้งแต่” กับ “ถึง” ได้ค่ะ 😊 ระบบเริ่มไว้ที่เดือนก่อน ยอดรายจ่ายจะตามช่วงที่เลือก ส่วน “ใบเสร็จรอตรวจ” และ “ค้างจ่ายทั้งหมด” รวมทุกช่วงเวลาค่ะ | สมาชิก; dashboard.read | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; dashboard_notifications | getting-started#home (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## การแจ้งเตือน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| notifications.read | ดูงานที่รอจากการแจ้งเตือน | ดูแจ้งเตือนตรงไหน / กระดิ่งมีตัวเลข / อ่านแล้วงานเสร็จไหม / ทำไมเห็นแจ้งเตือนเก่า | เปิดกระดิ่งหรือ “การแจ้งเตือน” แล้วเลือกรายการที่เกี่ยวข้องได้ค่ะ 🙂 การอ่านช่วยให้เห็นงานที่รอ จากนั้นเปิดเอกสารไปทำขั้นตอนของงานนั้นต่อค่ะ | สมาชิก; notification.read; ความสามารถ: notifications.list_open_alerts | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; dashboard_notifications | getting-started#notifications (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## ลายเซ็นของฉัน

| id | หัวข้อ | ตัวอย่างคำถาม | คำตอบที่จะส่ง (ตรงตาม body) | ใครเห็น / สิทธิ์ / ความสามารถ | แพ็กเกจ / feature | ที่มา |
|---|---|---|---|---|---|---|
| signature.setup | ตั้งค่าลายเซ็นของฉัน | ลายเซ็นอนุมัติต้องตั้งค่ายังไงครับ / เพิ่มลายเซ็นตรงไหน / วาดลายเซ็นของฉัน / เปลี่ยนรูปลายเซ็น | เปิด “ลายเซ็นของฉัน” แล้วกด “เพิ่มลายเซ็น” ได้ค่ะ ☺️ เก็บภาพลายเซ็นของคุณไว้ก่อน แล้วกลับไปเซ็นเอกสารตามหน้าที่เมื่อถึงขั้นตอนค่ะ | สมาชิก; expense.signature.self_manage หรือ expense.review หรือ expense.confirm หรือ expense.signature.manage | STARTER 249, BASIC 499, PRO 999, ENTERPRISE 1999; expenses.signatures | getting-started#signature (`apps/web/src/features/user-guide/getting-started-guide.content.ts`) |

## Approval handoff

No approval was recorded by the implementation lane. After the owner approves the exact text, the controller sets v6 to APPROVED with reviewer `owner:<date>`, regenerates W00 and reruns knowledge/whole-chain checks. New source changes require re-pinning the getting-started source hash before release.

## LINE-HELP-ALL-2 wording review

All 68 v6 bodies use 1–2 warm face emoji or the brand heart, natural feminine Thai particles and plain LINE text; no robot emoji or persona override is needed. Bodies remain under 4096 UTF-8 bytes and about 80 Thai words, metadata under 32 KiB. Access policy and questions are unchanged. The web source guide keeps neutral Thai without particles or emoji.

Removed scolding/defensive wording: อย่าคิดว่าการหยุดจ่ายเป็นคำขอลบข้อมูล; การถามนี้ยังไม่ได้ยกเลิกหรือขอคืนเงินให้; อย่าส่งต่อให้คนอื่น; อย่าส่งรูปเดิมซ้ำเพื่อเร่งงาน; อย่าบันทึกจ่ายซ้ำเพียงเพื่อแนบรูป; อย่าโอนเข้าบัญชีที่รู้ว่าผิด. The revised bodies retain the facts as next steps, privacy reminders and separate confirmations.

Corrections: บริษัทของฉัน is a card/menu label, not an exact accepted typed command, so steps now type เปลี่ยนบริษัท. โปรโมชั่น and ติดต่อเจ้าหน้าที่ are described as typed commands, rather than guessed current rich-menu labels (แพ็กเกจและราคา and ติดต่อเรา). The web door is named เปิดเว็บบริษัทนี้. The claim's opening cancel button is ยกเลิกใบเบิกนี้; ยกเลิกใบเบิก is the confirmation. The withholding field is จ่ายค่าอะไร. Outside 50 ทวิ has distinct row/expense buttons จดเลขที่ใบ / จดเลขที่ใบ 50 ทวิ.

The reused public-policy card body is unchanged: its named เปิดร้านใหม่ button exists on the LINE company/door card. Its remaining steps describe filling shop details and package purchase without inventing a LIFF button name. No served public-policy wording changed. One served staff promotion hint now says พิมพ์ โปรโมชั่น instead of naming a menu button; its owner/staff/signup gates are unchanged. This owner brief overrides the old ก12 freeze only for these help-card revisions and their source/review pins.

## ตรวจชื่อปุ่ม/เมนู

The table covers every named quoted control/page/command in the revised bodies and the related rich-menu labels. Concept words such as ผู้ขาย, รายจ่าย and หลักฐาน describe the record, rather than naming an extra control. Exact source lines are pinned by a gateway spec.

| label | where the customer sees it | file:line |
|---|---|---|
| กลับไปแก้ | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:127` |
| การเบิกจ่าย | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:209` |
| การแจ้งเตือน | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:382` |
| กำหนดหน้าที่พนักงาน | เมนูหรือปุ่มหน้าจัดการพนักงานบนเว็บ | `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:232` |
| คู่ค้า | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:199` |
| ค่าใช้จ่ายและใบเสร็จ | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:169` |
| ค้างจ่ายทั้งหมด | ชื่อตัวเลขบนการ์ดรายจ่ายหน้าแรก | `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:116` |
| จดเลขที่ใบ | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:424` |
| จดเลขที่ใบ 50 ทวิ | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:28` |
| จ่ายค่าอะไร | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:1439` |
| ตั้งค่าร้าน | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:361` |
| ตั้งแต่ | ชื่อช่องเลือกวันที่บนการ์ดรายจ่ายหน้าแรก | `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:128` |
| ติดต่อเจ้าหน้าที่ | คำสั่งที่พิมพ์ใน LINE; STAFF_CONTACT_COMMAND รับที่ staffMenuCommand | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:17` |
| ติดต่อเรา | พื้นที่ rich menu; เป็นคนละคำสั่งกับขอคุยทีมงาน | `scripts/line-oa/rich-menu-v2-ver3.manifest.json:93` |
| ถึง | ชื่อช่องเลือกวันที่บนการ์ดรายจ่ายหน้าแรก | `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:128` |
| บริษัทของฉัน | ชื่อการ์ดและพื้นที่ rich menu; พื้นที่นี้ส่ง /companies | `scripts/line-oa/rich-menu-v2-ver3.manifest.json:40` |
| บัญชีรับเงินคืนของฉัน | ลิงก์จากหน้าใบเบิกและชื่อหน้าบัญชีรับเงินคืน | `apps/web/src/features/reimbursements/ReimbursementPayoutAccountPage.tsx:20` |
| บันทึกร่าง | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:247` |
| บันทึกว่าจ่ายแล้ว | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:274` |
| พนักงาน | เมนูหรือปุ่มหน้าจัดการพนักงานบนเว็บ | `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:231` |
| พนักงานและสิทธิ์ | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:347` |
| ภ.ง.ด.53 | แท็บแบบภาษีและชื่อแบบภาษีบนเว็บ | `apps/web/src/features/tax/WithholdingPage.tsx:239` |
| มีตัวจริง ยังไม่ได้แนบรูป | ตัวเลือกขั้นหลักฐานรายจ่าย | `apps/web/src/features/expenses/ExpensesPages.tsx:1336` |
| ยกเลิกเอกสาร | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:1644` |
| ยกเลิกใบเบิก | ปุ่มยืนยันในหน้าต่างยกเลิกใบเบิก | `apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx:87` |
| ยกเลิกใบเบิกนี้ | ปุ่มเริ่มยกเลิกหน้าใบเบิก | `apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx:53` |
| ยืนยันเอกสาร | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:1635` |
| รายงาน | ชื่อหน้ารายงานบนเว็บ | `apps/web/src/features/reports/ReportsWorkspacePage.tsx:256` |
| ลายเซ็นของฉัน | แท็บหน้าค่าใช้จ่ายบนเว็บ | `apps/web/src/common/i18n/workspace-dictionary.ts:1791` |
| สาขา | ชื่อหน้าสาขาบนเว็บ | `apps/web/src/features/branch-settings/BranchSettingsPage.tsx:186` |
| ส่งกลับให้แก้ | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:122` |
| ส่งอนุมัติ | ปุ่มส่งใบเบิก; ใบเตรียมจ่ายใช้คำเดียวกัน | `apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx:53` |
| หน้าแรก | เมนูบนเว็บ | `packages/contracts/src/menu-entitlements.ts:21` |
| เปลี่ยนบริษัท | คำสั่งที่พิมพ์ใน LINE; parser ตอบด้วยการ์ดร้าน | `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic.ts:52` |
| เปิดร้านใหม่ | ปุ่มการ์ดร้านใน LINE เมื่อเจ้าของกิจการสมัครได้ | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:269` |
| เปิดเว็บบริษัทนี้ | ปุ่มบนการ์ดร้านและตัวเลือกร้านใน LINE | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:91` |
| เพิ่มพนักงาน | เมนูหรือปุ่มหน้าจัดการพนักงานบนเว็บ | `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:365` |
| เพิ่มลายเซ็น | ปุ่มหน้าลายเซ็นบนเว็บ | `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:584` |
| เพิ่มหมวดหมู่ | ปุ่มหน้าจัดการหมวดบนเว็บ | `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx:336` |
| เรียกรายงาน | ปุ่มหน้ารายงานบนเว็บ | `apps/web/src/features/reports/ReportsWorkspacePage.tsx:365` |
| เลือกวันที่ | ปุ่มหรือช่องบนเว็บ; ใช้ชื่อจากพจนานุกรมร่วม | `apps/web/src/common/i18n/workspace-dictionary.ts:674` |
| แก้ไขเอกสาร | ปุ่มเปิดแก้รายจ่ายที่ยืนยันแล้ว | `packages/contracts/src/expenses.ts:750` |
| แพ็กเกจ | เมนูบนเว็บ | `apps/web/src/features/web-core-workspace/settings-menu.logic.ts:150` |
| แพ็กเกจและราคา | พื้นที่ rich menu ปัจจุบัน; ส่งข้อความ โปรโมชั่น | `scripts/line-oa/rich-menu-v2-ver3.manifest.json:27` |
| โปรโมชั่น | คำสั่งที่พิมพ์ใน LINE; VIEW_PACKAGES_COMMAND | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:15` |
| ใบรับรองแทนใบเสร็จ | แท็บและชื่อหน้าศูนย์ใบรับรองบนเว็บ | `apps/web/src/common/i18n/workspace-dictionary.ts:1763` |
| ใบเสร็จรอตรวจ | ชื่อตัวเลขบนการ์ดรายจ่ายหน้าแรก | `apps/web/src/features/dashboard-notifications/DashboardPages.tsx:115` |
| ไม่มีสิทธิ์ | ป้ายสิทธิ์รายงานบนเว็บ | `apps/web/src/features/reports/ReportsWorkspacePage.tsx:32` |

## LINE-HELP-ALL-3: emotion emoji review

All 68 v6 bodies now use warm faces rather than object icons. Used set: 😊 ☺️ 🙂 😄 🤗 😉 💚. The full owner-approved allowlist also permits 😁 😆 🥰 😳; no sad, angry, sarcastic or robot faces are allowed. Every answer has a face and at most two emoji; menu/button names have none. Problem answers use gentle smiles or hugs. Words, questions, access rules and the neutral web guide are unchanged. The live staff open-shop hint keeps its 💡 because it is not a help card. At the end of LINE-HELP-ALL-3, v6 was DRAFT with reviewers [] and v4 remained served; the owner approval below supersedes that historical state. Card/pack hashes are recomputed from the exact body bytes, and W00 is refreshed. This brief overrides the old ก12 LINE wording freeze for the draft help emoji only.

Verification for this round is recorded in the final handoff; whole-chain and browser proof remain with the controller.

## LINE-HELP-APPROVE: bounded approved offers

Owner approval is retained exactly as `APPROVED`, reviewers [`owner-review:2026-10-21`]. No body, question, permission, feature or capability wording changed. The older ก12 freeze is superseded by this explicit owner approval.

The model-free selector first filters full eligibility. It normalizes NFC, lowercase and no spaces, then ranks each card by its best character-bigram Dice overlap with the title or a question. Score floor: 0.25. Stable ties keep card order. At most 12 cards and 12 KiB of serialized JSON metadata are offered. If none clears the floor, the same ranked top-N fallback is offered within those limits. No guide bodies or tenant facts enter this selector, and full-set rendering checks stay unchanged. Both bound intake and legacy routing use the active approved pack.

### Full-permission owner: metadata measurements

Counts below include the JSON array framing; characters use JavaScript string length, bytes use UTF-8. v4 is the prior unbounded 12-card offer; v6 is the bounded current offer.

| Message | v4 characters | v4 bytes | bounded v6 characters | bounded v6 bytes | cards |
|---|---:|---:|---:|---:|---:|
| เปิดร้านยังไง | 2198 | 4588 | 2445 | 5243 | 12 |
| 50 ทวิ คืออะไร | 2198 | 4588 | 2041 | 4333 | 9 |
| ขอคืนเงินค่าแพ็ก | 2198 | 4588 | 1197 | 2519 | 6 |
| ส่งใบเสร็จยังไง | 2198 | 4588 | 2411 | 5155 | 12 |
| เพิ่มพนักงานยังไง | 2198 | 4588 | 2454 | 5256 | 12 |
| อนุมัติใบเบิกตรงไหน | 2198 | 4588 | 2376 | 5062 | 12 |
| จ่ายบางส่วนได้ไหม | 2198 | 4588 | 2428 | 5178 | 12 |
| จดเลขที่ใบ 50 ทวิ | 2198 | 4588 | 857 | 1691 | 4 |
| หน้าแรกดูเดือนก่อนยังไง | 2198 | 4588 | 2437 | 5177 | 12 |
| ค่าอาหาร | 2198 | 4588 | 203 | 439 | 1 |

### Offline calibration check

Ran the documented real-builder helper:

`pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ../../scripts/recalibrate-line-intake.cjs 1239bb8e4d0a8bb627c2af19c048931f33455f0857581a65b2a3644fc6ba5fae`

It reports the same model (`global.anthropic.claude-sonnet-4-6`), constant digest, 66,609 bytes and 26,681-token bound before and after. The change is confined to byte-counted variable metadata, not the calibrated system prompt/glossary/chatActions, model or reviewed feature vocabulary. No digest/table/contract bump or live provider measurement is needed. Rebuilt the seven actual role/package builder rows in `docs/evidence/line-ai-credit-levers-20261019-role-reach.json` using the real `v2RenderedInput` and `priceRenderedAiInvocationV2` at FX33/output4096. Prior v4 bounds/holds and the unbounded-v6 comparison are retained per row; these are cold-cache reservation estimates, not actual customer charges. The existing <=9.13 THB ceiling remains.

| Role/package | prior v4 tokens | unbounded v6 tokens | bounded v6 tokens | prior v4 hold | bounded v6 hold |
|---|---:|---:|---:|---:|---:|
| STARTER_249 / OWNER | 56320 | 81920 | 52224 | 9 | 8.5 |
| STARTER_249 / STAFF | 48128 | 61440 | 44032 | 7.99 | 7.48 |
| STARTER_249 / ACCOUNTANT | 51200 | 66560 | 47104 | 8.37 | 7.86 |
| STARTER_249 / AUDITOR_READONLY | 50176 | 62464 | 46080 | 8.24 | 7.73 |
| PRO_999 / OWNER | 56320 | 81920 | 52224 | 9 | 8.5 |
| PRO_999 / MANAGER | 50176 | 67584 | 46080 | 8.24 | 7.73 |
| ENTERPRISE_1999 / OWNER | 57344 | 84992 | 54272 | 9.13 | 8.75 |

Verification for this approval round is reported in the final handoff. Whole-chain/browser proof remains with the controller; no live model, server, Docker or database was used here.
