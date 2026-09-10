# Agent Memory: Receipt fix CI registration

Status: correcting CI runner registration after the four receipt fixes merged.
Owner: Codex
Scope: register receipt removal unit coverage in the existing acceptance runner and execute the new receipt/source-signature PostgreSQL suite in the existing migrated CI database step.
Decisions: retain all test assertions; no package.json or application behavior change. Run the PostgreSQL suite separately to avoid fixture interference with adjacent suites.
Open questions: none.
Artifacts: scripts/line-ai-whole-chain-acceptance.catalog.mjs; .github/workflows/ci.yml.
Verification: automatic PR runs 34442624025 and 34442634870 failed at pnpm test because remove-expense-receipt.use-case.spec.ts was unreferenced. Web tests and typecheck passed in CI. The unit and PostgreSQL suites had already passed locally in the four-fix verification. Owner requested no additional local test run; do not dispatch duplicate CI.
Next: push and admin-merge the minimal runner correction into develop/main under the existing merge authorization. Automatic CI provides the follow-up result. The hub menu/print/entry/layout feature remains separate for local review.
