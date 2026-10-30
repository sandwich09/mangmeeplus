# Agent Memory: new-shop-welcome-and-package-advisor-story

Status: MAIN + DEVELOP INTEGRATION — 2026-10-30; not deployed or sent to real customers
Owner: thawatchai
Scope: เฉพาะร้านที่เปิดใหม่สำเร็จและยังไม่เคยซื้อแพ็กเกจ; ต้อนรับด้วยน้องมั่งมี พร้อมทางลองใบเสร็จฟรี ทำแบบประเมินแพ็กเกจ และคุยทีมดูแลอีก LINE OA

## User context

- ร้าน muay มาจาก IG เปิดร้านเวลา 18:19 และพยายามส่งใบเสร็จก่อนพบขั้นตอนซื้อแพ็กเกจ ผู้ใช้ต้องการช่วยกลับมาลองและเพิ่มโอกาสซื้อ
- ผู้ใช้รายงานว่าเปิดสิทธิ์ 3 ใบเมื่อคืนแล้ว; งานนี้ไม่ได้ตรวจ cloud หรือยืนยันสถานะ live
- มี LINE ระบบสำหรับใช้งาน และ LINE ทีมดูแลสำหรับเจ้าหน้าที่; ผู้ใช้ต้องการรักษาการแยกช่องทาง
- แนวคิดล่าสุด: หลังเปิดร้านและยังไม่ซื้อ ส่งแนะนำน้องมั่งมี แจ้งสิทธิ์ฟรี มีทางคุยเจ้าหน้าที่ และปุ่มไปแบบประเมินช่วยเลือกแพ็กเกจ
- ภาพอ้างอิง: หน้าสีม่วงอ่อน มีน้องมั่งมีและคำถามทีละข้อ แถบความคืบหน้า 4 ข้อ; ข้อแรกถามจำนวนคนดูแลใบเสร็จ/ค่าใช้จ่าย รวมเจ้าของ
- Latest user direction: ใช้คำเหมือนคนพูด ให้รู้สึกอบอุ่น; persona น้องมั่งมีคือผู้ช่วยดูแลร้านของลูกค้า; ลด emoji/ลูกศร โดย copy รอบนี้ไม่ใช้ทั้งสองอย่าง
- Latest scope confirmation: ผู้ใช้ตอบ “ได้” และกำหนดว่าเกิดเฉพาะคนเปิดร้านใหม่ พร้อมขอดู design ของคำถาม 4 ข้อและหน้าผลลัพธ์

## Decisions and proposed story

- User-requested direction: เสนอ story ของ welcome + 3 ทางเลือก; ยังไม่ได้สั่ง implement หรือส่งข้อความจริง
- Proposed main journey: เปิดร้านสำเร็จ → welcome หนึ่งการ์ด → ส่งใบเสร็จจริง → เห็นร่างที่ตรวจทานได้ → ประเมิน/เลือกแพ็กเกจเมื่อพร้อม
- Alternate journeys: เข้าประเมินได้ทันทีโดยไม่ต้องใช้ครบ 3 ใบ; คุยกับทีมดูแลได้ทุกช่วงโดยไม่บังคับย้ายห้องก่อนทดลอง
- คงลำดับ CTA: เริ่มส่งใบเสร็จ (หลัก), ให้น้องช่วยเลือกแพ็กเกจ (รอง), คุยกับเจ้าหน้าที่ (ลิงก์ชัดเจน)
- Free-policy source: 3 เอกสารรายจ่ายต่อบริษัทต่อเดือน ใช้ร่วมเว็บ/LINE เฉพาะร้านที่ยังไม่เคยซื้อ; ดู/แก้/เก็บร่างได้ ไม่ใช่สิทธิ์ free AI chat หรือ final financial actions
- แบบประเมินเป็น form แบบเลือกตอบ 4 ข้อตามภาพ; ไม่ควรเปิด free-form AI chat ในนามของปุ่มช่วยเลือกแพ็กเกจ
- Proposed questions: จำนวนคนดูแล, จำนวนเอกสารต่อเดือน, งานที่อยากให้ช่วย, วิธีจัดการเอกสารปัจจุบัน ตัวเลือกปริมาณต้องสอดคล้อง catalog จริง; วิธีทำงานใช้ปรับคำแนะนำเริ่มต้น ไม่ต้องบังคับมีผลต่อ tier
- ผลประเมินแนะนำ 1 แพ็กเกจที่รองรับความต้องการ พร้อมเหตุผล ราคา/รอบบิล/ข้อจำกัดจาก catalog จริง; มีทางดูแพ็กเกจอื่น กลับไปลองฟรี และคุยทีมดูแล
- คำแนะนำหลังอ่านใบแรกเน้นผลที่บันทึกจริงและตรวจทาน ไม่แทรกการขายระหว่างแก้ร่าง; เมื่อครบคงคำแจ้งครบตาม policy เดิม
- Superseded: ข้อเสนอส่งข้อความกลับมาลองให้ร้านเดิมอย่าง muay ไม่อยู่ใน scope ล่าสุด; ไม่ backfill welcome ไปหาร้านเดิม ชื่อ muay ใน mockup เป็นเพียงตัวอย่างชื่อร้าน

