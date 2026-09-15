# Agent Memory: Stripe/Postmark implementation status

Status: APPROVED SOURCE IMPLEMENTED; local acceptance PASS. Final readiness CI and Admin merges develop/main in both repositories are next. No deploy or provider activation.
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
