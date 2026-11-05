# Auto-register จาก LINE OA (LINE-first Signup) — Spec P10-L

## Owner amendment 2026-11-05 — บรรทัดอธิบายก่อนการ์ดประตู

- คนที่ยังไม่ผูกบัญชีและไม่มีคำขอเปิดร้านค้าง แล้วพิมพ์ข้อความ ส่งรูปหรือไฟล์ หรือกด "เริ่มคุยกับน้องต่อ" จะได้ข้อความ 1 บรรทัดก่อนการ์ดประตูเดิม: "น้องมั่งมีจะตอบได้หลังเปิดร้านหรือเชื่อมบัญชีแล้วค่ะ เลือกจากการ์ดด้านล่างได้เลย" (อังกฤษ: "I can help once you open a shop or link your account. Choose below.")
- แทนกติกา 2026-09-21 ที่ให้คนที่เพียงพิมพ์ได้การ์ดอย่างเดียว ที่มา: ลูกค้าร้านฟรีพิมพ์ถามค่าใช้จ่ายก่อนเชื่อมบัญชี 2 ครั้ง ได้การ์ดกลับมาโดยไม่รู้เหตุผล
- `follow` ยังได้ข้อความต้อนรับ + การ์ดเหมือนเดิม ไม่มีบรรทัดนี้; คนที่มีคำขอค้างยังได้การ์ดสถานะอย่างเดียว; ไม่เรียก AI และไม่ขอข้อมูลส่วนตัว

## Owner amendment 2026-09-23 — รูปประกอบข้อความต้อนรับ

- เมื่อ webhook `follow` มาจาก LINE user ที่ยังไม่ผูกบัญชีและไม่มีคำขอเปิดร้านค้าง ให้ reply ในครั้งเดียวตามลำดับ: ข้อความต้อนรับที่อนุมัติไว้ → การ์ดเปิดร้าน/เชื่อมบัญชีเดิม (รูปวิธีใช้ `mangmeeplus-welcome-how-to-start-1080x1350.png` ถอดออก 2026-09-28 จนกว่าจะมีไฟล์ใหม่ชื่อใหม่ที่มีขั้นเลือกแพ็กเกจ — purchase-without-setup R-C4; รูปใหม่ต้องเป็น image message ที่กดดูภาพเต็มได้ และใช้ URL HTTPS ของเว็บใน environment นั้น)
- ผู้ใช้ที่ผูกบัญชีแล้ว, คนที่มีคำขอค้าง, และคนที่เพียงพิมพ์ข้อความ ไม่ได้รับรูปนี้; ใช้คำตอบเดิมตามสถานะ ไม่ส่ง push เพิ่ม
- ถ้าไม่มี public HTTPS web origin ให้ส่งข้อความและการ์ดตามเดิมโดยไม่แนบ URL รูปที่เปิดไม่ได้ ตรวจทั้ง payload, ลำดับ, และการอ่าน outcome ที่เก็บเพื่อส่งซ้ำ

## Owner amendment 2026-09-17 — รู้จักเราทางไหน

Owner approved the interactive demo and requested implementation on the existing LINE signup form.

- Add a single-choice field before legal acceptance: Website, IG, TikTok, Facebook, อื่น ๆ. Use the approved two-column layout with อื่น ๆ spanning the row.
- This is optional attribution, matching the demo. No default selection; existing clients can omit it. Selecting อื่น ๆ reveals a text input (trimmed, maximum 200 characters, also optional). Switching away hides/disables it and sends no stale other text. A fresh ADD_SHOP form starts with no attribution selected.
- Persist nullable `CompanySignupRequest.discoverySource` (`WEBSITE | IG | TIKTOK | FACEBOOK | OTHER`) and `discoverySourceOther`. Only OTHER may retain text. This is separate from `source=line-oa` and influencer `referralCode`; neither existing field is repurposed.
- Validate enum/type/length at HTTP and use-case boundaries. Unknown choices or malformed text return field guidance. Attribution does not grant identity, permission, approval, offer or account ownership.
- Include normalized nonempty attribution in the stable submission fingerprint and equality checks. Omitted attribution preserves historical fingerprints, and saved retries reuse their exact payload. Contact-email correction preserves the original attribution.
- Return attribution in token-owned progress and the existing permission-protected admin queue; render it as plain text. Legacy rows remain unset. Additive nullable migration only, no guessed backfill.
- Admin Console company detail (`/system/partners/:id`, overview → ข้อมูลบริษัท) permanently shows รู้จักเราทางไหน as read-only metadata via the earliest company-linked signup (createdAt/id ascending, no queue/state filter). Later applications returning to an existing company do not overwrite original attribution. Legacy/manual companies show ไม่ระบุ. Reuse the existing `system.partner_dashboard.read` permission and persist only on the signup request, avoiding duplicate company columns.
- Verify UI show/hide, request payload, lost-response replay/conflict, correction, source/code separation, validation, admin mapping, mobile/desktop layout and existing signup/security paths. No live rollout is included in this request.

> แก้ไข 2026-09-16: เรื่องอีเมลใช้ [spec สมัคร LINE แบบไม่บังคับอีเมลและยืนยัน OTP ก่อนจ่าย](signup-optional-email-otp-billing-spec-th.md) เป็นกฎปัจจุบัน: อีเมลติดต่อร้านใน LINE เป็นทางเลือก, web claim ยังต้องมีอีเมล, การอนุมัติชำระใหม่ต้องใช้อีเมลบัญชีที่ยืนยันแล้ว และเปลี่ยนผู้รับเอกสารเดิมของบริษัทด้วยการตรวจและยืนยันแยก ข้อความเดิมด้านล่างที่ขัดกันเป็นประวัติ ไม่ใช่กฎสำหรับ implementation รอบนี้

> **Implementation status — IN PROGRESS:** สถานะโค้ด, CI, งานที่ยังค้าง และข้อจำกัดล่าสุดอยู่ที่ [implementation status](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md). ผล E2E และ source ที่ทดสอบดู [หลักฐานกลาง](../evidence/billing-integration-2026-09-13/README.md); แยกผลจำลองออกจากผล native provider และไม่รวมจำนวนทดสอบที่ซ้ำกัน. ข้อความตามวันที่ด้านล่างเป็นประวัติของแต่ละช่วงงาน. ยังไม่ deploy; การ merge develop/main ต้องผ่าน CI และตรวจ scope ที่ค้างก่อน.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **Billing/LINE correctness delta 2026-09-11:** [owned integration design](mangmee-owned-billing-integration-spec-th.md) and [GW evidence](../research/stripe-line-web-gap-closure-2026-09-11.md) supersede earlier PRO-free promotion/current-company fallback and auto-open handoff descriptions. Current trial is FREE_TRIAL_15; rich-menu promotion keeps paid unavailable. Expired recovery uses /renew with active membership and expiry marker; admin holds stay denied. LIFF waits for a gesture; webhook never silently routes selected expired B into active A. New Stripe billing purpose/Checkout remains unimplemented; no OA deployment in this audit.

> **Billing journey extension 2026-09-11 — DESIGN, NOT IMPLEMENTED:** หลังสมัครทาง LINE ลูกค้าใช้ [LINE + web billing UI](mangmee-line-web-billing-ui-spec-th.md) ชุดเดียวกับเว็บ และ [แผน LB01–LB20](../plans/mangmee-line-web-billing-ui-plan-th.md). เพิ่ม target LIFF /link-page/billing และ purpose=billing ใน session exchange: เลือก current OWNER/company รวม term-expired, mint handoff ณ การใช้งาน และเปิด external browser. คง start/signup semantics เดิม; ไม่บังคับ password เพียงเพื่อจ่าย. Package-change command ปัจจุบันเป็นคำขอแอดมิน ไม่ใช่ Stripe purchase; generic billing CTA ต้องไม่เลือก ACTIVE บริษัทแรกหรือ tier ถัดไปแทนผู้ใช้. ไม่มี runtime/device E2E ใหม่จาก amendment นี้.

**Owner amendment 2026-09-07:** รอบแก้ onboarding ถัดไปให้ทดลองได้ 15 ตามแพ็กเกจตั้งแต่วันแรก (ไม่มีเพดานสิบในสัปดาห์แรกสำหรับ trial นี้), เพิ่มอีเมลเจ้าของที่ตรวจรูปแบบเท่านั้นและใช้เป็นอีเมลบัญชีได้ตามเงื่อนไขการไม่ทับบัญชีเดิม, ไม่หักโควตาใบเสร็จที่อ่านไม่สำเร็จ และทำปุ่มเติมข้อมูลบน dashboard ให้ชัดขึ้น ตาม [spec ห้าปัญหา](onboarding-trial-receipt-fixes-spec.md) ซึ่งมีผลเหนือกฎ no-email / warmup10 เดิมที่ขัดกัน ยังไม่ถือว่ายืนยันเจ้าของกล่องอีเมลแล้ว และยังเปิดร้าน/ใช้ผ่าน LINE/สแกนบิลได้ทันทีโดยไม่ต้องตั้งรหัสผ่านหรือรออีเมล การกรอกข้อมูลร้านเพิ่มเติมไม่ใช่เงื่อนไขก่อนสแกนใบเสร็จ

**คำสั่ง Owner เพิ่มเติม:** อีเมลที่เคยใช้ในบัญชี ร้าน หรือคำขอสมัครอื่น ต้องรับคำขอเข้าคิวแอดมิน ไม่เข้า AUTO_FREE ไม่ใช้ช่อง auto รายวัน และไม่ผูกบัญชีด้วยอีเมล ส่วนผู้สมัครที่ผ่านเงื่อนไข auto ครบยังใช้ผ่าน LINE ได้ทันทีโดยไม่ตั้งรหัสผ่าน ดู [เงื่อนไข auto ทั้งหมด](../research/line-signup-auto-approval-conditions-2026-09-07-th.md).

สถานะ: **v4 — 2026-09-04 (หลัง Review รอบ 1 — [mangmee-line-first-signup-review-round-1-th.md](../plans/mangmee-line-first-signup-review-round-1-th.md))** — งบ AI 8,000 สตางค์เคาะแล้ว; deltas ของ v4 อยู่ใน §15 (มีผลเหนือข้อความ §1–§13 เมื่อขัดกัน); implementation เริ่ม Slice L-A
เจ้าของ: Owner (มั่งมีพลัส) / ผู้เขียน: Claude (Fable)
ความสัมพันธ์: **companion ของ P10** ([mangmee-external-signup-contract-spec-th.md](mangmee-external-signup-contract-spec-th.md)) — P10 §4F จดไว้แล้วว่า "ฟอร์มเวอร์ชัน LIFF สำหรับคนสมัครจาก rich menu — รู้ตัวตน LINE ตั้งแต่กรอก" คืองานอนาคต; เอกสารนี้คือการทำงานชิ้นนั้นให้เป็นสัญญา โดย**ไม่หัก**กฎ P10/P11/P12 ที่ production แล้ว
เกี่ยวข้อง: P11 email claim, P12 LINE login/handoff ([line-web-deeplink-handoff-spec.md](line-web-deeplink-handoff-spec.md)), P29 plan term (`packages/contracts/src/plan-term.ts`), แผนหลัก §13.6 + LINE-ONBOARD-01 + AUTH-02, rich menu v2 ([line-rich-menu-v2-spec.md](line-rich-menu-v2-spec.md)), legal acceptance (challenge-evidence model ใน `legal-acceptance.service.ts`)

**ประวัติ:** v1 = มุม UX/BA · v2 = มุมความปลอดภัย/support/ความคุ้มค่า + ยอมรับข้อกำหนดบน LIFF · **v3 = คำตอบ Owner ทั้ง 8 ข้อ:** ฟรี **15 ใบ + หมดอายุ 30 วัน** (ใช้เครื่อง P29 เดิม) · MANUAL 2 สัปดาห์แล้ว AUTO_FREE เมื่อหน้าปัดพร้อม · ปฏิเสธ = แจ้ง ด้วยถ้อยคำสุภาพ มีทั้งเบอร์และอีเมล · ไม่มีปุ่มประเภทธุรกิจ · เก็บชื่อ LINE + ข้อมูลที่กรอก **ไม่เก็บรูปโปรไฟล์** (privacy notice เดิมครอบคลุมแล้ว) · งบ AI ต่อร้าน = ต้นทุนจริงต่อใบ × 15 + เผื่อคุย (ดึงจากมิเตอร์) · SLA "ภายในวันทำการ" จันทร์–เสาร์ 9:00–18:00 · OA เป็น webhook อย่างเดียว (Chat ปิด) ตอนนี้

## 0. ทำไมต้องมี flow นี้ (ปัญหาจริงจากลูกค้า)

ลูกค้าเป้าหมาย = เจ้าของร้านเล็ก วัย 35–55 ใช้ชีวิตบน LINE ไม่เปิดอีเมล เจอฟอร์มยาวแล้วถอย และมีคำถามเดียวตอนกดสมัคร: *"มันจะช่วยฉันยังไง ขอเห็นเลย"* — ความตั้งใจสูงสุดอยู่ใน 2 นาทีแรก

Flow B (P10) ใช้อีเมลเป็นจุดพิสูจน์ตัวตนและเป็นช่องส่งลิงก์ ทำให้เกิด pain 3 อย่างที่ Owner เห็นจากลูกค้าจริง (2026-09-04): **ขี้เกียจกรอก / ขี้เกียจเข้าเมล / ไม่รู้ว่าต้องเข้าไปดูเมลตอนไหน** และวันเดียวกัน AWS SES ปฏิเสธ production access — flow ที่พึ่งอีเมลจึงเป็นความเสี่ยงต่อการเปิดตัวโดยตรง

หลักฐานที่ใช้ตัดสินใจ (ดู §14): ข้อความ LINE เปิดอ่าน 60–80% เทียบอีเมล 15–20%; ฟอร์ม 3 ช่องแปลงเป็นลูกค้าดีสุด ทุกช่องที่เพิ่มลดอัตราสมัคร ~4%; ป้าย "ไม่บังคับ" ดีกว่าดอกจันบังคับ ~25% (**ข้อสุดท้ายถูก Owner override 2026-09-05 — เบอร์มือถือบังคับกรอก, §3.2**)

**เป้าหมาย:** ลูกค้าที่ add LINE OA แล้ว สมัครได้ใน **2 ช่องกรอก (ชื่อร้าน + เบอร์มือถือ) และ 1 แตะยอมรับ** และเข้าใช้งานได้โดย**ไม่ต้องแตะอีเมลหรือรหัสผ่านเลย** ตัวตน = LINE ที่ผูกตั้งแต่วินาทีแรก; อีเมล/รหัสผ่านเป็นของ "ทีหลัง เมื่อมีเหตุผล"

## 1. Current truth (จากโค้ด ณ develop `91957572`)

สิ่งที่มีอยู่แล้วและ flow นี้**ใช้ซ้ำ**:

