# New-shop onboarding, trial allowance and receipt failures

Status: Owner-requested implementation, 2026-09-07. Scope is the five issues reported after receipt remediation #473/#474. Runtime deployment is a separate step.

Sources: [LINE-first signup](mangmee-line-first-signup-spec-th.md), [external signup](mangmee-external-signup-contract-spec-th.md), [receipt reliability](receipt-reliability-and-draft-continuity-spec.md), company profile and OCR governance code. These owner amendments override the older no-email-at-LINE-signup and first-week-ten rules where they conflict.

## Product outcome

A shop owner can open a shop and send the first receipt immediately. Filling tax identity, shop address or backup login details is a non-blocking follow-up. The trial advertises and grants the same 15-receipt monthly allowance from day one. A failed receipt read does not consume the customer allowance. A clear dashboard action opens the existing profile settings form.

The implementation follows the same authorized workflow as the previous round: isolated branch, spec/plan, GPT-6 Astra and GPT-5.6 Sol at xhigh by difficulty, coordinator integration review, tests, commit/push and reviewed admin merges to develop/main. This specification does not dispatch a release or write live customer data.

## Issue 1 — first receipt before optional settings

- Verify the actual signup/provisioning → active company/member/LINE identity → permissions/AI configuration → receipt pipeline. Missing tax identity, address, recovery email or password must not prevent ordinary receipt capture/OCR.
- Preserve the #473/#474 fix for printed zero-priced items and truthful saved results. That code is merged but has not been deployed by this task; do not describe its production behavior as already fixed.
- Add a meaningful first-shop regression through existing signup/onboarding and receipt seams. Distinguish a first-use readiness defect from an independent provider failure. Do not bypass tenant, branch, membership, legal, account status, quota, abuse or final financial checks.

## Issue 2 — 15 from the first day, consistent numbers

- Keep `FREE_TRIAL_15` and its shared preset as the source of the default 15. Trial term duration and existing Bangkok calendar-month usage window remain unchanged.
- For this trial tier, derive the commercial limit from the term's `monthlySlipLimit` immediately. A persisted first-week `warmupSlipLimit=10` must no longer reduce a normal 15 trial. Explicit admin monthly limits remain authoritative; non-trial policies and separate operator/AI-spend safeguards remain distinct.
- Align new provisioning, config/deploy defaults, LINE messages, LIFF/web signup copy and quota readouts. Do not replace a truthful enforced ten with a hardcoded displayed fifteen.
- Count the relevant receipt/image route events consistently for the commercial receipt allowance; bank-statement extraction must not consume it indirectly through the all-route aggregate. Reuse the existing indexed usage-event ledger and admission lock; retain the aggregate for the operational OCR ceiling. Keep successful general-image behavior unchanged unless a specific receipt failure is established.
- Existing trial rows must receive the corrected effective policy without guessing edits to customer usage or overriding custom administrator limits.

## Issue 3 — owner email with the same immediate LINE-first flow

Owner clarification after initial implementation: this is the shop owner's email and should be usable for the owner account. Signup must remain “fill details/email → open shop → use immediately”; no password setup or delivered email verification at signup. This amendment replaces the earlier contact-only interpretation.

- Add required email to the actual API-hosted LIFF new-shop form. Trim/normalize, bound to 254 characters and validate syntax on client/server. Do not require DNS/MX, mailbox delivery, a password or SES to open the shop.
- Preserve contact in CompanySignupRequest.contactEmail and Company.email and bind it into the request payload hash. Also assign an available address to a new or LINE-proven existing owner's empty User.email, with emailVerifiedAt remaining null. It is a login identifier, not verified mailbox ownership; use a separate unverified-owner input, never the verified claimedOwner.email branch.
- Existing owner account email must be preserved when opening another shop. A contact address owned by another account must never cause attach/merge/overwrite. Owner clarification: an email already used before is a manual-review gate, because it may identify the same shop. Accept the application and put it in PENDING_REVIEW; do not AUTO_FREE provision it. After actual admin approval, preserve the proven LINE identity and existing email ownership as specified. Concurrent conflicts and an already-created-company provisioning retry must follow the same rule without overwriting later authorized account/contact edits.
- The account screen must accurately show an unverified account email even while email delivery is disabled. Once an account has an email login identifier, the existing optional initial-password screen must not demand a separate username. Email+password login becomes possible only after the owner chooses to set a password; LINE login and first receipt remain available immediately.
- An authenticated LINE-linked owner must be able to correct an unverified account email in the account settings without SES; require the current password once a credential exists. Preserve verified-email changes through the existing verification flow, reject collisions without attaching accounts, revoke stale pending email verification when changing the unverified address, and keep source/account truth visible. This closes the valid-pattern typo trap introduced by using the field as a login identifier.
- Optional email/password users must also be able to request the existing LINE-delivered recovery password by their account email, with the same generic response, normalization/rate limits, active credential/membership checks and exact linked-LINE destination. This does not enable unverified mailbox recovery or issue a password to a new password-free signup.
- Keep actual email verification, mailbox password reset and account merge proofs unchanged. Do not invent emailVerifiedAt or send any message. A same-looking shop contact must not be shown as proof of another account's identity in the admin queue.
- Old queued LINE applications with null contact remain provisionable. Test new/attached owners, existing email preservation, shared/duplicate contacts, concurrency and committed-company retry.