## Voice and revised copy

User-confirmed direction: อบอุ่น เป็นธรรมชาติ และเป็นผู้ช่วยดูแลร้าน ข้อความต่อไปนี้เป็น revised draft ตามทิศทางดังกล่าว

- แทนตัวว่า “มั่งมี”; แนะนำตัวครั้งแรกว่า “น้องมั่งมี” ได้ ไม่พูดชื่อซ้ำทุกประโยค
- เรียกลูกค้าว่า “คุณ” หรือเว้นสรรพนามตามธรรมชาติ ไม่สมมติอายุด้วย “พี่” และไม่เรียก “คุณลูกค้า” ทุกประโยค
- ประโยคสั้น ใช้ชื่อร้านในจุดที่เหมาะสม อบอุ่นจากการช่วยให้เริ่มง่ายและอธิบายตรงไปตรงมา
- ไม่ใช้ emoji/ลูกศรในข้อความชุดนี้ ไม่ใช้ภาษาขายเร่งเร้า คำเด็กเกินไป หรือคำสัญญาว่าช่วยได้ทุกเรื่อง/มีเจ้าหน้าที่เฝ้าตลอด
- คงความชัดเจนเรื่องอ่านใบเสร็จและเตรียมร่างให้ตรวจดู ไม่สัญญาลงบัญชีหรือทำรายการการเงินเสร็จอัตโนมัติ

### Welcome

> สวัสดีค่ะ มั่งมีนะคะ ผู้ช่วยดูแลร้านของคุณ
>
> ยินดีต้อนรับร้าน {ชื่อร้าน} ค่ะ มั่งมีจะช่วยอ่านใบเสร็จและเตรียมรายการรายจ่ายไว้ให้คุณตรวจดู
>
> เริ่มจากใบเสร็จสักใบก่อนก็ได้ค่ะ ลองส่งฟรีได้เดือนละ 3 ใบ โดยยังไม่ต้องซื้อแพ็กเกจ
>
> ถ้าอยากให้ช่วยดูว่าแพ็กเกจไหนเหมาะกับร้าน หรืออยากคุยกับทีมดูแล เลือกด้านล่างได้เลยนะคะ

CTA: ลองส่งใบเสร็จ / ช่วยเลือกแพ็กเกจให้หน่อย / คุยกับทีมดูแล

### Start a receipt

> ถ่ายรูปใบเสร็จให้เห็นทั้งใบ แล้วส่งในแชทนี้ได้เลยค่ะ เดี๋ยวมั่งมีช่วยอ่านและเตรียมข้อมูลให้คุณตรวจดู

### Assessment intro and questions

> มั่งมีขอรู้จักร้านอีกนิดนะคะ มีคำถามสั้น ๆ 4 ข้อ จะได้ช่วยดูว่าแพ็กเกจไหนเหมาะกับงานที่ร้านใช้จริง

