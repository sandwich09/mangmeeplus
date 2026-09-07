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

## Issue 3 — syntax-only shop contact email at signup

- Add a required `contactEmail` input labelled “อีเมลติดต่อร้าน” to the actual API-hosted LIFF new-shop form. Required is the working interpretation of the owner's request; an optional clarification was sent and any later owner answer supersedes it.
- Trim/normalize using the existing email conventions, bound to 254 characters, and validate email syntax on client and server. No mailbox, DNS/MX, verification message, password or email-provider requirement is introduced for opening the shop.
- Persist in existing `CompanySignupRequest.contactEmail`, bind into the request payload hash, and pass separately into `Company.email` in the existing onboarding company transaction. No schema addition is needed.
- This is contact data, not proof of account ownership. Do not write it through `claimedOwner.email`, set `User.email`/`emailVerifiedAt`, infer an identity attachment or merge accounts. A second shop keeps its LINE-proven owner and existing verified login email; another account may legitimately share the shop contact address.
- Preserve the contact through validation errors and idempotent provisioning retries. Old queued LINE applications with null contact email remain provisionable. A retry of an already-created company must not overwrite a contact later edited by an authorized user.
- The admin queue can display the contact, but must not claim that a LINE request's matching contact email will attach another account. Existing verified-account-email settings retain their distinct meaning.

## Issue 4 — failed receipt reading does not spend allowance

- Customer admission is provisional until the requested receipt extraction has a usable persisted result. Failed transport, empty/malformed provider output, unusable receipt fields and persistence/application failure must release that attempt's customer admission exactly once. A stored image alone is not a successful read.
- A usable saved result whose notification fails remains one successful read; resend/replay must not rerun OCR or business writes. Manual completion of an unreadable saved draft is not a new OCR charge.
- Separate explicit governance/refusal/duplicate outcomes from extraction errors. `OCR_EMPTY_OUTPUT` and `OCR_JSON_PARSE_FAILED` are failed extraction, not governance decisions merely because they share an `OCR_` prefix.
- Compensation must identify the exact admitted attempt, including its original month. A delayed release must not delete a newer admission for the same operation. Retain the existing lock/fence pattern; verify double compensation, concurrent admission, retry/re-admission and month-boundary behavior.
- LINE and web must agree on failure classification, retry eligibility, remaining quota and refund behavior. Preserve actual provider spending and independent abuse/operational brakes even when the customer's receipt allowance is released.
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