| ชิ้น | ที่อยู่ | ใช้ทำอะไรใน P10-L |
|---|---|---|
| Flow B core: `CompanySignupRequest` + enum `CompanySignupState` (14 ค่า) + `TRANSITIONS` | `apps/api/prisma/schema.prisma:3071`, `:2841`; `external-signup/domain/company-signup.logic.ts:45` | ตาราง/สถานะเดิม เพิ่ม source ใหม่ ไม่สร้างตารางคู่ขนาน |
| คิวแอดมิน + decide/reissue + แจ้งเตือน SYSTEM_ADMIN ทาง dashboard+LINE | `signup-admin-queue.use-case.ts`, `signup-admin-notify.service.ts` | คิวเดียวกัน แถวจาก LINE โชว์ป้าย LINE |
| `attachUserId` บนคำขอ → provisioning ผูกบริษัทใหม่เข้า User เดิม (`attachedExistingOwner`) | `signup-claim.use-case.ts`, `provision-signup.use-case.ts:29` | เคส "LINE นี้มีบัญชีอยู่แล้ว" = เพิ่มร้านที่ 2 โดยไม่สร้าง User ซ้ำ |
| `ProvisionSignupUseCase` → `CreateCompanyOnboardingUseCase` (กฎสร้างบริษัทชุดเดียว; fence `claimProvisioning`; `modulePackage:'starter'`; `applyPlanTermPreset`) | `provision-signup.use-case.ts:41,:72,:75,:96` | ทางเดียวที่สร้าง Company/User/Membership; plan term 30 วัน |
| P29 plan term: `PlanTierKey`/`PLAN_TIER_PRESETS` + ladder เตือน 7/3/1 วัน (OWNER, web+LINE) + หมดอายุ → DISABLED + `expiredLineOwnerMessageTh` | `packages/contracts/src/plan-term.ts:4,:46`; `plan-term.logic.ts:139`; `process-line-webhook.use-case.ts:1441` | ทดลองฟรี 15 ใบ/30 วัน ใช้เครื่องนี้ทั้งชุด |
| `ExternalIdentity` (LINE) `@@unique([provider, providerChannelId, providerUserId])` | `schema.prisma:786` | รั้ว "1 LINE = 1 บัญชี" เชิงโครงสร้าง |
| LIFF page pattern: HTML เสิร์ฟจาก API + `LIFF_PAGE_SCRIPT` modes `account/employee/customer` + CSP | `auth.controller.ts:432,:569`; `common/security/liff-page.security.ts` | เพิ่ม mode `signup` และ `start` ในแบบเดียวกัน (ไม่มีหน้า LIFF ใน Next.js) |
| ตรวจ LIFF ID token ฝั่งเซิร์ฟเวอร์ (employee link) | `auth.controller.ts:612` → `complete-employee-line-link.use-case.ts:23` | ตัวพิสูจน์ตัวตน LINE ที่ใช้ซ้ำสำหรับ signup/start |
| Handoff token (15 นาที, path ใน `/companies/<id>` เท่านั้น) + route `/l/[token]` ตั้งคุกกี้แล้ว 303 | `mint-line-handoff-token.use-case.ts:35`, `line-handoff.logic.ts:11,:46`; `apps/web/app/l/[token]/route.ts` | "กดลิงก์แล้วอยู่ในระบบเลย" โดย mint **ตอนแตะ** ไม่ใช่ตอนส่งข้อความ |
| Push/Reply ข้อความหา LINE userId (env channel token) | `line-reply.adapter.ts:43-45`, `auth/infrastructure/system-line-push.ts:8` | แจ้งสถานะ; นโยบาย reply-first (§7) |
| Unlinked-user reply ใน webhook | `process-line-webhook.use-case.ts:1799-1802`, copy `:154` | เปลี่ยนเป็นการ์ด 3 ประตู (§3.1) |
| ด่านยอมรับข้อกำหนด: guard + `LegalDocumentActionRecord` (มี field `surface`, `authProvider`, `displayChallenge`, `statementSha256`, `releaseFingerprintSha256`) + การ์ดใน LINE + หน้าเว็บ `/legal-acceptance` | `auth.guard.ts:33`, `legal-acceptance.service.ts:115,:144,:169`, `line-business-card.logic.ts:303`, `schema.prisma:629` | หลักฐาน PDPA ชุดเดียวกัน แต่เก็บตั้งแต่ LIFF (§3.2/§6) |
| Promotion tile ใน rich menu v2 + การ์ดโปรโมชั่นแบบ reply | `line-staff-menu.logic.ts:171 buildPromotionCard` | โปรโมชั่นแบบลูกค้ากดดูเอง (§7) |
| มิเตอร์เงิน AI ต่อร้าน (`AiUsageEvent.costSatang`, `sourceRoute` receipt-ocr-line/receipt-ocr-web/line-turn) + งบต่อร้าน `CompanyAiConfiguration.monthlyBudgetSatang` | `schema.prisma:3215` | ต้นทุนจริงต่อใบ → งบร้านฟรี (§6/§9/§11) |
| แพ็กเกจเมนู "เริ่มต้น" | `packages/contracts/src/menu-entitlements.ts:421` `.starter` | เมนูของร้านทดลอง |
| Rate-limit buckets ต่อ IP/email | `auth-rate-limit.service.ts:130-154` | เพิ่ม bucket ต่อ LINE userId (ยังไม่มี) |
| Flags `EXTERNAL_SIGNUP_ENABLED`, `LINE_LIFF_ID`, `LINE_WEB_HANDOFF_ENABLED` + deploy.sh wiring (prod hard-stop) | `app-config.service.ts:66-70`; `deploy.sh:184-193,:1515` | เพิ่ม flag ชุด LINE signup แบบเดียวกัน |
| หน้า system: Unlink LINE, Reissue owner LINE QR, `/system/users` | `PartnerDetailPage.tsx`, `SystemOnboardingNewPage.tsx`, `lookup-users.use-case.ts` | เส้นกู้บัญชี (§9) และเครื่องมือ support (§8) |
| LINE OA Response settings (2026-09-04): **Chat ปิด, Greeting ปิด, Webhooks เปิด, Auto-response ปิด** | LINE OA Manager (นอก repo) | greeting ตอน add เพื่อนต้องมาจาก webhook `follow`; ตอบมือจากแอป LINE OA ยังทำไม่ได้ (§8) |

สิ่งที่**ยังไม่มี** (ต้องสร้าง): คอลัมน์ LINE identity + หลักฐานยอมรับบนคำขอ; tier `FREE_TRIAL_15`; LIFF mode `signup`/`start`; endpoint LIFF ID-token → handoff session; per-LINE-user rate limit; การ์ด 3 ประตู (+ ตรวจว่า webhook รับ `follow` event); ตัวเลือก auto-approve; timeline ต่อร้าน; คำขอเปลี่ยนแพ็กเกจ; กล่องส่งข้อความถึงร้านจากหน้า partner; หน้าสรุป funnel/ต้นทุน; rich menu ต่อผู้ใช้ (Phase 2)

## 2. หลักการที่ห้ามละเมิด (สืบทอด P10 + เพิ่มของ P10-L)

1. **SIGNUP-01 คงเดิม:** ทุก retry เดินต่อจาก state เดิมแบบ idempotent — ห้ามสร้าง Company/User/Membership/ExternalIdentity/LegalDocumentActionRecord ซ้ำ
2. **SIGNUP-02 ตีความใหม่สำหรับ source นี้:** "ไม่ provision จนกว่าจะพิสูจน์ว่ามีคนจริง" — ใน Flow B พิสูจน์ด้วย mailbox; ใน P10-L พิสูจน์ด้วย **LIFF ID token ที่เซิร์ฟเวอร์ตรวจแล้ว** (คนคนนั้นอยู่ในแชท OA ของเราจริง ณ ตอนกรอก) → provision ได้ทันทีหลังอนุมัติ ไม่มีขั้น claim
3. **LINE-ONBOARD-01 คงเดิมและเข้มขึ้น:** ไม่มี temporary password, ไม่มี token ส่วนตัวในข้อความ LINE/อีเมล — ปุ่มทุกปุ่มที่ส่งไปคือ URL LIFF **กลาง** (ไม่มี token) แล้ว mint handoff **ตอนแตะ**
4. **AUTH-02 คงเดิม:** LIFF ใช้ credential ชุดเดียว (`LINE_LIFF_ID` + Messaging channel เดิม)
5. **ไม่ถามรหัสผ่านและอีเมลตอนสมัคร** — ตั้งได้ทีหลังจากหน้าตั้งค่า พร้อมเหตุผลที่ลูกค้าเข้าใจ (§3.6)
6. Provision ผ่าน `CreateCompanyOnboardingUseCase` เดิมเท่านั้น (กฎสร้างบริษัทชุดเดียว) — ขยาย input ไม่ทำทางลัด
7. การเข้าใช้งาน**ต้องไม่พึ่งอีเมลในทุกขั้น** — อีเมลใน flow นี้เป็นใบเสร็จ/สำเนา ล้มเหลวได้โดยไม่กระทบ state
8. **LEGAL-LIFF-01 (Owner 2026-09-04):** การยอมรับข้อกำหนดแบบมีผลผูกพันเกิด**บน LIFF ตอนสมัคร** โดยใช้หลักฐาน**ชุดเดียวกับในแอป** (เวอร์ชันเอกสาร + statementSha256 + releaseFingerprint + displayChallenge + เวลา + ตัวตน LINE + userAgent/locale) และถูกบันทึกเป็น `LegalDocumentActionRecord` ตอน provisioning — ห้ามมี "ยอมรับแบบอ่อน" ที่ไม่มีหลักฐานเทียบเท่า
9. **MSG-01 reply-first:** ข้อความถึงลูกค้าใช้ reply (ฟรี ไม่กินโควตา OA) ทุกครั้งที่มี reply token; push ใช้เฉพาะเหตุการณ์ที่ลูกค้าไม่ได้เป็นฝ่ายเริ่ม (อนุมัติ/ปฏิเสธ/ระงับ/เตือน P29/กันหลุด) และ**ไม่มี broadcast/โฆษณาเชิงรุก** — โปรโมชั่นเป็นแบบลูกค้ากดดูเองเท่านั้น จึงไม่ต้องมี consent การตลาด
10. **DATA-MIN-01 (Owner 2026-09-04):** เก็บเฉพาะชื่อ LINE (displayName) + ข้อมูลที่ลูกค้ากรอกเอง (ชื่อร้าน, เบอร์มือถือ — บังคับกรอกตั้งแต่ 2026-09-05 §3.2); **ไม่เก็บรูปโปรไฟล์** LINE — อยู่ในขอบเขต privacy notice ปัจจุบัน ไม่ต้องแก้ประกาศ

## 3. Journey ฝั่งลูกค้า (ทุกจอต้องผ่านมือถือ 390px, ภาษาไทยธรรมดา, ห้ามมีเครื่องหมาย "+")

### 3.1 ประตูเข้า — การ์ด 3 ประตู (แทน unlinked reply เดิม; ส่งเป็น reply)

เมื่อ LINE user ที่ยังไม่ผูกบัญชีส่งข้อความใดๆ **หรือ add เพื่อน (webhook `follow` — Greeting ของ OA ปิดอยู่)** ระบบตอบการ์ดเดียว (owner 2026-11-05: ข้อความที่พิมพ์หรือส่งมาได้บรรทัดอธิบาย 1 บรรทัดก่อนการ์ด ดู amendment ด้านบน):