1. ที่ร้านมีใครช่วยดูแลใบเสร็จและรายจ่ายบ้างคะ รวมแล้วกี่คน? (นับตัวคุณด้วยนะคะ)
2. แต่ละเดือนมีใบเสร็จให้ดูแลประมาณกี่ใบคะ? (ถ้ายังไม่แน่ใจ เลือกจำนวนคร่าว ๆ ได้ค่ะ)
3. ตอนนี้มีงานส่วนไหนที่อยากให้มั่งมีช่วยมากที่สุดคะ?
4. ปกติที่ร้านเก็บใบเสร็จและจดรายจ่ายกันอย่างไรคะ?

### Recommendation

> จากที่คุณเล่า มั่งมีแนะนำแพ็กเกจ {ชื่อแพ็กเกจ} ค่ะ เพราะ {เหตุผลจากคำตอบและสิทธิ์จริง}
>
> ราคา {ราคาจริงและรอบบิล} รองรับ {จำนวนคน/เอกสารและเงื่อนไขจริง}
>
> ถ้าอยากลองอ่านใบเสร็จก่อน ก็กลับไปลองได้เลยนะคะ

ประโยคกลับไปลองใช้เฉพาะเมื่อสิทธิ์คงเหลือจริง; CTA ดูแพ็กเกจนี้ / ลองส่งใบเสร็จก่อน / คุยกับทีมดูแล

### Support handoff

> ถ้าอยากคุยกับทีมดูแล กดปุ่มนี้ได้เลยค่ะ จะเปิดอีกไลน์ที่คุยกับเจ้าหน้าที่ได้โดยตรง
>
> บอกชื่อร้าน {ชื่อร้าน} กับทีมได้เลยนะคะ

ไม่อ้างว่าทีมได้รับข้อมูลแล้วหรือจะตอบทันทีเมื่อยังไม่มีหลักฐานการส่งต่อ/เวลาบริการ

## Boundaries for a later spec/plan

- ส่ง welcome เมื่อ provision ร้านและสมาชิกสำเร็จและมีปลายทาง LINE ที่ส่งได้; รวมกับข้อความสำเร็จเดิมถ้าเหมาะสม และไม่ส่งซ้ำจาก retry/reopen
- เฉพาะ event เปิดร้านใหม่หลังเปิดใช้ flow นี้ ไม่ส่งให้ฐานร้านเดิม การเข้าสู่ระบบซ้ำหรือยังไม่จ่ายไม่เป็น trigger ใหม่
- Recheck eligibility ก่อนส่ง; ร้านซื้อสำเร็จระหว่างรอส่งไม่ควรได้ welcome สิทธิ์ฟรี ร้านเคยซื้อแล้วหมดอายุใช้ renewal flow
- ไม่มี opt-in รับสิทธิ์ใหม่ ไม่มี quota reset; ข้อความสิทธิ์/คงเหลือต้องตรง source ปัจจุบัน
- ผู้ใช้ข้ามแบบประเมิน ย้อนกลับ แก้คำตอบ และกลับไปใช้งานได้; recommendation ไม่สร้างการซื้อเอง
- Customer support OA ตามเอกสาร: @107ewccg / https://lin.ee/UU9pbOI; การกดลิงก์ไม่ได้ย้ายประวัติสนทนาหรือเอกสารอัตโนมัติ
- Owner อนุมัติ implementation 2026-10-30: ปรับ D03 เฉพาะ welcome ครั้งเดียวเมื่อเปิดร้านใหม่ตาม spec; ไม่รวมการตลาดวงกว้าง
- Validation targets เมื่อลงมือจริง: new eligible shop, duplicate event, paid-before-send, used allowance, existing shop recovery, quiz navigation/catalog correctness, support handoff and mobile layout

Open questions:
- None blocking local implementation. Native LINE provider/device acceptance and UAT/Production require a separate release instruction and repository protocols.

