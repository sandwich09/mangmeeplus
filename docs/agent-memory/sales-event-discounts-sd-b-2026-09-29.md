# Agent Memory: sales-event discounts SD-B (claim through LINE)

Status: implemented on branch `claude/sales-event-sd-b-20260929` (worktree `/private/tmp/mangmee-sales-event-sd-b-20260929`), not pushed. Built on the SD-A checkpoint `e7ab6a4a`.
Owner: controller session (2026-09-29, deadline 17:00 Bangkok).
Scope: plan SD-B with the controller's 2026-09-29 decisions. The customer scans the QR, the LIFF page claims a ticket, and the ticket view route (`GET …/billing/event-discount`) lets a locked shop read it. There is no gate; a ticket exists only when sales created a batch. The credit path is SD-F and the billing purchase choice is SD-C/SD-D.

Decisions:
- `apps/api/src/modules/sales-console/domain/sales-event-claim.logic.ts` is shared with SD-A. It holds the QR token (43-char base64url, sha256 hex stored), the LIFF link `/event-discount?t=`, the 8-char serial, expiry = claim end + 30 days, the refusal order and the display state.
- The claim runs in one transaction under `SELECT … FOR UPDATE` on the batch row. It checks for a replay by (batch, LINE holder) BEFORE any refusal, so a rescan or a retry after the QR expired returns the same ticket. Then it checks OPEN plus window, active distributor plus ACTIVE SalesAgentProfile, and the cap. It inserts, adds 1 to `issuedCount` (never `version`) and writes the audit `sales.event.ticket_claimed` with no LINE ids.
- The platform tenant is refused before the QR is read (`SALES_EVENT_SELF_CLAIM`, 403). Other refusals are 409 and reuse SD-A's codes. `SALES_EVENT_QR_EXPIRED` also covers unknown tokens. **Superseded 2026-09-29 (SD-O11):** the code is now `SALES_EVENT_QR_INVALID` ("QR นี้ใช้ไม่ได้") and only means "unknown token"; a QR has no clock of its own — the claim judges the batch at scan time (state, current window, seller active).
- Rate limit: per LINE account, 30 per hour, charged after the ID token verifies. There is no per-IP bucket, because a booth shares one venue Wi-Fi.
- Holder view: `{ path, tickets[] }`. A ticket carries a display `state` and `batchSuspended`, and matches through ACTIVE LINE identities of the caller only. SD-C and SD-F add `discount` and `credit` as additive fields.
- The billing page gets no box in SD-B (controller decision): checkout cannot apply the discount before SD-C.

Open questions: none from SD-B. Release note: SD-B must not reach customers before SD-C/SD-D. The LIFF page says "ลด X บาทจากบิลแรกเมื่อซื้อแพ็กเกจ", and checkout ignores the discount until SD-C lands.

Artifacts: claim use-case + public controller (`POST /v1/public/event-discounts/claim`), LIFF page `GET /v1/auth/line/link-page/event-discount` (`LIFF_EVENT_DISCOUNT_PAGE` + mode `event-discount` in `LIFF_PAGE_SCRIPT`), `billing-event-discount.ts` + `BillingService.eventDiscount`, auth-guard allowlist `/event-discount` (pins synced), contracts `SalesEventClaimBody/Result`, `BillingEventDiscountView/Ticket`, two error codes with Thai text.

Verification (2026-09-29 14:25, worktree above):
- Native typecheck through the coordinator's serialized script: API rc=0, web rc=0.
- Focused API specs: 174/174. These are the claim logic (9), the claim use-case (7), the LIFF page (11), the holder view (3) and auth.guard (39), plus the existing LIFF, signup, spec-suite coverage, body-validation and W00 manifest specs.
- Web specs: 116/116 (error text, coverage, sales console).
- `claim-event-discount.pg.spec.ts` against a fresh DB with all migrations: 3/3 (cap-1 race, same-person race, platform tenant + removed เซลล์).
- Pins `--check`, both pin shell specs, check-di-metadata and `git diff --check`: clean.
- Not run by rule (coordinator 2026-09-29): the full API/web suites, test:boot and the whole-chain run. The coordinator runs them once on the integrated branch.
Next: SD-C fills `discount` (offers, reason) in the view and reserves and uses the ticket. SD-D adds the billing-page UI. SD-F adds `credit`.
