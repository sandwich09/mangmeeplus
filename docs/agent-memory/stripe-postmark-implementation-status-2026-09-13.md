# Agent Memory: Stripe/Postmark implementation status

Status: APPROVED SOURCE IMPLEMENTED; local browser/API acceptance and CI fixture correction PASS. Marketing Admin merged develop/main. Core corrected-head CI, develop merge and main promotion remain. No deploy or provider activation.
Owner: Codex / repository owner.
Scope: Approved Stripe packages, Postmark, Admin C01–C08, web/LINE permissions, existing signup/claim and approved email recovery; code and aligned docs in both repos.
Decisions: No pending Owner answer. Gift days shift service and next collection equally with no receipt/AI grant. Collection pause/resume uses reviewed keep_as_draft and an explicit resume date. Local ordinary mail history180days/OFF. OTP/passwordless email auto-provision is separate work and is not claimed as delivered by this billing integration branch.
Artifacts: [Final acceptance](../evidence/billing-integration-2026-09-13/final-integration-result.json), [57 CT/AP rows](../evidence/billing-integration-2026-09-13/final-acceptance-map.md), [source receipt](../evidence/billing-integration-2026-09-13/final-source-receipt.json).

## Integration and corrections

Clean worktree: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-stripe-final-20260915; branch codex/stripe-postmark-final-integration-20260915. Base1fe5172b incorporates1d74cf1d controls and develop647a3db4. Preserved concurrent dirty original core/marketing worktrees. Marketing isolated branch codex/stripe-postmark-implementation-20260912. Existing PR558(core) and PR2(marketing) are the final readiness targets.

- Added runtime DTO classes to14 HTTP body boundaries without increasing validation backlog or weakening conditional/source parsers. Optional class properties must not be mistaken for supplied values.
- Applied existing loading audit to actual in-flight controls;501 covered/0gaps. Fixed Admin company search accepting input before initial hydration/loading completed.
- Collection-only delegated Admin can read password proof and preview/submit via collection permission, without refund, package override or approval permission. Gift/package forms stay unavailable; independent approval and current worker permissions still apply. All27 focused plan/gift/collection/feature groups pass.
- Real429 UI shows the bounded wait and preserves the original command; collection browser proof now waits and retries identical payload/key. No limiter changes. Earlier failing attempts are retained in /tmp/mangmee-final-combined-search-failure.log and /tmp/mangmee-final-combined-collection-submit-failure.log.
- Isolated feature-launch PG fixtures now seed absent gate baselines and deterministically advance generation between survey and lock. Product launch code unchanged. Final full API7448/7448,0skip passes after earlier4 fixture failures.

Verification: See exact commands, group counts and overlapping-test limits in the final result. Current API/web typechecks, fresh isolated database migrations, web1725, contracts246, marketing4, LINE current-source PostgreSQL78 and whole-chain acceptance pass. Maintenance45 pins match the merged bytes; security audit has no high/critical findings. New feature preset browser tests use actual Admin/API/PG and390px with original-command lost-response recovery. Ordinary mail retention11 groups include bounded cleanup, transaction rollback, late complaint resurfacing and original request retry. Final combined database is isolated localhost:15432/watchdog_postmark_ci and browser artifacts use /tmp/mangmee-billing-final-20260916, separate from concurrent OTP work. Older LINE source PG evidence used the earlier isolated mangmee_billing_20260912 database. Providers are simulated; no real charge/send or native/device readiness claim.

## Approved package behavior

Buy/charge immediately; trial days do not carry. Repeat full package adds quota immediately and extends from max(paidThrough,paidAt). Annual grants Starter360/Basic600/Pro1200 upfront, no paid monthly reset. Upgrade charges approved prorated paid-segment difference immediately and keeps the end; downgrade at paid boundary retains selected resources without deletion. Receipt-only sales hidden. Enterprise1999 and SYSTEM ภ.ง.ด.53/50ทวิ Coming soon/no checkout. Default signup7menus(17keys),1branch/2members including Owner,15receipts/Bangkok month and30day trial. VAT OFF; future configured inclusive/exclusive VAT requires reviewed revision. Paid renewal failure retains remaining rights7day grace then stops collection/usage; cancel at paid boundary. Refund/dispute/old debt require review.

## Next

1. Commit only owned clean-worktree code/docs/evidence; exclude generated next-env/AGENTS/CLAUDE and never stage original concurrent changes. No package.json/dependency edit by this work; incoming develop owns the PDF dependency patch.
2. Push readiness revision to existing feature branches once, wait exact-head PR CI success, Admin merge develop then main for both repos. No deployment workflows or live customer gates. User explicitly authorized these merges after green CI.
3. Record final PR/CI/merge IDs in local handoff evidence and report actual results. Native Stripe capability/live money, deployed Postmark secret/webhook/inbox and native LINE return remain release acceptance.

