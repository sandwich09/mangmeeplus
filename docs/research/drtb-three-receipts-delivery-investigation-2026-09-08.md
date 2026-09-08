# Drtb: three LINE receipts, one delivered reply

Status: cause reproduced against the deployed code; investigation only. No application/data change, OCR rerun, customer message, release or Production action.

## Scope and evidence

The owner reported three receipts sent to UAT Drtb and one reply, followed by an unhelpful completion answer. Scoped READ ONLY database queries, exact-event CloudWatch logs and a local invocation of the deployed parser establish the delivery cause. All three expenses and original attachment references exist and remain DRAFT.

Source `8e2af47a608d85fa663b11a931c3b90b057d83a8`; the four delivery/render/recovery files are identical to this deployed candidate. Private evidence is under `/tmp/mangmee-release-receipt-tax-20260908/`: `drtb-three-receipts-db.json`, `drtb-three/*-logs-correct-utc.json`, `drtb-three/reproduce-outcome.ts`, `drtb-three/outcome-reproduction.json`.

The image comparison uses the owner's previously attached Makro page3, fuel and Shichi photos with matching document numbers and amounts. Direct current S3-image reading was denied to the operator IAM user; the authenticated browser remains locked. Therefore this does not claim byte-for-byte comparison of the latest LINE attachments or a fresh browser journey. No policy/role was changed to obtain access.

## Timeline — Asia/Bangkok, 2026-09-08

| Receipt | Accepted | Expense saved | Reply result |
| --- | --- | --- | --- |
| Makro,15,532.00 | 20:38:03 | 20:38:56 | Accepted by LINE20:38:57 |
| Fuel,2,409.70 | 20:38:12 | 20:39:36 | Rejected internally before sending; replay parked20:42:00 |
| Shichi,1,600.00 | 20:38:23 | 20:40:17 | Rejected internally before sending; replay parked20:43:00 |

Follow-up20:44:28: “นานจัง เสร็จหรือยัง”. The answer at20:44:40 said processing was complete and to wait for a team to review before entering the real system. The exact turn/log shows `casual_conversation`/general, `sourceRefs=[]`, toolCallCount0 and no AiToolInvocation. It did not query current receipt or delivery status. Saved-draft existence happens to be true; the reply does not establish a three-receipt status check or an actual assigned review team.

Timestamp note: Prisma UTC `timestamp without time zone` must be preserved as raw timestamp text. The operator's pg default initially treated it as Asia/Bangkok and shifted JSON dates seven hours earlier. A second READ ONLY query with type1114 preserved verbatim, databaseTimeZoneUTC, and matching CloudWatch epoch timestamps establishes the timeline above. Earlier `*-logs.json` files queried the wrong time window and are not incident evidence; use `*-logs-correct-utc.json`.

## Proven delivery defect

