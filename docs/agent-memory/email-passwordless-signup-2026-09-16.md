# Agent Memory: email-passwordless-signup-2026-09-16

Status: SOURCE DELIVERY COMPLETE — E0–E5 complete; PR583/584 admin-merged after required CI passed. Final documentation publication/heartbeat closure is recorded below.
Owner: Codex / repository owner
Scope: Email-first signup and returning email OTP login; existing-account explicit opt-in; source-aware admission/admin and shared LINE cap; BFF/UI/tests. No deploy/live sends.
Decisions: 6-digit OTP using Postmark, reuse existing policy durations and delivery. Do not treat account-email verification as login. Keep old password/claim paths. New email accounts enable email login; existing accounts require verified email and fresh reauthentication to opt in. Shared cap/duplicate review with LINE.
Open questions: None blocking first implementation; conservative existing policy reused, no additional auto grants.
Artifacts: docs/specs/unified-easy-signup-spec-th.md; docs/plans/unified-easy-signup-plan-th.md
Verification: Checkpoint: local API unit suite and API/web typechecks pass; web1732/1732; public email-access PostgreSQL16/16; legacy account-email/billing-recipient PostgreSQL22/22; marketing5/5. Real Nest+Next+Chromium+PG browser six groups pass with simulated Postmark, including new/returning signup, current legal gate, real receipt upload screen, actual marketing CTA, real admin UI approval and crash after company commit→retry same trial. Logs /tmp/email-passwordless-*.log; screenshots /tmp/email-passwordless-browser. Safe next-path follow-up passes. Billing plan-adjustment23 and full256 HTTP/PG groups pass; final admin API68/web60, maintenance validator/tamper and Postmark config tests PASS; exact evidence in docs/evidence/email-passwordless-signup-2026-09-16.md.
Next: Publish this documentation-only delivery record to both branches after its lightweight CI. Pause ci-merge heartbeat after verifying final delivery. No deployment/native sending; no further source CI rerun required.

Marketing completed: PR4→develop d8c25e86 (CI35048055608 PASS), PR5→main d5c141ec (CI35048182393 PASS). No deployment.

Isolated worktree: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-email-passwordless, branch codex/email-passwordless-signup-20260916, base7ef09d8e. Parent optional-email worktree is concurrent and left untouched. Billing already admin-merged; this branch depends on optional-email source and must be integrated/verified before merge.

Remote candidate:44f3ff7c3e0d5c864b56ec87db2196c94a01dc97, PR583 to develop, CI35049514012 running. No merge/deploy yet for core. Preserve this exact candidate while CI runs; this local progress note is not a new CI request.

Main promotion: PR584, head23acbd1f19a7c2ee3d7ff8315f8d076db25e59ef, CI35049794245 running. Promotion worktree /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-email-passwordless-main; branch codex/email-passwordless-main-promotion-20260916. Feature and promotion Git trees both a190b1ff3fec69378d84ec0c7d0ec397f73bc685. Merge develop before main only after all exact-head checks are green and current base merge-tree is verified.

Continuation: attached heartbeat automation ci-merge ACTIVE every10 minutes, same task. It must remain quiet on unchanged checks, handle scoped failures locally before any new CI, report meaningful progress/completion, then pause itself after both merges. No deployment/native send/payment. This local checkpoint deliberately does not change the already-running CI candidate.

User status check: prerequisite PR575 merged dc574682 and PR582 merged3e922b64 after CI35047624780/35047869532 SUCCESS. Their documentation follow-ups PR585/586 also landed. Candidate PR583/584 are still running original CI (no failed steps), currently at full billing HTTP/PostgreSQL. Fresh merge-tree is clean for both targets and yields bcabfc01d241f953ae7e3207bf4af8d486dbab8a; difference from validated candidate tree is ONLY four prerequisite completion documents (memory/evidence/plan/spec),33 insertions6 deletions. Runtime/source bytes remain identical; preserve these docs at merge and recheck latest targets then. No new CI was dispatched.

