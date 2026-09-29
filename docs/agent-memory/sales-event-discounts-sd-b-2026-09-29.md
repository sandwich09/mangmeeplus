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

## Follow-up 2026-09-29: Owner UAT findings on the claim page

Branch: `claude/event-discount-claim-page-20260929`, worktree `/private/tmp/mangmee-sd-liff-20260929`, base develop `9499acb4`. PR opened against develop; not merged.

Decisions:
- Stale script. The origin already sent `no-cache` on `/v1/auth/line/link-page.js`. The UAT probe on 2026-09-29 showed Cloudflare edge-caches the `.js` (`MISS` then `EXPIRED`) and rewrites `no-cache` to `max-age=14400` for the browser. A long `public, max-age=31536000, immutable` (from `/_next/static`) and a `private, no-store` (from a 404 `.js`) pass through unchanged. The fix: pages reference `?v=<sha256(LIFF_PAGE_SCRIPT)[:12]>`, computed at load. The route answers `immutable` only for the matching `v` and `PRIVATE_NO_STORE` for anything else. The CSP is unchanged: a same-origin URL with a query is still `'self'`. The script is the only same-origin LIFF asset; the LINE SDK is LINE's. No release pin covers the touched files.
- One tap. After a claim with `next: OPEN_PACKAGE`, `prepareMangmee('', true)` calls `startSession` with no gesture. `#open-mangmee` is the single button: a fresh link (under 10 min; the server TTL is 15) opens inside the tap. Otherwise the tap prepares and the next tap opens, the old path. `#open-web` is gone from the event page. On the event page, `startSession` skips the second `liff.init` and the "กำลังเปิดหน้าเว็บ" status, so the ticket does not jump. With several shops, the list shows immediately; a shop tap prepares and "เปิดมั่งมี" opens (2 taps). One handoff cannot land on the web's shop chooser, because a token is bound to one company (`isSafeHandoffPath`).
- Landing. `POST /auth/line/liff/session` takes `landing: 'package'` (`@IsIn`, a name not a path). The use case lands any shop's plan manager (`canManagePlan`) on `/companies/{id}/billing?channel=line` and returns `packagePage: true`. Non-managers keep the overview; locked shops keep R-C3.
- Wording. The LIFF shows "ส่วนลด {X} บาท ใช้ตอนจ่ายค่าแพ็กเกจ" with the note "เลือกใช้หรือไม่ใช้ได้ตอนจ่าย · งานเดียวกันใช้ได้ร้านละครั้ง", and no credit line even when the ticket carries credit. The console `batchRewardLines` shows the discount only; the form never had credit inputs on develop. The server and the web form require a discount > 0: `SALES_EVENT_REWARD_REQUIRED` "ใส่ส่วนลดมากกว่า 0 บาท". Credit columns and stored values are untouched, and edits carry them through.

Residuals: the start and signup pages also auto-prepare links with no staleness check (out of scope). The batch page still counts "ใช้เป็นเครดิต" (a redemption count, always 0 until SD-F).

Verification (2026-09-29 17:18, worktree above, before merging develop):
- Native typecheck (`api-typecheck.sh … both`): API rc=0, web rc=0.
- Focused API specs:
  - LIFF event page: 18/18.
  - Start-handoff, contrast, `line-liff-signup` (including the landing tests) and `sales-event.logic`: 112/112.
  - `presentation/auth.controller.spec`: 20/20.
  - W00 manifest: 4/4, no drift.
- Web: `sales-events.logic`, `sales-console.logic` and `sales-console.qa`: 120/120.
- `check-di-metadata`: clean. `git diff --check`: clean.
- Whole-chain acceptance: EXIT 0, 3416/3416, `line_ai_repository_acceptance_complete`.
- Not run: the `sales-event-discounts.pg.spec` real-Postgres spec. Its only reward case (all zero) still holds.
- After a plain merge of develop `12b28fc4` (#887, no conflicts) and a contracts rebuild:
  - Typecheck: API rc=0, web rc=0.
  - Focused API specs: 154/154. Web specs: 120/120.

Next: Owner re-checks on UAT after the release. Check the phone gets the `?v=` script, one tap on เปิดมั่งมี, and a plan manager landing on แพ็กเกจและการชำระเงิน.