- **"เปิดร้านใหม่"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/signup` (ไม่มีทดลองฟรี; R1/R-C7)
- **"ฉันเป็นพนักงาน"** → ข้อความสั้น: ให้เจ้าของร้านส่งลิงก์เชื่อม LINE จากเมนู "พนักงาน" (ใช้ระบบ employee link เดิม) — ปิดกับดัก "พนักงานเผลอสมัครร้านซ้ำ"
- **"มีบัญชีอยู่แล้ว เชื่อม LINE"** → LIFF account link-page เดิม (`GET /v1/auth/line/link-page`)

ถ้า LINE user นี้มีคำขอค้าง (§5) การ์ดเปลี่ยนเป็น**การ์ดสถานะ** ตามเวลา: ในเวลาทำการ → "ได้รับคำขอแล้ว ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ (จันทร์–เสาร์ 9:00–18:00) ค่ะ"; นอกเวลาทำการ → "ได้รับคำขอแล้ว ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไปนะคะ"

#### 3.1.1 ประตูที่สองสำหรับคนที่ผูกบัญชีแล้ว — การ์ด "บริษัทของฉัน" (`/companies`) **เฉพาะเจ้าของ** (delta 2026-09-06)

การ์ด 3 ประตูข้างบนไปถึงเฉพาะคนแปลกหน้า คนที่ผูก LINE แล้วจึงมีปุ่ม **"เปิดร้านใหม่"** อยู่ท้ายการ์ด "บริษัทของฉัน" แทน (LIFF กลางหน้าเดียวกัน ไม่มี id/token ใน URL — LINE-ONBOARD-01) **มติ Owner 2026-09-06:** "ปุ่มเปิดร้านใหม่โผล่ให้ STAFF ผ่าน /companies => staff ไม่ควรเห็น ถ้าเขาจะเปิดร้านเองต้องผ่าน promotion หากอยู่ในมุมมองพนักงาน"

- ปุ่ม **"เปิดร้านใหม่"** ขึ้นเมื่อ membership ของผู้ดู**ในบริษัทที่การ์ดใบนี้พูดถึง**มี role key `OWNER` เท่านั้น — ตรวจด้วย **key** ไม่ใช่ชื่อ role (บริษัทเปลี่ยนชื่อ role ได้) และผูกกับ membership ใบเดียว ดังนั้นคนคนเดียวกันเห็นปุ่มบนการ์ดร้านของตัวเอง และไม่เห็นบนการ์ดร้านที่ตัวเองเป็นพนักงาน ("หากอยู่ในมุมมองพนักงาน")
- **มุมมองพนักงาน** ได้ 1 บรรทัดแทนปุ่ม: **"💡 อยากเปิดร้านของตัวเอง กดปุ่ม โปรโมชั่น ในเมนูได้เลยค่ะ"** — ไม่มี URL ไม่มี LIFF id ไม่มี id ใด ๆ, ไม่มีอักขระ "+" (§3), และคำว่า "โปรโมชั่น" อ่านจากค่าคงที่ตัวเดียวกับปุ่ม/ตัวจับคำสั่ง จึงไม่มีวันชี้ไปยังคำที่เลิกทำงาน; บรรทัดนี้อยู่ในตัวการ์ดอย่างเดียว ไม่เข้า altText (ไม่ใช่ข่าวเรื่องคำขอของเขาเองแบบบรรทัด 🕒)
- เงื่อนไขเดิมมาก่อนเสมอ: **มีคำขอค้าง** (§5) → การ์ดพูดถึงคำขอนั้นอย่างเดียว ไม่มีทั้งปุ่มและบรรทัดชวน (ฟอร์ม LIFF ตอบได้แค่ `line_signup_already_pending`); **environment ที่ปิด self-service signup** (`EXTERNAL_SIGNUP_ENABLED=false` — production วันนี้ — หรือ LIFF id ใช้ไม่ได้) → การ์ดเหมือนเดิมทุกไบต์ทั้งเจ้าของและพนักงาน เพราะไม่มีประตูให้แทนที่จึงไม่มีอะไรให้ชี้
- เหตุผลเดียวกับประตู "ฉันเป็นพนักงาน" ข้างบน — ปิดกับดัก "พนักงานเผลอสมัครร้านซ้ำ" ที่ปลายทางของคนที่ผูกบัญชีแล้ว (ฝั่ง submit ไม่ได้แยกบทบาท: §5 `attachUserId` ตั้งจาก `ExternalIdentity` ACTIVE เท่านั้น พนักงานที่ยื่นได้จึงกลายเป็นเจ้าของร้านใหม่โดยไม่มีด่านไหนทัก)
- **ไม่แก้**การ์ดโปรโมชั่นและ URL ของมัน (Owner design 2026-08-27) และ**ไม่แตะ**การ์ด 3 ประตูของคนแปลกหน้า

### 3.2 ฟอร์ม LIFF `signup` — 2 ช่อง และยอมรับข้อกำหนด (มีผลผูกพัน)

- หัว: ชื่อจากโปรไฟล์ LINE ("สวัสดีคุณ นิด") — แสดงจาก `liff.getProfile()` ฝั่ง client; ค่าที่เก็บจริงคือ displayName จาก ID token ที่เซิร์ฟเวอร์ตรวจ; **ไม่ดึง/ไม่เก็บรูป** (DATA-MIN-01)
- ช่องที่ 1: **ชื่อร้าน** (บังคับ, 1–120 ตัวอักษร, ซ้ำกับร้านอื่นได้ตาม P10 §4C) — **ไม่มีตัวเลือกประเภทธุรกิจ** (Owner ข้อ 4)
- ช่องที่ 2: **เบอร์มือถือ — บังคับกรอก (Owner 2026-09-05 จาก UAT รอบมือถือจริง; แทนที่มติ "ไม่บังคับ" 2026-09-04 และมีผลเหนือหลักฐาน Baymard §14)** — ป้าย "เบอร์มือถือ" เฉย ๆ ไม่มีวงเล็บ, `required` + `inputmode="tel"`, 10 หลักขึ้นต้น 0 (รับเว้นวรรค/ขีดคั่น แล้วตัดเหลือเฉพาะตัวเลข), เก็บลง `CompanySignupRequest.phoneNumber` ที่มีอยู่แล้ว; แอดมินโทรตามได้จากคิว (§8)
  - ตรวจ 2 ชั้น: หน้า LIFF ตรวจก่อนส่ง (ไม่ส่งเลยถ้าไม่ผ่าน) และเซิร์ฟเวอร์ตรวจซ้ำที่ `requireThaiMobile` → **400** `line_signup_phone_required` (ว่าง) หรือ `line_signup_phone_invalid` (ไม่ใช่เบอร์มือถือไทย); DTO ปิดเคส "ไม่ส่ง field มาเลย" ด้วย `@IsNotEmpty()` ก่อนเสีย round trip ตรวจ ID token
  - ทั้งสองรหัสแมปเป็นประโยคเดียวข้างช่อง: **"กรุณาใส่เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0"** (ลูกค้าแก้ได้เหมือนกันทั้งสองกรณี ไม่ต้องแยกถ้อยคำ)
  - ผลข้างเคียง: คำขอจาก LINE **มีเบอร์เสมอ** → การ์ด "กันหลุด" วันที่ 7 (§3.6) ไม่ยิงให้เคสนี้อยู่แล้วโดยเงื่อนไข `phoneNumber: null` ใน `sweepProfileGuardNudges` (ไม่ต้องแก้โค้ด) — การ์ดจึงเหลือประเด็น **อีเมล/รหัสผ่าน** เท่านั้นสำหรับผู้ใช้ที่มาทางนี้
- **บล็อกยอมรับข้อกำหนด (LEGAL-LIFF-01):** หน้า LIFF ถูกเรนเดอร์จาก API จึงฝัง**ข้อความยอมรับฉบับปัจจุบัน** (statement text + เวอร์ชัน + ลิงก์ประกาศความเป็นส่วนตัว/ข้อกำหนด) และ **displayChallenge** แบบเดียวกับหน้า `/legal-acceptance` ในแอป; ปุ่มเดียว **"ยอมรับและเริ่มทดลองใช้ฟรี"**; การแตะ = ส่ง `{ documentVersion, statementSha256, releaseFingerprintSha256, displayChallenge, locale }` กลับพร้อมฟอร์ม; เซิร์ฟเวอร์ตรวจว่าตรงกับ release ปัจจุบัน (ไม่ตรง → 409 ให้โหลดหน้าใหม่) แล้วเก็บเป็นหลักฐานบนคำขอ (§5) — เวลาที่ยอมรับ = เวลาที่เซิร์ฟเวอร์รับ ไม่ใช่เวลาจาก client
  - **displayChallenge (64 hex) ไม่แสดงบนหน้าจอ** (Owner 2026-09-06) — อยู่ใน `data-legal-challenge` ของหน้าเท่านั้น สคริปต์ยังส่งกลับครบทั้งสตริงและเซิร์ฟเวอร์ยังตรวจ/เก็บเป็นหลักฐานเหมือนเดิม จึงไม่กระทบสัญญาหลักฐาน; แทนที่มติ 2026-09-05 ที่ให้แสดงในบล็อกของตัวเองแบบ monospace 12px + `overflow-wrap:anywhere; word-break:break-all` (มติเดิมแก้ปัญหาสตริงล้นจอ 390px — เมื่อไม่แสดงแล้วปัญหานั้นหมดไป)
- ใต้ปุ่ม 1 บรรทัด: **"ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง"** (Owner 2026-09-05 ตัด "ไม่ต้องใส่บัตร" ออก; ห้ามมีอักขระ "+" ในถ้อยคำที่ลูกค้าเห็น)
- **ไม่มี** ช่องอีเมล รหัสผ่าน เลขภาษี — ถามทีหลังในจังหวะที่มีเหตุผล (§3.6)
- ถ้า `?ref=<code>` มากับ LIFF URL (QR อินฟลูฯ ตาม §13.6B) → เก็บ `referralCode` เดิม
- ส่งแล้ว: หน้าเดียวกันเปลี่ยนเป็น **"ได้รับแล้ว"** บอกชัดว่า *จะเกิดอะไรต่อ / นานแค่ไหน / จะรู้ได้ยังไง* + ปุ่ม "ปิด"
  - **หัวการ์ดกับเนื้อความห้ามพูดซ้ำกัน (Owner 2026-09-05):** หัวคือ "ได้รับแล้ว" เนื้อความจึงขึ้นต้นด้วยสิ่งที่จะเกิดต่อ — "ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ (จันทร์–เสาร์ 9:00–18:00) พร้อมใช้เมื่อไหร่เราจะส่งข้อความในแชทนี้นะคะ" (ไม่ขึ้นต้นว่า "ได้รับแล้วค่ะ" อีก)
  - กติกาเดียวกันใช้กับการ์ด "รอตรวจสอบ" ทั้งบนหน้า LIFF และการ์ดสถานะในแชท (§3.1/§7 หัวการ์ด "ได้รับคำขอแล้ว"): "คำขอเปิดร้าน &lt;ชื่อร้าน&gt; **เข้าระบบแล้วค่ะ** ทีมงานกำลังตรวจสอบ …" / นอกเวลาทำการ "… เข้าระบบแล้วค่ะ ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป …" — สองผิวต้องตรงกันเสมอ
- **กล่องข้อความว่างต้องไม่ถูกวาด (Owner 2026-09-05 รอบที่ 2):** `#detail` (กล่อง monospace) มีพื้นหลัง/ขอบ/ระยะใน และ `#status` มีพื้นหลัง/ขอบซ้ายจากคลาส `.notice` — เมื่อไม่มีข้อความจึงกลายเป็นกล่องเปล่า ๆ ใต้บรรทัดทดลองใช้ฟรี — ซ่อน 2 ชั้น: CSS `#status:empty,#detail:empty{display:none}` (ครอบ paint แรกก่อนสคริปต์ทำงาน) และ `setStatus` สลับ `hidden` จากข้อความที่ trim แล้ว (ครอบเคสที่ `:empty` มองไม่เห็น คือข้อความที่มีอยู่แต่เป็นช่องว่างล้วน); ข้อความจริง (error / รอตรวจสอบ / สำเร็จ) ยังแสดงด้วยสไตล์เดิมทุกประการ

- **โทนข้อความ + คำแนะนำ (Owner 2026-09-05 รอบที่ 3 — "warning สีเหลือง / ส่งไม่สำเร็จสีแดง พร้อมคำแนะนำว่าอะไรผิดด้วย"):** `setStatus(text, detail, tone)` วาด `#status` เป็นกล่องแจ้งเตือนมุมมน (พื้นอ่อน + ขอบซ้ายหนา + ไอคอน `::before` เพื่อไม่สื่อด้วยสีอย่างเดียว) ตัวอักษร 16px ฟอนต์เดียวกับหน้า **ไม่ใช่ monospace**; บรรทัดที่ 2 = คำแนะนำ (ใช้ `white-space:pre-line` ไม่ต้องมี markup); `#detail` เหลือไว้เฉพาะข้อความทางเทคนิคเท่านั้น

| tone | สี (ข้อความ/พื้น) | อัตราส่วนความต่างสี | ใช้เมื่อ |
|---|---|---|---|
| `info` | `#1E3A8A` บน `#EFF6FF` | 9.52:1 | กำลังดำเนินการ / มีคำขอเดิมอยู่แล้ว |
| `success` | `#14532D` บน `#ECFDF5` | 8.65:1 | สำเร็จ (ได้รับคำขอ, เปิดหน้าเว็บให้แล้ว) |
| `warning` | `#713F12` บน `#FEF9C3` | 8.07:1 | กรอกไม่ครบ/ไม่ถูกต้อง, 429, เน็ตหลุด, หน้าเปิดค้าง — แก้เองได้ |
| `error` | `#7F1D1D` บน `#FEF2F2` | 9.16:1 | ถูกปฏิเสธ/ระบบขัดข้อง — ต้องรอหรือติดต่อทีมงาน |

  - **ระดับฟิลด์:** ช่องที่ผิดได้ `aria-invalid="true"` + ขอบแดง, ข้อความสั้นอยู่ **ใต้ช่องนั้น** (`#<id>-error`) และเคอร์เซอร์ย้ายไปที่ช่องนั้น (`focus()`) — เพราะบนจอ 390px กล่องสรุปด้านบนและ `#detail` ด้านล่างอยู่นอกจอทั้งคู่ตอนที่แตะปุ่ม
  - **ฝั่ง client ที่ยังไม่ได้ส่ง** ต้องไม่ขึ้นว่า "ส่งคำขอไม่สำเร็จ" — ใช้ tone `warning` เช่น "กรอกเบอร์มือถือให้ครบก่อนนะคะ"
  - **ตารางคำแนะนำ** (`SIGNUP_GUIDANCE`) แมปจาก**รหัสจริงที่เซิร์ฟเวอร์ตอบเท่านั้น**: `line_signup_phone_required` / `line_signup_phone_invalid` / `invalid_companyName` / `invalid_referralCode` (warning, ระดับฟิลด์), `legal_release_changed` (warning + ปุ่มโหลดหน้าใหม่), `line_signup_already_pending` (info → การ์ดสถานะ), `line_signup_disabled` / `web_base_url_not_configured` (error + ช่องทางติดต่อ); ตามด้วยสถานะ 401/403/503, 429 (warning + วินาทีที่ต้องรอถ้า API ส่ง `retryAfterSeconds` มา), เน็ตหลุด (warning + ลองใหม่); **รหัสที่ไม่รู้จักตกไปที่ข้อความ error กลาง ไม่แสดงรหัสดิบให้ลูกค้าเห็น**
  - **ปุ่มหลัก:** ระหว่างส่ง `disabled` + ป้าย "กำลังส่ง…"; เมื่อ warning/error ป้ายเดิมกลับมาและกดใหม่ได้ทันที
  - **ความต่างสีขั้นต่ำ:** ตัวอักษรขาวบน `--brand` `#22C55E` = 2.28:1 (ตก AA) จึงใช้ `--brand-dark` `#15803D` (5.02:1) กับปุ่มและแถบหัวทุกที่; `#22C55E` เหลือไว้เฉพาะที่ไม่มีตัวอักษรทับ (ขอบซ้ายของกล่อง success) — ตรวจด้วย `liff-page-contrast.spec.ts`
- **ธีมมั่งมี (Owner 2026-09-05):** ทุกหน้า LIFF ที่ API เสิร์ฟ **ทั้ง 5 หน้า** (signup / start / employee / account-link / customer-register ของ crm-inbox) สร้างจาก `liffPageHtml` ตัวเดียวกัน — แถบหัวเขียวเข้ม `#15803D` + โลโก้ "เหรียญงอกเงย" เป็น inline SVG + คำว่า "มั่งมีพลัส", การ์ดขาวมุมโค้ง 12px บนพื้น off-white, ปุ่มหลักเขียวเข้มตัวอักษรขาวสูงอย่างน้อย 48px เต็มความกว้าง, ลิงก์รองสีเขียวเข้ม `#15803D`, ฟอนต์ระบบ `-apple-system, "Noto Sans Thai", "Sarabun", sans-serif` (ไม่โหลดฟอนต์ภายนอก), ตัวอักษรเนื้อความ 16px, ช่องกรอกสูง 48px ฟอนต์ 16px (กัน iOS zoom); **`LIFF_PAGE_CSP` ไม่เปลี่ยน** — โลโก้เป็น inline SVG จึงไม่ต้องขอ origin เพิ่ม

### 3.3 การรอ (ถ้าโหมด MANUAL) — ต้องไม่เงียบ

- ทันทีหลังส่ง: หน้า LIFF แสดง "ได้รับแล้ว" (ไม่ต้อง push — MSG-01); ถ้าผู้ใช้พิมพ์อะไรมา → reply การ์ดสถานะ (§3.1)
- แอดมินได้แจ้งเตือนคิวตามเดิม (dashboard + LINE) พร้อมป้าย "จาก LINE"; **ค้างเกิน 60 นาทีในเวลาทำการ → เตือนแอดมินซ้ำทาง LINE อีกครั้ง** (exactly-once ต่อคำขอ; คำขอนอกเวลาทำการเริ่มนับตอน 9:00 ของวันทำการถัดไป)
- โหมด **AUTO_FREE** (§10): ไม่มีการรอ — ข้ามไป §3.4 ทันที; แอดมินเห็นแถว "อนุมัติอัตโนมัติ" ไว้ตรวจย้อนหลังและระงับได้

### 3.4 อนุมัติ → พร้อมใช้ทันที (จริง)

- provisioning สร้างบริษัท+เจ้าของ (§6), **ผูก `ExternalIdentity` LINE และบันทึก `LegalDocumentActionRecord` ในธุรกรรมเดียวกัน** → LINE AI ใช้ได้ทันที: webhook หาตัวตนเจอและด่านยอมรับผ่านแล้ว (ไม่มีการ์ด "ยอมรับข้อกำหนดก่อน" สำหรับคนที่มาจาก flow นี้)
- **แก้ 2026-09-28 (purchase-without-setup R-C4, §18.2):** push (1 ครั้ง — เหตุการณ์เดียวที่ต้อง push) หัวข้อ "เปิดร้านแล้ว" ข้อความ "🎉 เปิดร้าน <ชื่อร้าน> ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน กดปุ่มด้านล่าง แล้วกดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ" + ปุ่ม **"เลือกแพ็กเกจ"** → LIFF `https://liff.line.me/<LINE_LIFF_ID>/start` (URL กลาง ไม่มี token; 2 แตะจาก push — DQ3) ไม่มีประโยคชวนส่งใบเสร็จอีกต่อไป เพราะร้านล็อกจนกว่าจะเลือกแพ็กเกจ (ไม่มีทดลองใช้ฟรีอีกแล้ว — R1/R-C7)