Artifacts:
- [Free receipt policy](../specs/free-expense-drafts-spec-th.md)
- [Existing free receipt task state](free-expense-drafts.md)
- [LINE support destination](../specs/line-rich-menu-v2-spec.md)
- [Existing LINE outbound policy](../specs/mangmee-line-first-signup-spec-th.md)
- User-provided assessment screenshot in this chat
- Interactive mockup: `/Users/thawatchai/.codex/visualizations/2026/10/29/01a186b4-14bf-7f92-a6a7-63c7c67e11bc/mangmee-package-advisor.html`; embedded original reference image for mascot display; four questions, back/edit, contextual result, free-receipt guidance and staff link
- Mockup catalog is explicitly hypothetical: names/prices/limits are for design review only, not a proposed approved catalog. Matching uses team/receipt capacity, while goals/current process tailor explanation. Real requirements-based matching must be specified against actual entitlements before implementation.

Verification:
- Read repository AGENTS.md, relevant free-receipt policy/task memory, LINE signup and support menu specs; inspected the supplied screenshot
- No matching assessment component/copy found in bounded searches of docs/apps/packages; this does not prove it is absent from other projects
- No code changes, tests, cloud queries, native LINE messages, account mutations, or deployment in this discussion
- Repository has extensive pre-existing changes; this task adds only this memory note
- 2026-10-29 voice revision: updated this memory only with the user's warm shop-assistant persona and revised Thai copy; no executable logic changed, so no code tests required
- 2026-10-29 interactive preview: JavaScript syntax check passed; actual browser traversal completed all four questions and showed the expected sample result (1–2 people,31–100 receipts,receipt capture,spreadsheet workflow); inspected desktop and390px mobile layout, then tightened mobile mascot placement
- New preview lives outside application source. No customer signup/message/billing changes and no live state queried; LINE support link was not clicked
- Final check: revised question/result screens visually inspected at390px; JS syntax and6 illustrative matching assertions passed (small/medium/team/over-capacity/unknown volume),933KB fragment below1MB. Temporary preview browser and local server closed after inspection

## Implementation authorized 2026-10-30

- User asked to implement with Sol/Luna; Sol handled new-shop delivery and receipt command, Luna handled LIFF client, parent handled spec/plan, routes, handoff and integration.
- [Accepted spec](../specs/new-shop-welcome-package-advisor-spec-th.md) and [plan](../plans/new-shop-welcome-package-advisor-plan-th.md) precede executable changes. Ponytail full; no dependency/package.json changes.
- Atomic onboarding audit stores welcome version and originating signupRequestId. Existing signup outbox slot and LINE retry key are reused. Only the original newly created LINE shop request can receive the warm card; later adoption cannot reuse its marker.
- Before send: active identity/owner/context, free policy, receipt entitlement/permissions and current allowance. Receipt button uses existing upload route/gates; support opens separate OA.
- New API LIFF page uses approved mascot asset, four questions and public live catalog. First version recommends monthly offers only; back/edit/unknown/over-capacity/error paths included. Explicit billing click passes known tier/month to existing live membership and secure handoff; no arbitrary URLs or checkout mutation.
- New advisor checks are imported by registered `line-liff-signup.spec.ts`, so package scripts remain unchanged. Pre-existing unrelated spec coverage failures tracked separately.
- Previous Verification entries above describe the earlier discussion/prototype, not implementation status.

## Final local verification 2026-10-30

- Backend welcome/receipt regression: 555 passed. Auth/LIFF client/handoff regression: 152 passed. Full API TypeScript with8 GB heap passed; SWC asset-copy smoke and diff whitespace checks passed.
- Actual browser: completed4 questions/result, edit/back, unknown, over-capacity, closed sales and catalog failure/retry at320/390/1280 px; keyboard selection and forward/back retention verified.
- Browser caught HTMLCollection.indexOf misuse hidden by the VM stub; corrected to Array.from and preserved numeric answer values, added regression, reran affected suite.
- Repository spec-registration guard still reports10 pre-existing orphan specs. New advisor checks run through registered LIFF spec; no package.json edits. Details and commands in [verification evidence](../evidence/new-shop-welcome-package-advisor-2026-10-30/verification.md).
- No real LINE send, external support message, customer/checkout mutation, cloud command, deploy, commit or push. Browser uses canonical-shaped local catalog fixtures, not deployed catalog readback.

Next:
- Review the implemented local result. A later authorized release must follow UAT/Production protocols and native LINE acceptance; no additional local implementation is pending.


