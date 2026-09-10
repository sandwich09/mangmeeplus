# Agent Memory: Receipt follow-up release 2026-09-10

Status: correcting the CI catalog before dispatch; original exact CI failed without any deployment.
Owner: Codex
Scope: deploy merged PRs #506/#507 receipt removal, source edit/signing refresh, yellow AI warning and payment-month substitute numbering to UAT then Production live.
Decisions:
- Reuse successful exact-head PR CI and immutable UAT images; no duplicate deploy, no app or config change. No migration/controller delta.
- Existing explicit owner LIVE override persists. Owner reconfirmed urgency and current Production login.
- Candidate `d9212aa38eb7fc0256add2d8f448105d7656318b`; controller `93b29a7e6ca0d01ea655b9381c8e143ab2a00e7d`. Freeze through final customer acceptance.
- Preserve dirty original checkout and unrelated local work; isolated detached release checkout.
Open questions: none.
Artifacts: `/tmp/mangmee-receipt-followup-evidence-20260910/release-ledger.json` (exact IDs and signed evidence).
Verification:
- Source ancestor of main/develop; candidate/controller CI and UAT workflow blobs identical.
- Existing selected-tree focused API 100/web 37 and browser evidence reviewed. Automatic full CI still running; no redundant suite dispatch.
- AWS account/profile verified; configuration readback pending.
Next: exact CI success → single UAT all dispatch → changed-journey UAT acceptance → terminal auto READY → live READY → Production → signed result/config/customer OPEN/logout acceptance.

CI correction:
- Both PR CI runs 34442624025/34442634870 failed the same spec-suite coverage assertion: remove-expense-receipt.use-case.spec.ts was not registered in any owned runner.
- Add its existing file to the API suite in the executable whole-chain catalog. CI already invokes this harness after pnpm test. Do not exempt the guard or edit package.json.
- Focused catalog contract 4/4 and spec wiring/removal tests 22/22 passed locally (see evidence logs for exact counts). No runtime code change.
- Direct incident path considered for owner 20-minute target: only historical Production V1 offers partial incident input and still builds/tests; canonical V2 requires Passport/READY and all-service acceptance. No supported sub-20-minute complete release established; no legacy workflow dispatched.