### 3.5 "เริ่มใช้งาน" = แตะแล้วอยู่ในระบบ ไม่มีหน้า login

LIFF `start` → ขอ ID token → `POST /v1/auth/line/liff/session` (§4) → เซิร์ฟเวอร์ตรวจ token → หา `ExternalIdentity` ACTIVE → เลือกบริษัท (ถ้ามีหลายร้าน ใช้ `LineCompanyContext` เดิม หรือให้เลือกในหน้า LIFF) → mint handoff token (15 นาที) → ตอบ URL `/l/<token>` → LIFF เปิดใน**เบราว์เซอร์ภายนอก** (`liff.openWindow({external:true})` — คุกกี้ไปอยู่ใน Safari/Chrome ไม่ใช่ในแอป LINE; บทเรียน QR fix 2026-09-01) → route `/l/[token]` ตั้งคุกกี้ → 303 ไป target

target ครั้งแรก = **แดชบอร์ดของร้าน** `/companies/<id>/dashboard` สำหรับร้าน ACTIVE — **แก้ 2026-09-06 ตาม Owner** (เดิมเป็นหน้า "ทำสิ่งแรกให้สำเร็จ" = `expenses/upload`): ให้เห็นภาพรวมร้านก่อน ส่วนใบเสร็จใบแรกส่งในแชท LINE ได้อยู่แล้ว (§3.2) และเป็น landing เดียวกับที่ `/l/<token>` ใช้อยู่แล้วเมื่อแถวไม่มี `targetPath`; ด่าน `/legal-acceptance` จะโผล่**เฉพาะ**เมื่อมี release ข้อกำหนดใหม่กว่าที่ยอมรับไว้ (พฤติกรรม guard เดิม) — **แก้ 2026-09-28 (purchase-without-setup R-C3, §18.2):** ร้านล็อก (ยังไม่มีแพ็กเกจ/หมดอายุ) ไม่ไปแดชบอร์ด: ผู้มีสิทธิ์ `company.plan.manage` ไป `/companies/<id>/billing?channel=line` โดยตรง ส่วนคนอื่นไป `/companies/<id>/renew` (`exchange-liff-session.use-case.ts` `destination()`, ตัดสินโดย `resolveLineHandoffTarget` เดิม)

### 3.6 ของ "ทีหลัง" — progressive profiling (ไม่อยู่ในฟอร์มสมัคร)

| ข้อมูล | ถามเมื่อ | ทำไมลูกค้ายอมให้ |
|---|---|---|
| **อีเมล/รหัสผ่าน "กันหลุด"** | **วันที่ 7 หลังใช้จริง** (หรือหลังส่งใบเสร็จครบ 5 ใบ แล้วแต่ถึงก่อน) — การ์ดใน LINE 1 ใบ exactly-once: "ใส่อีเมลหรือเบอร์ไว้ เผื่อเปลี่ยนมือถือแล้ว LINE หลุด" [ใส่เลย] [ไว้ก่อน]<br>ตั้งแต่ 2026-09-05 คำขอทาง LINE มีเบอร์เสมอ (§3.2) → `sweepProfileGuardNudges` ที่กรอง `phoneNumber: null` อยู่แล้ว จะไม่ยิงการ์ดให้เคสนี้; **การ์ดจึงเหลือประเด็นอีเมล/รหัสผ่านเท่านั้น** (ไม่ต้องแก้โค้ด sweep) | เห็นความเสี่ยงของตัวเอง ไม่ใช่ของเรา |
| อีเมล (ใช้งาน) | ตั้งค่า → "รับสำเนา/สำรองบัญชี" หรือครั้งแรกที่ขอส่งออกรายงาน | เห็นประโยชน์ทันที |
| รหัสผ่าน | ตั้งค่า → "เข้าใช้บนคอมโดยไม่ใช้มือถือ" (ทางเลือก; บนคอมมี QR สแกนอยู่แล้ว) | ไม่บังคับใคร |
| เลขผู้เสียภาษี/VAT | ครั้งแรกที่จะออกเอกสารภาษี | จำเป็นจริงตอนนั้น |
| เบอร์โทร | **ถามตอนสมัคร (ช่องที่ 2 — บังคับกรอกตั้งแต่ Owner 2026-09-05)**; ไม่มีเคส "เว้นไว้" อีกแล้ว | ช่องเดียว 10 หลัก และเป็นทางกู้ร้านคืนถ้า LINE หลุด |

อีเมลที่ตั้งทีหลังต้องผ่าน `EmailVerificationToken` เดิม; ถ้าอีเมลนั้นเป็นของ User อื่นที่มีอยู่ → เสนอ "รวมบัญชี" ผ่าน `AccountMergeTicket` เดิม (P10 §4F) ไม่ผูกอัตโนมัติ; เบอร์โทร "กันหลุด" เก็บบน User เป็นข้อมูลติดต่อ (ไม่ใช่ OTP login ในรอบนี้)

### 3.7 ปฏิเสธ / ระงับ / ชนโควตา / หมดอายุ / ขอเปลี่ยนแพ็กเกจ

- **Reject (Owner ข้อ 3: แจ้งเป็นค่าเริ่มต้น ถ้อยคำสุภาพ มีทั้งเบอร์และอีเมล):** push 1 ครั้ง — ร่าง copy ใน §7; ไม่เปิดเหตุผลภายใน; ให้ทางไปต่อ 2 ช่องทาง
- **Suspend หลัง auto-approve:** state `SUSPENDED` เดิม + company DISABLED → LINE AI ตอบข้อความระงับ (แนว expired-owner เดิม)
- **ชนโควตา 15 ใบ (ข้อความบริการ ส่ง 1 ครั้งตอนชนจริง — ไม่เตือนซ้ำรายวัน):** reply ต่อใบเสร็จที่ชน "ช่วงทดลองอ่านให้ได้ 15 ใบ ครบแล้วค่ะ" + ปุ่ม **"ดูแพ็กเกจ"** (การ์ดโปรโมชั่น — pull) และ **"ขอเปลี่ยนแพ็กเกจ"** → สร้าง **คำขอเปลี่ยนแพ็กเกจ** เข้าคิวแอดมิน (§8)
- **หมดอายุ 30 วัน (P29 เดิม):** เตือนก่อน 7/3/1 วัน (**แก้ 2026-09-28: ผู้มีสิทธิ์ `company.plan.manage` ทุกคน — R-C11/D-PF-10 — ไม่ใช่ OWNER เท่านั้น**, web+LINE) → หมดแล้ว company DISABLED + LINE ตอบ `expiredLineOwnerMessageTh` — **เพิ่มปุ่ม "ขอเปลี่ยนแพ็กเกจ" ในข้อความหมดอายุ** (ต่อยอดข้อความเดิม ไม่เปลี่ยน state machine ของ P29); **แก้ 2026-09-28 เพิ่มเติม (purchase-without-setup R-B2/R-C11, §18.2):** เมื่อ self-service billing เปิด LINE ส่งการ์ดล็อกแทน — ปุ่ม "เลือกแพ็กเกจ" เป็น `/l/<token>` mint ในเลนก่อนบันทึก (R-B2 ทาง ข; ห้ามในกลุ่ม/ห้อง) ให้ผู้มี `company.plan.manage` ทุกคน (R-C11); ข้อความ `expiredLineOwnerMessageTh` ใช้เฉพาะเมื่อ billing ปิด
- **การชำระเงินช่วงแรกทำมือ:** แอดมินตกลงในแชท/โทร แล้วเปลี่ยนแพ็กเกจจากหน้า partner (ปุ่มเดิม); ระบบจ่ายอัตโนมัติเป็นของ P10 §4E/P26 ภายหลัง — **แก้ 2026-09-28:** ตั้งแต่ 2026-09-23 ลูกค้าซื้อเองผ่านหน้าแพ็กเกจ (Stripe) ได้ทันที ไม่ต้องรอแอดมิน; แอดมินยังปรับแพ็กเกจจากหน้า partner ได้เหมือนเดิม (มีคำเตือนเพิ่ม — ดู PR B)
- **โปรโมชั่น = pull เท่านั้น:** ปุ่ม Promotion ใน rich menu / พิมพ์ "โปรโมชั่น" → reply การ์ดโปรโมชั่น (มีอยู่แล้ว) + ปุ่ม "ขอเปลี่ยนแพ็กเกจ"; **ไม่มี broadcast** ทุกกรณี

## 4. สัญญา (API / LIFF)

ทุก endpoint ใหม่อยู่ใต้ flag `LINE_SIGNUP_ENABLED` (ปิด = 403 `line_signup_disabled` แบบเดียวกับ `external_signup_disabled`)

| ทาง | เมธอด/เส้นทาง | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| LIFF หน้า signup | `GET /v1/auth/line/signup-page` (+ `/signup-page.js` ผ่าน `LIFF_PAGE_SCRIPT` mode `signup`) | `@Public()` | HTML ฟอร์ม 2 ช่อง (ชื่อร้าน, เบอร์มือถือ — บังคับทั้งคู่) และบล็อกยอมรับที่ฝัง statement/challenge ปัจจุบัน; ใช้ CSP เดิม |
| ส่งคำขอ | `POST /v1/public/line-signups` body `{ idToken, companyName, phoneNumber, referralCode?, legal: { documentVersion, statementSha256, releaseFingerprintSha256, displayChallenge, locale } }` — `phoneNumber` **บังคับ** ตั้งแต่ 2026-09-05 | `@Public()` + rate-limit ip + **per-LINE-user** | ตรวจ ID token → ตรวจ legal ตรง release ปัจจุบัน (ไม่ตรง 409 `legal_release_changed`) → ตรวจเบอร์ (ไม่ผ่าน **400** `line_signup_phone_required` / `line_signup_phone_invalid`) → สร้าง `CompanySignupRequest` source `line-oa` (§5) → ตอบ `{ requestId, state, existingAccount: boolean, businessHours: boolean }` |
| สถานะของฉัน | `GET /v1/public/line-signups/me` (ID token ใน header) | `@Public()` + rate-limit | คำขอล่าสุดของ LINE user นี้ (ใช้โดยหน้า LIFF และการ์ดสถานะ) |
| LIFF หน้า start | `GET /v1/auth/line/start-page` (mode `start`) | `@Public()` | ขอ ID token แล้วเรียก session |
| แลก session | `POST /v1/auth/line/liff/session` body `{ idToken, companyId? }` | `@Public()` + rate-limit ใหม่ `line-liff-session-user` | ตรวจ token → identity ACTIVE → mint handoff → `{ handoffUrl }`; ไม่มี identity → `{ needsSignup: true }` |
| ขอเปลี่ยนแพ็กเกจ | `POST /v1/companies/:companyId/package-change-requests` body `{ requestedTierKey }` | สมาชิก OWNER ของบริษัท (permission เดิมกลุ่ม company_settings) — และจาก LINE ผ่าน webhook action | สร้างคำขอเข้าคิว (§8); idempotent ต่อ (company, tier, open) |
| คิวแอดมิน | เดิม `GET /system/signup-requests` + `decision` | เดิม | DTO เพิ่ม `source`, `lineDisplayName`, `autoApproved`, `legalAcceptedAt` |
| ระงับ | เดิม decision `SUSPEND` (ถ้ายังไม่มี ให้เพิ่มใน `decide`) | `system.company_onboarding.create` | ใช้กับแถว auto-approve |
| Timeline ต่อร้าน | `GET /system/partners/:companyId/timeline` | `system.company_onboarding.read` | เหตุการณ์สำคัญของร้าน (§8) |
| ส่งข้อความถึงร้าน | `POST /system/partners/:companyId/line-message` body `{ text }` | `system.company_onboarding.create` | push ข้อความจากแอดมินถึง OWNER ที่ผูก LINE (ใช้แทนการตอบมือใน OA ที่ยังปิด Chat — §8); audit ทุกครั้ง |

ตัวตรวจ ID token = ตัวเดียวกับ `complete-employee-line-link` (audience = `LINE_LIFF_ID`/Login channel เดิม, AUTH-02); ห้ามเชื่อค่าใดๆ จาก client นอกจาก token และค่า legal ที่ถูกตรวจกับ release ปัจจุบันเท่านั้น

Contract types ใน `packages/contracts` (FROZEN สำหรับ Flow B — เพิ่มได้แบบ additive เท่านั้น): `LineSignupSubmitDto`, `LineSignupStatusDto`, `PackageChangeRequestDto`, ขยาย `AdminSignupQueueItemDto` ด้วย field optional ข้างต้น; `plan-term.ts`: เพิ่ม `'FREE_TRIAL_15'` ใน `PlanTierKey` + `PLAN_TIER_PRESETS.FREE_TRIAL_15 = { labelTh: 'ทดลองใช้ฟรี', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15 }`

## 5. Durable state

ใช้ตาราง+enum เดิม เพิ่มคอลัมน์บน `CompanySignupRequest` (migration additive):

- `source` ค่าใหม่ `'line-oa'` (คอลัมน์มีอยู่ default `official-site`)
- `lineProviderUserId String?`, `lineChannelId String?`, `lineDisplayName String?` — **index** `(lineChannelId, lineProviderUserId, state)`; กติกา app-level: **1 LINE user มีคำขอ open (RECEIVED/VALIDATED/PENDING_REVIEW/PROVISIONING) ได้ครั้งละ 1** (ตรวจใน use-case ภายในธุรกรรม); **ไม่มีคอลัมน์รูป** (DATA-MIN-01)
- **หลักฐานยอมรับข้อกำหนด (LEGAL-LIFF-01):** `legalDocumentVersion String?`, `legalStatementSha256 String?`, `legalReleaseFingerprintSha256 String?`, `legalDisplayChallenge String?`, `legalLocale String?`, `legalUserAgent String?`, `legalAcceptedAt DateTime?` — ตั้งค่าครั้งเดียวตอน submit, ห้ามแก้; ใช้เขียน `LegalDocumentActionRecord` ตอน provisioning (§6)
- `contactEmail` เปลี่ยนเป็น **nullable** (Flow B ยังบังคับกรอกที่ validator ชั้นบน; DB ไม่บังคับ) — `mxValid` เป็น null เมื่อไม่มีอีเมล
- `autoApproved Boolean @default(false)`, `approvedByUserId` = null เมื่ออัตโนมัติ (audit actor = `line-signup-auto-approve`)
- `adminReminderSentAt DateTime?` — เตือนคิว 60 นาที exactly-once

ตารางใหม่ `PackageChangeRequest`: `id, companyId, requestedByUserId, requestedTierKey, status (OPEN|APPROVED|REJECTED|CANCELLED), note?, decidedByUserId?, decidedAt?, createdAt` + unique partial (companyId, status=OPEN)

`CompanyPlanTerm` (additive): `warmupUntil DateTime?`, `warmupSlipLimit Int?` — โควตาอุ่นเครื่อง 7 วันแรก (§9)

ลำดับสถานะ source `line-oa` (ใช้ค่าจาก enum เดิม ไม่เพิ่มค่า):

