# Feature: LINE AI Capability-Help Entitlement Honesty

## 1. Status

- Current source has the scoped-help implementation; phases1–4 are recorded locally verified in the linked plan. Full native/live acceptance remains separate. Extends the LINE entitlement work of 2026-08-15 ([[agent-memory/line-menu-entitlement-gating|LINE staff menu feature-entitlement gating]]), which gated the quick-reply menu and the ERP tools but deliberately did not touch reply COPY.
- Owner: thawatchai
- Date: 2026-08-19. Driven by an owner report from the LINE OA: the user asked "แล้วคุณทำอะไรได้บ้าง" and น้องมั่งมี answered with a capability list naming sales, finance, tax, stock, customers, bookings and receipt→expense-draft capture, on a company where those features are not switched on. The quick-reply buttons under the same message were already correctly filtered — the text was not.
- Rule already stated by the owner on 2026-08-15 and inherited here: **a feature that is off in the system must not appear in LINE at all.** This spec extends "appear" from buttons and answers to the assistant's own description of itself.
- **Owner decision 2026-08-19: AC-6 is in scope and is a release gate.** The CRM-on / sales-off case must be correct, not accepted as a known miss. This closes §10.3: `entitledFeatureKeys` is plumbed through the AgentCore runtime path (phase 4 of the plan is mandatory, not optional), because UAT and Production both run `LINE_AI_AGENT_RUNTIME=agentcore` and permission-only derivation cannot get that case right.

## 2. Goal

When a linked employee asks น้องมั่งมี what it can do, the answer names only capabilities this company has switched on **and** this employee's permissions can reach. Anything the system would refuse is never advertised.

Concretely, after this change:

1. Every capability line in the reply corresponds to at least one LINE tool that would actually run for this caller, in this company, right now.
2. A capability the caller could not use is absent — not greyed out, not footnoted, not "contact your admin".
3. A legacy company with no entitlement rows keeps today's full text, unchanged.
4. The self-description and the quick-reply menu under it never disagree.

## 3. Source Docs

- Authority: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]] (reply safety contract, final-mutation boundary)
- Entitlement model: [[specs/feature-entitlement-decoupling-spec|Feature Entitlement Decoupling Spec]], [[agent-memory/line-menu-entitlement-gating|LINE staff menu feature-entitlement gating]] (the menu + tool gate this spec mirrors)
- Orchestration: [[specs/line-ai-local-agent-orchestration-spec|10B Orchestration Spec]] (`capability_help` is a zero-tool intent)
- Plan: [[plans/line-ai-capability-help-entitlement-plan|LINE AI Capability-Help Entitlement Plan]]
- Memory: [[agent-memory/line-ai-capability-help-entitlement|Agent Memory: line-ai-capability-help-entitlement]]

## 4. Measured Current State (2026-08-19)

All numbers below were produced by running the real registries and helpers against fixture companies before any code was changed. Full harness output is recorded in the memory doc.

| # | Finding | Evidence |
|---|---|---|
| E1 | The capability text is a frozen constant. `CAPABILITY_HELP` (th/en) at `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:68-92` is returned verbatim by `composeCapabilityHelp()` (`:122`), called from `orchestrator.agent.ts:344-345`. Measured function arity: **0** — every parameter has a default and none of them is a company, permission, or feature input. | harness E1 |
| E2 | For a realistic company with only `expenses` + `dashboard_notifications` + `ai_line_assistant` on, **9 of the 12 capabilities the text advertises cannot be answered at all** (sales, finance, tax, products, stock, customers, bookings, follow-ups, documents). | harness E2 |
| E3 | For that same company the already-shipped tool gate refuses **44 of 60** tools in `LINE_TOOL_REGISTRY`. The assistant advertises, then refuses — with `🚧 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานสำหรับบริษัทของคุณค่ะ`. | harness E3 |
| E4 | The AI gateway has **no entitlement input of any kind**: `grep -rn entitlement apps/ai-gateway/src` returns nothing, and `LineAiTurnRequest` (`packages/contracts/src/line-ai.ts:150-170`) carries no feature keys. The blurb could not have been gated even if it wanted to be. | code |
| E5 | The follow-up reply has the same defect on the API side: `capabilityFollowUpReply(text)` at `apps/api/src/modules/line-ai/domain/logic/line-ai-capability-follow-up.logic.ts:15-33` is a static two-language constant (it repeats the receipt→draft claim), reached from `process-line-webhook.use-case.ts:1252-1254`. Unlike the gateway, this file already runs where entitlements are loadable. | code |
| E6 | No test anywhere asserts the capability copy. `response-composer.agent.spec.ts` (32 tests, all passing) never mentions it; `line-ai-capability-follow-up.logic.ts` has no spec file at all. | baseline run |

