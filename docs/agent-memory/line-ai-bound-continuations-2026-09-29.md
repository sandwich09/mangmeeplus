# Agent Memory: LINE bound-chat continuations and queued photo delivery (2026-09-29)

Status: fixed on branch `claude/line-bound-continuations-20260929` (cut from develop 5963edac): checkpoint
5c75aeab, then a follow-up commit for the UAT 0ae7aac2 findings below. Not pushed or deployed by this task; the
owner merges it without a separate deploy (it rides with the sales/credit UAT release).
Owner: controller session (UAT/production release); this task: root cause and fix.
Scope: UAT main c4513ddd findings. In a bound (v2) chat the v2 route ran before the deterministic
continuations production a2b926c6 runs first: "1" or "ใบเสร็จค่ะ" answering the photo question became a
general question or a document-reading job, a check bill's "1" dead-ended, and draft answers and "แก้ยอดเป็น
500" reached the router without the open work production gave it. Task-choice buttons sent
`/task choose <id> <rev> <idx>`. The second of two photos sent back to back was drafted but never announced.
"ร่างค่าใช้จ่ายมีอะไรบ้าง ติดปัญหาอะไรไหม" answered "ยังดึงข้อมูลส่วนนี้ไม่ได้" after zero calls. The receipt reply
showed a raw web link with ids.

Decisions:
- Production order (owner: "ของเดิมดีอยู่แล้ว"). In a bound chat, text that answers open work by production's own
  matchers skips the v2 route (`answersOpenWork`): `splitPendingMediaReply`/`classifyPendingMediaReply`, the
  question recorded on the pending file (check bill, substitute scan confirm/pick, substitute class), and
  `isDeterministicLineExpenseDraftInput` with an open draft. The RECEIPT-05 block and the draft-control block
  then run as in a2b926c6; a fall-through is routed where production routed it, with full context.
- Everything else still routes first, now with production's context (open clarifications, recent captures,
  open drafts, substitute state). `loadOpenWorkContext` reads it once per turn; the handlers reuse it.
- A bound illustration answer ("2") keeps the accepted words for the route: v2 input evidence must match the
  routed text. The caption rides along as the open clarification's own text.
- Task-choice buttons send their own label ("ทำข้อ 2 ก่อน", "ทำรายการ 1 ต่อ"). The server maps the words back
  to the same waiting clause: the original clause index, or the position in the remaining list. The legacy
  `/task choose` command is still accepted. The same words with nothing waiting go to the normal route.
- A photo/file result is a durable delivery obligation, like a QA job: its plan's first-dispatch deadline is
  the plan expiry, not the 40 s foreground deadline. The late second photo failed `PLAN_INVALID_LIFETIME`
  in `buildLineDeliveryPlan` (13 ms, local). A refused reply token now pushes the same frozen batch in the
  same call, as production's E4 did, with no retry backoff for that case.
- The saved-receipt recovery reply no longer swallows its own failure: `delivery_failed` +
  `LINE_RECEIPT_RESULT_UNDELIVERED`, never `completed`. `safeLineErrorDetails` keeps a message that is exactly
  an internal UPPER_SNAKE code as `errorMessageCode`, and still drops every other message.
- A prepared read narrows to the four-slot lane, so a compiled fast lane that cannot serve the message
  falls back to planning with tools. Decode refuses the fast lane for problem/issue questions (ปัญหา,
  ผิดปกติ, ติดขัด, problem, issue).
- A lossless assistant text card is a complete presentation, so v2 plans send the card with the link on a
  button, as production did, with the text as fallback.

Follow-up (UAT 0ae7aac2, owner photos):
- Photo draft reply and a draft answer's reply were still plain text with a raw link: bound chats short-circuited
  `deliverCompletedReply(ies)` to text. Restored production's card (link on a button, completion menu); more than
  5 parts stay text.
- A draft answer routed EXPENSE_DRAFT_CONTINUATION with its one clause filed `general` (2 of 3 real runs) went
  to the pure-general answer. The gateway parser keeps that clause as the write when the offered open work
  (drafts / recent captures) exists; the API still validates it.
- "แก้ยอดเป็น 500" on a 1,070.00 draft: the router copies `from: "1,070.00"`; the stale check rejected the
  separator (production too: parseFloat gives 1). Separators are normalised before comparing.
