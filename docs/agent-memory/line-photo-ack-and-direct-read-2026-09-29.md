# Agent Memory: line-photo-ack-and-direct-read-2026-09-29

Status: implemented on branch `claude/line-photo-ack-and-direct-read-20260929`; PR to develop open, not merged, not deployed.
Owner: thawatchai.phuchana (chose "ง + ค ตอนนี้ แล้วค่อย ก", 2026-09-29).
Scope: LINE photo latency after UAT 2026-09-29 ("ส่งรูปที่ 2 ต่อกันแล้วเงียบไป"). Two photos sent 0.15 s apart were answered at 51 s and 89 s; the intake router took 58 of the 89 s and the second photo was not acknowledged until the first was answered.
Decisions:
- D (acknowledge on arrival): one acknowledgement per media group, sent when the batch reaches the media lane, with a count for a burst. Every answer waits for it. Each photo read re-shows loading. A photo that fails is answered on its own, and the rest of the group is still read. The orphan sweep skips events the buffer still holds (`LineMessageBufferService.holds`).
- C (reader-only photos): a caption-less photo skips the intake router. The router is kept for:
  1. files;
  2. captioned photos;
  3. senders without capture permission;
  4. open substitute-receipt work (`lineIntakeRouterReason`).

  The reader admits the photo itself, so there is still one receipt-image count, and it carries `retryWebhookEventId` so a crash replay resumes. A reader-only check bill is treated as a reference, so its paid/unpaid question stays.
- A (pipeline the next photo) is deferred to a later PR, per the Owner.
Open questions:
- A caption-less non-document photo whose read comes back empty is now kept as a draft for the web form (§17.6). The router used to answer "not a document" for it.
- A caption-less signature photo sent with no signature request open is now read as a document instead of being filed as a signature.
- Router bug, not fixed here: `intent-router.agent.ts` parses `documentClassification` against empty text, so the one-pass receipt is almost never accepted.
Artifacts: buffer service + logic, `process-line-webhook.use-case.ts`, `ai-gateway.client.ts`, orphan sweep, specs (message buffering §10/§11.1, business-document image intake §10), W00 manifest.
Verification: see the PR body. It lists the specs run, the whole-chain acceptance run, the typecheck, the W00 manifest and pins.
Next: Owner UAT acceptance on a real two-photo and five-photo burst (count the acknowledgements, time to the last answer, no router `ai.usage` row). After that, option A.