## 5. Non-goals

- No change to what any tool does, to permissions, to the entitlement evaluator, or to the `FEATURE_NOT_ENABLED` refusal introduced on 2026-08-15.
- No new UI, no admin screen, no per-company copy editor.
- No attempt to sell: the reply never names a disabled feature, never says "ติดต่อผู้ดูแลเพื่อเปิดใช้งาน" for something the caller did not ask for, and never leaks another company's or another role's capabilities.
- The `casual_conversation` reply and the safety/refusal templates are untouched.

## 6. Design Decision: derive, do not re-list

Two designs were measured before choosing.

**Rejected — a second hand-written list keyed by feature.** A `[featureKeys, thaiLine]` table beside the existing one in `line-staff-menu.logic.ts`. It works (harness E4 produced correct output from it), but it is a third copy of "what น้องมั่งมี can do" that must be re-edited every time a tool is added, and nothing fails when it drifts.

**Chosen — derive the lines from `LINE_TOOL_REGISTRY`.** A capability line renders if and only if at least one tool in its group passes **both** gates the runtime itself uses:

```
usable = LINE_TOOL_REGISTRY.filter(t => hasToolPermissions(t, permissions) && hasToolFeature(t, entitled))
```

Then the advertised text is a projection of `usable`. The blurb becomes structurally incapable of promising something the gate would refuse, and a newly added tool lights its line up on its own.

Measured behaviour of the derivation (harness E7, corrected fixtures):

| Caller / company | Lines rendered | Receipt-capture line |
|---|---|---|
| staff (expense + receipt upload perms) @ expenses-only company | ค่าใช้จ่าย, งานค้าง/แจ้งเตือน | yes |
| same staff, `expenses` on but `expenses.upload` off | ค่าใช้จ่าย, งานค้าง/แจ้งเตือน | **no** |
| manager without upload permission @ expenses-only company | ค่าใช้จ่าย, งานค้าง/แจ้งเตือน | no |
| manager @ all features on | 8 lines (sales, expenses, finance, tax, stock, customers, bookings, alerts) | no |
| manager @ legacy company (`entitled === null`) | identical to all-features-on | no |
| caller with zero permissions | none | no |

### 6.1 Group by the entitlement axis, not by business subject

The first derivation attempt grouped tools by `ToolMeta.businessSubjects` and produced a **false** finance line for the expenses-only company: `dashboard.get_business_health_summary` declares `businessSubjects: ['company','report']`, so a dashboard tool advertised "การเงิน บัญชี และธนาคาร" on a company with `reports`, `double_entry_ledger` and `bank_reconciliation` all off (harness E5/E6).

Grouping instead by `toolFeatureKeys(tool)` — the exact axis `hasToolFeature` gates on — removes the leak and keeps submenu precision (`crm.bookings` separates from `crm`, `expenses.upload` separates from `expenses`). Groups:

| Group | Feature keys |
|---|---|
| ยอดขายและเอกสารขาย | `sales_documents` |
| ค่าใช้จ่ายและใบเสร็จ | `expenses`, `expenses.list` |
| การเงิน บัญชี และธนาคาร | `double_entry_ledger`, `bank_reconciliation`, `reports` |
| ภาษี | `thai_tax` |
| สินค้าและสต็อก | `inventory`, `product_catalog` |
| ลูกค้าและงานติดตาม | `crm`, `crm.inbox` |
| นัดหมายและคิว | `crm.bookings` |
| จัดซื้อและผู้ขาย | `procurement` |
| งานค้างและการแจ้งเตือน | `dashboard_notifications` |
| แพ็กเกจและใบเสร็จคงเหลือ | none — source module `billing`, and only for a caller holding `company.plan.manage` (advisor spec §5.1, owner 2026-09-30): `billing.get_package_usage` runs for every assistant user and answers a non-manager with a typed refusal, so the tool alone never lights this line. A caller with no known access is never told it either. `billing.get_package_catalog` (package prices and contents, owner 2026-09-30 ~16:00) is also `billing` and runs for every assistant user; it adds no line of its own and never lights this one. |
| (receipt capture sentence) | `expenses.upload` — **not** derived from a tool; see §10.1. The predicate is the intake path's own check: `expenses.upload` entitled ∧ any of `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create` |

A tool whose feature keys match no group is not advertised; it is not an error, and it must not silently widen an unrelated line. The reimbursement tools stay deliberately feature-ungated for retained reads under their own source/permission checks. Current `LINE_CAPABILITY_GROUPS` includes sourceModule reimbursements in the expenses group; this does not advertise creation when reimbursement is off.

