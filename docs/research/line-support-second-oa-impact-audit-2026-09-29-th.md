# Impact audit: ปุ่มติดต่อเจ้าหน้าที่ไป LINE OA อีกบัญชี

วันที่: 2026-09-29
สถานะ: audit เสร็จ; owner ยืนยันปุ่มเปิดหน้าเพิ่มเพื่อน `@107ewccg` ผ่าน `https://lin.ee/UU9pbOI`; ปรับปุ่ม contact card และป้องกัน outbound helper เติมคำสั่งเปิดเบราว์เซอร์ให้ LINE short link; ตรวจ local/integration ผ่านแล้ว ขอบเขตส่งมอบล่าสุดคือ main/develop เท่านั้น เจ้าของงาน deploy เอง
หลักฐาน: local working tree บน HEAD `4a5817b4` ซึ่งมีงานค้างเดิมหลายไฟล์ รวม webhook, buffer และ contact card; ไม่ใช่การรับรองสิ่งที่ deploy อยู่
ขอบเขต: ปุ่มใน contact card, support lifecycle, identity/channel, inbox/contracts, signup, CRM boundary และ regression coverage

## ข้อสรุปเพื่อเลือก scope

การเปิดแชต OA อีกบัญชีทำได้ด้วย URI action แต่การกดลิงก์ไม่ทำให้เกิดคำขอ support ในระบบเดิมเอง และไม่ย้ายข้อความ/รูป/ผู้รับผิดชอบ/สถานะเคสตามไป

| แบบ | ลูกค้าและเจ้าหน้าที่ทำอะไร | ผลกระทบ |
|---|---|---|
| เพิ่มช่องทางแยก | เพิ่มปุ่มชื่อชัด เช่น “แชตกับทีมงานที่ [ชื่อ OA]”; ทีมงานตอบใน OA ใหม่; ทาง support เดิมยังทำงาน | ต่ำในโค้ด ไม่ต้องเพิ่ม integration credentials/schema/package dependency เพื่อเปิดลิงก์; ต้องยอมรับว่าบทสนทนานั้นไม่เข้า support inbox เดิม |
| แทนทางเข้า support ด้วย OA ใหม่ | ทุกทางเข้าที่ตั้งใจย้ายพาไปบัญชีใหม่; ทีมงานย้ายที่ทำงานตาม | กลาง: ต้องตกลงทางเข้าที่เหลือ ข้อความเก่า เคสค้าง การพัก AI ข้อความตอบรับ และคู่มือทีมงาน |
| OA ใหม่เข้า support inbox เดิม | ลูกค้าคุย OA ใหม่ แต่ทีมงานอ่าน/ตอบ/รับเคส/ปิดเคสในเว็บมั่งมี | สูง: เป็น feature หลายโมดูล ต้องมี spec/plan เรื่อง channel routing, identity, conversation binding, outbound, media และ migration ก่อนลงมือ |

คำแนะนำแบบมีเงื่อนไข: ถ้าต้องการเพียงให้ทีมงานคุยผ่าน OA อีกบัญชี เริ่มจากช่องทางแยกชื่อชัดและรักษา support เดิมไว้ก่อน หากต้องการเคสเดียวติดตามในเว็บ ให้เลือกออกแบบ integration โดยตรง ไม่ถือว่าการเปิดลิงก์เป็นหลักฐานการรับเรื่องสำเร็จ

## Flow ก่อนเปลี่ยนที่ตรวจพบในขั้น audit

1. Rich menu “ติดต่อเรา” เข้า `buildContactCard()`; ปุ่ม “ติดต่อเจ้าหน้าที่” เป็น `message` action ส่งคำเดิมกลับ OA กลาง
2. `staffMenuCommand()` → `handleStaffContact()` ทำงานก่อนเงื่อนไข linked user เพื่อให้ผู้สมัคร/ผู้ไม่มีร้านขอความช่วยเหลือได้
3. หาเคส `OPEN|ANSWERED` ของ LINE user เดิม; หากมีใช้เคสเดิม/เปิดกลับ หากไม่มีสร้างเคสภายใต้ advisory lock และ daily limit
4. ผูกบริษัทจาก identity/membership ปัจจุบัน หรือผูกคำขอสมัคร; หากมีบริษัทตั้ง `LineCompanyContext.aiPausedUntil` 24 ชั่วโมง
5. ตอบว่าทีมงานจะตอบ “ในแชทนี้” และ enqueue แจ้งทีมงาน; แหล่งทำงานหลักคือ `/system/support-requests`
6. ข้อความและสื่อเข้าเธรดตามกติกา support; v4 หยุด OCR/AI ระหว่าง pause และเก็บสื่อให้เจ้าหน้าที่
7. เจ้าหน้าที่รับเคส ตอบผ่าน token OA กลางถึง `request.lineUserId`; การตอบสำเร็จ การเปิด AI และการแก้สำเร็จ/ปิดเคสเป็นคนละสถานะ

