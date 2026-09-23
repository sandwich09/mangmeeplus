# Agent Memory: sales offer LINE card

Status: Implemented and verified in a clean checkout; not deployed.
Owner: Codex
Scope: Replace the raw billing URL in the approved sales deal OWNER push with a LINE Flex card and URI button.
Decisions: Keep the existing owner-only recipients, tenant billing link, numberless copy, and best-effort push path. Add LINE's `openExternalBrowser=1` to the button URL so its first tap and LINE Login use the same browser cookie jar; fall back to text when no safe link can be built.
Open questions: None.
Artifacts: `apps/api/src/modules/sales-console/domain/sales-deal.logic.ts`, `apps/api/src/modules/sales-console/application/sales-deals.service.ts`, focused domain spec, sales-deal spec and plan.
Verification: Focused `sales-deal.logic.spec.ts` passed (23 tests), including the exact external-browser button URI and encoded tenant path. Clean-worktree contracts build, Prisma generate, API typecheck, and `git diff --check` passed. LINE mobile client behavior still needs UAT confirmation.
Next: Merge to develop and main; deploy and check a real LINE client only through the normal release protocol, including a second tap after signing in.