[Historical checkpoint](stripe-postmark-implementation-history-through-controls-2026-09-15.md). Historical percentages or open questions do not override this state.

## Final delivery — CI dispatched2026-09-16

Core revision `bcb11ae7a96c769be3b23d45ae147640d20dd381` pushed to existing PR558 branch; final CI35009007986 in progress. Marketing revision `4163e8ce3a0020f943043ef3f87661d245fe1814` pushed to existing PR2; final CI35009018640 in progress. Both PRs ready. One readiness push per repository after local333 combined + signup8/verification6/recovery7 passed. Settlement forced13 and scoped collection/gift27 pass. No deploy. Wait exact-head CI success, Admin merge develop, create/promote main PRs, wait CI and Admin merge. This post-commit delivery journal is local to avoid a new CI for status only.

Marketing completed: PR2 Admin merged develop after CI35009018640 success; PR3 Admin merged main after CI35009177590 success. Develop942411ba and mainf8d7c9b3 have identical treefb3eb5bf. Core CI35009007986 still running Typecheck and Test; other required jobs success. Exact delivery IDs in local `../evidence/billing-integration-2026-09-13/final-delivery-result.json`. No deployment.

## CI35009007986 failure and local reproduction

CI failed at billing-provider-events-smoke cancellation after18min of HTTP scenarios: expected409, received400 because the preceding preview was429 and its body was used without status validation. CI completed typechecks, full package tests, whole-chain, boot, Postmark HTTP and preceding PostgreSQL stages successfully. No core merge. Marketing both merges remain complete. Local forced real limiter reproduction34995 on SWC11 produced429 at the new preview-status assertion, saved `/tmp/mangmee-ci-provider-event-rate-red.log`. Fixture now waits only bounded BILLING_RATE_LIMIT and repeats the same arguments, asserts preview/cancel success, one original operation, and no cancelled dispatch. Only test harness source changed; production code unchanged frombcb11ae7. SWC12 PASS; next forced HTTP, forced browser, full CI-equivalent non-browser locally, then one corrected readiness push/CI. Do not rerun `/tmp/mangmee-complete-local-docs.py` or rewrite the historical333 proof.

Correction focused HTTP6 and browser7 PASS; API typecheck PASS. Sequential runner24009 now running CI-equivalent default non-browser billing HTTP since2026-09-15T19:23:38Z. Logs `/tmp/mangmee-ci-provider-events-forced-pass.log`, `/tmp/mangmee-ci-provider-events-browser-pass.log`, `/tmp/mangmee-ci-correction-typecheck.log`; full default PASS target `/tmp/mangmee-ci-default-billing-pass.log`. New corrected source fingerprint `/tmp/mangmee-ci-correction-source.json`, SWC12. Only billing-provider-events-smoke.ts differs from prior source receipt. No second CI dispatched yet.

CI correction local closure: forced HTTP6, forced browser7, full CI-default non-browser256 PASS. Evidence `../evidence/billing-integration-2026-09-13/ci-correction-result.json`. Only one test file changed sincebcb11ae7; all product hashes unchanged. Next selectively commit this fixture and correction docs (keep final-delivery-result.json local), update PR558 evidence, one corrected push, wait exact-head CI and Admin merge core develop/main. Marketing already complete.

Corrected revision `a14736fd70cdafb4bc352e91690e03e0ac7836c6` committed and pushed once to PR558. Exact-head CI35015360774 started2026-09-15T19:43:53Z. Local forced HTTP6/browser7 and full CI-default256 PASS; no additional product changes. Wait green CI before Admin merge develop, then main promotion CI/Admin merge. Delivery journal stays local to avoid a status-only CI.

CI35015360774: provider-event correction/full HTTP PASS, signup/recovery browser, LINE credentials, scheduled discovery, historical invoice discovery/import all PASS. Failed support-SLA browser after cohorts passed: waiting for first-page button after clicking next page. Exact log `/tmp/mangmee-ci-35015360774-failed.log`; unchanged focused local CI flags (sales cohort1/config1/SLA1/browser1) PASS8 `/tmp/mangmee-ci-sla-unchanged-pass.log`. No merge/core retry CI. Investigating actual pagination navigation vs fixture timing before correction. Current branch a14736fd.

Browser CI correction closed locally: broad SLA filter response predicate matched Next.js RSC text/x-component (CPU6x expected-red proof), now bound to exact API path/queue/cursor, actual rows and URL. Slow9 plus exact final CI browser sequence and17 offline tail contract commands pass, API typecheck PASS. Evidence `../evidence/billing-integration-2026-09-13/ci-browser-correction-result.json`. Product/runtime/workflow hashes unchanged frombcb. Selectively commit SLA fixture and evidence; one corrected CI push, wait exact-head success then Admin merge develop/main. Keep final-delivery-result.json local; no deploy.
