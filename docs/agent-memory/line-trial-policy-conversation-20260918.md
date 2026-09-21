# Agent Memory: LINE trial and policy conversation

Status: implemented; preparing PR integration; normal develop + main integration, no deployment requested.
Owner: Codex, 2026-09-18
Scope: public policy answers, contextual follow-ups, wrong-link acknowledgement, novice help phrases.

Decisions:
- User approved this set for the normal release cycle after reporting trial follow-ups routed to expense help. Keep billing behavior unchanged.
- Reuse standard Flex cards, canonical text fallback and the public official-site package link. Never offer an expense link for a package question.
- Public answers distinguish unpaid trial from an already purchased subscription; no account-specific expiry, payment, deletion or refund claims.
- Sources: `docs/specs/mangmee-package-entitlements-spec-th.md`, `docs/specs/mangmee-billing-pack-amendment-2026-09-12.md` (latest owner amendment), `docs/specs/mangmee-company-plan-term-spec-th.md`, `docs/specs/mangmee-company-data-lifecycle-deletion-spec-th.md`, and `docs/runbooks/line-first-signup-support-playbook.md`.
- Remember only a closed public-policy topic in existing durable outcome metadata, never private assistant answers. Reuse the 15-minute context window; require the immediately previous event to have a delivered outcome for the same sender/chat/channel. Intervening events invalidate it. Existing durability flag remains authoritative; without an accepted outcome, do not infer context.
- Human-support pause, quoted/mixed business requests, mutations, tenant permissions and account gates keep their existing routes. No schema, dependencies, prompts, payment gates or package.json changes.

Acceptance:
- Trial -> “ต้องสมัครต่อไหม” -> “แบบหมดอายุฟรีแล้วบังคับสมัครต่อไหม” -> “ถามว่าบังคับไหม”: clear optional purchase, no automatic trial charge, cards throughout, zero model calls.
- “เข้าแล้วมาหน้าค่าใช้จ่าย” after a policy answer acknowledges the wrong destination and supplies the package route; never congratulates or claims navigation succeeded.
- General trial limits/card requirement, expiry/data, paid renewal, early purchase, quota counting, plan changes, cancellation/refunds and payment-failure policies use documented public rules; individual facts go to staff.
- No context across users/chats/channels, expired/undelivered outcomes, unknown metadata or intervening business turns. Persistence survives use-case instance replacement.
- Novice help uses existing capability flow and its permissions.

Open questions: none blocking; no new commercial policy is being decided.
Artifacts: isolated branch `codex/line-trial-policy-conversation-20260918` from develop 70d1359d.
Verification:
- Focused existing staff-menu/card/webhook suites: 433/433 passing, including the reported sequence, promotion entry, restart, isolation, expiry, interruption, support pause and Flex rejection.
- API typecheck passed (Node 22, 8 GB heap); contracts/config built and Prisma generated in the isolated checkout.
- Official public URL inspected: site provides package information. FAQ cards and text fallback always use `https://official.mangmeeplus.com/`, never a tenant expense URL.
- No browser/Prod session changes or deployment performed. Context uses the existing durable-outcome flag (normal UAT/Prod workflow default true); disabling it deliberately disables contextual inference.
- Exact-head CI: first run 35361717215 superseded by the paid-context review fix; awaiting the updated head. Generic cost questions after a purchased-plan answer retain paid-renewal context, including after the shared data-policy topic.
Next: implement and verify, PR/merge develop, integrate same set into main; leave deployment to normal cycle.

Owner amendment 2026-09-21: there is no free trial, and the menu answer ("เปิดร้านแล้วใช้อะไรได้บ้าง") no longer says "เปิดได้ 7 เมนูตามแพ็กเกจ". Before paying: only ตั้งค่าร้าน/บัญชี and the package page. After paying: 249 / 499 / 999 share one core menu set (ผู้ช่วย AI ทาง LINE, แดชบอร์ด, ค่าใช้จ่ายและใบเสร็จ, การเบิกจ่าย, พนักงานและสิทธิ์, การแจ้งเตือน) and differ only in สาขา/ผู้ใช้/ใบเสร็จ; แพ็กเกจธุรกิจ 1,999 บาท/เดือน (19,990/ปี) opens every menu, including ภาษี ภ.ง.ด.53 และ 50 ทวิ, จัดซื้อ, คลังสินค้า, CRM, บัญชีธนาคาร and รายงานการเงิน. "แพ็กเกจไหนได้เมนูอะไรบ้าง" / "แพ็กเกจธุรกิจได้อะไรบ้าง" now resolve to that same topic. The LINE โปรโมชั่น card changed with it: customers choose and pay inside the app, so a linked owner gets a one-tap link to their own package page, an employee is told the owner chooses, and a stranger gets the signup door; the official site only informs.

Owner welcome copy 2026-09-21: a `follow` event from someone with no account now answers with TWO messages in the one reply — an Owner-approved Thai greeting first, then the existing door card. The greeting says what น้องมั่งมี is (ผู้ช่วยบัญชี AI สำหรับร้านค้าและ SME), the three things she does (ถ่ายใบเสร็จ, ถามยอดขาย/ค่าใช้จ่าย/สรุปบัญชี, แพ็กเกจธุรกิจออกเอกสารและภาษีได้ครบ รวม ภ.ง.ด.53 และ 50 ทวิ), the three steps to a working shop (เปิดร้านใหม่ → เลือกแพ็กเกจ เริ่มต้น 249 บาท/เดือน แล้วชำระ → ใช้งานได้ทันที) and points at the แพ็กเกจและราคา tile on the rich menu. The door card gains one button, second in the footer: ดูแพ็กเกจและราคา, a message action sending โปรโมชั่น, so the price question is answered by the promotion card that already exists instead of a second copy of the words. The other two audiences are unchanged: a stranger who merely types still gets the card alone (the greeting belongs to the friend-add), a known LINE account that re-adds the OA still gets only the short welcome-back line, and a follower whose application is already travelling still gets the status card alone — the greeting's step 1 names a button that card does not carry.
