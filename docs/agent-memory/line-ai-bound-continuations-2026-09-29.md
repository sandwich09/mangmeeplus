# Agent Memory: LINE bound-chat continuations and queued photo delivery (2026-09-29)

Status: fixed on branch `claude/line-bound-continuations-20260929` (cut from develop 5963edac). Not pushed or
deployed by this task.
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

Open questions:
- Spec §4.2 says a late conversational (text) answer should end with a bounded notice. Late text plans still
  fail `PLAN_INVALID_LIFETIME`; this is now visible as `errorMessageCode`. Not changed here.
- The two-slot `simple` lane remains in the budget authority, but the API no longer selects it.

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

Next: controller builds UAT from the checkpoint; this task runs the real-model probes (bound chat, end to end)
and reports them.