## 7. Where the entitlement set comes from

`req.userContext.permissions` reaching the gateway are **already entitlement-stripped**: `prisma-permission-resolver.repository.ts:72-73` runs `filterPermissionsByEntitlement` at resolve time for every LINE turn. Measured consequence (harness E9/E10): for an owner holding all 266 registry permissions, permission-only filtering selects the same tool set as permission ∧ entitlement for **59 of 60** tools.

The single residual divergence is `sales.get_sales_summary`, which requires `crm.report.read` but reads `sales_documents` data — the same bypass the 2026-08-15 work identified and closed at the tool layer. On a CRM-on / sales-off company, permission-only derivation would still advertise the sales line.

Therefore:

- `LineAiTurnRequest` gains **optional** `entitledFeatureKeys?: string[]`, supplied by the API from the `loadEntitledFeatureKeys` call it already makes.
- Absent (older payloads, the AgentCore runtime path until it is plumbed, any non-LINE caller) = `null` = legacy fail-open, exactly the repo-wide convention. Absence degrades to permission-only derivation, which E9/E10 show is already correct for 59/60 tools — the field buys exactness, not basic safety.
- The field is capability METADATA about the caller's own company, already implied by the permission list beside it; it names no other company and no other user.

## 8. Reply contract

Thai (English mirrors it line for line):

```
น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์ของคุณได้ค่ะ เช่น
<one line per usable group, in the fixed order of §6.1>
[ส่งรูปใบเสร็จหรือสลิปเพื่อสร้างร่างค่าใช้จ่ายได้ด้วยนะคะ — only when a receipt-capture tool is usable]
<one example question drawn from a rendered group, never from a hidden one>
ความสามารถที่ใช้ได้ขึ้นกับสิทธิ์และฟีเจอร์ของบริษัท ส่วนการอนุมัติ จ่ายเงิน และลงบัญชีขั้นสุดท้ายต้องทำบนเว็บค่ะ
```

Rules:

- **R1** Fixed group order, so the reply is stable turn to turn.
- **R2** The example question must come from a rendered group. Today's text hardcodes "ยอดขายวันนี้เท่าไหร่" and "ของอะไรใกล้หมด" — both invalid for the reported company.
- **R3** The closing sentence stays: it is the honest reason the list is short, and it already names both dimensions (สิทธิ์ + ฟีเจอร์).
- **R4** Zero usable groups (measured possible: a caller with no permissions) never yields an empty reply. It falls back to a single honest line — the assistant is connected but this account can currently read nothing here, check with the company admin — and no capability list.
- **R5** No feature key, permission key, tool name, or count of hidden features may appear in the text. Same leak rule the 2026-08-15 `FEATURE_NOT_ENABLED` reply is tested against.
- **R6** The follow-up ("อย่างไร" / "how so") reply obeys R1–R5 over the same usable set. It must never re-introduce a claim the first reply omitted.
- **R7 One language per reply.** The derivation returns group **ids**; the copy comes from exactly one language table chosen once per turn by the existing `detectReplyLanguage` (`response-composer.agent.ts:517-523`). No group id may carry copy, and the example question of R2 is drawn from the same table as the bullets, so a half-Thai/half-English reply is unrepresentable. Language selection itself is unchanged by this spec.

Measured behaviour of `detectReplyLanguage` on mixed input (2026-08-19, real function):

| Input | Reply |
|---|---|
| `ทำอะไรได้บ้าง` | TH |
| `ช่วย summary sales ให้หน่อยว่าทำอะไรได้บ้าง` | TH |
| `AI ทำอะไรได้บ้าง` / `can you ดูยอดขาย ได้ไหม` / `ทำอะไรได้บ้าง help` | TH |
| `🙏` (no Latin letters) | TH |
| `what can you do` / `ok what can you do?` / `help` | EN |
| empty text (button/postback) | follows `planLanguage`/`locale` |

One Thai character anywhere wins for Thai; a message with no Thai characters and at least one Latin letter is answered in English. So "ไทยคำอังกฤษคำ" always produces a fully Thai reply — the mixed-language case never yields mixed-language copy. The one edge worth knowing (pre-existing, not introduced here): a Thai user who types only `help` or `ok` gets the English reply.

### 8.1 Teaching mode (2026-09-06)