```text
RECEIVED
  → VALIDATED         (schema + legal ตรง release + rate limit + dedupe "LINE นี้มีบัญชี/คำขอค้างไหม" — ไม่มี MX ไม่มีอีเมล)
  → PENDING_REVIEW    (MANUAL: เข้าคิว + แจ้งแอดมิน; ค้าง 60 นาทีในเวลาทำการ → เตือนซ้ำ)
  → PROVISIONING      (แอดมินอนุมัติ หรือ AUTO_FREE ข้ามคิว: VALIDATED → PROVISIONING ทันที)
  → READY → COMPLETED (ExternalIdentity + LegalDocumentActionRecord + plan term FREE_TRIAL_15/30 วัน ในธุรกรรม provisioning → ข้าม LINE_LINK_PENDING; push "พร้อมใช้")

ข้างเคียง: REJECTED (จาก PENDING_REVIEW; push แจ้งเป็นค่าเริ่มต้น)
          / PROVISIONING_FAILED (ปล่อย fence, retry idempotent) / SUSPENDED (หลัง auto-approve)
ไม่ใช้กับ source นี้: EMAIL_PENDING, EMAIL_VERIFIED, EMAIL_FAILED, EXPIRED, LINE_LINK_PENDING
หลัง COMPLETED: วงจร P29 เดิม (เตือน 7/3/1 → หมดอายุ → DISABLED) ทำงานกับร้านนี้เหมือนร้านอื่น
```

`TRANSITIONS` ใน `company-signup.logic.ts` ต้องแยกตาม source (Flow B ห้ามข้าม EMAIL_*; line-oa ห้ามเข้า EMAIL_*) — ทดสอบทั้งสองตาราง

`attachUserId`: ตั้งค่า**ตอน submit** เมื่อ ID token map ไป `ExternalIdentity` ACTIVE ของ User ที่ ACTIVE อยู่แล้ว (หลักฐานแรงกว่า mailbox) → provisioning เดิน `attachedExistingOwner` (เพิ่มร้านที่ 2 ให้ User เดิม) และการ์ดตอบ "เพิ่มร้านที่ 2 ให้บัญชีของคุณ" ไม่ใช่ "สร้างบัญชีใหม่"; หลักฐาน legal ของ submit นี้ยังถูกบันทึกให้ User เดิมถ้า release ปัจจุบันยังไม่มี record

## 6. Provisioning delta (ใน `CreateCompanyOnboardingUseCase` เดิม)

เพิ่ม input แบบ additive `ownerAuth: { kind: 'password' } | { kind: 'line', providerUserId, channelId, displayName }` (ค่าเดิม = password) และ `legalAcceptance?: { …ค่าจาก §5 }`:

- `kind: 'line'` → สร้าง `User` โดย `username = null`, `email = null`, `displayName` จาก LINE, **ไม่สร้าง `UserCredential`** (ไม่มี temporary password — LINE-ONBOARD-01), สร้าง `ExternalIdentity` ACTIVE ในธุรกรรมเดียวกัน (ชน unique → คือเคส attach ที่ควรถูกจับตั้งแต่ §5 → ถือเป็นบั๊ก ต้อง fail ธุรกรรมและปล่อย fence)
- `legalAcceptance` มา → เขียน `LegalDocumentActionRecord` ในธุรกรรมเดียวกัน: `surface='liff'`, `authProvider='LINE'`, `acceptedByUserId` = User ใหม่/เดิม, `companyId`+`membershipId` ของร้านใหม่, `actorCapacity` = owner, `rolesJson` = [OWNER], `sessionTokenId = null` (ไม่มี session), `requestId` = ของ provisioning, `acceptedAt` = `legalAcceptedAt` จากคำขอ (**ไม่ใช่เวลา provisioning**), `displayChallenge/statementSha256/releaseFingerprintSha256/documentVersion/locale/userAgent` จากหลักฐาน; unique `(scopeRef, documentType, documentVersion, action)` ทำให้ retry ไม่ซ้ำ — ถ้า record มีอยู่แล้ว (User เดิม) ให้ข้าม
- `attachUserId` มา → ไม่สร้าง User/ExternalIdentity ใหม่ (พฤติกรรม `attachedExistingOwner` เดิม)
- `modulePackage: 'starter'` เดิม (เมนูเริ่มต้น); **plan term = `applyPlanTermPreset(companyId, 'FREE_TRIAL_15', 30, …)`** (Owner ข้อ 1: 15 ใบ, 30 วัน; branch 1, employee 2) — Flow B ยังใช้ `PRO_999`/30 วันของมันเอง; ladder P29 7/3/1 ทำงานอัตโนมัติ; **โควตาอุ่นเครื่อง 7 วันแรก** = `warmupUntil = now+7d`, `warmupSlipLimit = LINE_SIGNUP_WARMUP_SLIPS` (§9) — ตัวนับสลิปเดิมต้องเช็ค `min(monthlySlipLimit, warmupSlipLimit ถ้ายังไม่พ้น warmupUntil)`
- **งบ AI ต่อร้านฟรี:** ตั้ง `CompanyAiConfiguration.monthlyBudgetSatang` = `LINE_FREE_AI_BUDGET_SATANG` (§10) ตอน provisioning — ค่า = (ต้นทุนจริงต่อใบจากมิเตอร์ × 15) + เผื่อคุยกับ AI (จำนวน turn × ต้นทุนต่อ turn) ปัดขึ้น; **ตัวเลขจริงเติมหลังดึงจาก `AiUsageEvent` บน prod** (§11)
- `CompanyOnboardingRun` ยังถูกสร้าง (ตาม use-case เดิม) เพื่อให้ปุ่ม Reissue owner LINE QR ในหน้า system ใช้ได้กับร้านจาก LINE ด้วย (เส้นกู้บัญชี §9)
- ผลลัพธ์ `temporaryPassword` ต้องเป็น `undefined` สำหรับ `kind:'line'` และ**ห้าม**หลุดไปใน response/log/push
- Password login กับ User ที่ไม่มี credential = ตอบเหมือน "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" (ไม่บอกว่าไม่มีรหัส); `mustChangePassword` gate ไม่เกี่ยว (ไม่มี credential)

## 7. ข้อความ LINE (copy — Owner แก้ได้) + ช่องทางส่ง

| จังหวะ | ข้อความ | ปุ่ม | ช่องทาง |
|---|---|---|---|
| ประตู (unlinked / follow) | "สวัสดีค่ะ ยินดีต้อนรับสู่มั่งมีพลัส เลือกทางที่ตรงกับคุณได้เลยค่ะ" | เปิดร้านใหม่ ทดลองฟรี / ฉันเป็นพนักงาน / มีบัญชีอยู่แล้ว | reply |
| สถานะระหว่างรอ (ในเวลาทำการ) | "ได้รับคำขอเปิดร้าน **<ชื่อร้าน>** แล้วค่ะ ทีมงานกำลังตรวจสอบ ปกติดำเนินการให้ภายในวันทำการ (จันทร์–เสาร์ 9:00–18:00) พร้อมเมื่อไหร่จะแจ้งในแชทนี้นะคะ" | — | reply |
| สถานะระหว่างรอ (นอกเวลาทำการ) | "ได้รับคำขอเปิดร้าน **<ชื่อร้าน>** แล้วค่ะ ตอนนี้อยู่นอกเวลาทำการ ทีมงานจะดูให้ในวันทำการถัดไป (จันทร์–เสาร์ 9:00–18:00) นะคะ" | — | reply |
| เปิดร้านแล้ว (**แก้ 2026-09-28 R-C4**) | "🎉 เปิดร้าน **<ชื่อร้าน>** ให้แล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจเพื่อเริ่มใช้งาน กดปุ่มด้านล่าง แล้วกดเปิดหน้าเว็บเพื่อดูแพ็กเกจและชำระเงินได้เลยนะคะ" (ไม่มี "ทดลองฟรี" อีกแล้ว — R1/R-C7) | เลือกแพ็กเกจ (LIFF start) | **push** (1 ครั้ง) |
| เพิ่มร้านที่ 2 (**แก้ 2026-09-28 R-C4**) | "🎉 เพิ่มร้าน **<ชื่อร้าน>** ให้บัญชีของคุณแล้วค่ะ ขั้นต่อไปเลือกแพ็กเกจให้ร้านนี้ กดปุ่มด้านล่างได้เลยนะคะ สลับร้านได้ในเมนู บริษัทของฉัน" | เลือกแพ็กเกจ | push (1 ครั้ง) |
| **ปฏิเสธ (Owner ข้อ 3)** | "เรียน คุณ<ชื่อ LINE> ขอบคุณที่สนใจมั่งมีพลัสค่ะ ตอนนี้เรายังไม่สามารถเปิดร้าน **<ชื่อร้าน>** ให้ได้ ต้องขออภัยด้วยนะคะ หากต้องการสอบถามหรือส่งข้อมูลเพิ่มเติม ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com (จันทร์–เสาร์ 9:00–18:00) ทีมงานยินดีพิจารณาให้อีกครั้งค่ะ" | — | push (1 ครั้ง) |
| กันหลุด วันที่ 7 | "ใช้มาครบสัปดาห์แล้ว 👍 ใส่อีเมลหรือเบอร์ไว้หน่อยไหมคะ เผื่อเปลี่ยนมือถือแล้ว LINE หลุด จะได้กู้ร้านคืนได้" | ใส่เลย / ไว้ก่อน | push (1 ครั้ง exactly-once) |
| ชนโควตา 15 ใบ | "ช่วงทดลองอ่านใบเสร็จให้ได้ 15 ใบ ตอนนี้ครบแล้วค่ะ ดูแพ็กเกจที่ใหญ่ขึ้นได้เลย" | ดูแพ็กเกจ / ขอเปลี่ยนแพ็กเกจ | reply ต่อใบเสร็จที่ชน (ไม่ push ซ้ำ) |
| เตือนหมดอายุ 7/3/1 วัน + หมดอายุ | billing `test`/`live`: ชวนต่ออายุหรือเปลี่ยนแพ็กเกจในเว็บแอปด้วยตัวเอง; `disabled`: ให้ติดต่อทีมงาน | จัดการแพ็กเกจ (เปิดหน้าเว็บเมื่อ billing เปิด) | push (P29 เดิม) |
| ติดต่อเจ้าหน้าที่ | ผู้ใช้พิมพ์ "ติดต่อเจ้าหน้าที่" → "รับเรื่องแล้วค่ะ ทีมงานจะตอบในแชทนี้ในเวลาทำการ (จันทร์–เสาร์ 9:00–18:00)" + แจ้งแอดมินทาง LINE พร้อมลิงก์หน้า partner | — | reply + push หาแอดมิน |
| โปรโมชั่น (pull) | ปุ่ม Promotion ใน rich menu / พิมพ์ "โปรโมชั่น" → การ์ดโปรโมชั่นเดิม | ขอเปลี่ยนแพ็กเกจ | reply |

**แก้คำสั่งเปลี่ยนแพ็กเกจ (2026-09-23):** ข้อความที่เจ้าของร้านพิมพ์ทั้ง `ขอเปลี่ยนแพ็กเกจ` และ `ขอเปลี่ยนแพ็คเกจ` ต้องเข้าเส้นทางเดียวกัน โดยตรวจสิทธิ์ OWNER และร้านที่เลือกตามเดิม ในโหมด billing `test`/`live` คำสั่งตอบลิงก์ให้ตรวจและเลือกแพ็กเกจบนเว็บ ส่วนโหมด `disabled` เปิดคำขอให้ทีมงานติดต่อกลับ ข้อความเตือนอายุแพ็กเกจชวนลูกค้าไปทำรายการในเว็บแอปโดยตรงเมื่อเปิด billing; คำสั่งใน LINE ยังใช้ได้หากลูกค้าพิมพ์เอง

**งบข้อความต่อลูกค้า 1 คนตลอด 30 วัน:** พร้อมใช้ 1 + กันหลุด 1 + P29 7/3/1 = 3 + หมดอายุ 1 ≈ **6 push** (+ปฏิเสธ 1 เฉพาะราย) → โควตาฟรี OA ~500/เดือน รองรับ ≈ **80 คนสมัคร/เดือน**; เกินนั้นอัปแผน OA (~฿1,500/เดือน); **ห้ามเพิ่ม push ใหม่โดยไม่ผ่านการนับในตารางนี้**

## 8. คิวแอดมินและเครื่องมือ support (delta)

- แถวจาก LINE: ป้าย "LINE" + ชื่อ LINE + ชื่อร้าน + ref + เวลายอมรับข้อกำหนด + hint "LINE นี้มีบัญชีอยู่แล้ว → จะเพิ่มเป็นร้านที่ 2" (ไม่มีรูป)
- ไม่มีข้อมูล MX/อีเมล (ช่องว่าง "—" ตามกติกา 2026-09-01); **เบอร์มือถือมีเสมอสำหรับคำขอที่ยื่นตั้งแต่ 2026-09-05** (แถวเก่ากว่านั้นอาจว่าง) พร้อมปุ่มโทร (tel:) บนมือถือ
- ปุ่ม Approve/Reject เดิม; Reject มี toggle "แจ้งทางไลน์" **เปิดเป็นค่าเริ่มต้น** (ข้อความ §7)
- โหมด AUTO_FREE: แท็บ/ตัวกรอง "อนุมัติอัตโนมัติ (N รายวันนี้)" + ปุ่ม **ระงับ** ต่อแถว; SLA เตือน 24 ชม. ของ PENDING_REVIEW ใช้เดิม + เตือน 60 นาทีในเวลาทำการ (§3.3)
- **แท็บ "คำขอเปลี่ยนแพ็กเกจ"** ในคิวเดียวกัน: ร้าน / แพ็กเกจที่ขอ / ผู้ขอ / เวลา → ปุ่ม "เปิดหน้า partner" (เปลี่ยนแพ็กเกจที่นั่นตามเดิม) + ปิดคำขอ
- **Timeline ต่อร้าน** ในหน้า partner: สมัคร (source) → อนุมัติ (ใคร/auto) → ยอมรับข้อกำหนด → เข้าเว็บครั้งแรก → ใบเสร็จแรก → ใช้ล่าสุด → เหตุที่ AI ไม่ตอบล่าสุด (ระงับ/โควตา/งบ AI/หมดอายุ/ยังไม่ผูก) → คำขอเปลี่ยนแพ็กเกจ — อ่านจาก audit/event เดิม ไม่สร้าง log ใหม่
- `/system/users`: ค้นด้วย**ชื่อ LINE** และแสดง LINE-only user (ไม่มี username/email — โชว์ displayName + ป้าย LINE)
- **"ติดต่อเจ้าหน้าที่" กับ OA ที่เป็น webhook อย่างเดียว (Owner ข้อ 8):** AI หยุดตอบใน thread นั้น 24 ชม. + แจ้งแอดมิน; แอดมินตอบผ่าน **กล่อง "ส่งข้อความถึงร้าน" ในหน้า partner** (endpoint §4, push 1 ครั้ง/ข้อความ, audit) — **ทางเลือกอนาคตไม่ต้องเขียนโค้ด:** ถ้า Owner เปิด Chat ใน OA Manager (เปิดคู่ Webhooks ได้) จะพิมพ์ตอบจากแอป LINE OA ได้โดยตรง แต่จะเห็นทุกบทสนทนาที่บอทตอบด้วย (รก) — ตัดสินใจภายหลัง
- **Support playbook** (เอกสารสั้นใน docs/runbooks): 4 ticket ที่คาดไว้ (กดแล้วไม่เข้า / เปลี่ยนมือถือ / ส่งใบเสร็จแล้วไม่ตอบ / สมัครแล้วเงียบ) พร้อมสาเหตุที่พบบ่อยและปุ่มที่ต้องกด