CI failure investigation: main CI35049794245 attempt1 failed in billing APPLY_RETRY browser navigation with a Next404 after clicking the existing invoice-rights list link; email signup5 browser groups and preceding private OTP/reset all passed. Develop CI35049514012 on the identical Git tree passed that complete browser step at03:33:14UTC and continues later suites. Local exact-source focused APPLY_RETRY passed16 groups. Then replayed all7 browser commands in CI order with a fresh NEXT_DIST_DIR=.next-ci-passwordless-repro: groups8/7/10/5/7/16/67, exit0 (/tmp/email-passwordless-ci-sequence.log). App routes and guards inspected; no source change justified or root cause proven. CI had no retained Next logs. Do not claim a product bug fixed. Generated next-env.d.ts was restored. Wait for develop's remaining tests before considering one failed-job-only retry of main on its unchanged head; do not blindly rerun all jobs.

2026-09-16 03:54UTC: Develop CI35049514012 attempt1 SUCCESS on exact44f3ff7c (all required jobs; publication skipped). After the completed7-suite local replay and identical-tree check, dispatched ONE failed-job-only retry of main CI35049794245 using gh run rerun --failed, same23acbd1f source. No source patch or new candidate/CI run was created. Await attempt2 before main acceptance; do not dispatch duplicate retries. Both PRs remain unmerged for now. If attempt2 repeats the404 or reveals another failure, investigate with new evidence rather than another blind rerun.

2026-09-16 04:47UTC: Main CI35049794245 attempt2 passed the entire signup/billing browser step, including the previously failing admin invoice navigation. No failed steps; running later configuration/recovery suites. No source changes or further reruns. Await complete CI before merge.

## ส่งมอบ source หลัง CI ผ่าน — 2026-09-16

| Target | Tested head | CI | Merge |
|---|---|---|---|
| develop | `44f3ff7c3e0d5c864b56ec87db2196c94a01dc97` | [35049514012](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35049514012), attempt1 SUCCESS | [PR583](https://github.com/MangmeeDev/mangmeeplus/pull/583), `2361157b1e18a336ff6537d84fa47925b9e0ee64` |
| main | `23acbd1f19a7c2ee3d7ff8315f8d076db25e59ef` | [35049794245](https://github.com/MangmeeDev/mangmeeplus/actions/runs/35049794245), attempt2 SUCCESS | [PR584](https://github.com/MangmeeDev/mangmeeplus/pull/584), `670e88ce856306914809cde7735589f21145234d` |

Admin merge develop occurred at04:58:14UTC, then main at04:58:37UTC, after both runs passed. Required Typecheck and Test, Security Audit, Secret Scan, Migration Review and Production Config Validation all passed. Image/publication jobs were intentionally skipped; no deployment happened.

Both merged trees are `bcabfc01d241f953ae7e3207bf4af8d486dbab8a`. They preserve the four prerequisite completion documents that landed while CI ran; all non-doc files match tested tree `a190b1ff3fec69378d84ec0c7d0ec397f73bc685` exactly. Marketing PR4/5 already merged after their own successful CI.

Main attempt1's admin navigation404 remains recorded above; it was not reproduced in the focused16-group browser run, the full7-command cold-cache replay, develop CI, or main attempt2. One failed-job-only retry was used; no product-code change or weakened assertion was made. The underlying cause was not established, so this is not evidence of a fixed application defect.

Source implementation, automated verification and requested merges are complete. Native Postmark inbox/callback acceptance, deployment and human usability testing were not performed in this task. Future release must follow the existing mandatory runbooks; additive migration and email-only rollback constraints still apply.

Final record branch: codex/email-passwordless-delivery-record-20260916 in the owned email-passwordless worktree; based on develop with main ancestry preserved. Runtime source unchanged.