- Owner photo B (table bill "Total 1,712.54" beside a QR slip): reader said ORDER_OR_CHECK_BILL (same prompt and
  rules as production); the check-bill question needs `Number(total) > 0` and the comma made it NaN, so the NR
  "send the final receipt" line went out. The question now parses separators and also fires on an amount signal.
- Owner photo C (clear IBERRY abbreviated tax invoice, paid by VISA): `isUtilityText` matched "Still water",
  `isCombinedUtilitySheet` matched "Tax Invoice"+"ใบเสร็จรับเงิน…", so the read became MULTI_DOCUMENT with every
  field dropped (identical in production a2b926c6, 3/3 runs). Utility words are now the ones a utility statement
  prints (ประปา, ค่าน้ำ (not ค่าน้ำมัน/ยา/แข็ง/ดื่ม…), ค่าไฟ, การไฟฟ้า / ไฟฟ้านครหลวง / ไฟฟ้าส่วนภูมิภาค, waterworks,
  water supply/bill…, electricity, kWh). Fuel (ค่าน้ำมัน) and appliance (เครื่องใช้ไฟฟ้า) receipts hit the same
  rule and are in the test; MWA, MEA, PEA and rental water/electricity statements still count as utility.
- Late TEXT plans no longer throw PLAN_INVALID_LIFETIME: a finished answer past its foreground deadline gets the
  plan lifetime as its first-dispatch window (production delivered late answers). QA keeps its job deadline.
- Latency: production also serialises photos per chat (serial media lane) and routes every photo with the
  intake router; the 20-35 s router image call is the same there. Not changed; options reported.
- The owner photos stay in the scratchpad: the whole-chain catalog keeps raw external images out of the repo.
  The tests use synthetic stand-ins that reproduce each trigger.

Open questions:
- Spec §4.2 says a late conversational answer should end with a bounded notice; this branch delivers the
  finished answer instead (production behaviour, owner ruling "cannot go silent"). The spec text needs updating.
- The two-slot `simple` lane remains in the budget authority, but the API no longer selects it.
- Web uploads use strict evidence v2 (LINE does not). In a probe with that flag both owner photos failed it 6/6
  (the model never returned fieldEvidence, even on repair), so the web path may reject the same photos. Not
  changed here.

Artifacts:
- Tests: bound continuation cases (photo "1" / "ใบเสร็จค่ะ", check bill "1", draft control, free-text draft
  answer with its draft, correction with its capture, side question beside a pending photo), task-choice words,
  two photos back to back, late photo plan, reply-token push, receipt card, prepared lane, decode guard,
  bound correction preview, and a PostgreSQL token-refusal case (skipped without the test database).

Verification:
- Every new case fails on develop 5963edac and passes here, except the side-question guard (passes on both).
- API typecheck and gateway typecheck pass. API test script passes. Whole-chain exit 0 (3287 TAP tests).
  W00 manifest regenerated (4/4). Pins current. `git diff --check` clean.
- Not run locally: `line-delivery-plan.pg.spec.ts` (needs the reliability test database).
- Follow-up commit: every new case fails on the 5c75aeab code and passes here (the quantity-only order guard
  passes on both). API test script exit 0 (10,520 passes, 0 failures), gateway suite 1508/1508, whole-chain exit 0
  (3293 TAP tests), dispatch spec 354/354, W00 manifest regenerated and verified 4/4, pins current, diff-check
  clean. Gateway typecheck passes; API typecheck passes with the native TypeScript 7 script (machine rule: the JS
  API typecheck is no longer run).
- Real model (Sonnet 4.6, LINE photo path, 3 runs per photo): Tamphun bill: production a2b926c6 2 generic clarify
  + 1 check-bill question; UAT main 3 "send the final receipt" dead ends; this branch 3 check-bill questions.
  IBERRY invoice: production 3 and UAT main 3 zero-field "more than one document"; this branch 3 drafts
  (IBERRY HOMEMADE, 1,529.00, VAT 100.03) sent as cards. Draft answer 3/3 updates the draft (1 model call);
  "แก้ยอดเป็น 500" on 1,070.00 gives the preview card with the confirm button.

Next: controller reviews and merges to develop and main; the fixes ride the bundled UAT release, not a deploy
of their own.