## Owner copy correction after local review

- User states company is not VAT registered and asks for no VAT mention. Remove the tax sentence/element entirely from advisor results; first screenshot used agent-invented INCLUSIVE_VAT_7 fixture, not verified company policy. Local fixture now NOT_VAT_REGISTERED; no live billing-policy/tax calculation changed.
- User did not understand “ค่อย ๆ ย้ายจากตารางเดิมและตรวจรายการก่อนบันทึก”. Replace with “เริ่มจากส่งใบเสร็จสักใบ แล้วตรวจข้อมูลที่มั่งมีอ่านให้ก่อนบันทึกได้เลยค่ะ”; do not imply importing or migrating spreadsheet history.

- Copy correction verified:82 registered LIFF tests passed; browser completed four questions and showed the new wording with no tax element. Result screenshots refreshed; no deployment.

- Owner theme correction: สีม่วงเป็นธีม Halloween ชั่วคราว ให้ใช้ธีมเขียวปกติ. Updated welcome CTA, actual advisor CSS using shared LIFF tokens, and earlier inline design preview palette. Copy corrections (no VAT, clear receipt-start instruction) remain applied.

- Green-theme verification:126 existing checks passed; actual mobile result inspected with no VAT and revised spreadsheet copy. Earlier inline preview inspected at736 px and question-navigation still works. API preview server stopped; task-owned inline preview server on127.0.0.1:8769 left available for the already-open review URL. No deploy.


## Owner button correction

- Removed underlined text actions from the inline design preview. Reused existing theme buttons for support, receipt shortcut, edit answers, and return; secondary buttons use white fill, border, and green text. Added mobile spacing for the taller footer control.
- Actual API advisor already uses theme buttons without underlines, so no application code change was needed in this pass.
- Verified browser computed styles: all result actions have text-decoration:none, 1px borders, and 47px height. At 320px viewport the preview has no horizontal overflow; edit answers and support navigation both work. Screenshot: docs/evidence/new-shop-welcome-package-advisor-2026-10-30/preview-theme-buttons-mobile.jpg. No new automated tests for this styling-only change.
- Restarted task-owned preview server on127.0.0.1:8769 to serve the updated fragment; viewport reset and temporary browser tab closed. No deployment or customer messages.


## Direct integration authorized 2026-10-30

- User explicitly requested merge into main and develop without a PR. Isolated the feature in managed worktree `new-shop-advisor-merge` on `codex/new-shop-welcome-package-advisor`, based on common origin/main and origin/develop commit `994a55fa1`. Original shared dirty checkout is untouched.
- Ported only the feature hunks; retained current free-expense access, sales-event landing, deep-link handling, multilingual receipt routes and versioned shared LIFF client. Current repository support destination is reused through `STAFF_OA_URL` (`https://lin.ee/6Sc38L6`), superseding the older preview URL above.
- Updated D03 in the free-expense spec for the previously authorized one-time new-shop welcome. No package.json, lockfile, schema, release workflow or cloud changes.
- Fresh-baseline verification: contracts build and Prisma client generation passed; 1,094 tests across117 suites passed; full API TypeScript with8GB heap passed; diff whitespace check passed.
- Browser against the integrated source completed all four questions and produced BASIC for3–5 people/31–50 receipts/expense gathering/spreadsheet. Green theme, revised copy, no VAT and correct current support URL verified. Evidence: `merge-result-desktop.jpg`. Temporary verification tab/server closed.
- Native LINE/provider acceptance and UAT/Production deployment remain separate; push does not trigger deployment in the current workflow configuration.


## Main/develop delivery record

- Application commit: `9036b8552`.
- Latest common destination baseline advanced during verification from994a55fa1 toa68534385. Rebased only this feature on the new baseline without conflict; rebuilt contracts and reran the same1,094 tests and full8GB API TypeScript, all passed.
- Delivery is a normal fast-forward push of this feature and its delivery record to both origin/main and origin/develop in one atomic update, without a PR or force push. No UAT/Production deployment.
- No further implementation work remains for this request; native LINE/UAT acceptance requires a separate release task.