**§8 delta (2026-09-05) — "ติดต่อเจ้าหน้าที่" ต้องถึงคนจริง:** ข้อ "ติดต่อเจ้าหน้าที่ กับ OA ที่เป็น webhook
อย่างเดียว" ข้างบนถูกแทนที่ด้วย [`line-support-request-spec-th.md`](./line-support-request-spec-th.md)
หลังพบใน UAT 2026-09-05 ว่าคำว่า "รับเรื่องแล้วค่ะ" ไม่เป็นจริง: แจ้งเฉพาะ SYSTEM_ADMIN ที่ผูก LINE
(ซึ่งไม่มีเลย) แถว outbox ยังจบเป็น PUBLISHED เงียบ ๆ และชื่อร้านมาจาก `LineCompanyContext` ที่ค้างอยู่
หลัง unlink สรุปสิ่งที่เปลี่ยน:

- ตาราง `LineSupportRequest` (สถานะ OPEN/ANSWERED/CLOSED) = หลักฐานว่ามีคนรออยู่จริง
- ร้านถูก re-derive จาก identity ACTIVE ทุกครั้งที่กด ไม่อ่านจาก `LineCompanyContext` อีก;
  unlink ทั้งสองทางลบแถว context ทิ้ง (§2.5)
- **หน้า `/system/support-requests` คือช่องทางหลัก** (Owner 2026-09-05: ทีมงานไม่ได้ผูก LINE)
  พร้อม badge จำนวน OPEN บนเมนู; อีเมลไปกล่อง support และ LINE push เป็นของแถม
- ไม่มีช่องทางไหนส่งสำเร็จ → `signup.support.unreachable` (HIGH) + ops alert `support_unreachable`
- ลูกค้าปลด pause เองได้ด้วยปุ่ม/คำว่า "คุยกับน้องมั่งมี" (alias พิมพ์ได้: "คุยกับ AI ต่อ" / "ให้ AI ตอบ" / "คุยกับ AI" / "คุยกับมั่งมี"); sweep เดิมปิดคำขอที่ pause หมดอายุแล้วเป็น `expired`
- **งบ push ใน §7 ไม่เปลี่ยน**: การแจ้งเตือนทั้งหมดนี้วิ่งหาแอดมิน ไม่ใช่หาลูกค้า

## 9. ความปลอดภัย / PDPA / การปั่น / การกู้บัญชี

- **ตัวตน:** เชื่อเฉพาะ ID token ที่ตรวจลายเซ็นและ audience ฝั่งเซิร์ฟเวอร์; `providerChannelId` ต้องเท่ากับ channel ของเรา; token หมดอายุ → 401 ให้ LIFF ขอใหม่; token เดียวกันใช้ซ้ำภายในอายุได้แต่ทำอะไรเกินสิทธิ์ของเจ้าของไม่ได้ (คำขอค้าง 1/คน, session = ของตัวเอง)
- **Rate limit ใหม่:** `line-signup-user` 3/วัน ต่อ LINE userId, `line-signup-ip` 20/ชม., `line-liff-session-user` 30/ชม.; อ่านสถานะ 60/ชม.
- **1 LINE = 1 คำขอค้าง** (§5) และ `ExternalIdentity` unique = 1 LINE = 1 บัญชี; ร้านที่ 2+ ผ่าน attach เท่านั้น
- **กันปั่นเพื่อเผางบ AI:** (1) โควตาอุ่นเครื่อง 7 วันแรก `LINE_SIGNUP_WARMUP_SLIPS` (ค่าเริ่มต้น 10 ใบ จาก 15) จนกว่าแอดมินกด "ตรวจแล้ว" หรือครบ 7 วัน; (2) งบ AI ต่อร้านฟรี `LINE_FREE_AI_BUDGET_SATANG` ตั้งตอน provisioning; (3) เพดานอนุมัติอัตโนมัติต่อวัน `LINE_SIGNUP_AUTO_DAILY_CAP` (ค่าเริ่มต้น 20; เกิน → ตกเป็น MANUAL อัตโนมัติ + แจ้งแอดมิน); (4) ระงับได้ทันทีจากคิว; (5) ทุกอย่าง audit (`signup.line.submitted / auto_approved / suspended / package_change_requested / admin_message_sent`)
- **กู้บัญชีเมื่อ LINE หาย (ไม่มีอีเมล/รหัสผ่าน):** ขั้นตอนแอดมิน — ① ผู้ติดต่อบอกชื่อร้าน + ข้อมูลที่รู้เฉพาะเจ้าของ (ยอด/รายการล่าสุด 2 รายการ, เบอร์/อีเมลกันหลุดถ้าเคยใส่) ② แอดมินตรวจกับ timeline ③ Unlink LINE เดิม (ปุ่มมีอยู่) ④ Reissue owner LINE QR (ปุ่มมีอยู่ ใช้ `CompanyOnboardingRun`) ส่งให้สแกนด้วย LINE ใหม่ ⑤ audit `system.account_recovery.line_relink` riskLevel CRITICAL; ห้ามทำถ้าตรวจข้อ ① ไม่ผ่าน — เขียนเป็น runbook คู่กับ playbook §8
- **PDPA:** การยอมรับที่มีผลผูกพันเกิดบน LIFF (LEGAL-LIFF-01) ด้วยหลักฐานชุดเดียวกับในแอปและถูกบันทึกเป็น `LegalDocumentActionRecord` ตอน provisioning (`surface='liff'`); เก็บเฉพาะชื่อ LINE + ข้อมูลที่กรอก ไม่เก็บรูป (DATA-MIN-01 — privacy notice เดิมครอบคลุม ไม่ต้องแก้); **ไม่มี consent การตลาด**เพราะไม่มีการส่งเชิงรุก (MSG-01) — ถ้าวันหน้าจะ broadcast ต้องเพิ่ม consent แยกก่อน (Phase 2)
- **ไม่มีข้อมูลส่วนตัวใน URL** (ไม่มี token/ชื่อใน query) ยกเว้น `ref` code สาธารณะ
- LIFF page ใช้ CSP เดิม (`LIFF_PAGE_CSP`) ห้าม inline script นอก `LIFF_PAGE_SCRIPT`; OA ของเราเป็น Verified Account แล้ว — ใส่โล่ในการ์ดประตูเพื่อกัน OA ปลอม

## 10. Config & rollout

| ตัวแปร | ค่า UAT | ค่า production (จนกว่า Owner สั่ง) |
|---|---|---|
| `LINE_SIGNUP_ENABLED` | `true` | `false` — `true` บน prod = deploy.sh exit 2 แบบเดียวกับ `EXTERNAL_SIGNUP_ENABLED` |
| `LINE_SIGNUP_APPROVAL_MODE` | `MANUAL` (ทดสอบทั้งสองโหมด) | `MANUAL` 2 สัปดาห์แรก → `AUTO_FREE` เมื่อ Slice L-D พร้อม (Owner ข้อ 2) |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | `20` | `20` |
| `LINE_SIGNUP_WARMUP_SLIPS` | `10` | `10` |
| `LINE_FREE_AI_BUDGET_SATANG` | **8000 (80 บาท/เดือน) — Owner เคาะ 2026-09-04 จากมิเตอร์ prod (§11)** | เท่ากัน |
| `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` | `60` | `60` |
| `LINE_SIGNUP_BUSINESS_DAYS` / `_HOURS` | `MON-SAT` / `09:00-18:00` (Asia/Bangkok) | เท่ากัน (Owner ข้อ 7) |
| `LINE_LIFF_ID` เดิม | มี | มี |

deploy.sh เป็นไฟล์ pinned → แก้แล้วต้อง `node infra/security/sync-production-maintenance-release-pins.mjs`; rich menu v2 ตั้งปุ่ม "เปิดร้านใหม่ ทดลองฟรี" ผ่าน console ตาม runbook เดิม (ไม่มีโค้ด); OA คง Webhooks เปิด / Chat ปิด ตามปัจจุบัน

ลำดับส่งมอบ (แต่ละ slice = PR เดียว, verify ก่อนต่อ) — รายละเอียดใน implementation plan ([mangmee-line-first-signup-plan-th.md](../plans/mangmee-line-first-signup-plan-th.md)):
- **Slice L-A (backend core):** migration (§5) + tier `FREE_TRIAL_15` + submit/status use-cases + ID-token verify reuse + legal evidence ตรวจกับ release + TRANSITIONS แยก source + provisioning `ownerAuth`/`legalAcceptance` + warm-up + งบ AI + business-hours helper + tests
- **Slice L-B (LIFF + handoff + ข้อความ):** LIFF modes `signup`/`start` + `/v1/auth/line/liff/session` + การ์ด 3 ประตู (message + follow)/สถานะ/ชนโควตา/ติดต่อเจ้าหน้าที่ใน webhook + push ตามตาราง §7 + กันหลุดวันที่ 7 (worker sweep) + ปุ่มขอเปลี่ยนแพ็กเกจในข้อความ P29
- **Slice L-C (admin + support + flags):** คิว delta + AUTO_FREE + suspend + เตือน 60 นาที + คำขอเปลี่ยนแพ็กเกจ + timeline + ค้นชื่อ LINE + กล่องส่งข้อความถึงร้าน + playbook/recovery runbook + deploy.sh wiring + pins + UAT deploy
- **Slice L-D (หน้าปัด):** หน้าสรุป funnel + ต้นทุน AI ต่อร้าน (§11) — **ต้องเสร็จก่อนเปิด AUTO_FREE บน production**
- **Phase 2 (แยก spec เล็ก):** rich menu ต่อผู้ใช้ตามสถานะ, อีเมลต้อนรับเมื่อผู้ให้บริการเมลพร้อม, consent การตลาด (เฉพาะถ้าจะ broadcast), ระบบจ่ายเงินอัตโนมัติ (P26), เปิด Chat ใน OA เพื่อตอบมือ

## 11. Gates / tests (ต้องมีหลักฐานจริงก่อนปิดงาน)

Unit/integration (api):
- TRANSITIONS: line-oa ห้ามเข้า EMAIL_*; official-site ห้ามข้าม EMAIL_* (ตารางทั้งสอง)
- submit: token ปลอม/หมดอายุ/คนละ channel → 401; legal ไม่ตรง release → 409; LINE เดิมมีคำขอค้าง → 409; LINE เดิมมีบัญชี → `attachUserId` ตั้ง + `existingAccount:true`; หลักฐาน legal ถูกเก็บครบทุก field และ `legalAcceptedAt` = เวลาเซิร์ฟเวอร์; `businessHours` ถูกต้องตามเวลาไทย (ขอบ 9:00/18:00, อาทิตย์)
- provisioning idempotent: approve ซ้ำ/retry หลัง fail → บริษัทเดียว, ExternalIdentity เดียว, **LegalDocumentActionRecord เดียว (surface liff, acceptedAt = ของคำขอ)**, plan term `FREE_TRIAL_15` 30 วัน เดียว, ไม่มี UserCredential, `temporaryPassword` undefined, งบ AI/warm-up ถูกตั้ง
- legal gate: User ใหม่จาก LINE **ไม่ถูก** guard พาไป legal-acceptance และ LINE AI ตอบทันที; เมื่อ release ใหม่กว่า → ถูกพาไปตามเดิม
- AUTO_FREE: VALIDATED → PROVISIONING โดยไม่มีแถวคิว; เกิน daily cap → PENDING_REVIEW + แจ้ง; warm-up: ใบที่ 11 ใน 7 วันแรก → ตอบชนโควตาอุ่นเครื่อง; ใบที่ 16 → ตอบชนโควตา 15 + ปุ่มขอเปลี่ยนแพ็กเกจ
- P29 กับร้าน LINE: เตือน 7/3/1 ออกทาง LINE ของ OWNER; หมดอายุ → DISABLED + ข้อความหมดอายุมีปุ่มขอเปลี่ยนแพ็กเกจ
- webhook: unlinked (message และ follow) → การ์ด 3 ประตู (reply); มีคำขอค้าง → การ์ดสถานะ (ข้อความในเวลา/นอกเวลาทำการถูกต้อง); หลังอนุมัติ → ตอบปกติ; ชนโควตา → การ์ดครั้งเดียว ไม่ซ้ำวันถัดไป; "ติดต่อเจ้าหน้าที่" → AI หยุด + แจ้งแอดมิน; "โปรโมชั่น" → การ์ด pull
- liff/session: identity ACTIVE → handoffUrl ใน `/l/`; ไม่มี identity → needsSignup; rate limit
- reminders: เตือนแอดมิน 60 นาที exactly-once และเริ่มนับตามเวลาทำการ; กันหลุดวันที่ 7 exactly-once และไม่ส่งถ้ามีอีเมล/เบอร์แล้ว
- package change: idempotent ต่อ (company, tier, open); แถวโผล่ในคิว; ส่งข้อความถึงร้าน → push + audit
- push budget: ทดสอบนับว่า flow ปกติ 1 รายใช้ push ≤ 2 ใน 7 วันแรก และ ≤ 6 ตลอด 30 วัน

Web/E2E: คิวแสดงแถว LINE + suspend + แท็บคำขอเปลี่ยนแพ็กเกจ; timeline ต่อร้าน; `/system/users` ค้นชื่อ LINE; กล่องส่งข้อความถึงร้าน; `/l/<token>` จาก session endpoint ลงหน้าเป้าหมาย (mock LIFF ด้วยการยิง endpoint ตรง — LIFF จริงทดสอบใน UAT ด้วยมือ)

UAT (มือ, มือถือจริง): add OA → การ์ด (follow) → สมัคร 2 ช่อง และยอมรับ → (MANUAL) อนุมัติ → push พร้อมใช้ → **ส่งใบเสร็จทาง LINE ได้ทันทีโดยไม่เจอการ์ดยอมรับ** → แตะเริ่มใช้งาน → หน้าใบเสร็จแรก (ไม่ผ่าน legal page); ซ้ำด้วย AUTO_FREE; เคสพนักงาน; เคสมีบัญชีแล้ว (ร้านที่ 2); เคสปฏิเสธ (ข้อความสุภาพ มีเบอร์+อีเมล); ชนโควตา 15 → ขอเปลี่ยนแพ็กเกจ → โผล่ในคิว; เร่งเวลาให้หมดอายุ → ข้อความ P29 + ปุ่ม; กู้บัญชีด้วย Unlink + Reissue QR; ติดต่อเจ้าหน้าที่ → แอดมินตอบจากหน้า partner

**ต้นทุนจริงจากมิเตอร์ prod (ดึง 2026-09-04, 60 วันล่าสุด, ok=true, หน่วยสตางค์):**
- อ่านใบเสร็จ (`receipt-ocr`, 145 ครั้ง): avg 105 / p50 101 / **p90 197** / max 359 — บน prod มีแต่ route `receipt-ocr` (ยังไม่มี `receipt-ocr-line/web`)
- ทางเข้า LINE (`line-intake-route`, 145 events): รวม 15,648 ≈ **108/ครั้ง** — ใบเสร็จที่ส่งทาง LINE จ่าย 2 ต่อ (intake + ocr) ≈ **213/ใบ (avg), ≈305/ใบ (p90)**
- แชท (`line-turn`, 73 turn): avg 74 / **p50 78** / p90 131 / max 154; turn ต่อร้านต่อเดือน: ส.ค. 17, ก.ย. 2
- ต่อร้านต่อเดือน (ทุก route): ส.ค. 22 ร้าน avg **1,276** (≈13 บาท) max **7,546** (≈75 บาท); ก.ย. (ถึง 4 ก.ย.) 11 ร้าน avg 747 max 1,873
- สูตร `ceil((p90_receipt_via_line 305 × 15 + p50_turn 78 × 30) × 1.2)` = ceil((4,575 + 2,340) × 1.2) = **8,298 → เสนอปัดเป็น 8,000 สตางค์ (80 บาท/เดือน)**; ร้านทดลองปกติจะใช้จริง ~15–25 บาท, ร้านหนักสุดที่เคยเห็น 75 บาท — งบนี้คือ*เพดานหยุด* ไม่ใช่ค่าใช้จ่ายคาดหมาย
- หมายเหตุเชิงต้นทุน (ไม่ทำรอบนี้): intake route แพงเท่า OCR เอง → เป็นจุด optimize ในอนาคต