### Duplicate owner email — manual review before opening another shop

Owner clarification after PR #475 creation: an existing email may belong to the same shop, so repeated email must go to the existing approval queue and must never bypass it through AUTO_FREE. This supersedes the initial automatic duplicate-contact continuation policy.

- Compare normalized exact email against existing User account emails (including a legacy email-shaped username equal to that address), Company contact emails and other persisted signup applications. Include historical records so changing LINE or closing a shop does not reset this signal. Exclude the current application; preserve existing same-request/open-application replay behavior. Email is a review signal, never ownership proof.
- A duplicate application remains accepted as PENDING_REVIEW, consumes no AUTO_FREE cap slot and creates no shop/trial/credential until an authorized admin explicitly approves. Existing repeat-LINE and daily-cap/actor fallbacks remain.
- First-time email continues the immediate password-free LINE flow. Concurrent submissions with the same new address must never both auto-provision: preserve committed request evidence and test the actual two-client race. Conservative manual review is acceptable when both applications arrive together.
- Record the manual-review reason without writing email addresses into logs. The admin queue must identify “อีเมลเคยใช้แล้ว — ตรวจร้านเดิมก่อนอนุมัติ” (or equivalent plain Thai), not claim automatic identity attachment. Owner-facing status must truthfully show waiting for review and must not present an active-shop action before provisioning.
- Approval still uses the existing controlled admin path; no automatic linking, merging or overwriting account email. Rejected/stale/replayed requests must not re-enter AUTO_FREE accidentally.

## Issue 4 — failed receipt reading does not spend allowance

- Customer admission is provisional until the requested receipt extraction has a usable persisted result. Failed transport, empty/malformed provider output, unusable receipt fields and persistence/application failure must release that attempt's customer admission exactly once. A stored image alone is not a successful read.
- A usable saved result whose notification fails remains one successful read; resend/replay must not rerun OCR or business writes. Manual completion of an unreadable saved draft is not a new OCR charge.
- The web review's explicit re-read must also survive a lost HTTP response: retain the attempt request ID while its outcome is unknown, reload the saved result and recover only a successful OCR summary correlated to that request. An old/failed/non-receipt summary is not proof that this attempt succeeded. Apply the same proof to upload recovery. A deliberate later re-read after a known result may start a new attempt; changing company/expense/source must not reuse an unrelated attempt.
- Separate explicit governance/refusal/duplicate outcomes from extraction errors. `OCR_EMPTY_OUTPUT` and `OCR_JSON_PARSE_FAILED` are failed extraction, not governance decisions merely because they share an `OCR_` prefix.
- Compensation must identify the exact admitted attempt, including its original month. A delayed release must not delete a newer admission for the same operation. Retain the existing lock/fence pattern; verify double compensation, concurrent admission, retry/re-admission and month-boundary behavior.
- Reclaiming an orphaned LINE execution must rotate its admission identity while retaining the original month and aggregate charge; the old execution's delayed compensation cannot remove that resumed execution.
- LINE and web must agree on failure classification, retry eligibility, remaining quota and refund behavior. Preserve actual provider spending and independent abuse/operational brakes even when the customer's receipt allowance is released. Keep the existing OCR compensation semantics: delete the exact admitted event and decrement its monthly OCR aggregate once; the operational OCR ceiling remains enforced on retained admissions. Do not introduce a second failure-spend counter or change the separate AI cost ledger. Unknown transport cost is not proof of zero cost.
- No blanket refund of successful non-receipt AI work, no reset of customer counters and no inferred historical quota repair. Record any old-data repair that cannot be proven from durable evidence as a separate rollout item.

## Issue 5 — obvious profile completion actions

- Keep the card non-blocking and use the existing settings route/section anchors.
- Show two obvious controls: left “ไว้ก่อน”, right “กรอกข้อมูลให้ครบ”. Use larger bold text, visible button boundaries and existing theme patterns, with comfortable touch targets and keyboard focus.
- The right action opens the current company's actual profile form directly (shop/account section according to missing facts); it must not send the user to a generic settings directory or another company.
- Preserve the existing seven-day snooze, company isolation and sidebar/settings reminders. Keep missing facts visible together and refresh completion after a successful settings save.
- Verify 390px/mobile and desktop layout, no clipped CTA/horizontal overflow, actual navigation, save/reload and snooze behavior. Do not invent unrelated onboarding steps or make settings a receipt gate.

## Acceptance and rollout boundary

Permanent regressions must cover: new-shop first receipt without optional settings; real effective 15 for new and legacy warmup-ten trials; admin/non-trial boundaries; LINE/web displayed/count parity; bank-route isolation; empty/malformed/missing provider fields; post-provider apply failure; exactly-once compensation versus notification-only failure; retry and stale compensation; valid/invalid signup email; new/attached user identity safety; signup retry/contact preservation; and mobile/desktop CTA navigation/snooze.

The next deployment must also carry the owner's previously recorded `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true` and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true` in UAT and Production. Verify environment wiring and actual running values, test UAT before promotion, then follow the mandatory signed UAT/READY/Production and customer OPEN acceptance protocol. No new feature flag is needed for these five fixes.