Owner report, UAT 2026-09-06 (build f2bd38ed, new auto-approved company, its OWNER): `สอนฉันใช้งานเบื้องต้นแบบง่ายง่ายแบบมนุษย์แม่ป้าเข้าใจได้` was answered with the §8 card, which lists WHAT and never HOW — "ควรสอนการใช้งาน user ได้ตามฟีเจอร์ที่เปิดอยู่ และตามขอบเขตของผู้ถาม". The card gains a second rendering, chosen deterministically from the message, over the SAME usable set.

**Trigger.** `isTeachingRequest(messageText)` (`apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`, exported pure function): the NFC-normalised, lower-cased whole message CONTAINS one of a small literal list — `วิธีใช้`, `ใช้งานยังไง`, `ใช้ยังไง`, `ใช้งานอย่างไร`, `เริ่มยังไง`, `เริ่มต้น`, `มือใหม่`, `แนะนำการใช้`, `how do i use`, `how to use`, `how do i start`, `how to start`, `getting started`, `teach me` — or `สอน` as the verb "teach (me)" only: message-initial, after a space or ช่วย/รบกวน/อยากให้/ขอให้, or followed by ใช้/ฉัน/ผม/หนู/เรา/ให้/หน่อย/วิธี/การใช้/ที/ด้วย; never inside a business noun such as ค่าสอน, ครูสอน, การสอน (review 2026-09-06: `ค่าสอนพิเศษเดือนนี้เท่าไหร่` is an expense question). The model never decides which rendering answers; it only decides that the turn is `capability_help` (the orchestrator router prompt lists the teaching phrasings, and the intake router's advisor section says a teaching request is never `ADVISOR_CONVERSATION` — advisor spec §8.1). Any other `capability_help` turn keeps the §8 card. `composeCapabilityHelp(messageText, …)` makes the choice, so every call site gets it.

**Reply contract** (Thai; English mirrors it line for line):

```
น้องมั่งมีสอนใช้งานเบื้องต้นให้นะคะ ทำตามนี้ได้เลยค่ะ
[1) ถ่ายรูปใบเสร็จหรือสลิป แล้วส่งมาในแชทนี้ได้เลย                                   — receipt predicate only]
[2) น้องมั่งมีอ่านให้แล้วทำร่างค่าใช้จ่าย คุณแค่ตรวจยอดกับวันที่แล้วกดยืนยัน           — receipt predicate only]
<one numbered line per usable group, §6.1 order: "อยาก… พิมพ์ว่า “<that group's §8 example question>”">
[<one numbered role line: ถ้ามีรายการรอคุณอนุมัติ พิมพ์ว่า “รายการรออนุมัติ” … กดอนุมัติจริงทำในเว็บค่ะ — only when reimbursement.list_pending_approvals passes both gates>]
อยากเห็นเมนูทั้งหมด กดปุ่ม “เมนูหลัก” ด้านล่างได้เลยค่ะ
ความสามารถที่ใช้ได้ขึ้นกับสิทธิ์และฟีเจอร์ของบริษัท ส่วนการอนุมัติ จ่ายเงิน และลงบัญชีขั้นสุดท้ายต้องทำบนเว็บค่ะ
```

Rules:

- **T1** Same derivation, same gates: the group lines come from `usableCapabilityGroupIds(permissions, entitled)` and the two photo steps from `canAdvertiseReceiptCapture` — R1–R5 and R7 apply unchanged. A hidden group never appears, and a caller without an upload permission never sees the photo steps.
- **T2** The phrase each line teaches is that group's §8 `CAPABILITY_COPY` example question, so the walkthrough can never teach a question the card would not suggest (R2 by construction).
- **T3** The role line is derived from the tool registry (`reimbursement.list_pending_approvals`: requires `reimbursement.approve`, no feature gate), never from a role name; nothing else role-specific is claimed, and the line says the approval itself happens in the web app.
- **T4** Numbering is sequential over the rendered steps; the reply mentions the `เมนูหลัก` quick-reply tile once and always ends with the §8 closing sentence. Bound: ≤ 15 lines with every group and the role line on (a typical company renders 6–8).
- **T5** Zero usable groups → the §8 R4 `none` reply, teaching or not. Receipt-only access keeps the §8 receipt+closing reply.
- **T6** The API recognises a "ยังไง"/"how" follow-up after the walkthrough exactly as after the card: both intros start with a prefix listed in `LINE_CAPABILITY_REPLY_PREFIXES` (`packages/contracts/src/ai-tools.ts`), which `isDeliveredCapabilityFollowUp` reads and a gateway spec pins against the rendered copy.

### 8.2 The fixed six-function card is for UNLINKED callers only (Owner 2026-09-06, review finding F1)

The API carries a second, older capability lane: `isCapabilityQuestion` + `buildCapabilityCard` (`apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`, Owner 2026-08-27, described in [[specs/line-rich-menu-v2-spec|rich menu v2 spec]]). It answered EVERY short capability question with a fixed six-function Flex card, before identity was resolved — so no linked caller ever reached §8 or §8.1 through it, and "every call site gets it" was not true end to end. Owner decision 2026-09-06 ("เห็นด้วย"), applying the same rule as §8.1: **"ควรสอนการใช้งาน user ได้ตามฟีเจอร์ที่เปิดอยู่ และตามขอบเขตของผู้ถาม"**.

- **Unlinked caller, or one with no ACTIVE account — unchanged.** The card is public marketing copy: no tenant data, no model call, and the right answer to a stranger who has no account for anything to be scoped to. The intercept therefore moves INSIDE the unlinked branch of `process-line-webhook.use-case.ts`, immediately after `resolveLineIdentity` and before the entry-door card, so the same message gets the same card, the same `staff_menu_capability` event-log status, and still no legal, entitlement, permission or model read.
- **Linked caller with an ACTIVE account — never the card.** Their message continues into the ordinary turn and is answered by §8 (card rendering) or §8.1 (walkthrough) over `usableCapabilityGroupIds(permissions, entitled)` + `canAdvertiseReceiptCapture`. A hidden feature or a permission the asker lacks is never advertised, which the fixed card could not promise: it names ยอดขาย and สรุปบัญชี to an expenses-only employee who can use neither.
- **`staff_menu_capability` now means exactly one thing** — an unlinked caller was sent the public card. The scoped path keeps the ordinary turn outcomes (`completed`, `support_paused`, …); no new status is needed to tell the two apart.
- **A shut AI lane still owes the shop its own scope (Owner 2026-09-06, second decision — closes the residual below).** "ร้านที่ปิดฟีเจอร์ แล้วเอไอตอบ ฟีเจอร์ยังไม่เปิดใช้งาน โอเค อันนี้ได้ แต่ถ้าบอกให้สอนวิธีใช้ ใน ขอบเขตที่เปิดใช้งานควรบอกได้" — a shop whose AI feature is off may be told the feature is off, but a request to be taught how to use the system must still be answered within the scope that IS enabled. So when a linked ACTIVE caller's message is an `isCapabilityQuestion` and the AI gate refuses (`lineAssistantDisabledFor(entitledFeatureKeys)`, or `refuseWhenLaunchRouteClosed`), the gate KEEPS its own refusal line — CC1 is untouched, a planned CLOSE still reads as "พักให้บริการชั่วคราว" and never as "not enabled" — and appends `buildServiceEntitlementMessage(entitledFeatureKeys)`, the same deterministic card the `บริการของเรา` tile renders from the same entitlement read. It is a company-level list of the shop's own switched-on services, so it can advertise nothing the shop cannot use (`ai_line_assistant` is itself sellable, so an AI-off shop never sees it listed). One plain line rides with it — `💡 ปุ่ม “บริการของเรา” และ “ติดต่อเรา” ในแชทนี้ยังกดได้ตามปกตินะคะ` — naming only tiles that sit ABOVE the AI gate; `เมนูหลัก` is below it and would answer `feature_disabled`, so it is deliberately not named. Zero model calls, no permission-floor change, and no change to any other gate: the legal, pause, opt-out and permission refusals are exactly as before, and an ORDINARY question at these two gates still gets the bare line alone. Outcome `staff_menu_capability_entitlements` — distinct, so it can be counted apart from a real refusal, and carried by the existing `staff_menu_` prefix in `classifyLineAiTerminalOutcome` into `delivered` rather than a false `failed_terminal` alarm. A kill-switch drill counting `launch_route_closed` should therefore count this sibling status too.
- **The matcher's phrasing list, and the "teach me" request forms (Owner 2026-09-06, "ตกลง").** `isCapabilityQuestion` accepts, on a message of ≤ 40 characters: the `ทำอะไรได้` / `ทำไรได้` / `ช่วยอะไรได้` / `ช่วยไรได้` / `มีฟีเจอร์อะไร` family unconditionally; `ใช้ยังไง` / `ใช้งานยังไง` only with a `มั่งมี` / `ระบบ` / `แอป` / `แอพ` / `ที่นี่` / `เมนู` subject; and — added 2026-09-06 — the **request forms of สอน**: `สอนหน่อย`, `สอนวิธีใช้`, `สอนวิธีใช้หน่อย`, `สอนวิธีใช้มั่งมีหน่อย`, `สอนใช้หน่อย`, `ช่วยสอนหน่อย`, `สอนที`, each with trailing politeness particles (ครับ/ค่ะ/คะ/นะ) and with or without the subject. This closes the gap the AI-off decision above left: the Owner's own words were "ถ้าบอกให้**สอนวิธีใช้**", and until now that exact phrasing was the one the matcher did not fire on. The rule is deliberately narrow, because `สอน` is also an everyday tutoring **expense** noun: a match needs the REQUEST form — `สอน` glued to a usage object (`สอน[การ|วิธี|วิธีการ]ใช้`) or, across a short subject/filler run, to a polite imperative particle (`สอน…หน่อย`, `สอน…ที` + ครับ/ค่ะ/นะ or end of message) — and is vetoed by a `ค่า`/`บิล`/`ใบเสร็จ`/`จ้าง` prefix or by **any digit** in the message, since a tutoring expense always names an amount (`ค่าสอนพิเศษ 500`, `โรงเรียนสอนขับรถ 2,000`) and a teach request never does. `จ้างครูมาสอน`, `อาจารย์สอนเสร็จแล้ว`, `ค่าเรียนสอนภาษา`, `สอนงานพนักงานใหม่วันนี้`, `บิลค่าสอน` and a bare number therefore stay on the ordinary path. **Owner-accepted consequences, both of the shared matcher:** an unlinked stranger typing these gets the public six-function card, and a linked caller of an AI-ON shop is routed away from the advisor's direct answer into the gateway's `capability_help` teaching mode (§8.1). An AI-off shop gets the gate line plus the entitlement card, exactly as the bullet above specifies. No copy changes anywhere — this is a matcher change only, and the gateway's `INTENT_ROUTER_SYSTEM_PROMPT` already lists `สอนใช้งานหน่อย` and `วิธีใช้` among its `capability_help` examples, so the routing side needed nothing. **Known edges of the narrow rule (review 2026-09-06, all accepted).** The subject/filler window is at most 8 Thai characters, counting combining and tone marks, so a teach request aimed at a PERSON also matches when it is short enough — `สอนงานหน่อย`, `สอนเด็กหน่อย`, `ช่วยสอนลูกค้าหน่อย`, `ฝากสอนน้องที`, and `จ้างครูสอนหน่อย` when it names no amount (the `ค่า`/`บิล`/`ใบเสร็จ`/`จ้าง` prefixes must sit adjacent to `สอน`). No such false positive can cost a business turn, because the matcher runs at only three places and never above the intent router: the unlinked lane (the public card replaces the entry-door card), the two AI-lane refusals (the entitlement card replaces the bare line), and the `advisorDirectAnswerText` veto, which is inert unless the router already chose `ADVISOR_CONVERSATION`. In the other direction the digit veto also declines a genuine teach request that names a number (`สอนวิธีใช้ 2 อย่างหน่อย`), `สอน` with a subject but no particle does not match (`สอนผมใช้`), and `ที` is accepted only before ครับ/ค่ะ/คะ/นะ or end of message, so `สอนทีเถอะ`/`สอนทีสิ`/`สอนทีได้ไหม` fall through. The bias is deliberate: a missed teach request gets the ordinary answer, while a mis-read tutoring expense would lose a record.
- **Deliberate consequences of the move.** (a) The linked lane is no longer zero-model: the COPY stays deterministic, but *reaching* `capability_help` is a model decision — the intake router's advisor section and `INTENT_ROUTER_SYSTEM_PROMPT` both list these phrasings (advisor spec §8.1), and a misroute answers something else rather than something wrong-scoped. (b) A capability question now sits BELOW every gate it used to jump: the support pause (it is free text, not a deterministic command — [[specs/line-support-request-spec-th|support-request spec]] §2.2 delta รอบ 6), the AI-feature entitlement, and the `line.ai.query`/capture/signature permission floor. A caller any of those refuses gets that gate's own reply — the same one every other message of theirs already gets, which is the consistent answer, not a regression (amended 2026-09-06 by the bullet above: at the two AI-lane gates that reply now carries the entitlement card as well). (c) The one lane the question may NOT reach is the advisor shortcut: a route of `ADVISOR_CONVERSATION` returns a social draft the API delivers itself, with no gateway turn and therefore no `composeCapabilityHelp`, and that draft is model prose about what น้องมั่งมี can do — a feature list, unscoped. `advisorDirectAnswerText` therefore declines on `capabilityQuestion`, the same matcher that keeps the card for strangers (review 2026-09-06; the router prompt says it never routes this way, and prompt wording is not a trust boundary).

## 9. Acceptance Criteria

- AC-1 Expenses-only company, staff with receipt-upload permission: the reply names expenses and receipt capture and alerts, and contains none of ยอดขาย / ภาษี / สต็อก / นัดหมาย / ลูกค้า / รายงานการเงิน.
- AC-2 Same company with `expenses.upload` explicitly off: the receipt sentence is gone; the expenses line stays.
- AC-3 Caller holding none of `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create` on a company with `expenses.upload` on: the receipt sentence is gone. Conversely a `MANAGER` / `ACCOUNTANT` / `MARKETING` role — `line_upload` only — **keeps** it, because the intake path accepts them (§10.1).
- AC-4 All features on: the reply lists every group (parity with today's promise, not a regression).
- AC-5 Legacy company with no entitlement rows: byte-identical behaviour to AC-4 — no company loses copy because it was never configured.
- AC-6 CRM-on / sales-off company: the sales line is absent (this is the case permission-only derivation gets wrong; it pins the value of §7's field). **Release gate — owner decision 2026-08-19.** It must hold on the AgentCore path, not only on the local orchestrator path, so the same assertion runs against a request built by `payloadToTurnRequest`.
- AC-7 Caller with zero permissions: R4 fallback, no bullet list, no crash, no empty message.
- AC-8 The reply contains no feature key, permission key, or tool name in either language.
- AC-9 The follow-up reply for the same caller advertises a subset of the first reply's claims.
- AC-10 The quick-reply menu attached to the reply and the reply text name the same capabilities.
- AC-11 Every rendered line is backed by ≥1 tool passing both gates — asserted by construction, over the real `LINE_TOOL_REGISTRY`, not a fixture registry.
- AC-12 Mixed Thai/English input (`ช่วย summary sales ให้หน่อยว่าทำอะไรได้บ้าง`) returns a fully Thai reply with no English fragment, and the TH and EN tables render the same set of groups for the same caller (same ids, different words). R7.
- AC-13 (teaching, §8.1) Owner of an expenses-only company (`STAFF` permissions incl. `expense.receipt.line_upload`, `expenses.upload` on) asking `สอนใช้งานหน่อย มือใหม่`: the walkthrough has the two photo steps, the expenses line (“ค่าใช้จ่ายเดือนนี้เท่าไหร่”), the alerts line (“มีงานค้างอะไรบ้าง”), the `เมนูหลัก` line and the closing sentence — and none of ยอดขาย / ภาษี / สต็อก / นัดหมาย / ลูกค้า / จัดซื้อ.
- AC-14 (teaching) A caller holding none of `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create` never sees the photo steps; a caller with `reimbursement.approve` gets exactly one role line, everyone else none.
- AC-15 (teaching) A zero-permission caller asking to be taught gets the R4 `none` reply; `what can you do` and `how do I start` on the same access set render the card and the walkthrough respectively, with the same group set, and the English walkthrough mirrors the Thai one line for line.
- AC-16 (§8.2) An UNLINKED caller sending `ทำอะไรได้บ้าง` still gets the six-function card and `staff_menu_capability`, with no legal, entitlement or model read. A LINKED caller sending `มั่งมีใช้ยังไง` or `ทำอะไรได้บ้าง` gets neither the card nor its copy: the intake router sees the message, the gateway turn carries that caller's permissions and this company's `entitledFeatureKeys`, and every phrasing `isCapabilityQuestion` accepts renders scoped (nothing outside the usable set) when it reaches `composeCapabilityHelp`. Under a support pause the same linked message gets the pause reply, not the card, and a routed `ADVISOR_CONVERSATION` draft never answers it. A linked account whose `User.status` is not ACTIVE is a stranger for this rule and keeps the card.
- AC-17 (§8.2, 2026-09-06) A linked ACTIVE caller of an AI-OFF company sending `มั่งมีใช้ยังไง` or `ทำอะไรได้บ้าง` gets two messages — the `feature_disabled` line plus the buttons note, then the entitlement card listing only that company's enabled sellable features and never `ผู้ช่วย AI ทาง LINE` — with zero intake-router and zero gateway calls, and the outcome `staff_menu_capability_entitlements`. The same caller sending an ORDINARY question gets exactly one message, the bare `feature_disabled` line, and that status. With the launch route CLOSED the same capability question keeps `พักให้บริการชั่วคราว` (never `ยังไม่ได้เปิดใช้งาน` — CC1) and gains the same card.
- AC-18 (§8.2, 2026-09-06) `สอนวิธีใช้หน่อย` behaves exactly like `ทำอะไรได้บ้าง` on all three lanes: an UNLINKED caller gets the six-function card and `staff_menu_capability`; a linked ACTIVE caller of an AI-OFF company gets the gate line plus the entitlement card and `staff_menu_capability_entitlements`; a linked ACTIVE caller of an AI-ON company is dispatched to the scoped turn with an `ADVISOR_CONVERSATION` draft vetoed. Every listed teach form (`สอนหน่อย`, `สอนวิธีใช้`, `สอนวิธีใช้หน่อย`, `สอนวิธีใช้มั่งมีหน่อย`, `สอนใช้หน่อย`, `ช่วยสอนหน่อย`, `สอนที`, with particles and subjects) matches, and `ค่าสอนพิเศษ 500`, `จ่ายค่าสอนลูก 1,500 บาท`, `โรงเรียนสอนขับรถ 2,000`, `จ้างครูมาสอน`, `อาจารย์สอนเสร็จแล้ว`, `ค่าเรียนสอนภาษา`, `สอนงานพนักงานใหม่วันนี้`, `บิลค่าสอน`, `ขอบิลค่าสอนหน่อย`, `จ้างครูสอนหน่อย 800` (the amount alone disqualifies it) and a bare number do not.

## 10. Open Questions (owner)

1. **Receipt-capture permission — proposal REVERSED by measurement (2026-08-19).** The first draft proposed gating the receipt sentence on `accounting.capture_receipt_evidence`'s `expense.receipt.upload`. That is wrong: the tool is not what runs. A LINE receipt image is captured by the intake path, which accepts **any of** `expense.receipt.line_upload` / `expense.receipt.upload` / `expense.create` (`process-line-webhook.use-case.ts:1158-1159`, `:2165`, mirrored in `expense-upload.use-case.ts:44` and `expense-document.use-case.ts:77`), exactly like the menu camera button (`line-staff-menu.logic.ts:64-67`). And `MANAGER`, `ACCOUNTANT`, and `MARKETING` hold `expense.receipt.line_upload` **without** `expense.receipt.upload` (`permission-registry.ts:613`, `:806`, `:859`). Gating on the tool would therefore hide a capability those three roles really have — a false negative, the opposite of the reported bug. **Revised proposal — APPROVED by owner 2026-08-19:** the receipt sentence follows the intake path (`line_upload || upload || create`) ∧ the `expenses.upload` entitlement, which also makes AC-10 hold by construction.
2. ~~**English parity.**~~ **RESOLVED 2026-08-19.** Both tables ship together, keyed by the same group ids (R7). Mixed-language input was measured and cannot produce mixed-language copy.
3. ~~**AgentCore runtime path.**~~ **RESOLVED 2026-08-19 — owner: AC-6 must be delivered, so the field is plumbed.** Both UAT and Production run `LINE_AI_AGENT_RUNTIME=agentcore` (`.github/workflows/deploy-uat.yml:615`, `.github/workflows/deploy-production.yml:236`; production promotion *fails* if it is anything else — `infra/security/validate-production-promotion-environment.sh:52`), so `payloadToTurnRequest` (`apps/ai-gateway/src/agentcore/runtime.ts:245-267`) is the live request builder and drops any field absent from `RuntimePayload`. Without plumbing, AC-1..AC-5 would still hold (permissions travel in the payload) but AC-6 would fail in exactly the environments that matter. `entitledFeatureKeys` therefore travels: API → gateway request → `RuntimePayload` → AgentCore invoke → rebuilt request, and a test pins that both paths answer identically for the same caller.


## Package access follow-up 2026-09-11

[Package spec§9](mangmee-package-entitlements-spec-th.md) and [AP17–AP24](../plans/mangmee-package-entitlements-plan-th.md) extend help-copy gating to historical model inputs, ACTIVErole projection, changed branch scopes, prepared/replayed context and final delivery. AX01/AX02 have bounded local repairs; AX03/AX04 source-history and send-time fences still need implementation/evidence. Default starter has7menus but AI may advertise only actions this actor can perform, not one tool per menu. Company services overview remains distinct from personal action authority; no feature/plan purchase opens Enterprise or SYSTEM50ทวิ. Earlier baseline measurements describe their original date, not current runtime or deployed status.

## Shared customer wording — 2026-10-03

The API receipt refusal and gateway feature-disabled answer reuse `LINE_FEATURE_DISABLED_HELP_TH` from contracts. They ask a permitted package manager to check the package or contact the team; they never promise that a shop owner/administrator can switch features on in the shop web app. Empty capability answers and API follow-ups reuse `LINE_CAPABILITY_NO_ACCESS_TH`: role permissions and enabled shop menus are separate checks, and a shop administrator is not a platform administrator. Curated jokes use Thai words rather than English episode/fandom shorthand.
