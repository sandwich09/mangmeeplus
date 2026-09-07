# Agent Memory: LINE receipt UX and signup reapplication

Status: Implementation and mobile checks complete; exact-head CI pending before integration/deploy. UAT paused: all three services have one active configuration at capacity 0/0, verified 2026-09-07T17:41:12Z. Production HOLD.
Owner: Root controller, following owner 2026-09-08 Bangkok.
Scope: Receipt theme/raw-code/verbosity/passive collection and reconciliation gaps; rejected application can reapply through manual review; working support path; deploy UAT only after checks.
Decisions: Sending a receipt never solicits chat completion. User-initiated edits remain supported; necessary questions grouped once. Rejection is request history, not a permanent signup ban. A new request after prior rejection must be manual even with a changed email. Preserve account restrictions, trial rules, tenant boundaries and original evidence. Mail activation/subscriptions deferred.
Open questions: None for the approved fixes. Exact LIFF sendMessages device failure/scope was not retained by current code; fix must not depend on that capability. Actual expense row could not be viewed with the system-admin browser lacking tenant membership; no bypass attempted.
Artifacts: `docs/specs/line-receipt-ux-signup-reapply-spec.md`; corresponding plan; prior release ledger. Branch `codex/line-receipt-ux-signup-reapply-20260908` from origin/develop `1c905ff0012aef90ca2c39c8cbfa55241fb4f81f`; main `d6c1ab2487c3438bebeb0f9d0ed0a46b0db1b41b`.
Verification: Pre-fix diagnostic fixtures reproduce leaked codes, absent document total, false I01 review/category from reconciliation shape mismatch, hidden questions in the dedicated Flex card, and rejected-state reapplication dead end. Existing receipt domain suites pass 20/20 despite these UX defects. Implementation evidence is recorded below.
Next: Finish checks, integrate develop/main using exact successful PR CI, restore and deploy UAT. Never dispatch Production while held.

## Prior release safely stopped

- Faulty UAT candidate `42ddc2dce45f094acceab885e299e8d3caeed3ac`, UAT run `34144694046` SUCCESS.
- Automatic READY `34146487267` SUCCESS, maintenance_closed only. Archive artifact `10028383820`, digest `sha256:60e4aaaecc158c6bb920400761940f04dd25f0946f464763e890134a05f26b21`.
- Cosign identity/repository/controller/trigger and canonical READY validator PASS. Content SHA `21173d5aa51227cffa8a07528b86e4675c849f4b3b10bc0d7220f068881bb9fb`. Two migrations rehearsed; signed clone infrastructure cleanup residualResourceCount=0. No Production/live READY dispatched.
- Owner requested UAT shut down during fixes. Three exact UAT Express services accepted capacity 0/0 updates at 2026-09-07T17:36:18Z. Images/env/secrets preserved through exact round trip; only scaling min/max changed. Private 0600 temporary AWS payloads self-deleted. Initial /dev/stdin CLI attempt failed local JSON parsing before an AWS mutation; corrected transport then succeeded, no duplicate deployment run.
- Temporary evidence: `/tmp/mangmee-release-receipt-signup-20260907/auto-ready/`, `uat-pause-20260908.json`; prior signed Passport retained in same root.

## Investigation evidence to preserve

- `/tmp/line-receipt-ux-audit-20260908.ts` and `.json`: isolated executable current-code fixture; no product mutation. Fractional quantity 0.63 / 243.75, stored unit386.9048, nested reconciliation status reproduces questions D-PURPOSE/I01-REVIEW/I01-CATEGORY. Expected-reader-shape fixture binds the original row and only purpose remains. Runtime formatter leaks internal expense/account/question IDs; printed 300 total/discount/VAT absent. Dedicated card hides collection questions when canonical text fits body.
- `/tmp/line-signup-ux-audit-20260908.ts` and `.json`: executes actual renderer with isolated DOM. REJECTED + eligible company hides form/add-shop/company entry and exposes only support. No request + same company allows entry/add-shop.
- `/tmp/line-receipt-ux-existing-tests-20260908.log`: two domain suites, 20 pass/0 fail/0 skip.
- Read-only UAT admin queue: old rejected LINE request `ร้านใหม่`, display name `sandwich ;)`, 2026-09-06 15:45 Bangkok; no email stored in that legacy row. Current device request identity not captured, so association is consistent evidence, not token-bound proof.
- Official LINE source for unavailable sendMessages: https://developers.line.biz/en/reference/liff/#send-messages. It requires correct chat launch context and chat_message.write; current client catches the provider error and loses its classification.

