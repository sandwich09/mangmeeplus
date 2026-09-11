# Agent Memory: Billing/package merge to main and develop

Status: Integration candidate verified; GitHub PR merge records are the delivery authority.
Owner: Codex / thawatchai.
Scope: User requested merging the current Stripe/Postmark/signup/package/admin/web/LINE work into main and develop in both repositories. Preserve unrelated dirty expense/deployment work through isolated paired worktrees.
Decisions: Merge upstream main/develop histories before applying the scoped patch. Preserve newer upstream code during conflict resolution. Include historical evidence without regenerating its hashes. Do not modify package.json, deploy, open payment gates, or label full E2E complete.
Open questions: No additional product decision needed for this merge. Existing Stripe implementation/business gates and AX03/AX04 remain open.
Artifacts: [Merge evidence](../evidence/billing-merge-2026-09-11/README.md), [scope](../evidence/billing-merge-2026-09-11/scope.json), package spec/plan and sibling alignment docs. Branch codex/billing-package-access-20260911; original working trees retained.
Verification: New integrated-tree focused suites 550 + 294 + 75 + 257 + 318 = 1,494 PASS; API/web production-source tsc exit 0; actual sibling Chromium at 1440px/390px PASS, zero external POST. Initial missing generated-artifact setup errors retained separately. Full cross-layer/provider E2E not rerun or claimed.
Next: Remote merge receipts identify the delivered SHAs; next product work remains the existing implementation plan, including AP21/AP22 and actual Stripe/browser/native acceptance.