**หน้าปัดก่อน AUTO_FREE (Slice L-D):** funnel `card_shown → liff_opened → submitted → approved(auto|manual) → first_receipt → active_week2 → package_change_requested` + ต้นทุน AI ต่อร้าน (จาก `AiUsageEvent`) — ไม่มีหน้าปัด = ไม่เปิด AUTO_FREE บน production

## 12. สิ่งที่ไม่ทำในรอบนี้

Paid tier / ชำระเงินอัตโนมัติ (P10 §4E/P26 — ช่วงแรกทำมือในแชท); rich menu ต่อผู้ใช้; OCR ระหว่างรอ (ไม่จำเป็นเมื่อมี AUTO_FREE); อีเมลต้อนรับ (จนกว่าผู้ให้บริการเมลพร้อม — ทางสำรอง Resend จดไว้แล้ว); พนักงานสมัครเองเข้าร้านที่มีอยู่ (ยังใช้ employee link ที่เจ้าของออก); เปลี่ยนแปลง Flow B เว็บฟอร์มเดิม (คงอยู่คู่กัน — ประตูที่สอง ลดการพึ่ง LINE เจ้าเดียว); **broadcast/consent การตลาด** (ไม่จำเป็นโดยการออกแบบ); OTP เบอร์โทรเป็นทาง login; ประเภทธุรกิจในฟอร์ม; รูปโปรไฟล์ LINE; เปิด Chat ใน OA

## 13. คำถาม Owner — สถานะ

| ข้อ | คำตอบ (2026-09-04) |
|---|---|
| 1 Free tier | **15 ใบ + หมดอายุ 30 วัน** → tier `FREE_TRIAL_15` บนเครื่อง P29 |
| 2 โหมดวันแรก | MANUAL 2 สัปดาห์ → AUTO_FREE เมื่อหน้าปัด L-D พร้อม |
| 3 ปฏิเสธ | แจ้ง; ถ้อยคำสุภาพ; เบอร์ + อีเมล (copy §7 — Owner ตรวจถ้อยคำอีกครั้งได้) |
| 4 ประเภทธุรกิจ | ไม่ใส่ |
| 5 ข้อมูล LINE | ชื่อ LINE + ชื่อร้าน + เบอร์มือถือ (ช่องที่ 2 — **บังคับกรอก** ตั้งแต่ Owner 2026-09-05; เดิม "ไม่บังคับ" 2026-09-04); ไม่เก็บรูป; privacy notice เดิมพอ |
| 6 งบ AI | มิเตอร์ prod: ใบเสร็จทาง LINE ≈2.1 บาท/ใบ (p90 ≈3.1), แชท ≈0.8 บาท/turn → **80 บาท/เดือน (8,000 สตางค์) — เคาะแล้ว** (§11) |
| 7 SLA | "ภายในวันทำการ" จันทร์–เสาร์ 9:00–18:00 |
| 8 OA | webhook อย่างเดียว (Chat ปิด) → ตอบมือผ่านกล่องในหน้า partner |

**คงค้าง 1 อย่าง:** ตัวเลข `LINE_FREE_AI_BUDGET_SATANG` หลังดึงมิเตอร์ (การเปิดอุโมงค์เข้า prod DB จะทำให้ Owner ได้เมลแจ้งเตือน bastion 1 ฉบับ — ทำเมื่อ Owner สั่ง)

## 14. เหตุผลเชิง UX/BA/ต้นทุน (หลักฐาน)