- Stable UAT pause readback: `/tmp/mangmee-release-receipt-signup-20260907/uat-paused-readback-20260908.json`; three singleton configurations at min/max 0/0. No Production change.

## Implementation and verification (pre-PR)

- Photo capture/recovery now uses concise shared Flex: printed total, seller/date and material warnings; neutral action; durable source state starts PAUSED. Explicit edits use Thai text without identifiers/account keys; accepted changes do not solicit other work; unrelated turns silently park active work. Source-line binding reads the actual nested reconciliation shape.
- Rejection history is checked from verified LINE/channel before AUTO_FREE and again inside the automatic claim transaction. Audit/admin queue retain prior request reference; deliberate reapply uses a new key, ordinary retries keep their original key. Existing account/trial/permission checks stay in place.
- Token-verified LIFF support ingress creates/reuses the existing inbox and idempotent notification. Both webhook and LIFF creation serialize on the same person lock; retries do not duplicate or consume another slot. No real LINE/customer message sent by tools.
- Complete canonical fallback is retained with durable messages, stripped from provider payload, and follows the same handoff URL without minting a second link. Existing multipart/Flex fallback switches now flow through deploy.sh and UAT/Prod workflows; both default true outside maintenance. No new flag, dependency, package manifest, migration or mail activation.
- Shared theme uses existing dark green/white heading with 16px prose. Browser screenshots inspected at 390px: old-shop access, สมัครใหม่, support and close are visible, no request identifiers.
- Focused code checks: 367/367 then combined 509 (508 pass, one old bright-green assertion updated); final rerun pending. PostgreSQL signup/support plus webhook 118/118, no skips; source-draft PG 11/11, no skips. Rejection → new email → manual → actual admin approval → one shop verified, old request preserved.
- Whole workspace typecheck PASS after regenerating stale local Prisma and building current contracts. Initial default 4GB TypeScript attempt exhausted memory; canonical workspace check uses the configured 8GB API task and passes.
- Real API-served LIFF browser suite 7/7 PASS (53.1s); SDK and signup/support identity/response boundaries are mocked, PG persistence verified separately. No outbound messages. Screenshot paths under test-results/line-signup-contact-email--*/rejected-reapply-*-390.png. Generated next-env.d.ts restored; no package changes.
- Shared serving-mode shell contract PASS; release enforcement pins regenerated for reviewed runtime flag wiring. Full workspace tests in progress; final source check and CI still required. UAT remains 0/0 throughout checks.

- Final receipt orchestration/theme regression group PASS310/310. Full workspace tests exposed old human-copy assertions and an AUTO_FREE fake that returned a current VALIDATED request as prior REJECTED history; corrected the fake's actual predicates. Focused sibling integration PASS264/264 afterwards. No production auto-approval guard was weakened to accommodate a fake.
- Receipt source PG PASS11/11; signup/support/webhook PG group PASS118/118. Local UI screenshots retained in `docs/qa/evidence/line-receipt-ux-signup-reapply-2026-09-08/` and visually reviewed. Final whole-workspace CI still required before merging.
- Final review preserves the distinction between a printed receipt amount and an unconfirmed saved draft. An extracted but unverified date now says it awaits review rather than incorrectly claiming it was unread. A newly added receipt fixture lacked the required evidenceSignal; the fixture was corrected before the final typecheck. Whole-workspace local reruns are `/tmp/line-ux-typecheck-complete.log` and `/tmp/line-ux-tests-complete.log`; record terminal results before merge. Release pins check PASS, exactFiles45, validator SHA256 `017455a75e9ef9c87c7d24e75bf809bd1b4acd160d77f54ace6d84a95260b4ec`.