1. `line-business-card.logic.ts:21-28,224` bounds preview text with `Array.from`, counting Unicode code points.
2. `line-reply.adapter.ts:43-55` validates durable Flex altText with JavaScript `.length`, counting UTF-16 units, against an internal400 limit.
3. The actual Makro preview is357 code points/359 units and passes. Fuel and Shichi previews are400 code points/**402 units** due to emojis and fail.
4. `process-line-webhook.use-case.ts:2711-2736` upserts the outcome, then reads it through that validator. It returnsnull even though the row was written. `sendMessages:2591-2595` marks `LINE_OUTCOME_NOT_RECORDED` and returns before `attemptDelivery`.
5. The sweeper uses the same validator before its representation-repair branch (`recover-orphan-line-events.use-case.ts:216-225`). It parks the two valid business results as `ORPHAN_OUTCOME_UNREADABLE`; deliveredAt remainsnull. No further replay is selected for that terminal state.

The production parser was invoked locally on the exact three persisted payloads: pass/fail/fail. Changing only the two altText strings in memory to fit the existing limit makes both pass. Nothing was sent to LINE and no stored payload was modified. This is not evidence of LINE rejecting the card, OCR failure, a one-receipt intake cap, or expired reply tokens causing this incident.

LINE currently documents UTF-16 counting and a1500 limit for Flex altText. Our400 limit is internal; provider and product bounds should be explicit and consistent. Sources: [character counting](https://developers.line.biz/en/docs/messaging-api/text-character-count/), [Flex reference](https://developers.line.biz/en/reference/messaging-api/#flex-message). The readable card body does not need shortening to repair this preview-only defect.

## Receipt accuracy

| Receipt | Financial comparison | Remaining issues |
| --- | --- | --- |
| Makro | Gross15,532.00, VAT955.27. Stored lines13,646.73+955.27 and930 sum exactly15,532.00. Printed345 discount is not deducted twice. | This is page3of3, with tax-group summaries rather than full item details. OCR description calls3 and135 tax codes/three items, but those figures are quantities; printed VAT codes are1 and2. Seller name is partly obscured and the inferred name must not be certified. Entity kind remainsnull. |
| Fuel | Gross2,409.70, VAT157.64, base2,252.06. Quantity61.488 and printed unit price39.19 retained; calculated rounding−0.01 reconciles multiplication2,409.71 to printed2,409.70. | Seller spelling needs checking against the photograph. Summary missingFields incorrectly includes vendor/document number/total/VAT although recognized and persisted values exist. Raw model VAT_EXCLUDED was reconciled to stored VAT_INCLUDED; preserve accepted values when rendering. The−0.01 is a calculated adjustment, not a printed additional fee. |
| Shichi | Six priced items total1,360.00; service136.00; VAT104.72; rounding−0.72; gross1,600.00. Eight financial lines and sumVAT match. | Seller spelling still needs close visual review. Recognized abbreviated-tax-invoice classification is displayed as generic “รอตรวจสอบ”, losing the specific known document type. TaxableAmount remains marked missing despite the reconciled financial structure. |

Dates from recognized facts match the supplied pages: Makro6Sep2026, fuel7Sep2026, Shichi6Sep2026. Stored seller tax-ID digits match readable numbers on those supplied reference photographs; this is transcription comparison, not registry/filing verification. No WHT is printed on these three reference pages. Buyer identity and input-tax entitlement have not been certified.

All three were counted once in receipt-ocr-line usage (trial reads6,7,8of15); they produced retained usable drafts. Replaying the missing summaries must not OCR again, create another expense or consume another read. No quota refund or policy change is implied by this investigation.

## Adjacent gaps and proposed repair boundaries

- Use one consistent Unicode-aware preview bound for build, validation, persistence and replay; verify long Thai/emoji messages at the actual boundary. Preserve the full card and canonical recovery text. The same business-card builder serves other results; dashboard-notification altText uses the same code-point bounding pattern and deserves targeted review.
- Validate the representation before writing it. If representation fails, recover a readable outcome from the existing canonical text/receipt, rather than classifying business facts as unreadable. The current error label says not recorded although a row exists, hiding the actual reason.
- Keep receipt persistence, delivery and accounting confirmation as distinct states. Associate the tenant and receipt before delivery: the two failed webhook/outcome records have companyIdnull and disappear from a company-filtered event lookup, despite the expense being tenant-owned. The exact-event lookup was necessary here.
- Ground “เสร็จหรือยัง” in permission-checked current receipt/delivery state for the relevant batch. Report how many were received/saved and which replies remain undelivered, with ordinary web actions; do not invent a review team or invite re-upload of retained images.
- Reconcile missing-field/provenance metadata with accepted fields, preserve weak category confidence rather than replacing it with router confidence, and separately verify legal identity and original item evidence. Do not alter the approved PANDA MALA form or revive a proactive LINE questionnaire.
- Retain per-chat ordering/idempotency and bounded admission. Logs show second/third media queue waits43.9/72.2seconds, which contribute latency but are not the delivery failure. Give batch-aware progress rather than promising every queued image will finish within one minute.
- Existing unreadable outcomes need explicit bounded recovery using the already saved facts and original recipient after a repair is reviewed. Do not rerun business capture to obtain another message.

## Verification and remaining work

- READ ONLY queries rolled back; no receipt status or payment changed.
- Actual parser reproduction and exact-event logs agree on the first-send and replay failures.
- Decimal sums of persisted financial rows equal each expense gross and VAT.
- Two UAT-only SSM sessions were closed and confirmedTerminated: `watchdog-bedrock-dev-pqx7p4h4gjiuvf95xy29zbsixi`20:46:50–20:53:07+07 and `watchdog-bedrock-dev-p6bc9l6gxqkibcgqd42tfq72ze`20:57:05–20:57:39+07; listener55432 absent. Shared-bastion alerts are not Production DB access.
- Await unlocked browser for direct latest-attachment visual comparison and field/Next validation. No runtime fix, deployment or user-message replay was performed. Production remains held.

## Follow-up implementation (owner authorized merge, no deployment)

The scoped repair and acceptance contract are in `docs/specs/drtb-receipt-delivery-integrity-2026-09-08.md`; implementation/verification evidence is in the task memory. Local replay of the exact three stored results now passes the strict reader with complete card contents unchanged. The fix covers delivery preview/recovery, tenant linkage, grounded multi-record status and false missing-field defaults. The original read-only investigation above is historical evidence; runtime data has not been repaired or replayed, and UAT/Production have not been deployed. Source identity spelling, complete page evidence, category confidence and document-label specificity are not certified by this delivery fix.