- LINE OA: ข้อความเปิดอ่าน 60–80% vs อีเมล 15–20%; 85% ของผู้บริโภคไทยคุยกับแบรนด์ทาง LINE OA ก่อนเข้าเว็บ; SME = 90% ของผู้ถือ LINE OA — [Sphere Agency, LINE OA Setup Guide Thailand 2026](https://sphereagency.com/articles/line-oa-setup-guide-thailand), [Bangkok Post](https://www.bangkokpost.com/business/general/2272307/line-oa-signups-surge-as-smes-go-digital)
- ราคาข้อความ OA: แผนฟรี ~500 push/เดือน, แผนเสียเงินเริ่ม ~฿1,500/เดือน, reply ฟรีไม่จำกัด — [LINE Messaging API pricing](https://developers.line.biz/en/docs/messaging-api/pricing/), [LINE OA pricing guide 2026](https://linebot.pro/blog/line-official-account-pricing-guide)
- ฟอร์ม: 3 ช่องแปลงดีสุด (~25%); ทุกช่องเพิ่มลด ~4.1%; หน้าผาช่วง 5→7 ช่อง — [HubSpot](https://blog.hubspot.com/marketing/optimize-conversion-forms), [Form conversion benchmarks 2026](https://www.digitalapplied.com/blog/form-conversion-rate-benchmarks-2026-data-points)
- ป้าย "ไม่บังคับ" ดีกว่าดอกจันบังคับ ~25% (Baymard 2024) — [สรุปโดย Brixon](https://brixongroup.com/en/lead-forms-in-b2b-the-perfect-balancing-act-between-data-depth-and-conversion-rate) — **หลักฐานข้อนี้ถูก Owner override เมื่อ 2026-09-05** (เบอร์เป็นทางกู้ร้านคืนและทางที่แอดมินโทรตามได้ จึงคุ้มกว่าอัตราสมัครที่เสียไป); เก็บไว้เป็นบันทึกว่าแลกอะไรกับอะไร
- Onboarding: one-tap/SSO, ข้ามได้, progressive disclosure, ค่าเริ่มต้นฉลาด — [Appcues](https://www.appcues.com/blog/mobile-onboarding-best-practices)
- บทเรียนภายใน: LINE in-app browser คุกกี้แยกจาก Safari/Chrome (QR fix 2026-09-01) → ทุกลิงก์เข้าเว็บจาก LINE ต้องเปิดภายนอก; พนักงานไม่มีอีเมล → กับดักบัญชีซ้ำ (P10 §4F) → ประตู "ฉันเป็นพนักงาน"; ด่านยอมรับข้อกำหนดปฏิเสธ AI จนกว่าจะยอมรับ (`refusePendingLegalAcceptance`) → ต้องยอมรับตั้งแต่ LIFF ไม่งั้น "ส่งใบเสร็จได้เลย" เป็นคำโกหก

## 15. Deltas จาก Review รอบ 1 (v4 — มีผลเหนือ §1–§13 เมื่อขัดกัน)

อ้างอิง ID จาก [review round 1](../plans/mangmee-line-first-signup-review-round-1-th.md) (หลักฐาน file:line อยู่ที่นั่น)

**15.1 ตัวนับสลิป (G-01) — ของใหม่ที่ขาดไม่ได้**
- **แก้ 2026-09-05 (หลักฐานจาก L-A2):** ระบบเดิม*มี*ตัวนับ OCR รายเดือนอยู่แล้ว — `admitCompanyOcr` (`line-ai/application/company-ocr-governance.ts`: advisory lock, fence ต่อ (companyId, sourceRoute, requestId), `CompanyOcrMonthlyUsage`, release เมื่อ provider ล้ม) เรียกจาก OCR client ทั้งเว็บและ LINE — สิ่งที่ไม่มีคือ*เพดานเชิงพาณิชย์*ของแพ็กเกจ → **ไม่สร้างตัวนับที่สอง**; ซ้อน `planLimit` (helper `receipt-quota.logic.ts`) เข้าไปใน transaction เดิมของ seam นี้ เฉพาะ route ใบเสร็จ (`receipt-ocr-web`/`receipt-ocr-line`, ไม่รวม bank statement); effective = min(`ocrMonthlyLimit`, `planLimit`); เมื่อเพดานแพ็กเกจเป็นตัวบล็อก → variant `plan_exceeded` / code `RECEIPT_QUOTA_EXCEEDED` (variant/code เดิมของเบรกแอดมินคงเดิมทุกตัว); เลข "ใช้ไปแล้ว n" อ่านจาก `usedCount` ของ seam เดียวกัน = เลขเดียวทั้งระบบ (หน้า admin, LINE, เว็บ)
- เพดานมีผล = `min(planTerm.monthlySlipLimit, warmupSlipLimit ถ้า now < warmupUntil)`; เกิน → LINE: reply การ์ด "ช่วงทดลองอ่านให้ได้ 15 ใบ ครบแล้วค่ะ" + ปุ่มดูแพ็กเกจ/ขอเปลี่ยนแพ็กเกจ (ครั้งเดียวต่อเดือน); เว็บ: แบนเนอร์ + ปุ่มอัปโหลดปิด + ลิงก์ขอเปลี่ยนแพ็กเกจ
- **flag แยก `RECEIPT_QUOTA_ENFORCED`** (UAT `true`, production `false` จนกว่า Owner สั่ง) เพราะการบังคับมีผลกับลูกค้าเดิมทุกร้านเป็นครั้งแรก — เปิด prod พร้อมประกาศล่วงหน้า 7 วัน (§4 review ข้อ 1)
- reply หลังอ่านสำเร็จเพิ่ม 1 บรรทัด: "อ่านครั้งที่ n จาก 15 ในช่วงทดลอง" (เฉพาะ tier `FREE_TRIAL_15`)
- **นิยามหน่วย (ตัดสิน 2026-09-05):** เพดานแพ็กเกจนับ**ครั้งที่ AI อ่านรูป** (admission ของ seam) ไม่ใช่เฉพาะใบเสร็จที่จำแนกแล้ว — เพราะตัวคัดแยกภาพทาง LINE ทำงาน*ก่อน*รู้ชนิดรูป และทุกรูปคือต้นทุนจริง (~1 บาท/ครั้ง จากมิเตอร์) ดังนั้น copy ทุกจุดใช้ "ให้ AI อ่านรูปได้ 15 ครั้ง (ใบเสร็จ 1 ใบ = 1 ครั้ง)"; ผลข้างเคียงที่รับรู้ (แก้จากรีวิว L-A2 2026-09-05): รูปที่ระบบรู้ก่อนว่าไม่ใช่ใบเสร็จ (ลายเซ็นที่มีคำบรรยาย, รูปของงานใบเสร็จแทนที่เปิดอยู่) เดินทางของมันเองโดยไม่แตะ AI จึง**ไม่ถูก**ปฏิเสธ — รูปอื่นที่ต้องให้ AI คัดแยกก่อนจึงนับ 1 ครั้ง; เมื่อเพดานแอดมิน (`ocrMonthlyLimit`) เท่ากับเพดานแพ็กเกจ ให้เพดานแอดมินชนะ (โค้ดเดิมไม่แตะ); ข้อความปฏิเสธใช้คำว่า "ช่วงทดลอง" เฉพาะ tier `FREE_TRIAL_15` — tier อื่นใช้ "แพ็กเกจของคุณให้ AI อ่านรูปได้ {limit} ครั้งต่อเดือน"; audit ของโหมดเงา (`plan.receipt_quota.would_block`) เป็น best-effort — อ่านหลักฐาน rollout เป็นจำนวนบริษัทที่แตกต่างกัน ไม่ใช่จำนวนแถว; การต่อ flag ทั้งชุด (`LINE_SIGNUP_*`, `RECEIPT_QUOTA_ENFORCED`) เข้า deploy.sh ทำใน L-A2 (ย้ายมาจาก L-C) เพราะ UAT ต้องพิสูจน์เส้นปฏิเสธได้

**15.2 บั๊กเดิมที่ต้องแก้ก่อน/พร้อมกัน**
- **B-01 (ต้องสงสัย)** `applyPlanTermPreset` upsert `update:{}` + onboarding เขียน `STARTER_249` ก่อน → tier ที่ provision-signup ตั้งใจ (`PRO_999`) และของ LINE (`FREE_TRIAL_15`) อาจไม่ถูกเขียน → pre-flight: integration test พิสูจน์; แก้ด้วย `planTier?/planDays?` ใน `CreateCompanyOnboardingCommand` ให้ onboarding เขียน tier ที่ถูกครั้งเดียว; provision-signup ไม่เรียกซ้ำ
- **G-03** webhook รับ `follow` → การ์ด 3 ประตู; **G-04** postback dispatcher (`action=<name>&…`, intent เท่านั้น, ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ — SEC-04)
- **G-05** reply เฉพาะ `AI_MONTHLY_BUDGET_EXCEEDED`: "โควตา AI ช่วงทดลองเดือนนี้ครบแล้วค่ะ" + ปุ่มขอเปลี่ยนแพ็กเกจ (แก้ให้ทุกร้าน ไม่ใช่แค่ LINE)
- **G-06** provisioning source line-oa ตั้ง `CompanyAiConfiguration.monthlyBudgetSatang = LINE_FREE_AI_BUDGET_SATANG` (8000)
- **B-05** `externalSignupId` ที่ server mint (`line:<channel>:<userId>:<uuid>`) + **partial unique index** `(lineChannelId, lineProviderUserId) WHERE state IN ('RECEIVED','VALIDATED','PENDING_REVIEW','PROVISIONING','PROVISIONING_FAILED','READY')` แทนการเช็คใน use-case อย่างเดียว — **แก้ 2026-09-05 (รีวิวรอบ 2):** เพิ่ม `PROVISIONING_FAILED` และ `READY` เข้าเซต "เปิดอยู่" เพราะแถวที่ค้างสองสถานะนี้ยังมีบริษัท/identity ที่สร้างไปครึ่งทาง การสมัครซ้ำจะเดินทาง attach แล้วได้ร้านที่ 2; retry ต้อง idempotent = หา company ที่สร้างไปแล้วของคำขอนี้ก่อน ไม่รัน onboarding ซ้ำ (SIGNUP-01) — **กติกา provisioning (สรุปจากรีวิวรอบ 2–4, 2026-09-05):** ① `request.companyId` ถูกบันทึก**ในธุรกรรมเดียวกับการสร้างบริษัท**แบบมีเงื่อนไข (`WHERE companyId IS NULL`; 0 แถว = โยน error ให้ทั้งธุรกรรม rollback) → สอง attempt ที่ซ้อนกันได้บริษัทเดียวเสมอ แม้เคส attach ที่ไม่มี unique ของ LINE identity คุ้มครอง ② แถว `PROVISIONING` ที่ `provisioningStartedAt` เก่ากว่า 90 วินาที (ค่าคงที่ตั้งชื่อ) ถือว่า "ผู้ถือหายไป" → คิวแสดงและอนุมัติซ้ำได้ = re-claim attempt ใหม่ (audit `signup.provisioning.reclaimed_stale`) แล้วเดินทาง adopt ถ้าบริษัทมีแล้ว; แถวที่ยังสด = 409 in-progress ③ `PROVISIONING_FAILED` และ `READY` ของ line-oa อยู่ในคิว อนุมัติ = "ปิดงาน" (ไม่เขียนทับ approvedAt/approvedByUserId เดิม) ④ ผู้ดำเนินการ (FK) แก้ตามลำดับ: ผู้เรียกที่ระบุ → แอดมินที่อนุมัติ → SYSTEM_ADMIN ที่ ACTIVE จาก directory → ไม่มี = ปฏิเสธ `signup_operator_unresolved`; audit บันทึก `source/autoApproved/operatorResolvedFromDirectory` ⑤ ลิงก์ที่ต้องไปหน้าเว็บอ่านจาก `WEB_BASE_URL` เท่านั้น (ไม่รับจาก header ฝั่ง client) ทุก controller ที่สร้าง handoff รวม claim ของ Flow B และหน้าเปิดบริษัทใหม่ของแอดมิน — ไม่ตั้งค่า = 503 `web_base_url_not_configured` (เฉพาะ APPROVE; REJECT/SUSPEND ไม่ต้องใช้) ⑥ `/public/line-signups/me` ใช้ bucket อ่านต่อบัญชีแยกจาก bucket สมัคร — หน้า LIFF ห้าม poll ตามเวลา
- **B-06** provisioning source line-oa `upsertCompanyContext(lineUserId → companyId ใหม่)` ให้ใบเสร็จใบแรกเข้าร้านที่เพิ่งเปิด (reuse `link-line-identity.use-case.ts:157-165`)
- **B-07** handoff target = `/companies/<id>/dashboard` (path ที่มีอยู่) — **แก้ 2026-09-06 ตาม Owner:** เดิม `/companies/<id>/expenses/upload`; ค่าใหม่ตรงกับ landing สำรองของ `/l/<token>` (`apps/web/app/l/[token]/route.ts:69`); legal gate ทำงานหลัง landing เอง
- **B-02/B-03/B-04** ตาม §5/§6 (TRANSITIONS แยก source, `contactEmail?`, `ownerAuth`) — ตรวจผู้อ่าน `contactEmail` ทุกตัวตามรายการใน review

**15.3 ตะขอเตรียมพร้อม (ทำ schema/port รอบนี้ ไม่ทำระบบ)**
- **H-01 จ่ายเงิน:** `PackageChangeRequest` เพิ่ม nullable `amountSatang`, `offerSnapshotJson`, `paymentState (NONE|PENDING|VERIFIED|FAILED) default NONE`, `paymentRef`, `slipAttachmentId`, `verifiedAt`; การเปลี่ยน tier ผ่าน `PUT /system/partners/:id/plan-term` เดิมเท่านั้น
- **H-02 อีเมล:** `AuthMailerPort` เพิ่ม `sendLineSignupWelcome({ toEmail, companyName })` และ `sendPackageChangeNotice({ toEmail, companyName, tierKey })` — no-op ใน Disabled/LocalConsole และใน SES ขณะ sandbox; ส่งเฉพาะเมื่อ User มี `emailVerifiedAt`
- **H-03/H-04** ตามตาราง review 1D

**15.4 Slice ใหม่ L-E "ข้อมูลร้านและบัญชีของฉัน" (G-02) — เส้นทาง "กรอกที่เหลือทีหลัง"**
- หน้าเดียวใต้ตั้งค่า (OWNER): ส่วนร้าน = ชื่อจดทะเบียน/เลขภาษี/ที่อยู่ (API `PATCH /companies/:id/identity` เดิม, perm `company.legal_identity.manage`) + สถานะ VAT (`PUT vat-registration` เดิม); ส่วนบัญชีของฉัน = อีเมล (ขอยืนยันผ่าน `EmailVerificationToken` เดิม; ซ้ำกับ User อื่น → เสนอ merge ตาม P10 §4F), เบอร์มือถือ, ตั้งรหัสผ่านสำรอง (สร้าง `UserCredential` ครั้งแรก — endpoint ใหม่ถ้ายังไม่มี)
- **การ์ดเช็คลิสต์ความครบ** บน dashboard ของ OWNER (ไม่บล็อก): เลขภาษี/ชื่อจดทะเบียน · ที่อยู่ · อีเมลกันหลุด · รหัสผ่านสำรอง — แต่ละข้อลิงก์ไปหน้าเดียวกัน; ซ่อนเมื่อครบ
- prompt ตามบริบท: จะออกเอกสารภาษี → ขอเลขภาษีตรงนั้น (modal เล็ก) — ไม่ถามล่วงหน้า
- ใช้ได้กับลูกค้าจาก Flow B และที่แอดมินเปิดให้ด้วย (ทุกช่องทางไม่มีหน้านี้มาก่อน)

**15.4.1 ปรับจากรอบ UAT 2026-09-06 (Owner ทดสอบร้านที่เพิ่งอนุมัติอัตโนมัติทาง LINE)**

- **A. ฟอร์มข้อมูลร้าน + สถานะ VAT บันทึกครั้งเดียวด้วยปุ่มเดียว ห้ามทำข้อมูลที่พิมพ์ไว้หาย** — เดิม dropdown "ร้านจดทะเบียน VAT หรือยัง" เรียก `PUT vat-registration` ทันทีที่เลือก แล้ว `load()` อ่านค่าจากเซิร์ฟเวอร์มาทับฟอร์ม ชื่อจดทะเบียน/เลขภาษี/ที่อยู่ที่พิมพ์ค้างไว้จึงหายทั้งหมด ต่อไป dropdown เป็น state ในหน้าเท่านั้น ปุ่ม "บันทึกข้อมูลร้าน" บันทึกสิ่งที่เปลี่ยนจริง: identity ผ่าน `PATCH /companies/:id/identity` (ถ้าเปลี่ยน) แล้ว VAT ผ่าน `PUT /companies/:id/vat-registration` (ถ้าเปลี่ยน) เรียงกัน แยกแบนเนอร์ error คนละส่วน — ฝั่งที่ล้มเหลวต้องไม่ล้างค่าที่พิมพ์ไว้ของอีกฝั่ง; หลังบันทึกสำเร็จอ่านค่าใหม่จากเซิร์ฟเวอร์เพื่อรีเฟรช version/readiness แต่ **seed ฟอร์มครั้งแรกครั้งเดียว** ไม่เขียนทับกล่องที่ผู้ใช้กำลังพิมพ์; เงื่อนไข "ยังไม่มีอะไรเปลี่ยนค่ะ" นับการเปลี่ยน VAT ด้วย; ตัวเลือก `UNKNOWN` ยัง disabled (ตอบแล้วย้อนกลับไปยังไม่ตอบไม่ได้)
- **B. อีเมลที่ยืนยันแล้วเป็นข้อความอ่านอย่างเดียว จนกว่าผู้ใช้จะกด "เปลี่ยนอีเมล"** — สถานะอ่านจาก `GET /v1/auth/account/security`: ① ยืนยันแล้วและไม่มีคำขอค้าง = แสดงอีเมลเป็นข้อความ + ป้าย "ยืนยันแล้ว" + ปุ่มข้อความ "เปลี่ยนอีเมล" (กดแล้วจึงเปิดกล่องกรอก + "รหัสผ่านปัจจุบัน" เมื่อมี `hasPassword` + ปุ่มส่ง และมี "ยกเลิก" กลับไปอ่านอย่างเดียว) ② มีคำขอค้าง (`pendingEmail`) = "ส่งลิงก์ยืนยันไปที่ … แล้ว รอการยืนยัน (ลิงก์มีอายุ 15 นาที)" + "ส่งลิงก์อีกครั้ง" (`POST /v1/auth/account/email/resend` ที่มีอยู่แล้ว) + "เปลี่ยนอีเมล" ③ ยังไม่มีอีเมล = ฟอร์มเดิม — API ตอบ 409 เมื่อส่งอีเมลเดิมที่ยืนยันแล้วซ้ำ UI จึงต้องไม่เปิดทางนั้นตั้งแต่ต้น
- **C. การส่งอีเมลต้องพูดความจริงตามสภาพแวดล้อมจริง** — `AccountSecurityState` เพิ่ม `emailDeliveryEnabled = (EMAIL_PROVIDER !== 'disabled')`; `POST /v1/auth/account/email` และ `…/resend` ปฏิเสธ **ก่อนสร้าง token** ด้วย 422 code `email_delivery_unavailable` เมื่อ provider เป็น `disabled`; หน้าเว็บเมื่อ `emailDeliveryEnabled === false` ไม่แสดงปุ่มส่ง แสดงหมายเหตุให้ติดต่อทีมงาน และ **ตัดข้อ "อีเมลกันหลุด" ออกจากเช็คลิสต์** (งานที่ทำให้เสร็จไม่ได้คือเสียงรบกวน) — production ยังคง `EMAIL_PROVIDER=disabled` ตามเดิม ข้อนี้ทำให้สภาพนั้น *มองเห็นได้* ไม่ได้เปิดการส่งเมล ไม่แก้ `deploy.sh` ไม่แก้ env/flag
- **D. คำอธิบายเบอร์มือถือพูดตรง ๆ** — hint `ใส่เบอร์มือถือ 10 หลัก เช่น 0812345678`, error `เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678` (เดิม "ขึ้นต้นด้วย 0 เว้นว่างไว้ก็ได้ถ้าไม่อยากให้เก็บ" อ่านแล้วเข้าใจว่าให้ตัดเลข 0 ทิ้ง); การลบเบอร์ยังทำได้แต่เป็นปุ่มข้อความ "ลบเบอร์ออก" ที่แสดงเฉพาะเมื่อมีเบอร์เก็บอยู่ ไม่ใช่คำอธิบายในช่องกรอก; ฟอร์มสมัครสาธารณะและข้อความ `invalid_phone_number` ใช้ประโยคเดียวกัน
- **E. ไอคอนเตือน "ยังตั้งค่าไม่ครบ" จนกว่าจะครบ** — เช็คลิสต์เดิม (แหล่งเดียว) ถูกดึงเป็น hook `useProfileChecklist(companyId)` ใช้ร่วมกันสามที่: การ์ดบน dashboard (พฤติกรรมเดิม), เมนู "ตั้งค่าบริษัท" ในไซด์บาร์ (จุดสีเหลืองอำพัน ทั้งตอนกางและตอนย่อ, `aria-label` "ตั้งค่ายังไม่ครบ"), และการ์ด "ข้อมูลร้านและบัญชีของฉัน" บนหน้ารวมการตั้งค่า (ป้าย "ยังกรอกไม่ครบ") — แสดงเฉพาะผู้ถือ `company.legal_identity.manage` (คนที่ลงมือแก้ได้จริง) และ **ไม่ยิง API ให้คนที่ไม่มีสิทธิ์**; การกด "ไว้ก่อน" 7 วันมีผลกับการ์ดบน dashboard เท่านั้น ไม่ปิดไอคอนเตือน เพราะ Owner สั่งว่า "จนกว่าจะตั้งครบ"

**15.5 ฝั่ง admin (A-01…A-05)** ตามตาราง review 1E — เพิ่มจาก §8: hint **เบอร์ซ้ำกับร้านเดิม**, แท็บ "อนุมัติอัตโนมัติ 14 วัน", ตัวเลือก "ลูกค้าใช้ LINE เท่านั้น" ในหน้าเปิดบริษัทใหม่ (ไม่ออก temp password)

**15.6 Ops/monitoring (SDLC)** แจ้ง SYSTEM_ADMIN ผ่าน notify pattern เดิม เมื่อ: ชนเพดาน auto/วัน, push 429, provisioning ล้มเหลว, งบ AI ร้านทดลองหมดเกิน N ราย/วัน; push ของ flow นี้ผ่าน adapter ที่จัดการ 429/retry-after (G-07); นับ push/เดือนจาก outbox → หน้าปัด L-D; เพิ่ม signal rows ใน customer-journey catalog (G-08)

**15.7 Config เพิ่ม:** `RECEIPT_QUOTA_ENFORCED` (UAT true / prod false — ต่อใน deploy.sh แล้วใน L-A2), `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` (default 5 — **ยังไม่มีในโค้ด/deploy.sh; เป็นของ L-C พร้อมระบบแจ้งเตือน ops §15.6**)

**15.10 ข้อเบี่ยงเบนจาก L-B (2026-09-05 — ให้ Owner รับทราบ):** ① เส้นทาง LIFF จริงคือ `/v1/auth/line/link-page/signup` และ `/link-page/start` (มี alias `/signup-page`, `/start-page`) — **LIFF endpoint URL ใน LINE Developers ต้องเป็น `…/v1/auth/line/link-page`** เพื่อให้ `https://liff.line.me/<id>/signup` และ `/start` ทำงาน ② คำขอเปลี่ยนแพ็กเกจรับบริษัทที่ DISABLED (หมดอายุ) ด้วย ไม่งั้นปุ่มบนข้อความหมดอายุเป็นของประดับ ③ ปุ่มในแชทไม่ได้เลือก tier → ระบบเปิดคำขอด้วย "tier ถัดไปหนึ่งขั้น" (`nextPlanTierKey`) พร้อมหมายเหตุว่าลูกค้ายังไม่ได้เลือก — Owner เปลี่ยนค่าเริ่มต้นได้ ④ คำสั่งใหม่ "ติดต่อเจ้าหน้าที่" (คำสั่งเดิม "ติดต่อเรา" = การ์ดติดต่อคงเดิม) ⑤ ข้อความเตือน P29 7/3/1 และหมดอายุเดินทาง rail แจ้งเตือน dashboard ที่มีปุ่มตายตัวปุ่มเดียว → ใส่ปุ่มเพิ่มไม่ได้ ใช้ประโยคที่ตัวคำเป็นคำสั่ง ("พิมพ์ ขอเปลี่ยนแพ็กเกจ") ส่วน reply ตอนหมดอายุที่ลูกค้าทักมามีปุ่มจริง ⑥ นาฬิกา "กันหลุดวันที่ 7" นับจาก `approvedAt` (line-oa อนุมัติ = provision) ⑦ การหยุด AI 24 ชม. อยู่บน `LineCompanyContext` → คนที่ยังไม่ผูกบัญชีจะได้การ์ดประตูแทน ไม่มีการ push แอดมิน

**15.9 ข้อสังเกตจากรีวิว L-A2 (2026-09-05, ยอมรับ/บันทึก):** ฝั่ง LINE เมื่อ provider timeout/5xx ระบบ**คง**การนับไว้ (gateway อาจทำงานต่อจนได้ draft — คืนแล้วจะกลายเป็นอ่านฟรี) ส่วนฝั่งเว็บคืนให้เพราะเว็บ retry ด้วย id ใหม่เอง → ลูกค้าทดลองทาง LINE อาจเสีย 1 ใน 15 จากความล้มเหลวที่ไม่ได้ก่อ (เฝ้าดูใน UAT; ถ้าเกิดจริงบ่อย ค่อยทำ per-attachment read budget); เว็บ fence ด้วย requestId → กด "อ่านใบเสร็จ" ซ้ำเองใช้โควตาตัวเอง (ปุ่มปิดระหว่างอ่านอยู่แล้ว); หลักฐาน rollout ของโหมดเงาอ่านเป็น `count(distinct companyId)`

**15.8 ลำดับ slice ใหม่:** L-A (รวม pre-flight B-01) → L-A2 ตัวนับสลิป → L-B → L-C → L-E → UAT รอบแรก → L-D (ก่อน AUTO_FREE บน prod)