หลักฐาน: [contact card](../../apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts#L379), [contact handler](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts#L2349), [routing](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts#L3718), [support v2–v4](../specs/line-support-request-spec-th.md)

## Bug risks และ gaps

รายการ R คือผลที่คาดจากการเปลี่ยนแบบระบุในเงื่อนไข ไม่ได้กล่าวว่าปัจจุบันเกิด incident เหล่านี้แล้ว

| ID / ความสำคัญ | เงื่อนไขและผลกระทบ | สิ่งที่ต้องตกลงหรือปิด gap |
|---|---|---|
| R1 สูง — เคสไม่เข้าเว็บ | เปลี่ยนปุ่มเป็น URI อย่างเดียว: ไม่ส่ง `staff_contact` กลับ webhook เดิม จึงไม่สร้างเคส ไม่ enqueue แจ้งทีมงาน และไม่ตั้ง pause จากการกดนี้; หากทีมงานยังเฝ้าเว็บจะไม่เห็นงาน | เลือกแหล่งรับงานให้ชัด ใช้ข้อความว่าเปิดแชต ไม่อ้างว่ารับเรื่องแล้ว |
| R2 สูง — ทางเข้าคนละพฤติกรรม | เปลี่ยนแค่ contact card แต่คำพิมพ์ “ติดต่อเจ้าหน้าที่”, signup/status/budget quick replies และ LIFF support ยังเข้าเคสเดิม; ปุ่มที่ฝังในข้อความเก่าต้องรองรับต่อ | ระบุ scope ทุกทางเข้า และวางวิธีรองรับ legacy command/card; การแก้ builder ไม่เปลี่ยน payload ของข้อความที่ส่งไปแล้ว |
| R3 สูง — ลูกค้าคุยคนละที่กับที่เว็บตอบ | ลูกค้าไป OA ใหม่ แต่เคสเดิมยัง OPEN/ANSWERED; ทีมงานตอบจากเว็บยังส่งผ่าน OA กลางเดิม ข้อความ/รูปที่ส่ง OA ใหม่ไม่เติมเธรดเดิมจาก URI alone | ไม่ปิด/ย้ายเคสโดยอัตโนมัติเพราะกดลิงก์; กำหนดขั้นตอนดูแลเคสค้างและข้อความบอกจุดตอบ |
| R4 สูง — AI pause ไม่ตรงกับที่คุย | ผู้มี pause อยู่ก่อนกด URI ยังคง pause จน resume/หมดเวลา; การคุยหรือจบงานใน OA ใหม่ไม่ได้ล้าง pause เดิม ผู้ไม่มี pause จะไม่ได้เริ่ม pause จาก URI | เลือกว่า OA หลักยังเป็น AI ตามปกติ หรือจะ sync pause ผ่าน integration; ห้ามล้าง pause ของเคสอื่นโดยเดา |
| R5 สูง — ใช้ webhook/token เดิมกับ OA ใหม่ | Shared webhook ตรวจ secret ชุดเดียว; OA ใหม่จะไม่ผ่านด้วย secret คนละชุด การแทน credentials เดิมด้วย OA ใหม่กระทบ reply/push/media/notification เดิมทั้งระบบ | URI-only ไม่ต้องเปลี่ยน shared credentials; integrated mode ต้องเลือก credential ด้วย channel ที่ verify แล้ว และเก็บ channel ที่ใช้ตอบไว้กับ conversation/case |
| R6 สูง — เคส/buffer/AI context ปะปนเมื่อเพิ่ม channel | `LineSupportRequest` ไม่มี source channel, live lookup ใช้ LINE user, `LineCompanyContext` unique แค่ user และ buffer key เป็น `chatId:lineUserId` ไม่มี channel; คนเดียวกันภายใต้ provider เดียวมี user ID เดียวได้ | ก่อนรับ OA ที่สองเข้า backend ต้องกำหนด conversation/channel scope สำหรับ lookup, state, buffering, dedupe และ outbound |
| R7 สูง — identity/membership ไม่พร้อมสำหรับ OA ใหม่ | `ExternalIdentity` มี channel binding; runtime ยังมี legacy fallback ข้าม channel เมื่อไม่พบ canonical record; คนละ provider มี user ID ต่างกัน | ไม่เท่ากับต้องย้าย identity เพื่อทำลิงก์; หาก sync ให้มีการจับคู่ที่พิสูจน์ได้ ตรวจ membership และห้ามใช้ชื่อ LINE จับคู่ |
| R8 กลาง — กดแล้วไม่ได้เริ่มบทสนทนา | URL เปิดหน้าคุย/ใส่ข้อความร่างได้ แต่ผู้ใช้ยังต้องส่งเอง; การเปิดลิงก์ไม่พิสูจน์ว่าทีมงานได้รับข้อความ | ทดสอบ friend/non-friend, blocked, ยกเลิกก่อนส่ง, OA ปลายทางรับแชต/มีทีมเฝ้า, นอกเวลาทำการ และช่องทางสำรอง |
| R9 กลาง — native/desktop ต่างกัน | LINE URL scheme รองรับ iOS/Android; desktop ไม่รองรับ scheme แบบเดียวกัน | ทดสอบจริงบน mobile และกำหนด desktop/profile/QR fallback โดยไม่อ้างว่า native acceptance ผ่านจาก unit test |
| R10 กลาง — ส่งลิงก์จากช่องตอบเว็บไม่ได้ตามเดิม | `shopMessageAllowedHosts()` อนุญาตแค่ web host และ `liff.line.me`; `line.me`/`lin.ee` จึงถูกปฏิเสธภายใต้ web host ปกติของมั่งมี | อย่าใช้การวางลิงก์ใน composer เป็น workaround ที่สัญญาว่าใช้ได้ และอย่าขยาย allowlist ทุก OA โดยไม่กำหนดขอบเขต; ปุ่ม URI ที่ระบบสร้างเป็นคนละเส้นทาง |

**Gap ด้านเอกสารที่ยืนยันได้:** [support playbook](../runbooks/line-first-signup-support-playbook.md#L162) ยังบอกว่ารูปเป็นเพียง marker และเจ้าหน้าที่เปิดไม่ได้ ขัดกับ spec v3/v4 และ local thread/blob implementation ปัจจุบัน ต้องปรับคู่มือให้ตรงกับรุ่นที่ deploy จริงเมื่อเลือกวิธีส่งมอบ ไม่มีการสรุปว่าระบบ live รองรับรูปจากหลักฐาน local นี้

**Gap ด้าน acceptance ก่อนเปลี่ยน:** contact-card test ตรวจข้อความและ command mapping แต่ไม่ได้ตรวจครบว่า action ของปุ่ม support ต้องเป็น message หรือ URI ใด หลัง owner ให้ปลายทางแล้วปรับ assertion เดิมให้ตรวจ URI ที่แน่นอน พร้อมคงการตรวจ typed command; native handoff ยังต้องตรวจจริงหลัง release

## Dependency modules

| โมดูล / หลักฐาน | หน้าที่เดิม | URI แยก | ถ้ารวมเข้าระบบเดิม |
|---|---|---|---|
| `line-ai/domain/logic/line-staff-menu.logic.ts:379,397,651` | contact card และคำสั่ง | แก้ปุ่ม/label/config ปลายทางและ test | ต้องมี entry policy ร่วม |
| `line-ai/domain/logic/line-business-card.logic.ts:134,399,450,488,541` | ปุ่มใน budget/signup/status cards | คงเดิมเมื่อเพิ่มช่องทาง; ถ้าย้ายทั้งหมดต้องปรับ | route และ copy สอดคล้องทุก journey |
| `auth/presentation/line-webhook.controller.ts:58` + `common/config/line-messaging-credentials.service.ts:16` | shared signature และ credential เดียว | ไม่ต้องแตะ | ตรวจ/เลือก channel แยก ไม่แทน OA เดิม |
| `line-ai/application/line-message-buffer.service.ts:380` + `process-line-webhook.use-case.ts:2349,2536,2550,3633,6207` | buffering, identity, case, AI pause, media routing | ไม่ต้องเปลี่ยนเมื่อเพิ่ม URI แยก | ต้องกำหนด scope ของ state และการส่งข้อมูลข้าม OA |
| `external-signup/application/request-line-signup-support.use-case.ts:22` + `signup-admin-queue.use-case.ts` | LIFF ขอความช่วยเหลือและ REQUEST_INFO | คงเดิมเมื่อเพิ่มช่องทาง | ตัดสินใจว่าจะรวมเคส/คำตอบผู้สมัครอย่างไร |
| `external-signup/application/line-signup-notify.service.ts:207,236` + outbox | แจ้งทีมงาน/email/LINE และผลแจ้ง | ไม่มี notification เดิมจาก URI | ต้องมีการแจ้งและ retry ของเคสใหม่ |
| `external-signup/application/support-request-admin.use-case.ts:390,412,515,618,655` + `system-partner-management/application/use-cases/send-partner-line-message.use-case.ts` | reply, retry, claim, pause/resume, resolve | ยังส่งผ่าน OA เดิม | ผูก reply ไป channel ต้นทางของเคส และกัน retry ข้าม OA |
| `line-ai/infrastructure/line-reply.adapter.ts:125` และ media retrieval | ใช้ shared credentials ตอน I/O | ไม่ต้องแตะ | channel-aware reply/push/media/loading โดยรักษา delivery/idempotency เดิม |
| Prisma `ExternalIdentity:843`, `LineCompanyContext:4135`, `LineSupportRequest:4160`, `LineSupportMessage:4251` | identity/context/เคส/ประวัติและรูป | ไม่ต้อง migration | ต้องออกแบบ channel/conversation relationship และรองรับเคสเก่าก่อน migration |
| `packages/contracts/src/external-signup.ts:501` + `apps/web/src/features/system-support-requests/` | DTO, queue, thread, ownership, AI state | ไม่แสดงแชตนอกระบบอัตโนมัติ | ส่งช่องทาง/สถานะที่ UI ใช้ได้จริง โดยไม่เปิด raw user ID; loading/error/403 เดิมต้องยังถูกต้อง |
| `crm-inbox/presentation/http/crm-line-webhook.controller.ts:30` + `CompanyMessagingChannel` | OA ของบริษัทและลูกค้าบริษัท | ใช้ได้เป็นปลายทางแยกถ้าบริบทและสิทธิ์ตรง | ไม่ใช่ support adapter; channel→company และ CRM permissions ต่างจาก platform support ต้องออกแบบ bridge ถ้าจะเชื่อม |
| `ai-gateway`, expenses, billing, LINE Login/LIFF | AI/เอกสาร/สิทธิ์และการเข้าใช้งาน | ไม่มีเหตุให้แก้เพื่อเปิดลิงก์ | รักษา API/permission boundary เดิม; กระทบทางอ้อมหากเปลี่ยน pause, identity หรือ shared credentials |

CRM ใช้ endpoint และสิทธิ์แยกโดยตั้งใจ ตาม [CRM OA spec §4](../specs/crm-line-oa-customer-os-spec.md#L45) การมี multi-channel ใน CRM จึงไม่แปลว่า platform support รองรับ OA ที่สองแล้ว

## ข้อมูลที่ยังไม่ทราบ

- ยืนยันแล้วหลัง audit: ลูกค้าเพิ่มเพื่อนและคุยกับเจ้าหน้าที่ใน OA ปลายทาง เป็นลิงก์แยก ไม่ได้ขอ integration เข้ากับ support inbox เดิม
- ยืนยัน scope: แทน action เฉพาะปุ่มใน contact card ด้วย URI; ทางสมัคร/LIFF คำพิมพ์ ปุ่มเก่า และเคสเดิมยังใช้ระบบเดิม
- OA ปลายทางยืนยันเป็น `@107ewccg`; HTTP redirect ของ short link ตรงกัน แต่ยังไม่ได้ทดสอบการเพิ่มเพื่อน/คุยกับทีมงานบนแอปจริงหรือยืนยันเวลาที่ทีมเฝ้า
- ต้องการเปิดหน้าเพิ่มเพื่อนเพื่อคุยใน OA นั้น; ไม่ขอ sync ข้อความ/รูป/เคส/บริษัท/AI state
- Provider/channel configuration จำเป็นต้องรู้เฉพาะเมื่อเลือก integration; ไม่จำเป็นต่อการเปิดลิงก์อย่างเดียว

## Verification 2026-09-29

รันกับ working tree ปัจจุบัน ใช้ existing tests ไม่เพิ่ม/แก้ test หรือ application code:

```sh
# cwd: apps/api
pnpm exec tsx --test --test-reporter=spec \
  src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts \
  src/modules/line-ai/line-first-signup-webhook.spec.ts \
  src/modules/external-signup/application/support-request-admin.use-case.spec.ts
# PASS: 179 tests, 26 suites, 0 fail, 0 skipped

# cwd: apps/web
pnpm exec tsx --test --test-reporter=spec \
  src/features/system-support-requests/SupportRowActions.spec.ts \
  src/features/system-support-requests/SupportRequestsPage.qa.spec.ts \
  src/features/system-support-requests/support-requests.logic.spec.ts
# PASS: 67 tests, 10 suites, 0 fail, 0 skipped
```

API checks ใช้ harness/mocks; web checks รวม render/logic/source QA ไม่ใช่ browser E2E. ตรวจ contract/endpoint/permission และเส้นทาง E2E ที่มี (`e2e/system-support-resolution.spec.ts`) แต่ไม่ได้รัน browser/full stack/Postgres integration ในขั้น assessment. ไม่ตรวจ cloud, ไม่ deploy, ไม่เปลี่ยน LINE Console/credentials, ไม่แก้ package.json

Post-change: รัน contact/menu และ LINE-first signup webhook suites สองไฟล์แรกของคำสั่ง API ข้างบนอีกครั้งหลังเปลี่ยน URI และปรับ existing card assertion: **159/159 ผ่าน, 21 suites, 0 fail/skipped**; `git diff --check` ของ code/spec ผ่าน. HTTP HEAD ตาม redirect ของ `https://lin.ee/UU9pbOI` ได้ 301 ไป `https://line.me/R/ti/p/@107ewccg?...` แล้ว 200. ยืนยัน URL/ID ตรงกัน แต่ยังไม่ใช่ native add-friend/chat acceptance; การ์ดที่ส่งหลัง release จึงจะมี URI ใหม่ ข้อความเก่าไม่ได้เปลี่ยนตาม

Integration ก่อนเข้า main/develop: ฐาน `origin/main=68f0de58` กับ `origin/develop=a94acf18` มี tree ตรงกัน แต่ใหม่กว่า checkout ที่ audit. พบ `packages/contracts/src/line-external-browser.ts` จะเติม `openExternalBrowser=1` ให้ `lin.ee` จึงเพิ่มโดเมนนี้ในข้อยกเว้น LINE เดิมพร้อมปรับ helper test. Contracts/config build ผ่าน, helper tests **5/5**, contact/menu + signup webhook + outbound reply adapter tests **184/184** ผ่านบน isolated worktree รวม **189 tests**. ไม่มีการแก้ package.json/lockfile หรือ deploy

เกณฑ์ตรวจเมื่อเลือกแบบ: ทุก entry point, old card/typed command, มีเคสค้าง/ไม่มีเคส, linked/unlinked/สมัครค้าง, ส่งข้อความและรูป, pause/resume, ทีมงานตอบและปิดงาน, retry/re-delivery, channel ถูกต้อง, สิทธิ์อ่าน/ตอบ, iOS/Android/desktop และ fallback เมื่อไป OA ไม่สำเร็จ สำหรับ URI-only ต้องยืนยันด้วยว่าไม่เผลอสร้างเคส/พัก AI จากการเปิดลิงก์

## LINE references (ตรวจ 2026-09-29)

- [Actions](https://developers.line.biz/en/docs/messaging-api/actions/): message/postback และ URI ทำงานต่างกัน
- [LINE URL scheme](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/): `oaMessage`, ข้อความร่าง, percent encoding, mobile support และ profile fallback
- [User IDs](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/): user ID scope ตาม provider; ภายใต้ provider เดียวกัน user เดียวกันมี ID เดียวข้าม channel

การประเมินผลต่อโมดูลและสถานะในรายงานนี้เป็นข้อสรุปจาก source/spec ปัจจุบันร่วมกับข้อกำหนด LINE ข้างต้น ไม่ใช่ผลการทดสอบ OA ใหม่จริง
